// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CHUNK_SIZE = 50; // Work items per chunk - optimized for CPU limits

interface AnalysisRequest {
  organization: string;
  project: string;
  queryId: string;
  pat: string;
  debug?: boolean;
}

async function azureRequest(url: string, pat: string): Promise<unknown> {
  const auth = btoa(`:${pat}`);
  const response = await fetch(url, {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Azure DevOps API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function executeQuery(
  organization: string,
  project: string,
  queryId: string,
  pat: string
): Promise<number[]> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/wit/wiql/${queryId}?api-version=7.1`;
  const result = await azureRequest(url, pat) as { workItems?: Array<{ id: number }> };
  return result.workItems?.map(wi => wi.id) || [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization, project, queryId, pat, debug = false } = await req.json() as AnalysisRequest;

    if (!organization || !project || !queryId || !pat) {
      throw new Error('Missing required fields: organization, project, queryId, pat');
    }

    console.log(`[Job Init] Starting analysis for ${organization}/${project}${debug ? ' (DEBUG MODE)' : ''}`);

    // Fetch work item IDs from Azure DevOps
    const workItemIds = await executeQuery(organization, project, queryId, pat);
    console.log(`[Job Init] Found ${workItemIds.length} work items`);

    // Handle empty query result
    if (workItemIds.length === 0) {
      return new Response(JSON.stringify({
        jobId: null,
        status: 'completed',
        result: {
          developerMetrics: [],
          testerMetrics: [],
          prCommentAuthors: [],
          summary: { totalWorkItems: 0, totalRequirements: 0, totalBugs: 0, totalTasks: 0, avgDevTimeHours: 0, avgDevTestTimeHours: 0, avgStgTestTimeHours: 0, totalReturns: 0, totalPrComments: 0 },
          chartData: { developmentSpeed: [], devTestingSpeed: [], stgTestingSpeed: [], returns: [], devIterations: [], stgIterations: [], prComments: [] },
          unassignedItems: [],
        }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Initialize Supabase client with service role for database operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Create job record
    const totalChunks = Math.ceil(workItemIds.length / CHUNK_SIZE);
    const { data: job, error: jobError } = await supabase
      .from('analysis_jobs')
      .insert({
        organization,
        project,
        query_id: queryId,
        status: 'processing',
        total_items: workItemIds.length,
        processed_items: 0,
        current_step: `Starting analysis of ${workItemIds.length} items in ${totalChunks} chunks`,
      })
      .select('id')
      .single();

    if (jobError || !job) {
      throw new Error(`Failed to create job: ${jobError?.message}`);
    }

    const jobId = job.id;
    console.log(`[Job ${jobId}] Created job for ${workItemIds.length} items in ${totalChunks} chunks`);

    // Use EdgeRuntime.waitUntil to process in background
    // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
    EdgeRuntime.waitUntil(processJob(supabase, jobId, organization, project, pat, workItemIds, debug));

    return new Response(JSON.stringify({
      jobId,
      status: 'processing',
      totalItems: workItemIds.length,
      totalChunks,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[Job Init] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Background processing function
async function processJob(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  organization: string,
  project: string,
  pat: string,
  workItemIds: number[],
  debug: boolean
) {
  const debugLogs: Record<number, any> = {};

  try {
    console.log(`[Job ${jobId}] Starting background processing`);

    // Step 1: Fetch all work items with relations (batched)
    await updateJobStatus(supabase, jobId, 'Fetching work items...');
    const workItems = await fetchWorkItemsBatched(organization, project, workItemIds, pat);
    console.log(`[Job ${jobId}] Fetched ${workItems.length} work items`);

    // Step 2: Process work items in chunks
    const chunks = chunkArray(workItems, CHUNK_SIZE);
    const allChunkResults: ChunkResult[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      await updateJobStatus(supabase, jobId, `Processing chunk ${i + 1}/${chunks.length}`, Math.round(((i + 1) / chunks.length) * 50));
      
      console.log(`[Job ${jobId}] Processing chunk ${i + 1}/${chunks.length} (${chunk.length} items)`);
      const chunkResult = await processWorkItemChunk(organization, project, pat, chunk, debug, debugLogs);
      allChunkResults.push(chunkResult);

      // Save chunk result to database for recovery
      const chunkData = {
        job_id: jobId,
        chunk_index: i,
        chunk_type: 'work_items',
        data: chunkResult,
      };
      await (supabase.from('analysis_chunks') as any).insert(chunkData);
    }

    // Step 3: Process PR comments for ALL work items
    await updateJobStatus(supabase, jobId, 'Processing PR comments...', 60);
    const prResults = await processPRCommentsBatched(organization, project, pat, workItems);
    console.log(`[Job ${jobId}] PR comments processed`);

    // Step 4: Merge all results
    await updateJobStatus(supabase, jobId, 'Merging results...', 90);
    const finalResult = mergeChunkResults(allChunkResults, prResults, workItems);
    
    // Add debug logs if enabled
    if (debug) {
      (finalResult as any).debugLogs = debugLogs;
    }
    
    console.log(`[Job ${jobId}] Merged ${allChunkResults.length} chunks`);

    // Step 5: Save final result
    const completedUpdate = {
      status: 'completed',
      processed_items: workItemIds.length,
      current_step: 'Complete',
      result: finalResult,
    };
    await (supabase.from('analysis_jobs') as any).update(completedUpdate).eq('id', jobId);

    console.log(`[Job ${jobId}] Completed successfully`);

  } catch (error) {
    console.error(`[Job ${jobId}] Failed:`, error);
    const failedUpdate = {
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Unknown error',
      current_step: 'Failed',
    };
    await (supabase.from('analysis_jobs') as any).update(failedUpdate).eq('id', jobId);
  }
}

async function updateJobStatus(supabase: ReturnType<typeof createClient>, jobId: string, step: string, progress?: number) {
  const update: Record<string, unknown> = { current_step: step };
  if (progress !== undefined) {
    update.processed_items = progress;
  }
  await (supabase.from('analysis_jobs') as any).update(update).eq('id', jobId);
}

// ============== Azure DevOps API Functions ==============

async function azureRequest2(url: string, pat: string): Promise<unknown> {
  const auth = btoa(`:${pat}`);
  const response = await fetch(url, {
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Azure API error (${response.status}): ${text}`);
  }
  return response.json();
}

interface WorkItem {
  id: number;
  fields: Record<string, unknown>;
  relations?: Array<{ rel: string; url: string; attributes: { name: string } }>;
}

interface WorkItemRevision {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
}

async function fetchWorkItemsBatched(org: string, project: string, ids: number[], pat: string): Promise<WorkItem[]> {
  const BATCH_SIZE = 200;
  const allItems: WorkItem[] = [];

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batchIds = ids.slice(i, i + BATCH_SIZE);
    const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workitems?ids=${batchIds.join(',')}&$expand=relations&api-version=7.1`;
    const result = await azureRequest2(url, pat) as { value: WorkItem[] };
    allItems.push(...result.value);
  }

  return allItems;
}

async function getWorkItemRevisions(org: string, project: string, workItemId: number, pat: string): Promise<WorkItemRevision[]> {
  const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workitems/${workItemId}/revisions?api-version=7.1`;
  const result = await azureRequest2(url, pat) as { value: WorkItemRevision[] };
  return result.value;
}

// ============== Metrics Calculation ==============

const STATES = {
  ACTIVE: 'Active',
  CODE_REVIEW: 'Code Review',
  FIX_REQUIRED: 'Fix Required',
  DEV_IN_TESTING: 'DEV_In Testing',
  STG_IN_TESTING: 'STG_In Testing',
  DEV_ACCEPTANCE_TESTING: 'DEV_Acceptance Testing',
  STG_ACCEPTANCE_TESTING: 'STG_Acceptance Testing',
  RELEASED: 'Released',
} as const;

interface TransitionEvent {
  fromState: string;
  toState: string;
  timestamp: Date;
  workItemId: number;
  assignedTo: string | null;
  changedBy: string | null;
}

interface WorkItemReference {
  id: number;
  title: string;
  type: string;
  url: string;
  count: number;
  assignedToChanged: boolean;
  assignedToHistory: string[];
}

interface PRReference {
  prId: string;
  prUrl: string;
  workItemId: number;
  workItemTitle: string;
  commentsCount: number;
  authors: string[]; // Enhanced: array of comment authors
}

interface ChunkResult {
  devAgg: Record<string, DevAggData>;
  testerAgg: Record<string, TesterAggData>;
  testers: string[];
  unassignedItems: WorkItemReference[];
  totalDevHours: number;
  totalDevTestHours: number;
  totalStgTestHours: number;
  requirements: number;
  bugs: number;
  tasks: number;
}

interface DevAggData {
  hours: number;
  cycles: number;
  cr: number;
  dev: number;
  stg: number;
  completed: number;
  items: WorkItemReference[];
  returns: WorkItemReference[];
  crReturns: WorkItemReference[];
  devReturns: WorkItemReference[];
  stgReturns: WorkItemReference[];
}

interface TesterAggData {
  devHours: number;
  stgHours: number;
  devCycles: number;
  stgCycles: number;
  devIter: number;
  stgIter: number;
  closed: WorkItemReference[];
  devItems: WorkItemReference[];
  stgItems: WorkItemReference[];
  prDetails: PRReference[];
  prsReviewed: number;
}

function getDisplayName(field: unknown): string | null {
  if (!field) return null;
  if (typeof field === 'object' && field !== null && 'displayName' in field) {
    return (field as { displayName: string }).displayName;
  }
  return null;
}

function extractAssignedToHistory(revisions: WorkItemRevision[]): string[] {
  const history: string[] = [];
  let last: string | null = null;
  for (const rev of revisions) {
    const name = getDisplayName(rev.fields['System.AssignedTo']);
    if (name && name !== last) {
      history.push(name);
      last = name;
    }
  }
  return history;
}

// Developer attribution: current AssignedTo -> fallback to last known -> Unassigned
function getCurrentAssignedTo(wi: WorkItem, history: string[]): string {
  const current = getDisplayName(wi.fields['System.AssignedTo']);
  if (current) return current;
  if (history.length > 0) return history[history.length - 1];
  return 'Unassigned';
}

function extractTransitions(revisions: WorkItemRevision[], workItemId: number): TransitionEvent[] {
  const transitions: TransitionEvent[] = [];
  for (let i = 1; i < revisions.length; i++) {
    const prevState = revisions[i - 1].fields['System.State'] as string;
    const currState = revisions[i].fields['System.State'] as string;
    if (prevState !== currState) {
      transitions.push({
        fromState: prevState,
        toState: currState,
        timestamp: new Date(revisions[i].fields['System.ChangedDate'] as string),
        workItemId,
        assignedTo: getDisplayName(revisions[i].fields['System.AssignedTo']),
        changedBy: getDisplayName(revisions[i].fields['System.ChangedBy']),
      });
    }
  }
  return transitions;
}

function calculateDevelopmentTime(transitions: TransitionEvent[]): { totalHours: number; cycles: number } {
  let totalHours = 0;
  let cycles = 0;
  let activeStart: Date | null = null;

  for (const t of transitions) {
    if (t.toState === STATES.DEV_ACCEPTANCE_TESTING) {
      if (activeStart) {
        totalHours += (t.timestamp.getTime() - activeStart.getTime()) / 3600000;
        cycles++;
        activeStart = null;
      }
      return { totalHours, cycles };
    }
    if (t.toState === STATES.ACTIVE) {
      activeStart = t.timestamp;
    } else if (t.fromState === STATES.ACTIVE && activeStart) {
      totalHours += (t.timestamp.getTime() - activeStart.getTime()) / 3600000;
      cycles++;
      activeStart = null;
    }
  }
  return { totalHours, cycles };
}

function countReturns(transitions: TransitionEvent[]): { cr: number; dev: number; stg: number } {
  let cr = 0, dev = 0, stg = 0;
  for (const t of transitions) {
    if (t.toState === STATES.FIX_REQUIRED) {
      if (t.fromState === STATES.CODE_REVIEW) cr++;
      else if (t.fromState === STATES.DEV_IN_TESTING || t.fromState === STATES.DEV_ACCEPTANCE_TESTING) dev++;
      else if (t.fromState === STATES.STG_IN_TESTING || t.fromState === STATES.STG_ACCEPTANCE_TESTING) stg++;
    }
  }
  return { cr, dev, stg };
}

function calculateTestingMetrics(
  transitions: TransitionEvent[],
  inTestingState: string,
  acceptanceState: string
): Map<string, { hours: number; cycles: number; iterations: number }> {
  const metrics = new Map<string, { hours: number; cycles: number; iterations: number }>();
  let cycle: { tester: string; start: Date; periods: number[]; pendingMerge: boolean } | null = null;

  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];

    if (t.toState === inTestingState) {
      const tester = t.changedBy || t.assignedTo || 'Unknown';

      if (cycle?.pendingMerge && t.fromState === acceptanceState && cycle.tester === tester) {
        cycle.pendingMerge = false;
      } else {
        if (cycle) {
          const hours = cycle.periods.reduce((a, b) => a + b, 0);
          if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { hours: 0, cycles: 0, iterations: 0 });
          const m = metrics.get(cycle.tester)!;
          m.hours += hours;
          m.cycles++;
          m.iterations++;
        }
        cycle = { tester, start: t.timestamp, periods: [], pendingMerge: false };
      }
    } else if (t.fromState === inTestingState && cycle) {
      const hours = (t.timestamp.getTime() - cycle.start.getTime()) / 3600000;
      cycle.periods.push(hours);

      if (t.toState === acceptanceState) {
        let canMerge = false;
        for (let j = i + 1; j < transitions.length; j++) {
          if (transitions[j].toState === inTestingState) {
            const nextTester = transitions[j].changedBy || transitions[j].assignedTo || 'Unknown';
            canMerge = transitions[j].fromState === acceptanceState && nextTester === cycle.tester;
            break;
          }
          if (transitions[j].fromState === acceptanceState && transitions[j].toState !== inTestingState) break;
        }

        if (canMerge) {
          cycle.pendingMerge = true;
          cycle.start = t.timestamp;
        } else {
          const totalHours = cycle.periods.reduce((a, b) => a + b, 0);
          if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { hours: 0, cycles: 0, iterations: 0 });
          const m = metrics.get(cycle.tester)!;
          m.hours += totalHours;
          m.cycles++;
          m.iterations++;
          cycle = null;
        }
      } else {
        const totalHours = cycle.periods.reduce((a, b) => a + b, 0);
        if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { hours: 0, cycles: 0, iterations: 0 });
        const m = metrics.get(cycle.tester)!;
        m.hours += totalHours;
        m.cycles++;
        m.iterations++;
        cycle = null;
      }
    } else if (cycle?.pendingMerge && t.fromState === acceptanceState && t.toState !== inTestingState) {
      const totalHours = cycle.periods.reduce((a, b) => a + b, 0);
      if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { hours: 0, cycles: 0, iterations: 0 });
      const m = metrics.get(cycle.tester)!;
      m.hours += totalHours;
      m.cycles++;
      m.iterations++;
      cycle = null;
    }
  }

  if (cycle) {
    const totalHours = cycle.periods.reduce((a, b) => a + b, 0);
    if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { hours: 0, cycles: 0, iterations: 0 });
    const m = metrics.get(cycle.tester)!;
    m.hours += totalHours;
    m.cycles++;
  }

  return metrics;
}

// ============== Debug Logging ==============

interface DebugLog {
  workItemId: number;
  title: string;
  currentAssignedTo: string;
  assignedToHistory: string[];
  transitions: Array<{
    from: string;
    to: string;
    timestamp: string;
    changedBy: string | null;
    assignedTo: string | null;
  }>;
  devTime: { hours: number; cycles: number };
  returns: { cr: number; dev: number; stg: number };
  devTesting: Array<{ tester: string; hours: number; cycles: number; iterations: number }>;
  stgTesting: Array<{ tester: string; hours: number; cycles: number; iterations: number }>;
}

function createDebugLog(
  wi: WorkItem,
  assignedTo: string,
  history: string[],
  transitions: TransitionEvent[],
  devTime: { totalHours: number; cycles: number },
  returns: { cr: number; dev: number; stg: number },
  devTest: Map<string, { hours: number; cycles: number; iterations: number }>,
  stgTest: Map<string, { hours: number; cycles: number; iterations: number }>
): DebugLog {
  return {
    workItemId: wi.id,
    title: wi.fields['System.Title'] as string,
    currentAssignedTo: assignedTo,
    assignedToHistory: history,
    transitions: transitions.map(t => ({
      from: t.fromState,
      to: t.toState,
      timestamp: t.timestamp.toISOString(),
      changedBy: t.changedBy,
      assignedTo: t.assignedTo,
    })),
    devTime: { hours: devTime.totalHours, cycles: devTime.cycles },
    returns,
    devTesting: Array.from(devTest.entries()).map(([tester, data]) => ({ tester, ...data })),
    stgTesting: Array.from(stgTest.entries()).map(([tester, data]) => ({ tester, ...data })),
  };
}

// ============== Chunk Processing ==============

async function processWorkItemChunk(
  org: string,
  project: string,
  pat: string,
  workItems: WorkItem[],
  debug: boolean,
  debugLogs: Record<number, any>
): Promise<ChunkResult> {
  const devAgg: Record<string, DevAggData> = {};
  const testerAgg: Record<string, TesterAggData> = {};
  const testers: string[] = [];
  const unassignedItems: WorkItemReference[] = [];
  let totalDevHours = 0, totalDevTestHours = 0, totalStgTestHours = 0;
  let requirements = 0, bugs = 0, tasks = 0;

  // Filter by type
  const metricsItems = workItems.filter(wi => {
    const type = wi.fields['System.WorkItemType'] as string;
    if (type === 'Requirement') { requirements++; return true; }
    if (type === 'Bug') { bugs++; return true; }
    if (type === 'Task') { tasks++; return false; }
    return false;
  });

  // Process revisions in parallel (small batches to avoid CPU spikes)
  const REVISION_BATCH = 10;
  for (let i = 0; i < metricsItems.length; i += REVISION_BATCH) {
    const batch = metricsItems.slice(i, i + REVISION_BATCH);
    const revisionsBatch = await Promise.all(
      batch.map(wi => getWorkItemRevisions(org, project, wi.id, pat))
    );

    for (let j = 0; j < batch.length; j++) {
      const wi = batch[j];
      const revisions = revisionsBatch[j];
      const transitions = extractTransitions(revisions, wi.id);

      const type = wi.fields['System.WorkItemType'] as string;
      const title = wi.fields['System.Title'] as string;
      const state = wi.fields['System.State'] as string;
      const history = extractAssignedToHistory(revisions);
      
      // Developer attribution: strictly by current AssignedTo with fallbacks
      const assignedTo = getCurrentAssignedTo(wi, history);
      const url = `https://dev.azure.com/${org}/${project}/_workitems/edit/${wi.id}`;

      const ref: WorkItemReference = { id: wi.id, title, type, url, count: 0, assignedToChanged: history.length > 1, assignedToHistory: history };

      const t1 = getDisplayName(wi.fields['Custom.TestedBy1']);
      const t2 = getDisplayName(wi.fields['Custom.TestedBy2']);
      if (t1 && !testers.includes(t1)) testers.push(t1);
      if (t2 && !testers.includes(t2)) testers.push(t2);

      // Dev time
      const devTime = calculateDevelopmentTime(transitions);
      totalDevHours += devTime.totalHours;

      if (!devAgg[assignedTo]) {
        devAgg[assignedTo] = { hours: 0, cycles: 0, cr: 0, dev: 0, stg: 0, completed: 0, items: [], returns: [], crReturns: [], devReturns: [], stgReturns: [] };
      }
      const da = devAgg[assignedTo];
      da.hours += devTime.totalHours;
      da.cycles += devTime.cycles;
      da.items.push({ ...ref, count: 1 });

      if (assignedTo === 'Unassigned') unassignedItems.push({ ...ref, count: 1 });

      // Returns - attributed to current assignedTo (not at transition time)
      const returns = countReturns(transitions);
      da.cr += returns.cr;
      da.dev += returns.dev;
      da.stg += returns.stg;

      const totalRet = returns.cr + returns.dev + returns.stg;
      if (totalRet > 0) da.returns.push({ ...ref, count: totalRet });
      if (returns.cr > 0) da.crReturns.push({ ...ref, count: returns.cr });
      if (returns.dev > 0) da.devReturns.push({ ...ref, count: returns.dev });
      if (returns.stg > 0) da.stgReturns.push({ ...ref, count: returns.stg });

      if (state === STATES.RELEASED) da.completed++;

      // DEV Testing
      const devTest = calculateTestingMetrics(transitions, STATES.DEV_IN_TESTING, STATES.DEV_ACCEPTANCE_TESTING);
      for (const [tester, data] of devTest) {
        if (!testerAgg[tester]) {
          testerAgg[tester] = { devHours: 0, stgHours: 0, devCycles: 0, stgCycles: 0, devIter: 0, stgIter: 0, closed: [], devItems: [], stgItems: [], prDetails: [], prsReviewed: 0 };
        }
        const ta = testerAgg[tester];
        ta.devHours += data.hours;
        ta.devCycles += data.cycles;
        ta.devIter += data.iterations;
        totalDevTestHours += data.hours;

        if (data.iterations > 0) {
          const existing = ta.devItems.find(x => x.id === wi.id);
          if (existing) existing.count += data.iterations;
          else ta.devItems.push({ ...ref, count: data.iterations });
        }

        if (state === STATES.RELEASED && !ta.closed.find(x => x.id === wi.id)) {
          ta.closed.push({ ...ref, count: 1 });
        }
      }

      // STG Testing
      const stgTest = calculateTestingMetrics(transitions, STATES.STG_IN_TESTING, STATES.STG_ACCEPTANCE_TESTING);
      for (const [tester, data] of stgTest) {
        if (!testerAgg[tester]) {
          testerAgg[tester] = { devHours: 0, stgHours: 0, devCycles: 0, stgCycles: 0, devIter: 0, stgIter: 0, closed: [], devItems: [], stgItems: [], prDetails: [], prsReviewed: 0 };
        }
        const ta = testerAgg[tester];
        ta.stgHours += data.hours;
        ta.stgCycles += data.cycles;
        ta.stgIter += data.iterations;
        totalStgTestHours += data.hours;

        if (data.iterations > 0) {
          const existing = ta.stgItems.find(x => x.id === wi.id);
          if (existing) existing.count += data.iterations;
          else ta.stgItems.push({ ...ref, count: data.iterations });
        }

        if (state === STATES.RELEASED && !ta.closed.find(x => x.id === wi.id)) {
          ta.closed.push({ ...ref, count: 1 });
        }
      }

      // Debug logging (only when enabled)
      if (debug) {
        debugLogs[wi.id] = createDebugLog(wi, assignedTo, history, transitions, devTime, returns, devTest, stgTest);
      }
    }
  }

  return { devAgg, testerAgg, testers, unassignedItems, totalDevHours, totalDevTestHours, totalStgTestHours, requirements, bugs, tasks };
}

// ============== PR Comments Processing ==============

async function processPRCommentsBatched(
  org: string,
  project: string,
  pat: string,
  workItems: WorkItem[]
): Promise<Map<string, { count: number; prs: PRReference[] }>> {
  const prAgg = new Map<string, { count: number; prs: PRReference[] }>();
  const PR_BATCH_SIZE = 15;

  for (let i = 0; i < workItems.length; i += PR_BATCH_SIZE) {
    const batch = workItems.slice(i, i + PR_BATCH_SIZE);
    const results = await Promise.all(batch.map(wi => getPRCommentsForItem(org, project, wi, pat)));

    for (const result of results) {
      for (const [author, data] of result) {
        if (!prAgg.has(author)) prAgg.set(author, { count: 0, prs: [] });
        const pa = prAgg.get(author)!;
        pa.count += data.count;
        pa.prs.push(...data.prs);
      }
    }
  }

  return prAgg;
}

async function getPRCommentsForItem(
  org: string,
  project: string,
  workItem: WorkItem,
  pat: string
): Promise<Map<string, { count: number; prs: PRReference[] }>> {
  const result = new Map<string, { count: number; prs: PRReference[] }>();

  if (!workItem.relations) return result;

  const prLinks = workItem.relations.filter(r => r.rel === 'ArtifactLink' && r.url.includes('PullRequestId'));
  const title = workItem.fields['System.Title'] as string;

  for (const link of prLinks) {
    try {
      const match = link.url.match(/PullRequestId\/[^%]+%2F([^%]+)%2F(\d+)/);
      if (!match) continue;

      const [, repoId, prId] = match;
      const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/threads?api-version=7.1`;
      const threads = await azureRequest2(url, pat) as { value: Array<{ comments: Array<{ author: { displayName: string }; commentType: string }> }> };

      const prUrl = `https://dev.azure.com/${org}/${project}/_git/${repoId}/pullrequest/${prId}`;
      
      // Collect all authors for this PR
      const prAuthors: Set<string> = new Set();

      for (const thread of threads.value) {
        if (thread.comments?.[0]?.commentType === 'text') {
          const author = thread.comments[0].author.displayName;
          prAuthors.add(author);

          if (!result.has(author)) result.set(author, { count: 0, prs: [] });
          const data = result.get(author)!;
          data.count++;

          const existing = data.prs.find(p => p.prId === prId);
          if (existing) {
            existing.commentsCount++;
            if (!existing.authors.includes(author)) {
              existing.authors.push(author);
            }
          } else {
            data.prs.push({ prId, prUrl, workItemId: workItem.id, workItemTitle: title, commentsCount: 1, authors: [author] });
          }
        }
      }
    } catch {
      // Skip inaccessible PRs
    }
  }

  return result;
}

// ============== Result Merging ==============

function mergeChunkResults(
  chunks: ChunkResult[],
  prAgg: Map<string, { count: number; prs: PRReference[] }>,
  workItems: WorkItem[]
): unknown {
  const mergedDevAgg: Record<string, DevAggData> = {};
  const mergedTesterAgg: Record<string, TesterAggData> = {};
  const allTesters = new Set<string>();
  const unassignedItems: WorkItemReference[] = [];
  let totalDevHours = 0, totalDevTestHours = 0, totalStgTestHours = 0;
  let requirements = 0, bugs = 0, tasks = 0;

  // Merge all chunks
  for (const chunk of chunks) {
    requirements += chunk.requirements;
    bugs += chunk.bugs;
    tasks += chunk.tasks;
    totalDevHours += chunk.totalDevHours;
    totalDevTestHours += chunk.totalDevTestHours;
    totalStgTestHours += chunk.totalStgTestHours;
    unassignedItems.push(...chunk.unassignedItems);

    for (const t of chunk.testers) allTesters.add(t);

    // Merge dev aggregates
    for (const [dev, data] of Object.entries(chunk.devAgg)) {
      if (!mergedDevAgg[dev]) {
        mergedDevAgg[dev] = { hours: 0, cycles: 0, cr: 0, dev: 0, stg: 0, completed: 0, items: [], returns: [], crReturns: [], devReturns: [], stgReturns: [] };
      }
      const m = mergedDevAgg[dev];
      m.hours += data.hours;
      m.cycles += data.cycles;
      m.cr += data.cr;
      m.dev += data.dev;
      m.stg += data.stg;
      m.completed += data.completed;
      m.items.push(...data.items);
      m.returns.push(...data.returns);
      m.crReturns.push(...data.crReturns);
      m.devReturns.push(...data.devReturns);
      m.stgReturns.push(...data.stgReturns);
    }

    // Merge tester aggregates
    for (const [tester, data] of Object.entries(chunk.testerAgg)) {
      if (!mergedTesterAgg[tester]) {
        mergedTesterAgg[tester] = { devHours: 0, stgHours: 0, devCycles: 0, stgCycles: 0, devIter: 0, stgIter: 0, closed: [], devItems: [], stgItems: [], prDetails: [], prsReviewed: 0 };
      }
      const m = mergedTesterAgg[tester];
      m.devHours += data.devHours;
      m.stgHours += data.stgHours;
      m.devCycles += data.devCycles;
      m.stgCycles += data.stgCycles;
      m.devIter += data.devIter;
      m.stgIter += data.stgIter;
      m.closed.push(...data.closed);
      m.devItems.push(...data.devItems);
      m.stgItems.push(...data.stgItems);
    }
  }

  // Add PR comments to tester data
  for (const [author, data] of prAgg) {
    if (mergedTesterAgg[author]) {
      mergedTesterAgg[author].prsReviewed += data.prs.length;
      mergedTesterAgg[author].prDetails.push(...data.prs);
    }
  }

  // Build final metrics
  const numTasks = requirements + bugs;

  const developerMetrics = Object.entries(mergedDevAgg).map(([developer, d]) => {
    const taskCount = d.items.length;
    return {
      developer,
      avgDevTimeHours: taskCount > 0 ? d.hours / taskCount : 0,
      developmentCycles: d.cycles,
      totalReturnCount: d.cr + d.dev + d.stg,
      codeReviewReturns: d.cr,
      devTestingReturns: d.dev,
      stgTestingReturns: d.stg,
      itemsCompleted: d.completed,
      avgTotalReturnsPerTask: taskCount > 0 ? (d.cr + d.dev + d.stg) / taskCount : 0,
      avgCodeReviewReturnsPerTask: taskCount > 0 ? d.cr / taskCount : 0,
      avgDevTestingReturnsPerTask: taskCount > 0 ? d.dev / taskCount : 0,
      avgStgTestingReturnsPerTask: taskCount > 0 ? d.stg / taskCount : 0,
      workItems: d.items,
      returnItems: d.returns,
      codeReviewReturnItems: d.crReturns,
      devTestingReturnItems: d.devReturns,
      stgTestingReturnItems: d.stgReturns,
    };
  }).sort((a, b) => b.itemsCompleted - a.itemsCompleted);

  const testerMetrics = Object.entries(mergedTesterAgg).map(([tester, t]) => {
    const taskCount = Math.max(t.devItems.length, t.stgItems.length, t.closed.length, 1);
    const prCount = t.prsReviewed || (prAgg.get(tester)?.prs.length || 0);
    const commentCount = prAgg.get(tester)?.count || 0;

    return {
      tester,
      closedItemsCount: t.closed.length,
      avgDevTestTimeHours: taskCount > 0 ? t.devHours / taskCount : 0,
      avgStgTestTimeHours: taskCount > 0 ? t.stgHours / taskCount : 0,
      devTestingCycles: t.devCycles,
      stgTestingCycles: t.stgCycles,
      devTestingIterations: t.devIter,
      stgTestingIterations: t.stgIter,
      prCommentsCount: commentCount,
      avgDevIterationsPerTask: taskCount > 0 ? t.devIter / taskCount : 0,
      avgStgIterationsPerTask: taskCount > 0 ? t.stgIter / taskCount : 0,
      avgPrCommentsPerPr: prCount > 0 ? commentCount / prCount : 0,
      tasksWorkedOn: taskCount,
      prsReviewed: prCount,
      closedItems: t.closed,
      devIterationItems: t.devItems,
      stgIterationItems: t.stgItems,
      prCommentDetails: t.prDetails,
    };
  }).sort((a, b) => b.closedItemsCount - a.closedItemsCount);

  const prCommentAuthors = Array.from(prAgg.entries()).map(([author, p]) => ({
    author,
    count: p.count,
    isTester: allTesters.has(author),
    prDetails: p.prs,
  })).sort((a, b) => b.count - a.count);

  const totalReturns = developerMetrics.reduce((s, d) => s + d.totalReturnCount, 0);
  const totalPrComments = Array.from(prAgg.values()).reduce((s, p) => s + p.count, 0);

  const summary = {
    totalWorkItems: workItems.length,
    totalRequirements: requirements,
    totalBugs: bugs,
    totalTasks: tasks,
    avgDevTimeHours: numTasks > 0 ? totalDevHours / numTasks : 0,
    avgDevTestTimeHours: numTasks > 0 ? totalDevTestHours / numTasks : 0,
    avgStgTestTimeHours: numTasks > 0 ? totalStgTestHours / numTasks : 0,
    totalReturns,
    totalPrComments,
  };

  const chartData = {
    developmentSpeed: developerMetrics.filter(d => d.avgDevTimeHours > 0).slice(0, 10).map(d => ({ name: d.developer, value: Math.round(d.avgDevTimeHours * 10) / 10 })),
    devTestingSpeed: testerMetrics.filter(t => t.avgDevTestTimeHours > 0).slice(0, 10).map(t => ({ name: t.tester, value: Math.round(t.avgDevTestTimeHours * 10) / 10 })),
    stgTestingSpeed: testerMetrics.filter(t => t.avgStgTestTimeHours > 0).slice(0, 10).map(t => ({ name: t.tester, value: Math.round(t.avgStgTestTimeHours * 10) / 10 })),
    returns: developerMetrics.filter(d => d.totalReturnCount > 0).slice(0, 10).map(d => ({ name: d.developer, value: d.totalReturnCount })),
    devIterations: testerMetrics.filter(t => t.devTestingIterations > 0).slice(0, 10).map(t => ({ name: t.tester, value: t.devTestingIterations })),
    stgIterations: testerMetrics.filter(t => t.stgTestingIterations > 0).slice(0, 10).map(t => ({ name: t.tester, value: t.stgTestingIterations })),
    prComments: prCommentAuthors.slice(0, 10).map(p => ({ name: p.author, value: p.count, isTester: p.isTester })),
  };

  return {
    developerMetrics,
    testerMetrics,
    prCommentAuthors,
    summary,
    chartData,
    unassignedItems,
  };
}

// ============== Utilities ==============

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

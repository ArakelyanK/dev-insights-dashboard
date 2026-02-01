// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CHUNK_SIZE = 50; // Work items per chunk
const CHUNK_CONCURRENCY = 4; // Parallel chunk processing limit
const DEBUG_THRESHOLD = 20; // Auto-enable verbose debug for <= 20 items

interface AnalysisRequest {
  organization: string;
  project: string;
  queryId: string;
  pat: string;
  debug?: boolean;
}

// ============== Stage Telemetry ==============

interface StageTelemetry {
  jobId: string;
  stage: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  counts: Record<string, number>;
}

function logStageTelemetry(telemetry: StageTelemetry) {
  telemetry.endTime = Date.now();
  telemetry.durationMs = telemetry.endTime - telemetry.startTime;
  console.log(`[Telemetry] ${JSON.stringify(telemetry)}`);
}

function startStage(jobId: string, stage: string): StageTelemetry {
  return {
    jobId,
    stage,
    startTime: Date.now(),
    counts: {},
  };
}

// ============== Domain Debug Logging (Verbose Mode Only) ==============

interface DomainDebugLog {
  workItemId: number;
  title: string;
  type: string;
  currentState: string;
  attribution: {
    currentAssignedTo: string;
    fallbackUsed: boolean;
    assignedToHistory: string[];
  };
  stateTransitions: Array<{
    fromState: string;
    toState: string;
    enteredAt: string;
    leftAt: string;
    durationHours: number;
    changedBy: string | null;
    assignedToAtTransition: string | null;
  }>;
  developmentTime: {
    activePeriods: Array<{
      start: string;
      end: string | null;
      durationHours: number;
      included: boolean;
      exclusionReason?: string;
    }>;
    totalActiveHours: number;
    developmentCycles: number;
    stoppedAtFirstDevAcceptance: boolean;
  };
  testingCycles: {
    dev: Array<{
      tester: string;
      cycleNumber: number;
      periods: Array<{
        start: string;
        end: string;
        durationHours: number;
      }>;
      merged: boolean;
      mergeReason?: string;
      iterationsCounted: number;
      closingStatus: string;
    }>;
    stg: Array<{
      tester: string;
      cycleNumber: number;
      periods: Array<{
        start: string;
        end: string;
        durationHours: number;
      }>;
      merged: boolean;
      mergeReason?: string;
      iterationsCounted: number;
      closingStatus: string;
    }>;
  };
  fixRequiredReturns: Array<{
    sourceState: string;
    timestamp: string;
    changedBy: string | null;
    category: 'codeReview' | 'devTesting' | 'stgTesting' | 'other';
    attributedTo: string;
  }>;
  finalContribution: {
    devActiveTimeHours: number;
    devTestTimeHours: number;
    stgTestTimeHours: number;
    codeReviewReturns: number;
    devTestingReturns: number;
    stgTestingReturns: number;
    totalReturns: number;
    itemCompleted: boolean;
    attributedDeveloper: string;
    attributedTesters: string[];
  };
}

function emitDomainDebugLog(log: DomainDebugLog, jobId: string) {
  console.log(`[DomainDebug] ${JSON.stringify({ jobId, ...log })}`);
}

// ============== Azure DevOps API ==============

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
    const { organization, project, queryId, pat, debug: requestDebug = false } = await req.json() as AnalysisRequest;

    if (!organization || !project || !queryId || !pat) {
      throw new Error('Missing required fields: organization, project, queryId, pat');
    }

    // Fetch work item IDs from Azure DevOps
    const workItemIds = await executeQuery(organization, project, queryId, pat);
    
    // Determine debug mode: verbose for small queries, aggregated for large
    const isVerboseDebug = workItemIds.length <= DEBUG_THRESHOLD;
    const debugMode = requestDebug || isVerboseDebug ? (isVerboseDebug ? 'verbose' : 'aggregated') : 'none';
    
    console.log(`[Job Init] Starting analysis for ${organization}/${project} (${workItemIds.length} items) [DEBUG: ${debugMode}]`);

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
    EdgeRuntime.waitUntil(processJob(supabase, jobId, organization, project, pat, workItemIds, debugMode));

    return new Response(JSON.stringify({
      jobId,
      status: 'processing',
      totalItems: workItemIds.length,
      totalChunks,
      debugMode,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[Job Init] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Background processing function with proper error handling
async function processJob(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  organization: string,
  project: string,
  pat: string,
  workItemIds: number[],
  debugMode: 'verbose' | 'aggregated' | 'none'
) {
  const isVerbose = debugMode === 'verbose';
  const debugLogs: DebugOutput = { workItems: {}, prComments: [] };

  try {
    console.log(`[Job ${jobId}] Starting background processing [DEBUG: ${debugMode}]`);

    // Stage 1: Fetch all work items with relations (batched)
    const fetchStage = startStage(jobId, 'fetch_work_items');
    await updateJobStatus(supabase, jobId, 'Fetching work items...');
    const workItems = await fetchWorkItemsBatched(organization, project, workItemIds, pat);
    fetchStage.counts = { workItems: workItems.length };
    logStageTelemetry(fetchStage);
    console.log(`[Job ${jobId}] Fetched ${workItems.length} work items`);

    // Stage 2: Process work items in chunks with parallel concurrency
    const chunks = chunkArray(workItems, CHUNK_SIZE);
    const allChunkResults: ChunkResult[] = [];
    let processedChunks = 0;

    // Aggregated telemetry counters for entire job (logged at end)
    let jobTotalPRs = 0;
    let jobTotalComments = 0;
    let jobTotalCommentsFetched = 0;
    let jobTotalCommentsAggregated = 0;
    let jobTotalApiCalls = 0;
    const jobUniqueAuthors = new Set<string>();

    // Process chunks in parallel batches with concurrency limit
    for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
      const chunkBatch = chunks.slice(i, Math.min(i + CHUNK_CONCURRENCY, chunks.length));
      const batchEndIdx = Math.min(i + CHUNK_CONCURRENCY, chunks.length);
      
      await updateJobStatus(
        supabase, 
        jobId, 
        `Processing chunks ${i + 1}-${batchEndIdx}/${chunks.length}`,
        Math.round((processedChunks / chunks.length) * 70)
      );
      
      const chunkProcessStage = startStage(jobId, 'process_chunk_batch');
      chunkProcessStage.counts = { batchStart: i + 1, batchEnd: batchEndIdx, totalChunks: chunks.length };

      // Process chunk batch in parallel - including PR comments per chunk
      const batchResults = await Promise.all(
        chunkBatch.map((chunk, idx) => 
          processWorkItemChunkWithPRs(organization, project, pat, chunk, isVerbose, debugLogs, jobId, i + idx)
        )
      );

      allChunkResults.push(...batchResults);
      processedChunks += chunkBatch.length;

      // Aggregate chunk stats for telemetry - EXTENDED counters
      let batchCommentsFetched = 0;
      let batchCommentsAggregated = 0;
      let batchApiCalls = 0;
      let maxChunkSize = 0;
      let maxCommentsInChunk = 0;
      let batchPRs = 0;
      let batchComments = 0;

      for (const result of batchResults) {
        batchPRs += result.prStats?.prs || 0;
        batchComments += result.prStats?.comments || 0;
        batchCommentsFetched += result.prStats?.commentsFetched || 0;
        batchCommentsAggregated += result.prStats?.commentsAggregated || 0;
        batchApiCalls += result.prStats?.apiCalls || 0;
        
        // Track max chunk size for memory pressure detection
        const chunkWorkItems = result.devAgg ? Object.values(result.devAgg).reduce((sum, d) => sum + d.items.length, 0) : 0;
        if (chunkWorkItems > maxChunkSize) maxChunkSize = chunkWorkItems;
        
        const chunkComments = result.prStats?.commentsFetched || 0;
        if (chunkComments > maxCommentsInChunk) maxCommentsInChunk = chunkComments;
        
        // Collect unique authors from PR aggregates
        for (const author of Object.keys(result.prAgg)) {
          jobUniqueAuthors.add(author);
        }
      }

      // Update job-level totals
      jobTotalPRs += batchPRs;
      jobTotalComments += batchComments;
      jobTotalCommentsFetched += batchCommentsFetched;
      jobTotalCommentsAggregated += batchCommentsAggregated;
      jobTotalApiCalls += batchApiCalls;

      chunkProcessStage.counts.prsProcessed = batchPRs;
      chunkProcessStage.counts.commentsProcessed = batchComments;
      chunkProcessStage.counts.commentsFetched = batchCommentsFetched;
      chunkProcessStage.counts.commentsAggregated = batchCommentsAggregated;
      chunkProcessStage.counts.apiCalls = batchApiCalls;
      logStageTelemetry(chunkProcessStage);
      
      // Memory-safety telemetry (cheap, always log)
      console.log(`[Telemetry] ${JSON.stringify({
        jobId,
        stage: 'chunk_batch_memory',
        maxChunkSize,
        totalCommentsInChunk: maxCommentsInChunk,
        batchApiCalls,
        chunksInBatch: chunkBatch.length,
      })}`);

      // Save chunk results to database for recovery - with explicit error handling
      const persistStage = startStage(jobId, 'persist_chunks');
      for (let j = 0; j < batchResults.length; j++) {
        const chunkData = {
          job_id: jobId,
          chunk_index: i + j,
          chunk_type: 'work_items_with_prs',
          data: batchResults[j],
        };
        
        const { error: insertError } = await (supabase.from('analysis_chunks') as any).insert(chunkData);
        
        if (insertError) {
          console.error(`[Job ${jobId}] Failed to persist chunk ${i + j}:`, insertError);
          throw new Error(`Failed to persist chunk ${i + j}: ${insertError.message}`);
        }
      }
      persistStage.counts = { chunksStored: batchResults.length };
      logStageTelemetry(persistStage);
    }

    // Log final job-level PR telemetry summary
    console.log(`[Telemetry] ${JSON.stringify({
      jobId,
      stage: 'pr_processing_summary',
      totalPRs: jobTotalPRs,
      totalComments: jobTotalComments,
      commentsFetched: jobTotalCommentsFetched,
      commentsAggregated: jobTotalCommentsAggregated,
      uniqueAuthors: jobUniqueAuthors.size,
      totalApiCalls: jobTotalApiCalls,
    })}`);

    // Stage 3: Merge all results (numeric summation only)
    const mergeStage = startStage(jobId, 'merge_chunks');
    await updateJobStatus(supabase, jobId, 'Merging results...', 90);
    const finalResult = mergeChunkResultsNumeric(allChunkResults, workItems);
    mergeStage.counts = { chunksProcessed: allChunkResults.length };
    logStageTelemetry(mergeStage);
    
    // Add debug logs if verbose mode enabled
    if (isVerbose) {
      (finalResult as any).debugLogs = debugLogs;
      console.log(`[Job ${jobId}] Debug logs: ${Object.keys(debugLogs.workItems).length} work items, ${debugLogs.prComments.length} PR comments`);
    }
    
    console.log(`[Job ${jobId}] Merged ${allChunkResults.length} chunks`);

    // Stage 4: Save final result
    const persistResultStage = startStage(jobId, 'persist_result');
    const completedUpdate = {
      status: 'completed',
      processed_items: workItemIds.length,
      current_step: 'Complete',
      result: finalResult,
    };
    
    const { error: updateError } = await (supabase.from('analysis_jobs') as any)
      .update(completedUpdate)
      .eq('id', jobId);
    
    if (updateError) {
      throw new Error(`Failed to persist final result: ${updateError.message}`);
    }
    
    persistResultStage.counts = { success: 1 };
    logStageTelemetry(persistResultStage);

    console.log(`[Job ${jobId}] Completed successfully`);

  } catch (error) {
    console.error(`[Job ${jobId}] Failed:`, error);
    
    // Ensure we always update job status on failure
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const failedUpdate = {
      status: 'failed',
      error_message: errorMessage,
      current_step: 'Failed',
    };
    
    try {
      await (supabase.from('analysis_jobs') as any).update(failedUpdate).eq('id', jobId);
    } catch (updateErr) {
      console.error(`[Job ${jobId}] Failed to update job status:`, updateErr);
    }
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
    const result = await azureRequest(url, pat) as { value: WorkItem[] };
    allItems.push(...result.value);
  }

  return allItems;
}

async function getWorkItemRevisions(org: string, project: string, workItemId: number, pat: string): Promise<WorkItemRevision[]> {
  const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workitems/${workItemId}/revisions?api-version=7.1`;
  const result = await azureRequest(url, pat) as { value: WorkItemRevision[] };
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
  authors: string[];
}

interface ChunkResult {
  devAgg: Record<string, DevAggData>;
  testerAgg: Record<string, TesterAggData>;
  prAgg: Record<string, { count: number; prs: PRReference[] }>;
  testers: string[];
  unassignedItems: WorkItemReference[];
  totalDevHours: number;
  totalDevTestHours: number;
  totalStgTestHours: number;
  requirements: number;
  bugs: number;
  tasks: number;
  prStats?: { 
    prs: number; 
    comments: number;
    commentsFetched: number;
    commentsAggregated: number;
    uniqueCommentAuthors: number;
    apiCalls: number;
  };
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

// ============== Debug Logging Structures ==============

interface DebugOutput {
  workItems: Record<number, WorkItemDebugLog>;
  prComments: PRCommentDebugLog[];
}

interface WorkItemDebugLog {
  workItemId: number;
  title: string;
  currentAssignedTo: string;
  assignedToHistory: string[];
  activePeriods: Array<{
    start: string;
    end: string | null;
    durationHours: number;
  }>;
  devTestingCycles: Array<{
    tester: string;
    periods: Array<{ start: string; end: string; durationHours: number }>;
    merged: boolean;
    closingStatus: string;
  }>;
  stgTestingCycles: Array<{
    tester: string;
    periods: Array<{ start: string; end: string; durationHours: number }>;
    merged: boolean;
    closingStatus: string;
  }>;
  fixRequiredReturns: Array<{
    sourceState: string;
    timestamp: string;
    changedBy: string | null;
  }>;
  transitions: Array<{
    from: string;
    to: string;
    timestamp: string;
    changedBy: string | null;
    assignedTo: string | null;
  }>;
}

interface PRCommentDebugLog {
  workItemId: number;
  prId: string;
  prUrl: string;
  commentId: string;
  author: string;
  counted: boolean;
  reason: string;
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
function getCurrentAssignedTo(wi: WorkItem, history: string[]): { name: string; fallbackUsed: boolean } {
  const current = getDisplayName(wi.fields['System.AssignedTo']);
  if (current) return { name: current, fallbackUsed: false };
  if (history.length > 0) return { name: history[history.length - 1], fallbackUsed: true };
  return { name: 'Unassigned', fallbackUsed: true };
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

interface ActivePeriod {
  start: Date;
  end: Date | null;
  durationHours: number;
  included: boolean;
  exclusionReason?: string;
}

function calculateDevelopmentTime(transitions: TransitionEvent[]): { totalHours: number; cycles: number; activePeriods: ActivePeriod[]; stoppedAtFirstDevAcceptance: boolean } {
  let totalHours = 0;
  let cycles = 0;
  let activeStart: Date | null = null;
  const activePeriods: ActivePeriod[] = [];
  let stoppedAtFirstDevAcceptance = false;

  for (const t of transitions) {
    // Stop counting at first DEV_Acceptance Testing transition (business rule)
    if (t.toState === STATES.DEV_ACCEPTANCE_TESTING) {
      if (activeStart) {
        const duration = (t.timestamp.getTime() - activeStart.getTime()) / 3600000;
        totalHours += duration;
        cycles++;
        activePeriods.push({ start: activeStart, end: t.timestamp, durationHours: duration, included: true });
        activeStart = null;
      }
      stoppedAtFirstDevAcceptance = true;
      return { totalHours, cycles, activePeriods, stoppedAtFirstDevAcceptance };
    }
    if (t.toState === STATES.ACTIVE) {
      activeStart = t.timestamp;
    } else if (t.fromState === STATES.ACTIVE && activeStart) {
      const duration = (t.timestamp.getTime() - activeStart.getTime()) / 3600000;
      totalHours += duration;
      cycles++;
      activePeriods.push({ start: activeStart, end: t.timestamp, durationHours: duration, included: true });
      activeStart = null;
    }
  }
  
  // Handle case where still in Active state
  if (activeStart) {
    activePeriods.push({ start: activeStart, end: null, durationHours: 0, included: false, exclusionReason: 'Still in Active state' });
  }
  
  return { totalHours, cycles, activePeriods, stoppedAtFirstDevAcceptance };
}

interface FixRequiredReturn {
  sourceState: string;
  timestamp: Date;
  changedBy: string | null;
  category: 'codeReview' | 'devTesting' | 'stgTesting' | 'other';
}

function countReturns(transitions: TransitionEvent[]): { cr: number; dev: number; stg: number; returns: FixRequiredReturn[] } {
  let cr = 0, dev = 0, stg = 0;
  const returns: FixRequiredReturn[] = [];
  
  for (const t of transitions) {
    if (t.toState === STATES.FIX_REQUIRED) {
      let category: 'codeReview' | 'devTesting' | 'stgTesting' | 'other' = 'other';
      if (t.fromState === STATES.CODE_REVIEW) {
        cr++;
        category = 'codeReview';
      } else if (t.fromState === STATES.DEV_IN_TESTING || t.fromState === STATES.DEV_ACCEPTANCE_TESTING) {
        dev++;
        category = 'devTesting';
      } else if (t.fromState === STATES.STG_IN_TESTING || t.fromState === STATES.STG_ACCEPTANCE_TESTING) {
        stg++;
        category = 'stgTesting';
      }
      returns.push({
        sourceState: t.fromState,
        timestamp: t.timestamp,
        changedBy: t.changedBy,
        category,
      });
    }
  }
  return { cr, dev, stg, returns };
}

interface TestingCycleDetail {
  tester: string;
  cycleNumber: number;
  periods: Array<{ start: Date; end: Date; durationHours: number }>;
  merged: boolean;
  mergeReason?: string;
  iterationsCounted: number;
  closingStatus: string;
}

function calculateTestingMetricsWithDetails(
  transitions: TransitionEvent[],
  inTestingState: string,
  acceptanceState: string
): { metrics: Map<string, { hours: number; cycles: number; iterations: number }>; cycles: TestingCycleDetail[] } {
  const metrics = new Map<string, { hours: number; cycles: number; iterations: number }>();
  const cycles: TestingCycleDetail[] = [];
  let cycle: { tester: string; start: Date; periods: Array<{ start: Date; end: Date; durationHours: number }>; pendingMerge: boolean; lastState: string; cycleNumber: number } | null = null;
  let cycleCounter = 0;

  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];

    if (t.toState === inTestingState) {
      const tester = t.changedBy || t.assignedTo || 'Unknown';

      if (cycle?.pendingMerge && t.fromState === acceptanceState && cycle.tester === tester) {
        // Merge: same tester moving back from acceptance to testing
        cycle.pendingMerge = false;
      } else {
        if (cycle) {
          const hours = cycle.periods.reduce((a, b) => a + b.durationHours, 0);
          if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { hours: 0, cycles: 0, iterations: 0 });
          const m = metrics.get(cycle.tester)!;
          m.hours += hours;
          m.cycles++;
          m.iterations++;
          cycles.push({ 
            tester: cycle.tester, 
            cycleNumber: cycle.cycleNumber,
            periods: cycle.periods, 
            merged: cycle.pendingMerge, 
            mergeReason: cycle.pendingMerge ? 'Pending merge not completed' : undefined,
            iterationsCounted: 1,
            closingStatus: cycle.lastState 
          });
        }
        cycleCounter++;
        cycle = { tester, start: t.timestamp, periods: [], pendingMerge: false, lastState: inTestingState, cycleNumber: cycleCounter };
      }
    } else if (t.fromState === inTestingState && cycle) {
      const durationHours = (t.timestamp.getTime() - cycle.start.getTime()) / 3600000;
      cycle.periods.push({ start: cycle.start, end: t.timestamp, durationHours });
      cycle.lastState = t.toState;

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
          const totalHours = cycle.periods.reduce((a, b) => a + b.durationHours, 0);
          if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { hours: 0, cycles: 0, iterations: 0 });
          const m = metrics.get(cycle.tester)!;
          m.hours += totalHours;
          m.cycles++;
          m.iterations++;
          cycles.push({ 
            tester: cycle.tester, 
            cycleNumber: cycle.cycleNumber,
            periods: cycle.periods, 
            merged: false, 
            iterationsCounted: 1,
            closingStatus: t.toState 
          });
          cycle = null;
        }
      } else {
        const totalHours = cycle.periods.reduce((a, b) => a + b.durationHours, 0);
        if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { hours: 0, cycles: 0, iterations: 0 });
        const m = metrics.get(cycle.tester)!;
        m.hours += totalHours;
        m.cycles++;
        m.iterations++;
        cycles.push({ 
          tester: cycle.tester, 
          cycleNumber: cycle.cycleNumber,
          periods: cycle.periods, 
          merged: false, 
          iterationsCounted: 1,
          closingStatus: t.toState 
        });
        cycle = null;
      }
    } else if (cycle?.pendingMerge && t.fromState === acceptanceState && t.toState !== inTestingState) {
      const totalHours = cycle.periods.reduce((a, b) => a + b.durationHours, 0);
      if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { hours: 0, cycles: 0, iterations: 0 });
      const m = metrics.get(cycle.tester)!;
      m.hours += totalHours;
      m.cycles++;
      m.iterations++;
      cycles.push({ 
        tester: cycle.tester, 
        cycleNumber: cycle.cycleNumber,
        periods: cycle.periods, 
        merged: true, 
        mergeReason: 'Same tester In Testing → Acceptance → In Testing merged',
        iterationsCounted: 1,
        closingStatus: t.toState 
      });
      cycle = null;
    }
  }

  if (cycle) {
    const totalHours = cycle.periods.reduce((a, b) => a + b.durationHours, 0);
    if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { hours: 0, cycles: 0, iterations: 0 });
    const m = metrics.get(cycle.tester)!;
    m.hours += totalHours;
    m.cycles++;
    cycles.push({ 
      tester: cycle.tester, 
      cycleNumber: cycle.cycleNumber,
      periods: cycle.periods, 
      merged: cycle.pendingMerge, 
      mergeReason: cycle.pendingMerge ? 'Cycle ended with pending merge' : undefined,
      iterationsCounted: 1,
      closingStatus: 'In Progress' 
    });
  }

  return { metrics, cycles };
}

// ============== Chunk Processing with PR Comments ==============

async function processWorkItemChunkWithPRs(
  org: string,
  project: string,
  pat: string,
  workItems: WorkItem[],
  isVerbose: boolean,
  debugLogs: DebugOutput,
  jobId: string,
  chunkIndex: number
): Promise<ChunkResult> {
  const devAgg: Record<string, DevAggData> = {};
  const testerAgg: Record<string, TesterAggData> = {};
  const prAgg: Record<string, { count: number; prs: PRReference[] }> = {};
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
  const REVISION_BATCH = 20;
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
      const { name: assignedTo, fallbackUsed } = getCurrentAssignedTo(wi, history);
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
      const returnsData = countReturns(transitions);
      da.cr += returnsData.cr;
      da.dev += returnsData.dev;
      da.stg += returnsData.stg;

      const totalRet = returnsData.cr + returnsData.dev + returnsData.stg;
      if (totalRet > 0) da.returns.push({ ...ref, count: totalRet });
      if (returnsData.cr > 0) da.crReturns.push({ ...ref, count: returnsData.cr });
      if (returnsData.dev > 0) da.devReturns.push({ ...ref, count: returnsData.dev });
      if (returnsData.stg > 0) da.stgReturns.push({ ...ref, count: returnsData.stg });

      if (state === STATES.RELEASED) da.completed++;

      // DEV Testing with details for debug
      const devTestResult = calculateTestingMetricsWithDetails(transitions, STATES.DEV_IN_TESTING, STATES.DEV_ACCEPTANCE_TESTING);
      const attributedDevTesters: string[] = [];
      for (const [tester, data] of devTestResult.metrics) {
        attributedDevTesters.push(tester);
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

      // STG Testing with details for debug
      const stgTestResult = calculateTestingMetricsWithDetails(transitions, STATES.STG_IN_TESTING, STATES.STG_ACCEPTANCE_TESTING);
      const attributedStgTesters: string[] = [];
      for (const [tester, data] of stgTestResult.metrics) {
        attributedStgTesters.push(tester);
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

      // VERBOSE DOMAIN DEBUG: Emit structured log per work item (only for small queries ≤20)
      if (isVerbose) {
        const domainLog: DomainDebugLog = {
          workItemId: wi.id,
          title,
          type,
          currentState: state,
          attribution: {
            currentAssignedTo: assignedTo,
            fallbackUsed,
            assignedToHistory: history,
          },
          stateTransitions: transitions.map(t => ({
            fromState: t.fromState,
            toState: t.toState,
            enteredAt: t.timestamp.toISOString(),
            leftAt: t.timestamp.toISOString(), // Same as enteredAt for transition event
            durationHours: 0, // Transitions are point-in-time
            changedBy: t.changedBy,
            assignedToAtTransition: t.assignedTo,
          })),
          developmentTime: {
            activePeriods: devTime.activePeriods.map(p => ({
              start: p.start.toISOString(),
              end: p.end?.toISOString() || null,
              durationHours: Math.round(p.durationHours * 1000) / 1000,
              included: p.included,
              exclusionReason: p.exclusionReason,
            })),
            totalActiveHours: Math.round(devTime.totalHours * 1000) / 1000,
            developmentCycles: devTime.cycles,
            stoppedAtFirstDevAcceptance: devTime.stoppedAtFirstDevAcceptance,
          },
          testingCycles: {
            dev: devTestResult.cycles.map(c => ({
              tester: c.tester,
              cycleNumber: c.cycleNumber,
              periods: c.periods.map(p => ({
                start: p.start.toISOString(),
                end: p.end.toISOString(),
                durationHours: Math.round(p.durationHours * 1000) / 1000,
              })),
              merged: c.merged,
              mergeReason: c.mergeReason,
              iterationsCounted: c.iterationsCounted,
              closingStatus: c.closingStatus,
            })),
            stg: stgTestResult.cycles.map(c => ({
              tester: c.tester,
              cycleNumber: c.cycleNumber,
              periods: c.periods.map(p => ({
                start: p.start.toISOString(),
                end: p.end.toISOString(),
                durationHours: Math.round(p.durationHours * 1000) / 1000,
              })),
              merged: c.merged,
              mergeReason: c.mergeReason,
              iterationsCounted: c.iterationsCounted,
              closingStatus: c.closingStatus,
            })),
          },
          fixRequiredReturns: returnsData.returns.map(r => ({
            sourceState: r.sourceState,
            timestamp: r.timestamp.toISOString(),
            changedBy: r.changedBy,
            category: r.category,
            attributedTo: assignedTo,
          })),
          finalContribution: {
            devActiveTimeHours: Math.round(devTime.totalHours * 1000) / 1000,
            devTestTimeHours: Math.round([...devTestResult.metrics.values()].reduce((s, d) => s + d.hours, 0) * 1000) / 1000,
            stgTestTimeHours: Math.round([...stgTestResult.metrics.values()].reduce((s, d) => s + d.hours, 0) * 1000) / 1000,
            codeReviewReturns: returnsData.cr,
            devTestingReturns: returnsData.dev,
            stgTestingReturns: returnsData.stg,
            totalReturns: totalRet,
            itemCompleted: state === STATES.RELEASED,
            attributedDeveloper: assignedTo,
            attributedTesters: [...new Set([...attributedDevTesters, ...attributedStgTesters])],
          },
        };
        
        emitDomainDebugLog(domainLog, jobId);

        // Also store in debugLogs for response (legacy format)
        debugLogs.workItems[wi.id] = {
          workItemId: wi.id,
          title,
          currentAssignedTo: assignedTo,
          assignedToHistory: history,
          activePeriods: devTime.activePeriods.map(p => ({
            start: p.start.toISOString(),
            end: p.end?.toISOString() || null,
            durationHours: Math.round(p.durationHours * 100) / 100,
          })),
          devTestingCycles: devTestResult.cycles.map(c => ({
            tester: c.tester,
            periods: c.periods.map(p => ({
              start: p.start.toISOString(),
              end: p.end.toISOString(),
              durationHours: Math.round(p.durationHours * 100) / 100,
            })),
            merged: c.merged,
            closingStatus: c.closingStatus,
          })),
          stgTestingCycles: stgTestResult.cycles.map(c => ({
            tester: c.tester,
            periods: c.periods.map(p => ({
              start: p.start.toISOString(),
              end: p.end.toISOString(),
              durationHours: Math.round(p.durationHours * 100) / 100,
            })),
            merged: c.merged,
            closingStatus: c.closingStatus,
          })),
          fixRequiredReturns: returnsData.returns.map(r => ({
            sourceState: r.sourceState,
            timestamp: r.timestamp.toISOString(),
            changedBy: r.changedBy,
          })),
          transitions: transitions.map(t => ({
            from: t.fromState,
            to: t.toState,
            timestamp: t.timestamp.toISOString(),
            changedBy: t.changedBy,
            assignedTo: t.assignedTo,
          })),
        };
      }
    }
  }

  // Process PR comments for this chunk's work items
  const prResult = await processPRCommentsForChunk(org, project, pat, workItems, isVerbose, debugLogs, jobId);
  for (const [author, data] of Object.entries(prResult.aggregates)) {
    if (!prAgg[author]) prAgg[author] = { count: 0, prs: [] };
    prAgg[author].count += data.count;
    prAgg[author].prs.push(...data.prs);
  }

  return { 
    devAgg, 
    testerAgg, 
    prAgg, 
    testers, 
    unassignedItems, 
    totalDevHours, 
    totalDevTestHours, 
    totalStgTestHours, 
    requirements, 
    bugs, 
    tasks,
    prStats: prResult.stats,
  };
}

// ============== PR Comments Processing Per Chunk ==============

interface PRProcessResult {
  aggregates: Record<string, { count: number; prs: PRReference[] }>;
  stats: { 
    prs: number; 
    comments: number;
    commentsFetched: number;
    commentsAggregated: number;
    uniqueCommentAuthors: number;
    apiCalls: number;
  };
}

async function processPRCommentsForChunk(
  org: string,
  project: string,
  pat: string,
  workItems: WorkItem[],
  isVerbose: boolean,
  debugLogs: DebugOutput,
  jobId: string
): Promise<PRProcessResult> {
  const prAgg: Record<string, { count: number; prs: PRReference[] }> = {};
  let totalPRs = 0;
  let totalComments = 0;
  let totalCommentsFetched = 0;
  let totalCommentsAggregated = 0;
  let totalApiCalls = 0;
  const allAuthors = new Set<string>();

  // Stage-level telemetry for PR fetching
  const prFetchStage = startStage(jobId, 'fetch_pr_comments');

  // Process work items in small batches for PR comments
  const PR_BATCH = 15;
  for (let i = 0; i < workItems.length; i += PR_BATCH) {
    const batch = workItems.slice(i, i + PR_BATCH);
    const prResults = await Promise.all(
      batch.map(wi => getPRCommentsForItem(org, project, wi, pat, isVerbose, debugLogs))
    );

    for (const result of prResults) {
      totalPRs += result.prCount;
      totalComments += result.commentCount;
      totalCommentsFetched += result.commentsFetched;
      totalCommentsAggregated += result.commentsAggregated;
      totalApiCalls += result.apiCalls;
      
      for (const [author, data] of Object.entries(result.aggregates)) {
        allAuthors.add(author);
        if (!prAgg[author]) prAgg[author] = { count: 0, prs: [] };
        prAgg[author].count += data.count;
        prAgg[author].prs.push(...data.prs);
      }
    }
  }

  // Log stage telemetry for PR fetching (aggregate only)
  prFetchStage.counts = {
    prsFetched: totalPRs,
    apiCalls: totalApiCalls,
    commentsFetched: totalCommentsFetched,
  };
  logStageTelemetry(prFetchStage);

  return { 
    aggregates: prAgg, 
    stats: { 
      prs: totalPRs, 
      comments: totalComments,
      commentsFetched: totalCommentsFetched,
      commentsAggregated: totalCommentsAggregated,
      uniqueCommentAuthors: allAuthors.size,
      apiCalls: totalApiCalls,
    } 
  };
}

interface PRItemResult {
  aggregates: Record<string, { count: number; prs: PRReference[] }>;
  prCount: number;
  commentCount: number;
  commentsFetched: number;
  commentsAggregated: number;
  apiCalls: number;
}

async function getPRCommentsForItem(
  org: string,
  project: string,
  workItem: WorkItem,
  pat: string,
  isVerbose: boolean,
  debugLogs: DebugOutput
): Promise<PRItemResult> {
  const result: Record<string, { count: number; prs: PRReference[] }> = {};
  let prCount = 0;
  let commentCount = 0;
  let commentsFetched = 0;
  let commentsAggregated = 0;
  let apiCalls = 0;

  const prLinks = workItem.relations?.filter(r => r.rel === 'ArtifactLink' && r.attributes?.name === 'Pull Request') || [];
  const title = workItem.fields['System.Title'] as string;

  for (const link of prLinks) {
    const vstfsMatch = link.url.match(/vstfs:\/\/\/Git\/PullRequestId\/([^%]+)%2F([^%]+)%2F(\d+)/);
    if (!vstfsMatch) continue;

    const [, projectId, repoId, prIdStr] = vstfsMatch;
    const prId = prIdStr;
    prCount++;

    try {
      // API call to get PR details
      apiCalls++;
      const pr = await azureRequest(
        `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}?api-version=7.1`,
        pat
      ) as { pullRequestId: number; repository: { webUrl: string } };

      const prUrl = `${pr.repository.webUrl}/pullrequest/${pr.pullRequestId}`;

      // API call to get threads
      apiCalls++;
      const threadsResponse = await azureRequest(
        `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}/threads?api-version=7.1`,
        pat
      ) as { value: Array<{ id: number; comments: Array<{ id: number; author: { displayName: string }; commentType: string }> }> };

      const prAuthors = new Set<string>();

      for (const thread of threadsResponse.value || []) {
        if (!thread.comments?.length) continue;
        const firstComment = thread.comments[0];
        commentsFetched++;
        
        const author = firstComment.author?.displayName || 'Unknown';
        const isText = firstComment.commentType === 'text';

        // VERBOSE debug logging (only for small queries)
        if (isVerbose) {
          debugLogs.prComments.push({
            workItemId: workItem.id,
            prId,
            prUrl,
            commentId: `${thread.id}-${firstComment.id}`,
            author,
            counted: isText,
            reason: isText ? 'First comment in thread with text type' : `Excluded: commentType=${firstComment.commentType}`,
          });
        }

        if (isText) {
          prAuthors.add(author);
          commentCount++;
          commentsAggregated++;

          if (!result[author]) result[author] = { count: 0, prs: [] };
          const data = result[author];
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

  return { aggregates: result, prCount, commentCount, commentsFetched, commentsAggregated, apiCalls };
}

// ============== Result Merging (Numeric Summation Only) ==============

function mergeChunkResultsNumeric(
  chunks: ChunkResult[],
  workItems: WorkItem[]
): unknown {
  const mergedDevAgg: Record<string, DevAggData> = {};
  const mergedTesterAgg: Record<string, TesterAggData> = {};
  const mergedPrAgg: Record<string, { count: number; prs: PRReference[] }> = {};
  const allTesters = new Set<string>();
  const unassignedItems: WorkItemReference[] = [];
  let totalDevHours = 0, totalDevTestHours = 0, totalStgTestHours = 0;
  let requirements = 0, bugs = 0, tasks = 0;

  // Merge all chunks with numeric summation
  for (const chunk of chunks) {
    requirements += chunk.requirements;
    bugs += chunk.bugs;
    tasks += chunk.tasks;
    totalDevHours += chunk.totalDevHours;
    totalDevTestHours += chunk.totalDevTestHours;
    totalStgTestHours += chunk.totalStgTestHours;
    unassignedItems.push(...chunk.unassignedItems);

    for (const t of chunk.testers) allTesters.add(t);

    // Merge dev aggregates (numeric summation)
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

    // Merge tester aggregates (numeric summation)
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

    // Merge PR aggregates (numeric summation - already processed per chunk)
    for (const [author, data] of Object.entries(chunk.prAgg)) {
      if (!mergedPrAgg[author]) mergedPrAgg[author] = { count: 0, prs: [] };
      mergedPrAgg[author].count += data.count;
      mergedPrAgg[author].prs.push(...data.prs);
    }
  }

  // Add PR comments to tester data
  for (const [author, data] of Object.entries(mergedPrAgg)) {
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
    const prCount = t.prsReviewed || (mergedPrAgg[tester]?.prs.length || 0);
    const commentCount = mergedPrAgg[tester]?.count || 0;

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

  const prCommentAuthors = Object.entries(mergedPrAgg).map(([author, p]) => ({
    author,
    count: p.count,
    isTester: allTesters.has(author),
    prDetails: p.prs,
  })).sort((a, b) => b.count - a.count);

  const totalReturns = developerMetrics.reduce((s, d) => s + d.totalReturnCount, 0);
  const totalPrComments = Object.values(mergedPrAgg).reduce((s, p) => s + p.count, 0);

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

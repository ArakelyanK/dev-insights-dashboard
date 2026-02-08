// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CHUNK_SIZE = 50;
const DEBUG_THRESHOLD = 20;
const STALL_TIMEOUT_MS = 5 * 60 * 1000;

// ============== Working Time Calculation ==============
// Inline to avoid import issues in edge functions

const UTC_PLUS_3_OFFSET_MS = 3 * 60 * 60 * 1000;
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;

const FIXED_HOLIDAYS = new Set([
  "12-31", "01-01", "01-02", "01-03", "01-04", "01-05", "01-06", "01-07", "01-08",
  "02-23", "03-08", "05-01", "05-09", "06-12", "11-04",
]);

function toMoscowTime(utcDate: Date): Date {
  return new Date(utcDate.getTime() + UTC_PLUS_3_OFFSET_MS);
}

function isWeekend(moscowDate: Date): boolean {
  const day = moscowDate.getUTCDay();
  return day === 0 || day === 6;
}

function isHoliday(moscowDate: Date): boolean {
  const month = String(moscowDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(moscowDate.getUTCDate()).padStart(2, '0');
  return FIXED_HOLIDAYS.has(`${month}-${day}`);
}

function isNonWorkingDay(moscowDate: Date): boolean {
  return isWeekend(moscowDate) || isHoliday(moscowDate);
}

function getWorkDayStart(moscowDate: Date): Date | null {
  if (isNonWorkingDay(moscowDate)) return null;
  const result = new Date(moscowDate);
  result.setUTCHours(WORK_START_HOUR, 0, 0, 0);
  return result;
}

function getWorkDayEnd(moscowDate: Date): Date | null {
  if (isNonWorkingDay(moscowDate)) return null;
  const result = new Date(moscowDate);
  result.setUTCHours(WORK_END_HOUR, 0, 0, 0);
  return result;
}

function getNextDay(moscowDate: Date): Date {
  const result = new Date(moscowDate);
  result.setUTCDate(result.getUTCDate() + 1);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function calculateWorkingTime(startUtc: Date, endUtc: Date): number {
  if (endUtc <= startUtc) return 0;
  
  const startMoscow = toMoscowTime(startUtc);
  const endMoscow = toMoscowTime(endUtc);
  
  let totalHours = 0;
  let currentMoscow = new Date(startMoscow);
  
  while (currentMoscow < endMoscow) {
    if (isNonWorkingDay(currentMoscow)) {
      currentMoscow = getNextDay(currentMoscow);
      continue;
    }
    
    const dayStart = getWorkDayStart(currentMoscow)!;
    const dayEnd = getWorkDayEnd(currentMoscow)!;
    
    const effectiveStart = new Date(Math.max(currentMoscow.getTime(), dayStart.getTime()));
    const nextDay = getNextDay(currentMoscow);
    const effectiveEnd = new Date(Math.min(endMoscow.getTime(), dayEnd.getTime(), nextDay.getTime()));
    
    if (effectiveStart < dayEnd && effectiveEnd > dayStart) {
      const clampedStart = new Date(Math.max(effectiveStart.getTime(), dayStart.getTime()));
      const clampedEnd = new Date(Math.min(effectiveEnd.getTime(), dayEnd.getTime()));
      
      if (clampedEnd > clampedStart) {
        const hoursThisDay = (clampedEnd.getTime() - clampedStart.getTime()) / (1000 * 60 * 60);
        totalHours += hoursThisDay;
      }
    }
    
    currentMoscow = nextDay;
  }
  
  return Math.round(totalHours * 10000) / 10000;
}

// ============== Fibonacci sequence for story points ==============
const FIBONACCI_SEQUENCE = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

interface ProcessChunkRequest {
  jobId: string;
  pat: string;
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
  return { jobId, stage, startTime: Date.now(), counts: {} };
}

// ============== Domain Debug Logging ==============

interface DomainDebugLog {
  workItemId: number;
  title: string;
  type: string;
  currentState: string;
  originalEstimate: number | null;
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
    rawDurationHours: number;
    workingDurationHours: number;
    changedBy: string | null;
    assignedToAtTransition: string | null;
  }>;
  developmentTime: {
    activePeriods: Array<{
      start: string;
      end: string | null;
      rawDurationHours: number;
      workingDurationHours: number;
      included: boolean;
      exclusionReason?: string;
    }>;
    totalRawHours: number;
    totalWorkingHours: number;
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
        rawDurationHours: number;
        workingDurationHours: number;
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
        rawDurationHours: number;
        workingDurationHours: number;
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const request = await req.json() as ProcessChunkRequest;
    const { jobId, pat } = request;

    if (!jobId || !pat) {
      throw new Error('Missing required fields: jobId, pat');
    }

    const { data: job, error: loadError } = await (supabase.from('analysis_jobs') as any)
      .select('*')
      .eq('id', jobId)
      .single();

    if (loadError || !job) {
      throw new Error(`Job not found: ${loadError?.message || 'unknown'}`);
    }

    if (job.status === 'completed') {
      return new Response(JSON.stringify({
        jobId,
        status: 'completed',
        message: 'Job already completed',
        result: job.result,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (job.status === 'failed') {
      return new Response(JSON.stringify({
        jobId,
        status: 'failed',
        error: job.error_message,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (job.last_progress_at) {
      const lastProgress = new Date(job.last_progress_at).getTime();
      if (Date.now() - lastProgress > STALL_TIMEOUT_MS) {
        await markJobFailed(supabase as any, jobId, `Job stalled: no progress for ${Math.round((Date.now() - lastProgress) / 60000)} minutes`);
        return new Response(JSON.stringify({
          jobId,
          status: 'failed',
          error: 'Job stalled due to timeout',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    const workItemIds = job.work_item_ids as number[];
    const totalChunks = job.total_chunks as number;
    const completedChunks = job.completed_chunks as number;
    const organization = job.organization as string;
    const project = job.project as string;

    if (completedChunks >= totalChunks) {
      await finalizeJob(supabase as any, jobId, organization, project, pat, workItemIds);
      
      const { data: completedJob } = await (supabase.from('analysis_jobs') as any)
        .select('result')
        .eq('id', jobId)
        .single();

      return new Response(JSON.stringify({
        jobId,
        status: 'completed',
        message: 'All chunks processed, job finalized',
        result: completedJob?.result,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const chunkIndex = completedChunks;
    const isVerbose = workItemIds.length <= DEBUG_THRESHOLD;
    const debugLogs: DebugOutput = { workItems: {}, prComments: [] };

    console.log(`[Job ${jobId}] Processing chunk ${chunkIndex + 1}/${totalChunks}`);

    await updateJobStatus(supabase as any, jobId, `Processing chunk ${chunkIndex + 1}/${totalChunks}...`);

    const chunkStart = chunkIndex * CHUNK_SIZE;
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, workItemIds.length);
    const chunkWorkItemIds = workItemIds.slice(chunkStart, chunkEnd);

    const fetchStage = startStage(jobId, 'fetch_chunk_work_items');
    const workItems = await fetchWorkItemsBatched(organization, project, chunkWorkItemIds, pat);
    fetchStage.counts = { workItems: workItems.length, chunkIndex };
    logStageTelemetry(fetchStage);

    const chunkResult = await processWorkItemChunkWithPRs(
      organization, project, pat, workItems, isVerbose, debugLogs, jobId, chunkIndex
    );

    const persistStage = startStage(jobId, 'persist_chunk');
    const { error: insertError } = await (supabase.from('analysis_chunks') as any).insert({
      job_id: jobId,
      chunk_index: chunkIndex,
      chunk_type: 'work_items_with_prs',
      data: chunkResult,
    });

    if (insertError) {
      throw new Error(`Failed to persist chunk ${chunkIndex}: ${insertError.message}`);
    }
    persistStage.counts = { chunkIndex };
    logStageTelemetry(persistStage);

    console.log(`[Job ${jobId}] Chunk ${chunkIndex + 1}/${totalChunks} persisted`);

    const newCompletedChunks = chunkIndex + 1;
    const newProcessedItems = Math.min(chunkEnd, workItemIds.length);
    const progress = Math.round((newCompletedChunks / totalChunks) * 100);

    await (supabase.from('analysis_jobs') as any)
      .update({
        completed_chunks: newCompletedChunks,
        processed_items: newProcessedItems,
        current_step: `Completed chunk ${newCompletedChunks}/${totalChunks} (${progress}%)`,
        last_progress_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    if (newCompletedChunks >= totalChunks) {
      await finalizeJob(supabase as any, jobId, organization, project, pat, workItemIds);
      
      const { data: completedJob } = await (supabase.from('analysis_jobs') as any)
        .select('result')
        .eq('id', jobId)
        .single();

      return new Response(JSON.stringify({
        jobId,
        status: 'completed',
        completedChunks: newCompletedChunks,
        totalChunks,
        progress: 100,
        message: 'All chunks processed, job finalized',
        result: completedJob?.result,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      jobId,
      status: 'processing',
      completedChunks: newCompletedChunks,
      totalChunks,
      progress,
      message: `Chunk ${newCompletedChunks}/${totalChunks} completed. Continue calling process-chunk.`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[Process Chunk] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============== Finalize Job ==============

async function finalizeJob(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  organization: string,
  project: string,
  pat: string,
  workItemIds: number[]
) {
  try {
    console.log(`[Job ${jobId}] Finalizing - loading and merging all chunks`);
    
    await updateJobStatus(supabase, jobId, 'Merging results...');

    const loadStage = startStage(jobId, 'load_chunks');
    const { data: chunks, error: loadError } = await (supabase.from('analysis_chunks') as any)
      .select('chunk_index, data')
      .eq('job_id', jobId)
      .order('chunk_index', { ascending: true });

    if (loadError) {
      throw new Error(`Failed to load chunks: ${loadError.message}`);
    }

    loadStage.counts = { chunksLoaded: chunks?.length || 0 };
    logStageTelemetry(loadStage);
    console.log(`[Job ${jobId}] Loaded ${chunks?.length || 0} chunks`);

    const workItems = await fetchWorkItemsBatched(organization, project, workItemIds, pat);

    const mergeStage = startStage(jobId, 'merge_chunks');
    const allChunkResults = (chunks || []).map((c: any) => c.data as ChunkResult);
    const finalResult = mergeChunkResultsNumeric(allChunkResults, workItems);
    mergeStage.counts = { chunksProcessed: allChunkResults.length };
    logStageTelemetry(mergeStage);
    
    console.log(`[Job ${jobId}] Merged ${allChunkResults.length} chunks`);

    const persistResultStage = startStage(jobId, 'persist_result');
    const { error: updateError } = await (supabase.from('analysis_jobs') as any)
      .update({
        status: 'completed',
        processed_items: workItemIds.length,
        current_step: 'Complete',
        result: finalResult,
        last_progress_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    
    if (updateError) {
      throw new Error(`Failed to persist final result: ${updateError.message}`);
    }
    
    persistResultStage.counts = { success: 1 };
    logStageTelemetry(persistResultStage);

    console.log(`[Job ${jobId}] Completed successfully`);

  } catch (error) {
    console.error(`[Job ${jobId}] Finalization failed:`, error);
    await markJobFailed(supabase, jobId, error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}

// ============== Helper Functions ==============

async function updateJobStatus(supabase: ReturnType<typeof createClient>, jobId: string, step: string) {
  await (supabase.from('analysis_jobs') as any)
    .update({ 
      current_step: step,
      last_progress_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

async function markJobFailed(supabase: ReturnType<typeof createClient>, jobId: string, errorMessage: string) {
  try {
    console.log(`[Job ${jobId}] Marking as FAILED: ${errorMessage}`);
    await (supabase.from('analysis_jobs') as any)
      .update({
        status: 'failed',
        error_message: errorMessage,
        current_step: 'Failed',
        last_progress_at: new Date().toISOString(),
      })
      .eq('id', jobId);
  } catch (updateErr) {
    console.error(`[Job ${jobId}] Failed to update job status:`, updateErr);
  }
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
  activeTimeHours?: number;
  devTestTimeHours?: number;
  stgTestTimeHours?: number;
  originalEstimate?: number;
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
  // Story points aggregates
  spAgg: StoryPointsAgg;
  // Raw work items for client-side filtering
  workItemsRaw: WorkItemRaw[];
  prStats?: { 
    prs: number; 
    comments: number;
    commentsFetched: number;
    commentsAggregated: number;
    uniqueCommentAuthors: number;
    apiCalls: number;
  };
}

interface StoryPointsAgg {
  totalSp: number;
  itemsWithSp: number;
  itemsWithoutSp: number;
  totalActiveHoursWithSp: number;
  fibonacciData: Record<number, { count: number; totalHours: number }>;
}

interface WorkItemRaw {
  id: number;
  title: string;
  type: string;
  state: string;
  assignedTo: string;
  testedBy1?: string;
  testedBy2?: string;
  originalEstimate?: number;
  activeTimeHours: number;
  devTestTimeHours: number;
  stgTestTimeHours: number;
  stateTransitions: Array<{
    fromState: string;
    toState: string;
    timestamp: string;
    changedBy?: string;
  }>;
}

interface DevAggData {
  hours: number;
  cycles: number;
  cr: number;
  dev: number;
  stg: number;
  completed: number;
  totalSp: number;
  itemsWithSp: number;
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
  totalSp: number;
  itemsWithSp: number;
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
  originalEstimate: number | null;
  activePeriods: Array<{
    start: string;
    end: string | null;
    rawDurationHours: number;
    workingDurationHours: number;
  }>;
  devTestingCycles: Array<{
    tester: string;
    periods: Array<{ start: string; end: string; rawDurationHours: number; workingDurationHours: number }>;
    merged: boolean;
    closingStatus: string;
  }>;
  stgTestingCycles: Array<{
    tester: string;
    periods: Array<{ start: string; end: string; rawDurationHours: number; workingDurationHours: number }>;
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
  rawDurationHours: number;
  workingDurationHours: number;
  included: boolean;
  exclusionReason?: string;
}

function calculateDevelopmentTime(transitions: TransitionEvent[]): { 
  totalRawHours: number; 
  totalWorkingHours: number; 
  cycles: number; 
  activePeriods: ActivePeriod[]; 
  stoppedAtFirstDevAcceptance: boolean 
} {
  let totalRawHours = 0;
  let totalWorkingHours = 0;
  let cycles = 0;
  let activeStart: Date | null = null;
  const activePeriods: ActivePeriod[] = [];
  let stoppedAtFirstDevAcceptance = false;

  for (const t of transitions) {
    if (t.toState === STATES.DEV_ACCEPTANCE_TESTING) {
      if (activeStart) {
        const rawDuration = (t.timestamp.getTime() - activeStart.getTime()) / 3600000;
        const workingDuration = calculateWorkingTime(activeStart, t.timestamp);
        totalRawHours += rawDuration;
        totalWorkingHours += workingDuration;
        cycles++;
        activePeriods.push({ 
          start: activeStart, 
          end: t.timestamp, 
          rawDurationHours: rawDuration,
          workingDurationHours: workingDuration, 
          included: true 
        });
        activeStart = null;
      }
      stoppedAtFirstDevAcceptance = true;
      return { totalRawHours, totalWorkingHours, cycles, activePeriods, stoppedAtFirstDevAcceptance };
    }
    if (t.toState === STATES.ACTIVE) {
      activeStart = t.timestamp;
    } else if (t.fromState === STATES.ACTIVE && activeStart) {
      const rawDuration = (t.timestamp.getTime() - activeStart.getTime()) / 3600000;
      const workingDuration = calculateWorkingTime(activeStart, t.timestamp);
      totalRawHours += rawDuration;
      totalWorkingHours += workingDuration;
      cycles++;
      activePeriods.push({ 
        start: activeStart, 
        end: t.timestamp, 
        rawDurationHours: rawDuration,
        workingDurationHours: workingDuration, 
        included: true 
      });
      activeStart = null;
    }
  }
  
  if (activeStart) {
    activePeriods.push({ 
      start: activeStart, 
      end: null, 
      rawDurationHours: 0,
      workingDurationHours: 0, 
      included: false, 
      exclusionReason: 'Still in Active state' 
    });
  }
  
  return { totalRawHours, totalWorkingHours, cycles, activePeriods, stoppedAtFirstDevAcceptance };
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
  periods: Array<{ start: Date; end: Date; rawDurationHours: number; workingDurationHours: number }>;
  merged: boolean;
  mergeReason?: string;
  iterationsCounted: number;
  closingStatus: string;
}

function calculateTestingMetricsWithDetails(
  transitions: TransitionEvent[],
  inTestingState: string,
  acceptanceState: string
): { 
  metrics: Map<string, { rawHours: number; workingHours: number; cycles: number; iterations: number }>; 
  cycles: TestingCycleDetail[];
  totalRawHours: number;
  totalWorkingHours: number;
} {
  const metrics = new Map<string, { rawHours: number; workingHours: number; cycles: number; iterations: number }>();
  const cycles: TestingCycleDetail[] = [];
  let totalRawHours = 0;
  let totalWorkingHours = 0;
  let cycle: { 
    tester: string; 
    start: Date; 
    periods: Array<{ start: Date; end: Date; rawDurationHours: number; workingDurationHours: number }>; 
    pendingMerge: boolean; 
    lastState: string; 
    cycleNumber: number 
  } | null = null;
  let cycleCounter = 0;

  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];

    if (t.toState === inTestingState) {
      const tester = t.changedBy || t.assignedTo || 'Unknown';

      if (cycle?.pendingMerge && t.fromState === acceptanceState && cycle.tester === tester) {
        cycle.pendingMerge = false;
      } else {
        if (cycle) {
          const rawHours = cycle.periods.reduce((a, b) => a + b.rawDurationHours, 0);
          const workHours = cycle.periods.reduce((a, b) => a + b.workingDurationHours, 0);
          if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { rawHours: 0, workingHours: 0, cycles: 0, iterations: 0 });
          const m = metrics.get(cycle.tester)!;
          m.rawHours += rawHours;
          m.workingHours += workHours;
          m.cycles++;
          m.iterations++;
          totalRawHours += rawHours;
          totalWorkingHours += workHours;
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
      const rawDuration = (t.timestamp.getTime() - cycle.start.getTime()) / 3600000;
      const workingDuration = calculateWorkingTime(cycle.start, t.timestamp);
      cycle.periods.push({ start: cycle.start, end: t.timestamp, rawDurationHours: rawDuration, workingDurationHours: workingDuration });
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
          const rawHours = cycle.periods.reduce((a, b) => a + b.rawDurationHours, 0);
          const workHours = cycle.periods.reduce((a, b) => a + b.workingDurationHours, 0);
          if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { rawHours: 0, workingHours: 0, cycles: 0, iterations: 0 });
          const m = metrics.get(cycle.tester)!;
          m.rawHours += rawHours;
          m.workingHours += workHours;
          m.cycles++;
          m.iterations++;
          totalRawHours += rawHours;
          totalWorkingHours += workHours;
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
        const rawHours = cycle.periods.reduce((a, b) => a + b.rawDurationHours, 0);
        const workHours = cycle.periods.reduce((a, b) => a + b.workingDurationHours, 0);
        if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { rawHours: 0, workingHours: 0, cycles: 0, iterations: 0 });
        const m = metrics.get(cycle.tester)!;
        m.rawHours += rawHours;
        m.workingHours += workHours;
        m.cycles++;
        m.iterations++;
        totalRawHours += rawHours;
        totalWorkingHours += workHours;
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
      const rawHours = cycle.periods.reduce((a, b) => a + b.rawDurationHours, 0);
      const workHours = cycle.periods.reduce((a, b) => a + b.workingDurationHours, 0);
      if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { rawHours: 0, workingHours: 0, cycles: 0, iterations: 0 });
      const m = metrics.get(cycle.tester)!;
      m.rawHours += rawHours;
      m.workingHours += workHours;
      m.cycles++;
      m.iterations++;
      totalRawHours += rawHours;
      totalWorkingHours += workHours;
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
    const rawHours = cycle.periods.reduce((a, b) => a + b.rawDurationHours, 0);
    const workHours = cycle.periods.reduce((a, b) => a + b.workingDurationHours, 0);
    if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { rawHours: 0, workingHours: 0, cycles: 0, iterations: 0 });
    const m = metrics.get(cycle.tester)!;
    m.rawHours += rawHours;
    m.workingHours += workHours;
    m.cycles++;
    totalRawHours += rawHours;
    totalWorkingHours += workHours;
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

  return { metrics, cycles, totalRawHours, totalWorkingHours };
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
  const workItemsRaw: WorkItemRaw[] = [];
  let totalDevHours = 0, totalDevTestHours = 0, totalStgTestHours = 0;
  let requirements = 0, bugs = 0, tasks = 0;
  
  // Story points aggregation
  const spAgg: StoryPointsAgg = {
    totalSp: 0,
    itemsWithSp: 0,
    itemsWithoutSp: 0,
    totalActiveHoursWithSp: 0,
    fibonacciData: {},
  };
  for (const f of FIBONACCI_SEQUENCE) {
    spAgg.fibonacciData[f] = { count: 0, totalHours: 0 };
  }

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
      
      // Get Original Estimate (Story Points)
      const originalEstimate = wi.fields['Microsoft.VSTS.Scheduling.OriginalEstimate'] as number | undefined;
      
      const { name: assignedTo, fallbackUsed } = getCurrentAssignedTo(wi, history);
      const url = `https://dev.azure.com/${org}/${project}/_workitems/edit/${wi.id}`;

      const t1 = getDisplayName(wi.fields['Custom.TestedBy1']);
      const t2 = getDisplayName(wi.fields['Custom.TestedBy2']);
      if (t1 && !testers.includes(t1)) testers.push(t1);
      if (t2 && !testers.includes(t2)) testers.push(t2);

      // Dev time with working hours
      const devTime = calculateDevelopmentTime(transitions);
      totalDevHours += devTime.totalWorkingHours;

      // Initialize dev aggregation
      if (!devAgg[assignedTo]) {
        devAgg[assignedTo] = { 
          hours: 0, cycles: 0, cr: 0, dev: 0, stg: 0, completed: 0, 
          totalSp: 0, itemsWithSp: 0,
          items: [], returns: [], crReturns: [], devReturns: [], stgReturns: [] 
        };
      }
      const da = devAgg[assignedTo];
      da.hours += devTime.totalWorkingHours;
      da.cycles += devTime.cycles;
      
      // Story points for developer
      if (originalEstimate !== undefined && originalEstimate > 0) {
        da.totalSp += originalEstimate;
        da.itemsWithSp++;
        spAgg.totalSp += originalEstimate;
        spAgg.itemsWithSp++;
        spAgg.totalActiveHoursWithSp += devTime.totalWorkingHours;
        
        // Fibonacci breakdown
        if (spAgg.fibonacciData[originalEstimate]) {
          spAgg.fibonacciData[originalEstimate].count++;
          spAgg.fibonacciData[originalEstimate].totalHours += devTime.totalWorkingHours;
        }
      } else {
        spAgg.itemsWithoutSp++;
      }

      const ref: WorkItemReference = { 
        id: wi.id, 
        title, 
        type, 
        url, 
        count: 0, 
        assignedToChanged: history.length > 1, 
        assignedToHistory: history,
        activeTimeHours: devTime.totalWorkingHours,
        originalEstimate: originalEstimate,
      };
      
      da.items.push({ ...ref, count: 1 });

      if (assignedTo === 'Unassigned') unassignedItems.push({ ...ref, count: 1 });

      // Returns
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

      // DEV Testing
      const devTestResult = calculateTestingMetricsWithDetails(transitions, STATES.DEV_IN_TESTING, STATES.DEV_ACCEPTANCE_TESTING);
      const attributedDevTesters: string[] = [];
      for (const [tester, data] of devTestResult.metrics) {
        attributedDevTesters.push(tester);
        if (!testerAgg[tester]) {
          testerAgg[tester] = { 
            devHours: 0, stgHours: 0, devCycles: 0, stgCycles: 0, devIter: 0, stgIter: 0, 
            totalSp: 0, itemsWithSp: 0,
            closed: [], devItems: [], stgItems: [], prDetails: [], prsReviewed: 0 
          };
        }
        const ta = testerAgg[tester];
        ta.devHours += data.workingHours;
        ta.devCycles += data.cycles;
        ta.devIter += data.iterations;
        totalDevTestHours += data.workingHours;

        if (data.iterations > 0) {
          const existing = ta.devItems.find(x => x.id === wi.id);
          if (existing) {
            existing.count += data.iterations;
          } else {
            ta.devItems.push({ 
              ...ref, 
              count: data.iterations,
              devTestTimeHours: data.workingHours,
            });
          }
        }

        if (state === STATES.RELEASED && !ta.closed.find(x => x.id === wi.id)) {
          ta.closed.push({ ...ref, count: 1, devTestTimeHours: data.workingHours });
          if (originalEstimate !== undefined && originalEstimate > 0) {
            ta.totalSp += originalEstimate;
            ta.itemsWithSp++;
          }
        }
      }

      // STG Testing
      const stgTestResult = calculateTestingMetricsWithDetails(transitions, STATES.STG_IN_TESTING, STATES.STG_ACCEPTANCE_TESTING);
      const attributedStgTesters: string[] = [];
      for (const [tester, data] of stgTestResult.metrics) {
        attributedStgTesters.push(tester);
        if (!testerAgg[tester]) {
          testerAgg[tester] = { 
            devHours: 0, stgHours: 0, devCycles: 0, stgCycles: 0, devIter: 0, stgIter: 0, 
            totalSp: 0, itemsWithSp: 0,
            closed: [], devItems: [], stgItems: [], prDetails: [], prsReviewed: 0 
          };
        }
        const ta = testerAgg[tester];
        ta.stgHours += data.workingHours;
        ta.stgCycles += data.cycles;
        ta.stgIter += data.iterations;
        totalStgTestHours += data.workingHours;

        if (data.iterations > 0) {
          const existing = ta.stgItems.find(x => x.id === wi.id);
          if (existing) {
            existing.count += data.iterations;
          } else {
            ta.stgItems.push({ 
              ...ref, 
              count: data.iterations,
              stgTestTimeHours: data.workingHours,
            });
          }
        }

        if (state === STATES.RELEASED && !ta.closed.find(x => x.id === wi.id)) {
          const devHours = devTestResult.metrics.get(tester)?.workingHours || 0;
          ta.closed.push({ 
            ...ref, 
            count: 1, 
            devTestTimeHours: devHours,
            stgTestTimeHours: data.workingHours,
          });
          if (originalEstimate !== undefined && originalEstimate > 0 && !attributedDevTesters.includes(tester)) {
            ta.totalSp += originalEstimate;
            ta.itemsWithSp++;
          }
        }
      }

      // Store raw work item for client-side filtering
      workItemsRaw.push({
        id: wi.id,
        title,
        type,
        state,
        assignedTo,
        testedBy1: t1 || undefined,
        testedBy2: t2 || undefined,
        originalEstimate,
        activeTimeHours: devTime.totalWorkingHours,
        devTestTimeHours: devTestResult.totalWorkingHours,
        stgTestTimeHours: stgTestResult.totalWorkingHours,
        stateTransitions: transitions.map(t => ({
          fromState: t.fromState,
          toState: t.toState,
          timestamp: t.timestamp.toISOString(),
          changedBy: t.changedBy || undefined,
        })),
      });

      // VERBOSE DOMAIN DEBUG
      if (isVerbose) {
        const domainLog: DomainDebugLog = {
          workItemId: wi.id,
          title,
          type,
          currentState: state,
          originalEstimate: originalEstimate || null,
          attribution: {
            currentAssignedTo: assignedTo,
            fallbackUsed,
            assignedToHistory: history,
          },
          stateTransitions: transitions.map(t => ({
            fromState: t.fromState,
            toState: t.toState,
            enteredAt: t.timestamp.toISOString(),
            leftAt: t.timestamp.toISOString(),
            rawDurationHours: 0,
            workingDurationHours: 0,
            changedBy: t.changedBy,
            assignedToAtTransition: t.assignedTo,
          })),
          developmentTime: {
            activePeriods: devTime.activePeriods.map(p => ({
              start: p.start.toISOString(),
              end: p.end?.toISOString() || null,
              rawDurationHours: Math.round(p.rawDurationHours * 1000) / 1000,
              workingDurationHours: Math.round(p.workingDurationHours * 1000) / 1000,
              included: p.included,
              exclusionReason: p.exclusionReason,
            })),
            totalRawHours: Math.round(devTime.totalRawHours * 1000) / 1000,
            totalWorkingHours: Math.round(devTime.totalWorkingHours * 1000) / 1000,
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
                rawDurationHours: Math.round(p.rawDurationHours * 1000) / 1000,
                workingDurationHours: Math.round(p.workingDurationHours * 1000) / 1000,
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
                rawDurationHours: Math.round(p.rawDurationHours * 1000) / 1000,
                workingDurationHours: Math.round(p.workingDurationHours * 1000) / 1000,
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
            devActiveTimeHours: Math.round(devTime.totalWorkingHours * 1000) / 1000,
            devTestTimeHours: Math.round(devTestResult.totalWorkingHours * 1000) / 1000,
            stgTestTimeHours: Math.round(stgTestResult.totalWorkingHours * 1000) / 1000,
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

        debugLogs.workItems[wi.id] = {
          workItemId: wi.id,
          title,
          currentAssignedTo: assignedTo,
          assignedToHistory: history,
          originalEstimate: originalEstimate || null,
          activePeriods: devTime.activePeriods.map(p => ({
            start: p.start.toISOString(),
            end: p.end?.toISOString() || null,
            rawDurationHours: Math.round(p.rawDurationHours * 100) / 100,
            workingDurationHours: Math.round(p.workingDurationHours * 100) / 100,
          })),
          devTestingCycles: devTestResult.cycles.map(c => ({
            tester: c.tester,
            periods: c.periods.map(p => ({
              start: p.start.toISOString(),
              end: p.end.toISOString(),
              rawDurationHours: Math.round(p.rawDurationHours * 100) / 100,
              workingDurationHours: Math.round(p.workingDurationHours * 100) / 100,
            })),
            merged: c.merged,
            closingStatus: c.closingStatus,
          })),
          stgTestingCycles: stgTestResult.cycles.map(c => ({
            tester: c.tester,
            periods: c.periods.map(p => ({
              start: p.start.toISOString(),
              end: p.end.toISOString(),
              rawDurationHours: Math.round(p.rawDurationHours * 100) / 100,
              workingDurationHours: Math.round(p.workingDurationHours * 100) / 100,
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

  // Process PR comments
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
    spAgg,
    workItemsRaw,
    prStats: prResult.stats,
  };
}

// ============== PR Comment Processing ==============

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

  const prFetchStage = startStage(jobId, 'fetch_pr_comments');

  const PR_BATCH = 15;
  for (let i = 0; i < workItems.length; i += PR_BATCH) {
    const batch = workItems.slice(i, i + PR_BATCH);
    const results = await Promise.all(
      batch.map(wi => getPRCommentsForItem(org, project, wi, pat, isVerbose, debugLogs))
    );

    for (const result of results) {
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
      apiCalls++;
      const pr = await azureRequest(
        `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}?api-version=7.1`,
        pat
      ) as { pullRequestId: number; repository: { webUrl: string } };

      const prUrl = `${pr.repository.webUrl}/pullrequest/${pr.pullRequestId}`;

      apiCalls++;
      const threadsResponse = await azureRequest(
        `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}/threads?api-version=7.1`,
        pat
      ) as { value: Array<{ id: number; comments: Array<{ id: number; author: { displayName: string }; commentType: string }> }> };

      for (const thread of threadsResponse.value || []) {
        if (!thread.comments?.length) continue;
        const firstComment = thread.comments[0];
        commentsFetched++;
        
        const author = firstComment.author?.displayName || 'Unknown';
        const isText = firstComment.commentType === 'text';

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

// ============== Result Merging ==============

function mergeChunkResultsNumeric(
  chunks: ChunkResult[],
  workItems: WorkItem[]
): unknown {
  const mergedDevAgg: Record<string, DevAggData> = {};
  const mergedTesterAgg: Record<string, TesterAggData> = {};
  const mergedPrAgg: Record<string, { count: number; prs: PRReference[] }> = {};
  const allTesters = new Set<string>();
  const unassignedItems: WorkItemReference[] = [];
  const allWorkItemsRaw: WorkItemRaw[] = [];
  let totalDevHours = 0, totalDevTestHours = 0, totalStgTestHours = 0;
  let requirements = 0, bugs = 0, tasks = 0;

  // Merged story points
  const mergedSpAgg: StoryPointsAgg = {
    totalSp: 0,
    itemsWithSp: 0,
    itemsWithoutSp: 0,
    totalActiveHoursWithSp: 0,
    fibonacciData: {},
  };
  for (const f of FIBONACCI_SEQUENCE) {
    mergedSpAgg.fibonacciData[f] = { count: 0, totalHours: 0 };
  }

  for (const chunk of chunks) {
    requirements += chunk.requirements;
    bugs += chunk.bugs;
    tasks += chunk.tasks;
    totalDevHours += chunk.totalDevHours;
    totalDevTestHours += chunk.totalDevTestHours;
    totalStgTestHours += chunk.totalStgTestHours;
    unassignedItems.push(...chunk.unassignedItems);
    allWorkItemsRaw.push(...chunk.workItemsRaw);

    // Merge story points
    if (chunk.spAgg) {
      mergedSpAgg.totalSp += chunk.spAgg.totalSp;
      mergedSpAgg.itemsWithSp += chunk.spAgg.itemsWithSp;
      mergedSpAgg.itemsWithoutSp += chunk.spAgg.itemsWithoutSp;
      mergedSpAgg.totalActiveHoursWithSp += chunk.spAgg.totalActiveHoursWithSp;
      for (const f of FIBONACCI_SEQUENCE) {
        if (chunk.spAgg.fibonacciData[f]) {
          mergedSpAgg.fibonacciData[f].count += chunk.spAgg.fibonacciData[f].count;
          mergedSpAgg.fibonacciData[f].totalHours += chunk.spAgg.fibonacciData[f].totalHours;
        }
      }
    }

    for (const t of chunk.testers) allTesters.add(t);

    for (const [dev, data] of Object.entries(chunk.devAgg)) {
      if (!mergedDevAgg[dev]) {
        mergedDevAgg[dev] = { 
          hours: 0, cycles: 0, cr: 0, dev: 0, stg: 0, completed: 0, 
          totalSp: 0, itemsWithSp: 0,
          items: [], returns: [], crReturns: [], devReturns: [], stgReturns: [] 
        };
      }
      const m = mergedDevAgg[dev];
      m.hours += data.hours;
      m.cycles += data.cycles;
      m.cr += data.cr;
      m.dev += data.dev;
      m.stg += data.stg;
      m.completed += data.completed;
      m.totalSp += data.totalSp;
      m.itemsWithSp += data.itemsWithSp;
      m.items.push(...data.items);
      m.returns.push(...data.returns);
      m.crReturns.push(...data.crReturns);
      m.devReturns.push(...data.devReturns);
      m.stgReturns.push(...data.stgReturns);
    }

    for (const [tester, data] of Object.entries(chunk.testerAgg)) {
      if (!mergedTesterAgg[tester]) {
        mergedTesterAgg[tester] = { 
          devHours: 0, stgHours: 0, devCycles: 0, stgCycles: 0, devIter: 0, stgIter: 0, 
          totalSp: 0, itemsWithSp: 0,
          closed: [], devItems: [], stgItems: [], prDetails: [], prsReviewed: 0 
        };
      }
      const m = mergedTesterAgg[tester];
      m.devHours += data.devHours;
      m.stgHours += data.stgHours;
      m.devCycles += data.devCycles;
      m.stgCycles += data.stgCycles;
      m.devIter += data.devIter;
      m.stgIter += data.stgIter;
      m.totalSp += data.totalSp;
      m.itemsWithSp += data.itemsWithSp;
      m.closed.push(...data.closed);
      m.devItems.push(...data.devItems);
      m.stgItems.push(...data.stgItems);
    }

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
      avgOriginalEstimate: d.itemsWithSp > 0 ? d.totalSp / d.itemsWithSp : 0,
      totalOriginalEstimate: d.totalSp,
      itemsWithEstimate: d.itemsWithSp,
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
      avgOriginalEstimate: t.itemsWithSp > 0 ? t.totalSp / t.itemsWithSp : 0,
      totalOriginalEstimate: t.totalSp,
      itemsWithEstimate: t.itemsWithSp,
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

  // Story points analytics
  const avgStoryPoints = mergedSpAgg.itemsWithSp > 0 
    ? mergedSpAgg.totalSp / mergedSpAgg.itemsWithSp 
    : 0;
  const costPerStoryPoint = mergedSpAgg.totalSp > 0 
    ? mergedSpAgg.totalActiveHoursWithSp / mergedSpAgg.totalSp 
    : 0;

  const fibonacciBreakdown = FIBONACCI_SEQUENCE
    .filter(f => mergedSpAgg.fibonacciData[f].count > 0)
    .map(f => ({
      estimate: f,
      itemCount: mergedSpAgg.fibonacciData[f].count,
      totalActiveHours: mergedSpAgg.fibonacciData[f].totalHours,
      avgHoursPerSp: mergedSpAgg.fibonacciData[f].count > 0 
        ? mergedSpAgg.fibonacciData[f].totalHours / (mergedSpAgg.fibonacciData[f].count * f)
        : 0,
    }));

  const storyPointsAnalytics = {
    averageStoryPoints: avgStoryPoints,
    itemsWithEstimate: mergedSpAgg.itemsWithSp,
    itemsWithoutEstimate: mergedSpAgg.itemsWithoutSp,
    totalStoryPoints: mergedSpAgg.totalSp,
    costPerStoryPoint,
    fibonacciBreakdown,
  };

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
    avgStoryPoints,
    costPerStoryPoint,
  };

  const chartData = {
    developmentSpeed: developerMetrics.filter(d => d.avgDevTimeHours > 0).map(d => ({ name: d.developer, value: Math.round(d.avgDevTimeHours * 10) / 10 })),
    devTestingSpeed: testerMetrics.filter(t => t.avgDevTestTimeHours > 0).map(t => ({ name: t.tester, value: Math.round(t.avgDevTestTimeHours * 10) / 10 })),
    stgTestingSpeed: testerMetrics.filter(t => t.avgStgTestTimeHours > 0).map(t => ({ name: t.tester, value: Math.round(t.avgStgTestTimeHours * 10) / 10 })),
    returns: developerMetrics.filter(d => d.totalReturnCount > 0).map(d => ({ name: d.developer, value: d.totalReturnCount })),
    devIterations: testerMetrics.filter(t => t.devTestingIterations > 0).map(t => ({ name: t.tester, value: t.devTestingIterations })),
    stgIterations: testerMetrics.filter(t => t.stgTestingIterations > 0).map(t => ({ name: t.tester, value: t.stgTestingIterations })),
    prComments: prCommentAuthors.map(p => ({ name: p.author, value: p.count, isTester: p.isTester })),
    storyPointsCost: fibonacciBreakdown.map(f => ({ name: `${f.estimate} SP`, value: Math.round(f.avgHoursPerSp * 10) / 10 })),
  };

  return {
    developerMetrics,
    testerMetrics,
    prCommentAuthors,
    storyPointsAnalytics,
    summary,
    chartData,
    unassignedItems,
    workItemsRaw: allWorkItemsRaw,
  };
}

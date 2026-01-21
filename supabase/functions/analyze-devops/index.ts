import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// State constants - exact names from Azure DevOps
const STATES = {
  ACTIVE: 'Active',
  CODE_REVIEW: 'Code Review',
  FIX_REQUIRED: 'Fix Required',
  DEV_IN_TESTING: 'DEV_In Testing',
  STG_IN_TESTING: 'STG_In Testing',
  DEV_ACCEPTANCE_TESTING: 'DEV_Acceptance Testing',
  STG_ACCEPTANCE_TESTING: 'STG_Acceptance Testing',
  DEV_APPROVED: 'DEV_Approved', // Added missing state
  APPROVED: 'Approved',
  READY_FOR_RELEASE: 'Ready For Release',
  RELEASED: 'Released',
} as const;

// Enhanced debug interfaces for manual validation
interface TestingPeriod {
  start: string;
  end: string;
  hours: number;
}

interface TestingCycleDebug {
  cycleIndex: number;
  env: 'DEV' | 'STG';
  tester: string;
  cycleStart: string;
  cycleEnd: string;
  endReason: string;
  totalCycleHours: number;
  mergedPeriods: TestingPeriod[];
  iterationCounted: boolean;
  iterationReason: string;
}

interface WorkItemDebugLog {
  workItemId: number;
  type: string;
  finalState: string;
  transitions: Array<{
    timestamp: string;
    fromState: string;
    toState: string;
    changedBy: string | null;
    assignedTo: string | null;
  }>;
  development: {
    activePeriods: Array<{
      start: string;
      end: string;
      hoursAdded: number;
      closeReason: string;
      developer: string;
    }>;
    totalActiveHours: number;
    participatesInDevAvg: boolean;
    reason: string;
  };
  devTesting: {
    cycles: TestingCycleDebug[];
    totalTestingHours: number;
    totalIterations: number;
  };
  stgTesting: {
    cycles: TestingCycleDebug[];
    totalTestingHours: number;
    totalIterations: number;
  };
  returns: Array<{
    fromState: string;
    toState: string;
    developer: string;
    type: string;
  }>;
  prComments: Array<{
    prId: string;
    author: string;
    counted: boolean;
    reason: string;
  }>;
  aggregation: {
    taskDevTestingTotalHours: number;
    taskStgTestingTotalHours: number;
    taskDevIterations: number;
    taskStgIterations: number;
    includedInAverages: boolean;
  };
}

function emitWorkItemDebugLog(log: WorkItemDebugLog) {
  console.log('[WORK_ITEM_DEBUG]', JSON.stringify(log, null, 2));
}

interface WorkItemRevision {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
}

interface WorkItem {
  id: number;
  fields: Record<string, unknown>;
  relations?: Array<{ rel: string; url: string; attributes: { name: string } }>;
}

interface TransitionEvent {
  fromState: string;
  toState: string;
  timestamp: Date;
  workItemId: number;
  assignedTo: string | null;
  changedBy: string | null;
}

interface DeveloperMetrics {
  developer: string;
  avgDevTimeHours: number;
  developmentCycles: number;
  totalReturnCount: number;
  codeReviewReturns: number;
  devTestingReturns: number;
  stgTestingReturns: number;
  itemsCompleted: number;
  avgTotalReturnsPerTask: number;
  avgCodeReviewReturnsPerTask: number;
  avgDevTestingReturnsPerTask: number;
  avgStgTestingReturnsPerTask: number;
}

interface TesterMetrics {
  tester: string;
  closedItemsCount: number;
  avgDevTestTimeHours: number;
  avgStgTestTimeHours: number;
  devTestingCycles: number;
  stgTestingCycles: number;
  devTestingIterations: number;
  stgTestingIterations: number;
  prCommentsCount: number;
  avgDevIterationsPerTask: number;
  avgStgIterationsPerTask: number;
  avgPrCommentsPerPr: number;
  tasksWorkedOn: number;
  prsReviewed: number;
}

interface PRCommentAuthor {
  author: string;
  count: number;
  isTester: boolean;
}

/**
 * Makes an authenticated request to Azure DevOps API
 */
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

/**
 * Execute a saved query to get work item IDs
 */
async function executeQuery(
  organization: string,
  project: string,
  queryId: string,
  pat: string
): Promise<number[]> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/wit/wiql/${queryId}?api-version=7.1`;
  const result = await azureRequest(url, pat) as { workItems?: Array<{ id: number }> };
  
  if (!result.workItems) {
    return [];
  }
  
  return result.workItems.map(wi => wi.id);
}

/**
 * Get work items with relations
 */
async function getWorkItems(
  organization: string,
  project: string,
  ids: number[],
  pat: string
): Promise<WorkItem[]> {
  if (ids.length === 0) return [];

  const batchSize = 200;
  const allWorkItems: WorkItem[] = [];

  for (let i = 0; i < ids.length; i += batchSize) {
    const batchIds = ids.slice(i, i + batchSize);
    const idsParam = batchIds.join(',');
    const url = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems?ids=${idsParam}&$expand=relations&api-version=7.1`;
    
    const result = await azureRequest(url, pat) as { value: WorkItem[] };
    allWorkItems.push(...result.value);
  }

  return allWorkItems;
}

/**
 * Get all revisions for a work item
 */
async function getWorkItemRevisions(
  organization: string,
  project: string,
  workItemId: number,
  pat: string
): Promise<WorkItemRevision[]> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems/${workItemId}/revisions?api-version=7.1`;
  const result = await azureRequest(url, pat) as { value: WorkItemRevision[] };
  return result.value;
}

/**
 * Get display name from identity field
 */
function getDisplayName(field: unknown): string | null {
  if (!field) return null;
  if (typeof field === 'object' && field !== null && 'displayName' in field) {
    return (field as { displayName: string }).displayName;
  }
  return null;
}

/**
 * Extract state transitions from revisions with AssignedTo and ChangedBy at each transition
 */
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

/**
 * Calculate development time: SUM of ALL Active periods until first DEV_Acceptance Testing
 */
function calculateDevelopmentTime(transitions: TransitionEvent[], workItemId: number): {
  totalHours: number;
  cycles: number;
  developerCycles: Map<string, { totalHours: number; cycles: number }>;
  debugPeriods: Array<{ start: string; end: string; hoursAdded: number; closeReason: string; developer: string }>;
  stoppedAtAcceptance: boolean;
} {
  const developerCycles = new Map<string, { totalHours: number; cycles: number }>();
  const debugPeriods: Array<{ start: string; end: string; hoursAdded: number; closeReason: string; developer: string }> = [];
  let totalHours = 0;
  let cycles = 0;
  let activeStartTimestamp: Date | null = null;
  let stoppedAtAcceptance = false;

  for (const t of transitions) {
    if (t.toState === STATES.ACTIVE) {
      activeStartTimestamp = t.timestamp;
    }
    else if (t.toState === STATES.CODE_REVIEW && activeStartTimestamp) {
      const hours = (t.timestamp.getTime() - activeStartTimestamp.getTime()) / (1000 * 60 * 60);
      totalHours += hours;
      cycles++;

      const developer = t.assignedTo || 'Unassigned';
      if (!developerCycles.has(developer)) {
        developerCycles.set(developer, { totalHours: 0, cycles: 0 });
      }
      const devData = developerCycles.get(developer)!;
      devData.totalHours += hours;
      devData.cycles++;

      debugPeriods.push({
        start: activeStartTimestamp.toISOString(),
        end: t.timestamp.toISOString(),
        hoursAdded: Math.round(hours * 100) / 100,
        closeReason: 'Transition to Code Review',
        developer,
      });

      activeStartTimestamp = null;
    }
    else if (t.toState === STATES.DEV_ACCEPTANCE_TESTING) {
      if (activeStartTimestamp) {
        const hours = (t.timestamp.getTime() - activeStartTimestamp.getTime()) / (1000 * 60 * 60);
        totalHours += hours;
        cycles++;

        const developer = t.assignedTo || 'Unassigned';
        if (!developerCycles.has(developer)) {
          developerCycles.set(developer, { totalHours: 0, cycles: 0 });
        }
        const devData = developerCycles.get(developer)!;
        devData.totalHours += hours;
        devData.cycles++;

        debugPeriods.push({
          start: activeStartTimestamp.toISOString(),
          end: t.timestamp.toISOString(),
          hoursAdded: Math.round(hours * 100) / 100,
          closeReason: 'Transition to DEV_Acceptance Testing (Code Review skipped)',
          developer,
        });

        activeStartTimestamp = null;
      }
      stoppedAtAcceptance = true;
      break;
    }
  }

  return { totalHours, cycles, developerCycles, debugPeriods, stoppedAtAcceptance };
}

/**
 * Count returns to Fix Required
 */
function countReturns(transitions: TransitionEvent[], workItemId: number): {
  codeReviewReturns: number;
  devTestingReturns: number;
  stgTestingReturns: number;
  returnsByDeveloper: Map<string, { codeReview: number; devTesting: number; stgTesting: number }>;
  debugReturns: Array<{ fromState: string; toState: string; developer: string; type: string }>;
} {
  let codeReviewReturns = 0;
  let devTestingReturns = 0;
  let stgTestingReturns = 0;
  const returnsByDeveloper = new Map<string, { codeReview: number; devTesting: number; stgTesting: number }>();
  const debugReturns: Array<{ fromState: string; toState: string; developer: string; type: string }> = [];

  let lastKnownDeveloper: string | null = null;

  for (const t of transitions) {
    if (t.fromState === STATES.ACTIVE && 
        (t.toState === STATES.CODE_REVIEW || t.toState === STATES.DEV_ACCEPTANCE_TESTING)) {
      lastKnownDeveloper = t.assignedTo;
    }

    if (t.toState === STATES.FIX_REQUIRED) {
      const developer = lastKnownDeveloper || 'Unassigned';
      
      if (!returnsByDeveloper.has(developer)) {
        returnsByDeveloper.set(developer, { codeReview: 0, devTesting: 0, stgTesting: 0 });
      }
      const devReturns = returnsByDeveloper.get(developer)!;
      let returnType = 'unknown';

      if (t.fromState === STATES.CODE_REVIEW) {
        codeReviewReturns++;
        devReturns.codeReview++;
        returnType = 'Code Review';
      } else if (t.fromState === STATES.DEV_IN_TESTING || t.fromState === STATES.DEV_ACCEPTANCE_TESTING) {
        devTestingReturns++;
        devReturns.devTesting++;
        returnType = 'DEV Testing';
      } else if (t.fromState === STATES.STG_IN_TESTING || t.fromState === STATES.STG_ACCEPTANCE_TESTING) {
        stgTestingReturns++;
        devReturns.stgTesting++;
        returnType = 'STG Testing';
      }

      debugReturns.push({
        fromState: t.fromState,
        toState: t.toState,
        developer,
        type: returnType,
      });
    }
  }

  return { codeReviewReturns, devTestingReturns, stgTestingReturns, returnsByDeveloper, debugReturns };
}

/**
 * Calculate DEV testing metrics with proper cycle closing logic
 * 
 * CYCLE CLOSING RULES for DEV:
 * - DEV_In Testing → Fix Required
 * - DEV_In Testing → DEV_Approved
 * - DEV_In Testing → Ready for Release
 * - DEV_In Testing → DEV_Acceptance Testing (only if next In Testing is by different tester)
 * - DEV_Acceptance Testing → Fix Required
 * - DEV_Acceptance Testing → DEV_Approved
 * - DEV_Acceptance Testing → Ready for Release
 * 
 * CYCLE MERGING:
 * - In Testing → Acceptance → In Testing (same tester) = merge periods into one cycle
 */
function calculateDevTestingMetrics(transitions: TransitionEvent[], workItemId: number): {
  metrics: Map<string, { totalHours: number; cycles: number; iterations: number }>;
  debugCycles: TestingCycleDebug[];
  totalIterations: number;
  totalTestingHours: number;
} {
  const testerMetrics = new Map<string, { totalHours: number; cycles: number; iterations: number }>();
  const debugCycles: TestingCycleDebug[] = [];
  
  // States that close a DEV testing cycle
  const DEV_CYCLE_CLOSING_STATES = [
    STATES.FIX_REQUIRED,
    STATES.DEV_APPROVED,
    STATES.READY_FOR_RELEASE,
  ];
  
  let currentCycle: {
    tester: string;
    cycleStart: Date;
    periods: Array<{ start: Date; end: Date | null; hours: number }>;
    inAcceptance: boolean;
  } | null = null;
  
  let totalIterations = 0;
  let totalTestingHours = 0;
  let cycleIndex = 0;
  
  // Pre-process: Look ahead to determine if next In Testing transition is by same/different tester
  const transitionsWithLookahead: Array<TransitionEvent & { nextInTestingTester?: string }> = transitions.map((t, i) => {
    const result = { ...t, nextInTestingTester: undefined as string | undefined };
    
    if (t.toState === STATES.DEV_ACCEPTANCE_TESTING) {
      for (let j = i + 1; j < transitions.length; j++) {
        if (transitions[j].toState === STATES.DEV_IN_TESTING) {
          result.nextInTestingTester = transitions[j].changedBy || transitions[j].assignedTo || 'Unknown';
          break;
        }
        // Stop looking if we hit a cycle-closing state
        if (DEV_CYCLE_CLOSING_STATES.includes(transitions[j].toState as any)) {
          break;
        }
      }
    }
    return result;
  });
  
  function closeCycle(endTime: Date, endReason: string, iterationCounted: boolean, iterationReason: string) {
    if (!currentCycle) return;
    
    // Close any open In Testing period
    const lastPeriod = currentCycle.periods[currentCycle.periods.length - 1];
    if (lastPeriod && lastPeriod.end === null) {
      lastPeriod.end = endTime;
      lastPeriod.hours = (endTime.getTime() - lastPeriod.start.getTime()) / (1000 * 60 * 60);
    }
    
    // Calculate total hours for this cycle (sum of all merged periods)
    const cycleTotalHours = currentCycle.periods.reduce((sum, p) => sum + p.hours, 0);
    
    // Update tester metrics
    if (!testerMetrics.has(currentCycle.tester)) {
      testerMetrics.set(currentCycle.tester, { totalHours: 0, cycles: 0, iterations: 0 });
    }
    const data = testerMetrics.get(currentCycle.tester)!;
    data.totalHours += cycleTotalHours;
    data.cycles++;
    if (iterationCounted) {
      data.iterations++;
      totalIterations++;
    }
    totalTestingHours += cycleTotalHours;
    
    cycleIndex++;
    
    // Debug log with enhanced structure
    debugCycles.push({
      cycleIndex,
      env: 'DEV',
      tester: currentCycle.tester,
      cycleStart: currentCycle.cycleStart.toISOString(),
      cycleEnd: endTime.toISOString(),
      endReason,
      totalCycleHours: Math.round(cycleTotalHours * 100) / 100,
      mergedPeriods: currentCycle.periods.map(p => ({
        start: p.start.toISOString(),
        end: p.end?.toISOString() || endTime.toISOString(),
        hours: Math.round(p.hours * 100) / 100,
      })),
      iterationCounted,
      iterationReason,
    });
    
    console.log('[DEV_CYCLE_CLOSED]', JSON.stringify({
      workItemId,
      cycleIndex,
      tester: currentCycle.tester,
      endReason,
      totalCycleHours: Math.round(cycleTotalHours * 100) / 100,
      periodsCount: currentCycle.periods.length,
      iterationCounted,
      iterationReason,
    }));
    
    currentCycle = null;
  }
  
  for (let i = 0; i < transitionsWithLookahead.length; i++) {
    const t = transitionsWithLookahead[i];
    
    // Transition INTO DEV_In Testing
    if (t.toState === STATES.DEV_IN_TESTING) {
      const currentTester = t.changedBy || t.assignedTo || 'Unknown';
      
      console.log('[DEV_TRANSITION]', JSON.stringify({
        workItemId,
        event: 'TO_IN_TESTING',
        fromState: t.fromState,
        tester: currentTester,
        timestamp: t.timestamp.toISOString(),
        hasCycle: !!currentCycle,
        cycleInAcceptance: currentCycle?.inAcceptance,
        cycleTester: currentCycle?.tester,
      }));
      
      if (currentCycle && currentCycle.inAcceptance && currentCycle.tester === currentTester) {
        // SAME tester returning from Acceptance - MERGE into existing cycle
        currentCycle.periods.push({
          start: t.timestamp,
          end: null,
          hours: 0,
        });
        currentCycle.inAcceptance = false;
        
        console.log('[DEV_CYCLE_MERGE]', JSON.stringify({
          workItemId,
          tester: currentTester,
          reason: 'Same tester returning from Acceptance',
          periodsCount: currentCycle.periods.length,
        }));
      } else {
        // DIFFERENT tester or no existing cycle - close previous and start new
        if (currentCycle) {
          const endReason = currentCycle.inAcceptance 
            ? 'Tester Changed (different tester took over from Acceptance)' 
            : 'New cycle started by different tester';
          closeCycle(t.timestamp, endReason, true, 'Cycle closed before new tester, iteration counted');
        }
        
        // Start new cycle
        currentCycle = {
          tester: currentTester,
          cycleStart: t.timestamp,
          periods: [{ start: t.timestamp, end: null, hours: 0 }],
          inAcceptance: false,
        };
        
        console.log('[DEV_CYCLE_START]', JSON.stringify({
          workItemId,
          tester: currentTester,
          cycleStart: t.timestamp.toISOString(),
          fromState: t.fromState,
        }));
      }
    }
    // Transition FROM DEV_In Testing TO DEV_Acceptance Testing
    else if (t.fromState === STATES.DEV_IN_TESTING && t.toState === STATES.DEV_ACCEPTANCE_TESTING) {
      if (currentCycle) {
        // Close the current In Testing period but potentially keep cycle open
        const lastPeriod = currentCycle.periods[currentCycle.periods.length - 1];
        if (lastPeriod && lastPeriod.end === null) {
          lastPeriod.end = t.timestamp;
          lastPeriod.hours = (t.timestamp.getTime() - lastPeriod.start.getTime()) / (1000 * 60 * 60);
        }
        currentCycle.inAcceptance = true;
        
        // Check if next In Testing is by different tester - if so, close cycle now
        if (t.nextInTestingTester && t.nextInTestingTester !== currentCycle.tester) {
          closeCycle(t.timestamp, 'Tester Changed (handed off to different tester)', true, 'Cycle closed before handoff, iteration counted');
        }
        
        console.log('[DEV_TO_ACCEPTANCE]', JSON.stringify({
          workItemId,
          tester: currentCycle?.tester,
          periodHours: lastPeriod?.hours ? Math.round(lastPeriod.hours * 100) / 100 : 0,
          nextTester: t.nextInTestingTester || 'unknown',
          willClose: t.nextInTestingTester && t.nextInTestingTester !== currentCycle?.tester,
        }));
      }
    }
    // Cycle-closing transitions FROM DEV_In Testing
    else if (currentCycle && t.fromState === STATES.DEV_IN_TESTING && DEV_CYCLE_CLOSING_STATES.includes(t.toState as any)) {
      closeCycle(t.timestamp, `${t.toState}`, true, `Cycle completed with ${t.toState}, iteration counted`);
    }
    // Cycle-closing transitions FROM DEV_Acceptance Testing
    else if (currentCycle && currentCycle.inAcceptance && 
             t.fromState === STATES.DEV_ACCEPTANCE_TESTING &&
             DEV_CYCLE_CLOSING_STATES.includes(t.toState as any)) {
      closeCycle(t.timestamp, `${t.toState}`, true, `Cycle closed from Acceptance with ${t.toState}, iteration counted`);
    }
  }
  
  // Close any remaining open cycle at the end (not completed = no iteration)
  if (currentCycle) {
    const lastTransition = transitions[transitions.length - 1];
    closeCycle(lastTransition?.timestamp || new Date(), 'End of transitions (cycle incomplete)', false, 'Cycle not completed, no closing transition');
  }
  
  return { metrics: testerMetrics, debugCycles, totalIterations, totalTestingHours };
}

/**
 * Calculate STG testing metrics with proper cycle closing logic
 * 
 * CYCLE CLOSING RULES for STG:
 * - STG_In Testing → Fix Required
 * - STG_In Testing → Ready for Release
 * - STG_In Testing → STG_Acceptance Testing (only if next In Testing is by different tester)
 * - STG_Acceptance Testing → Fix Required
 * - STG_Acceptance Testing → Ready for Release
 * 
 * Note: STG does NOT close on Approved (only DEV does)
 */
function calculateStgTestingMetrics(transitions: TransitionEvent[], workItemId: number): {
  metrics: Map<string, { totalHours: number; cycles: number; iterations: number }>;
  debugCycles: TestingCycleDebug[];
  totalIterations: number;
  totalTestingHours: number;
} {
  const testerMetrics = new Map<string, { totalHours: number; cycles: number; iterations: number }>();
  const debugCycles: TestingCycleDebug[] = [];
  
  // States that close a STG testing cycle (no Approved for STG)
  const STG_CYCLE_CLOSING_STATES = [
    STATES.FIX_REQUIRED,
    STATES.READY_FOR_RELEASE,
  ];
  
  let currentCycle: {
    tester: string;
    cycleStart: Date;
    periods: Array<{ start: Date; end: Date | null; hours: number }>;
    inAcceptance: boolean;
  } | null = null;
  
  let totalIterations = 0;
  let totalTestingHours = 0;
  let cycleIndex = 0;
  
  // Pre-process: Look ahead to determine if next In Testing transition is by same/different tester
  const transitionsWithLookahead: Array<TransitionEvent & { nextInTestingTester?: string }> = transitions.map((t, i) => {
    const result = { ...t, nextInTestingTester: undefined as string | undefined };
    
    if (t.toState === STATES.STG_ACCEPTANCE_TESTING) {
      for (let j = i + 1; j < transitions.length; j++) {
        if (transitions[j].toState === STATES.STG_IN_TESTING) {
          result.nextInTestingTester = transitions[j].changedBy || transitions[j].assignedTo || 'Unknown';
          break;
        }
        if (STG_CYCLE_CLOSING_STATES.includes(transitions[j].toState as any)) {
          break;
        }
      }
    }
    return result;
  });
  
  function closeCycle(endTime: Date, endReason: string, iterationCounted: boolean, iterationReason: string) {
    if (!currentCycle) return;
    
    const lastPeriod = currentCycle.periods[currentCycle.periods.length - 1];
    if (lastPeriod && lastPeriod.end === null) {
      lastPeriod.end = endTime;
      lastPeriod.hours = (endTime.getTime() - lastPeriod.start.getTime()) / (1000 * 60 * 60);
    }
    
    const cycleTotalHours = currentCycle.periods.reduce((sum, p) => sum + p.hours, 0);
    
    if (!testerMetrics.has(currentCycle.tester)) {
      testerMetrics.set(currentCycle.tester, { totalHours: 0, cycles: 0, iterations: 0 });
    }
    const data = testerMetrics.get(currentCycle.tester)!;
    data.totalHours += cycleTotalHours;
    data.cycles++;
    if (iterationCounted) {
      data.iterations++;
      totalIterations++;
    }
    totalTestingHours += cycleTotalHours;
    
    cycleIndex++;
    
    debugCycles.push({
      cycleIndex,
      env: 'STG',
      tester: currentCycle.tester,
      cycleStart: currentCycle.cycleStart.toISOString(),
      cycleEnd: endTime.toISOString(),
      endReason,
      totalCycleHours: Math.round(cycleTotalHours * 100) / 100,
      mergedPeriods: currentCycle.periods.map(p => ({
        start: p.start.toISOString(),
        end: p.end?.toISOString() || endTime.toISOString(),
        hours: Math.round(p.hours * 100) / 100,
      })),
      iterationCounted,
      iterationReason,
    });
    
    console.log('[STG_CYCLE_CLOSED]', JSON.stringify({
      workItemId,
      cycleIndex,
      tester: currentCycle.tester,
      endReason,
      totalCycleHours: Math.round(cycleTotalHours * 100) / 100,
      periodsCount: currentCycle.periods.length,
      iterationCounted,
      iterationReason,
    }));
    
    currentCycle = null;
  }
  
  for (let i = 0; i < transitionsWithLookahead.length; i++) {
    const t = transitionsWithLookahead[i];
    
    if (t.toState === STATES.STG_IN_TESTING) {
      const currentTester = t.changedBy || t.assignedTo || 'Unknown';
      
      console.log('[STG_TRANSITION]', JSON.stringify({
        workItemId,
        event: 'TO_IN_TESTING',
        fromState: t.fromState,
        tester: currentTester,
        timestamp: t.timestamp.toISOString(),
        hasCycle: !!currentCycle,
        cycleInAcceptance: currentCycle?.inAcceptance,
        cycleTester: currentCycle?.tester,
      }));
      
      if (currentCycle && currentCycle.inAcceptance && currentCycle.tester === currentTester) {
        currentCycle.periods.push({
          start: t.timestamp,
          end: null,
          hours: 0,
        });
        currentCycle.inAcceptance = false;
        
        console.log('[STG_CYCLE_MERGE]', JSON.stringify({
          workItemId,
          tester: currentTester,
          reason: 'Same tester returning from Acceptance',
          periodsCount: currentCycle.periods.length,
        }));
      } else {
        if (currentCycle) {
          const endReason = currentCycle.inAcceptance 
            ? 'Tester Changed (different tester took over from Acceptance)' 
            : 'New cycle started by different tester';
          closeCycle(t.timestamp, endReason, true, 'Cycle closed before new tester, iteration counted');
        }
        
        currentCycle = {
          tester: currentTester,
          cycleStart: t.timestamp,
          periods: [{ start: t.timestamp, end: null, hours: 0 }],
          inAcceptance: false,
        };
        
        console.log('[STG_CYCLE_START]', JSON.stringify({
          workItemId,
          tester: currentTester,
          cycleStart: t.timestamp.toISOString(),
          fromState: t.fromState,
        }));
      }
    }
    else if (t.fromState === STATES.STG_IN_TESTING && t.toState === STATES.STG_ACCEPTANCE_TESTING) {
      if (currentCycle) {
        const lastPeriod = currentCycle.periods[currentCycle.periods.length - 1];
        if (lastPeriod && lastPeriod.end === null) {
          lastPeriod.end = t.timestamp;
          lastPeriod.hours = (t.timestamp.getTime() - lastPeriod.start.getTime()) / (1000 * 60 * 60);
        }
        currentCycle.inAcceptance = true;
        
        if (t.nextInTestingTester && t.nextInTestingTester !== currentCycle.tester) {
          closeCycle(t.timestamp, 'Tester Changed (handed off to different tester)', true, 'Cycle closed before handoff, iteration counted');
        }
        
        console.log('[STG_TO_ACCEPTANCE]', JSON.stringify({
          workItemId,
          tester: currentCycle?.tester,
          periodHours: lastPeriod?.hours ? Math.round(lastPeriod.hours * 100) / 100 : 0,
          nextTester: t.nextInTestingTester || 'unknown',
          willClose: t.nextInTestingTester && t.nextInTestingTester !== currentCycle?.tester,
        }));
      }
    }
    else if (currentCycle && t.fromState === STATES.STG_IN_TESTING && STG_CYCLE_CLOSING_STATES.includes(t.toState as any)) {
      closeCycle(t.timestamp, `${t.toState}`, true, `Cycle completed with ${t.toState}, iteration counted`);
    }
    else if (currentCycle && currentCycle.inAcceptance && 
             t.fromState === STATES.STG_ACCEPTANCE_TESTING &&
             STG_CYCLE_CLOSING_STATES.includes(t.toState as any)) {
      closeCycle(t.timestamp, `${t.toState}`, true, `Cycle closed from Acceptance with ${t.toState}, iteration counted`);
    }
  }
  
  if (currentCycle) {
    const lastTransition = transitions[transitions.length - 1];
    closeCycle(lastTransition?.timestamp || new Date(), 'End of transitions (cycle incomplete)', false, 'Cycle not completed, no closing transition');
  }
  
  return { metrics: testerMetrics, debugCycles, totalIterations, totalTestingHours };
}

/**
 * Get PR comments from linked PRs
 */
async function getPRComments(
  organization: string,
  project: string,
  workItem: WorkItem,
  pat: string
): Promise<{ 
  commentsByAuthor: Map<string, number>; 
  prCount: number;
  debugComments: Array<{ prId: string; author: string; counted: boolean; reason: string }>;
}> {
  const commentsByAuthor = new Map<string, number>();
  const debugComments: Array<{ prId: string; author: string; counted: boolean; reason: string }> = [];
  let prCount = 0;
  
  if (!workItem.relations) {
    return { commentsByAuthor, prCount, debugComments };
  }
  
  const prLinks = workItem.relations.filter(
    r => r.rel === 'ArtifactLink' && r.url.includes('PullRequestId')
  );
  
  for (const link of prLinks) {
    try {
      const match = link.url.match(/PullRequestId\/[^%]+%2F([^%]+)%2F(\d+)/);
      if (!match) continue;
      
      const repoId = match[1];
      const prId = match[2];
      prCount++;
      
      const threadsUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/threads?api-version=7.1`;
      const threadsResult = await azureRequest(threadsUrl, pat) as { value: Array<{ comments: Array<{ author: { displayName: string }; parentCommentId?: number; commentType?: string }> }> };
      
      for (const thread of threadsResult.value || []) {
        for (const comment of thread.comments || []) {
          const author = comment.author?.displayName || 'Unknown';
          const isTopLevel = !comment.parentCommentId;
          const isSystem = comment.commentType === 'system';

          if (!isTopLevel) {
            debugComments.push({ prId, author, counted: false, reason: 'Reply (has parentCommentId)' });
            continue;
          }
          
          if (isSystem) {
            debugComments.push({ prId, author, counted: false, reason: 'System comment' });
            continue;
          }
          
          commentsByAuthor.set(author, (commentsByAuthor.get(author) || 0) + 1);
          debugComments.push({ prId, author, counted: true, reason: 'Valid top-level comment' });
        }
      }
    } catch {
      console.log(`Could not access PR for work item ${workItem.id}`);
    }
  }
  
  return { commentsByAuthor, prCount, debugComments };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization, project, queryId, pat } = await req.json();

    if (!organization || !project || !queryId || !pat) {
      throw new Error('Missing required fields: organization, project, queryId, pat');
    }

    console.log(`Starting analysis for ${organization}/${project}`);

    const workItemIds = await executeQuery(organization, project, queryId, pat);
    console.log(`Found ${workItemIds.length} work items`);

    if (workItemIds.length === 0) {
      return new Response(
        JSON.stringify({
          developerMetrics: [],
          testerMetrics: [],
          prCommentAuthors: [],
          summary: {
            totalWorkItems: 0,
            totalRequirements: 0,
            totalBugs: 0,
            totalTasks: 0,
            avgDevTimeHours: 0,
            avgDevTestTimeHours: 0,
            avgStgTestTimeHours: 0,
            totalReturns: 0,
            totalPrComments: 0,
          },
          chartData: {
            developmentSpeed: [],
            testingSpeed: [],
            returns: [],
            iterations: [],
            prComments: [],
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const workItems = await getWorkItems(organization, project, workItemIds, pat);
    console.log(`Fetched ${workItems.length} work items with details`);

    const requirements = workItems.filter(wi => wi.fields['System.WorkItemType'] === 'Requirement');
    const bugs = workItems.filter(wi => wi.fields['System.WorkItemType'] === 'Bug');
    const tasks = workItems.filter(wi => wi.fields['System.WorkItemType'] === 'Task');
    
    const metricsItems = [...requirements, ...bugs];
    const prItems = workItems;

    console.log(`Processing ${requirements.length} requirements, ${bugs.length} bugs, ${tasks.length} tasks`);

    const developerData: Map<string, {
      totalDevHours: number;
      devCycles: number;
      codeReviewReturns: number;
      devTestingReturns: number;
      stgTestingReturns: number;
      itemsCompleted: number;
      tasksWorkedOn: Set<number>;
    }> = new Map();

    const testerData: Map<string, {
      closedItems: Set<number>;
      totalDevTestingHours: number;
      devTestingCycles: number;
      totalStgTestingHours: number;
      stgTestingCycles: number;
      devIterations: number;
      stgIterations: number;
      tasksWorkedOn: Set<number>;
      prsReviewed: number;
    }> = new Map();

    const allTesters = new Set<string>();
    const allPrComments: Map<string, number> = new Map();
    const prCountByAuthor: Map<string, number> = new Map();

    let globalDevTotalHours = 0;
    let globalDevTestingTotalHours = 0;
    let globalStgTestingTotalHours = 0;
    const numTasks = metricsItems.length;

    for (const workItem of metricsItems) {
      const revisions = await getWorkItemRevisions(organization, project, workItem.id, pat);
      const transitions = extractTransitions(revisions, workItem.id);
      const workItemType = workItem.fields['System.WorkItemType'] as string;
      const finalState = workItem.fields['System.State'] as string;
      
      const tester1 = getDisplayName(workItem.fields['Custom.TestedBy1']);
      const tester2 = getDisplayName(workItem.fields['Custom.TestedBy2']);
      if (tester1) allTesters.add(tester1);
      if (tester2) allTesters.add(tester2);
      
      const devTimeResult = calculateDevelopmentTime(transitions, workItem.id);
      globalDevTotalHours += devTimeResult.totalHours;

      for (const [developer, data] of devTimeResult.developerCycles) {
        if (!developerData.has(developer)) {
          developerData.set(developer, {
            totalDevHours: 0,
            devCycles: 0,
            codeReviewReturns: 0,
            devTestingReturns: 0,
            stgTestingReturns: 0,
            itemsCompleted: 0,
            tasksWorkedOn: new Set(),
          });
        }
        const devData = developerData.get(developer)!;
        devData.totalDevHours += data.totalHours;
        devData.devCycles += data.cycles;
        devData.tasksWorkedOn.add(workItem.id);
      }
      
      const returns = countReturns(transitions, workItem.id);

      for (const [developer, returnData] of returns.returnsByDeveloper) {
        if (!developerData.has(developer)) {
          developerData.set(developer, {
            totalDevHours: 0,
            devCycles: 0,
            codeReviewReturns: 0,
            devTestingReturns: 0,
            stgTestingReturns: 0,
            itemsCompleted: 0,
            tasksWorkedOn: new Set(),
          });
        }
        const devData = developerData.get(developer)!;
        devData.codeReviewReturns += returnData.codeReview;
        devData.devTestingReturns += returnData.devTesting;
        devData.stgTestingReturns += returnData.stgTesting;
        devData.tasksWorkedOn.add(workItem.id);
      }

      if (workItem.fields['System.State'] === STATES.RELEASED) {
        let maxCyclesDev: string | null = null;
        let maxCycles = 0;
        for (const [dev, data] of devTimeResult.developerCycles) {
          if (data.cycles > maxCycles) {
            maxCycles = data.cycles;
            maxCyclesDev = dev;
          }
        }
        if (maxCyclesDev && developerData.has(maxCyclesDev)) {
          developerData.get(maxCyclesDev)!.itemsCompleted++;
        }
      }
      
      const devTestingResult = calculateDevTestingMetrics(transitions, workItem.id);
      const taskDevTestingTotalHours = devTestingResult.totalTestingHours;
      const taskDevIterations = devTestingResult.totalIterations;

      for (const [tester, data] of devTestingResult.metrics) {
        if (!testerData.has(tester)) {
          testerData.set(tester, {
            closedItems: new Set(),
            totalDevTestingHours: 0,
            devTestingCycles: 0,
            totalStgTestingHours: 0,
            stgTestingCycles: 0,
            devIterations: 0,
            stgIterations: 0,
            tasksWorkedOn: new Set(),
            prsReviewed: 0,
          });
        }
        const testData = testerData.get(tester)!;
        testData.totalDevTestingHours += data.totalHours;
        testData.devTestingCycles += data.cycles;
        testData.devIterations += data.iterations;
        testData.tasksWorkedOn.add(workItem.id);
        
        if (workItem.fields['System.State'] === STATES.RELEASED) {
          testData.closedItems.add(workItem.id);
        }
      }
      globalDevTestingTotalHours += taskDevTestingTotalHours;

      const stgTestingResult = calculateStgTestingMetrics(transitions, workItem.id);
      const taskStgTestingTotalHours = stgTestingResult.totalTestingHours;
      const taskStgIterations = stgTestingResult.totalIterations;

      for (const [tester, data] of stgTestingResult.metrics) {
        if (!testerData.has(tester)) {
          testerData.set(tester, {
            closedItems: new Set(),
            totalDevTestingHours: 0,
            devTestingCycles: 0,
            totalStgTestingHours: 0,
            stgTestingCycles: 0,
            devIterations: 0,
            stgIterations: 0,
            tasksWorkedOn: new Set(),
            prsReviewed: 0,
          });
        }
        const testData = testerData.get(tester)!;
        testData.totalStgTestingHours += data.totalHours;
        testData.stgTestingCycles += data.cycles;
        testData.stgIterations += data.iterations;
        testData.tasksWorkedOn.add(workItem.id);
        
        if (workItem.fields['System.State'] === STATES.RELEASED) {
          testData.closedItems.add(workItem.id);
        }
      }
      globalStgTestingTotalHours += taskStgTestingTotalHours;

      // Emit structured debug log for this work item
      const debugLog: WorkItemDebugLog = {
        workItemId: workItem.id,
        type: workItemType,
        finalState,
        transitions: transitions.map(t => ({
          timestamp: t.timestamp.toISOString(),
          fromState: t.fromState,
          toState: t.toState,
          changedBy: t.changedBy,
          assignedTo: t.assignedTo,
        })),
        development: {
          activePeriods: devTimeResult.debugPeriods,
          totalActiveHours: Math.round(devTimeResult.totalHours * 100) / 100,
          participatesInDevAvg: devTimeResult.totalHours > 0,
          reason: devTimeResult.totalHours > 0 
            ? `Has ${devTimeResult.cycles} development cycle(s)` 
            : 'No completed Active periods found',
        },
        devTesting: {
          cycles: devTestingResult.debugCycles,
          totalTestingHours: Math.round(taskDevTestingTotalHours * 100) / 100,
          totalIterations: taskDevIterations,
        },
        stgTesting: {
          cycles: stgTestingResult.debugCycles,
          totalTestingHours: Math.round(taskStgTestingTotalHours * 100) / 100,
          totalIterations: taskStgIterations,
        },
        returns: returns.debugReturns,
        prComments: [],
        aggregation: {
          taskDevTestingTotalHours: Math.round(taskDevTestingTotalHours * 100) / 100,
          taskStgTestingTotalHours: Math.round(taskStgTestingTotalHours * 100) / 100,
          taskDevIterations,
          taskStgIterations,
          includedInAverages: true,
        },
      };
      
      emitWorkItemDebugLog(debugLog);
    }

    // Process all items for PR comments
    for (const workItem of prItems) {
      const { commentsByAuthor, prCount, debugComments } = await getPRComments(organization, project, workItem, pat);
      
      if (debugComments.length > 0) {
        console.log('[PR_COMMENTS_DEBUG]', JSON.stringify({
          workItemId: workItem.id,
          prCount,
          comments: debugComments,
        }, null, 2));
      }
      
      for (const [author, count] of commentsByAuthor) {
        allPrComments.set(author, (allPrComments.get(author) || 0) + count);
        prCountByAuthor.set(author, (prCountByAuthor.get(author) || 0) + prCount);
        
        if (testerData.has(author)) {
          testerData.get(author)!.prsReviewed += prCount;
        }
      }
    }

    // Log final averaging info
    console.log('[AVERAGING_SUMMARY]', JSON.stringify({
      numTasksForAverage: numTasks,
      globalDevTotalHours: Math.round(globalDevTotalHours * 100) / 100,
      globalDevTestingTotalHours: Math.round(globalDevTestingTotalHours * 100) / 100,
      globalStgTestingTotalHours: Math.round(globalStgTestingTotalHours * 100) / 100,
      avgDevTimeHours: numTasks > 0 ? Math.round((globalDevTotalHours / numTasks) * 100) / 100 : 0,
      avgDevTestTimeHours: numTasks > 0 ? Math.round((globalDevTestingTotalHours / numTasks) * 100) / 100 : 0,
      avgStgTestTimeHours: numTasks > 0 ? Math.round((globalStgTestingTotalHours / numTasks) * 100) / 100 : 0,
    }, null, 2));

    const developerMetrics: DeveloperMetrics[] = Array.from(developerData.entries())
      .map(([developer, data]) => {
        const taskCount = data.tasksWorkedOn.size;
        return {
          developer,
          avgDevTimeHours: taskCount > 0 ? data.totalDevHours / taskCount : 0,
          developmentCycles: data.devCycles,
          totalReturnCount: data.codeReviewReturns + data.devTestingReturns + data.stgTestingReturns,
          codeReviewReturns: data.codeReviewReturns,
          devTestingReturns: data.devTestingReturns,
          stgTestingReturns: data.stgTestingReturns,
          itemsCompleted: data.itemsCompleted,
          avgTotalReturnsPerTask: taskCount > 0
            ? (data.codeReviewReturns + data.devTestingReturns + data.stgTestingReturns) / taskCount
            : 0,
          avgCodeReviewReturnsPerTask: taskCount > 0 ? data.codeReviewReturns / taskCount : 0,
          avgDevTestingReturnsPerTask: taskCount > 0 ? data.devTestingReturns / taskCount : 0,
          avgStgTestingReturnsPerTask: taskCount > 0 ? data.stgTestingReturns / taskCount : 0,
        };
      })
      .sort((a, b) => b.itemsCompleted - a.itemsCompleted);

    const testerMetrics: TesterMetrics[] = Array.from(testerData.entries())
      .map(([tester, data]) => {
        const taskCount = data.tasksWorkedOn.size;
        const prCount = data.prsReviewed || prCountByAuthor.get(tester) || 0;
        const commentCount = allPrComments.get(tester) || 0;
        
        return {
          tester,
          closedItemsCount: data.closedItems.size,
          avgDevTestTimeHours: taskCount > 0 ? data.totalDevTestingHours / taskCount : 0,
          avgStgTestTimeHours: taskCount > 0 ? data.totalStgTestingHours / taskCount : 0,
          devTestingCycles: data.devTestingCycles,
          stgTestingCycles: data.stgTestingCycles,
          devTestingIterations: data.devIterations,
          stgTestingIterations: data.stgIterations,
          prCommentsCount: commentCount,
          avgDevIterationsPerTask: taskCount > 0 ? data.devIterations / taskCount : 0,
          avgStgIterationsPerTask: taskCount > 0 ? data.stgIterations / taskCount : 0,
          avgPrCommentsPerPr: prCount > 0 ? commentCount / prCount : 0,
          tasksWorkedOn: taskCount,
          prsReviewed: prCount,
        };
      })
      .sort((a, b) => b.closedItemsCount - a.closedItemsCount);

    const prCommentAuthors: PRCommentAuthor[] = Array.from(allPrComments.entries())
      .map(([author, count]) => ({
        author,
        count,
        isTester: allTesters.has(author),
      }))
      .sort((a, b) => b.count - a.count);

    const totalReturns = developerMetrics.reduce((sum, d) => sum + d.totalReturnCount, 0);
    const totalPrComments = Array.from(allPrComments.values()).reduce((sum, count) => sum + count, 0);

    const summary = {
      totalWorkItems: workItems.length,
      totalRequirements: requirements.length,
      totalBugs: bugs.length,
      totalTasks: tasks.length,
      avgDevTimeHours: numTasks > 0 ? globalDevTotalHours / numTasks : 0,
      avgDevTestTimeHours: numTasks > 0 ? globalDevTestingTotalHours / numTasks : 0,
      avgStgTestTimeHours: numTasks > 0 ? globalStgTestingTotalHours / numTasks : 0,
      totalReturns,
      totalPrComments,
    };

    const chartData = {
      developmentSpeed: developerMetrics
        .filter(d => d.avgDevTimeHours > 0)
        .slice(0, 10)
        .map(d => ({ name: d.developer, value: Math.round(d.avgDevTimeHours * 10) / 10 })),
      testingSpeed: [
        ...testerMetrics.filter(t => t.avgDevTestTimeHours > 0).slice(0, 5).map(t => ({
          name: `${t.tester} (DEV)`,
          value: Math.round(t.avgDevTestTimeHours * 10) / 10,
          category: 'DEV',
        })),
        ...testerMetrics.filter(t => t.avgStgTestTimeHours > 0).slice(0, 5).map(t => ({
          name: `${t.tester} (STG)`,
          value: Math.round(t.avgStgTestTimeHours * 10) / 10,
          category: 'STG',
        })),
      ],
      returns: developerMetrics
        .filter(d => d.totalReturnCount > 0)
        .slice(0, 10)
        .map(d => ({ name: d.developer, value: d.totalReturnCount })),
      iterations: testerMetrics
        .slice(0, 10)
        .map(t => ({ name: t.tester, value: t.devTestingIterations + t.stgTestingIterations })),
      prComments: prCommentAuthors
        .slice(0, 10)
        .map(p => ({ name: p.author, value: p.count, isTester: p.isTester })),
    };

    console.log(`Analysis complete. Developers: ${developerMetrics.length}, Testers: ${testerMetrics.length}`);

    return new Response(
      JSON.stringify({
        developerMetrics,
        testerMetrics,
        prCommentAuthors,
        summary,
        chartData,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Analysis error:', error);
    
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

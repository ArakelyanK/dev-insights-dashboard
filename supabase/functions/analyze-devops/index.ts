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
  DEV_APPROVED: 'DEV_Approved',
  APPROVED: 'Approved',
  READY_FOR_RELEASE: 'Ready For Release',
  RELEASED: 'Released',
  PAUSED: 'Paused',
} as const;

// Batching configuration - NO LIMITS, just batch sizes for API efficiency
const WORK_ITEM_BATCH_SIZE = 200; // Azure DevOps API limit
const REVISION_BATCH_SIZE = 20;   // Parallel revision fetches
const PR_BATCH_SIZE = 15;         // Parallel PR thread fetches

// Drill-down data interfaces
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
  // Drill-down lists
  workItems: WorkItemReference[];
  returnItems: WorkItemReference[];
  codeReviewReturnItems: WorkItemReference[];
  devTestingReturnItems: WorkItemReference[];
  stgTestingReturnItems: WorkItemReference[];
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
  // Drill-down lists
  closedItems: WorkItemReference[];
  devIterationItems: WorkItemReference[];
  stgIterationItems: WorkItemReference[];
  prCommentDetails: PRReference[];
}

interface PRCommentAuthor {
  author: string;
  count: number;
  isTester: boolean;
  prDetails: PRReference[];
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
 * Execute a saved query to get ALL work item IDs (no limits)
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
 * Get work items with relations in batches (Azure API limit is 200)
 */
async function getWorkItems(
  organization: string,
  project: string,
  ids: number[],
  pat: string
): Promise<WorkItem[]> {
  if (ids.length === 0) return [];

  const allWorkItems: WorkItem[] = [];

  for (let i = 0; i < ids.length; i += WORK_ITEM_BATCH_SIZE) {
    const batchIds = ids.slice(i, i + WORK_ITEM_BATCH_SIZE);
    const idsParam = batchIds.join(',');
    const url = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems?ids=${idsParam}&$expand=relations&api-version=7.1`;
    
    console.log(`Fetching work items batch ${Math.floor(i / WORK_ITEM_BATCH_SIZE) + 1}/${Math.ceil(ids.length / WORK_ITEM_BATCH_SIZE)}`);
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
 * Extract AssignedTo history from revisions
 */
function extractAssignedToHistory(revisions: WorkItemRevision[]): string[] {
  const history: string[] = [];
  let lastAssignedTo: string | null = null;
  
  for (const rev of revisions) {
    const assignedTo = getDisplayName(rev.fields['System.AssignedTo']);
    if (assignedTo && assignedTo !== lastAssignedTo) {
      history.push(assignedTo);
      lastAssignedTo = assignedTo;
    }
  }
  
  return history;
}

/**
 * Get current or last known AssignedTo
 */
function getCurrentAssignedTo(workItem: WorkItem, assignedToHistory: string[]): string {
  const current = getDisplayName(workItem.fields['System.AssignedTo']);
  if (current) return current;
  
  // Fallback to last known from history
  if (assignedToHistory.length > 0) {
    return assignedToHistory[assignedToHistory.length - 1];
  }
  
  return 'Unassigned';
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
function calculateDevelopmentTime(transitions: TransitionEvent[]): {
  totalHours: number;
  cycles: number;
  stoppedAtAcceptance: boolean;
} {
  let totalHours = 0;
  let cycles = 0;
  let activeStartTimestamp: Date | null = null;

  for (const t of transitions) {
    if (t.toState === STATES.DEV_ACCEPTANCE_TESTING) {
      if (activeStartTimestamp) {
        const hours = (t.timestamp.getTime() - activeStartTimestamp.getTime()) / (1000 * 60 * 60);
        totalHours += hours;
        cycles++;
        activeStartTimestamp = null;
      }
      return { totalHours, cycles, stoppedAtAcceptance: true };
    }

    if (t.toState === STATES.ACTIVE) {
      activeStartTimestamp = t.timestamp;
    }
    else if (t.fromState === STATES.ACTIVE && activeStartTimestamp) {
      const hours = (t.timestamp.getTime() - activeStartTimestamp.getTime()) / (1000 * 60 * 60);
      totalHours += hours;
      cycles++;
      activeStartTimestamp = null;
    }
  }

  return { totalHours, cycles, stoppedAtAcceptance: false };
}

/**
 * Count returns to Fix Required
 */
function countReturns(transitions: TransitionEvent[]): {
  codeReviewReturns: number;
  devTestingReturns: number;
  stgTestingReturns: number;
  totalReturns: number;
} {
  let codeReviewReturns = 0;
  let devTestingReturns = 0;
  let stgTestingReturns = 0;

  for (const t of transitions) {
    if (t.toState === STATES.FIX_REQUIRED) {
      if (t.fromState === STATES.CODE_REVIEW) {
        codeReviewReturns++;
      } else if (t.fromState === STATES.DEV_IN_TESTING || t.fromState === STATES.DEV_ACCEPTANCE_TESTING) {
        devTestingReturns++;
      } else if (t.fromState === STATES.STG_IN_TESTING || t.fromState === STATES.STG_ACCEPTANCE_TESTING) {
        stgTestingReturns++;
      }
    }
  }

  return { 
    codeReviewReturns, 
    devTestingReturns, 
    stgTestingReturns,
    totalReturns: codeReviewReturns + devTestingReturns + stgTestingReturns
  };
}

/**
 * Calculate DEV testing metrics with corrected cycle logic
 */
function calculateDevTestingMetrics(transitions: TransitionEvent[], workItemId: number): {
  metrics: Map<string, { totalHours: number; cycles: number; iterations: number }>;
  totalIterations: number;
  totalTestingHours: number;
} {
  const testerMetrics = new Map<string, { totalHours: number; cycles: number; iterations: number }>();
  
  let currentCycle: {
    tester: string;
    cycleStart: Date;
    inTestingStart: Date;
    periods: Array<{ start: Date; end: Date; hours: number }>;
    pendingMerge: boolean;
    pendingMergeEnd: Date | null;
  } | null = null;
  
  let totalIterations = 0;
  let totalTestingHours = 0;
  
  function closeCycle(endTime: Date) {
    if (!currentCycle) return;
    
    const cycleTotalHours = currentCycle.periods.reduce((sum, p) => sum + p.hours, 0);
    
    if (!testerMetrics.has(currentCycle.tester)) {
      testerMetrics.set(currentCycle.tester, { totalHours: 0, cycles: 0, iterations: 0 });
    }
    const data = testerMetrics.get(currentCycle.tester)!;
    data.totalHours += cycleTotalHours;
    data.cycles++;
    data.iterations++;
    totalIterations++;
    totalTestingHours += cycleTotalHours;
    
    currentCycle = null;
  }
  
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    
    if (t.toState === STATES.DEV_IN_TESTING) {
      const currentTester = t.changedBy || t.assignedTo || 'Unknown';
      
      if (currentCycle && currentCycle.pendingMerge && 
          t.fromState === STATES.DEV_ACCEPTANCE_TESTING &&
          currentCycle.tester === currentTester) {
        currentCycle.periods.push({
          start: t.timestamp,
          end: t.timestamp,
          hours: 0,
        });
        currentCycle.pendingMerge = false;
        currentCycle.pendingMergeEnd = null;
        currentCycle.inTestingStart = t.timestamp;
      } else {
        if (currentCycle) {
          const closeTime = currentCycle.pendingMergeEnd || t.timestamp;
          closeCycle(closeTime);
        }
        
        currentCycle = {
          tester: currentTester,
          cycleStart: t.timestamp,
          inTestingStart: t.timestamp,
          periods: [{ start: t.timestamp, end: t.timestamp, hours: 0 }],
          pendingMerge: false,
          pendingMergeEnd: null,
        };
      }
    }
    else if (t.fromState === STATES.DEV_IN_TESTING && currentCycle) {
      const hours = (t.timestamp.getTime() - currentCycle.inTestingStart.getTime()) / (1000 * 60 * 60);
      const lastPeriod = currentCycle.periods[currentCycle.periods.length - 1];
      lastPeriod.end = t.timestamp;
      lastPeriod.hours = hours;
      
      if (t.toState === STATES.DEV_ACCEPTANCE_TESTING) {
        let canMerge = false;
        
        for (let j = i + 1; j < transitions.length; j++) {
          const nextT = transitions[j];
          if (nextT.toState === STATES.DEV_IN_TESTING) {
            const nextTester = nextT.changedBy || nextT.assignedTo || 'Unknown';
            if (nextT.fromState === STATES.DEV_ACCEPTANCE_TESTING && nextTester === currentCycle.tester) {
              canMerge = true;
            }
            break;
          }
          if (nextT.toState !== STATES.DEV_ACCEPTANCE_TESTING && nextT.fromState === STATES.DEV_ACCEPTANCE_TESTING) {
            break;
          }
        }
        
        if (canMerge) {
          currentCycle.pendingMerge = true;
          currentCycle.pendingMergeEnd = t.timestamp;
        } else {
          closeCycle(t.timestamp);
        }
      } else {
        closeCycle(t.timestamp);
      }
    }
    else if (currentCycle && currentCycle.pendingMerge && t.fromState === STATES.DEV_ACCEPTANCE_TESTING) {
      if (t.toState !== STATES.DEV_IN_TESTING) {
        closeCycle(t.timestamp);
      }
    }
  }
  
  if (currentCycle) {
    const cycleTotalHours = currentCycle.periods.reduce((sum, p) => sum + p.hours, 0);
    
    if (!testerMetrics.has(currentCycle.tester)) {
      testerMetrics.set(currentCycle.tester, { totalHours: 0, cycles: 0, iterations: 0 });
    }
    const data = testerMetrics.get(currentCycle.tester)!;
    data.totalHours += cycleTotalHours;
    data.cycles++;
    // Don't count incomplete cycles as iterations
    totalTestingHours += cycleTotalHours;
    
    currentCycle = null;
  }
  
  return { metrics: testerMetrics, totalIterations, totalTestingHours };
}

/**
 * Calculate STG testing metrics with corrected cycle logic
 */
function calculateStgTestingMetrics(transitions: TransitionEvent[], workItemId: number): {
  metrics: Map<string, { totalHours: number; cycles: number; iterations: number }>;
  totalIterations: number;
  totalTestingHours: number;
} {
  const testerMetrics = new Map<string, { totalHours: number; cycles: number; iterations: number }>();
  
  let currentCycle: {
    tester: string;
    cycleStart: Date;
    inTestingStart: Date;
    periods: Array<{ start: Date; end: Date; hours: number }>;
    pendingMerge: boolean;
    pendingMergeEnd: Date | null;
  } | null = null;
  
  let totalIterations = 0;
  let totalTestingHours = 0;
  
  function closeCycle(endTime: Date) {
    if (!currentCycle) return;
    
    const cycleTotalHours = currentCycle.periods.reduce((sum, p) => sum + p.hours, 0);
    
    if (!testerMetrics.has(currentCycle.tester)) {
      testerMetrics.set(currentCycle.tester, { totalHours: 0, cycles: 0, iterations: 0 });
    }
    const data = testerMetrics.get(currentCycle.tester)!;
    data.totalHours += cycleTotalHours;
    data.cycles++;
    data.iterations++;
    totalIterations++;
    totalTestingHours += cycleTotalHours;
    
    currentCycle = null;
  }
  
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    
    if (t.toState === STATES.STG_IN_TESTING) {
      const currentTester = t.changedBy || t.assignedTo || 'Unknown';
      
      if (currentCycle && currentCycle.pendingMerge && 
          t.fromState === STATES.STG_ACCEPTANCE_TESTING &&
          currentCycle.tester === currentTester) {
        currentCycle.periods.push({
          start: t.timestamp,
          end: t.timestamp,
          hours: 0,
        });
        currentCycle.pendingMerge = false;
        currentCycle.pendingMergeEnd = null;
        currentCycle.inTestingStart = t.timestamp;
      } else {
        if (currentCycle) {
          const closeTime = currentCycle.pendingMergeEnd || t.timestamp;
          closeCycle(closeTime);
        }
        
        currentCycle = {
          tester: currentTester,
          cycleStart: t.timestamp,
          inTestingStart: t.timestamp,
          periods: [{ start: t.timestamp, end: t.timestamp, hours: 0 }],
          pendingMerge: false,
          pendingMergeEnd: null,
        };
      }
    }
    else if (t.fromState === STATES.STG_IN_TESTING && currentCycle) {
      const hours = (t.timestamp.getTime() - currentCycle.inTestingStart.getTime()) / (1000 * 60 * 60);
      const lastPeriod = currentCycle.periods[currentCycle.periods.length - 1];
      lastPeriod.end = t.timestamp;
      lastPeriod.hours = hours;
      
      if (t.toState === STATES.STG_ACCEPTANCE_TESTING) {
        let canMerge = false;
        
        for (let j = i + 1; j < transitions.length; j++) {
          const nextT = transitions[j];
          if (nextT.toState === STATES.STG_IN_TESTING) {
            const nextTester = nextT.changedBy || nextT.assignedTo || 'Unknown';
            if (nextT.fromState === STATES.STG_ACCEPTANCE_TESTING && nextTester === currentCycle.tester) {
              canMerge = true;
            }
            break;
          }
          if (nextT.toState !== STATES.STG_ACCEPTANCE_TESTING && nextT.fromState === STATES.STG_ACCEPTANCE_TESTING) {
            break;
          }
        }
        
        if (canMerge) {
          currentCycle.pendingMerge = true;
          currentCycle.pendingMergeEnd = t.timestamp;
        } else {
          closeCycle(t.timestamp);
        }
      } else {
        closeCycle(t.timestamp);
      }
    }
    else if (currentCycle && currentCycle.pendingMerge && t.fromState === STATES.STG_ACCEPTANCE_TESTING) {
      if (t.toState !== STATES.STG_IN_TESTING) {
        closeCycle(t.timestamp);
      }
    }
  }
  
  if (currentCycle) {
    const cycleTotalHours = currentCycle.periods.reduce((sum, p) => sum + p.hours, 0);
    
    if (!testerMetrics.has(currentCycle.tester)) {
      testerMetrics.set(currentCycle.tester, { totalHours: 0, cycles: 0, iterations: 0 });
    }
    const data = testerMetrics.get(currentCycle.tester)!;
    data.totalHours += cycleTotalHours;
    data.cycles++;
    totalTestingHours += cycleTotalHours;
    
    currentCycle = null;
  }
  
  return { metrics: testerMetrics, totalIterations, totalTestingHours };
}

/**
 * Get PR comments from linked PRs - returns detailed PR info for drill-down
 */
async function getPRComments(
  organization: string,
  project: string,
  workItem: WorkItem,
  pat: string
): Promise<{ 
  commentsByAuthor: Map<string, { count: number; prDetails: PRReference[] }>;
  prCount: number;
}> {
  const commentsByAuthor = new Map<string, { count: number; prDetails: PRReference[] }>();
  let prCount = 0;
  
  if (!workItem.relations) {
    return { commentsByAuthor, prCount };
  }
  
  const prLinks = workItem.relations.filter(
    r => r.rel === 'ArtifactLink' && r.url.includes('PullRequestId')
  );
  
  const workItemTitle = workItem.fields['System.Title'] as string;
  
  for (const link of prLinks) {
    try {
      const match = link.url.match(/PullRequestId\/[^%]+%2F([^%]+)%2F(\d+)/);
      if (!match) continue;
      
      const repoId = match[1];
      const prId = match[2];
      
      const threadsUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/threads?api-version=7.1`;
      const threads = await azureRequest(threadsUrl, pat) as { value: Array<{ comments: Array<{ author: { displayName: string }; commentType: string }> }> };
      
      prCount++;
      const prUrl = `https://dev.azure.com/${organization}/${project}/_git/${repoId}/pullrequest/${prId}`;
      
      for (const thread of threads.value) {
        if (thread.comments && thread.comments.length > 0) {
          const firstComment = thread.comments[0];
          if (firstComment.commentType === 'text') {
            const author = firstComment.author.displayName;
            
            if (!commentsByAuthor.has(author)) {
              commentsByAuthor.set(author, { count: 0, prDetails: [] });
            }
            const authorData = commentsByAuthor.get(author)!;
            authorData.count++;
            
            // Check if we already have this PR in the list
            const existingPr = authorData.prDetails.find(p => p.prId === prId);
            if (existingPr) {
              existingPr.commentsCount++;
            } else {
              authorData.prDetails.push({
                prId,
                prUrl,
                workItemId: workItem.id,
                workItemTitle,
                commentsCount: 1,
              });
            }
          }
        }
      }
    } catch (e) {
      console.log(`Could not access PR for work item ${workItem.id}: ${e}`);
    }
  }
  
  return { commentsByAuthor, prCount };
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

    console.log(`Starting analysis for ${organization}/${project} - NO LIMITS MODE`);

    // Step 1: Get ALL work item IDs from query (no limit)
    const workItemIds = await executeQuery(organization, project, queryId, pat);
    console.log(`Found ${workItemIds.length} work items - processing ALL`);

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
            devTestingSpeed: [],
            stgTestingSpeed: [],
            returns: [],
            devIterations: [],
            stgIterations: [],
            prComments: [],
          },
          unassignedItems: [],
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Fetch ALL work items in batches
    const workItems = await getWorkItems(organization, project, workItemIds, pat);
    console.log(`Fetched ${workItems.length} work items with details`);

    const requirements = workItems.filter(wi => wi.fields['System.WorkItemType'] === 'Requirement');
    const bugs = workItems.filter(wi => wi.fields['System.WorkItemType'] === 'Bug');
    const tasks = workItems.filter(wi => wi.fields['System.WorkItemType'] === 'Task');
    
    const metricsItems = [...requirements, ...bugs];

    console.log(`Processing ${requirements.length} requirements, ${bugs.length} bugs, ${tasks.length} tasks`);

    // Aggregation structures with drill-down data
    const developerData: Map<string, {
      totalDevHours: number;
      devCycles: number;
      codeReviewReturns: number;
      devTestingReturns: number;
      stgTestingReturns: number;
      itemsCompleted: number;
      tasksWorkedOn: Set<number>;
      workItems: Map<number, WorkItemReference>;
      returnItems: Map<number, WorkItemReference>;
      codeReviewReturnItems: Map<number, WorkItemReference>;
      devTestingReturnItems: Map<number, WorkItemReference>;
      stgTestingReturnItems: Map<number, WorkItemReference>;
    }> = new Map();

    const testerData: Map<string, {
      closedItems: Map<number, WorkItemReference>;
      totalDevTestingHours: number;
      devTestingCycles: number;
      totalStgTestingHours: number;
      stgTestingCycles: number;
      devIterations: number;
      stgIterations: number;
      tasksWorkedOn: Set<number>;
      prsReviewed: number;
      devIterationItems: Map<number, WorkItemReference>;
      stgIterationItems: Map<number, WorkItemReference>;
      prCommentDetails: PRReference[];
    }> = new Map();

    const allPrComments: Map<string, { count: number; prDetails: PRReference[] }> = new Map();
    const prCountByAuthor: Map<string, number> = new Map();
    const allTesters = new Set<string>();
    const unassignedItems: WorkItemReference[] = [];

    let numTasks = 0;
    let globalDevTotalHours = 0;
    let globalDevTestingTotalHours = 0;
    let globalStgTestingTotalHours = 0;

    // Step 3: Process work items for metrics in batches
    const totalBatches = Math.ceil(metricsItems.length / REVISION_BATCH_SIZE);
    console.log(`Processing ${metricsItems.length} metrics items in ${totalBatches} batches`);
    
    for (let batchStart = 0; batchStart < metricsItems.length; batchStart += REVISION_BATCH_SIZE) {
      const batch = metricsItems.slice(batchStart, batchStart + REVISION_BATCH_SIZE);
      const batchNum = Math.floor(batchStart / REVISION_BATCH_SIZE) + 1;
      console.log(`Metrics batch ${batchNum}/${totalBatches} (items ${batchStart + 1}-${batchStart + batch.length})`);
      
      // Fetch all revisions for this batch in parallel
      const batchRevisions = await Promise.all(
        batch.map(workItem => getWorkItemRevisions(organization, project, workItem.id, pat))
      );
      
      // Process each work item in the batch
      for (let i = 0; i < batch.length; i++) {
        const workItem = batch[i];
        const revisions = batchRevisions[i];
        const transitions = extractTransitions(revisions, workItem.id);
        
        const workItemType = workItem.fields['System.WorkItemType'] as string;
        const workItemTitle = workItem.fields['System.Title'] as string;
        const assignedToHistory = extractAssignedToHistory(revisions);
        const currentAssignedTo = getCurrentAssignedTo(workItem, assignedToHistory);
        const workItemUrl = `https://dev.azure.com/${organization}/${project}/_workitems/edit/${workItem.id}`;
        
        const workItemRef: WorkItemReference = {
          id: workItem.id,
          title: workItemTitle,
          type: workItemType,
          url: workItemUrl,
          count: 0,
          assignedToChanged: assignedToHistory.length > 1,
          assignedToHistory,
        };
        
        numTasks++;
        
        // Collect testers
        const tester1 = getDisplayName(workItem.fields['Custom.TestedBy1']);
        const tester2 = getDisplayName(workItem.fields['Custom.TestedBy2']);
        if (tester1) allTesters.add(tester1);
        if (tester2) allTesters.add(tester2);
        
        // Development time - aggregate by CURRENT Assigned To
        const devTimeResult = calculateDevelopmentTime(transitions);
        globalDevTotalHours += devTimeResult.totalHours;

        // Initialize developer data if needed
        if (!developerData.has(currentAssignedTo)) {
          developerData.set(currentAssignedTo, {
            totalDevHours: 0,
            devCycles: 0,
            codeReviewReturns: 0,
            devTestingReturns: 0,
            stgTestingReturns: 0,
            itemsCompleted: 0,
            tasksWorkedOn: new Set(),
            workItems: new Map(),
            returnItems: new Map(),
            codeReviewReturnItems: new Map(),
            devTestingReturnItems: new Map(),
            stgTestingReturnItems: new Map(),
          });
        }
        const devData = developerData.get(currentAssignedTo)!;
        devData.totalDevHours += devTimeResult.totalHours;
        devData.devCycles += devTimeResult.cycles;
        devData.tasksWorkedOn.add(workItem.id);
        
        // Add to workItems drill-down
        if (!devData.workItems.has(workItem.id)) {
          devData.workItems.set(workItem.id, { ...workItemRef, count: 1 });
        }
        
        // Track unassigned
        if (currentAssignedTo === 'Unassigned') {
          unassignedItems.push({ ...workItemRef, count: 1 });
        }
        
        // Returns - aggregate by CURRENT Assigned To
        const returns = countReturns(transitions);
        devData.codeReviewReturns += returns.codeReviewReturns;
        devData.devTestingReturns += returns.devTestingReturns;
        devData.stgTestingReturns += returns.stgTestingReturns;
        
        // Add to return drill-downs
        if (returns.totalReturns > 0) {
          const returnRef = { ...workItemRef, count: returns.totalReturns };
          devData.returnItems.set(workItem.id, returnRef);
        }
        if (returns.codeReviewReturns > 0) {
          devData.codeReviewReturnItems.set(workItem.id, { ...workItemRef, count: returns.codeReviewReturns });
        }
        if (returns.devTestingReturns > 0) {
          devData.devTestingReturnItems.set(workItem.id, { ...workItemRef, count: returns.devTestingReturns });
        }
        if (returns.stgTestingReturns > 0) {
          devData.stgTestingReturnItems.set(workItem.id, { ...workItemRef, count: returns.stgTestingReturns });
        }

        // Items completed (Released)
        if (workItem.fields['System.State'] === STATES.RELEASED) {
          devData.itemsCompleted++;
        }
        
        // DEV Testing metrics
        const devTestingResult = calculateDevTestingMetrics(transitions, workItem.id);
        globalDevTestingTotalHours += devTestingResult.totalTestingHours;

        for (const [tester, data] of devTestingResult.metrics) {
          if (!testerData.has(tester)) {
            testerData.set(tester, {
              closedItems: new Map(),
              totalDevTestingHours: 0,
              devTestingCycles: 0,
              totalStgTestingHours: 0,
              stgTestingCycles: 0,
              devIterations: 0,
              stgIterations: 0,
              tasksWorkedOn: new Set(),
              prsReviewed: 0,
              devIterationItems: new Map(),
              stgIterationItems: new Map(),
              prCommentDetails: [],
            });
          }
          const testData = testerData.get(tester)!;
          testData.totalDevTestingHours += data.totalHours;
          testData.devTestingCycles += data.cycles;
          testData.devIterations += data.iterations;
          testData.tasksWorkedOn.add(workItem.id);
          
          // Add to DEV iteration drill-down
          if (data.iterations > 0) {
            const existingItem = testData.devIterationItems.get(workItem.id);
            if (existingItem) {
              existingItem.count += data.iterations;
            } else {
              testData.devIterationItems.set(workItem.id, { ...workItemRef, count: data.iterations });
            }
          }
          
          if (workItem.fields['System.State'] === STATES.RELEASED) {
            if (!testData.closedItems.has(workItem.id)) {
              testData.closedItems.set(workItem.id, { ...workItemRef, count: 1 });
            }
          }
        }

        // STG Testing metrics
        const stgTestingResult = calculateStgTestingMetrics(transitions, workItem.id);
        globalStgTestingTotalHours += stgTestingResult.totalTestingHours;

        for (const [tester, data] of stgTestingResult.metrics) {
          if (!testerData.has(tester)) {
            testerData.set(tester, {
              closedItems: new Map(),
              totalDevTestingHours: 0,
              devTestingCycles: 0,
              totalStgTestingHours: 0,
              stgTestingCycles: 0,
              devIterations: 0,
              stgIterations: 0,
              tasksWorkedOn: new Set(),
              prsReviewed: 0,
              devIterationItems: new Map(),
              stgIterationItems: new Map(),
              prCommentDetails: [],
            });
          }
          const testData = testerData.get(tester)!;
          testData.totalStgTestingHours += data.totalHours;
          testData.stgTestingCycles += data.cycles;
          testData.stgIterations += data.iterations;
          testData.tasksWorkedOn.add(workItem.id);
          
          // Add to STG iteration drill-down
          if (data.iterations > 0) {
            const existingItem = testData.stgIterationItems.get(workItem.id);
            if (existingItem) {
              existingItem.count += data.iterations;
            } else {
              testData.stgIterationItems.set(workItem.id, { ...workItemRef, count: data.iterations });
            }
          }
          
          if (workItem.fields['System.State'] === STATES.RELEASED) {
            if (!testData.closedItems.has(workItem.id)) {
              testData.closedItems.set(workItem.id, { ...workItemRef, count: 1 });
            }
          }
        }
      }
    }

    // Step 4: Process ALL PR comments in batches (NO SKIPPING)
    const prTotalBatches = Math.ceil(workItems.length / PR_BATCH_SIZE);
    console.log(`Processing PR comments for ${workItems.length} items in ${prTotalBatches} batches`);
    
    for (let i = 0; i < workItems.length; i += PR_BATCH_SIZE) {
      const batch = workItems.slice(i, i + PR_BATCH_SIZE);
      const batchNum = Math.floor(i / PR_BATCH_SIZE) + 1;
      console.log(`PR batch ${batchNum}/${prTotalBatches}`);
      
      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(workItem => getPRComments(organization, project, workItem, pat))
      );
      
      for (let j = 0; j < batch.length; j++) {
        const { commentsByAuthor, prCount } = batchResults[j];
        
        for (const [author, data] of commentsByAuthor) {
          if (!allPrComments.has(author)) {
            allPrComments.set(author, { count: 0, prDetails: [] });
          }
          const authorData = allPrComments.get(author)!;
          authorData.count += data.count;
          authorData.prDetails.push(...data.prDetails);
          
          prCountByAuthor.set(author, (prCountByAuthor.get(author) || 0) + prCount);
          
          // Add PR details to tester data
          if (testerData.has(author)) {
            testerData.get(author)!.prsReviewed += prCount;
            testerData.get(author)!.prCommentDetails.push(...data.prDetails);
          }
        }
      }
    }

    // Step 5: Build final metrics with drill-down data
    console.log(`Building final metrics...`);

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
          // Drill-down lists
          workItems: Array.from(data.workItems.values()),
          returnItems: Array.from(data.returnItems.values()),
          codeReviewReturnItems: Array.from(data.codeReviewReturnItems.values()),
          devTestingReturnItems: Array.from(data.devTestingReturnItems.values()),
          stgTestingReturnItems: Array.from(data.stgTestingReturnItems.values()),
        };
      })
      .sort((a, b) => b.itemsCompleted - a.itemsCompleted);

    const testerMetrics: TesterMetrics[] = Array.from(testerData.entries())
      .map(([tester, data]) => {
        const taskCount = data.tasksWorkedOn.size;
        const prCount = data.prsReviewed || prCountByAuthor.get(tester) || 0;
        const commentCount = allPrComments.get(tester)?.count || 0;
        
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
          // Drill-down lists
          closedItems: Array.from(data.closedItems.values()),
          devIterationItems: Array.from(data.devIterationItems.values()),
          stgIterationItems: Array.from(data.stgIterationItems.values()),
          prCommentDetails: data.prCommentDetails,
        };
      })
      .sort((a, b) => b.closedItemsCount - a.closedItemsCount);

    const prCommentAuthors: PRCommentAuthor[] = Array.from(allPrComments.entries())
      .map(([author, data]) => ({
        author,
        count: data.count,
        isTester: allTesters.has(author),
        prDetails: data.prDetails,
      }))
      .sort((a, b) => b.count - a.count);

    const totalReturns = developerMetrics.reduce((sum, d) => sum + d.totalReturnCount, 0);
    const totalPrComments = Array.from(allPrComments.values()).reduce((sum, d) => sum + d.count, 0);

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
      devTestingSpeed: testerMetrics
        .filter(t => t.avgDevTestTimeHours > 0)
        .slice(0, 10)
        .map(t => ({ name: t.tester, value: Math.round(t.avgDevTestTimeHours * 10) / 10 })),
      stgTestingSpeed: testerMetrics
        .filter(t => t.avgStgTestTimeHours > 0)
        .slice(0, 10)
        .map(t => ({ name: t.tester, value: Math.round(t.avgStgTestTimeHours * 10) / 10 })),
      returns: developerMetrics
        .filter(d => d.totalReturnCount > 0)
        .slice(0, 10)
        .map(d => ({ name: d.developer, value: d.totalReturnCount })),
      devIterations: testerMetrics
        .filter(t => t.devTestingIterations > 0)
        .slice(0, 10)
        .map(t => ({ name: t.tester, value: t.devTestingIterations })),
      stgIterations: testerMetrics
        .filter(t => t.stgTestingIterations > 0)
        .slice(0, 10)
        .map(t => ({ name: t.tester, value: t.stgTestingIterations })),
      prComments: prCommentAuthors
        .slice(0, 10)
        .map(p => ({ name: p.author, value: p.count, isTester: p.isTester })),
    };

    console.log(`Analysis complete. Developers: ${developerMetrics.length}, Testers: ${testerMetrics.length}, Total items: ${workItems.length}`);

    return new Response(
      JSON.stringify({
        developerMetrics,
        testerMetrics,
        prCommentAuthors,
        summary,
        chartData,
        unassignedItems,
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

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
  APPROVED: 'Approved',
  READY_FOR_RELEASE: 'Ready For Release',
  RELEASED: 'Released',
} as const;

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
  changedBy: string | null; // Person who performed the transition
}

interface DeveloperMetrics {
  developer: string;
  avgDevTimeHours: number; // Renamed from developmentSpeedHours
  developmentCycles: number;
  totalReturnCount: number;
  codeReviewReturns: number;
  devTestingReturns: number;
  stgTestingReturns: number;
  itemsCompleted: number;
  // New per-task averages
  avgTotalReturnsPerTask: number;
  avgCodeReviewReturnsPerTask: number;
  avgDevTestingReturnsPerTask: number;
  avgStgTestingReturnsPerTask: number;
}

interface TesterMetrics {
  tester: string;
  closedItemsCount: number;
  avgDevTestTimeHours: number; // Renamed from avgDevTestingSpeedHours
  avgStgTestTimeHours: number; // Renamed from avgStgTestingSpeedHours
  devTestingCycles: number;
  stgTestingCycles: number;
  devTestingIterations: number;
  stgTestingIterations: number;
  prCommentsCount: number;
  // New per-task averages
  avgDevIterationsPerTask: number;
  avgStgIterationsPerTask: number;
  avgPrCommentsPerPr: number;
  tasksWorkedOn: number; // Track number of unique tasks for averages
  prsReviewed: number; // Track number of PRs for avg comments
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

  // Azure DevOps limits to 200 IDs per request
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
 * 
 * Rules:
 * - Sum ALL periods when task is in Active state
 * - Stop counting after first transition into DEV_Acceptance Testing
 * - Final average = totalActiveTime / numberOfTasks (NOT divided by cycles)
 * - Attribute each cycle to the developer assigned at the moment the cycle ENDS
 * 
 * Returns: { totalHours, cycles, developerCycles: Map<developer, { totalHours, cycles }> }
 */
function calculateDevelopmentTime(transitions: TransitionEvent[]): {
  totalHours: number;
  cycles: number;
  developerCycles: Map<string, { totalHours: number; cycles: number }>;
} {
  const developerCycles = new Map<string, { totalHours: number; cycles: number }>();
  let totalHours = 0;
  let cycles = 0;
  let activeStartTimestamp: Date | null = null;

  for (const t of transitions) {
    // Transition INTO Active starts a new development cycle
    if (t.toState === STATES.ACTIVE) {
      activeStartTimestamp = t.timestamp;
    }
    // Transition to Code Review ends the current Active cycle
    else if (t.toState === STATES.CODE_REVIEW && activeStartTimestamp) {
      const hours = (t.timestamp.getTime() - activeStartTimestamp.getTime()) / (1000 * 60 * 60);
      totalHours += hours;
      cycles++;

      // Attribute to developer who was assigned when the cycle ends
      const developer = t.assignedTo || 'Unassigned';
      if (!developerCycles.has(developer)) {
        developerCycles.set(developer, { totalHours: 0, cycles: 0 });
      }
      const devData = developerCycles.get(developer)!;
      devData.totalHours += hours;
      devData.cycles++;

      activeStartTimestamp = null;
    }
    // Transition to DEV_Acceptance Testing:
    // - If there's an open Active cycle, close it (handles skipped Code Review)
    // - Stop processing development cycles after this point
    else if (t.toState === STATES.DEV_ACCEPTANCE_TESTING) {
      if (activeStartTimestamp) {
        // Active → DEV_Acceptance Testing (Code Review skipped)
        const hours = (t.timestamp.getTime() - activeStartTimestamp.getTime()) / (1000 * 60 * 60);
        totalHours += hours;
        cycles++;

        // Attribute to developer assigned at end of cycle
        const developer = t.assignedTo || 'Unassigned';
        if (!developerCycles.has(developer)) {
          developerCycles.set(developer, { totalHours: 0, cycles: 0 });
        }
        const devData = developerCycles.get(developer)!;
        devData.totalHours += hours;
        devData.cycles++;

        activeStartTimestamp = null;
      }
      // Stop processing - development phase ends at first DEV_Acceptance Testing
      break;
    }
  }

  return { totalHours, cycles, developerCycles };
}

/**
 * Count returns to Fix Required
 * 
 * Keep the current simplified logic:
 * - Attribute returns based on the last known developer
 * - Track separate counts for Code Review, DEV Testing, and STG Testing returns
 */
function countReturns(transitions: TransitionEvent[]): {
  codeReviewReturns: number;
  devTestingReturns: number;
  stgTestingReturns: number;
  returnsByDeveloper: Map<string, { codeReview: number; devTesting: number; stgTesting: number }>;
} {
  let codeReviewReturns = 0;
  let devTestingReturns = 0;
  let stgTestingReturns = 0;
  const returnsByDeveloper = new Map<string, { codeReview: number; devTesting: number; stgTesting: number }>();

  // Track the last known developer (from development cycle completions)
  let lastKnownDeveloper: string | null = null;

  for (const t of transitions) {
    // Track developer from Active → Code Review or Active → DEV_Acceptance Testing transitions
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

      if (t.fromState === STATES.CODE_REVIEW) {
        codeReviewReturns++;
        devReturns.codeReview++;
      } else if (t.fromState === STATES.DEV_IN_TESTING) {
        devTestingReturns++;
        devReturns.devTesting++;
      } else if (t.fromState === STATES.STG_IN_TESTING) {
        stgTestingReturns++;
        devReturns.stgTesting++;
      }
    }
  }

  return { codeReviewReturns, devTestingReturns, stgTestingReturns, returnsByDeveloper };
}

/**
 * Calculate DEV testing metrics with proper tester attribution
 * 
 * Rules:
 * - Sum ALL time periods when task is in DEV_In Testing
 * - Testing ends ONLY on: Approved, Fix Required, Ready For Release
 * - Paused or Acceptance states DO NOT end testing
 * - Attribute the entire cycle duration to the person who performed the transition INTO DEV_In Testing
 * 
 * Iteration counting:
 * - Count a new iteration ONLY if:
 *   a) previous state was NOT DEV_Acceptance Testing, OR
 *   b) tester (changedBy) is different from the last tester
 * 
 * Returns: Map<tester, { totalHours, cycles, iterations }>
 */
function calculateDevTestingMetrics(transitions: TransitionEvent[]): Map<string, { totalHours: number; cycles: number; iterations: number }> {
  const testerMetrics = new Map<string, { totalHours: number; cycles: number; iterations: number }>();
  
  let devTestingStart: Date | null = null;
  let devTestingTester: string | null = null;
  let lastDevTestingTester: string | null = null;
  let lastExitWasAcceptance = false;
  
  for (const t of transitions) {
    if (t.toState === STATES.DEV_IN_TESTING) {
      // ROBUSTNESS FIX: If there's an open cycle, close it at the new transition's timestamp
      if (devTestingStart && devTestingTester) {
        const hours = (t.timestamp.getTime() - devTestingStart.getTime()) / (1000 * 60 * 60);
        
        if (!testerMetrics.has(devTestingTester)) {
          testerMetrics.set(devTestingTester, { totalHours: 0, cycles: 0, iterations: 0 });
        }
        const data = testerMetrics.get(devTestingTester)!;
        data.totalHours += hours;
        data.cycles++;
      }
      
      // Start of a new DEV testing cycle
      devTestingStart = t.timestamp;
      // Attribute to the person who moved the item INTO DEV_In Testing
      const currentTester = t.changedBy || t.assignedTo || 'Unknown';
      devTestingTester = currentTester;
      
      if (!testerMetrics.has(devTestingTester)) {
        testerMetrics.set(devTestingTester, { totalHours: 0, cycles: 0, iterations: 0 });
      }
      
      // ITERATION COUNTING FIX:
      // Only count as new iteration if:
      // - previous state was NOT DEV_Acceptance Testing, OR
      // - tester is different from last tester
      const isFromAcceptance = t.fromState === STATES.DEV_ACCEPTANCE_TESTING;
      const isSameTester = currentTester === lastDevTestingTester;
      
      if (!isFromAcceptance || !isSameTester) {
        testerMetrics.get(devTestingTester)!.iterations++;
      }
      
      lastDevTestingTester = currentTester;
      lastExitWasAcceptance = false;
    } 
    // Close cycle ONLY on: Approved, Fix Required, Ready For Release
    else if (devTestingStart && devTestingTester && 
             (t.toState === STATES.APPROVED || t.toState === STATES.FIX_REQUIRED || t.toState === STATES.READY_FOR_RELEASE)) {
      if (t.fromState === STATES.DEV_IN_TESTING) {
        const hours = (t.timestamp.getTime() - devTestingStart.getTime()) / (1000 * 60 * 60);
        
        if (!testerMetrics.has(devTestingTester)) {
          testerMetrics.set(devTestingTester, { totalHours: 0, cycles: 0, iterations: 0 });
        }
        const data = testerMetrics.get(devTestingTester)!;
        data.totalHours += hours;
        data.cycles++;
      }
      
      devTestingStart = null;
      devTestingTester = null;
    }
    // Track if we exit via acceptance state (for iteration logic)
    else if (t.fromState === STATES.DEV_IN_TESTING && t.toState === STATES.DEV_ACCEPTANCE_TESTING) {
      lastExitWasAcceptance = true;
      // Don't close the cycle - keep timing until actual end state
    }
  }
  
  return testerMetrics;
}

/**
 * Calculate STG testing metrics with proper tester attribution
 * 
 * Rules:
 * - Sum ALL time periods when task is in STG_In Testing
 * - Testing ends ONLY on: Approved, Fix Required, Ready For Release
 * - Paused or Acceptance states DO NOT end testing
 * - Attribute the entire cycle duration to the person who performed the transition INTO STG_In Testing
 * 
 * Iteration counting:
 * - Count a new iteration ONLY if:
 *   a) previous state was NOT STG_Acceptance Testing, OR
 *   b) tester (changedBy) is different from the last tester
 * 
 * Returns: Map<tester, { totalHours, cycles, iterations }>
 */
function calculateStgTestingMetrics(transitions: TransitionEvent[]): Map<string, { totalHours: number; cycles: number; iterations: number }> {
  const testerMetrics = new Map<string, { totalHours: number; cycles: number; iterations: number }>();
  
  let stgTestingStart: Date | null = null;
  let stgTestingTester: string | null = null;
  let lastStgTestingTester: string | null = null;
  let lastExitWasAcceptance = false;
  
  for (const t of transitions) {
    if (t.toState === STATES.STG_IN_TESTING) {
      // ROBUSTNESS FIX: If there's an open cycle, close it at the new transition's timestamp
      if (stgTestingStart && stgTestingTester) {
        const hours = (t.timestamp.getTime() - stgTestingStart.getTime()) / (1000 * 60 * 60);
        
        if (!testerMetrics.has(stgTestingTester)) {
          testerMetrics.set(stgTestingTester, { totalHours: 0, cycles: 0, iterations: 0 });
        }
        const data = testerMetrics.get(stgTestingTester)!;
        data.totalHours += hours;
        data.cycles++;
      }
      
      // Start of a new STG testing cycle
      stgTestingStart = t.timestamp;
      // Attribute to the person who moved the item INTO STG_In Testing
      const currentTester = t.changedBy || t.assignedTo || 'Unknown';
      stgTestingTester = currentTester;
      
      if (!testerMetrics.has(stgTestingTester)) {
        testerMetrics.set(stgTestingTester, { totalHours: 0, cycles: 0, iterations: 0 });
      }
      
      // ITERATION COUNTING FIX:
      // Only count as new iteration if:
      // - previous state was NOT STG_Acceptance Testing, OR
      // - tester is different from last tester
      const isFromAcceptance = t.fromState === STATES.STG_ACCEPTANCE_TESTING;
      const isSameTester = currentTester === lastStgTestingTester;
      
      if (!isFromAcceptance || !isSameTester) {
        testerMetrics.get(stgTestingTester)!.iterations++;
      }
      
      lastStgTestingTester = currentTester;
      lastExitWasAcceptance = false;
    } 
    // Close cycle ONLY on: Approved, Fix Required, Ready For Release
    else if (stgTestingStart && stgTestingTester && 
             (t.toState === STATES.APPROVED || t.toState === STATES.FIX_REQUIRED || t.toState === STATES.READY_FOR_RELEASE)) {
      if (t.fromState === STATES.STG_IN_TESTING) {
        const hours = (t.timestamp.getTime() - stgTestingStart.getTime()) / (1000 * 60 * 60);
        
        if (!testerMetrics.has(stgTestingTester)) {
          testerMetrics.set(stgTestingTester, { totalHours: 0, cycles: 0, iterations: 0 });
        }
        const data = testerMetrics.get(stgTestingTester)!;
        data.totalHours += hours;
        data.cycles++;
      }
      
      stgTestingStart = null;
      stgTestingTester = null;
    }
    // Track if we exit via acceptance state (for iteration logic)
    else if (t.fromState === STATES.STG_IN_TESTING && t.toState === STATES.STG_ACCEPTANCE_TESTING) {
      lastExitWasAcceptance = true;
      // Don't close the cycle - keep timing until actual end state
    }
  }
  
  return testerMetrics;
}

/**
 * Get PR comments from linked PRs - ONLY individual comments by the specific author
 * Do NOT count replies or comments from other users
 */
async function getPRComments(
  organization: string,
  project: string,
  workItem: WorkItem,
  pat: string
): Promise<{ commentsByAuthor: Map<string, number>; prCount: number }> {
  const commentsByAuthor = new Map<string, number>();
  let prCount = 0;
  
  if (!workItem.relations) {
    return { commentsByAuthor, prCount };
  }
  
  // Find ArtifactLink relations that are Pull Requests
  const prLinks = workItem.relations.filter(
    r => r.rel === 'ArtifactLink' && r.url.includes('PullRequestId')
  );
  
  for (const link of prLinks) {
    try {
      // Extract PR ID from the link URL
      // Format: vstfs:///Git/PullRequestId/{project}%2F{repoId}%2F{prId}
      const match = link.url.match(/PullRequestId\/[^%]+%2F([^%]+)%2F(\d+)/);
      if (!match) continue;
      
      const repoId = match[1];
      const prId = match[2];
      prCount++;
      
      // Get PR threads (comments)
      const threadsUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/threads?api-version=7.1`;
      const threadsResult = await azureRequest(threadsUrl, pat) as { value: Array<{ comments: Array<{ author: { displayName: string }; parentCommentId?: number; commentType?: string }> }> };
      
      for (const thread of threadsResult.value || []) {
        // Only count the FIRST comment in each thread (not replies)
        // Replies have parentCommentId set
        for (const comment of thread.comments || []) {
          // Skip replies (comments with parentCommentId)
          if (comment.parentCommentId) continue;
          
          // Skip system comments
          if (comment.commentType === 'system') continue;
          
          const author = comment.author?.displayName || 'Unknown';
          commentsByAuthor.set(author, (commentsByAuthor.get(author) || 0) + 1);
        }
      }
    } catch {
      // Skip this PR if we can't access it
      console.log(`Could not access PR for work item ${workItem.id}`);
    }
  }
  
  return { commentsByAuthor, prCount };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization, project, queryId, pat } = await req.json();

    // Validate inputs
    if (!organization || !project || !queryId || !pat) {
      throw new Error('Missing required fields: organization, project, queryId, pat');
    }

    console.log(`Starting analysis for ${organization}/${project}`);

    // Step 1: Execute query to get work item IDs
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

    // Step 2: Get work items with relations
    const workItems = await getWorkItems(organization, project, workItemIds, pat);
    console.log(`Retrieved ${workItems.length} work items with details`);

    // Categorize work items
    const requirements = workItems.filter(wi => wi.fields['System.WorkItemType'] === 'Requirement');
    const bugs = workItems.filter(wi => wi.fields['System.WorkItemType'] === 'Bug');
    const tasks = workItems.filter(wi => wi.fields['System.WorkItemType'] === 'Task');
    const metricsItems = [...requirements, ...bugs]; // Items for main metrics
    const prItems = [...requirements, ...bugs, ...tasks]; // Items for PR comments

    // Step 3: Process each work item for metrics
    // Developer data aggregation
    const developerData: Map<string, {
      totalDevHours: number;
      devCycles: number;
      codeReviewReturns: number;
      devTestingReturns: number;
      stgTestingReturns: number;
      itemsCompleted: number;
      tasksWorkedOn: Set<number>; // Track unique tasks for averaging
    }> = new Map();

    // Tester data aggregation
    const testerData: Map<string, {
      closedItems: Set<number>;
      totalDevTestingHours: number;
      devTestingCycles: number;
      totalStgTestingHours: number;
      stgTestingCycles: number;
      devIterations: number;
      stgIterations: number;
      tasksWorkedOn: Set<number>; // Track unique tasks
      prsReviewed: number; // Track PRs for avg comments
    }> = new Map();

    // All testers set - collected from TestedBy fields for PR comment filtering
    const allTesters = new Set<string>();

    // PR comments aggregation - strictly by author
    const allPrComments: Map<string, number> = new Map();
    // Track PRs per author for averaging
    const prCountByAuthor: Map<string, number> = new Map();

    // Global totals for summary calculations
    let globalDevTotalHours = 0;
    let globalDevTestingTotalHours = 0;
    let globalStgTestingTotalHours = 0;
    const numTasks = metricsItems.length;

    // Process Requirements and Bugs for metrics
    for (const workItem of metricsItems) {
      const revisions = await getWorkItemRevisions(organization, project, workItem.id, pat);
      const transitions = extractTransitions(revisions, workItem.id);
      
      // Collect testers from TestedBy fields for PR comment filtering only
      const tester1 = getDisplayName(workItem.fields['Custom.TestedBy1']);
      const tester2 = getDisplayName(workItem.fields['Custom.TestedBy2']);
      if (tester1) allTesters.add(tester1);
      if (tester2) allTesters.add(tester2);
      
      // Calculate development time with developer attribution at cycle end
      const devTimeResult = calculateDevelopmentTime(transitions);
      globalDevTotalHours += devTimeResult.totalHours;

      // Update developer metrics from development cycles
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
      
      // Count returns with developer attribution
      const returns = countReturns(transitions);
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

      // Track completed items - attribute to the developer who did the most cycles
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
      
      // Calculate DEV testing metrics
      const devTestingMetrics = calculateDevTestingMetrics(transitions);
      for (const [tester, data] of devTestingMetrics) {
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
        globalDevTestingTotalHours += data.totalHours;
        
        // Track closed items for this tester
        if (workItem.fields['System.State'] === STATES.RELEASED) {
          testData.closedItems.add(workItem.id);
        }
      }

      // Calculate STG testing metrics
      const stgTestingMetrics = calculateStgTestingMetrics(transitions);
      for (const [tester, data] of stgTestingMetrics) {
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
        globalStgTestingTotalHours += data.totalHours;
        
        // Track closed items for this tester
        if (workItem.fields['System.State'] === STATES.RELEASED) {
          testData.closedItems.add(workItem.id);
        }
      }
    }

    // Process all items (including Tasks) for PR comments - strictly by author
    for (const workItem of prItems) {
      const { commentsByAuthor, prCount } = await getPRComments(organization, project, workItem, pat);
      
      for (const [author, count] of commentsByAuthor) {
        allPrComments.set(author, (allPrComments.get(author) || 0) + count);
        prCountByAuthor.set(author, (prCountByAuthor.get(author) || 0) + prCount);
        
        // Update tester's PR count if they exist
        if (testerData.has(author)) {
          testerData.get(author)!.prsReviewed += prCount;
        }
      }
    }

    // Build developer metrics array with per-task averages
    const developerMetrics: DeveloperMetrics[] = Array.from(developerData.entries())
      .map(([developer, data]) => {
        const taskCount = data.tasksWorkedOn.size;
        return {
          developer,
          // Avg Dev Time = totalHours / numberOfTasks (NOT cycles)
          avgDevTimeHours: taskCount > 0
            ? data.totalDevHours / taskCount
            : 0,
          developmentCycles: data.devCycles,
          totalReturnCount: data.codeReviewReturns + data.devTestingReturns + data.stgTestingReturns,
          codeReviewReturns: data.codeReviewReturns,
          devTestingReturns: data.devTestingReturns,
          stgTestingReturns: data.stgTestingReturns,
          itemsCompleted: data.itemsCompleted,
          // Per-task averages
          avgTotalReturnsPerTask: taskCount > 0
            ? (data.codeReviewReturns + data.devTestingReturns + data.stgTestingReturns) / taskCount
            : 0,
          avgCodeReviewReturnsPerTask: taskCount > 0
            ? data.codeReviewReturns / taskCount
            : 0,
          avgDevTestingReturnsPerTask: taskCount > 0
            ? data.devTestingReturns / taskCount
            : 0,
          avgStgTestingReturnsPerTask: taskCount > 0
            ? data.stgTestingReturns / taskCount
            : 0,
        };
      })
      .sort((a, b) => b.itemsCompleted - a.itemsCompleted);

    // Build tester metrics array with per-task averages
    const testerMetrics: TesterMetrics[] = Array.from(testerData.entries())
      .map(([tester, data]) => {
        const taskCount = data.tasksWorkedOn.size;
        const prCount = data.prsReviewed || prCountByAuthor.get(tester) || 0;
        const commentCount = allPrComments.get(tester) || 0;
        
        return {
          tester,
          closedItemsCount: data.closedItems.size,
          // Avg Test Time = totalHours / numberOfTasks (NOT cycles)
          avgDevTestTimeHours: taskCount > 0
            ? data.totalDevTestingHours / taskCount
            : 0,
          avgStgTestTimeHours: taskCount > 0
            ? data.totalStgTestingHours / taskCount
            : 0,
          devTestingCycles: data.devTestingCycles,
          stgTestingCycles: data.stgTestingCycles,
          devTestingIterations: data.devIterations,
          stgTestingIterations: data.stgIterations,
          prCommentsCount: commentCount,
          // Per-task averages
          avgDevIterationsPerTask: taskCount > 0
            ? data.devIterations / taskCount
            : 0,
          avgStgIterationsPerTask: taskCount > 0
            ? data.stgIterations / taskCount
            : 0,
          avgPrCommentsPerPr: prCount > 0
            ? commentCount / prCount
            : 0,
          tasksWorkedOn: taskCount,
          prsReviewed: prCount,
        };
      })
      .sort((a, b) => b.closedItemsCount - a.closedItemsCount);

    // Build PR comment authors list with tester flag
    const prCommentAuthors: PRCommentAuthor[] = Array.from(allPrComments.entries())
      .map(([author, count]) => ({
        author,
        count,
        isTester: allTesters.has(author),
      }))
      .sort((a, b) => b.count - a.count);

    // Calculate summary using total duration / numberOfTasks
    const totalReturns = developerMetrics.reduce((sum, d) => sum + d.totalReturnCount, 0);
    const totalPrComments = Array.from(allPrComments.values()).reduce((sum, count) => sum + count, 0);

    const summary = {
      totalWorkItems: workItems.length,
      totalRequirements: requirements.length,
      totalBugs: bugs.length,
      totalTasks: tasks.length,
      // Avg = totalTime / numberOfTasks
      avgDevTimeHours: numTasks > 0
        ? globalDevTotalHours / numTasks
        : 0,
      avgDevTestTimeHours: numTasks > 0
        ? globalDevTestingTotalHours / numTasks
        : 0,
      avgStgTestTimeHours: numTasks > 0
        ? globalStgTestingTotalHours / numTasks
        : 0,
      totalReturns,
      totalPrComments,
    };

    // Build chart data
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

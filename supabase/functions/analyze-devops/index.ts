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
  developmentSpeedHours: number;
  developmentCycles: number;
  totalReturnCount: number;
  codeReviewReturns: number;
  devTestingReturns: number;
  stgTestingReturns: number;
  itemsCompleted: number;
}

interface TesterMetrics {
  tester: string;
  closedItemsCount: number;
  avgDevTestingSpeedHours: number;
  avgStgTestingSpeedHours: number;
  devTestingCycles: number;
  stgTestingCycles: number;
  devTestingIterations: number;
  stgTestingIterations: number;
  prCommentsCount: number;
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
 * Calculate development speed: SUM of ALL Active periods until first DEV_Acceptance Testing
 * 
 * Rules:
 * - Each transition INTO Active starts a new development cycle
 * - A development cycle ends on transition to:
 *   - Code Review, OR
 *   - DEV_Acceptance Testing (if Code Review is skipped)
 * - Stop counting entirely after the first transition to DEV_Acceptance Testing
 * - Attribute each cycle to the developer assigned at the moment the cycle ENDS
 * 
 * Returns: { totalHours, cycles, developerCycles: Map<developer, { totalHours, cycles }> }
 */
function calculateDevelopmentSpeed(transitions: TransitionEvent[]): {
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
 * - Cycle starts on transition INTO DEV_In Testing
 * - Cycle ends on transition to: Approved OR Fix Required
 * - Attribute the entire cycle duration to the person who performed the transition INTO DEV_In Testing
 * 
 * Returns: Map<tester, { totalHours, cycles, iterations }>
 */
function calculateDevTestingMetrics(transitions: TransitionEvent[]): Map<string, { totalHours: number; cycles: number; iterations: number }> {
  const testerMetrics = new Map<string, { totalHours: number; cycles: number; iterations: number }>();
  
  let devTestingStart: Date | null = null;
  let devTestingTester: string | null = null;
  
  for (const t of transitions) {
    if (t.toState === STATES.DEV_IN_TESTING) {
      // ROBUSTNESS FIX: If there's an open cycle, close it at the new transition's timestamp
      // This handles cases where status transitions were skipped or data is messy
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
      devTestingTester = t.changedBy || t.assignedTo || 'Unknown';
      
      // Track iteration for this tester
      if (!testerMetrics.has(devTestingTester)) {
        testerMetrics.set(devTestingTester, { totalHours: 0, cycles: 0, iterations: 0 });
      }
      testerMetrics.get(devTestingTester)!.iterations++;
    } 
    else if (devTestingStart && devTestingTester && 
             (t.toState === STATES.APPROVED || t.toState === STATES.FIX_REQUIRED)) {
      // Cycle ends - only count if we're coming from DEV_In Testing
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
  }
  
  return testerMetrics;
}

/**
 * Calculate STG testing metrics with proper tester attribution
 * 
 * Rules:
 * - Cycle starts on transition INTO STG_In Testing
 * - Cycle ends on transition to: Ready For Release OR Fix Required
 * - Attribute the entire cycle duration to the person who performed the transition INTO STG_In Testing
 * 
 * Returns: Map<tester, { totalHours, cycles, iterations }>
 */
function calculateStgTestingMetrics(transitions: TransitionEvent[]): Map<string, { totalHours: number; cycles: number; iterations: number }> {
  const testerMetrics = new Map<string, { totalHours: number; cycles: number; iterations: number }>();
  
  let stgTestingStart: Date | null = null;
  let stgTestingTester: string | null = null;
  
  for (const t of transitions) {
    if (t.toState === STATES.STG_IN_TESTING) {
      // ROBUSTNESS FIX: If there's an open cycle, close it at the new transition's timestamp
      // This handles cases where status transitions were skipped or data is messy
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
      stgTestingTester = t.changedBy || t.assignedTo || 'Unknown';
      
      // Track iteration for this tester
      if (!testerMetrics.has(stgTestingTester)) {
        testerMetrics.set(stgTestingTester, { totalHours: 0, cycles: 0, iterations: 0 });
      }
      testerMetrics.get(stgTestingTester)!.iterations++;
    } 
    else if (stgTestingStart && stgTestingTester && 
             (t.toState === STATES.READY_FOR_RELEASE || t.toState === STATES.FIX_REQUIRED)) {
      // Cycle ends - only count if we're coming from STG_In Testing
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
  }
  
  return testerMetrics;
}

/**
 * Get PR comments from linked PRs - strictly by author
 */
async function getPRComments(
  organization: string,
  project: string,
  workItem: WorkItem,
  pat: string
): Promise<Map<string, number>> {
  const commentsByAuthor = new Map<string, number>();
  
  if (!workItem.relations) {
    return commentsByAuthor;
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
      
      // Get PR threads (comments)
      const threadsUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/threads?api-version=7.1`;
      const threadsResult = await azureRequest(threadsUrl, pat) as { value: Array<{ comments: Array<{ author: { displayName: string } }> }> };
      
      for (const thread of threadsResult.value || []) {
        for (const comment of thread.comments || []) {
          const author = comment.author?.displayName || 'Unknown';
          commentsByAuthor.set(author, (commentsByAuthor.get(author) || 0) + 1);
        }
      }
    } catch {
      // Skip this PR if we can't access it
      console.log(`Could not access PR for work item ${workItem.id}`);
    }
  }
  
  return commentsByAuthor;
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
            avgDevelopmentSpeedHours: 0,
            avgDevTestingSpeedHours: 0,
            avgStgTestingSpeedHours: 0,
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
    // Developer data aggregation with cycle counts for proper averaging
    const developerData: Map<string, {
      totalDevHours: number;
      devCycles: number;
      codeReviewReturns: number;
      devTestingReturns: number;
      stgTestingReturns: number;
      itemsCompleted: number;
    }> = new Map();

    // Tester data aggregation - now based on who performed transitions, not TestedBy fields
    const testerData: Map<string, {
      closedItems: Set<number>; // Track unique work item IDs to avoid double-counting
      totalDevTestingHours: number;
      devTestingCycles: number;
      totalStgTestingHours: number;
      stgTestingCycles: number;
      devIterations: number;
      stgIterations: number;
    }> = new Map();

    // All testers set - collected from TestedBy fields for PR comment filtering
    const allTesters = new Set<string>();

    // PR comments aggregation - strictly by author
    const allPrComments: Map<string, number> = new Map();

    // Global totals for summary calculations
    let globalDevTotalHours = 0;
    let globalDevTotalCycles = 0;
    let globalDevTestingTotalHours = 0;
    let globalDevTestingTotalCycles = 0;
    let globalStgTestingTotalHours = 0;
    let globalStgTestingTotalCycles = 0;

    // Process Requirements and Bugs for metrics
    for (const workItem of metricsItems) {
      const revisions = await getWorkItemRevisions(organization, project, workItem.id, pat);
      const transitions = extractTransitions(revisions, workItem.id);
      
      // Collect testers from TestedBy fields for PR comment filtering only
      const tester1 = getDisplayName(workItem.fields['Custom.TestedBy1']);
      const tester2 = getDisplayName(workItem.fields['Custom.TestedBy2']);
      if (tester1) allTesters.add(tester1);
      if (tester2) allTesters.add(tester2);
      
      // Calculate development speed with developer attribution at cycle end
      const devSpeedResult = calculateDevelopmentSpeed(transitions);
      globalDevTotalHours += devSpeedResult.totalHours;
      globalDevTotalCycles += devSpeedResult.cycles;

      // Update developer metrics from development cycles
      for (const [developer, data] of devSpeedResult.developerCycles) {
        if (!developerData.has(developer)) {
          developerData.set(developer, {
            totalDevHours: 0,
            devCycles: 0,
            codeReviewReturns: 0,
            devTestingReturns: 0,
            stgTestingReturns: 0,
            itemsCompleted: 0,
          });
        }
        const devData = developerData.get(developer)!;
        devData.totalDevHours += data.totalHours;
        devData.devCycles += data.cycles;
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
          });
        }
        const devData = developerData.get(developer)!;
        devData.codeReviewReturns += returnData.codeReview;
        devData.devTestingReturns += returnData.devTesting;
        devData.stgTestingReturns += returnData.stgTesting;
      }

      // Track completed items - attribute to the developer who did the most cycles
      if (workItem.fields['System.State'] === STATES.RELEASED) {
        let maxCyclesDev: string | null = null;
        let maxCycles = 0;
        for (const [dev, data] of devSpeedResult.developerCycles) {
          if (data.cycles > maxCycles) {
            maxCycles = data.cycles;
            maxCyclesDev = dev;
          }
        }
        if (maxCyclesDev && developerData.has(maxCyclesDev)) {
          developerData.get(maxCyclesDev)!.itemsCompleted++;
        }
      }
      
      // Calculate DEV testing metrics - attribute to person who moved item INTO testing
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
          });
        }
        const testData = testerData.get(tester)!;
        testData.totalDevTestingHours += data.totalHours;
        testData.devTestingCycles += data.cycles;
        testData.devIterations += data.iterations;
        globalDevTestingTotalHours += data.totalHours;
        globalDevTestingTotalCycles += data.cycles;
        
        // Track closed items for this tester
        if (workItem.fields['System.State'] === STATES.RELEASED) {
          testData.closedItems.add(workItem.id);
        }
      }

      // Calculate STG testing metrics - attribute to person who moved item INTO testing
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
          });
        }
        const testData = testerData.get(tester)!;
        testData.totalStgTestingHours += data.totalHours;
        testData.stgTestingCycles += data.cycles;
        testData.stgIterations += data.iterations;
        globalStgTestingTotalHours += data.totalHours;
        globalStgTestingTotalCycles += data.cycles;
        
        // Track closed items for this tester
        if (workItem.fields['System.State'] === STATES.RELEASED) {
          testData.closedItems.add(workItem.id);
        }
      }
    }

    // Process all items (including Tasks) for PR comments - strictly by author
    for (const workItem of prItems) {
      const prComments = await getPRComments(organization, project, workItem, pat);
      
      for (const [author, count] of prComments) {
        allPrComments.set(author, (allPrComments.get(author) || 0) + count);
      }
    }

    // Build developer metrics array
    const developerMetrics: DeveloperMetrics[] = Array.from(developerData.entries())
      .map(([developer, data]) => ({
        developer,
        developmentSpeedHours: data.devCycles > 0
          ? data.totalDevHours / data.devCycles
          : 0,
        developmentCycles: data.devCycles,
        totalReturnCount: data.codeReviewReturns + data.devTestingReturns + data.stgTestingReturns,
        codeReviewReturns: data.codeReviewReturns,
        devTestingReturns: data.devTestingReturns,
        stgTestingReturns: data.stgTestingReturns,
        itemsCompleted: data.itemsCompleted,
      }))
      .sort((a, b) => b.itemsCompleted - a.itemsCompleted);

    // Build tester metrics array
    const testerMetrics: TesterMetrics[] = Array.from(testerData.entries())
      .map(([tester, data]) => ({
        tester,
        closedItemsCount: data.closedItems.size,
        avgDevTestingSpeedHours: data.devTestingCycles > 0
          ? data.totalDevTestingHours / data.devTestingCycles
          : 0,
        avgStgTestingSpeedHours: data.stgTestingCycles > 0
          ? data.totalStgTestingHours / data.stgTestingCycles
          : 0,
        devTestingCycles: data.devTestingCycles,
        stgTestingCycles: data.stgTestingCycles,
        devTestingIterations: data.devIterations,
        stgTestingIterations: data.stgIterations,
        prCommentsCount: allPrComments.get(tester) || 0,
      }))
      .sort((a, b) => b.closedItemsCount - a.closedItemsCount);

    // Build PR comment authors list with tester flag
    // isTester is true if the author is in the TestedBy fields
    const prCommentAuthors: PRCommentAuthor[] = Array.from(allPrComments.entries())
      .map(([author, count]) => ({
        author,
        count,
        isTester: allTesters.has(author),
      }))
      .sort((a, b) => b.count - a.count);

    // Calculate summary using total duration / total cycles
    const totalReturns = developerMetrics.reduce((sum, d) => sum + d.totalReturnCount, 0);
    const totalPrComments = Array.from(allPrComments.values()).reduce((sum, count) => sum + count, 0);

    const summary = {
      totalWorkItems: workItems.length,
      totalRequirements: requirements.length,
      totalBugs: bugs.length,
      totalTasks: tasks.length,
      avgDevelopmentSpeedHours: globalDevTotalCycles > 0
        ? globalDevTotalHours / globalDevTotalCycles
        : 0,
      avgDevTestingSpeedHours: globalDevTestingTotalCycles > 0
        ? globalDevTestingTotalHours / globalDevTestingTotalCycles
        : 0,
      avgStgTestingSpeedHours: globalStgTestingTotalCycles > 0
        ? globalStgTestingTotalHours / globalStgTestingTotalCycles
        : 0,
      totalReturns,
      totalPrComments,
    };

    // Build chart data
    const chartData = {
      developmentSpeed: developerMetrics
        .filter(d => d.developmentSpeedHours > 0)
        .slice(0, 10)
        .map(d => ({ name: d.developer, value: Math.round(d.developmentSpeedHours * 10) / 10 })),
      testingSpeed: [
        ...testerMetrics.filter(t => t.avgDevTestingSpeedHours > 0).slice(0, 5).map(t => ({
          name: `${t.tester} (DEV)`,
          value: Math.round(t.avgDevTestingSpeedHours * 10) / 10,
          category: 'DEV',
        })),
        ...testerMetrics.filter(t => t.avgStgTestingSpeedHours > 0).slice(0, 5).map(t => ({
          name: `${t.tester} (STG)`,
          value: Math.round(t.avgStgTestingSpeedHours * 10) / 10,
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

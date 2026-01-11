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
}

interface DeveloperMetrics {
  developer: string;
  developmentSpeedHours: number;
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
  devTestingIterations: number;
  stgTestingIterations: number;
  prCommentsCount: number;
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
 * Extract state transitions from revisions
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
      });
    }
  }
  
  return transitions;
}

/**
 * Calculate development speed: Active → Code Review
 */
function calculateDevelopmentSpeed(transitions: TransitionEvent[]): number {
  // Find first Active and first Code Review after it
  let activeTimestamp: Date | null = null;
  
  for (const t of transitions) {
    if (t.toState === STATES.ACTIVE && !activeTimestamp) {
      activeTimestamp = t.timestamp;
    } else if (t.toState === STATES.CODE_REVIEW && activeTimestamp) {
      const hours = (t.timestamp.getTime() - activeTimestamp.getTime()) / (1000 * 60 * 60);
      return hours;
    }
  }
  
  return 0;
}

/**
 * Count returns to Fix Required
 */
function countReturns(transitions: TransitionEvent[]): {
  codeReviewReturns: number;
  devTestingReturns: number;
  stgTestingReturns: number;
} {
  let codeReviewReturns = 0;
  let devTestingReturns = 0;
  let stgTestingReturns = 0;
  
  for (const t of transitions) {
    if (t.toState === STATES.FIX_REQUIRED) {
      if (t.fromState === STATES.CODE_REVIEW) {
        codeReviewReturns++;
      } else if (t.fromState === STATES.DEV_IN_TESTING) {
        devTestingReturns++;
      } else if (t.fromState === STATES.STG_IN_TESTING) {
        stgTestingReturns++;
      }
    }
  }
  
  return { codeReviewReturns, devTestingReturns, stgTestingReturns };
}

/**
 * Calculate testing speed for DEV environment
 * DEV_In Testing → Approved
 */
function calculateDevTestingSpeed(transitions: TransitionEvent[]): number[] {
  const durations: number[] = [];
  let devTestingStart: Date | null = null;
  
  for (const t of transitions) {
    if (t.toState === STATES.DEV_IN_TESTING) {
      devTestingStart = t.timestamp;
    } else if (t.toState === STATES.APPROVED && devTestingStart) {
      const hours = (t.timestamp.getTime() - devTestingStart.getTime()) / (1000 * 60 * 60);
      durations.push(hours);
      devTestingStart = null;
    }
  }
  
  return durations;
}

/**
 * Calculate testing speed for STG environment
 * STG_In Testing → Ready For Release
 */
function calculateStgTestingSpeed(transitions: TransitionEvent[]): number[] {
  const durations: number[] = [];
  let stgTestingStart: Date | null = null;
  
  for (const t of transitions) {
    if (t.toState === STATES.STG_IN_TESTING) {
      stgTestingStart = t.timestamp;
    } else if (t.toState === STATES.READY_FOR_RELEASE && stgTestingStart) {
      const hours = (t.timestamp.getTime() - stgTestingStart.getTime()) / (1000 * 60 * 60);
      durations.push(hours);
      stgTestingStart = null;
    }
  }
  
  return durations;
}

/**
 * Count testing iterations
 */
function countTestingIterations(transitions: TransitionEvent[]): {
  devIterations: number;
  stgIterations: number;
} {
  let devIterations = 0;
  let stgIterations = 0;
  
  for (const t of transitions) {
    if (t.toState === STATES.DEV_IN_TESTING) {
      devIterations++;
    } else if (t.toState === STATES.STG_IN_TESTING) {
      stgIterations++;
    }
  }
  
  return { devIterations, stgIterations };
}

/**
 * Get PR comments from linked PRs
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
    const developerData: Map<string, {
      devSpeeds: number[];
      codeReviewReturns: number;
      devTestingReturns: number;
      stgTestingReturns: number;
      itemsCompleted: number;
    }> = new Map();

    const testerData: Map<string, {
      closedItems: number;
      devTestingSpeeds: number[];
      stgTestingSpeeds: number[];
      devIterations: number;
      stgIterations: number;
      prComments: number;
    }> = new Map();

    const allPrComments: Map<string, number> = new Map();

    // Process Requirements and Bugs for metrics
    for (const workItem of metricsItems) {
      const revisions = await getWorkItemRevisions(organization, project, workItem.id, pat);
      const transitions = extractTransitions(revisions, workItem.id);
      
      // Get assigned developer (from current state)
      const developer = getDisplayName(workItem.fields['System.AssignedTo']) || 'Unassigned';
      
      // Get testers
      const tester1 = getDisplayName(workItem.fields['Custom.TestedBy1']);
      const tester2 = getDisplayName(workItem.fields['Custom.TestedBy2']);
      const testers = [tester1, tester2].filter(Boolean) as string[];
      
      // Initialize developer data
      if (!developerData.has(developer)) {
        developerData.set(developer, {
          devSpeeds: [],
          codeReviewReturns: 0,
          devTestingReturns: 0,
          stgTestingReturns: 0,
          itemsCompleted: 0,
        });
      }
      
      // Developer metrics
      const devData = developerData.get(developer)!;
      const devSpeed = calculateDevelopmentSpeed(transitions);
      if (devSpeed > 0) {
        devData.devSpeeds.push(devSpeed);
      }
      
      const returns = countReturns(transitions);
      devData.codeReviewReturns += returns.codeReviewReturns;
      devData.devTestingReturns += returns.devTestingReturns;
      devData.stgTestingReturns += returns.stgTestingReturns;
      
      if (workItem.fields['System.State'] === STATES.RELEASED) {
        devData.itemsCompleted++;
      }
      
      // Tester metrics - distribute to all assigned testers
      const devTestingSpeeds = calculateDevTestingSpeed(transitions);
      const stgTestingSpeeds = calculateStgTestingSpeed(transitions);
      const iterations = countTestingIterations(transitions);
      
      for (const tester of testers) {
        if (!testerData.has(tester)) {
          testerData.set(tester, {
            closedItems: 0,
            devTestingSpeeds: [],
            stgTestingSpeeds: [],
            devIterations: 0,
            stgIterations: 0,
            prComments: 0,
          });
        }
        
        const testData = testerData.get(tester)!;
        testData.devTestingSpeeds.push(...devTestingSpeeds);
        testData.stgTestingSpeeds.push(...stgTestingSpeeds);
        testData.devIterations += iterations.devIterations;
        testData.stgIterations += iterations.stgIterations;
        
        if (workItem.fields['System.State'] === STATES.RELEASED) {
          testData.closedItems++;
        }
      }
    }

    // Process all items (including Tasks) for PR comments
    for (const workItem of prItems) {
      const prComments = await getPRComments(organization, project, workItem, pat);
      
      for (const [author, count] of prComments) {
        allPrComments.set(author, (allPrComments.get(author) || 0) + count);
        
        // Attribute to testers if they match
        if (testerData.has(author)) {
          testerData.get(author)!.prComments += count;
        }
      }
    }

    // Build developer metrics array
    const developerMetrics: DeveloperMetrics[] = Array.from(developerData.entries())
      .map(([developer, data]) => ({
        developer,
        developmentSpeedHours: data.devSpeeds.length > 0
          ? data.devSpeeds.reduce((a, b) => a + b, 0) / data.devSpeeds.length
          : 0,
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
        closedItemsCount: data.closedItems,
        avgDevTestingSpeedHours: data.devTestingSpeeds.length > 0
          ? data.devTestingSpeeds.reduce((a, b) => a + b, 0) / data.devTestingSpeeds.length
          : 0,
        avgStgTestingSpeedHours: data.stgTestingSpeeds.length > 0
          ? data.stgTestingSpeeds.reduce((a, b) => a + b, 0) / data.stgTestingSpeeds.length
          : 0,
        devTestingIterations: data.devIterations,
        stgTestingIterations: data.stgIterations,
        prCommentsCount: data.prComments,
      }))
      .sort((a, b) => b.closedItemsCount - a.closedItemsCount);

    // Calculate summary
    const allDevSpeeds = developerMetrics.map(d => d.developmentSpeedHours).filter(s => s > 0);
    const allDevTestSpeeds = testerMetrics.map(t => t.avgDevTestingSpeedHours).filter(s => s > 0);
    const allStgTestSpeeds = testerMetrics.map(t => t.avgStgTestingSpeedHours).filter(s => s > 0);
    const totalReturns = developerMetrics.reduce((sum, d) => sum + d.totalReturnCount, 0);
    const totalPrComments = Array.from(allPrComments.values()).reduce((sum, count) => sum + count, 0);

    const summary = {
      totalWorkItems: workItems.length,
      totalRequirements: requirements.length,
      totalBugs: bugs.length,
      totalTasks: tasks.length,
      avgDevelopmentSpeedHours: allDevSpeeds.length > 0
        ? allDevSpeeds.reduce((a, b) => a + b, 0) / allDevSpeeds.length
        : 0,
      avgDevTestingSpeedHours: allDevTestSpeeds.length > 0
        ? allDevTestSpeeds.reduce((a, b) => a + b, 0) / allDevTestSpeeds.length
        : 0,
      avgStgTestingSpeedHours: allStgTestSpeeds.length > 0
        ? allStgTestSpeeds.reduce((a, b) => a + b, 0) / allStgTestSpeeds.length
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
      prComments: Array.from(allPrComments.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, value]) => ({ name, value })),
    };

    console.log(`Analysis complete. Developers: ${developerMetrics.length}, Testers: ${testerMetrics.length}`);

    return new Response(
      JSON.stringify({
        developerMetrics,
        testerMetrics,
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

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
  RELEASED: 'Released',
} as const;

// Batching configuration
const WORK_ITEM_BATCH_SIZE = 200;
const REVISION_BATCH_SIZE = 25;
const PR_BATCH_SIZE = 20;

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
    const url = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems?ids=${batchIds.join(',')}&$expand=relations&api-version=7.1`;
    const result = await azureRequest(url, pat) as { value: WorkItem[] };
    allWorkItems.push(...result.value);
  }

  return allWorkItems;
}

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

function getDisplayName(field: unknown): string | null {
  if (!field) return null;
  if (typeof field === 'object' && field !== null && 'displayName' in field) {
    return (field as { displayName: string }).displayName;
  }
  return null;
}

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

function getCurrentAssignedTo(workItem: WorkItem, assignedToHistory: string[]): string {
  const current = getDisplayName(workItem.fields['System.AssignedTo']);
  if (current) return current;
  if (assignedToHistory.length > 0) return assignedToHistory[assignedToHistory.length - 1];
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
        // Check for merge possibility
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
  
  // Close incomplete cycle (don't count as iteration)
  if (cycle) {
    const totalHours = cycle.periods.reduce((a, b) => a + b, 0);
    if (!metrics.has(cycle.tester)) metrics.set(cycle.tester, { hours: 0, cycles: 0, iterations: 0 });
    const m = metrics.get(cycle.tester)!;
    m.hours += totalHours;
    m.cycles++;
  }
  
  return metrics;
}

async function getPRComments(
  organization: string,
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
      const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/threads?api-version=7.1`;
      const threads = await azureRequest(url, pat) as { value: Array<{ comments: Array<{ author: { displayName: string }; commentType: string }> }> };
      
      const prUrl = `https://dev.azure.com/${organization}/${project}/_git/${repoId}/pullrequest/${prId}`;
      
      for (const thread of threads.value) {
        if (thread.comments?.[0]?.commentType === 'text') {
          const author = thread.comments[0].author.displayName;
          
          if (!result.has(author)) result.set(author, { count: 0, prs: [] });
          const data = result.get(author)!;
          data.count++;
          
          const existing = data.prs.find(p => p.prId === prId);
          if (existing) existing.commentsCount++;
          else data.prs.push({ prId, prUrl, workItemId: workItem.id, workItemTitle: title, commentsCount: 1 });
        }
      }
    } catch {
      // Skip inaccessible PRs
    }
  }
  
  return result;
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
      return new Response(JSON.stringify({
        developerMetrics: [],
        testerMetrics: [],
        prCommentAuthors: [],
        summary: { totalWorkItems: 0, totalRequirements: 0, totalBugs: 0, totalTasks: 0, avgDevTimeHours: 0, avgDevTestTimeHours: 0, avgStgTestTimeHours: 0, totalReturns: 0, totalPrComments: 0 },
        chartData: { developmentSpeed: [], devTestingSpeed: [], stgTestingSpeed: [], returns: [], devIterations: [], stgIterations: [], prComments: [] },
        unassignedItems: [],
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const workItems = await getWorkItems(organization, project, workItemIds, pat);
    console.log(`Fetched ${workItems.length} work items`);

    const requirements = workItems.filter(wi => wi.fields['System.WorkItemType'] === 'Requirement');
    const bugs = workItems.filter(wi => wi.fields['System.WorkItemType'] === 'Bug');
    const tasks = workItems.filter(wi => wi.fields['System.WorkItemType'] === 'Task');
    
    const metricsItems = [...requirements, ...bugs];
    console.log(`Processing ${metricsItems.length} metrics items`);

    // Aggregation structures
    const devAgg = new Map<string, { hours: number; cycles: number; cr: number; dev: number; stg: number; completed: number; items: Map<number, WorkItemReference>; returns: Map<number, WorkItemReference>; crReturns: Map<number, WorkItemReference>; devReturns: Map<number, WorkItemReference>; stgReturns: Map<number, WorkItemReference> }>();
    const testerAgg = new Map<string, { devHours: number; stgHours: number; devCycles: number; stgCycles: number; devIter: number; stgIter: number; closed: Map<number, WorkItemReference>; devItems: Map<number, WorkItemReference>; stgItems: Map<number, WorkItemReference>; prDetails: PRReference[]; prsReviewed: number }>();
    const prAgg = new Map<string, { count: number; prs: PRReference[] }>();
    const allTesters = new Set<string>();
    const unassignedItems: WorkItemReference[] = [];

    let totalDevHours = 0, totalDevTestHours = 0, totalStgTestHours = 0;

    // Process metrics items in batches
    const totalBatches = Math.ceil(metricsItems.length / REVISION_BATCH_SIZE);
    
    for (let b = 0; b < metricsItems.length; b += REVISION_BATCH_SIZE) {
      const batch = metricsItems.slice(b, b + REVISION_BATCH_SIZE);
      console.log(`Batch ${Math.floor(b / REVISION_BATCH_SIZE) + 1}/${totalBatches}`);
      
      const revisionsBatch = await Promise.all(
        batch.map(wi => getWorkItemRevisions(organization, project, wi.id, pat))
      );
      
      for (let i = 0; i < batch.length; i++) {
        const wi = batch[i];
        const revisions = revisionsBatch[i];
        const transitions = extractTransitions(revisions, wi.id);
        
        const type = wi.fields['System.WorkItemType'] as string;
        const title = wi.fields['System.Title'] as string;
        const state = wi.fields['System.State'] as string;
        const history = extractAssignedToHistory(revisions);
        const assignedTo = getCurrentAssignedTo(wi, history);
        const url = `https://dev.azure.com/${organization}/${project}/_workitems/edit/${wi.id}`;
        
        const ref: WorkItemReference = { id: wi.id, title, type, url, count: 0, assignedToChanged: history.length > 1, assignedToHistory: history };
        
        const t1 = getDisplayName(wi.fields['Custom.TestedBy1']);
        const t2 = getDisplayName(wi.fields['Custom.TestedBy2']);
        if (t1) allTesters.add(t1);
        if (t2) allTesters.add(t2);
        
        // Dev time
        const devTime = calculateDevelopmentTime(transitions);
        totalDevHours += devTime.totalHours;
        
        if (!devAgg.has(assignedTo)) {
          devAgg.set(assignedTo, { hours: 0, cycles: 0, cr: 0, dev: 0, stg: 0, completed: 0, items: new Map(), returns: new Map(), crReturns: new Map(), devReturns: new Map(), stgReturns: new Map() });
        }
        const da = devAgg.get(assignedTo)!;
        da.hours += devTime.totalHours;
        da.cycles += devTime.cycles;
        da.items.set(wi.id, { ...ref, count: 1 });
        
        if (assignedTo === 'Unassigned') unassignedItems.push({ ...ref, count: 1 });
        
        // Returns
        const returns = countReturns(transitions);
        da.cr += returns.cr;
        da.dev += returns.dev;
        da.stg += returns.stg;
        
        const totalRet = returns.cr + returns.dev + returns.stg;
        if (totalRet > 0) da.returns.set(wi.id, { ...ref, count: totalRet });
        if (returns.cr > 0) da.crReturns.set(wi.id, { ...ref, count: returns.cr });
        if (returns.dev > 0) da.devReturns.set(wi.id, { ...ref, count: returns.dev });
        if (returns.stg > 0) da.stgReturns.set(wi.id, { ...ref, count: returns.stg });
        
        if (state === STATES.RELEASED) da.completed++;
        
        // DEV Testing
        const devTest = calculateTestingMetrics(transitions, STATES.DEV_IN_TESTING, STATES.DEV_ACCEPTANCE_TESTING);
        for (const [tester, data] of devTest) {
          if (!testerAgg.has(tester)) {
            testerAgg.set(tester, { devHours: 0, stgHours: 0, devCycles: 0, stgCycles: 0, devIter: 0, stgIter: 0, closed: new Map(), devItems: new Map(), stgItems: new Map(), prDetails: [], prsReviewed: 0 });
          }
          const ta = testerAgg.get(tester)!;
          ta.devHours += data.hours;
          ta.devCycles += data.cycles;
          ta.devIter += data.iterations;
          totalDevTestHours += data.hours;
          
          if (data.iterations > 0) {
            const existing = ta.devItems.get(wi.id);
            if (existing) existing.count += data.iterations;
            else ta.devItems.set(wi.id, { ...ref, count: data.iterations });
          }
          
          if (state === STATES.RELEASED) ta.closed.set(wi.id, { ...ref, count: 1 });
        }
        
        // STG Testing
        const stgTest = calculateTestingMetrics(transitions, STATES.STG_IN_TESTING, STATES.STG_ACCEPTANCE_TESTING);
        for (const [tester, data] of stgTest) {
          if (!testerAgg.has(tester)) {
            testerAgg.set(tester, { devHours: 0, stgHours: 0, devCycles: 0, stgCycles: 0, devIter: 0, stgIter: 0, closed: new Map(), devItems: new Map(), stgItems: new Map(), prDetails: [], prsReviewed: 0 });
          }
          const ta = testerAgg.get(tester)!;
          ta.stgHours += data.hours;
          ta.stgCycles += data.cycles;
          ta.stgIter += data.iterations;
          totalStgTestHours += data.hours;
          
          if (data.iterations > 0) {
            const existing = ta.stgItems.get(wi.id);
            if (existing) existing.count += data.iterations;
            else ta.stgItems.set(wi.id, { ...ref, count: data.iterations });
          }
          
          if (state === STATES.RELEASED) ta.closed.set(wi.id, { ...ref, count: 1 });
        }
      }
    }

    // Process PR comments in batches
    const prBatches = Math.ceil(workItems.length / PR_BATCH_SIZE);
    console.log(`Processing PR comments in ${prBatches} batches`);
    
    for (let b = 0; b < workItems.length; b += PR_BATCH_SIZE) {
      const batch = workItems.slice(b, b + PR_BATCH_SIZE);
      console.log(`PR batch ${Math.floor(b / PR_BATCH_SIZE) + 1}/${prBatches}`);
      
      const results = await Promise.all(batch.map(wi => getPRComments(organization, project, wi, pat)));
      
      for (let i = 0; i < results.length; i++) {
        for (const [author, data] of results[i]) {
          if (!prAgg.has(author)) prAgg.set(author, { count: 0, prs: [] });
          const pa = prAgg.get(author)!;
          pa.count += data.count;
          pa.prs.push(...data.prs);
          
          if (testerAgg.has(author)) {
            const ta = testerAgg.get(author)!;
            ta.prsReviewed += data.prs.length;
            ta.prDetails.push(...data.prs);
          }
        }
      }
    }

    // Build final metrics
    const numTasks = metricsItems.length;
    
    const developerMetrics = Array.from(devAgg.entries()).map(([developer, d]) => {
      const taskCount = d.items.size;
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
        workItems: Array.from(d.items.values()),
        returnItems: Array.from(d.returns.values()),
        codeReviewReturnItems: Array.from(d.crReturns.values()),
        devTestingReturnItems: Array.from(d.devReturns.values()),
        stgTestingReturnItems: Array.from(d.stgReturns.values()),
      };
    }).sort((a, b) => b.itemsCompleted - a.itemsCompleted);

    const testerMetrics = Array.from(testerAgg.entries()).map(([tester, t]) => {
      const taskCount = Math.max(t.devItems.size, t.stgItems.size, t.closed.size, 1);
      const prCount = t.prsReviewed || (prAgg.get(tester)?.prs.length || 0);
      const commentCount = prAgg.get(tester)?.count || 0;
      
      return {
        tester,
        closedItemsCount: t.closed.size,
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
        closedItems: Array.from(t.closed.values()),
        devIterationItems: Array.from(t.devItems.values()),
        stgIterationItems: Array.from(t.stgItems.values()),
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
      totalRequirements: requirements.length,
      totalBugs: bugs.length,
      totalTasks: tasks.length,
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

    console.log(`Analysis complete. ${developerMetrics.length} devs, ${testerMetrics.length} testers`);

    return new Response(JSON.stringify({
      developerMetrics,
      testerMetrics,
      prCommentAuthors,
      summary,
      chartData,
      unassignedItems,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

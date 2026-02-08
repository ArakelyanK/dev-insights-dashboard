// Azure DevOps Analytics Types

export interface AnalysisRequest {
  organization: string;
  project: string;
  queryId: string;
  pat: string;
  debug?: boolean; // Enable structured debug logging
}

// Enhanced PR reference with authors array
export interface PRReferenceEnhanced {
  workItemId: number;
  workItemTitle: string;
  prId: string;
  prUrl: string;
  commentsCount: number;
  authors: string[];
}

// Drill-down work item reference
export interface WorkItemReference {
  id: number;
  title: string;
  type: string;
  url: string;
  count: number; // Count for this specific metric (e.g., returns count, iterations count)
  assignedToChanged: boolean;
  assignedToHistory: string[];
  // New fields for drill-down enrichment
  activeTimeHours?: number; // Working time in Active state (calendar-normalized)
  devTestTimeHours?: number; // Working time in DEV testing
  stgTestTimeHours?: number; // Working time in STG testing
  originalEstimate?: number; // Story points (Original Estimate)
}

// PR reference for drill-down (enhanced with authors array)
export interface PRReference {
  prId: string;
  prUrl: string;
  workItemId: number;
  workItemTitle: string;
  commentsCount: number;
  authors: string[]; // All comment authors on this PR
}

// Story points analytics
export interface StoryPointsAnalytics {
  averageStoryPoints: number; // Sum of SP / count of items with SP
  itemsWithEstimate: number;
  itemsWithoutEstimate: number;
  totalStoryPoints: number;
  costPerStoryPoint: number; // Active hours / SP for items with SP
  fibonacciBreakdown: FibonacciBreakdown[];
}

export interface FibonacciBreakdown {
  estimate: number; // 1, 2, 3, 5, 8, 13, 21, etc.
  itemCount: number;
  totalActiveHours: number;
  avgHoursPerSp: number;
}

export interface DeveloperMetrics {
  developer: string;
  avgDevTimeHours: number;
  developmentCycles: number;
  totalReturnCount: number;
  codeReviewReturns: number;
  devTestingReturns: number;
  stgTestingReturns: number;
  itemsCompleted: number;
  // Per-task averages
  avgTotalReturnsPerTask: number;
  avgCodeReviewReturnsPerTask: number;
  avgDevTestingReturnsPerTask: number;
  avgStgTestingReturnsPerTask: number;
  // Story points (new)
  avgOriginalEstimate: number; // Average SP for this developer's tasks
  totalOriginalEstimate: number;
  itemsWithEstimate: number;
  // Drill-down data
  workItems: WorkItemReference[];
  returnItems: WorkItemReference[];
  codeReviewReturnItems: WorkItemReference[];
  devTestingReturnItems: WorkItemReference[];
  stgTestingReturnItems: WorkItemReference[];
}

export interface TesterMetrics {
  tester: string;
  closedItemsCount: number;
  avgDevTestTimeHours: number;
  avgStgTestTimeHours: number;
  devTestingCycles: number;
  stgTestingCycles: number;
  devTestingIterations: number;
  stgTestingIterations: number;
  prCommentsCount: number;
  // Per-task averages
  avgDevIterationsPerTask: number;
  avgStgIterationsPerTask: number;
  avgPrCommentsPerPr: number;
  tasksWorkedOn: number;
  prsReviewed: number;
  // Story points (new)
  avgOriginalEstimate: number; // Average SP for tasks tested
  totalOriginalEstimate: number;
  itemsWithEstimate: number;
  // Drill-down data
  closedItems: WorkItemReference[];
  devIterationItems: WorkItemReference[];
  stgIterationItems: WorkItemReference[];
  prCommentDetails: PRReference[];
}

export interface PRCommentAuthor {
  author: string;
  count: number;
  isTester: boolean;
  prDetails: PRReference[];
}

export interface ChartDataPoint {
  name: string;
  value: number;
  category?: string;
}

export interface PRChartDataPoint extends ChartDataPoint {
  isTester?: boolean;
}

// Filter state for client-side filtering
export interface AnalysisFilters {
  workItemTypes: Set<string>; // 'Requirement', 'Bug', 'Task'
  stateTransition?: {
    state: string;
    fromDate: Date | null;
    toDate: Date | null;
  };
}

export interface AnalysisResult {
  developerMetrics: DeveloperMetrics[];
  testerMetrics: TesterMetrics[];
  prCommentAuthors: PRCommentAuthor[];
  storyPointsAnalytics?: StoryPointsAnalytics; // New
  summary: {
    totalWorkItems: number;
    totalRequirements: number;
    totalBugs: number;
    totalTasks: number;
    avgDevTimeHours: number;
    avgDevTestTimeHours: number;
    avgStgTestTimeHours: number;
    totalReturns: number;
    totalPrComments: number;
    // Story points summary (new)
    avgStoryPoints?: number;
    costPerStoryPoint?: number;
  };
  chartData: {
    developmentSpeed: ChartDataPoint[];
    devTestingSpeed: ChartDataPoint[];
    stgTestingSpeed: ChartDataPoint[];
    returns: ChartDataPoint[];
    devIterations: ChartDataPoint[];
    stgIterations: ChartDataPoint[];
    prComments: PRChartDataPoint[];
    storyPointsCost?: ChartDataPoint[]; // Fibonacci breakdown chart
  };
  // Unassigned items for drill-down
  unassignedItems: WorkItemReference[];
  // Raw work item data for client-side filtering (new)
  workItemsRaw?: WorkItemRaw[];
}

// Raw work item data for client-side filtering
export interface WorkItemRaw {
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
  // State transitions for filtering
  stateTransitions: StateTransitionRaw[];
}

export interface StateTransitionRaw {
  fromState: string;
  toState: string;
  timestamp: string; // ISO string
  changedBy?: string;
}

export interface WorkItemRevision {
  id: number;
  rev: number;
  fields: {
    'System.State': string;
    'System.ChangedDate': string;
    'System.AssignedTo'?: { displayName: string; uniqueName: string };
    'System.WorkItemType': string;
    'Custom.TestedBy1'?: { displayName: string; uniqueName: string };
    'Custom.TestedBy2'?: { displayName: string; uniqueName: string };
    [key: string]: unknown;
  };
}

export interface WorkItem {
  id: number;
  fields: {
    'System.Title': string;
    'System.State': string;
    'System.WorkItemType': string;
    'System.AssignedTo'?: { displayName: string; uniqueName: string };
    'Custom.TestedBy1'?: { displayName: string; uniqueName: string };
    'Custom.TestedBy2'?: { displayName: string; uniqueName: string };
    [key: string]: unknown;
  };
  relations?: Array<{
    rel: string;
    url: string;
    attributes: { name: string };
  }>;
}

// State constants matching Azure DevOps
export const STATES = {
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
} as const;

export const WORK_ITEM_TYPES = {
  REQUIREMENT: 'Requirement',
  BUG: 'Bug',
  TASK: 'Task',
} as const;

// Fibonacci sequence for story points
export const FIBONACCI_SEQUENCE = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89] as const;

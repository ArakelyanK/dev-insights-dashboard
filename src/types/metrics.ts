// Azure DevOps Analytics Types

export interface AnalysisRequest {
  organization: string;
  project: string;
  queryId: string;
  pat: string;
}

export interface DeveloperMetrics {
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

export interface TesterMetrics {
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
  tasksWorkedOn: number;
  prsReviewed: number;
}

export interface PRCommentAuthor {
  author: string;
  count: number;
  isTester: boolean;
}

export interface ChartDataPoint {
  name: string;
  value: number;
  category?: string;
}

export interface PRChartDataPoint extends ChartDataPoint {
  isTester?: boolean;
}

export interface AnalysisResult {
  developerMetrics: DeveloperMetrics[];
  testerMetrics: TesterMetrics[];
  prCommentAuthors: PRCommentAuthor[];
  summary: {
    totalWorkItems: number;
    totalRequirements: number;
    totalBugs: number;
    totalTasks: number;
    avgDevTimeHours: number; // Renamed
    avgDevTestTimeHours: number; // Renamed
    avgStgTestTimeHours: number; // Renamed
    totalReturns: number;
    totalPrComments: number;
  };
  chartData: {
    developmentSpeed: ChartDataPoint[];
    testingSpeed: ChartDataPoint[];
    returns: ChartDataPoint[];
    iterations: ChartDataPoint[];
    prComments: PRChartDataPoint[];
  };
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
  APPROVED: 'Approved',
  READY_FOR_RELEASE: 'Ready For Release',
  RELEASED: 'Released',
} as const;

export const WORK_ITEM_TYPES = {
  REQUIREMENT: 'Requirement',
  BUG: 'Bug',
  TASK: 'Task',
} as const;

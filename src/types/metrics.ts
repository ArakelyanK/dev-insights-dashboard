// Azure DevOps Analytics Types

export interface AnalysisRequest {
  organization: string;
  project: string;
  queryId: string;
  pat: string;
}

export interface DeveloperMetrics {
  developer: string;
  developmentSpeedHours: number;
  totalReturnCount: number;
  codeReviewReturns: number;
  devTestingReturns: number;
  stgTestingReturns: number;
  itemsCompleted: number;
}

export interface TesterMetrics {
  tester: string;
  closedItemsCount: number;
  avgDevTestingSpeedHours: number;
  avgStgTestingSpeedHours: number;
  devTestingIterations: number;
  stgTestingIterations: number;
  prCommentsCount: number;
}

export interface ChartDataPoint {
  name: string;
  value: number;
  category?: string;
}

export interface AnalysisResult {
  developerMetrics: DeveloperMetrics[];
  testerMetrics: TesterMetrics[];
  summary: {
    totalWorkItems: number;
    totalRequirements: number;
    totalBugs: number;
    totalTasks: number;
    avgDevelopmentSpeedHours: number;
    avgDevTestingSpeedHours: number;
    avgStgTestingSpeedHours: number;
    totalReturns: number;
    totalPrComments: number;
  };
  chartData: {
    developmentSpeed: ChartDataPoint[];
    testingSpeed: ChartDataPoint[];
    returns: ChartDataPoint[];
    iterations: ChartDataPoint[];
    prComments: ChartDataPoint[];
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
  APPROVED: 'Approved',
  READY_FOR_RELEASE: 'Ready For Release',
  RELEASED: 'Released',
} as const;

export const WORK_ITEM_TYPES = {
  REQUIREMENT: 'Requirement',
  BUG: 'Bug',
  TASK: 'Task',
} as const;

import { useState, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricCard } from "./MetricCard";
import { DeveloperMetricsTable } from "./DeveloperMetricsTable";
import { TesterMetricsTable } from "./TesterMetricsTable";
import { MetricsCharts } from "./MetricsCharts";
import { StoryPointsCard } from "./StoryPointsCard";
import { AnalysisFiltersPanel, applyFilters, extractAvailableStates } from "./AnalysisFilters";
import type { AnalysisResult, AnalysisFilters, WorkItemRaw, DeveloperMetrics, TesterMetrics, StoryPointsAnalytics, ChartDataPoint, PRChartDataPoint } from "@/types/metrics";
import { t } from "@/lib/i18n";
import { 
  FileCode2, 
  TestTube2, 
  Clock, 
  RotateCcw, 
  MessageSquare,
  ArrowLeft,
  BarChart3,
  Table,
  Bug,
  FileText,
  ListTodo,
  Info
} from "lucide-react";
import { formatDuration } from "@/lib/formatters";

interface AnalysisResultsProps {
  result: AnalysisResult;
  onBack: () => void;
  organization: string;
  project: string;
}

// Recalculate metrics from filtered raw data
function recalculateMetrics(
  filteredItems: WorkItemRaw[],
  originalResult: AnalysisResult
): {
  developerMetrics: DeveloperMetrics[];
  testerMetrics: TesterMetrics[];
  summary: AnalysisResult['summary'];
  chartData: AnalysisResult['chartData'];
  storyPointsAnalytics?: StoryPointsAnalytics;
} {
  const filteredIds = new Set(filteredItems.map(item => item.id));
  
  // Filter developer metrics by items that match filter
  const developerMetrics = originalResult.developerMetrics.map(dev => {
    const filteredWorkItems = dev.workItems.filter(wi => filteredIds.has(wi.id));
    const filteredReturns = dev.returnItems.filter(wi => filteredIds.has(wi.id));
    const filteredCrReturns = dev.codeReviewReturnItems.filter(wi => filteredIds.has(wi.id));
    const filteredDevReturns = dev.devTestingReturnItems.filter(wi => filteredIds.has(wi.id));
    const filteredStgReturns = dev.stgTestingReturnItems.filter(wi => filteredIds.has(wi.id));
    
    const taskCount = filteredWorkItems.length;
    const hours = filteredWorkItems.reduce((sum, wi) => sum + (wi.activeTimeHours ?? 0), 0);
    const cr = filteredCrReturns.reduce((sum, wi) => sum + wi.count, 0);
    const devRet = filteredDevReturns.reduce((sum, wi) => sum + wi.count, 0);
    const stgRet = filteredStgReturns.reduce((sum, wi) => sum + wi.count, 0);
    const total = cr + devRet + stgRet;
    
    const itemsWithSp = filteredWorkItems.filter(wi => wi.originalEstimate !== undefined && wi.originalEstimate > 0);
    const totalSp = itemsWithSp.reduce((sum, wi) => sum + (wi.originalEstimate ?? 0), 0);
    
    return {
      ...dev,
      avgDevTimeHours: taskCount > 0 ? hours / taskCount : 0,
      itemsCompleted: filteredWorkItems.filter(wi => {
        const raw = filteredItems.find(f => f.id === wi.id);
        return raw?.state === 'Released';
      }).length,
      totalReturnCount: total,
      codeReviewReturns: cr,
      devTestingReturns: devRet,
      stgTestingReturns: stgRet,
      avgTotalReturnsPerTask: taskCount > 0 ? total / taskCount : 0,
      avgCodeReviewReturnsPerTask: taskCount > 0 ? cr / taskCount : 0,
      avgDevTestingReturnsPerTask: taskCount > 0 ? devRet / taskCount : 0,
      avgStgTestingReturnsPerTask: taskCount > 0 ? stgRet / taskCount : 0,
      avgOriginalEstimate: itemsWithSp.length > 0 ? totalSp / itemsWithSp.length : 0,
      totalOriginalEstimate: totalSp,
      itemsWithEstimate: itemsWithSp.length,
      workItems: filteredWorkItems,
      returnItems: filteredReturns,
      codeReviewReturnItems: filteredCrReturns,
      devTestingReturnItems: filteredDevReturns,
      stgTestingReturnItems: filteredStgReturns,
    };
  }).filter(dev => dev.workItems.length > 0);

  // Filter tester metrics
  const testerMetrics = originalResult.testerMetrics.map(tester => {
    const filteredClosed = tester.closedItems.filter(wi => filteredIds.has(wi.id));
    const filteredDevItems = tester.devIterationItems.filter(wi => filteredIds.has(wi.id));
    const filteredStgItems = tester.stgIterationItems.filter(wi => filteredIds.has(wi.id));
    
    const taskCount = Math.max(filteredDevItems.length, filteredStgItems.length, filteredClosed.length, 1);
    const devHours = filteredDevItems.reduce((sum, wi) => sum + (wi.devTestTimeHours ?? 0), 0);
    const stgHours = filteredStgItems.reduce((sum, wi) => sum + (wi.stgTestTimeHours ?? 0), 0);
    const devIter = filteredDevItems.reduce((sum, wi) => sum + wi.count, 0);
    const stgIter = filteredStgItems.reduce((sum, wi) => sum + wi.count, 0);
    
    const itemsWithSp = filteredClosed.filter(wi => wi.originalEstimate !== undefined && wi.originalEstimate > 0);
    const totalSp = itemsWithSp.reduce((sum, wi) => sum + (wi.originalEstimate ?? 0), 0);
    
    return {
      ...tester,
      closedItemsCount: filteredClosed.length,
      avgDevTestTimeHours: taskCount > 0 ? devHours / taskCount : 0,
      avgStgTestTimeHours: taskCount > 0 ? stgHours / taskCount : 0,
      devTestingIterations: devIter,
      stgTestingIterations: stgIter,
      avgDevIterationsPerTask: taskCount > 0 ? devIter / taskCount : 0,
      avgStgIterationsPerTask: taskCount > 0 ? stgIter / taskCount : 0,
      avgOriginalEstimate: itemsWithSp.length > 0 ? totalSp / itemsWithSp.length : 0,
      totalOriginalEstimate: totalSp,
      itemsWithEstimate: itemsWithSp.length,
      closedItems: filteredClosed,
      devIterationItems: filteredDevItems,
      stgIterationItems: filteredStgItems,
    };
  }).filter(tester => tester.closedItems.length > 0 || tester.devIterationItems.length > 0 || tester.stgIterationItems.length > 0);

  // Recalculate summary
  const requirements = filteredItems.filter(wi => wi.type === 'Requirement').length;
  const bugs = filteredItems.filter(wi => wi.type === 'Bug').length;
  const tasks = filteredItems.filter(wi => wi.type === 'Task').length;
  const numTasks = requirements + bugs;
  
  const totalDevHours = filteredItems.reduce((sum, wi) => sum + wi.activeTimeHours, 0);
  const totalDevTestHours = filteredItems.reduce((sum, wi) => sum + wi.devTestTimeHours, 0);
  const totalStgTestHours = filteredItems.reduce((sum, wi) => sum + wi.stgTestTimeHours, 0);
  const totalReturns = developerMetrics.reduce((sum, d) => sum + d.totalReturnCount, 0);
  
  // Story points
  const itemsWithSp = filteredItems.filter(wi => wi.originalEstimate !== undefined && wi.originalEstimate > 0);
  const totalSp = itemsWithSp.reduce((sum, wi) => sum + (wi.originalEstimate ?? 0), 0);
  const totalActiveHoursWithSp = itemsWithSp.reduce((sum, wi) => sum + wi.activeTimeHours, 0);
  const avgStoryPoints = itemsWithSp.length > 0 ? totalSp / itemsWithSp.length : 0;
  const costPerStoryPoint = totalSp > 0 ? totalActiveHoursWithSp / totalSp : 0;

  // Fibonacci breakdown
  const fibonacciData: Record<number, { count: number; totalHours: number }> = {};
  [1, 2, 3, 5, 8, 13, 21, 34, 55, 89].forEach(f => {
    fibonacciData[f] = { count: 0, totalHours: 0 };
  });
  itemsWithSp.forEach(wi => {
    const sp = wi.originalEstimate!;
    if (fibonacciData[sp]) {
      fibonacciData[sp].count++;
      fibonacciData[sp].totalHours += wi.activeTimeHours;
    }
  });

  const fibonacciBreakdown = Object.entries(fibonacciData)
    .filter(([, data]) => data.count > 0)
    .map(([estimate, data]) => ({
      estimate: Number(estimate),
      itemCount: data.count,
      totalActiveHours: data.totalHours,
      avgHoursPerSp: data.count > 0 ? data.totalHours / (data.count * Number(estimate)) : 0,
    }));

  const summary = {
    totalWorkItems: filteredItems.length,
    totalRequirements: requirements,
    totalBugs: bugs,
    totalTasks: tasks,
    avgDevTimeHours: numTasks > 0 ? totalDevHours / numTasks : 0,
    avgDevTestTimeHours: numTasks > 0 ? totalDevTestHours / numTasks : 0,
    avgStgTestTimeHours: numTasks > 0 ? totalStgTestHours / numTasks : 0,
    totalReturns,
    totalPrComments: originalResult.summary.totalPrComments, // PR comments not filtered
    avgStoryPoints,
    costPerStoryPoint,
  };

  // Recalculate chart data
  const chartData: AnalysisResult['chartData'] = {
    developmentSpeed: developerMetrics.filter(d => d.avgDevTimeHours > 0).map(d => ({ 
      name: d.developer, 
      value: Math.round(d.avgDevTimeHours * 10) / 10 
    })),
    devTestingSpeed: testerMetrics.filter(t => t.avgDevTestTimeHours > 0).map(t => ({ 
      name: t.tester, 
      value: Math.round(t.avgDevTestTimeHours * 10) / 10 
    })),
    stgTestingSpeed: testerMetrics.filter(t => t.avgStgTestTimeHours > 0).map(t => ({ 
      name: t.tester, 
      value: Math.round(t.avgStgTestTimeHours * 10) / 10 
    })),
    returns: developerMetrics.filter(d => d.totalReturnCount > 0).map(d => ({ 
      name: d.developer, 
      value: d.totalReturnCount 
    })),
    devIterations: testerMetrics.filter(t => t.devTestingIterations > 0).map(t => ({ 
      name: t.tester, 
      value: t.devTestingIterations 
    })),
    stgIterations: testerMetrics.filter(t => t.stgTestingIterations > 0).map(t => ({ 
      name: t.tester, 
      value: t.stgTestingIterations 
    })),
    prComments: originalResult.chartData.prComments, // PR comments not filtered
    storyPointsCost: fibonacciBreakdown.map(f => ({ 
      name: `${f.estimate} SP`, 
      value: Math.round(f.avgHoursPerSp * 10) / 10 
    })),
  };

  const storyPointsAnalytics: StoryPointsAnalytics | undefined = itemsWithSp.length > 0 ? {
    averageStoryPoints: avgStoryPoints,
    itemsWithEstimate: itemsWithSp.length,
    itemsWithoutEstimate: filteredItems.length - itemsWithSp.length,
    totalStoryPoints: totalSp,
    costPerStoryPoint,
    fibonacciBreakdown,
  } : undefined;

  return { developerMetrics, testerMetrics, summary, chartData, storyPointsAnalytics };
}

export function AnalysisResults({ result, onBack, organization, project }: AnalysisResultsProps) {
  const [filters, setFilters] = useState<AnalysisFilters>({
    workItemTypes: new Set(['Requirement', 'Bug', 'Task']),
    stateTransition: undefined,
  });

  // Get available states from raw data
  const availableStates = useMemo(() => {
    return result.workItemsRaw ? extractAvailableStates(result.workItemsRaw) : [];
  }, [result.workItemsRaw]);

  // Apply filters to raw data
  const filteredItems = useMemo(() => {
    if (!result.workItemsRaw) return [];
    return applyFilters(result.workItemsRaw, filters);
  }, [result.workItemsRaw, filters]);

  // Check if filters are active
  const hasActiveFilters = filters.workItemTypes.size < 3 || filters.stateTransition !== undefined;

  // Recalculate all metrics based on filtered data
  const { developerMetrics, testerMetrics, summary, chartData, storyPointsAnalytics } = useMemo(() => {
    if (!hasActiveFilters || !result.workItemsRaw) {
      return {
        developerMetrics: result.developerMetrics,
        testerMetrics: result.testerMetrics,
        summary: result.summary,
        chartData: result.chartData,
        storyPointsAnalytics: result.storyPointsAnalytics,
      };
    }
    return recalculateMetrics(filteredItems, result);
  }, [filteredItems, result, hasActiveFilters]);

  // Enrich developer workItems with DEV/STG test times from raw data (fix #7)
  const enrichedDeveloperMetrics = useMemo(() => {
    const rawItems = result.workItemsRaw || [];
    if (rawItems.length === 0) return developerMetrics;
    const rawMap = new Map(rawItems.map(r => [r.id, r]));
    return developerMetrics.map(dev => ({
      ...dev,
      workItems: dev.workItems.map(wi => {
        const raw = rawMap.get(wi.id);
        if (!raw) return wi;
        return {
          ...wi,
          devTestTimeHours: wi.devTestTimeHours ?? (raw.devTestTimeHours > 0 ? raw.devTestTimeHours : undefined),
          stgTestTimeHours: wi.stgTestTimeHours ?? (raw.stgTestTimeHours > 0 ? raw.stgTestTimeHours : undefined),
        };
      }),
    }));
  }, [developerMetrics, result.workItemsRaw]);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gradient-azure">{t('analysisResults')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('analyzedWorkItems', { count: summary.totalWorkItems })}
            {hasActiveFilters && result.workItemsRaw && (
              <span className="text-primary ml-2">
                (из {result.workItemsRaw.length} после фильтрации)
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AnalysisFiltersPanel 
            filters={filters} 
            onFiltersChange={setFilters}
            availableStates={availableStates}
          />
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('newAnalysis')}
          </Button>
        </div>
      </div>

      {/* Working time info */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-accent/30 px-3 py-2 rounded-md">
        <Info className="h-4 w-4" />
        <span>{t('workingTimeInfo')}: {t('workingHours')}, {t('excludedDays')}</span>
      </div>

      {/* Summary Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title={t('totalWorkItems')}
          value={summary.totalWorkItems}
          subtitle={`${summary.totalRequirements} ${t('requirements')}, ${summary.totalBugs} ${t('bugs')}`}
          icon={FileCode2}
        />
        <MetricCard
          title={t('avgDevTime')}
          value={formatDuration(summary.avgDevTimeHours)}
          subtitle={t('activeStatePerTask')}
          icon={Clock}
        />
        <MetricCard
          title={t('totalReturns')}
          value={summary.totalReturns}
          subtitle={t('itemsSentToFixRequired')}
          icon={RotateCcw}
          variant={summary.totalReturns > 0 ? "warning" : "success"}
        />
        <MetricCard
          title={t('prComments')}
          value={summary.totalPrComments}
          subtitle={t('commentsFromLinkedPrs')}
          icon={MessageSquare}
        />
      </div>

      {/* Testing Time Summary */}
      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard
          title={t('avgDevTestTime')}
          value={formatDuration(summary.avgDevTestTimeHours)}
          subtitle={t('devInTestingPerTask')}
          icon={TestTube2}
        />
        <MetricCard
          title={t('avgStgTestTime')}
          value={formatDuration(summary.avgStgTestTimeHours)}
          subtitle={t('stgInTestingPerTask')}
          icon={TestTube2}
        />
      </div>

      {/* Story Points Analytics */}
      {storyPointsAnalytics && storyPointsAnalytics.itemsWithEstimate > 0 && (
        <StoryPointsCard 
          analytics={storyPointsAnalytics}
          workItemsRaw={filteredItems}
          organization={organization}
          project={project}
        />
      )}

      {/* Work Item Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListTodo className="h-5 w-5" />
            {t('workItemBreakdown')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-accent/50">
              <FileText className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{summary.totalRequirements}</p>
                <p className="text-sm text-muted-foreground">{t('requirements')}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-lg bg-accent/50">
              <Bug className="h-8 w-8 text-destructive" />
              <div>
                <p className="text-2xl font-bold">{summary.totalBugs}</p>
                <p className="text-sm text-muted-foreground">{t('bugs')}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-lg bg-accent/50">
              <FileCode2 className="h-8 w-8 text-info" />
              <div>
                <p className="text-2xl font-bold">{summary.totalTasks}</p>
                <p className="text-sm text-muted-foreground">{t('tasksForPrOnly')}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Metrics */}
      <Tabs defaultValue="tables" className="space-y-6">
        <TabsList>
          <TabsTrigger value="tables" className="flex items-center gap-2">
            <Table className="h-4 w-4" />
            {t('tables')}
          </TabsTrigger>
          <TabsTrigger value="charts" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            {t('charts')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tables" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileCode2 className="h-5 w-5" />
                {t('developerMetrics')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DeveloperMetricsTable 
                metrics={enrichedDeveloperMetrics} 
                organization={organization}
                project={project}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TestTube2 className="h-5 w-5" />
                {t('testerMetrics')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TesterMetricsTable 
                metrics={testerMetrics}
                organization={organization}
                project={project}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="charts">
          <MetricsCharts 
            chartData={chartData} 
            filters={filters}
            onFiltersChange={setFilters}
            availableStates={availableStates}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

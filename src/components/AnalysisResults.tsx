import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "./MetricCard";
import { DeveloperMetricsTable } from "./DeveloperMetricsTable";
import { TesterMetricsTable } from "./TesterMetricsTable";
import { MetricsCharts } from "./MetricsCharts";
import { DrillDownModal } from "./DrillDownModal";
import type { AnalysisResult } from "@/types/metrics";
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
  AlertTriangle
} from "lucide-react";
import { formatDuration } from "@/lib/formatters";

interface AnalysisResultsProps {
  result: AnalysisResult;
  onBack: () => void;
  organization: string;
  project: string;
}

export function AnalysisResults({ result, onBack, organization, project }: AnalysisResultsProps) {
  const { summary, developerMetrics, testerMetrics, chartData, unassignedItems } = result;
  const [unassignedOpen, setUnassignedOpen] = useState(false);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gradient-azure">{t('analysisResults')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('analyzedWorkItems', { count: summary.totalWorkItems })}
          </p>
        </div>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('newAnalysis')}
        </Button>
      </div>

      {/* Unassigned Warning */}
      {unassignedItems && unassignedItems.length > 0 && (
        <div className="p-4 rounded-lg bg-warning/10 border border-warning/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <div>
              <p className="font-medium text-foreground">{t('unassignedItems')}</p>
              <p className="text-sm text-muted-foreground">
                {unassignedItems.length} элементов без назначенного исполнителя
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setUnassignedOpen(true)}>
            {t('viewUnassigned')}
          </Button>
        </div>
      )}

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
                metrics={developerMetrics} 
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
          <MetricsCharts chartData={chartData} />
        </TabsContent>
      </Tabs>

      {/* Unassigned Modal */}
      <DrillDownModal
        open={unassignedOpen}
        onOpenChange={setUnassignedOpen}
        title={t('unassignedItems')}
        items={unassignedItems || []}
        organization={organization}
        project={project}
      />
    </div>
  );
}

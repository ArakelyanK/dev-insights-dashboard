import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricCard } from "./MetricCard";
import { DeveloperMetricsTable } from "./DeveloperMetricsTable";
import { TesterMetricsTable } from "./TesterMetricsTable";
import { MetricsCharts } from "./MetricsCharts";
import type { AnalysisResult } from "@/types/metrics";
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
  ListTodo
} from "lucide-react";
import { formatDuration } from "@/lib/formatters";

interface AnalysisResultsProps {
  result: AnalysisResult;
  onBack: () => void;
}

export function AnalysisResults({ result, onBack }: AnalysisResultsProps) {
  const { summary, developerMetrics, testerMetrics, chartData } = result;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gradient-azure">Analysis Results</h1>
          <p className="text-muted-foreground mt-1">
            Analyzed {summary.totalWorkItems} work items
          </p>
        </div>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          New Analysis
        </Button>
      </div>

      {/* Summary Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Work Items"
          value={summary.totalWorkItems}
          subtitle={`${summary.totalRequirements} Requirements, ${summary.totalBugs} Bugs`}
          icon={FileCode2}
        />
        <MetricCard
          title="Avg Development Speed"
          value={formatDuration(summary.avgDevelopmentSpeedHours)}
          subtitle="Active → Code Review"
          icon={Clock}
        />
        <MetricCard
          title="Total Returns"
          value={summary.totalReturns}
          subtitle="Items sent back to Fix Required"
          icon={RotateCcw}
          variant={summary.totalReturns > 0 ? "warning" : "success"}
        />
        <MetricCard
          title="PR Comments"
          value={summary.totalPrComments}
          subtitle="Comments from linked PRs"
          icon={MessageSquare}
        />
      </div>

      {/* Testing Speed Summary */}
      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard
          title="Avg DEV Testing Speed"
          value={formatDuration(summary.avgDevTestingSpeedHours)}
          subtitle="DEV_In Testing → Approved"
          icon={TestTube2}
        />
        <MetricCard
          title="Avg STG Testing Speed"
          value={formatDuration(summary.avgStgTestingSpeedHours)}
          subtitle="STG_In Testing → Ready For Release"
          icon={TestTube2}
        />
      </div>

      {/* Work Item Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListTodo className="h-5 w-5" />
            Work Item Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-accent/50">
              <FileText className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{summary.totalRequirements}</p>
                <p className="text-sm text-muted-foreground">Requirements</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-lg bg-accent/50">
              <Bug className="h-8 w-8 text-destructive" />
              <div>
                <p className="text-2xl font-bold">{summary.totalBugs}</p>
                <p className="text-sm text-muted-foreground">Bugs</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-lg bg-accent/50">
              <FileCode2 className="h-8 w-8 text-info" />
              <div>
                <p className="text-2xl font-bold">{summary.totalTasks}</p>
                <p className="text-sm text-muted-foreground">Tasks (PR comments only)</p>
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
            Tables
          </TabsTrigger>
          <TabsTrigger value="charts" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Charts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tables" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileCode2 className="h-5 w-5" />
                Developer Metrics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DeveloperMetricsTable metrics={developerMetrics} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TestTube2 className="h-5 w-5" />
                Tester Metrics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TesterMetricsTable metrics={testerMetrics} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="charts">
          <MetricsCharts chartData={chartData} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

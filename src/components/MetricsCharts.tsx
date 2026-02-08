import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { AnalysisFiltersPanel } from "./AnalysisFilters";
import type { AnalysisResult, PRChartDataPoint, AnalysisFilters } from "@/types/metrics";
import { t } from "@/lib/i18n";
import { formatDuration } from "@/lib/formatters";
import { Maximize2, Minimize2 } from "lucide-react";

interface MetricsChartsProps {
  chartData: AnalysisResult["chartData"];
  filters?: AnalysisFilters;
  onFiltersChange?: (filters: AnalysisFilters) => void;
  availableStates?: string[];
}

const COLORS = [
  "hsl(211, 100%, 45%)",
  "hsl(142, 71%, 45%)",
  "hsl(38, 92%, 50%)",
  "hsl(280, 65%, 60%)",
  "hsl(0, 72%, 51%)",
  "hsl(199, 89%, 48%)",
  "hsl(25, 95%, 53%)",
  "hsl(175, 80%, 40%)",
  "hsl(320, 70%, 50%)",
  "hsl(60, 80%, 45%)",
];

// Custom tooltip to format hours
const HoursTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card border border-border rounded-md p-2 shadow-md">
        <p className="font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">
          {formatDuration(payload[0].value)}
        </p>
      </div>
    );
  }
  return null;
};

const CountTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card border border-border rounded-md p-2 shadow-md">
        <p className="font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">
          {payload[0].value}
        </p>
      </div>
    );
  }
  return null;
};

// Horizontal scrollable bar chart for many entries
function ScrollableBarChart({ 
  data, 
  title, 
  fill, 
  tooltipType = 'count',
  isFullscreen = false,
}: { 
  data: { name: string; value: number }[]; 
  title: string; 
  fill: string;
  tooltipType?: 'hours' | 'count';
  isFullscreen?: boolean;
}) {
  const [fullscreen, setFullscreen] = useState(isFullscreen);
  
  // Calculate width based on data size - ensure minimum visibility
  const barWidth = 50;
  const minWidth = 400;
  const chartWidth = Math.max(data.length * barWidth, minWidth);
  const chartHeight = fullscreen ? 500 : 300;

  return (
    <Card className={fullscreen ? "fixed inset-4 z-50 overflow-auto" : ""}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg">{title}</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFullscreen(!fullscreen)}
          className="h-8 w-8 p-0"
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            Нет данных
          </div>
        ) : data.length <= 8 ? (
          // For small datasets, use responsive container
          <div style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  height={70}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))"
                  tickFormatter={tooltipType === 'hours' ? (v) => formatDuration(v) : undefined}
                />
                <Tooltip content={tooltipType === 'hours' ? <HoursTooltip /> : <CountTooltip />} />
                <Bar dataKey="value" fill={fill} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          // For large datasets, use horizontal scroll
          <ScrollArea className="w-full whitespace-nowrap rounded-md">
            <div style={{ width: chartWidth, height: chartHeight }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} layout="horizontal">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="name" 
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fontSize: 10 }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    interval={0}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={tooltipType === 'hours' ? (v) => formatDuration(v) : undefined}
                  />
                  <Tooltip content={tooltipType === 'hours' ? <HoursTooltip /> : <CountTooltip />} />
                  <Bar dataKey="value" fill={fill} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )}
        {data.length > 8 && (
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Прокрутите вправо для просмотра всех {data.length} элементов
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function MetricsCharts({ chartData, filters, onFiltersChange, availableStates = [] }: MetricsChartsProps) {
  const [showTestersOnly, setShowTestersOnly] = useState(false);
  const [prFullscreen, setPrFullscreen] = useState(false);

  // Filter PR comments based on toggle
  const filteredPrComments = showTestersOnly
    ? (chartData.prComments as PRChartDataPoint[]).filter(p => p.isTester)
    : chartData.prComments;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Filters at the top of charts page */}
      {filters && onFiltersChange && (
        <div className="flex items-center justify-between bg-card p-4 rounded-lg border">
          <span className="text-sm font-medium">{t('activeFilters')}:</span>
          <AnalysisFiltersPanel 
            filters={filters} 
            onFiltersChange={onFiltersChange}
            availableStates={availableStates}
          />
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Development Time Chart */}
        <ScrollableBarChart
          data={chartData.developmentSpeed}
          title={t('avgDevTimeChart')}
          fill="hsl(211, 100%, 45%)"
          tooltipType="hours"
        />

        {/* DEV Testing Time Chart */}
        <ScrollableBarChart
          data={chartData.devTestingSpeed}
          title={t('avgDevTestTimeChart')}
          fill="hsl(142, 71%, 45%)"
          tooltipType="hours"
        />

        {/* STG Testing Time Chart */}
        <ScrollableBarChart
          data={chartData.stgTestingSpeed}
          title={t('avgStgTestTimeChart')}
          fill="hsl(38, 92%, 50%)"
          tooltipType="hours"
        />

        {/* Returns Chart */}
        <ScrollableBarChart
          data={chartData.returns}
          title={t('returnsToFixRequired')}
          fill="hsl(0, 72%, 51%)"
          tooltipType="count"
        />

        {/* DEV Iterations Chart */}
        <ScrollableBarChart
          data={chartData.devIterations}
          title={t('devIterationsPerTester')}
          fill="hsl(280, 65%, 60%)"
          tooltipType="count"
        />

        {/* STG Iterations Chart */}
        <ScrollableBarChart
          data={chartData.stgIterations}
          title={t('stgIterationsPerTester')}
          fill="hsl(199, 89%, 48%)"
          tooltipType="count"
        />

        {/* Story Points Cost Chart */}
        {chartData.storyPointsCost && chartData.storyPointsCost.length > 0 && (
          <ScrollableBarChart
            data={chartData.storyPointsCost}
            title={t('storyPointsCostChart')}
            fill="hsl(25, 95%, 53%)"
            tooltipType="hours"
          />
        )}
      </div>

      {/* PR Comments Pie Chart */}
      <Card className={prFullscreen ? "fixed inset-4 z-50 overflow-auto" : ""}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{t('prCommentsByAuthor')}</CardTitle>
            <div className="flex items-center gap-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="testers-only"
                  checked={showTestersOnly}
                  onCheckedChange={setShowTestersOnly}
                />
                <Label htmlFor="testers-only" className="text-sm text-muted-foreground">
                  {t('showTestersOnly')}
                </Label>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPrFullscreen(!prFullscreen)}
                className="h-8 w-8 p-0"
              >
                {prFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className={prFullscreen ? "h-[calc(100vh-200px)]" : "h-[300px]"}>
            {filteredPrComments.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={filteredPrComments}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={prFullscreen ? 200 : 100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {filteredPrComments.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CountTooltip />} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                {t('noTesterPrComments')}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

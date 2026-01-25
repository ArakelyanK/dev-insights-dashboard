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
import type { AnalysisResult, PRChartDataPoint } from "@/types/metrics";
import { t } from "@/lib/i18n";
import { formatDuration } from "@/lib/formatters";

interface MetricsChartsProps {
  chartData: AnalysisResult["chartData"];
}

const COLORS = [
  "hsl(211, 100%, 45%)",
  "hsl(142, 71%, 45%)",
  "hsl(38, 92%, 50%)",
  "hsl(280, 65%, 60%)",
  "hsl(0, 72%, 51%)",
  "hsl(199, 89%, 48%)",
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

export function MetricsCharts({ chartData }: MetricsChartsProps) {
  const [showTestersOnly, setShowTestersOnly] = useState(false);

  // Filter PR comments based on toggle
  const filteredPrComments = showTestersOnly
    ? (chartData.prComments as PRChartDataPoint[]).filter(p => p.isTester)
    : chartData.prComments;

  return (
    <div className="grid gap-6 md:grid-cols-2 animate-fade-in">
      {/* Development Time Chart - Horizontal Bar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('avgDevTimeChart')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData.developmentSpeed} layout="horizontal">
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
                  tickFormatter={(v) => formatDuration(v)}
                />
                <Tooltip content={<HoursTooltip />} />
                <Bar dataKey="value" fill="hsl(211, 100%, 45%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* DEV Testing Time Chart - Horizontal Bar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('avgDevTestTimeChart')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData.devTestingSpeed} layout="horizontal">
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
                  tickFormatter={(v) => formatDuration(v)}
                />
                <Tooltip content={<HoursTooltip />} />
                <Bar dataKey="value" fill="hsl(142, 71%, 45%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* STG Testing Time Chart - Horizontal Bar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('avgStgTestTimeChart')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData.stgTestingSpeed} layout="horizontal">
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
                  tickFormatter={(v) => formatDuration(v)}
                />
                <Tooltip content={<HoursTooltip />} />
                <Bar dataKey="value" fill="hsl(38, 92%, 50%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Returns Chart - Horizontal Bar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('returnsToFixRequired')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData.returns} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  height={70}
                />
                <YAxis stroke="hsl(var(--muted-foreground))" />
                <Tooltip content={<CountTooltip />} />
                <Bar dataKey="value" fill="hsl(0, 72%, 51%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* DEV Iterations Chart - Horizontal Bar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('devIterationsPerTester')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData.devIterations} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  height={70}
                />
                <YAxis stroke="hsl(var(--muted-foreground))" />
                <Tooltip content={<CountTooltip />} />
                <Bar dataKey="value" fill="hsl(280, 65%, 60%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* STG Iterations Chart - Horizontal Bar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('stgIterationsPerTester')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData.stgIterations} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  height={70}
                />
                <YAxis stroke="hsl(var(--muted-foreground))" />
                <Tooltip content={<CountTooltip />} />
                <Bar dataKey="value" fill="hsl(199, 89%, 48%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* PR Comments Pie Chart */}
      <Card className="md:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{t('prCommentsByAuthor')}</CardTitle>
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
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            {filteredPrComments.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={filteredPrComments}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={100}
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

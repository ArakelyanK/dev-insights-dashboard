import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, Clock, Hash, Info } from "lucide-react";
import type { StoryPointsAnalytics } from "@/types/metrics";
import { t } from "@/lib/i18n";
import { formatDuration, formatNumber } from "@/lib/formatters";

interface StoryPointsCardProps {
  analytics: StoryPointsAnalytics;
}

export function StoryPointsCard({ analytics }: StoryPointsCardProps) {
  const {
    averageStoryPoints,
    itemsWithEstimate,
    itemsWithoutEstimate,
    totalStoryPoints,
    costPerStoryPoint,
    fibonacciBreakdown,
  } = analytics;

  if (itemsWithEstimate === 0) {
    return null; // Don't show if no items have estimates
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          {t('storyPointsAnalytics')}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>
                  Расчёт основан на полях Original Estimate. 
                  Время считается только по рабочим часам (09:00-18:00 UTC+3), 
                  без выходных и праздников.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-4 mb-6">
          {/* Average SP */}
          <div className="p-4 rounded-lg bg-accent/50">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Hash className="h-4 w-4" />
              {t('avgStoryPoints')}
            </div>
            <p className="text-2xl font-bold">{formatNumber(averageStoryPoints, 1)}</p>
            <p className="text-xs text-muted-foreground">{t('avgStoryPointsDesc')}</p>
          </div>

          {/* Cost per SP */}
          <div className="p-4 rounded-lg bg-accent/50">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Clock className="h-4 w-4" />
              {t('costPerSp')}
            </div>
            <p className="text-2xl font-bold">{formatDuration(costPerStoryPoint)}</p>
            <p className="text-xs text-muted-foreground">{t('costPerSpDesc')}</p>
          </div>

          {/* Items with estimate */}
          <div className="p-4 rounded-lg bg-accent/50">
            <div className="text-muted-foreground text-sm mb-1">
              {t('itemsWithEstimate')}
            </div>
            <p className="text-2xl font-bold">{itemsWithEstimate}</p>
            <p className="text-xs text-muted-foreground">
              Σ = {totalStoryPoints} SP
            </p>
          </div>

          {/* Items without estimate */}
          <div className="p-4 rounded-lg bg-accent/50">
            <div className="text-muted-foreground text-sm mb-1">
              {t('itemsWithoutEstimate')}
            </div>
            <p className="text-2xl font-bold">{itemsWithoutEstimate}</p>
            <p className="text-xs text-muted-foreground">
              {itemsWithoutEstimate > 0 ? 'Не учтены в расчётах SP' : 'Все элементы с оценкой'}
            </p>
          </div>
        </div>

        {/* Fibonacci breakdown */}
        {fibonacciBreakdown.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3">{t('fibonacciBreakdown')}</h4>
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>SP</th>
                    <th className="text-center">{t('itemCount')}</th>
                    <th className="text-center">{t('totalHours')}</th>
                    <th className="text-center">{t('avgHoursPerSp')}</th>
                  </tr>
                </thead>
                <tbody>
                  {fibonacciBreakdown.map((fb) => (
                    <tr key={fb.estimate}>
                      <td>
                        <Badge variant="outline">{fb.estimate}</Badge>
                      </td>
                      <td className="text-center">{fb.itemCount}</td>
                      <td className="text-center">{formatDuration(fb.totalActiveHours)}</td>
                      <td className="text-center font-medium">
                        {formatDuration(fb.avgHoursPerSp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, Clock, Hash, Info, ExternalLink, X, Maximize2, Minimize2 } from "lucide-react";
import type { StoryPointsAnalytics, WorkItemRaw } from "@/types/metrics";
import { t } from "@/lib/i18n";
import { formatDuration, formatNumber } from "@/lib/formatters";

interface StoryPointsCardProps {
  analytics: StoryPointsAnalytics;
  workItemsRaw?: WorkItemRaw[];
  organization?: string;
  project?: string;
}

export function StoryPointsCard({ analytics, workItemsRaw = [], organization = '', project = '' }: StoryPointsCardProps) {
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [drillDownSp, setDrillDownSp] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const {
    averageStoryPoints,
    itemsWithEstimate,
    itemsWithoutEstimate,
    totalStoryPoints,
    costPerStoryPoint,
    fibonacciBreakdown,
  } = analytics;

  if (itemsWithEstimate === 0) return null;

  const getWorkItemUrl = (id: number) =>
    `https://dev.azure.com/${organization}/${project}/_workitems/edit/${id}`;

  const openSpDrillDown = (sp: number) => {
    setDrillDownSp(sp);
    setDrillDownOpen(true);
  };

  const drillDownItems = drillDownSp !== null
    ? workItemsRaw.filter(wi => wi.originalEstimate === drillDownSp)
    : [];

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
          <div className="p-4 rounded-lg bg-accent/50">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Hash className="h-4 w-4" />
              {t('avgStoryPoints')}
            </div>
            <p className="text-2xl font-bold">{formatNumber(averageStoryPoints, 1)}</p>
            <p className="text-xs text-muted-foreground">{t('avgStoryPointsDesc')}</p>
          </div>

          <div className="p-4 rounded-lg bg-accent/50">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Clock className="h-4 w-4" />
              {t('costPerSp')}
            </div>
            <p className="text-2xl font-bold">{formatDuration(costPerStoryPoint)}</p>
            <p className="text-xs text-muted-foreground">{t('costPerSpDesc')}</p>
          </div>

          <div className="p-4 rounded-lg bg-accent/50">
            <div className="text-muted-foreground text-sm mb-1">
              {t('itemsWithEstimate')}
            </div>
            <p className="text-2xl font-bold">{itemsWithEstimate}</p>
            <p className="text-xs text-muted-foreground">Σ = {totalStoryPoints} SP</p>
          </div>

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

        {/* SP Breakdown Table */}
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
                    <th className="text-center">{t('avgActiveHoursPerTask')}</th>
                    <th className="text-center">{t('avgHoursPerSp')}</th>
                  </tr>
                </thead>
                <tbody>
                  {fibonacciBreakdown.map((fb) => (
                    <tr key={fb.estimate}>
                      <td>
                        <Badge variant="outline">{fb.estimate}</Badge>
                      </td>
                      <td className="text-center">
                        <button
                          onClick={() => openSpDrillDown(fb.estimate)}
                          className="cursor-pointer hover:underline hover:text-primary transition-colors font-medium"
                          title="Нажмите для просмотра деталей"
                        >
                          {fb.itemCount}
                        </button>
                      </td>
                      <td className="text-center">{formatDuration(fb.totalActiveHours)}</td>
                      <td className="text-center font-medium">
                        {formatDuration(fb.itemCount > 0 ? fb.totalActiveHours / fb.itemCount : 0)}
                      </td>
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

      {/* SP Drill-Down Dialog */}
      <Dialog open={drillDownOpen} onOpenChange={setDrillDownOpen}>
        <DialogContent className={`${fullscreen ? '!fixed !inset-4 !max-w-none !w-auto !max-h-none !translate-x-0 !translate-y-0 !top-0 !left-0 flex flex-col' : 'max-w-[95vw] lg:max-w-6xl max-h-[90vh]'}`}>
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span className="truncate mr-2">
                Story Points: {drillDownSp} SP — {drillDownItems.length} элементов
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline">{drillDownItems.length} элементов</Badge>
                <Button variant="ghost" size="sm" onClick={() => setFullscreen(!fullscreen)} className="h-8 w-8 p-0">
                  {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>

          <ScrollArea className={fullscreen ? "flex-1 overflow-auto" : "max-h-[60vh]"}>
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th className="w-20">ID</th>
                    <th>Название</th>
                    <th className="w-40">Разработчик</th>
                    <th className="w-28 text-center">Время Active</th>
                    <th className="w-16 text-center">SP</th>
                    <th className="w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {drillDownItems.map(item => (
                    <tr key={item.id}>
                      <td className="font-mono text-sm">{item.id}</td>
                      <td className="max-w-xs truncate" title={item.title}>{item.title}</td>
                      <td className="text-sm">{item.assignedTo || '—'}</td>
                      <td className="text-center text-sm">{formatDuration(item.activeTimeHours)}</td>
                      <td className="text-center font-medium">{item.originalEstimate ?? '—'}</td>
                      <td>
                        <Button variant="ghost" size="sm" asChild className="h-8 w-8 p-0">
                          <a href={getWorkItemUrl(item.id)} target="_blank" rel="noopener noreferrer" title="Открыть в Azure DevOps">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ScrollArea>

          <div className="flex justify-end pt-4 border-t">
            <Button variant="outline" onClick={() => setDrillDownOpen(false)}>
              <X className="h-4 w-4 mr-2" />
              {t('close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

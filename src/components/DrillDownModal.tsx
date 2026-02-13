import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ExternalLink, AlertTriangle, History, X, ArrowUpDown, ArrowUp, ArrowDown, Maximize2, Minimize2 } from "lucide-react";
import type { WorkItemReference } from "@/types/metrics";
import { t } from "@/lib/i18n";
import { formatDuration, formatNumber } from "@/lib/formatters";

interface DrillDownModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  items: WorkItemReference[];
  organization: string;
  project: string;
  showTimeColumns?: boolean; // Show Active/DEV/STG time columns
}

type SortField = 'id' | 'title' | 'type' | 'count' | 'activeTimeHours' | 'devTestTimeHours' | 'stgTestTimeHours' | 'originalEstimate';
type SortDirection = 'asc' | 'desc';

export function DrillDownModal({ 
  open, 
  onOpenChange, 
  title, 
  items,
  organization,
  project,
  showTimeColumns = true
}: DrillDownModalProps) {
  const [sortField, setSortField] = useState<SortField>('count');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [fullscreen, setFullscreen] = useState(false);

  const getWorkItemUrl = (id: number) => {
    return `https://dev.azure.com/${organization}/${project}/_workitems/edit/${id}`;
  };

  const getTypeBadgeVariant = (type: string) => {
    switch (type) {
      case 'Requirement':
        return 'default';
      case 'Bug':
        return 'destructive';
      case 'Task':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      let aVal: string | number | undefined;
      let bVal: string | number | undefined;

      switch (sortField) {
        case 'id':
          aVal = a.id;
          bVal = b.id;
          break;
        case 'title':
          aVal = a.title;
          bVal = b.title;
          break;
        case 'type':
          aVal = a.type;
          bVal = b.type;
          break;
        case 'count':
          aVal = a.count;
          bVal = b.count;
          break;
        case 'activeTimeHours':
          aVal = a.activeTimeHours ?? 0;
          bVal = b.activeTimeHours ?? 0;
          break;
        case 'devTestTimeHours':
          aVal = a.devTestTimeHours ?? 0;
          bVal = b.devTestTimeHours ?? 0;
          break;
        case 'stgTestTimeHours':
          aVal = a.stgTestTimeHours ?? 0;
          bVal = b.stgTestTimeHours ?? 0;
          break;
        case 'originalEstimate':
          aVal = a.originalEstimate ?? 0;
          bVal = b.originalEstimate ?? 0;
          break;
        default:
          aVal = a.count;
          bVal = b.count;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      const numA = Number(aVal) || 0;
      const numB = Number(bVal) || 0;
      return sortDirection === 'asc' ? numA - numB : numB - numA;
    });
  }, [items, sortField, sortDirection]);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
    return sortDirection === 'asc'
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const SortableHeader = ({ field, children, className = "" }: { field: SortField; children: React.ReactNode; className?: string }) => (
    <th
      className={`cursor-pointer hover:bg-muted/70 transition-colors ${className}`}
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center">
        {children}
        <SortIcon field={field} />
      </div>
    </th>
  );

  // Check if any items have time or SP data
  const hasTimeData = items.some(item => 
    item.activeTimeHours !== undefined || 
    item.devTestTimeHours !== undefined || 
    item.stgTestTimeHours !== undefined
  );
  const hasSpData = items.some(item => item.originalEstimate !== undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${fullscreen ? '!fixed !inset-4 !max-w-none !w-auto !max-h-none !translate-x-0 !translate-y-0 !top-0 !left-0 flex flex-col' : 'max-w-[95vw] lg:max-w-7xl max-h-[90vh]'}`}>
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="truncate mr-2">{title}</span>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline">
                {items.length} {items.length === 1 ? 'элемент' : 'элементов'}
              </Badge>
              <Button variant="ghost" size="sm" onClick={() => setFullscreen(!fullscreen)} className="h-8 w-8 p-0">
                {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>
        
        <ScrollArea className={fullscreen ? "flex-1 overflow-auto" : "max-h-[60vh]"}>
          {items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Нет данных
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <SortableHeader field="id" className="w-20">{t('workItemId')}</SortableHeader>
                  <SortableHeader field="title">{t('title')}</SortableHeader>
                  <SortableHeader field="type" className="w-28">{t('type')}</SortableHeader>
                  <SortableHeader field="count" className="w-20 text-center">{t('metricCount')}</SortableHeader>
                  {showTimeColumns && hasTimeData && (
                    <>
                      <SortableHeader field="activeTimeHours" className="w-24 text-center">{t('activeTime')}</SortableHeader>
                      <SortableHeader field="devTestTimeHours" className="w-24 text-center">{t('devTestTime')}</SortableHeader>
                      <SortableHeader field="stgTestTimeHours" className="w-24 text-center">{t('stgTestTime')}</SortableHeader>
                    </>
                  )}
                  {hasSpData && (
                    <SortableHeader field="originalEstimate" className="w-16 text-center">{t('originalEstimate')}</SortableHeader>
                  )}
                  <th className="w-24 text-center">{t('assignedToChanged')}</th>
                  <th className="w-12"></th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item) => (
                  <tr key={item.id}>
                    <td className="font-mono text-sm">{item.id}</td>
                    <td className="max-w-xs truncate" title={item.title}>
                      {item.title}
                    </td>
                    <td>
                      <Badge variant={getTypeBadgeVariant(item.type)}>
                        {item.type}
                      </Badge>
                    </td>
                    <td className="text-center font-medium">{item.count}</td>
                    {showTimeColumns && hasTimeData && (
                      <>
                        <td className="text-center text-sm">
                          {item.activeTimeHours !== undefined ? formatDuration(item.activeTimeHours) : '—'}
                        </td>
                        <td className="text-center text-sm">
                          {item.devTestTimeHours !== undefined ? formatDuration(item.devTestTimeHours) : '—'}
                        </td>
                        <td className="text-center text-sm">
                          {item.stgTestTimeHours !== undefined ? formatDuration(item.stgTestTimeHours) : '—'}
                        </td>
                      </>
                    )}
                    {hasSpData && (
                      <td className="text-center text-sm font-medium">
                        {item.originalEstimate !== undefined ? item.originalEstimate : '—'}
                      </td>
                    )}
                    <td className="text-center">
                      {item.assignedToChanged ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center justify-center gap-1 text-warning cursor-help">
                                <AlertTriangle className="h-4 w-4" />
                                <History className="h-4 w-4" />
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="font-medium mb-1">{t('assignedToHistory')}:</p>
                              <ul className="text-sm space-y-0.5">
                                {item.assignedToHistory.map((name, idx) => (
                                  <li key={idx} className="flex items-center gap-1">
                                    <span className="text-muted-foreground">{idx + 1}.</span>
                                    {name}
                                  </li>
                                ))}
                              </ul>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        asChild
                        className="h-8 w-8 p-0"
                      >
                        <a
                          href={getWorkItemUrl(item.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={t('openInAdo')}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </ScrollArea>
        
        <div className="flex justify-between items-center pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            {t('workingTimeInfo')}
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-2" />
            {t('close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useMemo } from "react";
import type { DeveloperMetrics, WorkItemReference } from "@/types/metrics";
import { formatDuration, formatNumber } from "@/lib/formatters";
import { t } from "@/lib/i18n";
import { ArrowUpDown, ArrowUp, ArrowDown, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DrillDownModal } from "./DrillDownModal";

interface DeveloperMetricsTableProps {
  metrics: DeveloperMetrics[];
  organization: string;
  project: string;
}

type SortField = 
  | 'developer'
  | 'avgDevTimeHours'
  | 'itemsCompleted'
  | 'totalReturnCount'
  | 'codeReviewReturns'
  | 'devTestingReturns'
  | 'stgTestingReturns'
  | 'avgTotalReturnsPerTask'
  | 'avgCodeReviewReturnsPerTask'
  | 'avgDevTestingReturnsPerTask'
  | 'avgStgTestingReturnsPerTask';

type SortDirection = 'asc' | 'desc';

export function DeveloperMetricsTable({ metrics, organization, project }: DeveloperMetricsTableProps) {
  const [sortField, setSortField] = useState<SortField>('itemsCompleted');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedDevelopers, setSelectedDevelopers] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  
  // Drill-down modal state
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [drillDownTitle, setDrillDownTitle] = useState("");
  const [drillDownItems, setDrillDownItems] = useState<WorkItemReference[]>([]);

  const allDevelopers = useMemo(() => 
    metrics.map(m => m.developer).sort((a, b) => a.localeCompare(b)),
    [metrics]
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const toggleDeveloper = (developer: string) => {
    setSelectedDevelopers(prev => {
      const next = new Set(prev);
      if (next.has(developer)) {
        next.delete(developer);
      } else {
        next.add(developer);
      }
      return next;
    });
  };

  const clearFilters = () => {
    setSelectedDevelopers(new Set());
  };

  const openDrillDown = (title: string, items: WorkItemReference[]) => {
    setDrillDownTitle(title);
    setDrillDownItems(items);
    setDrillDownOpen(true);
  };

  const filteredAndSortedMetrics = useMemo(() => {
    let result = [...metrics];
    
    if (selectedDevelopers.size > 0) {
      result = result.filter(m => selectedDevelopers.has(m.developer));
    }
    
    result.sort((a, b) => {
      let aVal: string | number = a[sortField];
      let bVal: string | number = b[sortField];
      
      if (typeof aVal === 'string') {
        return sortDirection === 'asc' 
          ? aVal.localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal);
      }
      
      return sortDirection === 'asc' ? aVal - (bVal as number) : (bVal as number) - aVal;
    });
    
    return result;
  }, [metrics, sortField, sortDirection, selectedDevelopers]);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const SortableHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <th 
      className="cursor-pointer hover:bg-muted/70 transition-colors"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center">
        {children}
        <SortIcon field={field} />
      </div>
    </th>
  );

  // Clickable metric cell
  const ClickableCell = ({ 
    value, 
    items, 
    title, 
    className = "" 
  }: { 
    value: number; 
    items: WorkItemReference[]; 
    title: string;
    className?: string;
  }) => {
    if (items.length === 0) {
      return <span className={className}>{value}</span>;
    }
    return (
      <button
        onClick={() => openDrillDown(title, items)}
        className={`cursor-pointer hover:underline hover:text-primary transition-colors ${className}`}
        title={t('clickToViewDetails')}
      >
        {value}
      </button>
    );
  };

  if (metrics.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        {t('noDeveloperMetrics')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter controls */}
      <div className="flex items-center gap-2">
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="h-4 w-4" />
              {t('filterDevelopers')}
              {selectedDevelopers.size > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded-full">
                  {selectedDevelopers.size}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <div className="p-3 border-b">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t('selectDevelopers')}</span>
                {selectedDevelopers.size > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="h-6 px-2 text-xs">
                    {t('clearAll')}
                  </Button>
                )}
              </div>
            </div>
            <ScrollArea className="h-[200px]">
              <div className="p-2 space-y-1">
                {allDevelopers.map(developer => (
                  <label
                    key={developer}
                    className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedDevelopers.has(developer)}
                      onCheckedChange={() => toggleDeveloper(developer)}
                    />
                    <span className="text-sm truncate">{developer}</span>
                  </label>
                ))}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
        
        {selectedDevelopers.size > 0 && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
            <X className="h-3 w-3" />
            {t('clearFilters')}
          </Button>
        )}
      </div>

      <div className="overflow-x-auto animate-fade-in">
        <table className="data-table">
          <thead>
            <tr>
              <SortableHeader field="developer">{t('developer')}</SortableHeader>
              <SortableHeader field="avgDevTimeHours">{t('avgDevTimeActive')}</SortableHeader>
              <SortableHeader field="itemsCompleted">{t('itemsCompleted')}</SortableHeader>
              <SortableHeader field="totalReturnCount">{t('totalReturnsShort')}</SortableHeader>
              <SortableHeader field="avgTotalReturnsPerTask">{t('avgReturnsPerTask')}</SortableHeader>
              <SortableHeader field="codeReviewReturns">{t('codeReviewFix')}</SortableHeader>
              <SortableHeader field="avgCodeReviewReturnsPerTask">{t('avgCrFixPerTask')}</SortableHeader>
              <SortableHeader field="devTestingReturns">{t('devTestFix')}</SortableHeader>
              <SortableHeader field="avgDevTestingReturnsPerTask">{t('avgDevFixPerTask')}</SortableHeader>
              <SortableHeader field="stgTestingReturns">{t('stgTestFix')}</SortableHeader>
              <SortableHeader field="avgStgTestingReturnsPerTask">{t('avgStgFixPerTask')}</SortableHeader>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedMetrics.map((metric, index) => (
              <tr key={metric.developer} style={{ animationDelay: `${index * 50}ms` }}>
                <td className="font-medium">{metric.developer}</td>
                <td>{formatDuration(metric.avgDevTimeHours)}</td>
                <td>
                  <ClickableCell
                    value={metric.itemsCompleted}
                    items={metric.workItems}
                    title={`${metric.developer} - ${t('itemsCompleted')}`}
                  />
                </td>
                <td>
                  <ClickableCell
                    value={metric.totalReturnCount}
                    items={metric.returnItems}
                    title={`${metric.developer} - ${t('totalReturnsShort')}`}
                    className={metric.totalReturnCount > 0 ? "text-warning font-medium" : ""}
                  />
                </td>
                <td>{formatNumber(metric.avgTotalReturnsPerTask, 2)}</td>
                <td>
                  <ClickableCell
                    value={metric.codeReviewReturns}
                    items={metric.codeReviewReturnItems}
                    title={`${metric.developer} - ${t('codeReviewFix')}`}
                  />
                </td>
                <td>{formatNumber(metric.avgCodeReviewReturnsPerTask, 2)}</td>
                <td>
                  <ClickableCell
                    value={metric.devTestingReturns}
                    items={metric.devTestingReturnItems}
                    title={`${metric.developer} - ${t('devTestFix')}`}
                    className="badge-dev"
                  />
                </td>
                <td>{formatNumber(metric.avgDevTestingReturnsPerTask, 2)}</td>
                <td>
                  <ClickableCell
                    value={metric.stgTestingReturns}
                    items={metric.stgTestingReturnItems}
                    title={`${metric.developer} - ${t('stgTestFix')}`}
                    className="badge-stg"
                  />
                </td>
                <td>{formatNumber(metric.avgStgTestingReturnsPerTask, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DrillDownModal
        open={drillDownOpen}
        onOpenChange={setDrillDownOpen}
        title={drillDownTitle}
        items={drillDownItems}
        organization={organization}
        project={project}
      />
    </div>
  );
}

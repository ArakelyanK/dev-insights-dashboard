import { useState, useMemo } from "react";
import type { TesterMetrics, WorkItemReference, PRReference } from "@/types/metrics";
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
import { ClickableMetric } from "./ClickableMetric";
import { DrillDownModal } from "./DrillDownModal";
import { PRDrillDownModal } from "./PRDrillDownModal";

interface TesterMetricsTableProps {
  metrics: TesterMetrics[];
  organization: string;
  project: string;
}

type SortField = 
  | 'tester'
  | 'closedItemsCount'
  | 'avgDevTestTimeHours'
  | 'avgStgTestTimeHours'
  | 'devTestingIterations'
  | 'stgTestingIterations'
  | 'avgDevIterationsPerTask'
  | 'avgStgIterationsPerTask'
  | 'prCommentsCount'
  | 'avgPrCommentsPerPr';

type SortDirection = 'asc' | 'desc';

interface DrillDownState {
  open: boolean;
  title: string;
  items: WorkItemReference[];
}

interface PRDrillDownState {
  open: boolean;
  title: string;
  prDetails: PRReference[];
}

export function TesterMetricsTable({ metrics, organization, project }: TesterMetricsTableProps) {
  const [sortField, setSortField] = useState<SortField>('closedItemsCount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedTesters, setSelectedTesters] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [drillDown, setDrillDown] = useState<DrillDownState>({ open: false, title: '', items: [] });
  const [prDrillDown, setPrDrillDown] = useState<PRDrillDownState>({ open: false, title: '', prDetails: [] });

  const allTesters = useMemo(() => 
    metrics.map(m => m.tester).sort((a, b) => a.localeCompare(b)),
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

  const toggleTester = (tester: string) => {
    setSelectedTesters(prev => {
      const next = new Set(prev);
      if (next.has(tester)) {
        next.delete(tester);
      } else {
        next.add(tester);
      }
      return next;
    });
  };

  const clearFilters = () => {
    setSelectedTesters(new Set());
  };

  const filteredAndSortedMetrics = useMemo(() => {
    let result = [...metrics];
    
    // Apply filter
    if (selectedTesters.size > 0) {
      result = result.filter(m => selectedTesters.has(m.tester));
    }
    
    // Apply sort
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
  }, [metrics, sortField, sortDirection, selectedTesters]);

  const openDrillDown = (title: string, items: WorkItemReference[]) => {
    setDrillDown({ open: true, title, items });
  };

  const openPrDrillDown = (title: string, prDetails: PRReference[]) => {
    setPrDrillDown({ open: true, title, prDetails });
  };

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

  if (metrics.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        {t('noTesterMetrics')}
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
              {t('filterTesters')}
              {selectedTesters.size > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded-full">
                  {selectedTesters.size}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <div className="p-3 border-b">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t('selectTesters')}</span>
                {selectedTesters.size > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="h-6 px-2 text-xs">
                    {t('clearAll')}
                  </Button>
                )}
              </div>
            </div>
            <ScrollArea className="h-[200px]">
              <div className="p-2 space-y-1">
                {allTesters.map(tester => (
                  <label
                    key={tester}
                    className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedTesters.has(tester)}
                      onCheckedChange={() => toggleTester(tester)}
                    />
                    <span className="text-sm truncate">{tester}</span>
                  </label>
                ))}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
        
        {selectedTesters.size > 0 && (
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
              <SortableHeader field="tester">{t('tester')}</SortableHeader>
              <SortableHeader field="closedItemsCount">{t('closedItems')}</SortableHeader>
              <SortableHeader field="avgDevTestTimeHours">{t('avgDevTestTimeShort')}</SortableHeader>
              <SortableHeader field="avgStgTestTimeHours">{t('avgStgTestTimeShort')}</SortableHeader>
              <SortableHeader field="devTestingIterations">{t('devIterations')}</SortableHeader>
              <SortableHeader field="avgDevIterationsPerTask">{t('avgDevIterPerTask')}</SortableHeader>
              <SortableHeader field="stgTestingIterations">{t('stgIterations')}</SortableHeader>
              <SortableHeader field="avgStgIterationsPerTask">{t('avgStgIterPerTask')}</SortableHeader>
              <SortableHeader field="prCommentsCount">{t('prCommentsShort')}</SortableHeader>
              <SortableHeader field="avgPrCommentsPerPr">{t('avgCommentsPerPr')}</SortableHeader>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedMetrics.map((metric, index) => (
              <tr key={metric.tester} style={{ animationDelay: `${index * 50}ms` }}>
                <td className="font-medium">{metric.tester}</td>
                <td>
                  <ClickableMetric
                    value={<span className="badge-success">{metric.closedItemsCount}</span>}
                    onClick={metric.closedItems?.length > 0 ? () => openDrillDown(
                      `${metric.tester}: ${t('closedItems')}`,
                      metric.closedItems
                    ) : undefined}
                  />
                </td>
                <td>{formatDuration(metric.avgDevTestTimeHours)}</td>
                <td>{formatDuration(metric.avgStgTestTimeHours)}</td>
                <td>
                  <ClickableMetric
                    value={<span className="badge-dev">{metric.devTestingIterations}</span>}
                    onClick={metric.devIterationItems?.length > 0 ? () => openDrillDown(
                      `${metric.tester}: ${t('devIterations')}`,
                      metric.devIterationItems
                    ) : undefined}
                  />
                </td>
                <td>{formatNumber(metric.avgDevIterationsPerTask, 2)}</td>
                <td>
                  <ClickableMetric
                    value={<span className="badge-stg">{metric.stgTestingIterations}</span>}
                    onClick={metric.stgIterationItems?.length > 0 ? () => openDrillDown(
                      `${metric.tester}: ${t('stgIterations')}`,
                      metric.stgIterationItems
                    ) : undefined}
                  />
                </td>
                <td>{formatNumber(metric.avgStgIterationsPerTask, 2)}</td>
                <td>
                  <ClickableMetric
                    value={metric.prCommentsCount}
                    onClick={metric.prCommentDetails?.length > 0 ? () => openPrDrillDown(
                      `${metric.tester}: ${t('prCommentsShort')}`,
                      metric.prCommentDetails
                    ) : undefined}
                  />
                </td>
                <td>{formatNumber(metric.avgPrCommentsPerPr, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DrillDownModal
        open={drillDown.open}
        onOpenChange={(open) => setDrillDown(prev => ({ ...prev, open }))}
        title={drillDown.title}
        items={drillDown.items}
        organization={organization}
        project={project}
      />

      <PRDrillDownModal
        open={prDrillDown.open}
        onOpenChange={(open) => setPrDrillDown(prev => ({ ...prev, open }))}
        title={prDrillDown.title}
        prDetails={prDrillDown.prDetails}
        organization={organization}
        project={project}
      />
    </div>
  );
}

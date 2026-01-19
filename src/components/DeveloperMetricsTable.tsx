import { useState, useMemo } from "react";
import type { DeveloperMetrics } from "@/types/metrics";
import { formatDuration, formatNumber } from "@/lib/formatters";
import { ArrowUpDown, ArrowUp, ArrowDown, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DeveloperMetricsTableProps {
  metrics: DeveloperMetrics[];
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

export function DeveloperMetricsTable({ metrics }: DeveloperMetricsTableProps) {
  const [sortField, setSortField] = useState<SortField>('itemsCompleted');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedDevelopers, setSelectedDevelopers] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);

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

  const filteredAndSortedMetrics = useMemo(() => {
    let result = [...metrics];
    
    // Apply filter
    if (selectedDevelopers.size > 0) {
      result = result.filter(m => selectedDevelopers.has(m.developer));
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

  if (metrics.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No developer metrics available
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
              Filter Developers
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
                <span className="text-sm font-medium">Select Developers</span>
                {selectedDevelopers.size > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="h-6 px-2 text-xs">
                    Clear all
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
            Clear filters
          </Button>
        )}
      </div>

      <div className="overflow-x-auto animate-fade-in">
        <table className="data-table">
          <thead>
            <tr>
              <SortableHeader field="developer">Developer</SortableHeader>
              <SortableHeader field="avgDevTimeHours">Avg Dev Time (Active)</SortableHeader>
              <SortableHeader field="itemsCompleted">Items Completed</SortableHeader>
              <SortableHeader field="totalReturnCount">Total Returns</SortableHeader>
              <SortableHeader field="avgTotalReturnsPerTask">Avg Returns/Task</SortableHeader>
              <SortableHeader field="codeReviewReturns">Code Review → Fix</SortableHeader>
              <SortableHeader field="avgCodeReviewReturnsPerTask">Avg CR Fix/Task</SortableHeader>
              <SortableHeader field="devTestingReturns">DEV Test → Fix</SortableHeader>
              <SortableHeader field="avgDevTestingReturnsPerTask">Avg DEV Fix/Task</SortableHeader>
              <SortableHeader field="stgTestingReturns">STG Test → Fix</SortableHeader>
              <SortableHeader field="avgStgTestingReturnsPerTask">Avg STG Fix/Task</SortableHeader>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedMetrics.map((metric, index) => (
              <tr key={metric.developer} style={{ animationDelay: `${index * 50}ms` }}>
                <td className="font-medium">{metric.developer}</td>
                <td>{formatDuration(metric.avgDevTimeHours)}</td>
                <td>{metric.itemsCompleted}</td>
                <td>
                  <span className={metric.totalReturnCount > 0 ? "text-warning font-medium" : ""}>
                    {metric.totalReturnCount}
                  </span>
                </td>
                <td>{formatNumber(metric.avgTotalReturnsPerTask, 2)}</td>
                <td>{metric.codeReviewReturns}</td>
                <td>{formatNumber(metric.avgCodeReviewReturnsPerTask, 2)}</td>
                <td>
                  <span className="badge-dev">{metric.devTestingReturns}</span>
                </td>
                <td>{formatNumber(metric.avgDevTestingReturnsPerTask, 2)}</td>
                <td>
                  <span className="badge-stg">{metric.stgTestingReturns}</span>
                </td>
                <td>{formatNumber(metric.avgStgTestingReturnsPerTask, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

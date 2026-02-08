import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Filter, X, Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import type { AnalysisFilters, WorkItemRaw, StateTransitionRaw } from "@/types/metrics";
import { t } from "@/lib/i18n";
import { STATES, WORK_ITEM_TYPES } from "@/types/metrics";

interface AnalysisFiltersProps {
  filters: AnalysisFilters;
  onFiltersChange: (filters: AnalysisFilters) => void;
  availableStates: string[];
}

const ALL_STATES = Object.values(STATES);

export function AnalysisFiltersPanel({ 
  filters, 
  onFiltersChange,
  availableStates,
}: AnalysisFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleType = (type: string) => {
    const newTypes = new Set(filters.workItemTypes);
    if (newTypes.has(type)) {
      newTypes.delete(type);
    } else {
      newTypes.add(type);
    }
    onFiltersChange({ ...filters, workItemTypes: newTypes });
  };

  const setStateFilter = (state: string | undefined) => {
    if (!state || state === 'none') {
      onFiltersChange({ 
        ...filters, 
        stateTransition: undefined 
      });
    } else {
      onFiltersChange({
        ...filters,
        stateTransition: {
          state,
          fromDate: filters.stateTransition?.fromDate ?? null,
          toDate: filters.stateTransition?.toDate ?? null,
        },
      });
    }
  };

  const setFromDate = (date: Date | undefined) => {
    if (filters.stateTransition) {
      onFiltersChange({
        ...filters,
        stateTransition: {
          ...filters.stateTransition,
          fromDate: date ?? null,
        },
      });
    }
  };

  const setToDate = (date: Date | undefined) => {
    if (filters.stateTransition) {
      onFiltersChange({
        ...filters,
        stateTransition: {
          ...filters.stateTransition,
          toDate: date ?? null,
        },
      });
    }
  };

  const resetFilters = () => {
    onFiltersChange({
      workItemTypes: new Set(['Requirement', 'Bug', 'Task']),
      stateTransition: undefined,
    });
  };

  const hasActiveFilters = 
    filters.workItemTypes.size < 3 ||
    filters.stateTransition !== undefined;

  const activeFilterCount = 
    (filters.workItemTypes.size < 3 ? 1 : 0) +
    (filters.stateTransition ? 1 : 0);

  return (
    <div className="flex items-center gap-2">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Filter className="h-4 w-4" />
            {t('filters')}
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0.5 text-xs">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="start">
          <div className="space-y-4">
            {/* Work Item Types */}
            <div>
              <Label className="text-sm font-medium">{t('filterByType')}</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {Object.values(WORK_ITEM_TYPES).map(type => (
                  <label key={type} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={filters.workItemTypes.has(type)}
                      onCheckedChange={() => toggleType(type)}
                    />
                    <span className="text-sm">{type}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* State Transition Filter */}
            <div>
              <Label className="text-sm font-medium">{t('filterByState')}</Label>
              <Select
                value={filters.stateTransition?.state || 'none'}
                onValueChange={setStateFilter}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder={t('stateFilter')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {availableStates.map(state => (
                    <SelectItem key={state} value={state}>{state}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Range (only if state is selected) */}
            {filters.stateTransition && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-sm">{t('fromDate')}</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="w-full justify-start mt-1">
                        <CalendarIcon className="h-4 w-4 mr-2" />
                        {filters.stateTransition.fromDate 
                          ? format(filters.stateTransition.fromDate, 'dd.MM.yyyy', { locale: ru })
                          : '—'
                        }
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={filters.stateTransition.fromDate ?? undefined}
                        onSelect={setFromDate}
                        locale={ru}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <Label className="text-sm">{t('toDate')}</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="w-full justify-start mt-1">
                        <CalendarIcon className="h-4 w-4 mr-2" />
                        {filters.stateTransition.toDate 
                          ? format(filters.stateTransition.toDate, 'dd.MM.yyyy', { locale: ru })
                          : '—'
                        }
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={filters.stateTransition.toDate ?? undefined}
                        onSelect={setToDate}
                        locale={ru}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            )}

            {/* Reset Button */}
            {hasActiveFilters && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={resetFilters}
                className="w-full"
              >
                <X className="h-4 w-4 mr-2" />
                {t('resetFilters')}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Active Filters Display */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2">
          {filters.workItemTypes.size < 3 && (
            <Badge variant="secondary" className="text-xs">
              {Array.from(filters.workItemTypes).join(', ')}
            </Badge>
          )}
          {filters.stateTransition && (
            <Badge variant="secondary" className="text-xs">
              → {filters.stateTransition.state}
              {filters.stateTransition.fromDate && (
                <> с {format(filters.stateTransition.fromDate, 'dd.MM', { locale: ru })}</>
              )}
              {filters.stateTransition.toDate && (
                <> по {format(filters.stateTransition.toDate, 'dd.MM', { locale: ru })}</>
              )}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Apply filters to work items for client-side filtering
 */
export function applyFilters(
  workItems: WorkItemRaw[],
  filters: AnalysisFilters
): WorkItemRaw[] {
  let result = workItems;

  // Filter by work item type
  if (filters.workItemTypes.size < 3) {
    result = result.filter(wi => filters.workItemTypes.has(wi.type));
  }

  // Filter by state transition
  if (filters.stateTransition) {
    const { state, fromDate, toDate } = filters.stateTransition;
    result = result.filter(wi => {
      return wi.stateTransitions.some(tr => {
        if (tr.toState !== state) return false;
        
        const transitionDate = new Date(tr.timestamp);
        if (fromDate && transitionDate < fromDate) return false;
        if (toDate && transitionDate > toDate) return false;
        
        return true;
      });
    });
  }

  return result;
}

/**
 * Extract unique states from work items for filter options
 */
export function extractAvailableStates(workItems: WorkItemRaw[]): string[] {
  const states = new Set<string>();
  workItems.forEach(wi => {
    wi.stateTransitions.forEach(tr => {
      states.add(tr.toState);
    });
  });
  return Array.from(states).sort();
}

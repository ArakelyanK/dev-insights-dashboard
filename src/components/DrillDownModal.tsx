import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ExternalLink, AlertTriangle, History, X } from "lucide-react";
import type { WorkItemReference } from "@/types/metrics";
import { t } from "@/lib/i18n";

interface DrillDownModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  items: WorkItemReference[];
  organization: string;
  project: string;
}

export function DrillDownModal({ 
  open, 
  onOpenChange, 
  title, 
  items,
  organization,
  project
}: DrillDownModalProps) {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{title}</span>
            <Badge variant="outline" className="ml-2">
              {items.length} {items.length === 1 ? 'элемент' : 'элементов'}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="max-h-[60vh]">
          {items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Нет данных
            </div>
          ) : (
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th className="w-20">{t('workItemId')}</th>
                  <th>{t('title')}</th>
                  <th className="w-28">{t('type')}</th>
                  <th className="w-24 text-center">{t('metricCount')}</th>
                  <th className="w-24 text-center">{t('assignedToChanged')}</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
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
          )}
        </ScrollArea>
        
        <div className="flex justify-end pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-2" />
            {t('close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

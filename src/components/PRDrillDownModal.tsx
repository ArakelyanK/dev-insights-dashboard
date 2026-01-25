import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, X, GitPullRequest } from "lucide-react";
import type { PRReference } from "@/types/metrics";
import { t } from "@/lib/i18n";

interface PRDrillDownModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  prDetails: PRReference[];
  organization: string;
  project: string;
}

export function PRDrillDownModal({ 
  open, 
  onOpenChange, 
  title, 
  prDetails,
  organization,
  project
}: PRDrillDownModalProps) {
  const getWorkItemUrl = (id: number) => {
    return `https://dev.azure.com/${organization}/${project}/_workitems/edit/${id}`;
  };

  // Group PRs by work item
  const groupedByWorkItem = prDetails.reduce((acc, pr) => {
    const key = pr.workItemId;
    if (!acc[key]) {
      acc[key] = {
        workItemId: pr.workItemId,
        workItemTitle: pr.workItemTitle,
        prs: [],
      };
    }
    acc[key].prs.push(pr);
    return acc;
  }, {} as Record<number, { workItemId: number; workItemTitle: string; prs: PRReference[] }>);

  const totalComments = prDetails.reduce((sum, pr) => sum + pr.commentsCount, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <GitPullRequest className="h-5 w-5" />
              {title}
            </span>
            <Badge variant="outline" className="ml-2">
              {prDetails.length} PR · {totalComments} {t('commentsCount').toLowerCase()}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="max-h-[60vh]">
          {prDetails.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Нет данных
            </div>
          ) : (
            <div className="space-y-4">
              {Object.values(groupedByWorkItem).map(({ workItemId, workItemTitle, prs }) => (
                <div key={workItemId} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-muted-foreground">#{workItemId}</span>
                      <span className="font-medium truncate max-w-md" title={workItemTitle}>
                        {workItemTitle}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                      className="h-8"
                    >
                      <a
                        href={getWorkItemUrl(workItemId)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        {t('openInAdo')}
                      </a>
                    </Button>
                  </div>
                  
                  <table className="data-table w-full">
                    <thead>
                      <tr>
                        <th className="w-32">{t('prId')}</th>
                        <th className="w-32 text-center">{t('commentsCount')}</th>
                        <th className="w-16"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {prs.map((pr) => (
                        <tr key={pr.prId}>
                          <td className="font-mono text-sm">PR #{pr.prId}</td>
                          <td className="text-center">
                            <Badge variant="secondary">{pr.commentsCount}</Badge>
                          </td>
                          <td>
                            <Button
                              variant="ghost"
                              size="sm"
                              asChild
                              className="h-8 w-8 p-0"
                            >
                              <a
                                href={pr.prUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={t('openPr')}
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
              ))}
            </div>
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

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, BarChart3 } from "lucide-react";
import { extractQueryId } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { AnalysisRequest } from "@/types/metrics";

const DEFAULT_ORGANIZATION = "melston";
const PROJECTS = ["HubEx", "MyQRcards"];

interface AnalysisFormProps {
  onSubmit: (request: AnalysisRequest) => void;
  isLoading: boolean;
  initialValues?: Partial<AnalysisRequest>;
}

export function AnalysisForm({ onSubmit, isLoading, initialValues }: AnalysisFormProps) {
  const [project, setProject] = useState(initialValues?.project || PROJECTS[0]);
  const [queryUrl, setQueryUrl] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialValues?.project) setProject(initialValues.project);
  }, [initialValues]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!project) {
      newErrors.project = t('projectRequired');
    }
    if (!queryUrl.trim()) {
      newErrors.queryUrl = t('queryRequired');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const queryId = extractQueryId(queryUrl);

    onSubmit({
      organization: DEFAULT_ORGANIZATION,
      project,
      queryId,
      pat: "", // PAT is stored as a server-side secret
    });
  };

  return (
    <Card className="w-full max-w-2xl mx-auto animate-fade-in">
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          <CardTitle className="text-2xl">{t('azureDevOpsAnalytics')}</CardTitle>
        </div>
        <CardDescription>
          {t('analyzeDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('organization')}</Label>
              <Input
                value={DEFAULT_ORGANIZATION}
                disabled
                className="bg-muted"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project">{t('project')}</Label>
              <Select value={project} onValueChange={setProject} disabled={isLoading}>
                <SelectTrigger id="project" className={errors.project ? "border-destructive" : ""}>
                  <SelectValue placeholder="Выберите проект" />
                </SelectTrigger>
                <SelectContent>
                  {PROJECTS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.project && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.project}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="queryUrl">{t('queryUrlOrId')}</Label>
            <Input
              id="queryUrl"
              placeholder={t('queryPlaceholder')}
              value={queryUrl}
              onChange={(e) => setQueryUrl(e.target.value)}
              disabled={isLoading}
              className={errors.queryUrl ? "border-destructive" : ""}
            />
            {errors.queryUrl && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.queryUrl}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {t('queryHint')}
            </p>
          </div>

          <Button 
            type="submit" 
            className="w-full" 
            size="lg"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="animate-pulse-soft">{t('analyzing')}</span>
            ) : (
              <>
                <BarChart3 className="mr-2 h-4 w-4" />
                {t('analyzeMetrics')}
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

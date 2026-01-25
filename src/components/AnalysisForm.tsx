import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, BarChart3, Lock, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { extractQueryId } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { AnalysisRequest } from "@/types/metrics";

interface AnalysisFormProps {
  onSubmit: (request: AnalysisRequest) => void;
  isLoading: boolean;
  initialValues?: Partial<AnalysisRequest>;
}

export function AnalysisForm({ onSubmit, isLoading, initialValues }: AnalysisFormProps) {
  const [organization, setOrganization] = useState(initialValues?.organization || "");
  const [project, setProject] = useState(initialValues?.project || "");
  const [queryUrl, setQueryUrl] = useState("");
  const [pat, setPat] = useState(initialValues?.pat || "");
  const [showPat, setShowPat] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  // Track if PAT was previously entered
  const [patSaved, setPatSaved] = useState(!!initialValues?.pat);

  // Update fields when initialValues change (coming back from results)
  useEffect(() => {
    if (initialValues?.organization) setOrganization(initialValues.organization);
    if (initialValues?.project) setProject(initialValues.project);
    if (initialValues?.pat) {
      setPat(initialValues.pat);
      setPatSaved(true);
    }
  }, [initialValues]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!organization.trim()) {
      newErrors.organization = t('organizationRequired');
    }
    if (!project.trim()) {
      newErrors.project = t('projectRequired');
    }
    if (!queryUrl.trim()) {
      newErrors.queryUrl = t('queryRequired');
    }
    if (!pat.trim()) {
      newErrors.pat = t('patRequired');
    } else if (pat.length < 20) {
      newErrors.pat = t('patInvalid');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validate()) return;

    const queryId = extractQueryId(queryUrl);
    setPatSaved(true);

    onSubmit({
      organization: organization.trim(),
      project: project.trim(),
      queryId,
      pat: pat.trim(),
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
              <Label htmlFor="organization">{t('organization')}</Label>
              <Input
                id="organization"
                placeholder="your-org"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                disabled={isLoading}
                className={errors.organization ? "border-destructive" : ""}
              />
              {errors.organization && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.organization}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="project">{t('project')}</Label>
              <Input
                id="project"
                placeholder="MyProject"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                disabled={isLoading}
                className={errors.project ? "border-destructive" : ""}
              />
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

          <div className="space-y-2">
            <Label htmlFor="pat" className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5" />
              {t('pat')}
              {patSaved && pat && (
                <span className="flex items-center gap-1 text-xs text-success">
                  <CheckCircle2 className="h-3 w-3" />
                  Сохранён для сессии
                </span>
              )}
            </Label>
            <div className="relative">
              <Input
                id="pat"
                type={showPat ? "text" : "password"}
                placeholder={patSaved && pat ? "••••••••••••••••••••••••" : t('enterPat')}
                value={pat}
                onChange={(e) => {
                  setPat(e.target.value);
                  setPatSaved(false);
                }}
                disabled={isLoading}
                className={`pr-10 input-secure ${errors.pat ? "border-destructive" : ""}`}
              />
              <button
                type="button"
                onClick={() => setShowPat(!showPat)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPat ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.pat && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.pat}
              </p>
            )}
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" />
              {t('patSecurityNote')}
            </p>
          </div>

          <Button 
            type="submit" 
            className="w-full" 
            size="lg"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="animate-pulse-soft">{t('analyzing')}</span>
              </>
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

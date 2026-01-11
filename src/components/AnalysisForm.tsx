import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, BarChart3, Lock, Eye, EyeOff } from "lucide-react";
import { extractQueryId } from "@/lib/api";
import type { AnalysisRequest } from "@/types/metrics";

interface AnalysisFormProps {
  onSubmit: (request: AnalysisRequest) => void;
  isLoading: boolean;
}

export function AnalysisForm({ onSubmit, isLoading }: AnalysisFormProps) {
  const [organization, setOrganization] = useState("");
  const [project, setProject] = useState("");
  const [queryUrl, setQueryUrl] = useState("");
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!organization.trim()) {
      newErrors.organization = "Organization is required";
    }
    if (!project.trim()) {
      newErrors.project = "Project is required";
    }
    if (!queryUrl.trim()) {
      newErrors.queryUrl = "Query URL or ID is required";
    }
    if (!pat.trim()) {
      newErrors.pat = "Personal Access Token is required";
    } else if (pat.length < 20) {
      newErrors.pat = "PAT appears to be invalid (too short)";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validate()) return;

    const queryId = extractQueryId(queryUrl);

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
          <CardTitle className="text-2xl">Azure DevOps Analytics</CardTitle>
        </div>
        <CardDescription>
          Analyze development and testing performance metrics from your Azure DevOps work items.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="organization">Organization</Label>
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
              <Label htmlFor="project">Project</Label>
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
            <Label htmlFor="queryUrl">Query URL or Query ID</Label>
            <Input
              id="queryUrl"
              placeholder="https://dev.azure.com/org/project/_queries/query/... or query GUID"
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
              Enter the full URL of your saved query or just the query ID (GUID)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pat" className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5" />
              Personal Access Token (PAT)
            </Label>
            <div className="relative">
              <Input
                id="pat"
                type={showPat ? "text" : "password"}
                placeholder="Enter your Azure DevOps PAT"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
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
              Your PAT is used only for this request and is never stored.
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
                <span className="animate-pulse-soft">Analyzing...</span>
              </>
            ) : (
              <>
                <BarChart3 className="mr-2 h-4 w-4" />
                Analyze Metrics
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

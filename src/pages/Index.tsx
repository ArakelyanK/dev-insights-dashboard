import { useState } from "react";
import { AnalysisForm } from "@/components/AnalysisForm";
import { AnalysisResults } from "@/components/AnalysisResults";
import { analyzeMetrics } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { AnalysisRequest, AnalysisResult } from "@/types/metrics";
import { t } from "@/lib/i18n";
import { AlertCircle, Shield } from "lucide-react";

const Index = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<Partial<AnalysisRequest>>({});
  const { toast } = useToast();

  const handleSubmit = async (request: AnalysisRequest) => {
    setIsLoading(true);
    setError(null);
    setLastRequest(request);

    try {
      const analysisResult = await analyzeMetrics(request);
      setResult(analysisResult);
      toast({
        title: t('analysisComplete'),
        description: t('analysisSuccessful', { count: analysisResult.summary.totalWorkItems }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to analyze metrics";
      setError(message);
      toast({
        title: t('analysisFailed'),
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setResult(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="gradient-azure p-2 rounded-lg">
                <svg
                  className="h-6 w-6 text-primary-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="font-semibold text-foreground">Azure DevOps Аналитика</h1>
                <p className="text-xs text-muted-foreground">{t('developmentTestingMetrics')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5" />
              <span>{t('secureAnalysis')}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8">
        {result ? (
          <AnalysisResults 
            result={result} 
            onBack={handleBack}
            organization={lastRequest.organization || ''}
            project={lastRequest.project || ''}
          />
        ) : (
          <div className="space-y-8">
            <AnalysisForm 
              onSubmit={handleSubmit} 
              isLoading={isLoading}
              initialValues={lastRequest}
            />

            {error && (
              <div className="max-w-2xl mx-auto p-4 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-3 animate-fade-in">
                <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-destructive">{t('analysisError')}</p>
                  <p className="text-sm text-destructive/80 mt-1">{error}</p>
                </div>
              </div>
            )}

            {/* Security Info */}
            <div className="max-w-2xl mx-auto">
              <div className="p-4 rounded-lg bg-accent/50 border border-border">
                <h3 className="font-medium text-foreground flex items-center gap-2 mb-2">
                  <Shield className="h-4 w-4 text-primary" />
                  {t('securityPrivacy')}
                </h3>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• {t('securityNote1')}</li>
                  <li>• {t('securityNote2')}</li>
                  <li>• {t('securityNote3')}</li>
                  <li>• {t('securityNote4')}</li>
                </ul>
              </div>
            </div>

            {/* Metrics Info */}
            <div className="max-w-2xl mx-auto">
              <div className="p-4 rounded-lg border border-border bg-card">
                <h3 className="font-medium text-foreground mb-3">{t('metricsCalculated')}</h3>
                <div className="grid gap-4 md:grid-cols-2 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{t('developerMetricsInfo')}</p>
                    <ul className="text-muted-foreground mt-1 space-y-0.5">
                      <li>• {t('developmentSpeed')}</li>
                      <li>• {t('returnCount')}</li>
                      <li>• {t('returnsBySource')}</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{t('testerMetricsInfo')}</p>
                    <ul className="text-muted-foreground mt-1 space-y-0.5">
                      <li>• {t('closedItemsCountInfo')}</li>
                      <li>• {t('testingSpeed')}</li>
                      <li>• {t('testingIterations')}</li>
                      <li>• {t('prCommentsAuthored')}</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-auto">
        <div className="container py-4 text-center text-xs text-muted-foreground">
          {t('footerNote')}
        </div>
      </footer>
    </div>
  );
};

export default Index;

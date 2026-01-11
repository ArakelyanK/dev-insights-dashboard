import { supabase } from "@/integrations/supabase/client";
import type { AnalysisRequest, AnalysisResult } from "@/types/metrics";

/**
 * Calls the backend edge function to analyze Azure DevOps metrics.
 * PAT is sent securely and never stored.
 */
export async function analyzeMetrics(request: AnalysisRequest): Promise<AnalysisResult> {
  const { data, error } = await supabase.functions.invoke('analyze-devops', {
    body: request,
  });

  if (error) {
    throw new Error(error.message || 'Failed to analyze metrics');
  }

  return data as AnalysisResult;
}

/**
 * Extracts query ID from a full Azure DevOps query URL
 * Supports formats:
 * - https://dev.azure.com/{org}/{project}/_queries/query/{queryId}
 * - Just the query ID itself
 */
export function extractQueryId(input: string): string {
  const trimmed = input.trim();
  
  // If it's already just a GUID
  const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (guidPattern.test(trimmed)) {
    return trimmed;
  }
  
  // Try to extract from URL
  const urlPattern = /_queries\/query\/([0-9a-f-]+)/i;
  const match = trimmed.match(urlPattern);
  if (match) {
    return match[1];
  }
  
  // Return as-is if no pattern matches
  return trimmed;
}

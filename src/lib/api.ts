import { supabase } from "@/integrations/supabase/client";
import type { AnalysisRequest, AnalysisResult } from "@/types/metrics";

interface JobResponse {
  jobId: string | null;
  status: 'processing' | 'completed' | 'failed';
  totalItems?: number;
  totalChunks?: number;
  result?: AnalysisResult;
  error?: string;
}

interface JobStatusResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalItems: number;
  processedItems: number;
  currentStep: string;
  result?: AnalysisResult;
  error?: string;
}

const POLL_INTERVAL = 2000; // 2 seconds
const MAX_POLL_TIME = 600000; // 10 minutes max

/**
 * Calls the backend edge function to analyze Azure DevOps metrics.
 * Uses job-based background processing for large queries.
 * PAT is sent securely and never stored.
 */
export async function analyzeMetrics(
  request: AnalysisRequest,
  onProgress?: (step: string, progress: number) => void
): Promise<AnalysisResult> {
  // Step 1: Start the analysis job
  const { data, error } = await supabase.functions.invoke('analyze-devops', {
    body: request,
  });

  if (error) {
    throw new Error(error.message || 'Failed to start analysis');
  }

  const jobResponse = data as JobResponse;

  // If the result was immediate (empty query), return it directly
  if (jobResponse.status === 'completed' && jobResponse.result) {
    return jobResponse.result;
  }

  if (!jobResponse.jobId) {
    throw new Error('Failed to create analysis job');
  }

  // Step 2: Poll for job completion
  return pollJobStatus(jobResponse.jobId, onProgress);
}

/**
 * Poll job status until completion or failure
 */
async function pollJobStatus(
  jobId: string,
  onProgress?: (step: string, progress: number) => void
): Promise<AnalysisResult> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_POLL_TIME) {

    // Use fetch directly for GET request with query params
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/job-status?jobId=${jobId}`,
      {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to fetch job status');
    }

    const status = await response.json() as JobStatusResponse;

    // Update progress callback
    if (onProgress && status.currentStep) {
      const progress = status.totalItems > 0 
        ? Math.round((status.processedItems / 100) * 100)
        : 0;
      onProgress(status.currentStep, progress);
    }

    // Check for completion
    if (status.status === 'completed' && status.result) {
      return status.result;
    }

    // Check for failure
    if (status.status === 'failed') {
      throw new Error(status.error || 'Analysis job failed');
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }

  throw new Error('Analysis timed out. Please try with a smaller query.');
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

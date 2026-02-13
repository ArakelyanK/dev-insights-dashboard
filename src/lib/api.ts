import { supabase } from "@/integrations/supabase/client";
import type { AnalysisRequest, AnalysisResult } from "@/types/metrics";

interface JobResponse {
  jobId: string | null;
  status: 'processing' | 'completed' | 'failed';
  totalItems?: number;
  totalChunks?: number;
  completedChunks?: number;
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

interface ChunkProcessResponse {
  jobId: string;
  status: 'processing' | 'completed' | 'failed';
  completedChunks?: number;
  totalChunks?: number;
  progress?: number;
  message?: string;
  result?: AnalysisResult;
  error?: string;
}

const STATUS_POLL_INTERVAL = 1000; // 1 second for status checks
const CHUNK_PROCESS_INTERVAL = 500; // 500ms between chunk processing calls
const MAX_POLL_TIME = 1800000; // 30 minutes max
const STALL_TIMEOUT = 5 * 60 * 1000; // 5 minutes - match backend

/**
 * Calls the backend edge function to analyze Azure DevOps metrics.
 * Uses pull-based chunk processing for reliable large query handling.
 * PAT is sent securely and never stored.
 * 
 * Architecture:
 * 1. analyze-devops creates job + precomputes chunks
 * 2. This function drives processing by calling process-chunk repeatedly
 * 3. Each process-chunk call processes exactly ONE chunk
 * 4. No self-invocation, no waitUntil, no recursion
 */
export async function analyzeMetrics(
  request: AnalysisRequest,
  onProgress?: (step: string, progress: number) => void
): Promise<AnalysisResult> {
  // Step 1: Create the job (no processing happens here)
  // PAT is resolved server-side from secret if empty
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

  const jobId = jobResponse.jobId;
  const totalChunks = jobResponse.totalChunks || 1;
  
  if (onProgress) {
    onProgress(`Job created: ${jobResponse.totalItems} items in ${totalChunks} chunks`, 0);
  }

  // Step 2: Drive chunk processing with pull-based loop
  return driveChunkProcessing(jobId, request.pat || '', totalChunks, onProgress);
}

/**
 * Pull-based chunk processing driver.
 * Repeatedly calls process-chunk until all chunks are done.
 * Each call processes exactly ONE chunk - no recursion, no self-invocation.
 */
async function driveChunkProcessing(
  jobId: string,
  pat: string,
  totalChunks: number,
  onProgress?: (step: string, progress: number) => void
): Promise<AnalysisResult> {
  const startTime = Date.now();
  let lastProgressTime = Date.now();
  let completedChunks = 0;

  while (Date.now() - startTime < MAX_POLL_TIME) {
    // Check for stall
    if (Date.now() - lastProgressTime > STALL_TIMEOUT) {
      throw new Error('Analysis stalled: no progress for 5 minutes. Please try again.');
    }

    try {
      // Call process-chunk to process exactly ONE chunk
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-chunk`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ jobId, pat }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to process chunk');
      }

      const chunkResponse = await response.json() as ChunkProcessResponse;

      // Update progress tracking
      if (chunkResponse.completedChunks !== undefined && chunkResponse.completedChunks > completedChunks) {
        completedChunks = chunkResponse.completedChunks;
        lastProgressTime = Date.now();
      }

      // Update progress callback
      if (onProgress) {
        const progress = chunkResponse.progress || Math.round((completedChunks / totalChunks) * 100);
        const step = chunkResponse.message || `Processing chunk ${completedChunks}/${totalChunks}`;
        onProgress(step, progress);
      }

      // Check for completion
      if (chunkResponse.status === 'completed' && chunkResponse.result) {
        return chunkResponse.result;
      }

      // Check for failure
      if (chunkResponse.status === 'failed') {
        throw new Error(chunkResponse.error || 'Analysis job failed');
      }

      // Continue to next chunk after short delay
      await new Promise(resolve => setTimeout(resolve, CHUNK_PROCESS_INTERVAL));

    } catch (fetchError) {
      // On network error, check job status before giving up
      console.error('Chunk processing error:', fetchError);
      
      // Wait and try to check job status
      await new Promise(resolve => setTimeout(resolve, STATUS_POLL_INTERVAL * 2));
      
      const status = await checkJobStatus(jobId);
      if (status.status === 'completed' && status.result) {
        return status.result;
      }
      if (status.status === 'failed') {
        throw new Error(status.error || 'Analysis job failed');
      }
      
      // Continue trying if job is still processing
      if (status.status === 'processing') {
        lastProgressTime = Date.now(); // Reset stall timer
        continue;
      }
      
      throw fetchError;
    }
  }

  throw new Error('Analysis timed out. Please try with a smaller query.');
}

/**
 * Check job status without processing
 */
async function checkJobStatus(jobId: string): Promise<JobStatusResponse> {
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

  return response.json();
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

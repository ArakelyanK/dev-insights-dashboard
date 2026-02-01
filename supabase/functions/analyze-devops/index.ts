// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CHUNK_SIZE = 50; // Work items per chunk
const DEBUG_THRESHOLD = 20; // Auto-enable verbose debug for <= 20 items

interface AnalysisRequest {
  organization: string;
  project: string;
  queryId: string;
  pat: string;
  debug?: boolean;
}

// ============== Azure DevOps API ==============

async function azureRequest(url: string, pat: string): Promise<unknown> {
  const auth = btoa(`:${pat}`);
  const response = await fetch(url, {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Azure DevOps API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function executeQuery(
  organization: string,
  project: string,
  queryId: string,
  pat: string
): Promise<number[]> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/wit/wiql/${queryId}?api-version=7.1`;
  const result = await azureRequest(url, pat) as { workItems?: Array<{ id: number }> };
  return result.workItems?.map(wi => wi.id) || [];
}

/**
 * JOB CREATOR ONLY - No chunk processing here!
 * 
 * This function:
 * 1. Executes the Azure DevOps query to get work item IDs
 * 2. Creates a job record in the database
 * 3. Precomputes chunk boundaries and stores work_item_ids
 * 4. Returns immediately with jobId
 * 
 * Chunk processing is done by the separate 'process-chunk' function,
 * which is called by the UI/client in a pull-based loop.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const request = await req.json() as AnalysisRequest;
    const { organization, project, queryId, pat, debug: requestDebug = false } = request;

    if (!organization || !project || !queryId || !pat) {
      throw new Error('Missing required fields: organization, project, queryId, pat');
    }

    // Fetch work item IDs from Azure DevOps
    const workItemIds = await executeQuery(organization, project, queryId, pat);
    
    // Determine debug mode: verbose for small queries, aggregated for large
    const isVerboseDebug = workItemIds.length <= DEBUG_THRESHOLD;
    const debugMode = requestDebug || isVerboseDebug ? (isVerboseDebug ? 'verbose' : 'aggregated') : 'none';
    
    console.log(`[Job Init] Starting analysis for ${organization}/${project} (${workItemIds.length} items) [DEBUG: ${debugMode}]`);

    // Handle empty query result
    if (workItemIds.length === 0) {
      return new Response(JSON.stringify({
        jobId: null,
        status: 'completed',
        result: {
          developerMetrics: [],
          testerMetrics: [],
          prCommentAuthors: [],
          summary: { totalWorkItems: 0, totalRequirements: 0, totalBugs: 0, totalTasks: 0, avgDevTimeHours: 0, avgDevTestTimeHours: 0, avgStgTestTimeHours: 0, totalReturns: 0, totalPrComments: 0 },
          chartData: { developmentSpeed: [], devTestingSpeed: [], stgTestingSpeed: [], returns: [], devIterations: [], stgIterations: [], prComments: [] },
          unassignedItems: [],
        }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Create job record with work item IDs persisted
    const totalChunks = Math.ceil(workItemIds.length / CHUNK_SIZE);
    const { data: job, error: jobError } = await supabase
      .from('analysis_jobs')
      .insert({
        organization,
        project,
        query_id: queryId,
        status: 'processing',
        total_items: workItemIds.length,
        processed_items: 0,
        total_chunks: totalChunks,
        completed_chunks: 0,
        work_item_ids: workItemIds, // Persist for chunk processor
        last_progress_at: new Date().toISOString(),
        current_step: `Created job: ${workItemIds.length} items in ${totalChunks} chunks. Waiting for processing...`,
      })
      .select('id')
      .single();

    if (jobError || !job) {
      throw new Error(`Failed to create job: ${jobError?.message}`);
    }

    const jobId = job.id;
    console.log(`[Job ${jobId}] Created job for ${workItemIds.length} items in ${totalChunks} chunks`);
    console.log(`[Job ${jobId}] Ready for pull-based processing. Client must call process-chunk function.`);

    // Return immediately - NO PROCESSING HERE
    // The UI/client will call process-chunk repeatedly to drive processing
    return new Response(JSON.stringify({
      jobId,
      status: 'processing',
      totalItems: workItemIds.length,
      totalChunks,
      completedChunks: 0,
      debugMode,
      message: 'Job created. Call process-chunk to start processing.',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[Job Init] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

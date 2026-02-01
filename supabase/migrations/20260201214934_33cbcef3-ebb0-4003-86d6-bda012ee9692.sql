-- Add last_progress_at for stall detection and persist work item IDs for recovery
ALTER TABLE public.analysis_jobs 
ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
ADD COLUMN IF NOT EXISTS total_chunks INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS completed_chunks INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS work_item_ids JSONB DEFAULT '[]'::jsonb;

-- Create index for stall detection queries
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_stall_detection 
ON public.analysis_jobs (status, last_progress_at) 
WHERE status = 'processing';
-- Create analysis_jobs table for job management
CREATE TABLE public.analysis_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  organization TEXT NOT NULL,
  project TEXT NOT NULL,
  query_id TEXT NOT NULL,
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  current_step TEXT,
  error_message TEXT,
  result JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + INTERVAL '1 hour')
);

-- Create index for fast status lookups
CREATE INDEX idx_analysis_jobs_status ON public.analysis_jobs(status);
CREATE INDEX idx_analysis_jobs_expires ON public.analysis_jobs(expires_at);

-- Create partial_results table for chunk aggregation
CREATE TABLE public.analysis_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.analysis_jobs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_type TEXT NOT NULL CHECK (chunk_type IN ('work_items', 'pr_comments')),
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(job_id, chunk_index, chunk_type)
);

CREATE INDEX idx_analysis_chunks_job ON public.analysis_chunks(job_id);

-- Disable RLS for these tables (no user auth, data is ephemeral)
-- Jobs auto-expire and are cleaned up

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_analysis_job_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_analysis_jobs_updated_at
BEFORE UPDATE ON public.analysis_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_analysis_job_updated_at();

-- Create cleanup function for expired jobs
CREATE OR REPLACE FUNCTION public.cleanup_expired_analysis_jobs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.analysis_jobs WHERE expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SET search_path = public;
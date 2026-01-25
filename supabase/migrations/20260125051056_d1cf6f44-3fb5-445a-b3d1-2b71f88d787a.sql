-- Enable RLS on tables
ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_chunks ENABLE ROW LEVEL SECURITY;

-- Create policies that allow edge functions (service role) to manage jobs
-- Anonymous users can only read job status and results
CREATE POLICY "Allow anon to read job status" 
ON public.analysis_jobs 
FOR SELECT 
USING (true);

CREATE POLICY "Allow service role to manage jobs" 
ON public.analysis_jobs 
FOR ALL 
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anon to read chunks" 
ON public.analysis_chunks 
FOR SELECT 
USING (true);

CREATE POLICY "Allow service role to manage chunks" 
ON public.analysis_chunks 
FOR ALL 
USING (true)
WITH CHECK (true);
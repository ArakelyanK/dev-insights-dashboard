-- Fix chunk_type constraint to allow 'work_items_with_prs' value used by the edge function
ALTER TABLE public.analysis_chunks DROP CONSTRAINT IF EXISTS analysis_chunks_chunk_type_check;

-- Add updated constraint with all valid chunk types
ALTER TABLE public.analysis_chunks ADD CONSTRAINT analysis_chunks_chunk_type_check 
  CHECK (chunk_type = ANY (ARRAY['work_items'::text, 'pr_comments'::text, 'work_items_with_prs'::text]));
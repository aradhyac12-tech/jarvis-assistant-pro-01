
-- Create table to track agent update versions
CREATE TABLE public.agent_updates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  version TEXT NOT NULL,
  file_manifest JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.agent_updates ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own agent updates" ON public.agent_updates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create agent updates" ON public.agent_updates FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Storage bucket for agent files
INSERT INTO storage.buckets (id, name, public) VALUES ('agent-files', 'agent-files', false);

-- Storage policies
CREATE POLICY "Users can upload agent files" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'agent-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can read their agent files" ON storage.objects FOR SELECT USING (bucket_id = 'agent-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can update agent files" ON storage.objects FOR UPDATE USING (bucket_id = 'agent-files' AND auth.uid()::text = (storage.foldername(name))[1]);

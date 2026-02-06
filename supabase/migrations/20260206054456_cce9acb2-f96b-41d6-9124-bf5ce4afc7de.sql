-- Create assistant_memories table for persistent memory storage
CREATE TABLE public.assistant_memories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  device_id UUID NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  category TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NULL,
  UNIQUE (user_id, key)
);

-- Enable RLS
ALTER TABLE public.assistant_memories ENABLE ROW LEVEL SECURITY;

-- RLS: users can CRUD own memories
CREATE POLICY "Users can view their own memories"
  ON public.assistant_memories FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own memories"
  ON public.assistant_memories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own memories"
  ON public.assistant_memories FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own memories"
  ON public.assistant_memories FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_memories_updated_at
  BEFORE UPDATE ON public.assistant_memories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index for fast lookup by key
CREATE INDEX idx_memories_user_key ON public.assistant_memories (user_id, key);
CREATE INDEX idx_memories_category ON public.assistant_memories (user_id, category);
CREATE INDEX idx_memories_expires ON public.assistant_memories (expires_at) WHERE expires_at IS NOT NULL;
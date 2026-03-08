CREATE TABLE public.scheduled_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_id uuid REFERENCES public.devices(id) ON DELETE CASCADE NOT NULL,
  command_type text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  scheduled_at timestamp with time zone NOT NULL,
  repeat_mode text DEFAULT 'once',
  repeat_days text[] DEFAULT '{}',
  enabled boolean DEFAULT true,
  last_run_at timestamp with time zone,
  label text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.scheduled_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their scheduled commands"
  ON public.scheduled_commands FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create scheduled commands"
  ON public.scheduled_commands FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their scheduled commands"
  ON public.scheduled_commands FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their scheduled commands"
  ON public.scheduled_commands FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_scheduled_commands_updated_at
  BEFORE UPDATE ON public.scheduled_commands
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- Add pairing_code column to devices for initial pairing
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS pairing_code TEXT;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS pairing_expires_at TIMESTAMPTZ;

-- Create index for fast pairing code lookup
CREATE INDEX IF NOT EXISTS idx_devices_pairing_code ON public.devices(pairing_code) WHERE pairing_code IS NOT NULL;

-- Create device_sessions table for browser-device linking
CREATE TABLE IF NOT EXISTS public.device_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE NOT NULL,
  session_token UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_token)
);

-- Enable RLS on device_sessions
ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;

-- Permissive policies for device_sessions (validated by token in app layer)
CREATE POLICY "Allow session operations" ON public.device_sessions FOR ALL USING (true) WITH CHECK (true);

-- Drop old user-based command policies
DROP POLICY IF EXISTS "Users create own commands" ON public.commands;
DROP POLICY IF EXISTS "Users view own commands" ON public.commands;
DROP POLICY IF EXISTS "Users update own commands" ON public.commands;
DROP POLICY IF EXISTS "Users delete own commands" ON public.commands;

-- New device-based command policies (device_id validated in app layer)
CREATE POLICY "Allow command insert for devices" ON public.commands FOR INSERT WITH CHECK (
  device_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.devices WHERE id = device_id)
);

CREATE POLICY "Allow command select for devices" ON public.commands FOR SELECT USING (
  device_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.devices WHERE id = device_id)
);

CREATE POLICY "Allow command update for devices" ON public.commands FOR UPDATE USING (
  device_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.devices WHERE id = device_id)
);

CREATE POLICY "Allow command delete for devices" ON public.commands FOR DELETE USING (
  device_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.devices WHERE id = device_id)
);
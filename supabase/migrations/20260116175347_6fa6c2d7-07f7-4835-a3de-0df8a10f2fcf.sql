-- Drop existing overly permissive policies on commands table
DROP POLICY IF EXISTS "Allow command delete for devices" ON public.commands;
DROP POLICY IF EXISTS "Allow command insert for devices" ON public.commands;
DROP POLICY IF EXISTS "Allow command select for devices" ON public.commands;
DROP POLICY IF EXISTS "Allow command update for devices" ON public.commands;

-- Create restrictive policies that deny direct client access
-- The Python agent uses service role key which bypasses RLS
-- The web app uses the edge function which also uses service role key

-- Only allow SELECT for commands belonging to devices owned by the authenticated user
CREATE POLICY "Users can view commands for their devices"
ON public.commands
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.devices
    WHERE devices.id = commands.device_id
    AND devices.user_id = auth.uid()
  )
);

-- Only allow INSERT for authenticated users on their own devices
CREATE POLICY "Users can insert commands for their devices"
ON public.commands
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.devices
    WHERE devices.id = commands.device_id
    AND devices.user_id = auth.uid()
  )
);

-- Only allow UPDATE for authenticated users on their own devices
CREATE POLICY "Users can update commands for their devices"
ON public.commands
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.devices
    WHERE devices.id = commands.device_id
    AND devices.user_id = auth.uid()
  )
);

-- Only allow DELETE for authenticated users on their own devices
CREATE POLICY "Users can delete commands for their devices"
ON public.commands
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.devices
    WHERE devices.id = commands.device_id
    AND devices.user_id = auth.uid()
  )
);
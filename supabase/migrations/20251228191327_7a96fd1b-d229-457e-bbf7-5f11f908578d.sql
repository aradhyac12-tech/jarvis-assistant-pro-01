-- Drop existing restrictive policies on devices
DROP POLICY IF EXISTS "Users can create their own devices" ON public.devices;
DROP POLICY IF EXISTS "Users can update their own devices" ON public.devices;
DROP POLICY IF EXISTS "Users can view their own devices" ON public.devices;
DROP POLICY IF EXISTS "Users can delete their own devices" ON public.devices;

-- Create new policies that allow device_key based access (for Python agent)
-- Allow anyone to insert a device (agent registers itself)
CREATE POLICY "Allow device registration" 
ON public.devices 
FOR INSERT 
WITH CHECK (true);

-- Allow anyone to update their device by device_key
CREATE POLICY "Allow device updates by device_key" 
ON public.devices 
FOR UPDATE 
USING (true);

-- Allow anyone to view devices (for dashboard)
CREATE POLICY "Allow viewing devices" 
ON public.devices 
FOR SELECT 
USING (true);

-- Allow deleting devices
CREATE POLICY "Allow device deletion" 
ON public.devices 
FOR DELETE 
USING (true);

-- Also update commands table to allow Python agent to read/update
DROP POLICY IF EXISTS "Users can create their own commands" ON public.commands;
DROP POLICY IF EXISTS "Users can update their own commands" ON public.commands;
DROP POLICY IF EXISTS "Users can view their own commands" ON public.commands;

-- Allow inserting commands from web app
CREATE POLICY "Allow command creation" 
ON public.commands 
FOR INSERT 
WITH CHECK (true);

-- Allow agent to update command status
CREATE POLICY "Allow command updates" 
ON public.commands 
FOR UPDATE 
USING (true);

-- Allow viewing commands
CREATE POLICY "Allow viewing commands" 
ON public.commands 
FOR SELECT 
USING (true);

-- Enable realtime for devices table
ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;

-- Allow the Python agent (anon role) to SELECT commands for polling
CREATE POLICY "Agent can poll pending commands by device_id"
ON public.commands
FOR SELECT
USING (true);

-- Allow the Python agent (anon role) to UPDATE command status after execution
CREATE POLICY "Agent can update command status"
ON public.commands
FOR UPDATE
USING (true);

-- Also ensure device_sessions is readable for the agent to validate sessions
-- Check existing policies first
CREATE POLICY "Anyone can read device sessions"
ON public.device_sessions
FOR SELECT
USING (true);

-- Allow creating sessions (for pairing)
CREATE POLICY "Anyone can create device sessions"
ON public.device_sessions
FOR INSERT
WITH CHECK (true);

-- Allow updating sessions (for last_active)
CREATE POLICY "Anyone can update device sessions"
ON public.device_sessions
FOR UPDATE
USING (true);

-- Allow deleting sessions (for cleanup)
CREATE POLICY "Anyone can delete device sessions"
ON public.device_sessions
FOR DELETE
USING (true);

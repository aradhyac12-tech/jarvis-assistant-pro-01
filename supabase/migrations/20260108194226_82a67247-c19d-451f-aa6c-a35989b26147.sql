-- Drop the overly permissive policies on commands table
DROP POLICY IF EXISTS "Allow viewing commands" ON public.commands;
DROP POLICY IF EXISTS "Allow command creation" ON public.commands;
DROP POLICY IF EXISTS "Allow command updates" ON public.commands;

-- Create proper user-scoped policies
CREATE POLICY "Users view own commands" 
ON public.commands 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users create own commands" 
ON public.commands 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own commands" 
ON public.commands 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Also need a DELETE policy for cleanup
CREATE POLICY "Users delete own commands" 
ON public.commands 
FOR DELETE 
USING (auth.uid() = user_id);
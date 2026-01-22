-- Add remember_device and expires_at columns to device_sessions
ALTER TABLE public.device_sessions 
ADD COLUMN IF NOT EXISTS remember_device BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours');

-- Create index for efficient expiration queries
CREATE INDEX IF NOT EXISTS idx_device_sessions_expires_at ON public.device_sessions(expires_at);

-- Update existing sessions to have a valid expires_at (30 days from last_active)
UPDATE public.device_sessions 
SET expires_at = last_active + interval '30 days'
WHERE expires_at <= now();
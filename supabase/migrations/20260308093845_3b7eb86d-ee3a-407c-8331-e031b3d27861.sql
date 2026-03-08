
-- Surveillance events table: stores detection events with screenshots
CREATE TABLE public.surveillance_events (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE NOT NULL,
    user_id UUID NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'motion',
    confidence INTEGER NOT NULL DEFAULT 0,
    recognized BOOLEAN NOT NULL DEFAULT false,
    recognized_label TEXT,
    recognition_confidence INTEGER DEFAULT 0,
    screenshot_url TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for fast queries by device + time
CREATE INDEX idx_surveillance_events_device_time ON public.surveillance_events(device_id, created_at DESC);
CREATE INDEX idx_surveillance_events_user ON public.surveillance_events(user_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.surveillance_events ENABLE ROW LEVEL SECURITY;

-- Only the device owner can view/insert/delete surveillance events
CREATE POLICY "Device owner can view surveillance events"
ON public.surveillance_events
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.devices
        WHERE devices.id = surveillance_events.device_id
        AND devices.user_id = auth.uid()
    )
);

CREATE POLICY "Device owner can insert surveillance events"
ON public.surveillance_events
FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
        SELECT 1 FROM public.devices
        WHERE devices.id = surveillance_events.device_id
        AND devices.user_id = auth.uid()
    )
);

CREATE POLICY "Device owner can delete surveillance events"
ON public.surveillance_events
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.devices
        WHERE devices.id = surveillance_events.device_id
        AND devices.user_id = auth.uid()
    )
);

-- Create a storage bucket for surveillance screenshots
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('surveillance-screenshots', 'surveillance-screenshots', false, 5242880, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies for surveillance screenshots
CREATE POLICY "Device owners can upload screenshots"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'surveillance-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Device owners can view screenshots"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'surveillance-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Device owners can delete screenshots"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'surveillance-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Enable realtime for surveillance events so phone gets push alerts
ALTER PUBLICATION supabase_realtime ADD TABLE public.surveillance_events;

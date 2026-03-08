
CREATE TABLE public.app_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('apk', 'web', 'pc_agent')),
  version text NOT NULL,
  release_notes text,
  force_update boolean DEFAULT false,
  download_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read releases"
  ON public.app_releases
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX idx_app_releases_platform_version ON public.app_releases(platform, created_at DESC);


CREATE TABLE public.flights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  drone_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_id UUID REFERENCES public.flights(id) ON DELETE CASCADE,
  zone_id TEXT NOT NULL,
  gps JSONB,
  health_score NUMERIC NOT NULL,
  stress_class TEXT NOT NULL,
  confidence NUMERIC NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  heatmap_url TEXT,
  drone_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.flights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read flights" ON public.flights FOR SELECT USING (true);
CREATE POLICY "Public insert flights" ON public.flights FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read detections" ON public.detections FOR SELECT USING (true);
CREATE POLICY "Public insert detections" ON public.detections FOR INSERT WITH CHECK (true);

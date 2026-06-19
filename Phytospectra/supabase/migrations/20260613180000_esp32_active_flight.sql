-- One physical ESP32, many fields: farmer picks active flight in the app.
-- Run once in Supabase Dashboard → SQL Editor (project vzmtbpdnnbrmhshhtaru).

ALTER TABLE public.drones
  ADD COLUMN IF NOT EXISTS active_flight_id UUID REFERENCES public.flights(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.esp32_active_missions (
  device_id  TEXT NOT NULL PRIMARY KEY,
  user_id    UUID NOT NULL,
  flight_id  UUID NOT NULL REFERENCES public.flights(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS esp32_active_missions_user_idx ON public.esp32_active_missions (user_id);

-- Backend uses service role (bypasses RLS). Disable RLS on this table for clarity.
ALTER TABLE public.esp32_active_missions DISABLE ROW LEVEL SECURITY;

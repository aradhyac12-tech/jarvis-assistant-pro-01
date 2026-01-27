-- Function to calculate next scheduled meeting time (fixed variable name)
CREATE OR REPLACE FUNCTION public.calculate_next_meeting_time(
  p_scheduled_time time,
  p_scheduled_days text[]
)
RETURNS timestamptz
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  day_names text[] := ARRAY['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  v_current_day_idx integer;
  v_current_time time;
  v_target_day text;
  v_next_date date;
  v_i integer;
BEGIN
  IF p_scheduled_time IS NULL OR array_length(p_scheduled_days, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  v_current_day_idx := EXTRACT(DOW FROM now())::integer;
  v_current_time := now()::time;
  
  -- Find the next scheduled day
  FOR v_i IN 0..6 LOOP
    v_target_day := day_names[((v_current_day_idx + v_i) % 7) + 1];
    
    IF v_target_day = ANY(p_scheduled_days) THEN
      -- Check if it's today and time hasn't passed
      IF v_i = 0 AND v_current_time >= p_scheduled_time THEN
        CONTINUE;
      END IF;
      
      v_next_date := current_date + v_i;
      RETURN (v_next_date + p_scheduled_time)::timestamptz;
    END IF;
  END LOOP;
  
  RETURN NULL;
END;
$$;

-- Trigger to update next_scheduled_at when schedule changes
CREATE OR REPLACE FUNCTION public.update_next_scheduled_meeting()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.auto_join_enabled AND NEW.scheduled_time IS NOT NULL AND array_length(NEW.scheduled_days, 1) > 0 THEN
    NEW.next_scheduled_at := calculate_next_meeting_time(NEW.scheduled_time, NEW.scheduled_days);
  ELSE
    NEW.next_scheduled_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS update_meeting_next_scheduled ON public.saved_meetings;

CREATE TRIGGER update_meeting_next_scheduled
BEFORE INSERT OR UPDATE ON public.saved_meetings
FOR EACH ROW
EXECUTE FUNCTION public.update_next_scheduled_meeting();
-- Create table for saved Zoom meetings
CREATE TABLE public.saved_meetings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE,
  meeting_name TEXT NOT NULL,
  meeting_id TEXT,
  meeting_password TEXT,
  meeting_link TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_used_at TIMESTAMP WITH TIME ZONE
);

-- Enable Row Level Security
ALTER TABLE public.saved_meetings ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own meetings" 
ON public.saved_meetings 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own meetings" 
ON public.saved_meetings 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own meetings" 
ON public.saved_meetings 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own meetings" 
ON public.saved_meetings 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_saved_meetings_updated_at
BEFORE UPDATE ON public.saved_meetings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
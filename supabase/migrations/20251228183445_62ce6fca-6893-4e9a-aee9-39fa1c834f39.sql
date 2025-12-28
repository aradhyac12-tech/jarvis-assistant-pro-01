-- Create devices table for connected PCs
CREATE TABLE public.devices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'My PC',
  device_key TEXT NOT NULL UNIQUE,
  is_online BOOLEAN NOT NULL DEFAULT false,
  last_seen TIMESTAMP WITH TIME ZONE,
  system_info JSONB,
  current_volume INTEGER DEFAULT 50,
  current_brightness INTEGER DEFAULT 50,
  is_locked BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create commands table for command queue
CREATE TABLE public.commands (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  command_type TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  result JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  executed_at TIMESTAMP WITH TIME ZONE
);

-- Create chat_history table for voice conversations
CREATE TABLE public.chat_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  language TEXT DEFAULT 'en',
  audio_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create user_settings table
CREATE TABLE public.user_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  wake_word TEXT DEFAULT 'Hey Jarvis',
  unlock_pin TEXT DEFAULT '1212',
  theme TEXT DEFAULT 'dark',
  voice_id TEXT DEFAULT 'JBFqnCBsd6RMkjVDRZzb',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for devices
CREATE POLICY "Users can view their own devices" ON public.devices FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own devices" ON public.devices FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own devices" ON public.devices FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own devices" ON public.devices FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for commands
CREATE POLICY "Users can view their own commands" ON public.commands FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own commands" ON public.commands FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own commands" ON public.commands FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for chat_history
CREATE POLICY "Users can view their own chat history" ON public.chat_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own chat messages" ON public.chat_history FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for user_settings
CREATE POLICY "Users can view their own settings" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own settings" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own settings" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Enable realtime for commands table
ALTER PUBLICATION supabase_realtime ADD TABLE public.commands;

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for updated_at
CREATE TRIGGER update_devices_updated_at BEFORE UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
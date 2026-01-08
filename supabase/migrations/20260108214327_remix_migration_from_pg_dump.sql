CREATE EXTENSION IF NOT EXISTS "pg_graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "plpgsql";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
BEGIN;

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_table_access_method = heap;

--
-- Name: chat_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    device_id uuid,
    role text NOT NULL,
    content text NOT NULL,
    language text DEFAULT 'en'::text,
    audio_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid,
    user_id uuid NOT NULL,
    command_type text NOT NULL,
    payload jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    executed_at timestamp with time zone
);


--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text DEFAULT 'My PC'::text NOT NULL,
    device_key text NOT NULL,
    is_online boolean DEFAULT false NOT NULL,
    last_seen timestamp with time zone,
    system_info jsonb,
    current_volume integer DEFAULT 50,
    current_brightness integer DEFAULT 50,
    is_locked boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    display_name text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    wake_word text DEFAULT 'Hey Jarvis'::text,
    unlock_pin text DEFAULT '1212'::text,
    theme text DEFAULT 'dark'::text,
    voice_id text DEFAULT 'JBFqnCBsd6RMkjVDRZzb'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_history chat_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_history
    ADD CONSTRAINT chat_history_pkey PRIMARY KEY (id);


--
-- Name: commands commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commands
    ADD CONSTRAINT commands_pkey PRIMARY KEY (id);


--
-- Name: devices devices_device_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_device_key_key UNIQUE (device_key);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_key UNIQUE (user_id);


--
-- Name: devices update_devices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_devices_updated_at BEFORE UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_settings update_user_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: chat_history chat_history_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_history
    ADD CONSTRAINT chat_history_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE SET NULL;


--
-- Name: commands commands_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commands
    ADD CONSTRAINT commands_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: devices Allow device deletion; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow device deletion" ON public.devices FOR DELETE USING (true);


--
-- Name: devices Allow device registration; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow device registration" ON public.devices FOR INSERT WITH CHECK (true);


--
-- Name: devices Allow device updates by device_key; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow device updates by device_key" ON public.devices FOR UPDATE USING (true);


--
-- Name: devices Allow viewing devices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow viewing devices" ON public.devices FOR SELECT USING (true);


--
-- Name: chat_history Users can create their own chat messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own chat messages" ON public.chat_history FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: profiles Users can create their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_settings Users can create their own settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own settings" ON public.user_settings FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: profiles Users can update their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: user_settings Users can update their own settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own settings" ON public.user_settings FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: chat_history Users can view their own chat history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own chat history" ON public.chat_history FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: profiles Users can view their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_settings Users can view their own settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own settings" ON public.user_settings FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: commands Users create own commands; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users create own commands" ON public.commands FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: commands Users delete own commands; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete own commands" ON public.commands FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: commands Users update own commands; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own commands" ON public.commands FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: commands Users view own commands; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users view own commands" ON public.commands FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: chat_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;

--
-- Name: commands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commands ENABLE ROW LEVEL SECURITY;

--
-- Name: devices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--




COMMIT;
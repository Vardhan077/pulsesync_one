--
-- PostgreSQL database dump
--

\restrict ENn3bnNcvmzbru5prhvgB1GtwCiLnBaX4QFvcnCgm152X3ZufG6msUzDYT1WhJZ

-- Dumped from database version 16.15 (Debian 16.15-1.pgdg12+2)
-- Dumped by pg_dump version 16.15 (Debian 16.15-1.pgdg12+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type character varying(100) NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: call_extractions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_extractions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid,
    schema_id uuid,
    extracted_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid NOT NULL,
    name character varying(255) NOT NULL,
    website character varying(255),
    industry character varying(100),
    crm_account character varying(255),
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: company_memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_memories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    memory_type character varying(50) NOT NULL,
    value text NOT NULL,
    meeting_id uuid,
    confidence integer DEFAULT 100,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: crm_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    integration_id uuid,
    entity_type character varying(50) NOT NULL,
    pulsesync_entity_id uuid NOT NULL,
    crm_record_id character varying(100) NOT NULL,
    crm_record_url character varying(512),
    metadata jsonb DEFAULT '{}'::jsonb,
    last_synced_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: destination_field_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.destination_field_metadata (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    integration_id uuid,
    object_type character varying(50) NOT NULL,
    field_name character varying(100) NOT NULL,
    field_label character varying(255) NOT NULL,
    field_type character varying(50) NOT NULL,
    is_custom boolean DEFAULT false,
    options jsonb DEFAULT '[]'::jsonb,
    cached_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: extraction_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.extraction_profiles (
    id character varying(100) NOT NULL,
    workspace_id uuid,
    name character varying(255) NOT NULL,
    description text,
    summary_sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    action_items_enabled boolean DEFAULT true,
    risks_enabled boolean DEFAULT true,
    objections_enabled boolean DEFAULT true,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: extraction_schemas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.extraction_schemas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: field_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    integration_id uuid,
    playbook_field_name character varying(100) NOT NULL,
    destination_object character varying(50) NOT NULL,
    destination_field_name character varying(100) NOT NULL,
    is_enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: integration_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    integration_id uuid,
    encrypted_access_token text NOT NULL,
    encrypted_refresh_token text,
    expires_at timestamp with time zone,
    iv character varying(64) NOT NULL,
    auth_tag character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    provider character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    connection_status character varying(50) DEFAULT 'not_connected'::character varying,
    status character varying(50) DEFAULT 'Disconnected'::character varying,
    auth_metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    last_connected_at timestamp with time zone,
    last_sync_at timestamp with time zone
);


--
-- Name: meeting_analytics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_analytics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid,
    speaker_id uuid,
    talk_time_seconds integer DEFAULT 0,
    interruption_count integer DEFAULT 0,
    words_per_minute integer DEFAULT 0,
    participation_percentage numeric(5,2) DEFAULT 0.00,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    speaker_name character varying(120)
);


--
-- Name: meeting_bot_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_bot_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    meeting_id uuid,
    provider character varying(50) NOT NULL,
    mode character varying(30) DEFAULT 'realtime'::character varying,
    meeting_url text NOT NULL,
    external_meeting_id character varying(255),
    meeting_title character varying(255) NOT NULL,
    scheduled_start timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    scheduled_end timestamp with time zone,
    status character varying(50) DEFAULT 'SCHEDULED'::character varying,
    consent_state character varying(30) DEFAULT 'granted'::character varying,
    consent_timestamp timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by character varying(255) DEFAULT 'User'::character varying,
    bot_participant_name character varying(255) DEFAULT 'PulseSync Meeting Assistant'::character varying,
    provider_metadata jsonb DEFAULT '{}'::jsonb,
    join_attempts integer DEFAULT 0,
    joined_at timestamp with time zone,
    left_at timestamp with time zone,
    meeting_started_at timestamp with time zone,
    meeting_ended_at timestamp with time zone,
    media_started_at timestamp with time zone,
    media_ended_at timestamp with time zone,
    transcript_status character varying(50) DEFAULT 'pending'::character varying,
    attribution_status character varying(50) DEFAULT 'pending'::character varying,
    diarization_status character varying(50) DEFAULT 'pending'::character varying,
    extraction_status character varying(50) DEFAULT 'pending'::character varying,
    participant_count integer DEFAULT 0,
    processing_job_id character varying(255),
    error_code character varying(100),
    error_message text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: meeting_bot_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_bot_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid,
    stage character varying(50) NOT NULL,
    level character varying(20) DEFAULT 'info'::character varying,
    message text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: meeting_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid,
    job_id uuid,
    platform character varying(50) NOT NULL,
    platform_participant_id character varying(255) NOT NULL,
    display_name character varying(255) NOT NULL,
    email character varying(255),
    role character varying(50) DEFAULT 'unknown'::character varying,
    organization character varying(255),
    is_host boolean DEFAULT false,
    is_bot boolean DEFAULT false,
    identity_source character varying(50) DEFAULT 'platform_native'::character varying,
    identity_confidence numeric(4,3) DEFAULT 1.0,
    crm_contact_id character varying(100),
    crm_account_id character varying(100),
    metadata jsonb DEFAULT '{}'::jsonb,
    joined_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    left_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: meeting_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_summaries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid,
    overview text NOT NULL,
    action_items jsonb,
    objections jsonb,
    decisions jsonb,
    topics jsonb,
    sentiment_trend jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meetings (
    id uuid NOT NULL,
    title character varying(255) NOT NULL,
    status character varying(50) DEFAULT 'queued'::character varying,
    workflow_state character varying(50) DEFAULT 'uploaded'::character varying,
    company_id uuid,
    audio_url character varying(512),
    duration_seconds integer,
    capture_source character varying(30) DEFAULT 'extension'::character varying,
    capture_provider character varying(40),
    meeting_url text,
    bot_status character varying(30),
    consent_status character varying(30) DEFAULT 'unknown'::character varying,
    ai_snapshot jsonb DEFAULT '{}'::jsonb,
    deal_intelligence jsonb DEFAULT '{}'::jsonb,
    risks jsonb DEFAULT '[]'::jsonb,
    objections jsonb DEFAULT '[]'::jsonb,
    action_items jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    processing_stage character varying(50) DEFAULT 'queued'::character varying,
    error_message text,
    call_type character varying(50) DEFAULT 'discovery'::character varying,
    call_type_confidence numeric(4,3) DEFAULT 0.94,
    call_type_source character varying(50) DEFAULT 'ai'::character varying,
    call_type_rationale text
);


--
-- Name: objections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.objections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    objection text NOT NULL,
    count integer DEFAULT 1,
    last_seen timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: risks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    risk text NOT NULL,
    first_seen timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    last_seen timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    mention_count integer DEFAULT 1,
    evidence text
);


--
-- Name: schema_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schema_id uuid,
    name character varying(100) NOT NULL,
    label character varying(255) NOT NULL,
    field_type character varying(50) NOT NULL,
    description text,
    prompt_hint text,
    is_required boolean DEFAULT false,
    sort_order integer DEFAULT 0 NOT NULL,
    options jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: speaker_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.speaker_embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    speaker_id uuid NOT NULL,
    meeting_id uuid,
    embedding public.vector(512) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: speaker_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.speaker_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid,
    speaker_id character varying(100) NOT NULL,
    participant_id uuid,
    display_name character varying(255),
    source character varying(50) NOT NULL,
    confidence numeric(4,3) DEFAULT 1.0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: speakers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.speakers (
    meeting_id uuid NOT NULL,
    speaker_id uuid NOT NULL,
    name character varying(120),
    role character varying(100),
    department character varying(100),
    job_title character varying(100),
    email character varying(255),
    company_id uuid,
    status character varying(50) DEFAULT 'Needs Review'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sync_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sync_run_id uuid,
    destination_object character varying(50) NOT NULL,
    destination_field character varying(100) NOT NULL,
    previous_value text,
    new_value text,
    status character varying(50) NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sync_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid,
    destination character varying(50) NOT NULL,
    status character varying(50) NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    meeting_id uuid,
    integration_id uuid,
    provider character varying(50) NOT NULL,
    status character varying(50) NOT NULL,
    destination_record_ids jsonb DEFAULT '{}'::jsonb,
    user_id uuid,
    error_message text,
    idempotency_key character varying(128),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamp with time zone
);


--
-- Name: timeline_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timeline_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    meeting_id uuid,
    event_type character varying(100) NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: transcript_segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transcript_segments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid,
    speaker_id uuid,
    start_time numeric(8,3) NOT NULL,
    end_time numeric(8,3) NOT NULL,
    text text NOT NULL,
    original_text text,
    corrected_text text,
    confidence numeric(4,3),
    attribution_source character varying(50) DEFAULT 'unknown'::character varying,
    attribution_confidence numeric(4,3) DEFAULT 0.0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    speaker_name character varying(120)
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: call_extractions call_extractions_meeting_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_extractions
    ADD CONSTRAINT call_extractions_meeting_id_key UNIQUE (meeting_id);


--
-- Name: call_extractions call_extractions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_extractions
    ADD CONSTRAINT call_extractions_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: company_memories company_memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_memories
    ADD CONSTRAINT company_memories_pkey PRIMARY KEY (id);


--
-- Name: crm_records crm_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_records
    ADD CONSTRAINT crm_records_pkey PRIMARY KEY (id);


--
-- Name: crm_records crm_records_workspace_id_integration_id_entity_type_pulsesy_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_records
    ADD CONSTRAINT crm_records_workspace_id_integration_id_entity_type_pulsesy_key UNIQUE (workspace_id, integration_id, entity_type, pulsesync_entity_id);


--
-- Name: destination_field_metadata destination_field_metadata_integration_id_object_type_field_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destination_field_metadata
    ADD CONSTRAINT destination_field_metadata_integration_id_object_type_field_key UNIQUE (integration_id, object_type, field_name);


--
-- Name: destination_field_metadata destination_field_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destination_field_metadata
    ADD CONSTRAINT destination_field_metadata_pkey PRIMARY KEY (id);


--
-- Name: extraction_profiles extraction_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extraction_profiles
    ADD CONSTRAINT extraction_profiles_pkey PRIMARY KEY (id);


--
-- Name: extraction_schemas extraction_schemas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extraction_schemas
    ADD CONSTRAINT extraction_schemas_pkey PRIMARY KEY (id);


--
-- Name: field_mappings field_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_mappings
    ADD CONSTRAINT field_mappings_pkey PRIMARY KEY (id);


--
-- Name: field_mappings field_mappings_workspace_id_integration_id_playbook_field_n_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_mappings
    ADD CONSTRAINT field_mappings_workspace_id_integration_id_playbook_field_n_key UNIQUE (workspace_id, integration_id, playbook_field_name);


--
-- Name: integration_credentials integration_credentials_integration_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_credentials
    ADD CONSTRAINT integration_credentials_integration_id_key UNIQUE (integration_id);


--
-- Name: integration_credentials integration_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_credentials
    ADD CONSTRAINT integration_credentials_pkey PRIMARY KEY (id);


--
-- Name: integrations integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);


--
-- Name: integrations integrations_workspace_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_workspace_id_provider_key UNIQUE (workspace_id, provider);


--
-- Name: meeting_analytics meeting_analytics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_analytics
    ADD CONSTRAINT meeting_analytics_pkey PRIMARY KEY (id);


--
-- Name: meeting_bot_jobs meeting_bot_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_bot_jobs
    ADD CONSTRAINT meeting_bot_jobs_pkey PRIMARY KEY (id);


--
-- Name: meeting_bot_logs meeting_bot_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_bot_logs
    ADD CONSTRAINT meeting_bot_logs_pkey PRIMARY KEY (id);


--
-- Name: meeting_participants meeting_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_participants
    ADD CONSTRAINT meeting_participants_pkey PRIMARY KEY (id);


--
-- Name: meeting_summaries meeting_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_summaries
    ADD CONSTRAINT meeting_summaries_pkey PRIMARY KEY (id);


--
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);


--
-- Name: objections objections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objections
    ADD CONSTRAINT objections_pkey PRIMARY KEY (id);


--
-- Name: risks risks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risks
    ADD CONSTRAINT risks_pkey PRIMARY KEY (id);


--
-- Name: schema_fields schema_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_fields
    ADD CONSTRAINT schema_fields_pkey PRIMARY KEY (id);


--
-- Name: schema_fields schema_fields_schema_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_fields
    ADD CONSTRAINT schema_fields_schema_id_name_key UNIQUE (schema_id, name);


--
-- Name: speaker_embeddings speaker_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaker_embeddings
    ADD CONSTRAINT speaker_embeddings_pkey PRIMARY KEY (id);


--
-- Name: speaker_mappings speaker_mappings_meeting_id_speaker_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaker_mappings
    ADD CONSTRAINT speaker_mappings_meeting_id_speaker_id_key UNIQUE (meeting_id, speaker_id);


--
-- Name: speaker_mappings speaker_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaker_mappings
    ADD CONSTRAINT speaker_mappings_pkey PRIMARY KEY (id);


--
-- Name: speakers speakers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speakers
    ADD CONSTRAINT speakers_pkey PRIMARY KEY (meeting_id, speaker_id);


--
-- Name: sync_items sync_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_items
    ADD CONSTRAINT sync_items_pkey PRIMARY KEY (id);


--
-- Name: sync_logs sync_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_logs
    ADD CONSTRAINT sync_logs_pkey PRIMARY KEY (id);


--
-- Name: sync_runs sync_runs_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: sync_runs sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_pkey PRIMARY KEY (id);


--
-- Name: timeline_events timeline_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timeline_events
    ADD CONSTRAINT timeline_events_pkey PRIMARY KEY (id);


--
-- Name: transcript_segments transcript_segments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transcript_segments
    ADD CONSTRAINT transcript_segments_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_slug_key UNIQUE (slug);


--
-- Name: idx_call_extractions_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_extractions_meeting ON public.call_extractions USING btree (meeting_id);


--
-- Name: idx_crm_records_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_records_lookup ON public.crm_records USING btree (workspace_id, integration_id, entity_type, pulsesync_entity_id);


--
-- Name: idx_extraction_profiles_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_extraction_profiles_workspace ON public.extraction_profiles USING btree (workspace_id);


--
-- Name: idx_integrations_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integrations_workspace ON public.integrations USING btree (workspace_id);


--
-- Name: idx_meeting_analytics_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_analytics_meeting ON public.meeting_analytics USING btree (meeting_id);


--
-- Name: idx_meeting_bot_jobs_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_bot_jobs_meeting ON public.meeting_bot_jobs USING btree (meeting_id);


--
-- Name: idx_meeting_bot_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_bot_jobs_status ON public.meeting_bot_jobs USING btree (status);


--
-- Name: idx_meeting_bot_jobs_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_bot_jobs_workspace ON public.meeting_bot_jobs USING btree (workspace_id);


--
-- Name: idx_meeting_bot_logs_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_bot_logs_job ON public.meeting_bot_logs USING btree (job_id);


--
-- Name: idx_meeting_participants_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_participants_job ON public.meeting_participants USING btree (job_id);


--
-- Name: idx_meeting_participants_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_participants_meeting ON public.meeting_participants USING btree (meeting_id);


--
-- Name: idx_schema_fields_schema; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schema_fields_schema ON public.schema_fields USING btree (schema_id);


--
-- Name: idx_speaker_embeddings_speaker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_speaker_embeddings_speaker ON public.speaker_embeddings USING btree (speaker_id);


--
-- Name: idx_speaker_mappings_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_speaker_mappings_meeting ON public.speaker_mappings USING btree (meeting_id);


--
-- Name: idx_sync_items_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_items_run ON public.sync_items USING btree (sync_run_id);


--
-- Name: idx_sync_runs_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_runs_meeting ON public.sync_runs USING btree (meeting_id);


--
-- Name: idx_transcript_segments_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transcript_segments_meeting ON public.transcript_segments USING btree (meeting_id);


--
-- Name: call_extractions call_extractions_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_extractions
    ADD CONSTRAINT call_extractions_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: call_extractions call_extractions_schema_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_extractions
    ADD CONSTRAINT call_extractions_schema_id_fkey FOREIGN KEY (schema_id) REFERENCES public.extraction_schemas(id) ON DELETE SET NULL;


--
-- Name: company_memories company_memories_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_memories
    ADD CONSTRAINT company_memories_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: company_memories company_memories_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_memories
    ADD CONSTRAINT company_memories_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE SET NULL;


--
-- Name: crm_records crm_records_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_records
    ADD CONSTRAINT crm_records_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.integrations(id) ON DELETE CASCADE;


--
-- Name: crm_records crm_records_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_records
    ADD CONSTRAINT crm_records_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: destination_field_metadata destination_field_metadata_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destination_field_metadata
    ADD CONSTRAINT destination_field_metadata_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.integrations(id) ON DELETE CASCADE;


--
-- Name: extraction_profiles extraction_profiles_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extraction_profiles
    ADD CONSTRAINT extraction_profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: extraction_schemas extraction_schemas_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extraction_schemas
    ADD CONSTRAINT extraction_schemas_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: field_mappings field_mappings_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_mappings
    ADD CONSTRAINT field_mappings_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.integrations(id) ON DELETE CASCADE;


--
-- Name: field_mappings field_mappings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_mappings
    ADD CONSTRAINT field_mappings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: integration_credentials integration_credentials_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_credentials
    ADD CONSTRAINT integration_credentials_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.integrations(id) ON DELETE CASCADE;


--
-- Name: integrations integrations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: meeting_analytics meeting_analytics_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_analytics
    ADD CONSTRAINT meeting_analytics_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: meeting_bot_jobs meeting_bot_jobs_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_bot_jobs
    ADD CONSTRAINT meeting_bot_jobs_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE SET NULL;


--
-- Name: meeting_bot_jobs meeting_bot_jobs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_bot_jobs
    ADD CONSTRAINT meeting_bot_jobs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: meeting_bot_logs meeting_bot_logs_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_bot_logs
    ADD CONSTRAINT meeting_bot_logs_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.meeting_bot_jobs(id) ON DELETE CASCADE;


--
-- Name: meeting_participants meeting_participants_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_participants
    ADD CONSTRAINT meeting_participants_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.meeting_bot_jobs(id) ON DELETE CASCADE;


--
-- Name: meeting_participants meeting_participants_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_participants
    ADD CONSTRAINT meeting_participants_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: meeting_summaries meeting_summaries_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_summaries
    ADD CONSTRAINT meeting_summaries_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: meetings meetings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: objections objections_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objections
    ADD CONSTRAINT objections_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: risks risks_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risks
    ADD CONSTRAINT risks_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: schema_fields schema_fields_schema_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_fields
    ADD CONSTRAINT schema_fields_schema_id_fkey FOREIGN KEY (schema_id) REFERENCES public.extraction_schemas(id) ON DELETE CASCADE;


--
-- Name: speaker_embeddings speaker_embeddings_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaker_embeddings
    ADD CONSTRAINT speaker_embeddings_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE SET NULL;


--
-- Name: speaker_mappings speaker_mappings_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaker_mappings
    ADD CONSTRAINT speaker_mappings_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: speaker_mappings speaker_mappings_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaker_mappings
    ADD CONSTRAINT speaker_mappings_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.meeting_participants(id) ON DELETE CASCADE;


--
-- Name: speakers speakers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speakers
    ADD CONSTRAINT speakers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: speakers speakers_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speakers
    ADD CONSTRAINT speakers_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: sync_items sync_items_sync_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_items
    ADD CONSTRAINT sync_items_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.sync_runs(id) ON DELETE CASCADE;


--
-- Name: sync_logs sync_logs_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_logs
    ADD CONSTRAINT sync_logs_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: sync_runs sync_runs_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.integrations(id) ON DELETE SET NULL;


--
-- Name: sync_runs sync_runs_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: sync_runs sync_runs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: timeline_events timeline_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timeline_events
    ADD CONSTRAINT timeline_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: timeline_events timeline_events_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timeline_events
    ADD CONSTRAINT timeline_events_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE SET NULL;


--
-- Name: transcript_segments transcript_segments_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transcript_segments
    ADD CONSTRAINT transcript_segments_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict ENn3bnNcvmzbru5prhvgB1GtwCiLnBaX4QFvcnCgm152X3ZufG6msUzDYT1WhJZ


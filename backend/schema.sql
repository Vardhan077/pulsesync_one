-- PulseSync AI — Production Database Schema
-- Designed for PostgreSQL with pgvector voice-matching capabilities

-- Enable high-dimensional vector math
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Companies Table
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    website VARCHAR(255),
    industry VARCHAR(100),
    crm_account VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Meetings Table
CREATE TABLE IF NOT EXISTS meetings (
    id UUID PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'queued', -- queued, processing, completed, failed
    workflow_state VARCHAR(50) DEFAULT 'uploaded', -- uploaded, processing, transcript_review, speaker_review, company_review, template_selection, ai_compilation, review, destination_mapping, syncing, synced, failed
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    audio_url VARCHAR(512),
    duration_seconds INTEGER,
    capture_source VARCHAR(30) DEFAULT 'extension', -- extension, meeting_bot, upload
    capture_provider VARCHAR(40), -- google_meet, zoom
    meeting_url TEXT,
    bot_status VARCHAR(30), -- scheduled, joining, recording, uploaded, failed
    consent_status VARCHAR(30) DEFAULT 'unknown', -- unknown, pending, granted, denied
    ai_snapshot JSONB DEFAULT '{}',
    deal_intelligence JSONB DEFAULT '{}',
    risks JSONB DEFAULT '[]',
    objections JSONB DEFAULT '[]',
    action_items JSONB DEFAULT '[]',
    template_used VARCHAR(100),
    call_type VARCHAR(50) DEFAULT 'discovery',
    crm_company_id VARCHAR(100),
    crm_deal_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Speakers Table (Meeting-specific Speaker Profiles)
CREATE TABLE IF NOT EXISTS speakers (
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
    speaker_id UUID NOT NULL,
    name VARCHAR(120),
    role VARCHAR(100),
    department VARCHAR(100),
    job_title VARCHAR(100),
    email VARCHAR(255),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'Needs Review', -- Mapped, Needs Review, Missing
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (meeting_id, speaker_id)
);

-- 4. Speaker Voice Embeddings (pgvector store for system speaker learning)
CREATE TABLE IF NOT EXISTS speaker_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    speaker_id UUID NOT NULL,
    meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
    embedding vector(512) NOT NULL, -- Pyannote embedding vector size (512 dimensions)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Transcript Segments Table (Chronological Dialogue segments)
CREATE TABLE IF NOT EXISTS transcript_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
    speaker_id UUID,
    start_time NUMERIC(8,3) NOT NULL, -- timestamp segment start (seconds)
    end_time NUMERIC(8,3) NOT NULL, -- timestamp segment end (seconds)
    text TEXT NOT NULL,
    original_text TEXT,
    corrected_text TEXT,
    confidence NUMERIC(4,3),
    attribution_source VARCHAR(50) DEFAULT 'unknown',
    attribution_confidence NUMERIC(4,3) DEFAULT 0.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Meeting Summaries Table (AI Meeting Insights)
CREATE TABLE IF NOT EXISTS meeting_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
    overview TEXT NOT NULL,
    action_items JSONB, -- array of checkable tasks: [{"task": "Deploy Postgres", "assignee": "Speaker 3", "deadline": "2026-05-28"}]
    objections JSONB,   -- concerns raised
    decisions JSONB,    -- key decisions made
    topics JSONB,       -- topic segmentation timeline
    sentiment_trend JSONB, -- chronological sentiments
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Meeting Analytics Table (Talk-time and Interruption metrics)
CREATE TABLE IF NOT EXISTS meeting_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
    speaker_id UUID,
    talk_time_seconds INTEGER DEFAULT 0,
    interruption_count INTEGER DEFAULT 0,
    words_per_minute INTEGER DEFAULT 0,
    participation_percentage NUMERIC(5,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance optimization
CREATE INDEX IF NOT EXISTS idx_transcript_segments_meeting ON transcript_segments(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_analytics_meeting ON meeting_analytics(meeting_id);
CREATE INDEX IF NOT EXISTS idx_speaker_embeddings_speaker ON speaker_embeddings(speaker_id);

-- 8. Sync Logs Table
CREATE TABLE IF NOT EXISTS sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
    destination VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sync_logs_meeting ON sync_logs(meeting_id);

-- 9. Activity Logs Table
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. Timeline Events Table
CREATE TABLE IF NOT EXISTS timeline_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_timeline_events_company ON timeline_events(company_id);

-- 11. Company Memories Table
CREATE TABLE IF NOT EXISTS company_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    memory_type VARCHAR(50) NOT NULL,
    value TEXT NOT NULL,
    meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
    confidence INTEGER DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_company_memories_company ON company_memories(company_id);
CREATE INDEX IF NOT EXISTS idx_company_memories_meeting ON company_memories(meeting_id);

-- 12. Risks Table
CREATE TABLE IF NOT EXISTS risks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    risk TEXT NOT NULL,
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    mention_count INTEGER DEFAULT 1,
    evidence TEXT
);
CREATE INDEX IF NOT EXISTS idx_risks_company ON risks(company_id);

-- 13. Objections Table
CREATE TABLE IF NOT EXISTS objections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    objection TEXT NOT NULL,
    count INTEGER DEFAULT 1,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_objections_company ON objections(company_id);

-- ── Extraction Schema MVP Additions ──

-- 1. Workspaces Table
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Extraction Schemas (version-less MVP container)
CREATE TABLE IF NOT EXISTS extraction_schemas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Schema Fields Configuration
CREATE TABLE IF NOT EXISTS schema_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schema_id UUID REFERENCES extraction_schemas(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    label VARCHAR(255) NOT NULL,
    field_type VARCHAR(50) NOT NULL, -- string, number, currency, boolean, date, enum, textarea
    description TEXT,
    prompt_hint TEXT,
    is_required BOOLEAN DEFAULT FALSE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    options JSONB DEFAULT '[]', -- JSON array of strings for enum options
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(schema_id, name)
);

-- 4. Call Extractions Result Storage
CREATE TABLE IF NOT EXISTS call_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
    schema_id UUID REFERENCES extraction_schemas(id) ON DELETE SET NULL,
    extracted_data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(meeting_id)
);

-- Indexing for schema matching performance
CREATE INDEX IF NOT EXISTS idx_schema_fields_schema ON schema_fields(schema_id);
CREATE INDEX IF NOT EXISTS idx_call_extractions_meeting ON call_extractions(meeting_id);

-- Seeding Default MVP Workspace and Schema
INSERT INTO workspaces (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Workspace', 'default')
ON CONFLICT (id) DO NOTHING;

INSERT INTO extraction_schemas (id, workspace_id, is_active)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Default fields seeding
INSERT INTO schema_fields (schema_id, name, label, field_type, description, prompt_hint, is_required, sort_order)
VALUES 
('00000000-0000-0000-0000-000000000002', 'budget', 'Project Budget', 'currency', 'The custom budget discussed or allocated for this sync.', 'Look for monetary values, figures like $50k or fifty thousand.', TRUE, 0),
('00000000-0000-0000-0000-000000000002', 'timeline', 'Implementation Timeline', 'string', 'Expected delivery or rollout timeline for tasks.', 'Look for time intervals, dates, weeks, or quarters (Q3/Q4).', FALSE, 1),
('00000000-0000-0000-0000-000000000002', 'decision_maker', 'Decision Maker', 'string', 'Identify who has signing authority or executive signoff.', 'Look for names, titles, or designations like VP, CEO, or lead.', FALSE, 2)
ON CONFLICT (schema_id, name) DO NOTHING;

-- 5. Dynamic Extraction Profiles Table
CREATE TABLE IF NOT EXISTS extraction_profiles (
    id VARCHAR(100) PRIMARY KEY,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    summary_sections JSONB NOT NULL DEFAULT '[]',
    fields JSONB NOT NULL DEFAULT '[]',
    action_items_enabled BOOLEAN DEFAULT TRUE,
    risks_enabled BOOLEAN DEFAULT TRUE,
    objections_enabled BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_extraction_profiles_workspace ON extraction_profiles(workspace_id);

INSERT INTO extraction_profiles (id, workspace_id, name, description, summary_sections, fields, action_items_enabled, risks_enabled, objections_enabled, is_active)
VALUES (
    'default_sales_intelligence',
    '00000000-0000-0000-0000-000000000001',
    'PulseSync Default Sales Intelligence',
    'Extract customer requirements, pain points, deal intelligence, and actionable next steps from sales conversations.',
    '[
        {"id": "executive_summary", "name": "Executive Summary", "description": "Concise overview of the most important conversation outcomes and explicitly supported facts.", "max_words": 120, "enabled": true},
        {"id": "customer_needs", "name": "Customer Needs", "description": "What the customer explicitly needs from a solution or platform.", "max_words": 100, "enabled": true},
        {"id": "pain_points", "name": "Pain Points", "description": "Problems, frustrations, bottlenecks, or friction explicitly expressed by the customer.", "max_words": 100, "enabled": true},
        {"id": "requirements", "name": "Requirements", "description": "Specific business, functional, or technical requirements stated by the customer.", "max_words": 100, "enabled": true},
        {"id": "risks_objections", "name": "Risks / Objections", "description": "Concerns, roadblocks, or objections raised during the conversation.", "max_words": 100, "enabled": true},
        {"id": "action_items", "name": "Action Items", "description": "Explicitly agreed follow-ups, deliverables, and commitments.", "max_words": 80, "enabled": true},
        {"id": "next_steps", "name": "Next Steps", "description": "Next scheduled meetings, milestones, or immediate next steps.", "max_words": 80, "enabled": true}
    ]'::jsonb,
    '[
        {"id": "call_stage", "name": "Call Stage", "type": "enum", "description": "Current stage of the commercial or evaluation cycle.", "evidence_required": true, "enabled": true, "options": ["Cold / Prospecting", "Qualification", "Discovery", "Solution Demo", "Technical Validation", "Negotiation", "Follow-up", "Renewal / Expansion", "Other"]},
        {"id": "budget", "name": "Budget", "type": "currency", "description": "Explicit budget or monetary amount stated by the customer.", "evidence_required": true, "enabled": true},
        {"id": "timeline", "name": "Implementation Timeline", "type": "text", "description": "Explicit implementation deadline, target timeframe, or target date.", "evidence_required": true, "enabled": true},
        {"id": "economic_buyer", "name": "Economic Buyer", "type": "person", "description": "Person with explicit authority to allocate budget or sign off on purchase.", "evidence_required": true, "enabled": true},
        {"id": "champion", "name": "Champion", "type": "person", "description": "Internal stakeholder actively advocating, driving, or selling internally on our behalf.", "evidence_required": true, "enabled": true},
        {"id": "decision_criteria", "name": "Decision Criteria", "type": "text", "description": "Technical, functional, or commercial criteria required for selection.", "evidence_required": true, "enabled": true},
        {"id": "decision_process", "name": "Decision Process", "type": "text", "description": "Formal stages, milestones, or approvals required to reach a decision.", "evidence_required": true, "enabled": true},
        {"id": "pain_points", "name": "Pain Points", "type": "text", "description": "Core business, technical, or operational bottlenecks explicitly stated.", "evidence_required": true, "enabled": true},
        {"id": "competition", "name": "Competition", "type": "text", "description": "External competitors or alternative solutions explicitly mentioned.", "evidence_required": true, "enabled": true}
    ]'::jsonb,
    TRUE, TRUE, TRUE, TRUE
) ON CONFLICT (id) DO NOTHING;

-- ── CRM Integrations & Sync Engine Infrastructure ──

-- 1. Integrations Table (Workspace-scoped CRM connections)
CREATE TABLE IF NOT EXISTS integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- hubspot, salesforce, pipedrive, webhook
    name VARCHAR(255) NOT NULL,
    connection_status VARCHAR(50) DEFAULT 'not_connected', -- not_connected, connecting, connected, auth_expired, error, disconnected
    status VARCHAR(50) DEFAULT 'Disconnected', -- compatibility field; connection_status is authoritative
    auth_metadata JSONB DEFAULT '{}', -- account_name, portal_id, user_email, token_scope
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_connected_at TIMESTAMP WITH TIME ZONE,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(workspace_id, provider)
);

-- 2. Integration Credentials (Encrypted Token Storage)
CREATE TABLE IF NOT EXISTS integration_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID REFERENCES integrations(id) ON DELETE CASCADE UNIQUE,
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    iv VARCHAR(64) NOT NULL,
    auth_tag VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Destination Field Metadata (Discovered properties from CRM)
CREATE TABLE IF NOT EXISTS destination_field_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID REFERENCES integrations(id) ON DELETE CASCADE,
    object_type VARCHAR(50) NOT NULL, -- company, contact, deal
    field_name VARCHAR(100) NOT NULL,
    field_label VARCHAR(255) NOT NULL,
    field_type VARCHAR(50) NOT NULL, -- string, number, currency, date, enum, textarea
    is_custom BOOLEAN DEFAULT FALSE,
    options JSONB DEFAULT '[]',
    cached_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(integration_id, object_type, field_name)
);

-- 4. Field Mappings (PulseSync field -> CRM Destination field)
CREATE TABLE IF NOT EXISTS field_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    integration_id UUID REFERENCES integrations(id) ON DELETE CASCADE,
    playbook_field_name VARCHAR(100) NOT NULL,
    destination_object VARCHAR(50) NOT NULL, -- company, contact, deal
    destination_field_name VARCHAR(100) NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(workspace_id, integration_id, playbook_field_name)
);

-- 5. Stored CRM Record IDs (For Idempotency & Deduplication)
CREATE TABLE IF NOT EXISTS crm_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    integration_id UUID REFERENCES integrations(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL, -- company, contact, deal
    pulsesync_entity_id UUID NOT NULL, -- company_id, speaker_id, or meeting_id
    crm_record_id VARCHAR(100) NOT NULL,
    crm_record_url VARCHAR(512),
    metadata JSONB DEFAULT '{}',
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(workspace_id, integration_id, entity_type, pulsesync_entity_id)
);

-- 6. Sync Runs (Persistent Audit Log for each Sync Execution)
CREATE TABLE IF NOT EXISTS sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
    integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL,
    provider VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL, -- pending, running, succeeded, partially_succeeded, failed, cancelled
    destination_record_ids JSONB DEFAULT '{}', -- { companyId, contactId, dealId, engagementId }
    user_id UUID,
    error_message TEXT,
    idempotency_key VARCHAR(128) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- 7. Sync Items (Detailed Field-by-Field Audit Records)
CREATE TABLE IF NOT EXISTS sync_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_run_id UUID REFERENCES sync_runs(id) ON DELETE CASCADE,
    destination_object VARCHAR(50) NOT NULL, -- company, contact, deal, activity
    destination_field VARCHAR(100) NOT NULL,
    previous_value TEXT,
    new_value TEXT,
    status VARCHAR(50) NOT NULL, -- created, updated, unchanged, skipped, failed
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for CRM performance
CREATE INDEX IF NOT EXISTS idx_crm_records_lookup ON crm_records(workspace_id, integration_id, entity_type, pulsesync_entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_meeting ON sync_runs(meeting_id);
CREATE INDEX IF NOT EXISTS idx_sync_items_run ON sync_items(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_integrations_workspace ON integrations(workspace_id);

-- ── Multi-Platform Meeting Bot Infrastructure ──

-- 1. Meeting Bot Jobs Table
CREATE TABLE IF NOT EXISTS meeting_bot_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
    provider VARCHAR(50) NOT NULL, -- google_meet, zoom, microsoft_teams
    mode VARCHAR(30) DEFAULT 'realtime', -- realtime, post_meeting_artifact
    meeting_url TEXT NOT NULL,
    external_meeting_id VARCHAR(255),
    meeting_title VARCHAR(255) NOT NULL,
    scheduled_start TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    scheduled_end TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'SCHEDULED',
    consent_state VARCHAR(30) DEFAULT 'granted', -- not_granted, granted, required, expired, rejected
    consent_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255) DEFAULT 'User',
    bot_participant_name VARCHAR(255) DEFAULT 'PulseSync Meeting Assistant',
    provider_metadata JSONB DEFAULT '{}',
    join_attempts INTEGER DEFAULT 0,
    joined_at TIMESTAMP WITH TIME ZONE,
    left_at TIMESTAMP WITH TIME ZONE,
    meeting_started_at TIMESTAMP WITH TIME ZONE,
    meeting_ended_at TIMESTAMP WITH TIME ZONE,
    media_started_at TIMESTAMP WITH TIME ZONE,
    media_ended_at TIMESTAMP WITH TIME ZONE,
    transcript_status VARCHAR(50) DEFAULT 'pending',
    attribution_status VARCHAR(50) DEFAULT 'pending',
    diarization_status VARCHAR(50) DEFAULT 'pending',
    extraction_status VARCHAR(50) DEFAULT 'pending',
    participant_count INTEGER DEFAULT 0,
    processing_job_id VARCHAR(255),
    error_code VARCHAR(100),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Meeting Bot Activity Logs Table (Chronological observability)
CREATE TABLE IF NOT EXISTS meeting_bot_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES meeting_bot_jobs(id) ON DELETE CASCADE,
    stage VARCHAR(50) NOT NULL,
    level VARCHAR(20) DEFAULT 'info', -- info, warn, error
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for Meeting Bot performance
CREATE INDEX IF NOT EXISTS idx_meeting_bot_jobs_workspace ON meeting_bot_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meeting_bot_jobs_status ON meeting_bot_jobs(status);
CREATE INDEX IF NOT EXISTS idx_meeting_bot_jobs_meeting ON meeting_bot_jobs(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_bot_logs_job ON meeting_bot_logs(job_id);

-- 3. Meeting Participants Table (Normalized cross-platform participant identities)
CREATE TABLE IF NOT EXISTS meeting_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
    job_id UUID REFERENCES meeting_bot_jobs(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL, -- google_meet, zoom, microsoft_teams, generic
    platform_participant_id VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    role VARCHAR(50) DEFAULT 'unknown', -- sales_rep, buyer, prospect, customer, manager, unknown, bot
    organization VARCHAR(255),
    is_host BOOLEAN DEFAULT FALSE,
    is_bot BOOLEAN DEFAULT FALSE,
    identity_source VARCHAR(50) DEFAULT 'platform_native', -- platform_native, platform_transcript, platform_metadata, manual
    identity_confidence NUMERIC(4,3) DEFAULT 1.0,
    crm_contact_id VARCHAR(100),
    crm_account_id VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Speaker Mappings Table (Tracks provenance of speaker identity to participants)
CREATE TABLE IF NOT EXISTS speaker_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
    speaker_id VARCHAR(100) NOT NULL,
    participant_id UUID REFERENCES meeting_participants(id) ON DELETE CASCADE,
    display_name VARCHAR(255),
    source VARCHAR(50) NOT NULL, -- google_meet_csrc, zoom_user_id, teams_participant, platform_transcript, pyannote, manual
    confidence NUMERIC(4,3) DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(meeting_id, speaker_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting ON meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_job ON meeting_participants(job_id);
CREATE INDEX IF NOT EXISTS idx_speaker_mappings_meeting ON speaker_mappings(meeting_id);




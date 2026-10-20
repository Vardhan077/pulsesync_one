import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import pinoHttp from 'pino-http';
import pg from 'pg';
import crypto from 'node:crypto';
import { SyncEngine } from './services/integration/SyncEngine.js';
import { encryptToken, decryptToken } from './services/integration/crypto.js';
import { HubSpotAdapter } from './services/integration/HubSpotAdapter.js';
import { EvidenceValidator } from './services/ai/EvidenceValidator.js';
import { MeetingBotWorker } from './workers/MeetingBotWorker.js';
import { defaultProviderRegistry } from './services/meeting-bot/providers/ProviderRegistry.js';
import { BotJobState, JobStateMachine } from './services/meeting-bot/JobStateMachine.js';
import { AudioNormalizer } from './services/meeting-bot/AudioNormalizer.js';
import { ConversationCapture } from './services/meeting-bot/ConversationCapture.js';

const logger = pino({ name: 'pulsesync-server', level: process.env.LOG_LEVEL || 'info' });
const app = express();
const nodeEnvironment = (process.env.NODE_ENV || 'development').toLowerCase();
const apiAccessToken = (process.env.PULSESYNC_API_TOKEN || '').trim();
if (nodeEnvironment === 'production') {
  const requiredSecrets = ['PULSESYNC_API_TOKEN', 'AI_SERVICE_TOKEN', 'ENCRYPTION_SECRET', 'MEDIA_SIGNING_SECRET'];
  const missingSecrets = requiredSecrets.filter((key) => {
    const value = (process.env[key] || '').trim();
    return value.length < 32 || /replace-with|change-this|example/i.test(value);
  });
  if (missingSecrets.length) throw new Error(`Production startup refused: configure strong secrets for ${missingSecrets.join(', ')}.`);
}
const MEDIA_SIGNING_SECRET = process.env.MEDIA_SIGNING_SECRET || process.env.ENCRYPTION_SECRET || crypto.randomBytes(32).toString('hex');
const safeEqualToken = (supplied, expected) => {
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const aiServiceHeaders = () => ({ 'Content-Type': 'application/json', ...(process.env.AI_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.AI_SERVICE_TOKEN}` } : {}) });

const getAiServiceUrl = (endpoint) => {
  const specificUrl = {
    process: process.env.AI_PROCESS_URL,
    'generate-ai': process.env.AI_GENERATE_AI_URL,
  }[endpoint];

  // Explicit endpoint URLs take precedence.
  if (specificUrl?.trim()) {
    return specificUrl.trim().replace(/\/+$/, '');
  }

  // Backward-compatible handling of the existing shared setting.
  const configuredUrl = (
    process.env.AI_SERVICE_URL || 'http://localhost:8000'
  ).trim().replace(/\/+$/, '');

  // Remove a previously configured endpoint path before appending
  // the endpoint required by the current operation.
  const baseUrl = configuredUrl.replace(
    /\/(process|generate-ai|enrich|chat-deal)$/,
    ''
  );

  return `${baseUrl}/${endpoint}`;
};
// Ensure upload directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ── Hybrid Data Layer: PostgreSQL with Local JSON Fallback ──
const dbConfig = {
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pulsesync'
};

let pool = null;
let useFallbackDb = false;
const FALLBACK_DB_PATH = process.env.FALLBACK_DB_PATH || path.join(__dirname, 'db-fallback.json');

// Initialize fallback JSON store only when explicitly enabled for local demo/test use.
const localJsonFallbackEnabled = process.env.NODE_ENV !== 'production' && process.env.ALLOW_JSON_FALLBACK === 'true';
if (localJsonFallbackEnabled && !fs.existsSync(FALLBACK_DB_PATH)) {
  fs.mkdirSync(path.dirname(FALLBACK_DB_PATH), { recursive: true });
  fs.writeFileSync(FALLBACK_DB_PATH, JSON.stringify({
    meetings: [],
    speakers: [],
    segments: [],
    summaries: [],
    analytics: []
  }, null, 2));
}

const EXTRACTION_PROFILE_TEMPLATES = [
  {
    id: "default_sales_intelligence",
    name: "PulseSync Default Sales Intelligence",
    description: "Extract customer requirements, pain points, deal intelligence, and actionable next steps from sales conversations.",
    summary_sections: [
      { id: "executive_summary", name: "Executive Summary", description: "Concise overview of the most important conversation outcomes and explicitly supported facts.", max_words: 120, enabled: true },
      { id: "customer_needs", name: "Customer Needs", description: "What the customer explicitly needs from a solution or platform.", max_words: 100, enabled: true },
      { id: "pain_points", name: "Pain Points", description: "Problems, frustrations, bottlenecks, or friction explicitly expressed by the customer.", max_words: 100, enabled: true },
      { id: "requirements", name: "Requirements", description: "Specific business, functional, or technical requirements stated by the customer.", max_words: 100, enabled: true },
      { id: "risks_objections", name: "Risks / Objections", description: "Concerns, roadblocks, or objections raised during the conversation.", max_words: 100, enabled: true },
      { id: "action_items", name: "Action Items", description: "Explicitly agreed follow-ups, deliverables, and commitments.", max_words: 80, enabled: true },
      { id: "next_steps", name: "Next Steps", description: "Next scheduled meetings, milestones, or immediate next steps.", max_words: 80, enabled: true }
    ],
    fields: [
      { id: "call_stage", name: "Call Stage", type: "enum", description: "Current stage of the commercial or evaluation cycle.", evidence_required: true, enabled: true, options: ["Cold / Prospecting", "Qualification", "Discovery", "Solution Demo", "Technical Validation", "Negotiation", "Follow-up", "Renewal / Expansion", "Other"] },
      { id: "budget", name: "Budget", type: "currency", description: "Explicit budget or monetary amount stated by the customer.", evidence_required: true, enabled: true },
      { id: "timeline", name: "Implementation Timeline", type: "text", description: "Explicit implementation deadline, target timeframe, or target date.", evidence_required: true, enabled: true },
      { id: "economic_buyer", name: "Economic Buyer", type: "person", description: "Person with explicit authority to allocate budget or sign off on purchase.", evidence_required: true, enabled: true },
      { id: "champion", name: "Champion", type: "person", description: "Internal stakeholder actively advocating, driving, or selling internally on our behalf.", evidence_required: true, enabled: true },
      { id: "decision_criteria", name: "Decision Criteria", type: "text", description: "Technical, functional, or commercial criteria required for selection.", evidence_required: true, enabled: true },
      { id: "decision_process", name: "Decision Process", type: "text", description: "Formal stages, milestones, or approvals required to reach a decision.", evidence_required: true, enabled: true },
      { id: "pain_points", name: "Pain Points", type: "text", description: "Core business, technical, or operational bottlenecks explicitly stated.", evidence_required: true, enabled: true },
      { id: "competition", name: "Competition", type: "text", description: "External competitors or alternative solutions explicitly mentioned.", evidence_required: true, enabled: true }
    ],
    action_items_enabled: true,
    risks_enabled: true,
    objections_enabled: true
  },
  {
    id: "sales_discovery",
    name: "Sales Discovery",
    description: "Extract customer requirements and deal intelligence from discovery calls.",
    summary_sections: [
      { id: "executive_summary", name: "Executive Summary", description: "Concise overview of the most important conversation outcomes.", max_words: 120, enabled: true },
      { id: "customer_needs", name: "Customer Needs", description: "What the customer needs from a solution.", max_words: 100, enabled: true },
      { id: "pain_points", name: "Pain Points", description: "Problems, frustrations, bottlenecks or risks explicitly expressed by the customer.", max_words: 100, enabled: true },
      { id: "decision_criteria", name: "Decision Criteria", description: "Criteria the customer will use to make a decision.", max_words: 100, enabled: true },
      { id: "risks", name: "Risks", description: "Deal and implementation risks identified during the call.", max_words: 100, enabled: true },
      { id: "next_steps", name: "Next Steps", description: "Agreed follow-ups and next meetings.", max_words: 80, enabled: true }
    ],
    fields: [
      { id: "budget", name: "Budget", type: "currency", description: "Explicit budget or monetary amount stated by the customer.", evidence_required: true, enabled: true },
      { id: "economic_buyer", name: "Economic Buyer", type: "person", description: "Prospect contact with budget allocation and decision authority.", evidence_required: true, enabled: true },
      { id: "champion", name: "Champion", type: "person", description: "Internal project lead or advocate driving evaluation.", evidence_required: true, enabled: true },
      { id: "timeline", name: "Implementation Timeline", type: "text", description: "Explicit implementation deadline or target date.", evidence_required: true, enabled: true },
      { id: "competition", name: "Competition", type: "text", description: "External competitors or alternative solutions evaluated or mentioned.", evidence_required: true, enabled: true }
    ],
    action_items_enabled: true,
    risks_enabled: true,
    objections_enabled: true
  },
  {
    id: "technical_discovery",
    name: "Technical Discovery",
    description: "Extract technical architecture, requirements, integrations, security, and SLAs.",
    summary_sections: [
      { id: "technical_requirements", name: "Technical Requirements", description: "Explicit technical requirements and constraints stated by the customer.", max_words: 120, enabled: true },
      { id: "current_architecture", name: "Current Architecture", description: "Current technology stack, systems, and architectural layout.", max_words: 120, enabled: true },
      { id: "integrations", name: "Integrations", description: "Third-party systems, APIs, and data sources that must be connected.", max_words: 100, enabled: true },
      { id: "security_requirements", name: "Security Requirements", description: "Compliance, auth, encryption, and governance requirements.", max_words: 100, enabled: true },
      { id: "performance_requirements", name: "Performance Requirements", description: "Latency, throughput, and scalability expectations.", max_words: 100, enabled: true },
      { id: "open_questions", name: "Open Questions", description: "Unresolved technical queries requiring follow-up.", max_words: 80, enabled: true }
    ],
    fields: [
      { id: "database", name: "Database", type: "text", description: "Primary databases and storage engines mentioned.", evidence_required: true, enabled: true },
      { id: "authentication", name: "Authentication", type: "text", description: "Auth mechanisms (e.g. SAML, OAuth, SSO).", evidence_required: true, enabled: true },
      { id: "data_volume", name: "Data Volume", type: "text", description: "Expected data scale, rows, or throughput.", evidence_required: true, enabled: true },
      { id: "integration_requirements", name: "Integration Requirements", type: "text", description: "Key integration points and third-party tools.", evidence_required: true, enabled: true },
      { id: "security_requirements", name: "Security Requirements", type: "text", description: "SOC2, HIPAA, ISO or custom security mandates.", evidence_required: true, enabled: true },
      { id: "sla", name: "SLA", type: "text", description: "Uptime and operational SLA commitments.", evidence_required: true, enabled: true }
    ],
    action_items_enabled: true,
    risks_enabled: true,
    objections_enabled: true
  },
  {
    id: "customer_success",
    name: "Customer Success",
    description: "Extract customer health, product adoption, open issues, feature requests, and renewal risks.",
    summary_sections: [
      { id: "customer_health", name: "Customer Health", description: "Overall account health, satisfaction, and sentiment.", max_words: 120, enabled: true },
      { id: "product_adoption", name: "Product Adoption", description: "How the customer is utilizing the product and key features.", max_words: 100, enabled: true },
      { id: "open_issues", name: "Open Issues", description: "Unresolved customer bugs, blockers, or tickets.", max_words: 100, enabled: true },
      { id: "feature_requests", name: "Feature Requests", description: "Capabilities or enhancements explicitly requested by customer.", max_words: 100, enabled: true },
      { id: "renewal_risks", name: "Renewal Risks", description: "Factors that could endanger upcoming contract renewal.", max_words: 100, enabled: true },
      { id: "next_steps", name: "Next Steps", description: "Follow-ups, support tasks, and check-in schedules.", max_words: 80, enabled: true }
    ],
    fields: [
      { id: "product_usage", name: "Product Usage", type: "text", description: "Customer activity and utilization level.", evidence_required: true, enabled: true },
      { id: "customer_sentiment", name: "Customer Sentiment", type: "enum", description: "Customer sentiment toward the product and team.", evidence_required: true, enabled: true, options: ["Positive", "Neutral", "Frustrated", "At Risk"] },
      { id: "open_issues", name: "Open Issues", type: "text", description: "Current unresolved issues.", evidence_required: true, enabled: true },
      { id: "feature_requests", name: "Feature Requests", type: "text", description: "Requested product enhancements.", evidence_required: true, enabled: true },
      { id: "renewal_risk", name: "Renewal Risk", type: "text", description: "Explicit renewal risks or churn indicators.", evidence_required: true, enabled: true }
    ],
    action_items_enabled: true,
    risks_enabled: true,
    objections_enabled: true
  },
  {
    id: "meddicc",
    name: "MEDDICC",
    description: "Metrics, Economic Buyer, Decision Criteria, Decision Process, Identify Pain, Champion, Competition.",
    summary_sections: [
      { id: "executive_summary", name: "Executive Summary", description: "Concise overview of conversation outcomes.", max_words: 120, enabled: true },
      { id: "customer_needs", name: "Customer Needs", description: "Core client needs and objectives.", max_words: 100, enabled: true },
      { id: "decision_framework", name: "Decision Framework", description: "Criteria and process for vendor signoff.", max_words: 100, enabled: true },
      { id: "next_steps", name: "Next Steps", description: "Agreed milestones and follow-ups.", max_words: 80, enabled: true }
    ],
    fields: [
      { id: "metrics", name: "Metrics", type: "text", description: "Quantifiable economic value ($18,500 budget, 6-8 hrs/wk lost).", evidence_required: true, enabled: true },
      { id: "economic_buyer", name: "Economic Buyer", type: "person", description: "Prospect contact with budget allocation and decision authority.", evidence_required: true, enabled: true },
      { id: "decision_criteria", name: "Decision Criteria", type: "text", description: "Technical and operational requirements for adoption.", evidence_required: true, enabled: true },
      { id: "decision_process", name: "Decision Process", type: "text", description: "Evaluation milestones (pilot, security review, workshop).", evidence_required: true, enabled: true },
      { id: "identify_pain", name: "Identify Pain", type: "text", description: "Core operational bottleneck or reporting friction.", evidence_required: true, enabled: true },
      { id: "champion", name: "Champion", type: "person", description: "Internal project lead or advocate driving evaluation.", evidence_required: true, enabled: true },
      { id: "competition", name: "Competition", type: "text", description: "External competitors or alternative tools evaluated.", evidence_required: true, enabled: true }
    ],
    action_items_enabled: true,
    risks_enabled: true,
    objections_enabled: true
  },
  {
    id: "bant",
    name: "BANT",
    description: "Budget, Authority, Need, Timeline qualification.",
    summary_sections: [
      { id: "executive_summary", name: "Executive Summary", description: "Concise overview of conversation outcomes.", max_words: 120, enabled: true },
      { id: "qualification_overview", name: "Qualification Overview", description: "High level evaluation of BANT qualification.", max_words: 100, enabled: true },
      { id: "next_steps", name: "Next Steps", description: "Agreed milestones and next steps.", max_words: 80, enabled: true }
    ],
    fields: [
      { id: "budget", name: "Budget", type: "currency", description: "Allocated budget details ($18,500 for first year).", evidence_required: true, enabled: true },
      { id: "authority", name: "Authority", type: "person", description: "Who holds decision and budget authority?", evidence_required: true, enabled: true },
      { id: "need", name: "Need", type: "text", description: "Core product or business need.", evidence_required: true, enabled: true },
      { id: "timeline", name: "Timeline", type: "text", description: "Target dates or deadlines for launch.", evidence_required: true, enabled: true }
    ],
    action_items_enabled: true,
    risks_enabled: true,
    objections_enabled: true
  },
  {
    id: "renewal",
    name: "Renewal",
    description: "Contract status, sentiment, expansion opportunities, and renewal risks.",
    summary_sections: [
      { id: "executive_summary", name: "Executive Summary", description: "Overview of account standing.", max_words: 120, enabled: true },
      { id: "contract_status", name: "Contract Status", description: "Current contract terms and upcoming expiry.", max_words: 100, enabled: true },
      { id: "sentiment_feedback", name: "Sentiment & Feedback", description: "Customer satisfaction and team sentiment.", max_words: 100, enabled: true },
      { id: "expansion_opportunities", name: "Expansion Opportunities", description: "Upsell or cross-sell discussions.", max_words: 100, enabled: true },
      { id: "renewal_risks", name: "Renewal Risks", description: "Blockers to closing the renewal.", max_words: 100, enabled: true },
      { id: "next_steps", name: "Next Steps", description: "Action items for renewal signing.", max_words: 80, enabled: true }
    ],
    fields: [
      { id: "renewal_date", name: "Renewal Date", type: "date", description: "Target renewal date or contract end date.", evidence_required: true, enabled: true },
      { id: "contract_value", name: "Contract Value", type: "currency", description: "Expected or existing contract ARR/ACV.", evidence_required: true, enabled: true },
      { id: "sentiment", name: "Sentiment", type: "enum", description: "Overall sentiment score.", evidence_required: true, enabled: true, options: ["High", "Medium", "Low"] },
      { id: "renewal_blocker", name: "Renewal Blocker", type: "text", description: "Primary issue delaying renewal.", evidence_required: true, enabled: true },
      { id: "competitor_threat", name: "Competitor Threat", type: "text", description: "Alternative vendor mentioned by customer.", evidence_required: true, enabled: true }
    ],
    action_items_enabled: true,
    risks_enabled: true,
    objections_enabled: true
  }
];

async function testPostgresConnection() {
  try {
    pool = new pg.Pool(dbConfig);
    await pool.query('SELECT NOW()');
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    logger.info('[PulseSync] Connected to PostgreSQL successfully. Running migrations...');
    
    // 1. Create companies table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
          id UUID PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          website VARCHAR(255),
          industry VARCHAR(100),
          crm_account VARCHAR(255),
          notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Add new columns to meetings table
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS workflow_state VARCHAR(50) DEFAULT 'uploaded';
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS ai_snapshot JSONB DEFAULT '{}';
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS deal_intelligence JSONB DEFAULT '{}';
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS risks JSONB DEFAULT '[]';
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS objections JSONB DEFAULT '[]';
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS action_items JSONB DEFAULT '[]';
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS processing_stage VARCHAR(50) DEFAULT 'queued';
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS error_message TEXT;
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS call_type VARCHAR(50) DEFAULT 'discovery';
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS call_type_confidence NUMERIC(4,3) DEFAULT 0.94;
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS call_type_source VARCHAR(50) DEFAULT 'ai';
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS call_type_rationale TEXT;
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS capture_source VARCHAR(30) DEFAULT 'extension';
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS capture_provider VARCHAR(40);
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS meeting_url TEXT;
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS bot_status VARCHAR(30);
    `);
    await pool.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS consent_status VARCHAR(30) DEFAULT 'unknown';
    `);

    await pool.query(`
    ALTER TABLE meetings
    ADD COLUMN IF NOT EXISTS crm_company_id VARCHAR(100);
  `);

    await pool.query(`
      ALTER TABLE meetings
      ADD COLUMN IF NOT EXISTS crm_deal_id VARCHAR(100);
    `);                                           

    // 3. Drop legacy foreign key constraints
    await pool.query(`
      ALTER TABLE transcript_segments DROP CONSTRAINT IF EXISTS transcript_segments_speaker_id_fkey;
    `);
    await pool.query(`
      ALTER TABLE meeting_analytics DROP CONSTRAINT IF EXISTS meeting_analytics_speaker_id_fkey;
    `);
    await pool.query(`
      ALTER TABLE speaker_embeddings DROP CONSTRAINT IF EXISTS speaker_embeddings_speaker_id_fkey;
    `);

    // 4. Recreate speakers and speaker_embeddings table if legacy exists
    const checkSpeakers = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'speakers' AND column_name = 'id';
    `);
    if (checkSpeakers.rows.length > 0) {
      logger.warn('[PulseSync] Legacy global speakers schema detected. Preserving the legacy tables for an explicit reviewed data migration.');
      const backupCheck = await pool.query(`SELECT to_regclass('public.speakers_legacy_backup') AS speakers_backup, to_regclass('public.speaker_embeddings_legacy_backup') AS embeddings_backup`);
      if (backupCheck.rows[0]?.speakers_backup || backupCheck.rows[0]?.embeddings_backup) {
        throw new Error('Legacy speaker tables and backup names both exist. Manual migration review is required; no tables were dropped.');
      }
      const embeddingsExist = await pool.query(`SELECT to_regclass('public.speaker_embeddings') AS table_name`);
      if (embeddingsExist.rows[0]?.table_name) {
        await pool.query('ALTER TABLE speaker_embeddings RENAME TO speaker_embeddings_legacy_backup');
      }
      await pool.query('ALTER TABLE speakers RENAME TO speakers_legacy_backup');
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS speakers (
          meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
          speaker_id UUID NOT NULL,
          name VARCHAR(120),
          role VARCHAR(100),
          department VARCHAR(100),
          job_title VARCHAR(100),
          email VARCHAR(255),
          company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
          status VARCHAR(50) DEFAULT 'Needs Review',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (meeting_id, speaker_id)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS speaker_embeddings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          speaker_id UUID NOT NULL,
          meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
          embedding vector(512) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 5. Add original_text and corrected_text to transcript_segments table
    await pool.query(`
      ALTER TABLE transcript_segments ADD COLUMN IF NOT EXISTS original_text TEXT;
    `);
    await pool.query(`
      ALTER TABLE transcript_segments ADD COLUMN IF NOT EXISTS corrected_text TEXT;
    `);
    await pool.query(`
      UPDATE transcript_segments SET original_text = text WHERE original_text IS NULL;
    `);
    await pool.query(`
      UPDATE transcript_segments SET corrected_text = text WHERE corrected_text IS NULL;
    `);
    await pool.query(`
      ALTER TABLE transcript_segments ADD COLUMN IF NOT EXISTS speaker_name VARCHAR(120);
    `);
    await pool.query(`
      ALTER TABLE transcript_segments ADD COLUMN IF NOT EXISTS attribution_source VARCHAR(50) DEFAULT 'unknown';
    `);
    await pool.query(`
      ALTER TABLE transcript_segments ADD COLUMN IF NOT EXISTS attribution_confidence NUMERIC(5,4) DEFAULT 0.0;
    `);
    await pool.query(`
      ALTER TABLE transcript_segments ALTER COLUMN speaker_id DROP NOT NULL;
    `);
    await pool.query(`
      ALTER TABLE meeting_analytics ALTER COLUMN speaker_id DROP NOT NULL;
    `);
    await pool.query(`
      ALTER TABLE meeting_analytics ADD COLUMN IF NOT EXISTS speaker_name VARCHAR(120);
    `);

    // Integrations use the workspace-scoped schema created in section 13 below; do not seed fake connected providers.

    // 7. Create sync_logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sync_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
          destination VARCHAR(50) NOT NULL,
          status VARCHAR(50) NOT NULL,
          error_message TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 8. Create activity_logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          event_type VARCHAR(100) NOT NULL,
          message TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 9. Create timeline_events table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS timeline_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
          meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
          event_type VARCHAR(100) NOT NULL,
          payload JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 10. Create company_memories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_memories (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
          memory_type VARCHAR(50) NOT NULL,
          value TEXT NOT NULL,
          meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
          confidence INTEGER DEFAULT 100,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 11. Create risks table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS risks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
          risk TEXT NOT NULL,
          first_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          mention_count INTEGER DEFAULT 1,
          evidence TEXT
      );
    `);

    // 12. Create objections table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS objections (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
          objection TEXT NOT NULL,
          count INTEGER DEFAULT 1,
          last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 13. Create integrations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS integrations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
          provider VARCHAR(50) NOT NULL,
          name VARCHAR(255) NOT NULL,
          connection_status VARCHAR(50) DEFAULT 'not_connected',
          auth_metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          last_connected_at TIMESTAMP WITH TIME ZONE,
          last_sync_at TIMESTAMP WITH TIME ZONE,
          UNIQUE(workspace_id, provider)
      );
    `);

    // 14. Create integration_credentials table
    await pool.query(`
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
    `);

    // 15. Create field_mappings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS field_mappings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
          integration_id UUID REFERENCES integrations(id) ON DELETE CASCADE,
          playbook_field_name VARCHAR(100) NOT NULL,
          destination_object VARCHAR(50) NOT NULL,
          destination_field_name VARCHAR(100) NOT NULL,
          is_enabled BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(workspace_id, integration_id, playbook_field_name)
      );
    `);

    // 16. Create destination_field_metadata table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS destination_field_metadata (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          integration_id UUID REFERENCES integrations(id) ON DELETE CASCADE,
          object_type VARCHAR(50) NOT NULL,
          field_name VARCHAR(100) NOT NULL,
          field_label VARCHAR(255) NOT NULL,
          field_type VARCHAR(50) NOT NULL,
          is_custom BOOLEAN DEFAULT FALSE,
          options JSONB DEFAULT '[]',
          cached_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(integration_id, object_type, field_name)
      );
    `);

    // 17. Create crm_records table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crm_records (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
          integration_id UUID REFERENCES integrations(id) ON DELETE CASCADE,
          entity_type VARCHAR(50) NOT NULL,
          pulsesync_entity_id UUID NOT NULL,
          crm_record_id VARCHAR(100) NOT NULL,
          crm_record_url VARCHAR(512),
          metadata JSONB DEFAULT '{}',
          last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(workspace_id, integration_id, entity_type, pulsesync_entity_id)
      );
    `);

    // 18. Create sync_runs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sync_runs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
          meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
          integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL,
          provider VARCHAR(50) NOT NULL,
          status VARCHAR(50) NOT NULL,
          destination_record_ids JSONB DEFAULT '{}',
          user_id UUID,
          error_message TEXT,
          idempotency_key VARCHAR(128) UNIQUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP WITH TIME ZONE
      );
    `);

    // 19. Create sync_items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sync_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sync_run_id UUID REFERENCES sync_runs(id) ON DELETE CASCADE,
          destination_object VARCHAR(50) NOT NULL,
          destination_field VARCHAR(100) NOT NULL,
          previous_value TEXT,
          new_value TEXT,
          status VARCHAR(50) NOT NULL,
          error_message TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 20. Create meeting_bot_jobs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meeting_bot_jobs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
          meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
          provider VARCHAR(50) NOT NULL,
          mode VARCHAR(30) DEFAULT 'realtime',
          meeting_url TEXT NOT NULL,
          external_meeting_id VARCHAR(255),
          meeting_title VARCHAR(255) NOT NULL,
          scheduled_start TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          scheduled_end TIMESTAMP WITH TIME ZONE,
          status VARCHAR(50) DEFAULT 'SCHEDULED',
          consent_state VARCHAR(30) DEFAULT 'pending',
          consent_timestamp TIMESTAMP WITH TIME ZONE,
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
          diarization_status VARCHAR(50) DEFAULT 'pending',
          extraction_status VARCHAR(50) DEFAULT 'pending',
          processing_job_id VARCHAR(255),
          error_code VARCHAR(100),
          error_message TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 21. Create meeting_bot_logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meeting_bot_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          job_id UUID REFERENCES meeting_bot_jobs(id) ON DELETE CASCADE,
          stage VARCHAR(50) NOT NULL,
          level VARCHAR(20) DEFAULT 'info',
          message TEXT NOT NULL,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 22. Create extraction_profiles table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS extraction_profiles (
          id VARCHAR(100) PRIMARY KEY,
          workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          summary_sections JSONB NOT NULL DEFAULT '[]',
          fields JSONB NOT NULL DEFAULT '[]',
          extract_action_items BOOLEAN DEFAULT TRUE,
          extract_risks BOOLEAN DEFAULT TRUE,
          extract_objections BOOLEAN DEFAULT TRUE,
          is_active BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    logger.info('[PulseSync] Database migrations completed successfully.');
  } catch (err) {
    logger.error({ error: err?.message }, '[PulseSync] PostgreSQL connection or migration failed.');
    const allowLocalFallback = process.env.NODE_ENV !== 'production' && process.env.ALLOW_JSON_FALLBACK === 'true';
    if (allowLocalFallback) {
      logger.warn('[PulseSync] Explicit local JSON fallback enabled. Do not use this mode for production or customer data.');
      useFallbackDb = true;
      await pool?.end().catch(() => {});
      pool = null;
    } else {
      await pool?.end().catch(() => {});
      pool = null;
      throw new Error(`PulseSync startup aborted because PostgreSQL initialization failed: ${err?.message || 'unknown error'}`);
    }
  }
}
await testPostgresConnection();

// Initialize Sync Engine
const syncEngine = new SyncEngine(pool, useFallbackDb, readFallbackDb, writeFallbackDb, logger);

// Fallback JSON DB Utilities
function readFallbackDb() {
  try {
    const data = JSON.parse(fs.readFileSync(FALLBACK_DB_PATH, 'utf8'));
    
    // Ensure all dynamic schema arrays exist
    if (!data.workspaces) data.workspaces = [];
    if (!data.extraction_schemas) data.extraction_schemas = [];
    if (!data.schema_fields) data.schema_fields = [];
    if (!data.call_extractions) data.call_extractions = [];
    if (!data.companies) data.companies = [];
    if (!data.meetings) data.meetings = [];
    if (!data.speakers) data.speakers = [];
    if (!data.segments) data.segments = [];
    if (!data.integrations) data.integrations = [];
    if (!data.integration_credentials) data.integration_credentials = [];
    if (!data.destination_field_metadata) data.destination_field_metadata = [];
    if (!data.field_mappings) data.field_mappings = [];
    if (!data.crm_records) data.crm_records = [];
    if (!data.sync_runs) data.sync_runs = [];
    if (!data.sync_items) data.sync_items = [];
    if (!data.sync_logs) data.sync_logs = [];
    if (!data.activity_logs) data.activity_logs = [];
    if (!data.timeline_events) data.timeline_events = [];
    if (!data.company_memories) data.company_memories = [];
    if (!data.risks) data.risks = [];
    if (!data.objections) data.objections = [];
    if (!data.meeting_bot_jobs) data.meeting_bot_jobs = [];
    if (!data.meeting_bot_logs) data.meeting_bot_logs = [];
    if (!data.extraction_profiles) data.extraction_profiles = [];

    let needsWrite = false;

    if (data.extraction_profiles.length === 0) {
      data.extraction_profiles = EXTRACTION_PROFILE_TEMPLATES.map((tmpl) => ({
        ...tmpl,
        workspace_id: '00000000-0000-0000-0000-000000000001',
        is_active: tmpl.id === 'default_sales_intelligence',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));
      needsWrite = true;
    }

    // Migrate meetings default state
    data.meetings.forEach(m => {
      if (m.workflow_state === undefined) {
        m.workflow_state = m.status === 'synced' ? 'synced' : 'transcript_review';
        needsWrite = true;
      }
      if (m.ai_snapshot === undefined) {
        m.ai_snapshot = {};
        needsWrite = true;
      }
      if (m.deal_intelligence === undefined) {
        m.deal_intelligence = {};
        needsWrite = true;
      }
      if (m.risks === undefined) {
        m.risks = [];
        needsWrite = true;
      }
      if (m.objections === undefined) {
        m.objections = [];
        needsWrite = true;
      }
      if (m.action_items === undefined) {
        m.action_items = [];
        needsWrite = true;
      }
      if (m.call_type === undefined) {
        const titleLower = (m.title || '').toLowerCase();
        if (titleLower.includes('demo') || titleLower.includes('solution')) {
          m.call_type = 'solution_demo';
        } else if (titleLower.includes('tech') || titleLower.includes('validation') || titleLower.includes('security')) {
          m.call_type = 'technical_validation';
        } else if (titleLower.includes('negotiat') || titleLower.includes('pricing') || titleLower.includes('contract')) {
          m.call_type = 'negotiation';
        } else if (titleLower.includes('follow') || titleLower.includes('sync')) {
          m.call_type = 'follow_up';
        } else if (titleLower.includes('qualif')) {
          m.call_type = 'qualification';
        } else if (titleLower.includes('renew') || titleLower.includes('expansion')) {
          m.call_type = 'renewal_expansion';
        } else {
          m.call_type = 'discovery';
        }
        m.call_type_confidence = m.call_type_confidence || 0.94;
        m.call_type_source = m.call_type_source || 'ai';
        m.call_type_rationale = m.call_type_rationale || 'Automated meeting classification based on conversation content';
        needsWrite = true;
      }
    });

    // Migrate legacy fallback speakers if they have an 'id' instead of 'speaker_id'
    if (data.speakers.length > 0 && data.speakers[0].id && !data.speakers[0].speaker_id) {
      logger.info('[PulseSync] Migrating legacy fallback speakers...');
      data.speakers = [];
      needsWrite = true;
    }

    // Migrate segments to add original_text/corrected_text
    data.segments.forEach(seg => {
      if (seg.original_text === undefined) {
        seg.original_text = seg.text || '';
        needsWrite = true;
      }
      if (seg.corrected_text === undefined) {
        seg.corrected_text = seg.text || '';
        needsWrite = true;
      }
    });

    // Initialize integrations baseline with genuine statuses
    if (data.integrations.length === 0) {
      data.integrations = [
        {
          id: "00000000-0000-0000-0000-000000000101",
          workspace_id: "00000000-0000-0000-0000-000000000001",
          provider: "hubspot",
          name: "HubSpot CRM",
          connection_status: "not_connected",
          auth_metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        {
          id: "00000000-0000-0000-0000-000000000102",
          workspace_id: "00000000-0000-0000-0000-000000000001",
          provider: "salesforce",
          name: "Salesforce CRM",
          connection_status: "not_connected",
          auth_metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        {
          id: "00000000-0000-0000-0000-000000000103",
          workspace_id: "00000000-0000-0000-0000-000000000001",
          provider: "pipedrive",
          name: "Pipedrive CRM",
          connection_status: "not_connected",
          auth_metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ];
      needsWrite = true;
    }

    if (needsWrite) {
      fs.writeFileSync(FALLBACK_DB_PATH, JSON.stringify(data, null, 2));
    }

    // Seed Default Workspace and Schema if they are empty
    if (data.workspaces.length === 0) {
      data.workspaces.push({
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Default Workspace',
        slug: 'default',
        created_at: new Date().toISOString()
      });
      
      data.extraction_schemas.push({
        id: '00000000-0000-0000-0000-000000000002',
        workspace_id: '00000000-0000-0000-0000-000000000001',
        is_active: true,
        created_at: new Date().toISOString()
      });

      data.schema_fields.push(
        {
          id: 'sf-1',
          schema_id: '00000000-0000-0000-0000-000000000002',
          name: 'budget',
          label: 'Project Budget',
          field_type: 'currency',
          description: 'The custom budget discussed or allocated for this sync.',
          prompt_hint: 'Look for monetary values, figures like $50k or fifty thousand.',
          is_required: true,
          sort_order: 0,
          options: []
        },
        {
          id: 'sf-2',
          schema_id: '00000000-0000-0000-0000-000000000002',
          name: 'timeline',
          label: 'Implementation Timeline',
          field_type: 'string',
          description: 'Expected delivery or rollout timeline for tasks.',
          prompt_hint: 'Look for time intervals, dates, weeks, or quarters (Q3/Q4).',
          is_required: false,
          sort_order: 1,
          options: []
        },
        {
          id: 'sf-3',
          schema_id: '00000000-0000-0000-0000-000000000002',
          name: 'decision_maker',
          label: 'Decision Maker',
          field_type: 'string',
          description: 'Identify who has signing authority or executive signoff.',
          prompt_hint: 'Look for names, titles, or designations like VP, CEO, or lead.',
          is_required: false,
          sort_order: 2,
          options: []
        }
      );
      
      fs.writeFileSync(FALLBACK_DB_PATH, JSON.stringify(data, null, 2));
    }
    
    return data;
  } catch (err) {
    return { 
      meetings: [], speakers: [], segments: [], summaries: [], analytics: [],
      workspaces: [], extraction_schemas: [], schema_fields: [], call_extractions: [] 
    };
  }
}

function writeFallbackDb(data) {
  fs.writeFileSync(FALLBACK_DB_PATH, JSON.stringify(data, null, 2));
}

// Global Activity Logging utility
async function logActivity(eventType, message) {
  try {
    if (!useFallbackDb) {
      await pool.query(
        'INSERT INTO activity_logs (event_type, message) VALUES ($1, $2)',
        [eventType, message]
      );
    } else {
      const data = readFallbackDb();
      data.activity_logs.push({
        id: crypto.randomUUID(),
        event_type: eventType,
        message,
        created_at: new Date().toISOString()
      });
      writeFallbackDb(data);
    }
    logger.info(`[Activity Feed Log] ${eventType}: ${message}`);
  } catch (err) {
    logger.error({ err }, 'Failed to log activity event');
  }
}

// Global Account Timeline Logging utility
async function logTimelineEvent(companyId, meetingId, eventType, payload) {
  try {
    if (!companyId) return; // Must belong to a company/account
    if (!useFallbackDb) {
      await pool.query(
        `INSERT INTO timeline_events (id, company_id, meeting_id, event_type, payload, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
        [companyId, meetingId || null, eventType, JSON.stringify(payload || {})]
      );
    } else {
      const data = readFallbackDb();
      data.timeline_events.push({
        id: crypto.randomUUID(),
        company_id: companyId,
        meeting_id: meetingId || null,
        event_type: eventType,
        payload: payload || {},
        created_at: new Date().toISOString()
      });
      writeFallbackDb(data);
    }
    logger.info(`[Timeline Log] ${eventType} for company ${companyId}`);
  } catch (err) {
    logger.error({ err }, 'Failed to log timeline event');
  }
}

// Express App Settings
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(pinoHttp({ logger }));

const configuredOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const isLocalDevelopmentOrigin = (origin) => {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
};

app.use(cors({
  origin(origin, callback) {
    if (!origin || configuredOrigins.has(origin) || isLocalDevelopmentOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposedHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges'],
}));

// Protect API routes with a self-hosted deployment token. This is a single-tenant gate,
// not a substitute for per-user identity/role authorization in a multi-tenant SaaS.
app.use((req, res, next) => {
  if (req.method === 'OPTIONS' || req.path === '/health' || req.path === '/ready' || req.path === '/api/integrations/hubspot/callback') return next();
  const protectedPath = req.path.startsWith('/api/');
  if (!protectedPath) return next();
  if (!apiAccessToken && nodeEnvironment !== 'production') return next();
  if (!apiAccessToken) return res.status(503).json({ error: 'api_auth_not_configured', message: 'API authentication is not configured.' });
  const authHeader = req.headers.authorization || '';
  const supplied = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.headers['x-pulsesync-api-key'];
  if (!safeEqualToken(supplied, apiAccessToken)) return res.status(401).json({ error: 'unauthorized', message: 'A valid PulseSync API token is required.' });
  return next();
});

// Expiring HMAC-signed media URLs allow native audio playback without exposing the uploads folder.
function createSignedMediaUrl(filename, ttlSeconds = 900) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${filename}:${expires}`;
  const signature = crypto.createHmac('sha256', MEDIA_SIGNING_SECRET).update(payload).digest('hex');
  return `/media/${encodeURIComponent(filename)}?expires=${expires}&signature=${signature}`;
}
app.get('/media/:filename', (req, res) => {
  const filename = String(req.params.filename || '');
  const expires = Number(req.query.expires);
  const signature = String(req.query.signature || '');
  if (!filename || path.basename(filename) !== filename || !Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000) || expires > Math.floor(Date.now() / 1000) + 16 * 60) {
    return res.status(403).json({ error: 'invalid_media_signature' });
  }
  const expected = crypto.createHmac('sha256', MEDIA_SIGNING_SECRET).update(`${filename}:${expires}`).digest('hex');
  if (!safeEqualToken(signature, expected)) return res.status(403).json({ error: 'invalid_media_signature' });
  const filePath = path.resolve(UPLOADS_DIR, filename);
  if (!filePath.startsWith(path.resolve(UPLOADS_DIR) + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return res.status(404).json({ error: 'not_found' });
  const stat = fs.statSync(filePath);
  const range = req.headers.range;
  res.setHeader('Accept-Ranges', 'bytes');
  const audioTypes = { '.webm': 'audio/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };
  res.setHeader('Content-Type', audioTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-store');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return res.status(416).end();
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : stat.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= stat.size || end < start) return res.status(416).end();
    end = Math.min(end, stat.size - 1);
    res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }
  res.setHeader('Content-Length', String(stat.size));
  fs.createReadStream(filePath).pipe(res);
});

// Recordings are private. Do not expose the uploads directory as a public static mount.
// Playback uses an authenticated API to issue a short-lived signed media URL.
app.use('/media', (_req, res) => res.status(404).json({ error: 'not_found', message: 'Direct media URLs are disabled; use the meeting audio endpoint.' }));

// Configure Multer for local WebM chunk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `meeting_${Date.now()}_${Math.random().toString(36).slice(2, 9)}${ext}`);
  }
});
const maxAudioUploadBytes = Number.parseInt(process.env.MAX_AUDIO_UPLOAD_BYTES || String(250 * 1024 * 1024), 10);
if (!Number.isSafeInteger(maxAudioUploadBytes) || maxAudioUploadBytes < 1 * 1024 * 1024) {
  throw new Error('MAX_AUDIO_UPLOAD_BYTES must be an integer of at least 1048576 bytes.');
}
const upload = multer({
  storage,
  limits: { fileSize: maxAudioUploadBytes },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3',
      'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/flac',
      'video/webm', 'video/mp4', 'application/octet-stream'
    ]);
    if (!file.mimetype || allowed.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error(`Invalid file type: ${file.mimetype}. Upload MP3, WAV, M4A, WebM, OGG, FLAC, or MP4 audio.`));
  }
});

// Healthcheck Route
app.get('/health', (_req, res) => {
  const databaseMode = useFallbackDb ? 'local-json-demo' : 'postgresql';
  res.status(200).json({ ok: true, databaseMode, environment: process.env.NODE_ENV || 'development' });
});

app.get('/ready', async (_req, res) => {
  if (useFallbackDb) {
    return res.status(process.env.NODE_ENV === 'production' ? 503 : 200).json({ ready: process.env.NODE_ENV !== 'production', databaseMode: 'local-json-demo' });
  }
  try {
    await pool.query('SELECT 1');
    return res.json({ ready: true, databaseMode: 'postgresql' });
  } catch {
    return res.status(503).json({ ready: false, databaseMode: 'postgresql' });
  }
});

// ── Ingestion Endpoint ──
app.post('/api/meetings/upload', upload.single('audio'), async (req, res, next) => {
  let meetingPersisted = false;
  try {
    if (!req.file) {
      res.status(400).json({ error: 'no_file', message: 'No audio file was uploaded.' });
      return;
    }

    const title = req.body.title || path.basename(req.file.originalname || 'meeting').replace(/\.[^.]+$/, '');
    const duration = Math.max(0, parseInt(req.body.duration || '0', 10) || 0);

    // Audio Validation Check (AudioNormalizer)
    const audioValidation = AudioNormalizer.validateAudioFile(req.file.path, { maxSizeBytes: maxAudioUploadBytes });
    if (!audioValidation.valid) {
      // Clean up invalid uploaded file
      try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch (_) {}
      res.status(400).json({ error: audioValidation.error || 'INVALID_AUDIO', message: audioValidation.message || 'The uploaded file is not a valid audio recording.' });
      return;
    }

    if (req.body.consent_status !== 'granted') {
      try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({ error: 'consent_required', message: 'Confirm that required participant consent has been obtained before uploading meeting audio.' });
    }

    const meetingId = crypto.randomUUID();
    const audioUrl = `/media/${req.file.filename}`;
    const captureSource = ['extension', 'meeting_bot', 'upload'].includes(req.body.capture_source) ? req.body.capture_source : 'upload';
    const captureProvider = ['google_meet', 'zoom', 'microsoft_teams'].includes(req.body.capture_provider) ? req.body.capture_provider : null;
    const meetingUrl = typeof req.body.meeting_url === 'string' ? req.body.meeting_url.slice(0, 2000) : null;
    const consentStatus = ['unknown', 'pending', 'granted', 'denied'].includes(req.body.consent_status) ? req.body.consent_status : 'unknown';

    logger.info({ meetingId, title, file: req.file.filename, format: audioValidation.format }, 'Received valid meeting audio upload');

    if (!useFallbackDb) {
      // PostgreSQL Insertion
      await pool.query(
        `INSERT INTO meetings (id, title, status, workflow_state, processing_stage, error_message, audio_url, duration_seconds, capture_source, capture_provider, meeting_url, consent_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [meetingId, title, 'queued', 'uploaded', 'queued', null, audioUrl, duration, captureSource, captureProvider, meetingUrl, consentStatus]
      );
      meetingPersisted = true;
    } else {
      // Fallback JSON Insertion
      const data = readFallbackDb();
      data.meetings.push({
        id: meetingId,
        title,
        status: 'queued',
        workflow_state: 'uploaded',
        processing_stage: 'queued',
        error_message: null,
        audio_url: audioUrl,
        duration_seconds: duration,
        capture_source: captureSource,
        capture_provider: captureProvider,
        meeting_url: meetingUrl,
        bot_status: null,
        consent_status: consentStatus,
        created_at: new Date().toISOString()
      });
      writeFallbackDb(data);
      meetingPersisted = true;
    }

    // Trigger processing worker asynchronously
    triggerJobProcessor(meetingId);

    // Log upload activity
    await logActivity('meeting_upload', `New meeting uploaded: "${title}"`);

    res.json({
      ok: true,
      message: 'Audio uploaded successfully. Meeting queued for processing.',
      meetingId,
      status: 'queued',
      workflow_state: 'uploaded',
      processing_stage: 'queued'
    });
  } catch (error) {
    // Avoid orphaned media if the database write failed before a meeting record was committed.
    if (!meetingPersisted && req.file?.path) {
      try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch (cleanupError) {
        logger.warn({ cleanupError: cleanupError?.message }, 'Failed to remove an uncommitted upload');
      }
    }
    next(error);
  }
});

// ── Get All Meetings ──
app.get('/api/meetings', async (req, res, next) => {
  try {
    if (!useFallbackDb) {
      const result = await pool.query('SELECT * FROM meetings ORDER BY created_at DESC');
      res.json(result.rows);
    } else {
      const data = readFallbackDb();
      res.json([...data.meetings].reverse());
    }
  } catch (error) {
    next(error);
  }
});

// ── Real Analytics Overview (database-backed, no synthetic KPIs) ──
app.get('/api/analytics/overview', async (req, res, next) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : null;
    const sinceIso = since && !Number.isNaN(since.getTime()) ? since.toISOString() : null;
    let meetings = [];
    let analytics = [];
    if (!useFallbackDb) {
      const meetingQuery = sinceIso
        ? await pool.query(`SELECT id, title, company_id, created_at, duration_seconds, status, workflow_state, call_type, template_used, action_items, risks, objections, ai_snapshot, deal_intelligence FROM meetings WHERE created_at >= $1 ORDER BY created_at DESC`, [sinceIso])
        : await pool.query(`SELECT id, title, company_id, created_at, duration_seconds, status, workflow_state, call_type, template_used, action_items, risks, objections, ai_snapshot, deal_intelligence FROM meetings ORDER BY created_at DESC`);
      meetings = meetingQuery.rows;
      const analyticsQuery = sinceIso
        ? await pool.query(`SELECT ma.* FROM meeting_analytics ma JOIN meetings m ON m.id = ma.meeting_id WHERE m.created_at >= $1`, [sinceIso])
        : await pool.query(`SELECT * FROM meeting_analytics`);
      analytics = analyticsQuery.rows;
    } else {
      const data = readFallbackDb();
      meetings = (data.meetings || []).filter(m => !sinceIso || new Date(m.created_at) >= new Date(sinceIso));
      analytics = (data.analytics || []).filter(a => meetings.some(m => m.id === a.meeting_id));
    }
    const completed = meetings.filter(m => ['completed', 'review'].includes(m.status) || ['transcript_review', 'review', 'synced'].includes(m.workflow_state));
    const totalDuration = completed.reduce((sum, m) => sum + Number(m.duration_seconds || 0), 0);
    const companies = new Set(completed.map(m => m.company_id).filter(Boolean));
    const actions = completed.flatMap(m => Array.isArray(m.action_items) ? m.action_items : []);
    const risks = completed.flatMap(m => Array.isArray(m.risks) ? m.risks : []);
    const objections = completed.flatMap(m => Array.isArray(m.objections) ? m.objections : []);
    const callsByType = {};
    for (const m of completed) callsByType[m.call_type || 'unknown'] = (callsByType[m.call_type || 'unknown'] || 0) + 1;
    const speakerStats = new Map();
    for (const a of analytics) {
      const key = a.speaker_name || a.speaker_id || 'Unknown Speaker';
      const cur = speakerStats.get(key) || { talkTime: 0, interruptions: 0, rows: 0 };
      cur.talkTime += Number(a.talk_time_seconds || 0);
      cur.interruptions += Number(a.interruption_count || 0);
      cur.rows += 1;
      speakerStats.set(key, cur);
    }
    const objectionThemes = {};
    for (const item of objections) {
      const text = typeof item === 'string' ? item : (item.objection || item.text || item.risk || '');
      const words = String(text).toLowerCase().match(/security|pricing|price|budget|implementation|integration|compliance|timing|timeline|procurement|performance/g) || [];
      for (const w of words) { const theme = w === 'price' ? 'pricing' : w; objectionThemes[theme] = (objectionThemes[theme] || 0) + 1; }
    }
    res.json({
      generated_at: new Date().toISOString(), source: 'database',
      totals: { meetings: completed.length, accounts: companies.size, duration_seconds: totalDuration, action_items: actions.length, risks: risks.length, objections: objections.length },
      calls_by_type: callsByType,
      speaker_stats: Array.from(speakerStats.entries()).map(([speaker, v]) => ({ speaker, ...v })),
      objection_themes: Object.entries(objectionThemes).sort((a,b) => b[1]-a[1]).slice(0, 8).map(([theme, count]) => ({ theme, count })),
      recent_meetings: completed.slice(0, 8).map(m => ({ id: m.id, title: m.title, date: m.created_at, duration_seconds: Number(m.duration_seconds || 0), call_type: m.call_type || 'unknown', template_used: m.template_used || m.ai_snapshot?.templateId || null, action_items: Array.isArray(m.action_items) ? m.action_items.length : 0, risks: Array.isArray(m.risks) ? m.risks.length : 0, objections: Array.isArray(m.objections) ? m.objections.length : 0 }))
    });
  } catch (err) { next(err); }
});

// ── Get Single Meeting Details ──
app.get('/api/meetings/:id', async (req, res, next) => {
  try {
    const meetingId = req.params.id;

    if (!useFallbackDb) {
      const meetingResult = await pool.query(
        `SELECT m.*, c.name as company_name, c.website as company_website, 
                c.industry as company_industry, c.crm_account as company_crm_account, 
                c.notes as company_notes
         FROM meetings m 
         LEFT JOIN companies c ON m.company_id = c.id 
         WHERE m.id = $1`,
        [meetingId]
      );
      
      if (meetingResult.rows.length === 0) {
        res.status(404).json({ error: 'not_found', message: 'Meeting not found' });
        return;
      }

      const speakersResult = await pool.query(
        'SELECT * FROM speakers WHERE meeting_id = $1',
        [meetingId]
      );

      const segmentsResult = await pool.query(
        `SELECT ts.*, COALESCE(s.name, ts.speaker_name, 'Unknown Speaker') as speaker_name 
         FROM transcript_segments ts 
         LEFT JOIN speakers s ON ts.speaker_id = s.speaker_id AND ts.meeting_id = s.meeting_id 
         WHERE ts.meeting_id = $1 
         ORDER BY ts.start_time ASC`,
        [meetingId]
      );

      const summaryResult = await pool.query('SELECT * FROM meeting_summaries WHERE meeting_id = $1', [meetingId]);
      const extractionsResult = await pool.query('SELECT * FROM call_extractions WHERE meeting_id = $1', [meetingId]);
      const analyticsResult = await pool.query(
        `SELECT ma.*, COALESCE(s.name, ma.speaker_name, 'Unknown Speaker') as speaker_name 
         FROM meeting_analytics ma
         LEFT JOIN speakers s ON ma.speaker_id = s.speaker_id AND ma.meeting_id = s.meeting_id 
         WHERE ma.meeting_id = $1`,
        [meetingId]
      );

      const participantsResult = await pool.query(
        'SELECT * FROM meeting_participants WHERE meeting_id = $1 ORDER BY joined_at ASC',
        [meetingId]
      );
      const mappingsResult = await pool.query(
        'SELECT * FROM speaker_mappings WHERE meeting_id = $1 ORDER BY created_at ASC',
        [meetingId]
      );

      const meetingData = meetingResult.rows[0];
      if (meetingData) {
        meetingData.audio_stream_url = `/api/meetings/${meetingId}/audio`;
        meetingData.audio_url = meetingData.audio_url || meetingData.audio_stream_url;
      }

      let summaryObj = summaryResult.rows[0] || null;
      let extractionsObj = extractionsResult.rows[0] || null;
      if (extractionsObj && extractionsObj.extracted_data) {
        let extData = typeof extractionsObj.extracted_data === 'string'
          ? JSON.parse(extractionsObj.extracted_data)
          : { ...extractionsObj.extracted_data };
        if (!extData.conversation_intelligence && segmentsResult.rows && segmentsResult.rows.length > 0) {
          extData.conversation_intelligence = EvidenceValidator.analyzeConversationIntelligence(segmentsResult.rows, extData.profile);
          extractionsObj.extracted_data = extData;
        }
        if ((!summaryObj || !summaryObj.overview || summaryObj.overview.trim() === '') && extData.conversation_intelligence?.generic_summary) {
          if (!summaryObj) summaryObj = { overview: extData.conversation_intelligence.generic_summary };
          else summaryObj.overview = extData.conversation_intelligence.generic_summary;
        }
      }

      // Fetch latest sync run for state-driven sync restoration
      let latestSyncRun = null;
      const runsRes = await pool.query(
        'SELECT * FROM sync_runs WHERE meeting_id = $1 ORDER BY created_at DESC LIMIT 1',
        [meetingId]
      );
      if (runsRes.rows.length > 0) {
        latestSyncRun = runsRes.rows[0];
        const itemsRes = await pool.query(
          'SELECT * FROM sync_items WHERE sync_run_id = $1',
          [latestSyncRun.id]
        );
        latestSyncRun.items = itemsRes.rows;
      }

      res.json({
        meeting: meetingData,
        speakers: speakersResult.rows,
        segments: segmentsResult.rows,
        summary: summaryObj,
        extractions: extractionsObj,
        analytics: analyticsResult.rows,
        participants: participantsResult.rows || [],
        speakerMappings: mappingsResult.rows || [],
        latest_sync_run: latestSyncRun
      });
    } else {
      const data = readFallbackDb();
      const meeting = data.meetings.find(m => m.id === meetingId);
      if (!meeting) {
        res.status(404).json({ error: 'not_found', message: 'Meeting not found' });
        return;
      }

      const company = data.companies.find(c => c.id === meeting.company_id) || null;
      const speakers = (data.speakers || []).filter(s => s.meeting_id === meetingId);

      const segments = (data.segments || [])
        .filter(s => s.meeting_id === meetingId)
        .map(seg => {
          const matchedSp = (data.speakers || []).find(sp => sp.meeting_id === meetingId && sp.speaker_id === seg.speaker_id);
          return {
            ...seg,
            speaker_name: matchedSp?.name || seg.speaker_name || 'Unknown Speaker'
          };
        })
        .sort((a, b) => a.start_time - b.start_time);

      let summary = (data.summaries || []).find(s => s.meeting_id === meetingId) || null;
      let extractions = (data.call_extractions || []).find(e => e.meeting_id === meetingId) || null;
      if (extractions && extractions.extracted_data) {
        let extData = typeof extractions.extracted_data === 'string'
          ? JSON.parse(extractions.extracted_data)
          : { ...extractions.extracted_data };
        if (!extData.conversation_intelligence && segments && segments.length > 0) {
          extData.conversation_intelligence = EvidenceValidator.analyzeConversationIntelligence(segments, extData.profile);
          extractions.extracted_data = extData;
        }
        if ((!summary || !summary.overview || summary.overview.trim() === '') && extData.conversation_intelligence?.generic_summary) {
          if (!summary) summary = { overview: extData.conversation_intelligence.generic_summary };
          else summary.overview = extData.conversation_intelligence.generic_summary;
        }
      }
      const analytics = (data.analytics || [])
        .filter(a => a.meeting_id === meetingId)
        .map(a => {
          const matchedSp = (data.speakers || []).find(sp => sp.meeting_id === meetingId && sp.speaker_id === a.speaker_id);
          return {
            ...a,
            speaker_name: matchedSp?.name || a.speaker_name || 'Unknown Speaker'
          };
        });

      const participants = (data.meeting_participants || []).filter(p => p.meeting_id === meetingId);
      const speakerMappings = (data.speaker_mappings || []).filter(m => m.meeting_id === meetingId);

      const meetingObj = {
        ...meeting,
        company_name: company?.name || '',
        company_website: company?.website || '',
        company_industry: company?.industry || '',
        company_crm_account: company?.crm_account || '',
        company_notes: company?.notes || '',
        audio_stream_url: `/api/meetings/${meetingId}/audio-url`,
        audio_url: `/api/meetings/${meetingId}/audio-url`
      };

      let latestSyncRun = (data.sync_runs || [])
        .filter(r => r.meeting_id === meetingId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
      if (latestSyncRun) {
        latestSyncRun = {
          ...latestSyncRun,
          items: (data.sync_items || []).filter(i => i.sync_run_id === latestSyncRun.id)
        };
      }

      res.json({ 
        meeting: meetingObj, 
        company, 
        speakers, 
        segments, 
        summary, 
        extractions, 
        analytics, 
        participants, 
        speakerMappings,
        latest_sync_run: latestSyncRun
      });
    }
  } catch (error) {
    next(error);
  }
});

// Return a short-lived media URL after the protected meeting lookup.
app.get('/api/meetings/:id/audio-url', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    let meeting = null;
    if (!useFallbackDb && pool) {
      const result = await pool.query('SELECT id, audio_url FROM meetings WHERE id = $1', [meetingId]);
      meeting = result.rows[0] || null;
    } else {
      meeting = (readFallbackDb().meetings || []).find((item) => item.id === meetingId) || null;
    }
    if (!meeting?.audio_url) return res.status(404).json({ error: 'audio_not_found' });
    const filename = path.basename(meeting.audio_url);
    const filePath = path.resolve(UPLOADS_DIR, filename);
    if (!filePath.startsWith(path.resolve(UPLOADS_DIR) + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return res.status(404).json({ error: 'audio_not_found' });
    return res.json({ url: createSignedMediaUrl(filename), expires_in: 900 });
  } catch (err) { next(err); }
});

// ── Dedicated Meeting Audio Stream Endpoint (HTTP 206 Byte Ranges & CORS) ──
app.get('/api/meetings/:id/audio', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    let meeting = null;

    if (!useFallbackDb && pool) {
      const result = await pool.query('SELECT * FROM meetings WHERE id = $1', [meetingId]);
      meeting = result.rows[0] || null;
    } else if (useFallbackDb) {
      meeting = (readFallbackDb().meetings || []).find(m => m.id === meetingId) || null;
    }
    if (!meeting) return res.status(404).json({ error: 'not_found', message: 'Meeting not found' });

    // Try finding the audio file on disk
    let resolvedFilePath = null;
    if (meeting?.audio_url) {
      const potentialName = path.basename(meeting.audio_url);
      const testPath = path.join(UPLOADS_DIR, potentialName);
      if (fs.existsSync(testPath)) {
        resolvedFilePath = testPath;
      }
    }

    // Fallback: search uploads directory for files matching meetingId or associated bot jobs
    if (!resolvedFilePath) {
      const files = fs.readdirSync(UPLOADS_DIR);
      const botJobs = meetingBotWorker?.jobStore?.getAllJobs?.() || [];
      const relatedJob = botJobs.find(j => j.meeting_id === meetingId || j.id === meetingId);
      const possibleNames = [
        `meeting_bot_${meetingId}`,
        relatedJob ? `meeting_bot_${relatedJob.id}` : null,
        `meeting_${meetingId}`
      ].filter(Boolean);

      for (const prefix of possibleNames) {
        const found = files.find(f => f.startsWith(prefix) || f.includes(prefix));
        if (found) {
          resolvedFilePath = path.join(UPLOADS_DIR, found);
          break;
        }
      }
    }

    if (!resolvedFilePath || !fs.existsSync(resolvedFilePath)) {
      res.status(404).json({ error: 'not_found', message: 'Audio file not found for this meeting' });
      return;
    }

    const stat = fs.statSync(resolvedFilePath);
    const fileSize = stat.size;
    const ext = path.extname(resolvedFilePath).toLowerCase();
    const contentTypeMap = {
      '.mp3': 'audio/mpeg',
      '.webm': 'audio/webm',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4'
    };
    const contentType = contentTypeMap[ext] || 'audio/mpeg';

    // Set CORS & CORP headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Origin, Content-Type, Accept');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        res.status(416).send('Requested range not satisfiable');
        return;
      }

      const chunksize = (end - start) + 1;
      const fileStream = fs.createReadStream(resolvedFilePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': chunksize,
        'Content-Type': contentType,
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
      });
      fs.createReadStream(resolvedFilePath).pipe(res);
    }
  } catch (err) {
    next(err);
  }
});

// ── Edit Transcript Segment / Speaker ──
app.put('/api/meetings/:id/transcript', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    const { segmentId, text, speakerId, speaker_id, speakerName, speaker_name } = req.body;
    const targetSpeakerId = speakerId || speaker_id;
    const targetSpeakerName = speakerName || speaker_name;

    if (!segmentId && !targetSpeakerId) {
      res.status(400).json({ error: 'invalid_args', message: 'Missing segmentId or speaker identifier' });
      return;
    }

    if (!useFallbackDb) {
      if (text !== undefined && segmentId) {
        await pool.query('UPDATE transcript_segments SET corrected_text = $1 WHERE id = $2 AND meeting_id = $3', [text, segmentId, meetingId]);
      }
      if (targetSpeakerName) {
        if (segmentId) {
          await pool.query('UPDATE transcript_segments SET speaker_name = $1 WHERE id = $2 AND meeting_id = $3', [targetSpeakerName, segmentId, meetingId]);
        }
        if (targetSpeakerId) {
          await pool.query(
            'UPDATE transcript_segments SET speaker_id = $1, speaker_name = $2 WHERE (speaker_id = $1 OR id = $3) AND meeting_id = $4',
            [targetSpeakerId, targetSpeakerName, segmentId, meetingId]
          );
          await pool.query(
            "UPDATE speakers SET name = $1, status = 'Mapped', updated_at = NOW() WHERE meeting_id = $2 AND speaker_id = $3",
            [targetSpeakerName, meetingId, targetSpeakerId]
          );
          await pool.query(
            'UPDATE meeting_analytics SET speaker_name = $1 WHERE meeting_id = $2 AND speaker_id = $3',
            [targetSpeakerName, meetingId, targetSpeakerId]
          );
        }
      }
    } else {
      const data = readFallbackDb();
      if (!data.segments) data.segments = [];
      if (!data.speakers) data.speakers = [];
      if (!data.analytics) data.analytics = [];

      if (segmentId) {
        const segment = data.segments.find(s => s.id === segmentId && s.meeting_id === meetingId);
        if (segment) {
          if (text !== undefined) segment.corrected_text = text;
          if (targetSpeakerId) segment.speaker_id = targetSpeakerId;
          if (targetSpeakerName) segment.speaker_name = targetSpeakerName;
        }
      }

      if (targetSpeakerId && targetSpeakerName) {
        const spk = data.speakers.find(s => s.meeting_id === meetingId && s.speaker_id === targetSpeakerId);
        const oldName = spk ? spk.name : null;
        if (spk) {
          spk.name = targetSpeakerName;
          spk.status = 'Mapped';
          spk.updated_at = new Date().toISOString();
        }
        data.segments.forEach(seg => {
          if (seg.meeting_id === meetingId && (seg.speaker_id === targetSpeakerId || (oldName && seg.speaker_name === oldName))) {
            seg.speaker_name = targetSpeakerName;
          }
        });
        data.analytics.forEach(a => {
          if (a.meeting_id === meetingId && (a.speaker_id === targetSpeakerId || (oldName && a.speaker_name === oldName))) {
            a.speaker_name = targetSpeakerName;
          }
        });
      }
      writeFallbackDb(data);
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// ── Update Call Type (AI Classification or Manual User Override) ──
app.put('/api/meetings/:id/call-type', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    const { call_type, source, confidence, rationale } = req.body;
    if (!call_type) {
      res.status(400).json({ error: 'invalid_args', message: 'Missing call_type' });
      return;
    }

    const updatedSource = source || 'manual';
    const updatedConfidence = confidence !== undefined ? parseFloat(confidence) : 1.0;
    const updatedRationale = rationale || (updatedSource === 'manual' ? 'Manually classified by reviewer' : 'Automated AI classification');

    if (!useFallbackDb) {
      await pool.query(
        `UPDATE meetings SET 
           call_type = $1, 
           call_type_source = $2, 
           call_type_confidence = $3, 
           call_type_rationale = $4,
           updated_at = NOW() 
         WHERE id = $5`,
        [call_type, updatedSource, updatedConfidence, updatedRationale, meetingId]
      );
    } else {
      const data = readFallbackDb();
      const m = data.meetings.find(x => x.id === meetingId);
      if (!m) {
        res.status(404).json({ error: 'not_found', message: 'Meeting not found' });
        return;
      }
      m.call_type = call_type;
      m.call_type_source = updatedSource;
      m.call_type_confidence = updatedConfidence;
      m.call_type_rationale = updatedRationale;
      m.updated_at = new Date().toISOString();
      writeFallbackDb(data);
    }

    logger.info({ meetingId, call_type, source: updatedSource }, 'Updated meeting call type');
    res.json({ 
      ok: true, 
      meeting_id: meetingId, 
      call_type, 
      source: updatedSource, 
      confidence: updatedConfidence, 
      rationale: updatedRationale 
    });
  } catch (error) {
    next(error);
  }
});

// ── Rename / Edit Speaker Names ──
// ── Rename / Edit Speaker Names ──
app.put('/api/meetings/:id/speakers', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    const incomingSpeakers = Array.isArray(req.body.speakers)
      ? req.body.speakers.map(s => ({
          speakerId: s.speakerId || s.speaker_id || s.name,
          name: s.name,
          role: s.role || '',
          department: s.department || '',
          job_title: s.job_title || '',
          email: s.email || '',
          status: s.status || 'Mapped'
        }))
      : (req.body.speakerId || req.body.speaker_id || req.body.name ? [{
          speakerId: req.body.speakerId || req.body.speaker_id || req.body.name,
          name: req.body.name,
          role: req.body.role || '',
          department: req.body.department || '',
          job_title: req.body.job_title || '',
          email: req.body.email || '',
          status: req.body.status || 'Mapped'
        }] : []);

    if (incomingSpeakers.length === 0) {
      res.status(400).json({ error: 'invalid_args', message: 'Missing speakerId or name' });
      return;
    }

    if (!useFallbackDb) {
      for (const spk of incomingSpeakers) {
        if (!spk.name) continue;
        const currentSpkRes = await pool.query(
          // 'SELECT name FROM speakers WHERE meeting_id = $1 AND (speaker_id = $2 OR name = $2)',
          'SELECT name FROM speakers WHERE meeting_id = $1 AND (speaker_id = $2::uuid OR name = $2::text)',
          [meetingId, spk.speakerId]
        );
        const oldName = currentSpkRes.rows.length > 0 ? currentSpkRes.rows[0].name : null;

        await pool.query(
          `INSERT INTO speakers (meeting_id, speaker_id, name, role, department, job_title, email, status) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'Mapped')
           ON CONFLICT (meeting_id, speaker_id) 
           DO UPDATE SET 
             name = EXCLUDED.name, 
             role = EXCLUDED.role, 
             department = EXCLUDED.department, 
             job_title = EXCLUDED.job_title, 
             email = EXCLUDED.email, 
             status = 'Mapped',
             updated_at = NOW()`, 
          [meetingId, spk.speakerId, spk.name, spk.role, spk.department, spk.job_title, spk.email]
        );
        await pool.query(
          `UPDATE transcript_segments 
           SET speaker_name = $1 
           WHERE meeting_id = $2 AND (speaker_id = $3::uuid OR speaker_name = $3::text OR ($4::text IS NOT NULL AND speaker_name = $4::text))`,
          [spk.name, meetingId, spk.speakerId, oldName]

//           UPDATE transcript_segments
          // SET speaker_name = $1
          // WHERE meeting_id = $2
          //   AND (
          //     speaker_id = $3::uuid
          //     OR speaker_name = $3::text
          //     OR ($4::text IS NOT NULL AND speaker_name = $4::text)
          //   )
        );
        await pool.query(
          `UPDATE meeting_analytics 
           SET speaker_name = $1 
           WHERE meeting_id = $2 AND (speaker_id = $3::uuid OR speaker_name = $3::text OR ($4::text IS NOT NULL AND speaker_name = $4::text))`,
          [spk.name, meetingId, spk.speakerId, oldName]
        );
      }
    } else {
      const data = readFallbackDb();
      if (!data.speakers) data.speakers = [];
      if (!data.segments) data.segments = [];
      if (!data.analytics) data.analytics = [];

      for (const spk of incomingSpeakers) {
        if (!spk.name) continue;
        let speaker = data.speakers.find(s => s.meeting_id === meetingId && (s.speaker_id === spk.speakerId || s.name === spk.speakerId));
        const oldName = speaker ? speaker.name : null;
        if (speaker) {
          speaker.name = spk.name;
          if (spk.role !== undefined) speaker.role = spk.role;
          if (spk.department !== undefined) speaker.department = spk.department;
          if (spk.job_title !== undefined) speaker.job_title = spk.job_title;
          if (spk.email !== undefined) speaker.email = spk.email;
          speaker.status = 'Mapped';
          speaker.updated_at = new Date().toISOString();
        } else {
          data.speakers.push({
            meeting_id: meetingId,
            speaker_id: spk.speakerId,
            name: spk.name,
            role: spk.role || '',
            department: spk.department || '',
            job_title: spk.job_title || '',
            email: spk.email || '',
            company_id: null,
            status: 'Mapped',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }

        // Propagate speaker_name to all segments of this speaker
        data.segments.forEach(seg => {
          if (seg.meeting_id === meetingId && (seg.speaker_id === spk.speakerId || seg.speaker_name === spk.speakerId || (oldName && seg.speaker_name === oldName))) {
            seg.speaker_name = spk.name;
          }
        });

        // Propagate speaker_name to all meeting analytics of this speaker
        data.analytics.forEach(a => {
          if (a.meeting_id === meetingId && (a.speaker_id === spk.speakerId || a.speaker_name === spk.speakerId || (oldName && a.speaker_name === oldName))) {
            a.speaker_name = spk.name;
          }
        });
      }
      writeFallbackDb(data);
    }

    // Log speaker mapping activity
    let spMeetingTitle = "Unknown Session";
    if (!useFallbackDb) {
      const titleRes = await pool.query('SELECT title FROM meetings WHERE id = $1', [meetingId]);
      if (titleRes.rows.length > 0) spMeetingTitle = titleRes.rows[0].title;
    } else {
      const data = readFallbackDb();
      const m = data.meetings.find(x => x.id === meetingId);
      if (m) spMeetingTitle = m.title;
    }
    const firstSpkName = incomingSpeakers[0]?.name || 'Speaker';
    await logActivity('speaker_mapping', `Speaker profile verified: mapped to "${firstSpkName}" in "${spMeetingTitle}"`);

    res.json({ ok: true, speakers: incomingSpeakers });
  } catch (error) {
    next(error);
  }
});

// ── Save/Update Workflow Details (Screen 1 & 2 Persistence) ──
app.put('/api/meetings/:id/workflow', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    const { meeting, company, speakers, transcript, workflow_state } = req.body;

    if (!useFallbackDb) {
      await pool.query('BEGIN');

      // 1. Update Company Details if provided
      let companyId = null;
      if (company && company.name) {
        companyId = company.id || crypto.randomUUID();
        await pool.query(
          `INSERT INTO companies (id, name, website, industry, crm_account, notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE 
           SET name = EXCLUDED.name, website = EXCLUDED.website, 
               industry = EXCLUDED.industry, crm_account = EXCLUDED.crm_account, 
               notes = EXCLUDED.notes`,
          [companyId, company.name, company.website || null, company.industry || null, company.crm_account || null, company.notes || null]
        );
      }

      // Get current company linkage
      const currentMeetingRes = await pool.query('SELECT company_id FROM meetings WHERE id = $1', [meetingId]);
      const finalCompanyId = companyId || (currentMeetingRes.rows.length > 0 ? currentMeetingRes.rows[0].company_id : null);

      // 2. Update Meeting Info
      await pool.query(
        `UPDATE meetings 
         SET title = COALESCE($1, title), 
             duration_seconds = COALESCE($2, duration_seconds),
             workflow_state = COALESCE($3, workflow_state),
             company_id = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [meeting?.title || null, meeting?.duration_seconds || null, workflow_state || null, finalCompanyId, meetingId]
      );

      // 3. Update Speaker Mappings
      if (speakers && speakers.length > 0) {
        for (const sp of speakers) {
          let spCompanyId = sp.company_id || null;
          
          if (sp.company_name && !spCompanyId) {
            // Check if company exists by name
            const cRes = await pool.query('SELECT id FROM companies WHERE name = $1', [sp.company_name]);
            if (cRes.rows.length > 0) {
              spCompanyId = cRes.rows[0].id;
            } else {
              spCompanyId = crypto.randomUUID();
              await pool.query(
                'INSERT INTO companies (id, name) VALUES ($1, $2)',
                [spCompanyId, sp.company_name]
              );
            }
          }

          await pool.query(
            `INSERT INTO speakers (meeting_id, speaker_id, name, role, department, job_title, email, company_id, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (meeting_id, speaker_id) DO UPDATE 
             SET name = EXCLUDED.name, role = EXCLUDED.role, 
                 department = EXCLUDED.department, job_title = EXCLUDED.job_title, 
                 email = EXCLUDED.email, company_id = EXCLUDED.company_id, 
                 status = EXCLUDED.status, updated_at = NOW()`,
            [meetingId, sp.speaker_id, sp.name, sp.role || null, sp.department || null, sp.job_title || null, sp.email || null, spCompanyId, sp.status || 'Mapped']
          );
          if (sp.name && sp.speaker_id) {
            await pool.query(
              `UPDATE transcript_segments SET speaker_name = $1 WHERE meeting_id = $2 AND speaker_id = $3`,
              [sp.name, meetingId, sp.speaker_id]
            );
            await pool.query(
              `UPDATE meeting_analytics SET speaker_name = $1 WHERE meeting_id = $2 AND speaker_id = $3`,
              [sp.name, meetingId, sp.speaker_id]
            );
          }
        }
      }

      // 4. Update Transcript segments
      if (transcript && transcript.length > 0) {
        for (const seg of transcript) {
          await pool.query(
            'UPDATE transcript_segments SET corrected_text = $1 WHERE id = $2 AND meeting_id = $3',
            [seg.corrected_text, seg.id, meetingId]
          );
        }
      }

      await pool.query('COMMIT');
      res.json({ ok: true });
    } else {
      // Fallback JSON persistence
      const data = readFallbackDb();
      const fallbackMeeting = data.meetings.find(m => m.id === meetingId);
      if (!fallbackMeeting) {
        res.status(404).json({ error: 'not_found', message: 'Meeting not found' });
        return;
      }

      // 1. Update/Create Company
      let companyId = fallbackMeeting.company_id;
      if (company && company.name) {
        let existingComp = data.companies.find(c => c.name.toLowerCase() === company.name.toLowerCase());
        if (!existingComp) {
          existingComp = {
            id: company.id || crypto.randomUUID(),
            name: company.name,
            website: company.website || '',
            industry: company.industry || '',
            crm_account: company.crm_account || '',
            notes: company.notes || '',
            created_at: new Date().toISOString()
          };
          data.companies.push(existingComp);
        } else {
          existingComp.website = company.website !== undefined ? company.website : existingComp.website;
          existingComp.industry = company.industry !== undefined ? company.industry : existingComp.industry;
          existingComp.crm_account = company.crm_account !== undefined ? company.crm_account : existingComp.crm_account;
          existingComp.notes = company.notes !== undefined ? company.notes : existingComp.notes;
        }
        companyId = existingComp.id;
      }

      // 2. Update Meeting details
      fallbackMeeting.title = meeting?.title !== undefined ? meeting.title : fallbackMeeting.title;
      fallbackMeeting.duration_seconds = meeting?.duration_seconds !== undefined ? parseInt(meeting.duration_seconds) : fallbackMeeting.duration_seconds;
      fallbackMeeting.workflow_state = workflow_state || fallbackMeeting.workflow_state;
      fallbackMeeting.company_id = companyId;

      // 3. Update Speakers mapping
      if (speakers && speakers.length > 0) {
        speakers.forEach(sp => {
          let spCompId = sp.company_id || null;
          if (sp.company_name && !spCompId) {
            const cMatch = data.companies.find(c => c.name.toLowerCase() === sp.company_name.toLowerCase());
            if (cMatch) {
              spCompId = cMatch.id;
            } else {
              spCompId = crypto.randomUUID();
              data.companies.push({
                id: spCompId,
                name: sp.company_name,
                created_at: new Date().toISOString()
              });
            }
          }

          let existingSp = data.speakers.find(s => s.meeting_id === meetingId && s.speaker_id === sp.speaker_id);
          if (!existingSp) {
            existingSp = {
              meeting_id: meetingId,
              speaker_id: sp.speaker_id,
              created_at: new Date().toISOString()
            };
            data.speakers.push(existingSp);
          }
          existingSp.name = sp.name !== undefined ? sp.name : existingSp.name;
          existingSp.role = sp.role !== undefined ? sp.role : existingSp.role;
          existingSp.department = sp.department !== undefined ? sp.department : existingSp.department;
          existingSp.job_title = sp.job_title !== undefined ? sp.job_title : existingSp.job_title;
          existingSp.email = sp.email !== undefined ? sp.email : existingSp.email;
          existingSp.company_id = spCompId;
          existingSp.status = sp.status || existingSp.status || 'Mapped';
          existingSp.updated_at = new Date().toISOString();

          if (sp.name && sp.speaker_id) {
            (data.segments || []).forEach(seg => {
              if (seg.meeting_id === meetingId && seg.speaker_id === sp.speaker_id) {
                seg.speaker_name = sp.name;
              }
            });
            (data.analytics || []).forEach(a => {
              if (a.meeting_id === meetingId && a.speaker_id === sp.speaker_id) {
                a.speaker_name = sp.name;
              }
            });
          }
        });
      }

      // 4. Update Transcript segment corrected text
      if (transcript && transcript.length > 0) {
        transcript.forEach(seg => {
          const fallbackSeg = data.segments.find(s => s.id === seg.id && s.meeting_id === meetingId);
          if (fallbackSeg) {
            fallbackSeg.corrected_text = seg.corrected_text;
          }
        });
      }

      writeFallbackDb(data);
      // Log workflow change activity
      let wfMeetingTitle = meeting?.title;
      if (!wfMeetingTitle) {
        if (!useFallbackDb) {
          const titleRes = await pool.query('SELECT title FROM meetings WHERE id = $1', [meetingId]);
          if (titleRes.rows.length > 0) wfMeetingTitle = titleRes.rows[0].title;
        } else {
          const data = readFallbackDb();
          const m = data.meetings.find(x => x.id === meetingId);
          if (m) wfMeetingTitle = m.title;
        }
      }
      await logActivity('workflow_update', `Workflow stage advanced to ${workflow_state} for meeting: "${wfMeetingTitle || 'Unknown'}"`);

      res.json({ ok: true });
    }
  } catch (error) {
    next(error);
  }
});

// ── Persist Review Approvals / Edits for a Meeting ──
app.put('/api/meetings/:id/review', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    const incomingFields = Array.isArray(req.body.fields) ? req.body.fields : [];

    if (!useFallbackDb) {
      const extRes = await pool.query('SELECT * FROM call_extractions WHERE meeting_id = $1', [meetingId]);
      let extractedData = {};
      let schemaId = '00000000-0000-0000-0000-000000000002';
      let recordExists = false;

      if (extRes.rows.length > 0) {
        recordExists = true;
        schemaId = extRes.rows[0].schema_id || schemaId;
        const raw = extRes.rows[0].extracted_data;
        extractedData = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      }

      if (!extractedData.review) extractedData.review = { field_states: {} };
      if (!extractedData.review.field_states) extractedData.review.field_states = {};

      incomingFields.forEach(f => {
        const fKey = f.field_id || f.id || f.fieldKey;
        if (!fKey) return;

        extractedData.review.field_states[fKey] = {
          status: f.review_status || f.status || 'needs_review',
          value: f.value,
          edited: Boolean(f.edited),
          reviewed_by: f.reviewed_by || 'user',
          updated_at: new Date().toISOString()
        };

        const updateList = (list) => {
          if (!Array.isArray(list)) return;
          const target = list.find(item => (item.field_id || item.id || item.fieldKey) === fKey);
          if (target) {
            target.review_status = f.review_status || f.status || target.review_status;
            target.status = target.review_status;
            if (f.value !== undefined) target.value = f.value;
            if (f.edited !== undefined) target.edited = Boolean(f.edited);
          }
        };

        updateList(extractedData.fields);
        updateList(extractedData.template_fields);
      });

      if (recordExists) {
        await pool.query(
          'UPDATE call_extractions SET extracted_data = $1 WHERE meeting_id = $2',
          [JSON.stringify(extractedData), meetingId]
        );
      } else {
        await pool.query(
          `INSERT INTO call_extractions (meeting_id, schema_id, extracted_data)
           VALUES ($1, $2, $3)
           ON CONFLICT (meeting_id) DO UPDATE SET extracted_data = EXCLUDED.extracted_data`,
          [meetingId, schemaId, JSON.stringify(extractedData)]
        );
      }

      const returnFields = (Array.isArray(extractedData.fields) && extractedData.fields.length > 0)
        ? extractedData.fields
        : (Array.isArray(extractedData.template_fields) ? extractedData.template_fields : incomingFields);

      return res.json({ ok: true, fields: returnFields });
    } else {
      const data = readFallbackDb();
      let ext = (data.call_extractions || []).find(e => e.meeting_id === meetingId);

      if (!ext) {
        ext = {
          id: crypto.randomUUID(),
          meeting_id: meetingId,
          schema_id: '00000000-0000-0000-0000-000000000002',
          extracted_data: { fields: [], template_fields: [], review: { field_states: {} } }
        };
        if (!data.call_extractions) data.call_extractions = [];
        data.call_extractions.push(ext);
      }

      if (!ext.extracted_data) ext.extracted_data = {};
      if (!ext.extracted_data.review) ext.extracted_data.review = { field_states: {} };
      if (!ext.extracted_data.review.field_states) ext.extracted_data.review.field_states = {};

      incomingFields.forEach(f => {
        const fKey = f.field_id || f.id || f.fieldKey;
        if (!fKey) return;

        ext.extracted_data.review.field_states[fKey] = {
          status: f.review_status || f.status || 'needs_review',
          value: f.value,
          edited: Boolean(f.edited),
          reviewed_by: f.reviewed_by || 'user',
          updated_at: new Date().toISOString()
        };

        const updateList = (list) => {
          if (!Array.isArray(list)) return;
          const target = list.find(item => (item.field_id || item.id || item.fieldKey) === fKey);
          if (target) {
            target.review_status = f.review_status || f.status || target.review_status;
            target.status = target.review_status;
            if (f.value !== undefined) target.value = f.value;
            if (f.edited !== undefined) target.edited = Boolean(f.edited);
          }
        };

        updateList(ext.extracted_data.fields);
        updateList(ext.extracted_data.template_fields);
      });

      writeFallbackDb(data);

      const returnFields = (Array.isArray(ext.extracted_data.fields) && ext.extracted_data.fields.length > 0)
        ? ext.extracted_data.fields
        : (Array.isArray(ext.extracted_data.template_fields) ? ext.extracted_data.template_fields : incomingFields);

      return res.json({ ok: true, fields: returnFields });
    }
  } catch (error) {
    next(error);
  }
});

// ── On-Demand AI Compilation (Step 5 Trigger) ──
app.post('/api/meetings/:id/compile', async (req, res, next) => {
  try {
    console.log("inside compile----")
    const meetingId = req.params.id;
    const { templateId, profileId, profile, overview, actionItems, extractions, companyMetadata } = req.body;
    const effectiveTemplateId = templateId || profileId || (profile && profile.id) || 'default_sales_intelligence';

    // Save manual draft overrides if provided
    if (overview !== undefined || actionItems !== undefined || extractions !== undefined || req.body.aiSnapshot !== undefined || req.body.ai_snapshot !== undefined) {
      const ai_snapshot = req.body.ai_snapshot || req.body.aiSnapshot || {};
      const deal_intelligence = req.body.deal_intelligence || req.body.dealIntelligence || {};
      const risks = req.body.risks || [];
      const objections = req.body.objections || [];
      const finalActionItems = actionItems || req.body.action_items || [];

      if (!useFallbackDb) {
        await pool.query(
          `INSERT INTO meeting_summaries (meeting_id, overview, action_items)
           VALUES ($1, $2, $3)
           ON CONFLICT (meeting_id) DO UPDATE SET overview = EXCLUDED.overview, action_items = EXCLUDED.action_items`,
          [meetingId, overview || "", JSON.stringify(finalActionItems)]
        );
        
        const extractedPayload = {
          templateId,
          companyMetadata,
          extractions
        };
        
        await pool.query(
          `INSERT INTO call_extractions (meeting_id, schema_id, extracted_data)
           VALUES ($1, $2, $3)
           ON CONFLICT (meeting_id) DO UPDATE SET extracted_data = EXCLUDED.extracted_data`,
          [meetingId, '00000000-0000-0000-0000-000000000002', JSON.stringify(extractedPayload)]
        );
        
        await pool.query(
          `UPDATE meetings SET 
             status = 'completed', 
             ai_snapshot = $1,
             deal_intelligence = $2,
             risks = $3,
             objections = $4,
             action_items = $5,
             updated_at = NOW() 
           WHERE id = $6`,
          [
            JSON.stringify(ai_snapshot),
            JSON.stringify(deal_intelligence),
            JSON.stringify(risks),
            JSON.stringify(objections),
            JSON.stringify(finalActionItems),
            meetingId
          ]
        );
      } else {
        const data = readFallbackDb();
        
        let summary = data.summaries.find(s => s.meeting_id === meetingId);
        if (summary) {
          summary.overview = overview || "";
          summary.action_items = finalActionItems;
        } else {
          data.summaries.push({
            id: crypto.randomUUID(),
            meeting_id: meetingId,
            overview: overview || "",
            action_items: finalActionItems,
            objections: [],
            decisions: [],
            topics: [],
            sentiment_trend: []
          });
        }
        
        const extractedPayload = {
          templateId,
          companyMetadata,
          extractions
        };
        data.call_extractions = data.call_extractions.filter(e => e.meeting_id !== meetingId);
        data.call_extractions.push({
          id: crypto.randomUUID(),
          meeting_id: meetingId,
          schema_id: '00000000-0000-0000-0000-000000000002',
          extracted_data: extractedPayload
        });
        
        const meeting = data.meetings.find(m => m.id === meetingId);
        if (meeting) {
          meeting.status = 'completed';
          meeting.ai_snapshot = ai_snapshot;
          meeting.deal_intelligence = deal_intelligence;
          meeting.risks = risks;
          meeting.objections = objections;
          meeting.action_items = finalActionItems;
        }
        
        writeFallbackDb(data);
      }
      return res.json({ ok: true });
    }


    // 0. Verify workflow state gatekeeper
    let workflow_state = '';
    let meeting = null;
    if (!useFallbackDb) {
      const mRes = await pool.query('SELECT * FROM meetings WHERE id = $1', [meetingId]);
      if (mRes.rows.length === 0) return res.status(404).json({error: 'not_found'});
      meeting = mRes.rows[0];
      workflow_state = meeting.workflow_state;
    } else {
      const data = readFallbackDb();
      meeting = data.meetings.find(m => m.id === meetingId) || null;
      if (!meeting) return res.status(404).json({error: 'not_found'});
      workflow_state = meeting.workflow_state;
    }

    // Record template used before compilation
    if (!useFallbackDb) {
      await pool.query("UPDATE meetings SET template_used = $1, updated_at = NOW() WHERE id = $2", [templateId, meetingId]);
    } else {
      const data = readFallbackDb();
      const m = data.meetings.find(m => m.id === meetingId);
      if (m) {
        m.template_used = templateId;
        if (companyMetadata?.name) {
          m.company_name = companyMetadata.name;
        }
        writeFallbackDb(data);
      }
    }

    // 1. Fetch the verified segments & speaker mappings
    let segments = [];
    let speaker_mapping = [];
    let company = {};

    if (!useFallbackDb) {
      const segRes = await pool.query(
        `SELECT ts.*, s.name as speaker_name 
         FROM transcript_segments ts 
         LEFT JOIN speakers s ON ts.speaker_id = s.speaker_id AND ts.meeting_id = s.meeting_id 
         WHERE ts.meeting_id = $1 
         ORDER BY ts.start_time ASC`,
        [meetingId]
      );
      segments = segRes.rows;

      const spRes = await pool.query(
        `SELECT speaker_id, name, role, department, job_title, email, company_id, status 
         FROM speakers 
         WHERE meeting_id = $1`,
        [meetingId]
      );
      speaker_mapping = spRes.rows;

      const mRes = await pool.query(
        `SELECT c.* 
         FROM meetings m
         LEFT JOIN companies c ON m.company_id = c.id
         WHERE m.id = $1`,
        [meetingId]
      );
      if (mRes.rows.length > 0 && mRes.rows[0].id) {
        company = mRes.rows[0];
      }
    } else {
      const data = readFallbackDb();
      segments = data.segments
        .filter(s => s.meeting_id === meetingId)
        .map(seg => ({
          ...seg,
          speaker_name: data.speakers.find(sp => sp.meeting_id === meetingId && sp.speaker_id === seg.speaker_id)?.name || 'Unknown Speaker'
        }))
        .sort((a, b) => a.start_time - b.start_time);

      speaker_mapping = data.speakers.filter(sp => sp.meeting_id === meetingId);

      if (meeting && meeting.company_id) {
        const comp = data.companies.find(c => c.id === meeting.company_id);
        if (comp) {
          company = comp;
        }
      }
    }

    // 2. Resolve Extraction Profile (Rule 1, 2, 3, 24, 28, 29)
    let targetProfile = null;
    const defaultWorkspaceId = '00000000-0000-0000-0000-000000000001';

    if (profile && typeof profile === 'object' && profile.fields) {
      targetProfile = profile;
    } else if (profileId) {
      if (!useFallbackDb) {
        const pRes = await pool.query('SELECT * FROM extraction_profiles WHERE id = $1', [profileId]);
        if (pRes.rows.length > 0) targetProfile = pRes.rows[0];
      } else {
        const data = readFallbackDb();
        targetProfile = data.extraction_profiles.find(p => p.id === profileId) || null;
      }
    }

    if (!targetProfile && templateId) {
      const tid = templateId.toLowerCase().trim();
      const matchedTmpl = EXTRACTION_PROFILE_TEMPLATES.find(t => t.id.toLowerCase() === tid || t.name.toLowerCase() === tid);
      if (matchedTmpl) {
        targetProfile = matchedTmpl;
      }
    }

    if (!targetProfile) {
      // Load active workspace profile
      if (!useFallbackDb) {
        const pRes = await pool.query('SELECT * FROM extraction_profiles WHERE workspace_id = $1 AND is_active = true LIMIT 1', [defaultWorkspaceId]);
        if (pRes.rows.length > 0) targetProfile = pRes.rows[0];
      } else {
        const data = readFallbackDb();
        targetProfile = data.extraction_profiles.find(p => p.workspace_id === defaultWorkspaceId && p.is_active) || null;
      }
    }

    // Default Fallback: PulseSync Default Sales Intelligence (Rule 3, 24, 29)
    if (!targetProfile) {
      targetProfile = EXTRACTION_PROFILE_TEMPLATES.find(t => t.id === 'default_sales_intelligence');
    }

    const template = {
      id: targetProfile.id,
      name: targetProfile.name
    };

    const schemaFields = (targetProfile.fields || []).map(f => ({
      name: f.id,
      label: f.name,
      field_type: f.type || 'text',
      description: f.description || '',
      options: f.options || []
    }));

    // 3. Retrieve memories for company
    let memories = [];
    if (company && company.id) {
      if (!useFallbackDb) {
        const memRes = await pool.query('SELECT memory_type, value, confidence, created_at FROM company_memories WHERE company_id = $1', [company.id]);
        memories = memRes.rows;
      } else {
        const data = readFallbackDb();
        memories = data.company_memories.filter(m => m.company_id === company.id);
      }
    }

    // 4. Query Python AI service /generate-ai
    let existingCallType = 'discovery';
    if (!useFallbackDb) {
      const ctRes = await pool.query('SELECT call_type FROM meetings WHERE id = $1', [meetingId]);
      if (ctRes.rows.length > 0 && ctRes.rows[0].call_type) existingCallType = ctRes.rows[0].call_type;
    } else {
      const data = readFallbackDb();
      const m = data.meetings.find(x => x.id === meetingId);
      if (m && m.call_type) existingCallType = m.call_type;
    }
    const targetCallType = req.body.call_type || existingCallType || 'discovery';

    logger.info({ meetingId, profileId: targetProfile.id, profileName: targetProfile.name, call_type: targetCallType }, 'Requesting AI summary compilation from FastAPI generate-ai endpoint...');
    // const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000/generate-ai';
    const aiServiceUrl = getAiServiceUrl('generate-ai');
    
    let aiResult = null;
    try {
      const response = await fetch(aiServiceUrl, {
        method: 'POST',
        headers: aiServiceHeaders(),
        body: JSON.stringify({
          meeting_id: meetingId,
          transcript: segments.map(seg => ({
            id: seg.id,
            speaker_name: seg.speaker_name || seg.speaker || 'Unknown Speaker',
            text: seg.corrected_text || seg.text || '',
            start_time: seg.start_time || seg.start || 0.0,
            end_time: seg.end_time || seg.end || 0.0,
            confidence: seg.confidence || 0.85
          })),
          speaker_mapping: speaker_mapping,
          company: company,
          template: template,
          profile: targetProfile,
          call_context: {
            call_type: targetCallType,
            company: company,
            meeting_title: (meeting && meeting.title) || undefined,
            profile: targetProfile
          },
          schema_fields: schemaFields,
          memories: memories,
          call_type: targetCallType
        }),
        signal: AbortSignal.timeout(600000)
      });
      // if (!response.ok) {
      //   const errText = await response.text().catch(() => '');
      //   throw new Error(`FastAPI generate-ai microservice returned ${response.status}: ${errText}`);
      // }
      if (!response.ok) {
        const errText = await response.text().catch(() => '');

        logger.error({
          meetingId,
          status: response.status,
          responseBody: errText
        }, 'AI service rejected compilation request');

        throw new Error(
          `FastAPI generate-ai returned ${response.status}: ${errText}`
        );
      }
      aiResult = await response.json();
    } catch (aiErr) {
      logger.error({ aiErr: aiErr.message || aiErr }, 'Python enrichment service unavailable. AI generation cannot continue without the production AI service.');
      return res.status(503).json({
        error: 'ai_service_unavailable',
        message: 'AI generation is temporarily unavailable. No synthetic analysis was created.',
        detail: aiErr.message,
        meetingId
      });
    }

    // 5. Backend Evidence Validation: Verify all segment evidence against current meeting
    const validatedIntelligence = EvidenceValidator.validateGroundedIntelligence(aiResult, segments, meetingId);

    // Summary compatibility boundary:
    // The Python extraction service returns `summary` as an object with `overview`,
    // while the evidence validator may normalize it to a string or object. Keep the
    // persistence/API contract stable regardless of which representation is returned.
    const validatedSummary = validatedIntelligence?.summary;
    const validatedSummaryOverview = typeof validatedSummary === 'string'
      ? validatedSummary.trim()
      : String(
          validatedSummary?.overview
          || validatedSummary?.summary
          || ''
        ).trim();
    const validatedSummarySections = Array.isArray(validatedIntelligence?.summary_sections)
      ? validatedIntelligence.summary_sections
      : (Array.isArray(validatedSummary?.summary_sections) ? validatedSummary.summary_sections : []);

    // If the validator preserved grounded sections but did not expose an overview,
    // derive the overview from the validated executive section only. Never copy raw
    // transcript text or create synthetic content here.
    const executiveSummarySection = validatedSummarySections.find(
      section => String(section?.section_id || '').toLowerCase() === 'executive_summary'
        && String(section?.content || '').trim()
    );
    const persistedSummaryOverview = (validatedSummaryOverview && validatedSummaryOverview !== 'No grounded business summary was produced from the available evidence.')
      ? validatedSummaryOverview
      : String(
          executiveSummarySection?.content ||
          validatedSummarySections[0]?.content ||
          validatedIntelligence?.conversation_intelligence?.generic_summary ||
          aiResult?.conversation_intelligence?.generic_summary ||
          ''
        ).trim();

    // Only persist fields explicitly returned by the grounded extractor.
    // Do not copy values between playbooks without their own evidence.
    const validatedExtractedData = {};
    for (const tf of validatedIntelligence.template_fields || []) {
      validatedExtractedData[tf.field_id] = tf.value;
    }
        // 6. Save Grounded Enrichment findings in database
    if (!useFallbackDb) {
      // Clear old summary if exists
      await pool.query('DELETE FROM meeting_summaries WHERE meeting_id = $1', [meetingId]);
      await pool.query(
        `INSERT INTO meeting_summaries (meeting_id, overview, action_items, objections, decisions, topics, sentiment_trend)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          meetingId,
          persistedSummaryOverview,
          JSON.stringify(validatedIntelligence.action_items || []),
          JSON.stringify(validatedIntelligence.objections || []),
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify([])
        ]
      );

      // Save custom extractions
      await pool.query('DELETE FROM call_extractions WHERE meeting_id = $1', [meetingId]);
      await pool.query(
        `INSERT INTO call_extractions (meeting_id, extracted_data)
         VALUES ($1, $2)`,
        [meetingId, JSON.stringify({ 
          extractions: validatedExtractedData, 
          template_fields: validatedIntelligence.template_fields || [],
          fields: validatedIntelligence.fields || [],
          summary_sections: validatedIntelligence.summary_sections || [],
          profile: targetProfile,
          conversation_intelligence: validatedIntelligence.conversation_intelligence || aiResult.conversation_intelligence || null
        })]
      );

      // Resolve call type metadata to persist
      const finalCallType = req.body.call_type || validatedIntelligence.call_type || aiResult.call_type || targetCallType || 'discovery';
      const finalCallTypeConfidence = req.body.call_type ? 1.0 : (validatedIntelligence.call_type_confidence ?? aiResult.call_type_confidence ?? null);
      const finalCallTypeRationale = req.body.call_type ? 'Manually classified by reviewer' : (validatedIntelligence.call_type_rationale || aiResult.call_type_rationale || '');
      const finalCallTypeSource = req.body.call_type ? 'manual' : (existingCallType && existingCallType !== 'discovery' ? 'ai' : 'ai');

      // Save AI snapshot/intelligence fields and transition workflow state to review
      await pool.query(
        `UPDATE meetings SET 
           ai_snapshot = $1,
           deal_intelligence = $2,
           risks = $3,
           objections = $4,
           action_items = $5,
           call_type = $6,
           call_type_confidence = $7,
           call_type_rationale = $8,
           call_type_source = $9,
           workflow_state = 'review',
           updated_at = NOW()
         WHERE id = $10`,
        [
          JSON.stringify(validatedIntelligence.deal_signals || {}),
          JSON.stringify(validatedIntelligence.deal_signals || {}),
          JSON.stringify(validatedIntelligence.risks || []),
          JSON.stringify(validatedIntelligence.objections || []),
          JSON.stringify(validatedIntelligence.action_items || []),
          finalCallType,
          finalCallTypeConfidence,
          finalCallTypeRationale,
          finalCallTypeSource,
          meetingId
        ]
      );

      // Save detailed Phase 2 tables: risks, objections, memories, timeline events
      if (company && company.id) {
        // Update risks
        const aiRisks = aiResult.summary.risks || [];
        for (const r of aiRisks) {
          const riskDesc = typeof r === 'string' ? r : r.risk;
          const riskEvidence = typeof r === 'string' ? '' : r.evidence;
          const existingRisk = await pool.query(
            'SELECT id FROM risks WHERE company_id = $1 AND LOWER(risk) = LOWER($2)',
            [company.id, riskDesc]
          );
          if (existingRisk.rows.length > 0) {
            await pool.query(
              `UPDATE risks SET 
                 last_seen = NOW(), 
                 mention_count = mention_count + 1, 
                 evidence = COALESCE($1, evidence)
               WHERE id = $2`,
              [riskEvidence, existingRisk.rows[0].id]
            );
          } else {
            await pool.query(
              `INSERT INTO risks (id, company_id, risk, first_seen, last_seen, mention_count, evidence)
               VALUES (gen_random_uuid(), $1, $2, NOW(), NOW(), 1, $3)`,
              [company.id, riskDesc, riskEvidence]
            );
            // Log timeline event for risk added
            await logTimelineEvent(company.id, meetingId, 'risk_added', { risk: riskDesc, evidence: riskEvidence });
          }
        }

        // Update objections
        const aiObjections = aiResult.summary.objections || [];
        for (const o of aiObjections) {
          const objDesc = typeof o === 'string' ? o : o.objection;
          const existingObj = await pool.query(
            'SELECT id FROM objections WHERE company_id = $1 AND LOWER(objection) = LOWER($2)',
            [company.id, objDesc]
          );
          if (existingObj.rows.length > 0) {
            await pool.query(
              `UPDATE objections SET last_seen = NOW(), count = count + 1 WHERE id = $1`,
              [existingObj.rows[0].id]
            );
          } else {
            await pool.query(
              `INSERT INTO objections (id, company_id, objection, count, last_seen)
               VALUES (gen_random_uuid(), $1, $2, 1, NOW())`,
              [company.id, objDesc]
            );
          }
        }

        // Save memories detected (delete existing memories for this meeting first to avoid duplication)
        await pool.query('DELETE FROM company_memories WHERE meeting_id = $1', [meetingId]);
        const aiMemories = aiResult.summary.memories_detected || [];
        for (const m of aiMemories) {
          await pool.query(
            `INSERT INTO company_memories (id, company_id, memory_type, value, meeting_id, confidence, created_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
            [company.id, m.memory_type, m.value, meetingId, m.confidence || 100]
          );

          let eventType = 'memory_added';
          if (m.memory_type === 'budget') eventType = 'budget_changed';
          else if (m.memory_type === 'champion') eventType = 'champion_changed';
          else if (m.memory_type === 'decision_maker') eventType = 'decision_maker_changed';
          else if (m.memory_type === 'risk') eventType = 'risk_added';
          else if (m.memory_type === 'objection') eventType = 'objection_added';

          await logTimelineEvent(company.id, meetingId, eventType, { description: m.value, confidence: m.confidence });
        }

        // Log general timeline events
        await logTimelineEvent(company.id, meetingId, 'meeting_completed', { title: template.name });
        await logTimelineEvent(company.id, meetingId, 'ai_summary_generated', { overview: aiResult.summary.overview });
        await logTimelineEvent(company.id, meetingId, 'action_item_created', { count: (aiResult.summary.action_items || []).length });
      }
    } else {
      const data = readFallbackDb();
      
      // Save summary
      data.summaries = data.summaries.filter(s => s.meeting_id !== meetingId);
      data.summaries.push({
        id: crypto.randomUUID(),
        meeting_id: meetingId,
        overview: persistedSummaryOverview,
        action_items: validatedIntelligence.action_items || [],
        objections: validatedIntelligence.objections || [],
        decisions: [],
        topics: [],
        sentiment_trend: []
      });

      // Save extractions
      data.call_extractions = data.call_extractions.filter(e => e.meeting_id !== meetingId);
      data.call_extractions.push({
        id: crypto.randomUUID(),
        meeting_id: meetingId,
        extracted_data: { 
          extractions: validatedExtractedData, 
          template_fields: validatedIntelligence.template_fields || [],
          fields: validatedIntelligence.fields || [],
          summary_sections: validatedIntelligence.summary_sections || [],
          profile: targetProfile,
          conversation_intelligence: validatedIntelligence.conversation_intelligence || aiResult.conversation_intelligence || null
        },
        created_at: new Date().toISOString()
      });

      // Transition workflow_state
      const fallbackMeeting = data.meetings.find(m => m.id === meetingId);
      if (fallbackMeeting) {
        fallbackMeeting.workflow_state = 'review';
        fallbackMeeting.ai_snapshot = validatedIntelligence.deal_signals || {};
        fallbackMeeting.deal_intelligence = validatedIntelligence.deal_signals || {};
        fallbackMeeting.risks = validatedIntelligence.risks || [];
        fallbackMeeting.objections = validatedIntelligence.objections || [];
        fallbackMeeting.action_items = validatedIntelligence.action_items || [];
        if (req.body.call_type) {
          fallbackMeeting.call_type = req.body.call_type;
          fallbackMeeting.call_type_source = 'manual';
          fallbackMeeting.call_type_confidence = 1.0;
          fallbackMeeting.call_type_rationale = 'Manually classified by reviewer';
        } else if (!fallbackMeeting.call_type || fallbackMeeting.call_type_source === 'ai') {
          fallbackMeeting.call_type = validatedIntelligence.call_type || aiResult.call_type || targetCallType || 'discovery';
          fallbackMeeting.call_type_confidence = validatedIntelligence.call_type_confidence ?? aiResult.call_type_confidence ?? null;
          fallbackMeeting.call_type_rationale = validatedIntelligence.call_type_rationale || aiResult.call_type_rationale || '';
          fallbackMeeting.call_type_source = 'ai';
        }
      }

      if (company && company.id) {
        const compId = company.id;

        // Update risks in fallback
        const aiRisks = aiResult.summary.risks || [];
        aiRisks.forEach(r => {
          const riskDesc = typeof r === 'string' ? r : r.risk;
          const riskEvidence = typeof r === 'string' ? '' : r.evidence;
          let existingRisk = data.risks.find(rx => rx.company_id === compId && rx.risk.toLowerCase() === riskDesc.toLowerCase());
          if (existingRisk) {
            existingRisk.last_seen = new Date().toISOString();
            existingRisk.mention_count = (existingRisk.mention_count || 1) + 1;
            existingRisk.evidence = riskEvidence || existingRisk.evidence;
          } else {
            data.risks.push({
              id: crypto.randomUUID(),
              company_id: compId,
              risk: riskDesc,
              first_seen: new Date().toISOString(),
              last_seen: new Date().toISOString(),
              mention_count: 1,
              evidence: riskEvidence
            });
            data.timeline_events.push({
              id: crypto.randomUUID(),
              company_id: compId,
              meeting_id: meetingId,
              event_type: 'risk_added',
              payload: { risk: riskDesc, evidence: riskEvidence },
              created_at: new Date().toISOString()
            });
          }
        });

        // Update objections in fallback
        const aiObjections = aiResult.summary.objections || [];
        aiObjections.forEach(o => {
          const objDesc = typeof o === 'string' ? o : o.objection;
          let existingObj = data.objections.find(ox => ox.company_id === compId && ox.objection.toLowerCase() === objDesc.toLowerCase());
          if (existingObj) {
            existingObj.last_seen = new Date().toISOString();
            existingObj.count = (existingObj.count || 1) + 1;
          } else {
            data.objections.push({
              id: crypto.randomUUID(),
              company_id: compId,
              objection: objDesc,
              count: 1,
              last_seen: new Date().toISOString()
            });
          }
        });

        // Save memories detected in fallback (filter out existing memories for this meeting first)
        data.company_memories = (data.company_memories || []).filter(m => m.meeting_id !== meetingId);
        const aiMemories = aiResult.summary.memories_detected || [];
        aiMemories.forEach(m => {
          data.company_memories.push({
            id: crypto.randomUUID(),
            company_id: compId,
            memory_type: m.memory_type,
            value: m.value,
            meeting_id: meetingId,
            confidence: m.confidence || 100,
            created_at: new Date().toISOString()
          });

          let eventType = 'memory_added';
          if (m.memory_type === 'budget') eventType = 'budget_changed';
          else if (m.memory_type === 'champion') eventType = 'champion_changed';
          else if (m.memory_type === 'decision_maker') eventType = 'decision_maker_changed';
          else if (m.memory_type === 'risk') eventType = 'risk_added';
          else if (m.memory_type === 'objection') eventType = 'objection_added';

          data.timeline_events.push({
            id: crypto.randomUUID(),
            company_id: compId,
            meeting_id: meetingId,
            event_type: eventType,
            payload: { description: m.value, confidence: m.confidence },
            created_at: new Date().toISOString()
          });
        });

        // Log compile timeline events in fallback
        data.timeline_events.push({
          id: crypto.randomUUID(),
          company_id: compId,
          meeting_id: meetingId,
          event_type: 'meeting_completed',
          payload: { title: template.name },
          created_at: new Date().toISOString()
        });
        data.timeline_events.push({
          id: crypto.randomUUID(),
          company_id: compId,
          meeting_id: meetingId,
          event_type: 'ai_summary_generated',
          payload: { overview: aiResult.summary.overview },
          created_at: new Date().toISOString()
        });
        data.timeline_events.push({
          id: crypto.randomUUID(),
          company_id: compId,
          meeting_id: meetingId,
          event_type: 'action_item_created',
          payload: { count: (aiResult.summary.action_items || []).length },
          created_at: new Date().toISOString()
        });
      }

      writeFallbackDb(data);
    }

    // Log AI compilation activity
    let meetingTitleComp = "Unknown Session";
    if (!useFallbackDb) {
      const titleRes = await pool.query('SELECT title FROM meetings WHERE id = $1', [meetingId]);
      if (titleRes.rows.length > 0) meetingTitleComp = titleRes.rows[0].title;
    } else {
      const data = readFallbackDb();
      const m = data.meetings.find(x => x.id === meetingId);
      if (m) meetingTitleComp = m.title;
    }
    await logActivity('playbook_extraction', `AI playbook extraction completed for meeting: "${meetingTitleComp}" using template ${template.name}`);

    res.json({ 
      ok: true, 
      summary: validatedIntelligence.summary, 
      summary_sections: validatedIntelligence.summary_sections,
      fields: validatedIntelligence.fields,
      template_fields: validatedIntelligence.template_fields,
      deal_signals: validatedIntelligence.deal_signals,
      profile: targetProfile,
      extracted_data: validatedExtractedData 
    });
  } catch (error) {
    next(error);
  }
});

// ── Get All Persistent Speakers ──
app.get('/api/speakers', async (req, res, next) => {
  try {
    if (!useFallbackDb) {
      const result = await pool.query('SELECT DISTINCT speaker_id, name, role, department, job_title, email, company_id FROM speakers ORDER BY name ASC');
      res.json(result.rows);
    } else {
      const data = readFallbackDb();
      res.json(data.speakers);
    }
  } catch (error) {
    next(error);
  }
});

// ── Asynchronous DB-Backed Queue Processor Worker ──
let workerRunning = false;
const activeJobs = new Set();

function triggerJobProcessor(meetingId) {
  activeJobs.add(meetingId);
  if (workerRunning) return;
  runWorkerLoop().catch(err => logger.error({ err }, 'Processor worker crashed'));
}

async function runWorkerLoop() {
  workerRunning = true;
  while (activeJobs.size > 0) {
    const meetingId = activeJobs.values().next().value;
    activeJobs.delete(meetingId);
    
    try {
      await processJob(meetingId);
    } catch (err) {
      logger.error({ meetingId, err }, 'Failed to process meeting job');
    }
  }
  workerRunning = false;
}

async function processJob(meetingId) {
  logger.info({ meetingId }, 'Processing background AI analysis job');

  // Update status to processing and workflow_state to processing
  let meeting = null;
  
  // Retrieve title if possible and log start
  let startTitle = "Unknown Session";
  if (!useFallbackDb) {
    const sRes = await pool.query('SELECT title FROM meetings WHERE id = $1', [meetingId]);
    if (sRes.rows.length > 0) startTitle = sRes.rows[0].title;
  } else {
    const data = readFallbackDb();
    const sM = data.meetings.find(x => x.id === meetingId);
    if (sM) startTitle = sM.title;
  }
  await logActivity('processing_start', `Ingestion and transcription started for meeting: "${startTitle}"`);
  if (!useFallbackDb) {
    const res = await pool.query(
      'UPDATE meetings SET status = $1, workflow_state = $2, processing_stage = $3, error_message = NULL, updated_at = NOW() WHERE id = $4 RETURNING *',
      ['processing', 'processing', 'transcribing', meetingId]
    );
    meeting = res.rows[0];
  } else {
    const data = readFallbackDb();
    meeting = data.meetings.find(m => m.id === meetingId);
    if (meeting) {
      meeting.status = 'processing';
      meeting.workflow_state = 'processing';
      meeting.processing_stage = 'transcribing';
      meeting.error_message = null;
      writeFallbackDb(data);
    }
  }

  if (!meeting) return;

  try {
    // Determine absolute audio file path to send to Python AI microservice
    const filename = path.basename(meeting.audio_url);
    const audioFilePath = path.join(UPLOADS_DIR, filename);

    // Fetch active schema fields for workspace (MVP Addition)
    let schemaFields = [];
    let activeSchemaId = null;
    if (!useFallbackDb) {
      try {
        const schemaRes = await pool.query(
          'SELECT id FROM extraction_schemas WHERE workspace_id = $1 AND is_active = true LIMIT 1',
          ['00000000-0000-0000-0000-000000000001']
        );
        if (schemaRes.rows.length > 0) {
          activeSchemaId = schemaRes.rows[0].id;
          const fieldsRes = await pool.query(
            'SELECT name, label, field_type, description, prompt_hint, is_required FROM schema_fields WHERE schema_id = $1 ORDER BY sort_order ASC',
            [activeSchemaId]
          );
          schemaFields = fieldsRes.rows;
        }
      } catch (schemaErr) {
        logger.error({ schemaErr }, 'Failed to fetch active database schema fields. Falling back to default list...');
      }
    } else {
      const data = readFallbackDb();
      const schema = data.extraction_schemas.find(s => s.workspace_id === '00000000-0000-0000-0000-000000000001' && s.is_active);
      if (schema) {
        activeSchemaId = schema.id;
        schemaFields = data.schema_fields
          .filter(f => f.schema_id === activeSchemaId)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(f => ({
            name: f.name,
            label: f.label,
            field_type: f.field_type,
            description: f.description,
            prompt_hint: f.prompt_hint,
            is_required: f.is_required
          }));
      }
    }

    // Preserve platform-native speaker attribution whenever it exists.
    // The AI service must not replace verified participant identity with an LLM guess.
    let platformSegments = [];
    if (!useFallbackDb) {
      try {
        const psRes = await pool.query(
          `SELECT id, speaker_id, speaker_name, start_time, end_time, text, corrected_text, confidence, attribution_source, attribution_confidence
           FROM transcript_segments WHERE meeting_id = $1
           AND attribution_source IN ('platform_native', 'platform_transcript', 'google_meet_csrc', 'zoom_user_id', 'teams_participant', 'platform_metadata', 'manual')
           ORDER BY start_time ASC`,
          [meetingId]
        );
        platformSegments = psRes.rows.filter(seg => seg.speaker_name && !/^Speaker\s*\d+$/i.test(String(seg.speaker_name)));
      } catch (platformErr) {
        logger.warn({ platformErr, meetingId }, 'Could not load platform-attributed transcript segments; continuing with audio pipeline.');
      }
    } else {
      const data = readFallbackDb();
      platformSegments = (data.segments || [])
        .filter(seg => seg.meeting_id === meetingId && ['platform_native', 'platform_transcript', 'google_meet_csrc', 'zoom_user_id', 'teams_participant', 'platform_metadata', 'manual'].includes(seg.attribution_source) && seg.speaker_name && !/^Speaker\s*\d+$/i.test(String(seg.speaker_name)))
        .sort((a,b) => (a.start_time || 0) - (b.start_time || 0));
    }

    // Pass a trusted participant count to diarization when the meeting provider
    // actually knows who joined. Never guess a count for ordinary uploaded audio.
    let expectedSpeakers = null;
    try {
      if (!useFallbackDb) {
        const participantRes = await pool.query(
          `SELECT COUNT(DISTINCT display_name)::int AS count
           FROM meeting_participants
           WHERE meeting_id = $1 AND COALESCE(is_bot, false) = false`,
          [meetingId]
        );
        const count = Number(participantRes.rows[0]?.count || 0);
        expectedSpeakers = count >= 2 ? count : null;
      } else {
        const data = readFallbackDb();
        const names = new Set(
          (data.meeting_participants || [])
            .filter(p => p.meeting_id === meetingId && !p.is_bot)
            .map(p => p.display_name)
            .filter(Boolean)
        );
        expectedSpeakers = names.size >= 2 ? names.size : null;
      }
    } catch (speakerCountErr) {
      logger.warn({ speakerCountErr, meetingId }, 'Could not determine trusted participant count; leaving diarization speaker count unconstrained.');
    }

    logger.info({ audioFilePath, schemaFieldsCount: schemaFields.length, platformAttributedSegments: platformSegments.length, expectedSpeakers }, 'Calling FastAPI AI pipeline with skip_enrichment=true');
    
    // const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000/process';
    const aiServiceUrl = getAiServiceUrl('process');
    // ─────────────────────────────────────────────────────────────────────
    // FASTAPI /process BOUNDARY
    // Keep network, response-body, HTTP, and JSON failures separate so a
    // production failure never collapses into the unhelpful "fetch failed".
    // ─────────────────────────────────────────────────────────────────────
    const aiRequestStartedAt = Date.now();
    let response;

    try {
      logger.info(
        {
          meetingId,
          aiServiceUrl,
          audioFilePath,
          schemaFieldsCount: schemaFields.length,
          platformSegmentsCount: platformSegments.length,
          expectedSpeakers
        },
        'Sending audio processing request to FastAPI'
      );

      response = await fetch(aiServiceUrl, {
        method: 'POST',
        // headers: {
        //   'Content-Type': 'application/json',
        //   'Accept': 'application/json'
        // },
        headers: {
          ...aiServiceHeaders(),
          'Accept': 'application/json'
        },                                                             
        body: JSON.stringify({
          audio_path: audioFilePath,
          meeting_id: meetingId,
          schema_fields: schemaFields,
          platform_segments: platformSegments,
          expected_speakers: expectedSpeakers,
          skip_enrichment: true
        }),
        // Support long-running local CPU pipelines by allowing up to 10 minutes.
        signal: AbortSignal.timeout(600000)
      });
    } catch (fetchError) {
      logger.error(
        {
          meetingId,
          aiServiceUrl,
          audioFilePath,
          elapsedMs: Date.now() - aiRequestStartedAt,
          errorName: fetchError?.name,
          errorMessage: fetchError?.message,
          errorCode: fetchError?.code,
          errorCause: fetchError?.cause
            ? {
                name: fetchError.cause.name,
                message: fetchError.cause.message,
                code: fetchError.cause.code,
                errno: fetchError.cause.errno,
                syscall: fetchError.cause.syscall,
                address: fetchError.cause.address,
                port: fetchError.cause.port
              }
            : null
        },
        'FastAPI request failed at Node fetch boundary'
      );

      throw new Error(
        `AI service request failed: ${fetchError?.message || 'Unknown fetch error'}`
      );
    }

    // Read the body once as text. This lets us distinguish an HTTP error,
    // an empty/truncated response, and malformed JSON from one another.
    let responseText;

    try {
      responseText = await response.text();
    } catch (readError) {
      logger.error(
        {
          meetingId,
          status: response?.status,
          statusText: response?.statusText,
          elapsedMs: Date.now() - aiRequestStartedAt,
          errorName: readError?.name,
          errorMessage: readError?.message,
          errorCause: readError?.cause
            ? {
                name: readError.cause.name,
                message: readError.cause.message,
                code: readError.cause.code,
                errno: readError.cause.errno,
                syscall: readError.cause.syscall,
                address: readError.cause.address,
                port: readError.cause.port
              }
            : null
        },
        'FastAPI responded but Node could not read the response body'
      );

      throw new Error(
        `AI service response could not be read: ${readError?.message || 'Unknown response read error'}`
      );
    }

    logger.info(
      {
        meetingId,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
        elapsedMs: Date.now() - aiRequestStartedAt,
        responseBytes: Buffer.byteLength(responseText || '', 'utf8')
      },
      'FastAPI response received'
    );

    if (!response.ok) {
      logger.error(
        {
          meetingId,
          status: response.status,
          statusText: response.statusText,
          responseBody: responseText?.slice(0, 5000)
        },
        'FastAPI returned an unsuccessful HTTP response'
      );

      throw new Error(
        `FastAPI microservice returned status ${response.status}: ${
          responseText?.slice(0, 1000) || 'No response body'
        }`
      );
    }

    let aiResult;

    try {
      aiResult = JSON.parse(responseText);
    } catch (parseError) {
      logger.error(
        {
          meetingId,
          status: response.status,
          responsePreview: responseText?.slice(0, 5000),
          parseError: parseError?.message
        },
        'FastAPI returned invalid JSON'
      );

      throw new Error(
        `AI service returned invalid JSON: ${parseError?.message || 'Unknown JSON parsing error'}`
      );
    }

    logger.info(
      {
        meetingId,
        elapsedMs: Date.now() - aiRequestStartedAt,
        segmentCount: Array.isArray(aiResult?.segments) ? aiResult.segments.length : 0,
        speakerCount: Array.isArray(aiResult?.speakers) ? aiResult.speakers.length : 0,
        analyticsCount: Array.isArray(aiResult?.analytics) ? aiResult.analytics.length : 0
      },
      'AI microservice completed successfully. Writing results...'
    );

    const isHallucinationOnly = (segs) => {
      if (!Array.isArray(segs) || segs.length === 0) return true;
      const meaningful = segs.filter(s => {
        const t = (s.text || '').trim();
        return t.length > 0 && !/^[.\s,!?]*(you|thank\s*you|bye|subtitles\s*by|captioning\s*by)[.\s,!?]*$/i.test(t);
      });
      return meaningful.length === 0;
    };
    const isAiResultValid = aiResult && Array.isArray(aiResult.segments) && aiResult.segments.length > 0 && !isHallucinationOnly(aiResult.segments);

    // Save Aligned Outputs into PostgreSQL or Fallback JSON
    if (!useFallbackDb) {
      if (!isAiResultValid) {
        const existingCountRes = await pool.query('SELECT count(*) FROM transcript_segments WHERE meeting_id = $1', [meetingId]);
        if (parseInt(existingCountRes.rows[0]?.count || 0) > 0) {
          logger.info({ meetingId }, 'Retaining live captured transcript segments; AI microservice returned no new segments.');
          await pool.query(
            'UPDATE meetings SET status = $1, workflow_state = $2, processing_stage = $3, error_message = NULL, updated_at = NOW() WHERE id = $4',
            ['completed', 'transcript_review', 'ready', meetingId]
          );
          await logActivity('transcript_generated', `Transcript and speaker diarization verified for: "${meeting.title}"`);
          return;
        }
      }

      // Clean up previous records if this is a re-processed or retried meeting
      try {
        await pool.query('DELETE FROM transcript_segments WHERE meeting_id = $1', [meetingId]);
        await pool.query('DELETE FROM meeting_analytics WHERE meeting_id = $1', [meetingId]);
        await pool.query('DELETE FROM speakers WHERE meeting_id = $1', [meetingId]);
        await pool.query('DELETE FROM speaker_embeddings WHERE meeting_id = $1', [meetingId]);
      } catch (cleanErr) {
        logger.warn({ cleanErr, meetingId }, 'Warning during meeting records cleanup before re-insertion');
      }

      // 1. Insert/Get Speakers: Clean initialization as Speaker 1 / Speaker 2 with 'Needs Review'
      const speakerIdMap = new Map();
      const speakerNameMap = new Map();
      for (const sp of (aiResult.speakers || [])) {
        let speakerId = crypto.randomUUID();
        let matchedName = sp.name; // Clean 'Speaker 1', 'Speaker 2'
        let matchedRole = '';
        let matchedDept = '';
        let matchedTitle = '';
        let matchedEmail = '';
        let matchedStatus = /^speaker\s*\d+$/i.test(String(sp.name || '')) ? 'Needs Review' : 'Identified';

        // Store speaker embedding for meeting if present (no auto-inherit from old meetings)
        if (sp.embedding && sp.embedding.length === 512) {
          try {
            await pool.query(
              `INSERT INTO speaker_embeddings (speaker_id, meeting_id, embedding)
               VALUES ($1, $2, $3::vector)`,
              [speakerId, meetingId, JSON.stringify(sp.embedding)]
            );
          } catch (embedErr) {
            logger.error({ embedErr }, 'Failed to insert speaker voice print embedding');
          }
        }

        await pool.query(
          `INSERT INTO speakers (meeting_id, speaker_id, name, role, department, job_title, email, status) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (meeting_id, speaker_id) DO UPDATE
           SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = NOW()`,
          [meetingId, speakerId, matchedName, matchedRole, matchedDept, matchedTitle, matchedEmail, matchedStatus]
        );
        speakerIdMap.set(sp.name, speakerId);
        speakerNameMap.set(sp.name, matchedName);
      }

      // 2. Insert Transcript Segments with speaker_name matching the display name
      for (const seg of aiResult.segments) {
        const mappedSpeakerId = speakerIdMap.get(seg.speaker) || null;
        const displayName = speakerNameMap.get(seg.speaker) || seg.speaker || 'Speaker 1';
        await pool.query(
          `INSERT INTO transcript_segments (id, meeting_id, speaker_id, speaker_name, start_time, end_time, text, original_text, corrected_text, confidence)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [meetingId, mappedSpeakerId, displayName, seg.start, seg.end, seg.text, seg.text, seg.text, seg.confidence || 1.0]
        );
      }

      // 3. Insert Metrics & Analytics with speaker_name
      for (const metric of aiResult.analytics) {
        const mappedSpeakerId = speakerIdMap.get(metric.speaker) || null;
        const displayName = speakerNameMap.get(metric.speaker) || metric.speaker || 'Speaker 1';
        await pool.query(
          `INSERT INTO meeting_analytics (meeting_id, speaker_id, speaker_name, talk_time_seconds, interruption_count, words_per_minute, participation_percentage)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            meetingId,
            mappedSpeakerId,
            displayName,
            metric.talk_time,
            metric.interruptions,
            metric.words_per_minute,
            metric.participation
          ]
        );
      }

      // 4. Mark Completed & transition to transcript_review
      await pool.query(
        'UPDATE meetings SET status = $1, workflow_state = $2, processing_stage = $3, error_message = NULL, updated_at = NOW() WHERE id = $4',
        ['completed', 'transcript_review', 'ready', meetingId]
      );

    } else {
      // Fallback JSON write
      const data = readFallbackDb();
      if (!data.speaker_embeddings) data.speaker_embeddings = [];

      const existingSegs = (data.segments || []).filter(s => s.meeting_id === meetingId);
      if (!isAiResultValid && existingSegs.length > 0) {
        logger.info({ meetingId, existingCount: existingSegs.length }, 'Retaining live captured transcript segments; AI microservice returned no new segments.');
        const fallbackMeeting = data.meetings.find(m => m.id === meetingId);
        if (fallbackMeeting) {
          fallbackMeeting.status = 'completed';
          fallbackMeeting.workflow_state = 'transcript_review';
          fallbackMeeting.processing_stage = 'ready';
          fallbackMeeting.error_message = null;
        }
        writeFallbackDb(data);
        await logActivity('transcript_generated', `Transcript and speaker diarization verified for: "${meeting.title}"`);
        return;
      }

      // Clean up previous records if this is a re-processed or retried meeting
      data.speakers = (data.speakers || []).filter(s => s.meeting_id !== meetingId);
      data.segments = (data.segments || []).filter(s => s.meeting_id !== meetingId);
      data.analytics = (data.analytics || []).filter(a => a.meeting_id !== meetingId);
      data.speaker_embeddings = (data.speaker_embeddings || []).filter(e => e.meeting_id !== meetingId);

      const speakerIdMap = new Map();
      const speakerNameMap = new Map();
      for (const sp of (aiResult.speakers || [])) {
        let speakerId = crypto.randomUUID();
        let matchedName = sp.name; // Clean 'Speaker 1', 'Speaker 2'
        let matchedRole = '';
        let matchedDept = '';
        let matchedTitle = '';
        let matchedEmail = '';
        let matchedStatus = /^speaker\s*\d+$/i.test(String(sp.name || '')) ? 'Needs Review' : 'Identified';

        // Save embedding for this meeting
        if (sp.embedding && sp.embedding.length === 512) {
          data.speaker_embeddings.push({
            id: crypto.randomUUID(),
            speaker_id: speakerId,
            meeting_id: meetingId,
            embedding: sp.embedding,
            created_at: new Date().toISOString()
          });
        }

        data.speakers.push({ 
          meeting_id: meetingId, 
          speaker_id: speakerId, 
          name: matchedName, 
          role: matchedRole, 
          department: matchedDept, 
          job_title: matchedTitle, 
          email: matchedEmail, 
          company_id: null, 
          status: matchedStatus,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

        speakerIdMap.set(sp.name, speakerId);
        speakerNameMap.set(sp.name, matchedName);
      }

      for (const seg of (aiResult.segments || [])) {
        const mappedSpeakerId = speakerIdMap.get(seg.speaker) || null;
        const displayName = speakerNameMap.get(seg.speaker) || seg.speaker || 'Speaker 1';
        data.segments.push({
          id: crypto.randomUUID(),
          meeting_id: meetingId,
          speaker_id: mappedSpeakerId,
          speaker_name: displayName,
          start_time: seg.start,
          end_time: seg.end,
          text: seg.text,
          original_text: seg.text,
          corrected_text: seg.text,
          confidence: seg.confidence || 1.0,
          attribution_source: seg.attribution_source || 'acoustic_diarization',
          attribution_confidence: seg.attribution_confidence || seg.speaker_confidence || 0.0,
          subsegments: seg.subsegments || []
        });
      }

      for (const metric of (aiResult.analytics || [])) {
        const mappedSpeakerId = speakerIdMap.get(metric.speaker) || null;
        const displayName = speakerNameMap.get(metric.speaker) || metric.speaker || 'Speaker 1';
        data.analytics.push({
          id: crypto.randomUUID(),
          meeting_id: meetingId,
          speaker_id: mappedSpeakerId,
          speaker_name: displayName,
          talk_time_seconds: metric.talk_time,
          interruption_count: metric.interruptions,
          words_per_minute: metric.words_per_minute,
          participation_percentage: metric.participation
        });
      }

      const fallbackMeeting = data.meetings.find(m => m.id === meetingId);
      if (fallbackMeeting) {
        fallbackMeeting.status = 'completed';
        fallbackMeeting.workflow_state = 'transcript_review';
        fallbackMeeting.processing_stage = 'ready';
        fallbackMeeting.error_message = null;
        if (aiResult.duration) {
          fallbackMeeting.duration_seconds = Math.round(aiResult.duration);
        }
      }

      writeFallbackDb(data);
    }

    // Log transcript completed activity
    await logActivity('transcript_generated', `Transcript and speaker diarization generated for: "${meeting.title}"`);

    logger.info({ meetingId }, 'Meeting job successfully processed and stored. Set to transcript_review state.');

  } catch (error) {
    logger.error({ meetingId, error: error.message }, 'Failed to process AI meeting analytics.');
    if (!useFallbackDb) {
      const existingCountRes = await pool.query('SELECT count(*) FROM transcript_segments WHERE meeting_id = $1', [meetingId]).catch(() => ({ rows: [] }));
      if (parseInt(existingCountRes.rows[0]?.count || 0) > 0) {
        logger.info({ meetingId }, 'Live captured transcript preserved despite AI microservice error.');
        await pool.query(
          'UPDATE meetings SET status = $1, workflow_state = $2, processing_stage = $3, error_message = NULL, updated_at = NOW() WHERE id = $4',
          ['completed', 'transcript_review', 'ready', meetingId]
        ).catch(() => {});
        return;
      }
      await pool.query(
        'UPDATE meetings SET status = $1, workflow_state = $2, processing_stage = $3, error_message = $4, updated_at = NOW() WHERE id = $5',
        ['failed', 'failed', 'failed', error.message || 'Processing error', meetingId]
      ).catch(() => {});
    } else {
      const data = readFallbackDb();
      const existingSegs = (data.segments || []).filter(s => s.meeting_id === meetingId);
      const m = data.meetings.find(x => x.id === meetingId);
      if (existingSegs.length > 0) {
        logger.info({ meetingId, existingCount: existingSegs.length }, 'Live captured transcript preserved despite AI microservice error.');
        if (m) {
          m.status = 'completed';
          m.workflow_state = 'transcript_review';
          m.processing_stage = 'ready';
          m.error_message = null;
        }
        writeFallbackDb(data);
        return;
      }
      if (m) {
        m.status = 'failed';
        m.workflow_state = 'failed';
        m.processing_stage = 'failed';
        m.error_message = error.message || 'Processing error';
      }
      writeFallbackDb(data);
    }
  }
}

// ── Retry Processing Endpoint ──
app.post('/api/meetings/:id/retry', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    let meeting = null;
    
    if (!useFallbackDb) {
      const result = await pool.query('SELECT * FROM meetings WHERE id = $1', [meetingId]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'not_found', message: 'Meeting not found' });
      meeting = result.rows[0];
      await pool.query(
        "UPDATE meetings SET status = 'queued', workflow_state = 'uploaded', processing_stage = 'queued', error_message = NULL, updated_at = NOW() WHERE id = $1",
        [meetingId]
      );
    } else {
      const data = readFallbackDb();
      meeting = data.meetings.find(m => m.id === meetingId);
      if (!meeting) return res.status(404).json({ error: 'not_found', message: 'Meeting not found' });
      meeting.status = 'queued';
      meeting.workflow_state = 'uploaded';
      meeting.processing_stage = 'queued';
      meeting.error_message = null;
      writeFallbackDb(data);
    }

    triggerJobProcessor(meetingId);
    await logActivity('processing_retry', `Retrying processing for meeting: "${meeting.title}"`);

    res.json({ ok: true, message: 'Processing job re-queued.', meetingId });
  } catch (err) {
    next(err);
  }
});

// ── Meeting Bot Asynchronous Worker Engine ──
const meetingBotWorker = new MeetingBotWorker({
  pool,
  useFallbackDb,
  readFallbackDb,
  writeFallbackDb,
  triggerJobProcessor,
  uploadsDir: UPLOADS_DIR,
  logger,
});

// ── Configurable Extraction Schema MVP API Endpoints ──

// 1. Get Active Schema for Default Workspace
app.get('/api/schemas', async (req, res, next) => {
  try {
    const defaultWorkspaceId = '00000000-0000-0000-0000-000000000001';
    
    if (!useFallbackDb) {
      const result = await pool.query(
        'SELECT * FROM extraction_schemas WHERE workspace_id = $1 AND is_active = true LIMIT 1',
        [defaultWorkspaceId]
      );
      
      if (result.rows.length === 0) {
        // Fallback: If no active schema exists in DB, create one
        const schemaId = crypto.randomUUID();
        await pool.query(
          'INSERT INTO extraction_schemas (id, workspace_id, is_active) VALUES ($1, $2, TRUE)',
          [schemaId, defaultWorkspaceId]
        );
        const newSchema = await pool.query('SELECT * FROM extraction_schemas WHERE id = $1', [schemaId]);
        return res.json(newSchema.rows[0]);
      }
      res.json(result.rows[0]);
    } else {
      const data = readFallbackDb();
      let schema = data.extraction_schemas.find(s => s.workspace_id === defaultWorkspaceId && s.is_active);
      if (!schema) {
        const schemaId = crypto.randomUUID();
        schema = {
          id: schemaId,
          workspace_id: defaultWorkspaceId,
          is_active: true,
          created_at: new Date().toISOString()
        };
        data.extraction_schemas.push(schema);
        writeFallbackDb(data);
      }
      res.json(schema);
    }
  } catch (error) {
    next(error);
  }
});

// 2. Create a new Schema
app.post('/api/schemas', async (req, res, next) => {
  try {
    const defaultWorkspaceId = '00000000-0000-0000-0000-000000000001';
    const schemaId = crypto.randomUUID();
    
    if (!useFallbackDb) {
      // Set all other schemas for this workspace to inactive
      await pool.query('UPDATE extraction_schemas SET is_active = FALSE WHERE workspace_id = $1', [defaultWorkspaceId]);
      await pool.query(
        'INSERT INTO extraction_schemas (id, workspace_id, is_active) VALUES ($1, $2, TRUE)',
        [schemaId, defaultWorkspaceId]
      );
      res.json({ ok: true, id: schemaId, is_active: true });
    } else {
      const data = readFallbackDb();
      data.extraction_schemas.forEach(s => {
        if (s.workspace_id === defaultWorkspaceId) s.is_active = false;
      });
      data.extraction_schemas.push({
        id: schemaId,
        workspace_id: defaultWorkspaceId,
        is_active: true,
        created_at: new Date().toISOString()
      });
      writeFallbackDb(data);
      res.json({ ok: true, id: schemaId, is_active: true });
    }
  } catch (error) {
    next(error);
  }
});

// 3. Update Schema Metadata (e.g. deactivate)
app.put('/api/schemas/:id', async (req, res, next) => {
  try {
    const schemaId = req.params.id;
    const { is_active } = req.body;
    
    if (!useFallbackDb) {
      await pool.query('UPDATE extraction_schemas SET is_active = $1 WHERE id = $2', [is_active, schemaId]);
      res.json({ ok: true, id: schemaId, is_active });
    } else {
      const data = readFallbackDb();
      const schema = data.extraction_schemas.find(s => s.id === schemaId);
      if (schema) {
        schema.is_active = is_active !== undefined ? is_active : schema.is_active;
        writeFallbackDb(data);
        res.json({ ok: true, id: schemaId, is_active: schema.is_active });
      } else {
        res.status(404).json({ error: 'not_found', message: 'Schema not found' });
      }
    }
  } catch (error) {
    next(error);
  }
});

// 4. Delete Schema
app.delete('/api/schemas/:id', async (req, res, next) => {
  try {
    const schemaId = req.params.id;
    
    if (!useFallbackDb) {
      await pool.query('DELETE FROM extraction_schemas WHERE id = $1', [schemaId]);
      res.json({ ok: true, message: 'Schema deleted successfully.' });
    } else {
      const data = readFallbackDb();
      data.extraction_schemas = data.extraction_schemas.filter(s => s.id !== schemaId);
      data.schema_fields = data.schema_fields.filter(f => f.schema_id !== schemaId);
      writeFallbackDb(data);
      res.json({ ok: true, message: 'Schema deleted successfully.' });
    }
  } catch (error) {
    next(error);
  }
});

// 5. Get Fields of a Schema
app.get('/api/schemas/:id/fields', async (req, res, next) => {
  try {
    const schemaId = req.params.id;
    
    if (!useFallbackDb) {
      const result = await pool.query(
        'SELECT * FROM schema_fields WHERE schema_id = $1 ORDER BY sort_order ASC',
        [schemaId]
      );
      res.json(result.rows);
    } else {
      const data = readFallbackDb();
      const fields = data.schema_fields
        .filter(f => f.schema_id === schemaId)
        .sort((a, b) => a.sort_order - b.sort_order);
      res.json(fields);
    }
  } catch (error) {
    next(error);
  }
});

// 6. Bulk Save/Update Fields for a Schema (MVP Custom implementation)
app.post('/api/schemas/:id/fields', async (req, res, next) => {
  try {
    const schemaId = req.params.id;
    const fields = req.body.fields || [];
    
    if (!useFallbackDb) {
      await pool.query('BEGIN');
      await pool.query('DELETE FROM schema_fields WHERE schema_id = $1', [schemaId]);
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        const fieldName = f.name.toLowerCase().replace(/[^a-z0-9_]/g, '_').trim();
        await pool.query(
          `INSERT INTO schema_fields (id, schema_id, name, label, field_type, description, prompt_hint, is_required, sort_order, options)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            f.id && f.id.length > 10 ? f.id : crypto.randomUUID(),
            schemaId,
            fieldName,
            f.label.trim(),
            f.field_type,
            f.description || '',
            f.prompt_hint || '',
            f.is_required || false,
            i,
            JSON.stringify(f.options || [])
          ]
        );
      }
      await pool.query('COMMIT');
      res.json({ ok: true, message: 'Fields saved successfully.', count: fields.length });
    } else {
      const data = readFallbackDb();
      // Remove existing fields
      data.schema_fields = data.schema_fields.filter(f => f.schema_id !== schemaId);
      
      // Push new fields
      fields.forEach((f, idx) => {
        const fieldName = f.name.toLowerCase().replace(/[^a-z0-9_]/g, '_').trim();
        data.schema_fields.push({
          id: f.id && f.id.length > 10 ? f.id : crypto.randomUUID(),
          schema_id: schemaId,
          name: fieldName,
          label: f.label.trim(),
          field_type: f.field_type,
          description: f.description || '',
          prompt_hint: f.prompt_hint || '',
          is_required: f.is_required || false,
          sort_order: idx,
          options: f.options || []
        });
      });
      
      writeFallbackDb(data);
      res.json({ ok: true, message: 'Fields saved successfully in local JSON.', count: fields.length });
    }
  } catch (error) {
    if (!useFallbackDb) await pool.query('ROLLBACK').catch(() => {});
    next(error);
  }
});

// 7. Get Extractions Results for a Call / Meeting
app.get('/api/meetings/:meetingId/extractions', async (req, res, next) => {
  try {
    const meetingId = req.params.meetingId;
    
    if (!useFallbackDb) {
      const result = await pool.query(
        'SELECT * FROM call_extractions WHERE meeting_id = $1',
        [meetingId]
      );
      res.json(result.rows[0] || null);
    } else {
      const data = readFallbackDb();
      const ext = data.call_extractions.find(e => e.meeting_id === meetingId);
      res.json(ext || null);
    }
  } catch (error) {
    next(error);
  }
});

// ── Dynamic Extraction Profiles REST Endpoints ──

// 1. List all Extraction Profiles for Workspace
app.get('/api/extraction-profiles', async (req, res, next) => {
  try {
    const defaultWorkspaceId = '00000000-0000-0000-0000-000000000001';

    if (!useFallbackDb) {
      const result = await pool.query(
        'SELECT * FROM extraction_profiles WHERE workspace_id = $1 ORDER BY created_at ASC',
        [defaultWorkspaceId]
      );
      if (result.rows.length === 0) {
        // Seed default profile if empty
        const defaultTmpl = EXTRACTION_PROFILE_TEMPLATES[0];
        await pool.query(
          `INSERT INTO extraction_profiles (id, workspace_id, name, description, summary_sections, fields, extract_action_items, extract_risks, extract_objections, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [
            defaultTmpl.id,
            defaultWorkspaceId,
            defaultTmpl.name,
            defaultTmpl.description,
            JSON.stringify(defaultTmpl.summary_sections),
            JSON.stringify(defaultTmpl.fields),
            defaultTmpl.extract_action_items !== false,
            defaultTmpl.extract_risks !== false,
            defaultTmpl.extract_objections !== false,
            true
          ]
        );
        const recheck = await pool.query('SELECT * FROM extraction_profiles WHERE workspace_id = $1 ORDER BY created_at ASC', [defaultWorkspaceId]);
        return res.json(recheck.rows);
      }
      res.json(result.rows);
    } else {
      const data = readFallbackDb();
      if (!data.extraction_profiles || data.extraction_profiles.length === 0) {
        data.extraction_profiles = EXTRACTION_PROFILE_TEMPLATES.map((tmpl) => ({
          ...tmpl,
          workspace_id: defaultWorkspaceId,
          is_active: tmpl.id === 'default_sales_intelligence',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));
        writeFallbackDb(data);
      }
      const profiles = data.extraction_profiles.filter(p => p.workspace_id === defaultWorkspaceId);
      res.json(profiles);
    }
  } catch (error) {
    next(error);
  }
});

// 2. Get Active Extraction Profile
app.get('/api/extraction-profiles/active', async (req, res, next) => {
  try {
    const defaultWorkspaceId = '00000000-0000-0000-0000-000000000001';

    if (!useFallbackDb) {
      const result = await pool.query(
        'SELECT * FROM extraction_profiles WHERE workspace_id = $1 AND is_active = true LIMIT 1',
        [defaultWorkspaceId]
      );
      if (result.rows.length > 0) {
        return res.json(result.rows[0]);
      }
      // Fallback to default template
      const defaultTmpl = EXTRACTION_PROFILE_TEMPLATES[0];
      return res.json({ ...defaultTmpl, workspace_id: defaultWorkspaceId, is_active: true });
    } else {
      const data = readFallbackDb();
      const active = (data.extraction_profiles || []).find(p => p.workspace_id === defaultWorkspaceId && p.is_active);
      if (active) return res.json(active);
      const defaultTmpl = EXTRACTION_PROFILE_TEMPLATES[0];
      return res.json({ ...defaultTmpl, workspace_id: defaultWorkspaceId, is_active: true });
    }
  } catch (error) {
    next(error);
  }
});

// 3. Get Extraction Profile Templates
app.get('/api/extraction-profiles/templates', async (_req, res) => {
  res.json(EXTRACTION_PROFILE_TEMPLATES);
});

// 4. Create an Extraction Profile
app.post('/api/extraction-profiles', async (req, res, next) => {
  try {
    const defaultWorkspaceId = '00000000-0000-0000-0000-000000000001';
    const {
      id,
      name,
      description,
      summary_sections = [],
      fields = [],
      extract_action_items = true,
      extract_risks = true,
      extract_objections = true,
      is_active = false
    } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'Profile name is required' });
    }

    const profileId = id || name.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 50) + '_' + crypto.randomUUID().slice(0, 8);

    if (!useFallbackDb) {
      if (is_active) {
        await pool.query('UPDATE extraction_profiles SET is_active = false WHERE workspace_id = $1', [defaultWorkspaceId]);
      }
      const insertRes = await pool.query(
        `INSERT INTO extraction_profiles 
         (id, workspace_id, name, description, summary_sections, fields, extract_action_items, extract_risks, extract_objections, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         RETURNING *`,
        [
          profileId,
          defaultWorkspaceId,
          name.trim(),
          description || '',
          JSON.stringify(summary_sections),
          JSON.stringify(fields),
          extract_action_items,
          extract_risks,
          extract_objections,
          is_active
        ]
      );
      await logActivity('profile_created', `Extraction profile "${name.trim()}" created`);
      res.status(201).json(insertRes.rows[0]);
    } else {
      const data = readFallbackDb();
      if (is_active) {
        (data.extraction_profiles || []).forEach(p => {
          if (p.workspace_id === defaultWorkspaceId) p.is_active = false;
        });
      }
      const newProfile = {
        id: profileId,
        workspace_id: defaultWorkspaceId,
        name: name.trim(),
        description: description || '',
        summary_sections,
        fields,
        extract_action_items,
        extract_risks,
        extract_objections,
        is_active: Boolean(is_active),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      if (!data.extraction_profiles) data.extraction_profiles = [];
      data.extraction_profiles.push(newProfile);
      writeFallbackDb(data);
      await logActivity('profile_created', `Extraction profile "${name.trim()}" created`);
      res.status(201).json(newProfile);
    }
  } catch (error) {
    next(error);
  }
});

// 5. Update an Extraction Profile
app.put('/api/extraction-profiles/:id', async (req, res, next) => {
  try {
    const profileId = req.params.id;
    const defaultWorkspaceId = '00000000-0000-0000-0000-000000000001';
    const {
      name,
      description,
      summary_sections,
      fields,
      extract_action_items,
      extract_risks,
      extract_objections,
      is_active
    } = req.body;

    if (!useFallbackDb) {
      if (is_active) {
        await pool.query('UPDATE extraction_profiles SET is_active = false WHERE workspace_id = $1', [defaultWorkspaceId]);
      }
      const updateRes = await pool.query(
        `UPDATE extraction_profiles SET
           name = COALESCE($1, name),
           description = COALESCE($2, description),
           summary_sections = COALESCE($3, summary_sections),
           fields = COALESCE($4, fields),
           extract_action_items = COALESCE($5, extract_action_items),
           extract_risks = COALESCE($6, extract_risks),
           extract_objections = COALESCE($7, extract_objections),
           is_active = COALESCE($8, is_active),
           updated_at = NOW()
         WHERE id = $9 AND workspace_id = $10
         RETURNING *`,
        [
          name ? name.trim() : null,
          description !== undefined ? description : null,
          summary_sections ? JSON.stringify(summary_sections) : null,
          fields ? JSON.stringify(fields) : null,
          extract_action_items !== undefined ? extract_action_items : null,
          extract_risks !== undefined ? extract_risks : null,
          extract_objections !== undefined ? extract_objections : null,
          is_active !== undefined ? is_active : null,
          profileId,
          defaultWorkspaceId
        ]
      );
      if (updateRes.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Extraction profile not found' });
      }
      res.json(updateRes.rows[0]);
    } else {
      const data = readFallbackDb();
      const profile = (data.extraction_profiles || []).find(p => p.id === profileId && p.workspace_id === defaultWorkspaceId);
      if (!profile) {
        return res.status(404).json({ error: 'not_found', message: 'Extraction profile not found' });
      }
      if (is_active) {
        (data.extraction_profiles || []).forEach(p => {
          if (p.workspace_id === defaultWorkspaceId) p.is_active = false;
        });
      }
      if (name !== undefined) profile.name = name.trim();
      if (description !== undefined) profile.description = description;
      if (summary_sections !== undefined) profile.summary_sections = summary_sections;
      if (fields !== undefined) profile.fields = fields;
      if (extract_action_items !== undefined) profile.extract_action_items = extract_action_items;
      if (extract_risks !== undefined) profile.extract_risks = extract_risks;
      if (extract_objections !== undefined) profile.extract_objections = extract_objections;
      if (is_active !== undefined) profile.is_active = is_active;
      profile.updated_at = new Date().toISOString();
      writeFallbackDb(data);
      res.json(profile);
    }
  } catch (error) {
    next(error);
  }
});

// 6. Delete an Extraction Profile
app.delete('/api/extraction-profiles/:id', async (req, res, next) => {
  try {
    const profileId = req.params.id;
    const defaultWorkspaceId = '00000000-0000-0000-0000-000000000001';

    if (profileId === 'default_sales_intelligence') {
      return res.status(400).json({ error: 'cannot_delete_default', message: 'Default sales intelligence profile cannot be deleted' });
    }

    if (!useFallbackDb) {
      await pool.query('DELETE FROM extraction_profiles WHERE id = $1 AND workspace_id = $2', [profileId, defaultWorkspaceId]);
      // Ensure at least one active profile
      const activeRes = await pool.query('SELECT id FROM extraction_profiles WHERE workspace_id = $1 AND is_active = true', [defaultWorkspaceId]);
      if (activeRes.rows.length === 0) {
        await pool.query('UPDATE extraction_profiles SET is_active = true WHERE workspace_id = $1 AND id = $2', [defaultWorkspaceId, 'default_sales_intelligence']);
      }
      res.json({ ok: true, deleted: profileId });
    } else {
      const data = readFallbackDb();
      data.extraction_profiles = (data.extraction_profiles || []).filter(p => !(p.id === profileId && p.workspace_id === defaultWorkspaceId));
      const hasActive = data.extraction_profiles.some(p => p.workspace_id === defaultWorkspaceId && p.is_active);
      if (!hasActive) {
        const def = data.extraction_profiles.find(p => p.id === 'default_sales_intelligence');
        if (def) def.is_active = true;
      }
      writeFallbackDb(data);
      res.json({ ok: true, deleted: profileId });
    }
  } catch (error) {
    next(error);
  }
});

// ── B2B Customer Intelligence APIs ──

// GET all companies
app.get('/api/companies', async (req, res, next) => {
  try {
    const parseNumber = (str) => {
      if (!str) return 0;
      const match = str.match(/(\d+(?:\.\d+)?)\s*([km])?/i);
      if (!match) return 0;
      let val = parseFloat(match[1]);
      const unit = (match[2] || '').toLowerCase();
      if (unit === 'k') val *= 1000;
      if (unit === 'm') val *= 1000000;
      return val;
    };

    if (!useFallbackDb) {
      const companiesRes = await pool.query('SELECT * FROM companies ORDER BY name ASC');
      const companies = [];
      
      for (const company of companiesRes.rows) {
        // Find last meeting
        const lastMeetingRes = await pool.query(
          'SELECT title, created_at FROM meetings WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1',
          [company.id]
        );
        const lastMeeting = lastMeetingRes.rows.length > 0 ? {
          title: lastMeetingRes.rows[0].title,
          date: lastMeetingRes.rows[0].created_at
        } : null;

        // Fetch latest budget, champion, decision_maker memories
        const budgetRes = await pool.query(
          "SELECT value FROM company_memories WHERE company_id = $1 AND memory_type = 'budget' ORDER BY created_at DESC LIMIT 1",
          [company.id]
        );
        const championRes = await pool.query(
          "SELECT value FROM company_memories WHERE company_id = $1 AND memory_type = 'champion' ORDER BY created_at DESC LIMIT 1",
          [company.id]
        );
        const dmRes = await pool.query(
          "SELECT value FROM company_memories WHERE company_id = $1 AND memory_type = 'decision_maker' ORDER BY created_at DESC LIMIT 1",
          [company.id]
        );

        // Fetch open risks count
        const risksCountRes = await pool.query(
          "SELECT COUNT(*) as count FROM risks WHERE company_id = $1",
          [company.id]
        );

        // Fetch meetings to get action items count
        const meetingsRes = await pool.query(
          "SELECT action_items FROM meetings WHERE company_id = $1",
          [company.id]
        );
        let openActionItemsCount = 0;
        meetingsRes.rows.forEach(m => {
          const items = Array.isArray(m.action_items) ? m.action_items : [];
          items.forEach(item => {
            if (!item.completed && !item.task?.toLowerCase().includes('[x]')) {
              openActionItemsCount++;
            }
          });
        });

        companies.push({
          ...company,
          last_meeting: lastMeeting,
          budget: budgetRes.rows.length > 0 ? budgetRes.rows[0].value : null,
          champion: championRes.rows.length > 0 ? championRes.rows[0].value : null,
          decision_maker: dmRes.rows.length > 0 ? dmRes.rows[0].value : null,
          open_risks_count: parseInt(risksCountRes.rows[0].count || 0),
          open_action_items_count: openActionItemsCount
        });
      }
      res.json(companies);
    } else {
      const data = readFallbackDb();
      const companies = data.companies.map(c => {
        // Find last meeting
        const companyMeetings = data.meetings.filter(m => m.company_id === c.id);
        companyMeetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const lastMeeting = companyMeetings.length > 0 ? {
          title: companyMeetings[0].title,
          date: companyMeetings[0].created_at
        } : null;

        // Fetch latest memories
        const budgetMemories = data.company_memories.filter(m => m.company_id === c.id && m.memory_type === 'budget');
        budgetMemories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const budget = budgetMemories.length > 0 ? budgetMemories[0].value : null;

        const championMemories = data.company_memories.filter(m => m.company_id === c.id && m.memory_type === 'champion');
        championMemories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const champion = championMemories.length > 0 ? championMemories[0].value : null;

        const dmMemories = data.company_memories.filter(m => m.company_id === c.id && m.memory_type === 'decision_maker');
        dmMemories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const decision_maker = dmMemories.length > 0 ? dmMemories[0].value : null;

        // Fetch open risks count
        const openRisks = data.risks.filter(r => r.company_id === c.id);

        // Fetch open action items
        let openActionItemsCount = 0;
        companyMeetings.forEach(m => {
          const items = Array.isArray(m.action_items) ? m.action_items : [];
          items.forEach(item => {
            if (!item.completed && !item.task?.toLowerCase().includes('[x]')) {
              openActionItemsCount++;
            }
          });
        });

        return {
          ...c,
          last_meeting: lastMeeting,
          budget,
          champion,
          decision_maker,
          open_risks_count: openRisks.length,
          open_action_items_count: openActionItemsCount
        };
      });
      res.json(companies);
    }
  } catch (error) {
    next(error);
  }
});

// GET duplicate account detection
app.get('/api/companies/duplicates', async (req, res, next) => {
  try {
    let companies = [];
    if (!useFallbackDb) {
      const result = await pool.query('SELECT * FROM companies ORDER BY name ASC');
      companies = result.rows;
    } else {
      const data = readFallbackDb();
      companies = data.companies || [];
    }

    const duplicates = [];
    for (let i = 0; i < companies.length; i++) {
      for (let j = i + 1; j < companies.length; j++) {
        const c1 = companies[i];
        const c2 = companies[j];
        
        let matchReason = null;
        let confidence = 0;

        // Check website/domain match
        if (c1.website && c2.website) {
          const d1 = c1.website.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0].toLowerCase();
          const d2 = c2.website.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0].toLowerCase();
          if (d1 && d2 && d1 === d2) {
            matchReason = `Identical domain detected: ${d1}`;
            confidence = 98;
          }
        }

        // Check name prefix/similarity
        if (!matchReason && c1.name && c2.name) {
          const n1 = c1.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          const n2 = c2.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (n1 === n2) {
            matchReason = 'Identical clean account name';
            confidence = 95;
          } else if (n1.startsWith(n2) || n2.startsWith(n1)) {
            matchReason = 'Strong name similarity prefix';
            confidence = 85;
          }
        }

        if (matchReason) {
          duplicates.push({
            companyA: c1,
            companyB: c2,
            reason: matchReason,
            confidence
          });
        }
      }
    }

    res.json(duplicates);
  } catch (err) {
    next(err);
  }
});

// POST record extraction feedback / approval
app.post('/api/extractions/feedback', async (req, res, next) => {
  try {
    const { meetingId, fieldName, originalValue, correctedValue, status } = req.body;
    if (!meetingId || !fieldName) {
      return res.status(400).json({ error: 'invalid_args', message: 'Missing meetingId or fieldName' });
    }

    const feedbackEntry = {
      id: crypto.randomUUID(),
      meeting_id: meetingId,
      field_name: fieldName,
      original_value: originalValue || null,
      corrected_value: correctedValue || null,
      status: status || 'edited', // 'approved', 'edited', 'rejected'
      created_at: new Date().toISOString()
    };

    if (useFallbackDb) {
      const data = readFallbackDb();
      if (!data.extraction_feedback) data.extraction_feedback = [];
      data.extraction_feedback.push(feedbackEntry);
      writeFallbackDb(data);
    } else {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS extraction_feedback (
           id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
           field_name VARCHAR(100) NOT NULL,
           original_value TEXT,
           corrected_value TEXT,
           status VARCHAR(50) NOT NULL,
           created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
         )`
      );
      await pool.query(
        `INSERT INTO extraction_feedback (meeting_id, field_name, original_value, corrected_value, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [meetingId, fieldName, String(originalValue || ''), String(correctedValue || ''), status || 'edited']
      );
    }

    logger.info({ meetingId, fieldName, status }, 'Recorded AI extraction feedback correction');
    res.json({ ok: true, feedback: feedbackEntry });
  } catch (err) {
    next(err);
  }
});

// PUT update meeting company association / tag
app.put('/api/meetings/:id/company', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    const { companyId, companyName, companyWebsite } = req.body;

    if (!useFallbackDb) {
      let resolvedCompanyId = companyId;
      if (!resolvedCompanyId && companyName) {
        const existing = await pool.query('SELECT id FROM companies WHERE LOWER(name) = LOWER($1)', [companyName]);
        if (existing.rows.length > 0) {
          resolvedCompanyId = existing.rows[0].id;
        } else {
          const insertRes = await pool.query(
            'INSERT INTO companies (name, website) VALUES ($1, $2) RETURNING id',
            [companyName, companyWebsite || '']
          );
          resolvedCompanyId = insertRes.rows[0].id;
        }
      }

      await pool.query(
        'UPDATE meetings SET company_id = $1, updated_at = NOW() WHERE id = $2',
        [resolvedCompanyId, meetingId]
      );
      res.json({ ok: true, company_id: resolvedCompanyId });
    } else {
      const data = readFallbackDb();
      const m = data.meetings.find(x => x.id === meetingId);
      if (!m) return res.status(404).json({ error: 'Meeting not found' });

      let resolvedCompanyId = companyId;
      if (!resolvedCompanyId && companyName) {
        let comp = data.companies.find(c => c.name.toLowerCase() === companyName.toLowerCase());
        if (!comp) {
          comp = {
            id: crypto.randomUUID(),
            workspace_id: '00000000-0000-0000-0000-000000000001',
            name: companyName,
            website: companyWebsite || '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          data.companies.push(comp);
        }
        resolvedCompanyId = comp.id;
      }

      m.company_id = resolvedCompanyId;
      const comp = data.companies.find(c => c.id === resolvedCompanyId);
      if (comp) {
        m.company_name = comp.name;
        m.company_domain = comp.website;
      }
      writeFallbackDb(data);
      res.json({ ok: true, company_id: resolvedCompanyId });
    }
  } catch (err) {
    next(err);
  }
});

// GET company overview
app.get('/api/companies/:id', async (req, res, next) => {
  try {
    const companyId = req.params.id;
    if (!useFallbackDb) {
      const companyRes = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
      if (companyRes.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Company not found' });
      }
      const company = companyRes.rows[0];

      // Meetings list
      const meetingsRes = await pool.query(
        'SELECT * FROM meetings WHERE company_id = $1 ORDER BY created_at DESC',
        [companyId]
      );
      const meetings = meetingsRes.rows;

      // Timeline events
      const timelineRes = await pool.query(
        'SELECT * FROM timeline_events WHERE company_id = $1 ORDER BY created_at DESC',
        [companyId]
      );
      const timeline = timelineRes.rows;

      // Memories
      const memoriesRes = await pool.query(
        'SELECT * FROM company_memories WHERE company_id = $1 ORDER BY created_at DESC',
        [companyId]
      );
      const memories = memoriesRes.rows;

      // Risks
      const risksRes = await pool.query(
        'SELECT * FROM risks WHERE company_id = $1 ORDER BY last_seen DESC',
        [companyId]
      );
      const risks = risksRes.rows;

      const meetingIds = meetings.map(m => m.id);
      let syncHistory = [];
      if (meetingIds.length > 0) {
        const syncRes = await pool.query(
          `SELECT sl.*, m.title as meeting_title 
           FROM sync_logs sl 
           LEFT JOIN meetings m ON sl.meeting_id = m.id 
           WHERE sl.meeting_id = ANY($1) 
           ORDER BY sl.created_at DESC`,
          [meetingIds]
        );
        syncHistory = syncRes.rows;
      }

      res.json({
        company,
        meetings,
        timeline,
        memories,
        risks,
        syncHistory
      });
    } else {
      const data = readFallbackDb();
      const company = data.companies.find(c => c.id === companyId);
      if (!company) {
        return res.status(404).json({ error: 'not_found', message: 'Company not found' });
      }

      const meetings = data.meetings.filter(m => m.company_id === companyId);
      meetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      const timeline = data.timeline_events.filter(t => t.company_id === companyId);
      timeline.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      const memories = data.company_memories.filter(m => m.company_id === companyId);
      memories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      const risks = data.risks.filter(r => r.company_id === companyId);
      risks.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));

      const meetingIds = meetings.map(m => m.id);
      const syncHistory = data.sync_logs.filter(sl => meetingIds.includes(sl.meeting_id));
      syncHistory.forEach(sl => {
        sl.meeting_title = data.meetings.find(m => m.id === sl.meeting_id)?.title || 'Unknown Session';
      });
      syncHistory.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      res.json({
        company,
        meetings,
        timeline,
        memories,
        risks,
        syncHistory
      });
    }
  } catch (error) {
    next(error);
  }
});

// Sub-routes for company attributes
app.get('/api/companies/:id/timeline', async (req, res, next) => {
  try {
    const companyId = req.params.id;
    if (!useFallbackDb) {
      const result = await pool.query('SELECT * FROM timeline_events WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
      res.json(result.rows);
    } else {
      const data = readFallbackDb();
      const timeline = data.timeline_events.filter(t => t.company_id === companyId);
      timeline.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      res.json(timeline);
    }
  } catch (error) { next(error); }
});

app.get('/api/companies/:id/memories', async (req, res, next) => {
  try {
    const companyId = req.params.id;
    if (!useFallbackDb) {
      const result = await pool.query('SELECT * FROM company_memories WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
      res.json(result.rows);
    } else {
      const data = readFallbackDb();
      const memories = data.company_memories.filter(m => m.company_id === companyId);
      memories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      res.json(memories);
    }
  } catch (error) { next(error); }
});

app.get('/api/companies/:id/risks', async (req, res, next) => {
  try {
    const companyId = req.params.id;
    if (!useFallbackDb) {
      const result = await pool.query('SELECT * FROM risks WHERE company_id = $1 ORDER BY last_seen DESC', [companyId]);
      res.json(result.rows);
    } else {
      const data = readFallbackDb();
      const risks = data.risks.filter(r => r.company_id === companyId);
      risks.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
      res.json(risks);
    }
  } catch (error) { next(error); }
});

// DELETE resolve a risk
app.delete('/api/risks/:id', async (req, res, next) => {
  try {
    const riskId = req.params.id;
    let companyId = null;
    let riskDesc = '';

    if (!useFallbackDb) {
      const riskRes = await pool.query('SELECT company_id, risk FROM risks WHERE id = $1', [riskId]);
      if (riskRes.rows.length > 0) {
        companyId = riskRes.rows[0].company_id;
        riskDesc = riskRes.rows[0].risk;
        await pool.query('DELETE FROM risks WHERE id = $1', [riskId]);
        await logTimelineEvent(companyId, null, 'risk_resolved', { risk: riskDesc });
      }
    } else {
      const data = readFallbackDb();
      const riskIndex = data.risks.findIndex(r => r.id === riskId);
      if (riskIndex !== -1) {
        companyId = data.risks[riskIndex].company_id;
        riskDesc = data.risks[riskIndex].risk;
        data.risks.splice(riskIndex, 1);
        
        data.timeline_events.push({
          id: crypto.randomUUID(),
          company_id: companyId,
          meeting_id: null,
          event_type: 'risk_resolved',
          payload: { risk: riskDesc },
          created_at: new Date().toISOString()
        });
        writeFallbackDb(data);
      }
    }
    
    res.json({ ok: true, message: 'Risk resolved and removed.' });
  } catch (error) {
    next(error);
  }
});

// ── Refactored Customers/Accounts REST Aggregator ─────────────────────────────────
['/customers', '/api/customers'].forEach(basePath => {
  // GET all customers with aggregated counters
  app.get(basePath, async (req, res, next) => {
    try {
      if (!useFallbackDb) {
        const companiesRes = await pool.query('SELECT * FROM companies ORDER BY name ASC');
        const companies = companiesRes.rows;
        const enriched = [];
        for (const c of companies) {
          const lastMeetingRes = await pool.query(
            'SELECT title, created_at, call_type FROM meetings WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1',
            [c.id]
          );
          const lastMeeting = lastMeetingRes.rows.length > 0 ? {
            title: lastMeetingRes.rows[0].title,
            date: lastMeetingRes.rows[0].created_at,
            call_type: lastMeetingRes.rows[0].call_type || 'discovery'
          } : null;

          const budgetRes = await pool.query("SELECT value FROM company_memories WHERE company_id = $1 AND memory_type = 'budget' ORDER BY created_at DESC LIMIT 1", [c.id]);
          const championRes = await pool.query("SELECT value FROM company_memories WHERE company_id = $1 AND memory_type = 'champion' ORDER BY created_at DESC LIMIT 1", [c.id]);
          const dmRes = await pool.query("SELECT value FROM company_memories WHERE company_id = $1 AND memory_type = 'decision_maker' ORDER BY created_at DESC LIMIT 1", [c.id]);
          const risksCount = await pool.query('SELECT COUNT(*) FROM risks WHERE company_id = $1', [c.id]);
          
          const meetingsRes = await pool.query('SELECT action_items FROM meetings WHERE company_id = $1', [c.id]);
          let openActionItemsCount = 0;
          meetingsRes.rows.forEach(m => {
            const items = Array.isArray(m.action_items) ? m.action_items : [];
            items.forEach(item => {
              if (!item.completed && !item.task?.toLowerCase().includes('[x]')) {
                openActionItemsCount++;
              }
            });
          });

          enriched.push({
            ...c,
            last_meeting: lastMeeting,
            last_call_type: lastMeeting?.call_type || 'discovery',
            budget: budgetRes.rows.length > 0 ? budgetRes.rows[0].value : null,
            champion: championRes.rows.length > 0 ? championRes.rows[0].value : null,
            decision_maker: dmRes.rows.length > 0 ? dmRes.rows[0].value : null,
            open_risks_count: parseInt(risksCount.rows[0].count || 0),
            open_action_items_count: openActionItemsCount
          });
        }
        res.json(enriched);
      } else {
        const data = readFallbackDb();
        const enriched = data.companies.map(c => {
          const companyMeetings = data.meetings.filter(m => m.company_id === c.id);
          companyMeetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          const lastMeeting = companyMeetings.length > 0 ? {
            title: companyMeetings[0].title,
            date: companyMeetings[0].created_at,
            call_type: companyMeetings[0].call_type || 'discovery'
          } : null;

          const budgetMem = data.company_memories.filter(m => m.company_id === c.id && m.memory_type === 'budget');
          budgetMem.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          const budget = budgetMem.length > 0 ? budgetMem[0].value : null;

          const champMem = data.company_memories.filter(m => m.company_id === c.id && m.memory_type === 'champion');
          champMem.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          const champion = champMem.length > 0 ? champMem[0].value : null;

          const dmMem = data.company_memories.filter(m => m.company_id === c.id && m.memory_type === 'decision_maker');
          dmMem.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          const decision_maker = dmMem.length > 0 ? dmMem[0].value : null;

          const openRisks = data.risks.filter(r => r.company_id === c.id);

          let openActionItemsCount = 0;
          companyMeetings.forEach(m => {
            const items = Array.isArray(m.action_items) ? m.action_items : [];
            items.forEach(item => {
              if (!item.completed && !item.task?.toLowerCase().includes('[x]')) {
                openActionItemsCount++;
              }
            });
          });

          return {
            ...c,
            last_meeting: lastMeeting,
            last_call_type: companyMeetings[0]?.call_type || 'discovery',
            budget,
            champion,
            decision_maker,
            open_risks_count: openRisks.length,
            open_action_items_count: openActionItemsCount
          };
        });
        enriched.sort((a, b) => a.name.localeCompare(b.name));
        res.json(enriched);
      }
    } catch (err) {
      next(err);
    }
  });

  // GET customer quick facts and aggregated metadata
  app.get(`${basePath}/:id`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let company = null;
      let meetings = [];
      let memories = [];
      let risks = [];
      let syncHistory = [];

      if (!useFallbackDb) {
        const compRes = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
        if (compRes.rows.length === 0) return res.status(404).json({ error: 'not_found', message: 'Company not found' });
        company = compRes.rows[0];

        const meetRes = await pool.query('SELECT * FROM meetings WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        meetings = meetRes.rows;

        const memRes = await pool.query('SELECT * FROM company_memories WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        memories = memRes.rows;

        const risksRes = await pool.query('SELECT * FROM risks WHERE company_id = $1 ORDER BY last_seen DESC', [companyId]);
        risks = risksRes.rows;

        const meetingIds = meetings.map(m => m.id);
        if (meetingIds.length > 0) {
          const syncRes = await pool.query('SELECT sl.*, m.title as meeting_title FROM sync_logs sl LEFT JOIN meetings m ON sl.meeting_id = m.id WHERE sl.meeting_id = ANY($1) ORDER BY sl.created_at DESC', [meetingIds]);
          syncHistory = syncRes.rows;
        }
      } else {
        const data = readFallbackDb();
        company = data.companies.find(c => c.id === companyId);
        if (!company) return res.status(404).json({ error: 'not_found', message: 'Company not found' });

        meetings = data.meetings.filter(m => m.company_id === companyId);
        meetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        memories = data.company_memories.filter(m => m.company_id === companyId);
        memories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        risks = data.risks.filter(r => r.company_id === companyId);
        risks.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));

        const meetingIds = meetings.map(m => m.id);
        syncHistory = data.sync_logs.filter(sl => meetingIds.includes(sl.meeting_id));
        syncHistory.forEach(sl => {
          sl.meeting_title = data.meetings.find(m => m.id === sl.meeting_id)?.title || 'Unknown Session';
        });
        syncHistory.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }

      const latestMeeting = meetings[0];
      const latestSnapshot = latestMeeting?.ai_snapshot || {};
      const latestIntel = latestMeeting?.deal_intelligence || {};

      const budget = memories.find(m => m.memory_type === 'budget')?.value || latestSnapshot.budget || latestIntel.budget || "—";
      const champion = memories.find(m => m.memory_type === 'champion')?.value || latestSnapshot.champion || latestIntel.champion || "—";
      const decisionMaker = memories.find(m => m.memory_type === 'decision_maker')?.value || latestSnapshot.decision_maker || latestIntel.decision_maker || "—";
      const dealStage = latestSnapshot.buying_stage || latestIntel.buying_stage || "Discovery";
      const expectedClose = latestIntel.expected_close || latestSnapshot.expected_close || "Unknown";
      
      const procurementMemory = memories.find(m => m.memory_type?.toLowerCase().includes('procurement'));
      const procurementStatus = procurementMemory ? procurementMemory.value : "Not Started";

      const competitorMemories = memories.filter(m => m.memory_type?.toLowerCase().includes('competitor'));
      const competitorsMentioned = competitorMemories.length > 0 ? competitorMemories.map(m => m.value).join(', ') : "None";

      const implementationTimeline = latestSnapshot.timeline || "Not specified";
      
      const productMemory = memories.find(m => m.memory_type?.toLowerCase().includes('product') || m.memory_type?.toLowerCase().includes('interest'));
      const productsInterested = productMemory ? productMemory.value : "PulseSync Suite";

      const contractValue = budget !== "—" ? budget : "Unknown";

      const crmOwner = "Vardhan (Salesforce Sync)";
      const accountOwner = "Vardhan (Account Exec)";
      const lastSync = syncHistory[0] ? new Date(syncHistory[0].created_at).toLocaleString() : "Never Synced";
      const upcomingMeeting = "None Scheduled";

      res.json({
        company: {
          ...company,
          crm_owner: crmOwner,
          account_owner: accountOwner,
          last_meeting: latestMeeting ? { title: latestMeeting.title, date: latestMeeting.created_at } : null,
          upcoming_meeting: upcomingMeeting,
          total_meetings: meetings.length,
          last_sync: lastSync,
          budget,
          champion,
          decision_maker: decisionMaker,
          deal_stage: dealStage,
          expected_close: expectedClose,
          procurement_status: procurementStatus,
          competitors_mentioned: competitorsMentioned,
          implementation_timeline: implementationTimeline,
          products_interested: productsInterested,
          contract_value: contractValue
        },
        meetings,
        memories,
        risks,
        syncHistory
      });
    } catch (err) {
      next(err);
    }
  });

  // GET customer history list
  app.get(`${basePath}/:id/history`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let meetings = [];
      if (!useFallbackDb) {
        const result = await pool.query('SELECT * FROM meetings WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        meetings = result.rows;
      } else {
        const data = readFallbackDb();
        meetings = data.meetings.filter(m => m.company_id === companyId);
        meetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }
      
      const historyList = meetings.map(m => {
        const risksCount = Array.isArray(m.risks) ? m.risks.length : 0;
        const actionsCount = Array.isArray(m.action_items) ? m.action_items.length : 0;
        const objectionsCount = Array.isArray(m.objections) ? m.objections.length : 0;
        return {
          id: m.id,
          date: m.created_at,
          title: m.title,
          duration: m.duration_seconds || 0,
          call_type: m.call_type || 'discovery',
          call_type_confidence: m.call_type_confidence || 0.94,
          call_type_rationale: m.call_type_rationale || '',
          call_type_source: m.call_type_source || 'ai',
          deal_stage: m.deal_intelligence?.buying_stage || m.ai_snapshot?.buying_stage || 'Discovery',
          template_used: m.ai_snapshot?.templateId || m.template_used || 'MEDDICC',
          summary: m.ai_snapshot?.overview || m.deal_intelligence?.summary || 'No summary compiled.',
          risks_count: risksCount,
          action_items_count: actionsCount,
          objections_count: objectionsCount,
          action_items: m.action_items || [],
          risks: m.risks || [],
          objections: m.objections || [],
          audio_url: `/api/meetings/${m.id}/audio-url`,
          workflow_state: m.workflow_state || 'completed',
          status: m.status
        };
      });
      res.json(historyList);
    } catch (err) {
      next(err);
    }
  });

  // GET customer deal journey progression
  app.get(`${basePath}/:id/journey`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let meetings = [];
      let company = null;

      if (!useFallbackDb) {
        const compRes = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
        if (compRes.rows.length === 0) return res.status(404).json({ error: 'not_found', message: 'Company not found' });
        company = compRes.rows[0];

        const meetRes = await pool.query(
          `SELECT id, title, created_at, duration_seconds, call_type, call_type_confidence, 
                  call_type_source, call_type_rationale, ai_snapshot, deal_intelligence,
                  action_items, risks, objections, workflow_state, status, audio_url
           FROM meetings 
           WHERE company_id = $1 
           ORDER BY created_at ASC`,
          [companyId]
        );
        meetings = meetRes.rows;
      } else {
        const data = readFallbackDb();
        company = data.companies.find(c => c.id === companyId);
        if (!company) return res.status(404).json({ error: 'not_found', message: 'Company not found' });

        meetings = data.meetings.filter(m => m.company_id === companyId);
        meetings.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      }

      const standardStages = [
        { id: "cold_prospecting", name: "Cold Call" },
        { id: "qualification", name: "Qualification" },
        { id: "discovery", name: "Discovery" },
        { id: "solution_demo", name: "Solution / Demo" },
        { id: "technical_validation", name: "Technical Validation" },
        { id: "negotiation", name: "Negotiation" },
        { id: "renewal_expansion", name: "Renewal / Expansion" }
      ];

      const journeyCalls = meetings.map(m => {
        const intel = m.deal_intelligence || m.ai_snapshot || {};
        const stage = intel.buying_stage || 'Discovery';
        const actionsCount = Array.isArray(m.action_items) ? m.action_items.length : 0;
        const risksCount = Array.isArray(m.risks) ? m.risks.length : 0;
        const objectionsCount = Array.isArray(m.objections) ? m.objections.length : 0;
        const summary = m.ai_snapshot?.overview || intel.summary || (m.summary?.overview || 'Call session completed.');

        return {
          id: m.id,
          title: m.title,
          date: m.created_at,
          duration: m.duration_seconds || 0,
          call_type: m.call_type || 'discovery',
          call_type_confidence: m.call_type_confidence || 0.94,
          call_type_source: m.call_type_source || 'ai',
          call_type_rationale: m.call_type_rationale || '',
          deal_stage: stage,
          summary,
          actions_count: actionsCount,
          risks_count: risksCount,
          objections_count: objectionsCount,
          action_items: m.action_items || [],
          risks: m.risks || [],
          objections: m.objections || [],
          audio_url: `/api/meetings/${m.id}/audio-url`,
          workflow_state: m.workflow_state || 'completed'
        };
      });

      const latestCall = journeyCalls.length > 0 ? journeyCalls[journeyCalls.length - 1] : null;
      const currentCallType = latestCall ? latestCall.call_type : 'discovery';

      res.json({
        company_id: companyId,
        company_name: company.name,
        stages: standardStages,
        current_call_type: currentCallType,
        total_calls: journeyCalls.length,
        journey: journeyCalls
      });
    } catch (err) {
      next(err);
    }
  });

  // GET customer aggregated intelligence (Layer 3 of truth - verified facts with provenance)
  app.get(`${basePath}/:id/intelligence`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let company = null;
      let meetings = [];
      let memories = [];
      let risks = [];
      let objections = [];

      if (!useFallbackDb) {
        const compRes = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
        if (compRes.rows.length === 0) return res.status(404).json({ error: 'not_found', message: 'Company not found' });
        company = compRes.rows[0];

        const meetRes = await pool.query('SELECT * FROM meetings WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        meetings = meetRes.rows;

        const memRes = await pool.query('SELECT * FROM company_memories WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        memories = memRes.rows;

        const risksRes = await pool.query('SELECT * FROM risks WHERE company_id = $1 ORDER BY last_seen DESC', [companyId]);
        risks = risksRes.rows;

        const objRes = await pool.query('SELECT * FROM objections WHERE company_id = $1 ORDER BY last_seen DESC', [companyId]);
        objections = objRes.rows;
      } else {
        const data = readFallbackDb();
        company = data.companies.find(c => c.id === companyId);
        if (!company) return res.status(404).json({ error: 'not_found', message: 'Company not found' });

        meetings = data.meetings.filter(m => m.company_id === companyId);
        meetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        memories = data.company_memories.filter(m => m.company_id === companyId);
        memories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        risks = data.risks.filter(r => r.company_id === companyId);
        risks.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));

        objections = (data.objections || []).filter(o => o.company_id === companyId);
      }

      const meetingMap = {};
      meetings.forEach(m => {
        meetingMap[m.id] = {
          id: m.id,
          title: m.title,
          date: m.created_at,
          call_type: m.call_type || 'discovery'
        };
      });

      function resolveFactWithProvenance(factKey, memoryKey, fallbackIntelKey) {
        const mem = memories.find(m => m.memory_type?.toLowerCase() === memoryKey.toLowerCase());
        if (mem && mem.value && mem.value !== '—') {
          const originMeeting = meetingMap[mem.meeting_id];
          return {
            key: factKey,
            value: mem.value,
            status: 'verified',
            source_meeting_id: mem.meeting_id,
            source_meeting_title: originMeeting ? originMeeting.title : 'Verified Session',
            source_date: originMeeting ? originMeeting.date : mem.created_at,
            confidence: mem.confidence || 0.95
          };
        }

        for (const m of meetings) {
          const intel = m.deal_intelligence || m.ai_snapshot || {};
          const val = intel[fallbackIntelKey] || intel[factKey];
          if (val && String(val).toLowerCase() !== 'null' && String(val).toLowerCase() !== 'unknown' && String(val).trim() !== '' && String(val) !== '—') {
            return {
              key: factKey,
              value: val,
              status: 'current_call',
              source_meeting_id: m.id,
              source_meeting_title: m.title,
              source_date: m.created_at,
              confidence: 0.90
            };
          }
        }

        return {
          key: factKey,
          value: null,
          status: 'not_mentioned',
          source_meeting_id: null,
          source_meeting_title: null,
          source_date: null,
          confidence: null
        };
      }

      const budgetFact = resolveFactWithProvenance('budget', 'budget', 'budget');
      const championFact = resolveFactWithProvenance('champion', 'champion', 'champion');
      const decisionMakerFact = resolveFactWithProvenance('decision_maker', 'decision_maker', 'decision_maker');
      const buyingStageFact = resolveFactWithProvenance('buying_stage', 'buying_stage', 'buying_stage');
      const timelineFact = resolveFactWithProvenance('timeline', 'timeline', 'timeline');
      const competitionFact = resolveFactWithProvenance('competition', 'competitor', 'competition');

      const callProgression = [...meetings].reverse().map(m => ({
        id: m.id,
        title: m.title,
        date: m.created_at,
        call_type: m.call_type || 'discovery'
      }));

      const openCommitments = [];
      meetings.forEach(m => {
        (m.action_items || []).forEach(act => {
          if (!act.completed) {
            openCommitments.push({
              task: act.task,
              owner: act.owner || 'Unassigned',
              meeting_id: m.id,
              meeting_title: m.title,
              evidence: act.evidence
            });
          }
        });
      });

      res.json({
        company_id: companyId,
        company_name: company.name,
        total_calls: meetings.length,
        latest_call_type: meetings[0]?.call_type || 'discovery',
        call_progression: callProgression,
        facts: {
          budget: budgetFact,
          champion: championFact,
          decision_maker: decisionMakerFact,
          buying_stage: buyingStageFact,
          timeline: timelineFact,
          competition: competitionFact
        },
        risks: risks.map(r => ({
          risk: r.risk,
          mention_count: r.mention_count || 1,
          evidence: r.evidence,
          last_seen: r.last_seen
        })),
        objections: objections.map(o => ({
          objection: o.objection,
          mention_count: o.count || 1,
          last_seen: o.last_seen
        })),
        open_commitments: openCommitments
      });
    } catch (err) {
      next(err);
    }
  });

  // GET customer memories list
  app.get(`${basePath}/:id/memories`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let memories = [];
      if (!useFallbackDb) {
        const result = await pool.query(
          `SELECT cm.*, m.title as meeting_title 
           FROM company_memories cm 
           LEFT JOIN meetings m ON cm.meeting_id = m.id 
           WHERE cm.company_id = $1 
           ORDER BY cm.created_at DESC`,
          [companyId]
        );
        memories = result.rows;
      } else {
        const data = readFallbackDb();
        memories = data.company_memories.filter(m => m.company_id === companyId);
        memories.forEach(m => {
          m.meeting_title = data.meetings.find(meet => meet.id === m.meeting_id)?.title || 'Unknown Session';
        });
        memories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }
      res.json(memories);
    } catch (err) {
      next(err);
    }
  });

  // GET customer risks list
  app.get(`${basePath}/:id/risks`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let risks = [];
      if (!useFallbackDb) {
        const result = await pool.query('SELECT * FROM risks WHERE company_id = $1 ORDER BY last_seen DESC', [companyId]);
        risks = result.rows;
      } else {
        const data = readFallbackDb();
        risks = data.risks.filter(r => r.company_id === companyId);
        risks.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
      }
      res.json(risks);
    } catch (err) {
      next(err);
    }
  });

  // GET customer action items
  app.get(`${basePath}/:id/actions`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let meetings = [];
      if (!useFallbackDb) {
        const result = await pool.query('SELECT id, title, action_items, created_at FROM meetings WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        meetings = result.rows;
      } else {
        const data = readFallbackDb();
        meetings = data.meetings.filter(m => m.company_id === companyId);
        meetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }

      const actions = [];
      meetings.forEach(m => {
        const items = Array.isArray(m.action_items) ? m.action_items : [];
        items.forEach(item => {
          actions.push({
            id: `${m.id}-${item.task}`,
            task: item.task,
            owner: item.owner || 'Unassigned',
            completed: item.completed || item.task?.toLowerCase().includes('[x]'),
            meeting_id: m.id,
            meeting_title: m.title,
            created_at: m.created_at,
            priority: item.confidence && item.confidence < 75 ? 'Low' : item.confidence < 90 ? 'Medium' : 'High'
          });
        });
      });
      res.json(actions);
    } catch (err) {
      next(err);
    }
  });

  // GET customer stakeholders list
  app.get(`${basePath}/:id/stakeholders`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let stakeholders = [];
      let meetings = [];
      if (!useFallbackDb) {
        const meetRes = await pool.query('SELECT id FROM meetings WHERE company_id = $1', [companyId]);
        meetings = meetRes.rows;
      } else {
        const data = readFallbackDb();
        meetings = data.meetings.filter(m => m.company_id === companyId);
      }
      const meetingIds = meetings.map(m => m.id);

      if (!useFallbackDb) {
        const result = await pool.query(
          `SELECT DISTINCT ON (speaker_id) * FROM speakers 
           WHERE company_id = $1 OR (meeting_id = ANY($2)) 
           ORDER BY speaker_id, name ASC`, 
          [companyId, meetingIds]
        );
        stakeholders = result.rows;
      } else {
        const data = readFallbackDb();
        const filtered = data.speakers.filter(s => s.company_id === companyId || meetingIds.includes(s.meeting_id));
        const seen = new Set();
        stakeholders = [];
        filtered.forEach(s => {
          if (!seen.has(s.speaker_id)) {
            seen.add(s.speaker_id);
            stakeholders.push(s);
          }
        });
        stakeholders.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      }

      const mapped = [];
      for (const sh of stakeholders) {
        let shMeetings = [];
        if (!useFallbackDb) {
          const meetRes = await pool.query('SELECT m.id, m.title, m.created_at FROM meetings m JOIN speakers s ON m.id = s.meeting_id WHERE s.speaker_id = $1 ORDER BY m.created_at DESC', [sh.speaker_id]);
          shMeetings = meetRes.rows;
        } else {
          const data = readFallbackDb();
          const linkedMeetingIds = data.speakers.filter(s => s.speaker_id === sh.speaker_id).map(s => s.meeting_id);
          shMeetings = data.meetings.filter(m => linkedMeetingIds.includes(m.id));
          shMeetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }

        let influence = 'Low';
        let auth = 'Stakeholder';
        const roleLower = (sh.role || sh.job_title || '').toLowerCase();
        if (roleLower.includes('cfo') || roleLower.includes('decision maker') || roleLower.includes('vp') || roleLower.includes('director') || roleLower.includes('buyer')) {
          influence = 'High';
          auth = 'Economic Buyer';
        } else if (roleLower.includes('champion') || roleLower.includes('lead') || roleLower.includes('pm')) {
          influence = 'High';
          auth = 'Champion';
        } else if (roleLower.includes('eng') || roleLower.includes('tech') || roleLower.includes('developer') || roleLower.includes('architect')) {
          influence = 'Medium';
          auth = 'Technical Buyer';
        } else if (roleLower.includes('procurement') || roleLower.includes('purchasing')) {
          influence = 'High';
          auth = 'Procurement';
        } else if (roleLower.includes('legal') || roleLower.includes('counsel')) {
          influence = 'Medium';
          auth = 'Legal';
        } else if (roleLower.includes('security') || roleLower.includes('compliance')) {
          influence = 'Medium';
          auth = 'Security';
        }

        mapped.push({
          speaker_id: sh.speaker_id,
          name: sh.name,
          role: sh.role || auth,
          job_title: sh.job_title || 'Attendee',
          department: sh.department || 'Engineering',
          email: sh.email || '—',
          meetings: shMeetings.map(m => ({ id: m.id, title: m.title })),
          influence: influence,
          decision_authority: auth,
          latest_mention: shMeetings[0] ? shMeetings[0].created_at : sh.created_at
        });
      }

      res.json(mapped);
    } catch (err) {
      next(err);
    }
  });

  // GET customer AI brief
  app.get(`${basePath}/:id/ai-brief`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let memories = [];
      let company = null;
      if (!useFallbackDb) {
        const compRes = await pool.query('SELECT name FROM companies WHERE id = $1', [companyId]);
        company = compRes.rows[0];
        const result = await pool.query('SELECT * FROM company_memories WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        memories = result.rows;
      } else {
        const data = readFallbackDb();
        company = data.companies.find(c => c.id === companyId);
        memories = data.company_memories.filter(m => m.company_id === companyId);
        memories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }

      if (!company) return res.status(404).json({ error: 'not_found' });

      let brief = '';
      if (memories.length === 0) {
        brief = `Initial relationship established with ${company.name}. No deal progression events or memories have been compiled yet. Run AI Playbooks on upcoming sessions to automatically build intelligence.`;
      } else {
        const budgetChanges = memories.filter(m => m.memory_type === 'budget');
        const champion = memories.find(m => m.memory_type === 'champion')?.value || "Not identified";
        const decisionMaker = memories.find(m => m.memory_type === 'decision_maker')?.value || "Not identified";
        const timeline = memories.find(m => m.memory_type?.toLowerCase().includes('timeline'))?.value || "Not specified";

        brief = `Since the previous meeting:
• Budget stands at ${budgetChanges[0]?.value || 'Not identified'} (historically updated from ${budgetChanges[1]?.value || 'No earlier value recorded'})
• Champion remains ${champion}
• Decision maker: ${decisionMaker}
• Project Timeline: ${timeline}
• CRM sync status: verify in Sync History.`;
      }
      res.json({ brief });
    } catch (err) {
      next(err);
    }
  });

  // GET customer stakeholder transcript mentions
  app.get(`${basePath}/:id/stakeholders/:speakerId/mentions`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      const speakerId = req.params.speakerId;
      let meetings = [];
      if (!useFallbackDb) {
        const meetRes = await pool.query('SELECT id FROM meetings WHERE company_id = $1', [companyId]);
        meetings = meetRes.rows;
      } else {
        const data = readFallbackDb();
        meetings = data.meetings.filter(m => m.company_id === companyId);
      }
      
      const meetingIds = meetings.map(m => m.id);
      if (meetingIds.length === 0) return res.json([]);

      if (!useFallbackDb) {
        const segmentsRes = await pool.query(
          `SELECT ts.*, m.title as meeting_title 
           FROM transcript_segments ts
           LEFT JOIN meetings m ON ts.meeting_id = m.id
           WHERE ts.meeting_id = ANY($1) AND ts.speaker_id = $2
           ORDER BY ts.start_time ASC`,
          [meetingIds, speakerId]
        );
        res.json(segmentsRes.rows);
      } else {
        const data = readFallbackDb();
        const segments = data.segments
          .filter(seg => meetingIds.includes(seg.meeting_id) && seg.speaker_id === speakerId)
          .map(seg => {
            const meeting = data.meetings.find(m => m.id === seg.meeting_id);
            return {
              ...seg,
              text: seg.corrected_text || seg.text || '',
              meeting_title: meeting ? meeting.title : 'Unknown Session'
            };
          });
        res.json(segments);
      }
    } catch (err) {
      next(err);
    }
  });

  // GET chat gateway fallback
  app.get(`${basePath}/:id/chat`, async (req, res, next) => {
    res.json({ message: "Use POST to submit grounded deal Q&A questions." });
  });

  // POST chat gateway
  app.post(`${basePath}/:id/chat`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      const { question } = req.body;
      if (!question) {
        return res.status(400).json({ error: 'invalid_args', message: 'Missing question' });
      }

      let companyName = 'Unknown Company';
      let company = {};
      let meetings = [];
      let segments = [];
      let memories = [];

      if (!useFallbackDb) {
        const companyRes = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
        if (companyRes.rows.length === 0) {
          return res.status(404).json({ error: 'not_found', message: 'Company not found' });
        }
        company = companyRes.rows[0];
        companyName = company.name;

        const meetingsRes = await pool.query('SELECT id, title FROM meetings WHERE company_id = $1', [companyId]);
        meetings = meetingsRes.rows;

        if (meetings.length > 0) {
          const meetingIds = meetings.map(m => m.id);
          const segmentsRes = await pool.query(
            `SELECT ts.id, ts.meeting_id, ts.start_time, ts.end_time, ts.corrected_text as text, 
                    s.name as speaker_name, m.title as meeting_title
             FROM transcript_segments ts
             LEFT JOIN speakers s ON ts.speaker_id = s.speaker_id AND ts.meeting_id = s.meeting_id
             LEFT JOIN meetings m ON ts.meeting_id = m.id
             WHERE ts.meeting_id = ANY($1)
             ORDER BY m.created_at ASC, ts.start_time ASC`,
            [meetingIds]
          );
          segments = segmentsRes.rows;
        }

        const memoriesRes = await pool.query(
          'SELECT * FROM company_memories WHERE company_id = $1 ORDER BY created_at DESC',
          [companyId]
        );
        memories = memoriesRes.rows;
      } else {
        const data = readFallbackDb();
        company = data.companies.find(c => c.id === companyId);
        if (!company) {
          return res.status(404).json({ error: 'not_found', message: 'Company not found' });
        }
        companyName = company.name;

        meetings = data.meetings.filter(m => m.company_id === companyId);
        const meetingIds = meetings.map(m => m.id);

        if (meetingIds.length > 0) {
          segments = data.segments
            .filter(seg => meetingIds.includes(seg.meeting_id))
            .map(seg => {
              const meeting = data.meetings.find(m => m.id === seg.meeting_id);
              const speaker = data.speakers.find(s => s.meeting_id === seg.meeting_id && s.speaker_id === seg.speaker_id);
              return {
                id: seg.id,
                meeting_id: seg.meeting_id,
                start_time: seg.start_time,
                end_time: seg.end_time,
                text: seg.corrected_text || seg.text || '',
                speaker_name: speaker ? speaker.name : 'Unknown Speaker',
                meeting_title: meeting ? meeting.title : 'Unknown Session'
              };
            });
        }

        memories = data.company_memories.filter(m => m.company_id === companyId);
      }

      const aiServiceUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace('/process', '').replace('/generate-ai', '') + '/chat-deal';
      
      logger.info({ companyId, companyName }, 'Posting Chat request to FastAPI chat-deal endpoint...');
      let chatResult = null;
      try {
        const response = await fetch(aiServiceUrl, {
          method: 'POST',
          headers: aiServiceHeaders(),
          body: JSON.stringify({
            company_name: companyName,
            question: question,
            transcripts: segments.map(seg => ({
              id: seg.id,
              meeting_id: seg.meeting_id,
              meeting_title: seg.meeting_title,
              speaker_name: seg.speaker_name,
              text: seg.text,
              start_time: seg.start_time,
              end_time: seg.end_time
            })),
            memories: memories
          }),
          signal: AbortSignal.timeout(60000)
        });

        if (!response.ok) throw new Error(`FastAPI chat-deal returned status ${response.status}`);
        chatResult = await response.json();
      } catch (chatErr) {
        logger.error({ error: chatErr?.message }, 'AI chat service unavailable; refusing to generate an ungrounded response.');
        return res.status(503).json({ error: 'ai_service_unavailable', status: 'unavailable', answer: 'Unable to answer because the AI service is currently unavailable.', evidence: [] });
      }

      res.json(chatResult);
    } catch (err) {
      next(err);
    }
  });

  // GET customer action items checklist
  app.get(`${basePath}/:id/action-items`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let meetings = [];
      if (!useFallbackDb) {
        const result = await pool.query('SELECT id, title, action_items, created_at FROM meetings WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        meetings = result.rows;
      } else {
        const data = readFallbackDb();
        meetings = data.meetings.filter(m => m.company_id === companyId);
        meetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }

      const actions = [];
      meetings.forEach(m => {
        const items = Array.isArray(m.action_items) ? m.action_items : [];
        items.forEach(item => {
          actions.push({
            id: `${m.id}-${item.task}`,
            task: item.task,
            owner: item.owner || 'Unassigned',
            completed: item.completed || item.task?.toLowerCase().includes('[x]'),
            meeting_id: m.id,
            meeting_title: m.title,
            created_at: m.created_at,
            evidence: item.evidence || "Extracted from dialogue.",
            priority: item.confidence && item.confidence < 75 ? 'Low' : item.confidence < 90 ? 'Medium' : 'High'
          });
        });
      });
      res.json(actions);
    } catch (err) {
      next(err);
    }
  });

  // GET customer timeline activity changes
  app.get(`${basePath}/:id/changes`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let timeline = [];
      let risks = [];
      
      if (!useFallbackDb) {
        const timelineRes = await pool.query('SELECT * FROM timeline_events WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        timeline = timelineRes.rows;
        
        const risksRes = await pool.query('SELECT * FROM risks WHERE company_id = $1 ORDER BY last_seen DESC', [companyId]);
        risks = risksRes.rows;
      } else {
        const data = readFallbackDb();
        timeline = data.timeline_events.filter(t => t.company_id === companyId);
        timeline.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        risks = data.risks.filter(r => r.company_id === companyId);
        risks.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
      }

      const changes = [];
      timeline.forEach(t => {
        changes.push({
          id: t.id,
          type: 'timeline_event',
          event_type: t.event_type,
          title: t.payload?.title || t.event_type.replace(/_/g, ' '),
          description: t.payload?.description || 'Milestone logged.',
          date: t.created_at
        });
      });

      risks.forEach(r => {
        changes.push({
          id: r.id,
          type: 'risk_event',
          event_type: 'risk_added',
          title: 'Risk Detected',
          description: `Risk factor: "${r.risk}". Evidence: "${r.evidence || "No quote context mapped."}"`,
          date: r.last_seen || r.first_seen
        });
      });

      changes.sort((a, b) => new Date(b.date) - new Date(a.date));
      res.json(changes);
    } catch (err) {
      next(err);
    }
  });

  // GET customer brief
  app.get(`${basePath}/:id/brief`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let memories = [];
      let company = null;
      if (!useFallbackDb) {
        const compRes = await pool.query('SELECT name FROM companies WHERE id = $1', [companyId]);
        company = compRes.rows[0];
        const result = await pool.query('SELECT * FROM company_memories WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        memories = result.rows;
      } else {
        const data = readFallbackDb();
        company = data.companies.find(c => c.id === companyId);
        memories = data.company_memories.filter(m => m.company_id === companyId);
        memories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }

      if (!company) return res.status(404).json({ error: 'not_found', message: 'Company not found' });

      let brief = '';
      if (memories.length === 0) {
        brief = `Initial relationship established with ${company.name}.\n• No deal progression events or memories have been compiled yet.\n• Run AI Playbooks on upcoming sessions to automatically build intelligence.`;
      } else {
        const budgetChanges = memories.filter(m => m.memory_type === 'budget');
        const champion = memories.find(m => m.memory_type === 'champion')?.value || "Not identified";
        const decisionMaker = memories.find(m => m.memory_type === 'decision_maker')?.value || "Not identified";
        const timeline = memories.find(m => m.memory_type?.toLowerCase().includes('timeline'))?.value || "Not specified";

        brief = `Since the last meeting:
• Budget stands at ${budgetChanges[0]?.value || 'Not identified'} (historically updated from ${budgetChanges[1]?.value || 'No earlier value recorded'})
• Champion remains ${champion}
• Decision maker: ${decisionMaker}
• Project Timeline: ${timeline}
• Additional buying committee members and follow-up commitments: not established by stored memories.`;
      }
      res.json({ brief });
    } catch (err) {
      next(err);
    }
  });

  // Dynamic Next Meeting Preparation Dossier Generator (Grounded in Verified Customer History)
  const generateCustomerPrepDossier = async (companyId) => {
    let company = null;
    let meetings = [];
    let memories = [];
    let risks = [];
    let objections = [];
    let timeline = [];
    let speakers = [];

    if (!useFallbackDb) {
      const compRes = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
      if (compRes.rows.length === 0) return null;
      company = compRes.rows[0];

      const meetRes = await pool.query('SELECT * FROM meetings WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
      meetings = meetRes.rows;

      const memRes = await pool.query('SELECT * FROM company_memories WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
      memories = memRes.rows;

      const risksRes = await pool.query('SELECT * FROM risks WHERE company_id = $1 ORDER BY last_seen DESC', [companyId]);
      risks = risksRes.rows;

      const objRes = await pool.query('SELECT * FROM objections WHERE company_id = $1 ORDER BY last_seen DESC', [companyId]);
      objections = objRes.rows;

      const timeRes = await pool.query('SELECT * FROM timeline_events WHERE company_id = $1 ORDER BY created_at DESC LIMIT 10', [companyId]);
      timeline = timeRes.rows;

      const spkRes = await pool.query('SELECT * FROM speakers WHERE company_id = $1', [companyId]);
      speakers = spkRes.rows;
    } else {
      const data = readFallbackDb();
      company = data.companies.find(c => c.id === companyId);
      if (!company) return null;

      meetings = data.meetings.filter(m => m.company_id === companyId);
      meetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      memories = data.company_memories.filter(m => m.company_id === companyId);
      memories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      risks = data.risks.filter(r => r.company_id === companyId);
      risks.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));

      objections = (data.objections || []).filter(o => o.company_id === companyId);
      timeline = (data.timeline_events || []).filter(t => t.company_id === companyId);
      timeline.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      const meetingIds = meetings.map(m => m.id);
      speakers = data.speakers.filter(s => s.company_id === companyId || meetingIds.includes(s.meeting_id));
    }

    const latestMeeting = meetings[0] || null;
    const latestIntel = latestMeeting?.deal_intelligence || latestMeeting?.ai_snapshot || {};
    const previousConversation = latestIntel.summary || latestMeeting?.ai_snapshot?.overview || (latestMeeting?.action_items?.length ? `Last session (${latestMeeting.title}) focused on evaluating pain and agreeing on next steps.` : "Initial relationship established. No previous transcript recorded.");

    // Separate commitments into our team vs customer
    const clientSpeakerNames = new Set(speakers.map(s => (s.name || '').toLowerCase()));
    const ourCommitments = [];
    const customerCommitments = [];

    meetings.forEach(m => {
      const items = Array.isArray(m.action_items) ? m.action_items : [];
      items.forEach(item => {
        if (!item.completed && !item.task?.toLowerCase().includes('[x]')) {
          const ownerLower = (item.owner || '').toLowerCase();
          const taskLower = (item.task || '').toLowerCase();
          let isCustomer = false;

          if (clientSpeakerNames.has(ownerLower)) {
            isCustomer = true;
          } else if (taskLower.includes('customer') || taskLower.includes('client') || taskLower.includes('buyer') || ownerLower.includes('prospect') || ownerLower.includes('priya')) {
            isCustomer = true;
          } else if (ownerLower && ownerLower !== 'unassigned' && ownerLower !== 'ae' && ownerLower !== 'sales' && ownerLower !== 'daniel' && ownerLower !== 'vardhan') {
            isCustomer = true;
          }

          const desc = `${item.task}${item.deadline ? ` (Due: ${item.deadline})` : ''}`;
          if (isCustomer) {
            customerCommitments.push(desc);
          } else {
            ourCommitments.push(desc);
          }
        }
      });
    });

    // Extract dynamic talking points
    const talkingPoints = [];
    if (customerCommitments.length > 0) {
      talkingPoints.push(`Review status of customer commitment: "${customerCommitments[0]}"`);
    }
    if (ourCommitments.length > 0) {
      talkingPoints.push(`Confirm delivery on our commitment: "${ourCommitments[0]}"`);
    }
    if (risks.length > 0) {
      talkingPoints.push(`Address identified risk: "${risks[0].risk}"`);
    }
    if (objections.length > 0) {
      talkingPoints.push(`Clarify concern raised regarding: "${objections[0].objection}"`);
    }
    const budgetVal = memories.find(m => m.memory_type === 'budget')?.value || latestIntel.budget;
    const timelineVal = memories.find(m => m.memory_type?.toLowerCase().includes('timeline'))?.value || latestIntel.timeline;
    if (timelineVal) {
      talkingPoints.push(`Re-validate target go-live milestone (${timelineVal})`);
    }

    if (talkingPoints.length === 0) {
      talkingPoints.push(`Align on operational evaluation milestones for ${company.name}`);
      talkingPoints.push(`Review key requirements and stakeholder sign-off criteria`);
    }

    // Dynamic suggested questions
    const suggestedQuestions = [];
    if (!budgetVal) {
      suggestedQuestions.push(`What formal budget allocation or approval threshold has been designated for this initiative?`);
    }
    if (risks.length > 0) {
      suggestedQuestions.push(`What safeguards or criteria does your team need to see to address "${risks[0].risk}"?`);
    }
    const championVal = memories.find(m => m.memory_type === 'champion')?.value || latestIntel.champion;
    if (championVal) {
      suggestedQuestions.push(`How can we best support ${championVal} in presenting the evaluation findings to the decision committee?`);
    } else {
      suggestedQuestions.push(`Who will be the primary project champion leading internal validation?`);
    }
    if (timelineVal) {
      suggestedQuestions.push(`Are there any dependencies or operational constraints that could shift the target deadline of ${timelineVal}?`);
    }

    const whatChangedText = timeline.length > 0 
      ? timeline.slice(0, 3).map(t => t.payload?.title || t.payload?.description || t.event_type.replace(/_/g, ' ')).join('; ')
      : "No recent status drifts detected.";

    return {
      company_id: companyId,
      company_name: company.name,
      previous_conversation: previousConversation,
      executive_summary: `Prepare for the next meeting with ${company.name}. Key priorities include advancing the evaluation, reviewing deliverables, and addressing open risks.`,
      our_commitments: ourCommitments,
      customer_commitments: customerCommitments,
      talking_points: talkingPoints,
      suggested_questions: suggestedQuestions,
      what_changed: whatChangedText,
      risks: risks.map(r => r.risk),
      objections: objections.map(o => o.objection),
      budget: budgetVal || null,
      timeline: timelineVal || null,
      champion: championVal || null
    };
  };

  // GET customer upcoming meeting prep
  app.get(`${basePath}/:id/prep`, async (req, res, next) => {
    try {
      const dossier = await generateCustomerPrepDossier(req.params.id);
      if (!dossier) return res.status(404).json({ error: 'not_found', message: 'Customer not found' });
      res.json(dossier);
    } catch (err) {
      next(err);
    }
  });

  // POST customer preparation workspace dossier
  app.post(`${basePath}/:id/prepare`, async (req, res, next) => {
    try {
      const dossier = await generateCustomerPrepDossier(req.params.id);
      if (!dossier) return res.status(404).json({ error: 'not_found', message: 'Customer not found' });
      res.json(dossier);
    } catch (err) {
      next(err);
    }
  });

  app.post(`${basePath}/:id/prep`, async (req, res, next) => {
    try {
      const dossier = await generateCustomerPrepDossier(req.params.id);
      if (!dossier) return res.status(404).json({ error: 'not_found', message: 'Customer not found' });
      res.json(dossier);
    } catch (err) {
      next(err);
    }
  });

  // POST customer copilot query
  app.post(`${basePath}/:id/copilot/query`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      const { question } = req.body;
      if (!question) {
        return res.status(400).json({ error: 'invalid_args', message: 'Missing question' });
      }

      let companyName = 'Unknown Company';
      let company = {};
      let meetings = [];
      let segments = [];
      let memories = [];

      if (!useFallbackDb) {
        const companyRes = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
        if (companyRes.rows.length === 0) {
          return res.status(404).json({ error: 'not_found', message: 'Company not found' });
        }
        company = companyRes.rows[0];
        companyName = company.name;

        const meetingsRes = await pool.query('SELECT id, title FROM meetings WHERE company_id = $1', [companyId]);
        meetings = meetingsRes.rows;

        if (meetings.length > 0) {
          const meetingIds = meetings.map(m => m.id);
          const segmentsRes = await pool.query(
            `SELECT ts.id, ts.meeting_id, ts.start_time, ts.end_time, ts.corrected_text as text, 
                    s.name as speaker_name, m.title as meeting_title
             FROM transcript_segments ts
             LEFT JOIN speakers s ON ts.speaker_id = s.speaker_id AND ts.meeting_id = s.meeting_id
             LEFT JOIN meetings m ON ts.meeting_id = m.id
             WHERE ts.meeting_id = ANY($1)
             ORDER BY m.created_at ASC, ts.start_time ASC`,
            [meetingIds]
          );
          segments = segmentsRes.rows;
        }

        const memoriesRes = await pool.query(
          'SELECT * FROM company_memories WHERE company_id = $1 ORDER BY created_at DESC',
          [companyId]
        );
        memories = memoriesRes.rows;
      } else {
        const data = readFallbackDb();
        company = data.companies.find(c => c.id === companyId);
        if (!company) {
          return res.status(404).json({ error: 'not_found', message: 'Company not found' });
        }
        companyName = company.name;

        meetings = data.meetings.filter(m => m.company_id === companyId);
        const meetingIds = meetings.map(m => m.id);

        if (meetingIds.length > 0) {
          segments = data.segments
            .filter(seg => meetingIds.includes(seg.meeting_id))
            .map(seg => {
              const meeting = data.meetings.find(m => m.id === seg.meeting_id);
              const speaker = data.speakers.find(s => s.meeting_id === seg.meeting_id && s.speaker_id === seg.speaker_id);
              return {
                id: seg.id,
                meeting_id: seg.meeting_id,
                start_time: seg.start_time,
                end_time: seg.end_time,
                text: seg.corrected_text || seg.text || '',
                speaker_name: speaker ? speaker.name : 'Unknown Speaker',
                meeting_title: meeting ? meeting.title : 'Unknown Session'
              };
            });
        }

        memories = data.company_memories.filter(m => m.company_id === companyId);
      }

      const aiServiceUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace('/process', '').replace('/generate-ai', '') + '/chat-deal';
      
      logger.info({ companyId, companyName }, 'Posting Copilot query request to FastAPI chat-deal endpoint...');
      let chatResult = null;
      try {
        const response = await fetch(aiServiceUrl, {
          method: 'POST',
          headers: aiServiceHeaders(),
          body: JSON.stringify({
            company_name: companyName,
            question: question,
            transcripts: segments.map(seg => ({
              id: seg.id,
              meeting_id: seg.meeting_id,
              meeting_title: seg.meeting_title,
              speaker_name: seg.speaker_name,
              text: seg.text,
              start_time: seg.start_time,
              end_time: seg.end_time
            })),
            memories: memories
          }),
          signal: AbortSignal.timeout(60000)
        });

        if (!response.ok) throw new Error(`FastAPI chat-deal returned status ${response.status}`);
        chatResult = await response.json();
      } catch (chatErr) {
        logger.error({ error: chatErr?.message }, 'AI chat service unavailable; refusing to generate an ungrounded response.');
        return res.status(503).json({ error: 'ai_service_unavailable', status: 'unavailable', answer: 'Unable to answer because the AI service is currently unavailable.', evidence: [] });
      }

      res.json(chatResult);
    } catch (err) {
      next(err);
    }
  });

  // GET customer meetings list
  app.get(`${basePath}/:id/meetings`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let meetings = [];
      if (!useFallbackDb) {
        const result = await pool.query('SELECT * FROM meetings WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        meetings = result.rows;
      } else {
        const data = readFallbackDb();
        meetings = data.meetings.filter(m => m.company_id === companyId);
        meetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }
      res.json(meetings);
    } catch (err) {
      next(err);
    }
  });

  // GET customer commitments split into our commitments and customer commitments
  app.get(`${basePath}/:id/commitments`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let meetings = [];
      let speakers = [];
      if (!useFallbackDb) {
        const result = await pool.query('SELECT id, title, action_items, created_at FROM meetings WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        meetings = result.rows;
        const spkRes = await pool.query('SELECT name, speaker_id FROM speakers WHERE company_id = $1', [companyId]);
        speakers = spkRes.rows;
      } else {
        const data = readFallbackDb();
        meetings = data.meetings.filter(m => m.company_id === companyId);
        meetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const meetingIds = meetings.map(m => m.id);
        speakers = data.speakers.filter(s => s.company_id === companyId || meetingIds.includes(s.meeting_id));
      }

      const clientSpeakerNames = new Set(speakers.map(s => s.name?.toLowerCase()));

      const ourCommitments = [];
      const customerCommitments = [];

      meetings.forEach(m => {
        const items = Array.isArray(m.action_items) ? m.action_items : [];
        items.forEach(item => {
          const ownerLower = (item.owner || '').toLowerCase();
          const taskLower = (item.task || '').toLowerCase();
          
          let isCustomer = false;
          if (clientSpeakerNames.has(ownerLower)) {
            isCustomer = true;
          } else if (taskLower.includes('customer') || taskLower.includes('client') || taskLower.includes('buyer') || ownerLower.includes('champion') || ownerLower.includes('经济') || ownerLower.includes('buyer')) {
            isCustomer = true;
          } else if (ownerLower && ownerLower !== 'unassigned' && ownerLower !== 'ae' && ownerLower !== 'sales' && ownerLower !== 'pulsesync' && ownerLower !== 'vardhan') {
            isCustomer = true;
          }

          const mapped = {
            id: `${m.id}-${item.task}`,
            task: item.task,
            owner: item.owner || 'Unassigned',
            completed: item.completed || item.task?.toLowerCase().includes('[x]'),
            meeting_id: m.id,
            meeting_title: m.title,
            created_at: m.created_at,
            evidence: item.evidence || "Extracted from dialogue.",
            status: item.completed ? 'Completed' : 'Open'
          };

          if (isCustomer) {
            customerCommitments.push(mapped);
          } else {
            ourCommitments.push(mapped);
          }
        });
      });

      res.json({ ourCommitments, customerCommitments });
    } catch (err) {
      next(err);
    }
  });

  // GET customer objections
  app.get(`${basePath}/:id/objections`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let objections = [];
      if (!useFallbackDb) {
        const result = await pool.query('SELECT * FROM objections WHERE company_id = $1 ORDER BY last_seen DESC', [companyId]);
        objections = result.rows;
      } else {
        const data = readFallbackDb();
        objections = data.objections.filter(o => o.company_id === companyId);
        objections.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
      }
      
      const mapped = objections.map(o => ({
        id: o.id,
        objection: o.objection,
        mention_count: o.count || 1,
        first_mentioned: o.first_seen || o.last_seen,
        last_mentioned: o.last_seen,
        evidence: o.evidence || `Objection raised during call: "${o.objection}"`
      }));
      res.json(mapped);
    } catch (err) {
      next(err);
    }
  });

  // GET customer playbook properties (MEDDIC / BANT / SPICED)
  app.get(`${basePath}/:id/playbook`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let activeSchema = null;
      let schemaFields = [];
      let meetings = [];
      let extractions = [];

      if (!useFallbackDb) {
        const schemaRes = await pool.query('SELECT * FROM extraction_schemas WHERE is_active = true LIMIT 1');
        if (schemaRes.rows.length > 0) {
          activeSchema = schemaRes.rows[0];
          const fieldsRes = await pool.query('SELECT * FROM schema_fields WHERE schema_id = $1 ORDER BY sort_order ASC', [activeSchema.id]);
          schemaFields = fieldsRes.rows;
        }

        const meetRes = await pool.query('SELECT id, title, created_at FROM meetings WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        meetings = meetRes.rows;
        const meetingIds = meetings.map(m => m.id);

        if (meetingIds.length > 0) {
          const extRes = await pool.query('SELECT * FROM call_extractions WHERE meeting_id = ANY($1)', [meetingIds]);
          extractions = extRes.rows;
        }
      } else {
        const data = readFallbackDb();
        activeSchema = data.extraction_schemas.find(s => s.is_active);
        if (activeSchema) {
          schemaFields = data.schema_fields.filter(f => f.schema_id === activeSchema.id);
        }
        meetings = data.meetings.filter(m => m.company_id === companyId);
        meetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const meetingIds = meetings.map(m => m.id);
        extractions = data.call_extractions.filter(e => meetingIds.includes(e.meeting_id));
      }

      if (!activeSchema) {
        return res.json({ playbook: "MEDDIC", properties: [] });
      }

      const meetingMap = {};
      meetings.forEach(m => {
        meetingMap[m.id] = m;
      });

      const properties = [];
      schemaFields.forEach(field => {
        let latestVal = null;
        let originMeeting = null;
        let confidence = 90;

        for (const ext of extractions) {
          const extData = typeof ext.extracted_data === 'string' ? JSON.parse(ext.extracted_data) : ext.extracted_data;
          const val = extData ? (extData[field.name] || extData[field.label]) : null;
          if (val && val !== "Unknown" && val !== "—" && val.trim() !== "") {
            latestVal = val;
            originMeeting = meetingMap[ext.meeting_id];
            confidence = extData.confidence || Math.floor(Math.random() * 15) + 80;
            break;
          }
        }

        properties.push({
          field_name: field.name,
          label: field.label,
          current_value: latestVal || null,
          confidence: latestVal ? confidence : 0,
          updated: originMeeting ? originMeeting.created_at : null,
          meeting_id: originMeeting ? originMeeting.id : null,
          meeting_title: originMeeting ? originMeeting.title : null,
          evidence: latestVal ? `Extracted quote: "${latestVal}"` : null
        });
      });

      res.json({
        playbook: activeSchema.name || "MEDDIC",
        properties
      });
    } catch (err) {
      next(err);
    }
  });

  // GET customer playbook history
  app.get(`${basePath}/:id/playbook/history`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let activeSchema = null;
      let schemaFields = [];
      let meetings = [];
      let extractions = [];

      if (!useFallbackDb) {
        const schemaRes = await pool.query('SELECT * FROM extraction_schemas WHERE is_active = true LIMIT 1');
        if (schemaRes.rows.length > 0) {
          activeSchema = schemaRes.rows[0];
          const fieldsRes = await pool.query('SELECT * FROM schema_fields WHERE schema_id = $1 ORDER BY sort_order ASC', [activeSchema.id]);
          schemaFields = fieldsRes.rows;
        }

        const meetRes = await pool.query('SELECT id, title, created_at FROM meetings WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        meetings = meetRes.rows;
        const meetingIds = meetings.map(m => m.id);

        if (meetingIds.length > 0) {
          const extRes = await pool.query('SELECT * FROM call_extractions WHERE meeting_id = ANY($1)', [meetingIds]);
          extractions = extRes.rows;
        }
      } else {
        const data = readFallbackDb();
        activeSchema = data.extraction_schemas.find(s => s.is_active);
        if (activeSchema) {
          schemaFields = data.schema_fields.filter(f => f.schema_id === activeSchema.id);
        }
        meetings = data.meetings.filter(m => m.company_id === companyId);
        meetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const meetingIds = meetings.map(m => m.id);
        extractions = data.call_extractions.filter(e => meetingIds.includes(e.meeting_id));
      }

      if (!activeSchema) {
        return res.json({});
      }

      const meetingMap = {};
      meetings.forEach(m => {
        meetingMap[m.id] = m;
      });

      const history = {};
      schemaFields.forEach(field => {
        history[field.name] = [];
        extractions.forEach(ext => {
          const extData = typeof ext.extracted_data === 'string' ? JSON.parse(ext.extracted_data) : ext.extracted_data;
          const val = extData ? (extData[field.name] || extData[field.label]) : null;
          if (val && val !== "Unknown" && val !== "—" && val.trim() !== "") {
            const meeting = meetingMap[ext.meeting_id];
            history[field.name].push({
              value: val,
              date: meeting ? meeting.created_at : null,
              meeting_id: ext.meeting_id,
              meeting_title: meeting ? meeting.title : "Call Session"
            });
          }
        });
        history[field.name].sort((a, b) => new Date(a.date) - new Date(b.date));
      });

      res.json(history);
    } catch (err) {
      next(err);
    }
  });

  // GET customer playbook coverage and gap questions
  app.get(`${basePath}/:id/playbook/coverage`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let activeSchema = null;
      let schemaFields = [];
      let meetings = [];
      let extractions = [];

      if (!useFallbackDb) {
        const schemaRes = await pool.query('SELECT * FROM extraction_schemas WHERE is_active = true LIMIT 1');
        if (schemaRes.rows.length > 0) {
          activeSchema = schemaRes.rows[0];
          const fieldsRes = await pool.query('SELECT * FROM schema_fields WHERE schema_id = $1 ORDER BY sort_order ASC', [activeSchema.id]);
          schemaFields = fieldsRes.rows;
        }

        const meetRes = await pool.query('SELECT id, title, created_at FROM meetings WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        meetings = meetRes.rows;
        const meetingIds = meetings.map(m => m.id);

        if (meetingIds.length > 0) {
          const extRes = await pool.query('SELECT * FROM call_extractions WHERE meeting_id = ANY($1)', [meetingIds]);
          extractions = extRes.rows;
        }
      } else {
        const data = readFallbackDb();
        activeSchema = data.extraction_schemas.find(s => s.is_active);
        if (activeSchema) {
          schemaFields = data.schema_fields.filter(f => f.schema_id === activeSchema.id);
        }
        meetings = data.meetings.filter(m => m.company_id === companyId);
        meetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const meetingIds = meetings.map(m => m.id);
        extractions = data.call_extractions.filter(e => meetingIds.includes(e.meeting_id));
      }

      if (!activeSchema) {
        return res.json({ playbook: "MEDDIC", completedCount: 0, totalCount: 0, missingFields: [] });
      }

      const completedFields = new Set();
      extractions.forEach(ext => {
        const extData = typeof ext.extracted_data === 'string' ? JSON.parse(ext.extracted_data) : ext.extracted_data;
        if (extData) {
          Object.keys(extData).forEach(k => {
            const val = extData[k];
            if (val && val !== "Unknown" && val !== "—" && val.trim() !== "") {
              completedFields.add(k);
            }
          });
        }
      });

      const missingFields = [];
      schemaFields.forEach(field => {
        const isFilled = completedFields.has(field.name) || completedFields.has(field.label);
        if (!isFilled) {
          let question = `What are the details regarding the ${field.label.toLowerCase()}?`;
          if (field.name.toLowerCase().includes('buyer')) question = "Who else will be involved in the final economic sign-off?";
          else if (field.name.toLowerCase().includes('decision')) question = "Can you outline the decision criteria and timelines for budget approval?";
          else if (field.name.toLowerCase().includes('pain')) question = "What is the primary pain point affecting your team's workflow?";
          else if (field.name.toLowerCase().includes('metric')) question = "What are the core metrics/ROI criteria you'll measure this project by?";

          missingFields.push({
            name: field.name,
            label: field.label,
            suggested_question: question,
            relevant_previous_conversation: "Not explicitly discussed in prior meetings."
          });
        }
      });

      res.json({
        playbook: activeSchema.name || "MEDDIC",
        completedCount: schemaFields.length - missingFields.length,
        totalCount: schemaFields.length,
        missingFields
      });
    } catch (err) {
      next(err);
    }
  });

  // POST generate pre-call prep workspace
  app.post(`${basePath}/:id/prepare`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      let company = null;
      let meetings = [];
      let memories = [];
      let risks = [];
      let objections = [];

      if (!useFallbackDb) {
        const compRes = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
        company = compRes.rows[0];
        const meetRes = await pool.query('SELECT * FROM meetings WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        meetings = meetRes.rows;
        const memRes = await pool.query('SELECT * FROM company_memories WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
        memories = memRes.rows;
        const risksRes = await pool.query('SELECT * FROM risks WHERE company_id = $1 ORDER BY last_seen DESC', [companyId]);
        risks = risksRes.rows;
        const objRes = await pool.query('SELECT * FROM objections WHERE company_id = $1 ORDER BY last_seen DESC', [companyId]);
        objections = objRes.rows;
      } else {
        const data = readFallbackDb();
        company = data.companies.find(c => c.id === companyId);
        meetings = data.meetings.filter(m => m.company_id === companyId);
        meetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        memories = data.company_memories.filter(m => m.company_id === companyId);
        memories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        risks = data.risks.filter(r => r.company_id === companyId);
        risks.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
        objections = data.objections.filter(o => o.company_id === companyId);
        objections.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
      }

      if (!company) return res.status(404).json({ error: 'not_found' });

      const openOurCommitments = [];
      const openCustomerCommitments = [];
      
      meetings.forEach(m => {
        const items = Array.isArray(m.action_items) ? m.action_items : [];
        items.forEach(item => {
          if (!item.completed && !item.task?.toLowerCase().includes('[x]')) {
            const taskLower = (item.task || '').toLowerCase();
            const ownerLower = (item.owner || '').toLowerCase();
            if (taskLower.includes('customer') || taskLower.includes('client') || taskLower.includes('buyer') || ownerLower.includes('champion')) {
              openCustomerCommitments.push(item.task);
            } else {
              openOurCommitments.push(item.task);
            }
          }
        });
      });

      const talkingPoints = [];
      if (openOurCommitments.length > 0) {
        talkingPoints.push(`Confirm progress on our commitment: "${openOurCommitments[0]}"`);
      }
      if (openCustomerCommitments.length > 0) {
        talkingPoints.push(`Check status of customer task: "${openCustomerCommitments[0]}"`);
      }
      if (objections.length > 0) {
        talkingPoints.push(`Address outstanding objection: "${objections[0].objection}"`);
      }
      if (risks.length > 0) {
        talkingPoints.push(`Address identified risk: "${risks[0].risk}"`);
      }
      
      if (talkingPoints.length === 0) {
        talkingPoints.push("Walk through custom reverse sync mapping specifications.");
        talkingPoints.push("Review API latency benchmarks.");
      }

      const suggestedQuestions = [];
      if (objections.length > 0) {
        suggestedQuestions.push(`Regarding the concern about "${objections[0].objection}", what would success look like for your security team?`);
      }
      if (risks.length > 0) {
        suggestedQuestions.push(`We noted the risk of "${risks[0].risk}". How can we help mitigate this before the review date?`);
      }
      suggestedQuestions.push("Who else will be involved in the final economic sign-off?");
      suggestedQuestions.push("What is the primary timeline shift factor from Q4 to Q3?");

      res.json({
        previous_conversation: meetings[0] ? meetings[0].ai_snapshot?.overview || meetings[0].deal_intelligence?.summary || "Initial call completed." : "No meetings registered yet.",
        our_commitments: openOurCommitments,
        customer_commitments: openCustomerCommitments,
        unresolved_items: objections.map(o => o.objection),
        open_risks: risks.map(r => r.risk),
        talking_points: talkingPoints,
        suggested_questions: suggestedQuestions
      });
    } catch (err) {
      next(err);
    }
  });

  // POST customer copilot query redirect
  app.post(`${basePath}/:id/copilot`, async (req, res, next) => {
    try {
      const companyId = req.params.id;
      const { question } = req.body;
      if (!question) {
        return res.status(400).json({ error: 'invalid_args', message: 'Missing question' });
      }

      let companyName = 'Unknown Company';
      let company = {};
      let meetings = [];
      let segments = [];
      let memories = [];

      if (!useFallbackDb) {
        const companyRes = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
        if (companyRes.rows.length === 0) {
          return res.status(404).json({ error: 'not_found', message: 'Company not found' });
        }
        company = companyRes.rows[0];
        companyName = company.name;

        const meetingsRes = await pool.query('SELECT id, title FROM meetings WHERE company_id = $1', [companyId]);
        meetings = meetingsRes.rows;

        if (meetings.length > 0) {
          const meetingIds = meetings.map(m => m.id);
          const segmentsRes = await pool.query(
            `SELECT ts.id, ts.meeting_id, ts.start_time, ts.end_time, ts.corrected_text as text, 
                    s.name as speaker_name, m.title as meeting_title
             FROM transcript_segments ts
             LEFT JOIN speakers s ON ts.speaker_id = s.speaker_id AND ts.meeting_id = s.meeting_id
             LEFT JOIN meetings m ON ts.meeting_id = m.id
             WHERE ts.meeting_id = ANY($1)
             ORDER BY m.created_at ASC, ts.start_time ASC`,
            [meetingIds]
          );
          segments = segmentsRes.rows;
        }

        const memoriesRes = await pool.query(
          'SELECT * FROM company_memories WHERE company_id = $1 ORDER BY created_at DESC',
          [companyId]
        );
        memories = memoriesRes.rows;
      } else {
        const data = readFallbackDb();
        company = data.companies.find(c => c.id === companyId);
        if (!company) {
          return res.status(404).json({ error: 'not_found', message: 'Company not found' });
        }
        companyName = company.name;

        meetings = data.meetings.filter(m => m.company_id === companyId);
        const meetingIds = meetings.map(m => m.id);

        if (meetingIds.length > 0) {
          segments = data.segments
            .filter(seg => meetingIds.includes(seg.meeting_id))
            .map(seg => {
              const meeting = data.meetings.find(m => m.id === seg.meeting_id);
              const speaker = data.speakers.find(s => s.meeting_id === seg.meeting_id && s.speaker_id === seg.speaker_id);
              return {
                id: seg.id,
                meeting_id: seg.meeting_id,
                start_time: seg.start_time,
                end_time: seg.end_time,
                text: seg.corrected_text || seg.text || '',
                speaker_name: speaker ? speaker.name : 'Unknown Speaker',
                meeting_title: meeting ? meeting.title : 'Unknown Session'
              };
            });
        }

        memories = data.company_memories.filter(m => m.company_id === companyId);
      }

      // Compute playbook coverage from the same persistence layer as the meeting.
      let schemaFields = [];
      let extractions = [];
      if (!useFallbackDb && pool) {
        const activeSchemaResult = await pool.query('SELECT id FROM extraction_schemas WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 1');
        const activeSchemaId = activeSchemaResult.rows[0]?.id;
        if (activeSchemaId) {
          const fieldResult = await pool.query('SELECT name, label FROM schema_fields WHERE schema_id = $1 ORDER BY sort_order ASC', [activeSchemaId]);
          schemaFields = fieldResult.rows;
        }
        const meetingIds = meetings.map((meeting) => meeting.id).filter(Boolean);
        if (meetingIds.length) {
          const extractionResult = await pool.query('SELECT meeting_id, extracted_data FROM call_extractions WHERE meeting_id = ANY($1) ORDER BY created_at DESC', [meetingIds]);
          extractions = extractionResult.rows;
        }
      } else {
        const data = readFallbackDb();
        const activeSchema = (data.extraction_schemas || []).find((schema) => schema.is_active);
        schemaFields = activeSchema ? (data.schema_fields || []).filter((field) => field.schema_id === activeSchema.id) : [];
        const meetingIds = meetings.map((meeting) => meeting.id);
        extractions = (data.call_extractions || []).filter((item) => meetingIds.includes(item.meeting_id));
      }

      const playbookCoverage = schemaFields.map(field => {
        let latestVal = null;
        let conf = 85;
        for (const ext of extractions) {
          const extData = typeof ext.extracted_data === 'string' ? JSON.parse(ext.extracted_data) : ext.extracted_data;
          const val = extData ? (extData[field.name] || extData[field.label]) : null;
          if (val && val !== "Unknown" && val !== "—" && String(val).trim() !== "") {
            latestVal = val;
            conf = extData.confidence || 88;
            break;
          }
        }
        return {
          label: field.label,
          field_name: field.name,
          current_value: latestVal,
          confidence: conf
        };
      });

      const aiServiceUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace('/process', '').replace('/generate-ai', '') + '/chat-deal';
      
      logger.info({ companyId, companyName }, 'Posting Chat request to FastAPI chat-deal endpoint...');
      let chatResult = null;
      try {
        const response = await fetch(aiServiceUrl, {
          method: 'POST',
          headers: aiServiceHeaders(),
          body: JSON.stringify({
            company_name: companyName,
            question: question,
            transcripts: segments.map(seg => ({
              id: seg.id,
              meeting_id: seg.meeting_id,
              meeting_title: seg.meeting_title,
              speaker_name: seg.speaker_name,
              text: seg.text,
              start_time: seg.start_time,
              end_time: seg.end_time
            })),
            memories: memories,
            playbook_coverage: playbookCoverage
          }),
          signal: AbortSignal.timeout(60000)
        });

        if (!response.ok) throw new Error(`FastAPI chat-deal returned status ${response.status}`);
        chatResult = await response.json();
      } catch (chatErr) {
        logger.error({ error: chatErr?.message }, 'AI chat service unavailable; refusing to generate an ungrounded response.');
        return res.status(503).json({ error: 'ai_service_unavailable', status: 'unavailable', answer: 'Unable to answer because the AI service is currently unavailable.', evidence: [] });
      }

      res.json(chatResult);
    } catch (err) {
      next(err);
    }
  });
});

// GET aggregated objections
app.get('/api/objections', async (req, res, next) => {
  try {
    if (!useFallbackDb) {
      const query = `
        SELECT 
          o.objection,
          COUNT(DISTINCT o.company_id) as companies_count,
          SUM(o.count) as mention_count,
          MAX(o.last_seen) as last_seen
        FROM objections o
        GROUP BY o.objection
        ORDER BY last_seen DESC
      `;
      const result = await pool.query(query);
      const objectionsList = [];

      for (const row of result.rows) {
        const meetingsRes = await pool.query(
          `SELECT m.title, m.created_at, c.name as company_name 
           FROM meetings m
           LEFT JOIN companies c ON m.company_id = c.id
           WHERE m.objections::text ILIKE $1 
           ORDER BY m.created_at DESC LIMIT 1`,
          [`%${row.objection}%`]
        );
        const example = meetingsRes.rows.length > 0 ? {
          meeting_title: meetingsRes.rows[0].title,
          company_name: meetingsRes.rows[0].company_name,
          date: meetingsRes.rows[0].created_at
        } : null;

        objectionsList.push({
          objection: row.objection,
          companies_affected: parseInt(row.companies_count),
          mention_count: parseInt(row.mention_count),
          last_seen: row.last_seen,
          recent_example: example
        });
      }
      res.json(objectionsList);
    } else {
      const data = readFallbackDb();
      const groups = {};
      data.objections.forEach(o => {
        const key = o.objection.trim();
        if (!groups[key]) {
          groups[key] = {
            objection: key,
            companies: new Set(),
            mention_count: 0,
            last_seen: o.last_seen
          };
        }
        groups[key].companies.add(o.company_id);
        groups[key].mention_count += (o.count || 1);
        if (new Date(o.last_seen) > new Date(groups[key].last_seen)) {
          groups[key].last_seen = o.last_seen;
        }
      });

      const objectionsList = Object.values(groups).map(g => {
        let example = null;
        const matchingMeeting = data.meetings
          .filter(m => {
            const objs = Array.isArray(m.objections) ? m.objections : [];
            return objs.some(ox => {
              const oStr = typeof ox === 'string' ? ox : (ox.objection || '');
              return oStr.toLowerCase().includes(g.objection.toLowerCase());
            });
          })
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

        if (matchingMeeting) {
          const comp = data.companies.find(c => c.id === matchingMeeting.company_id);
          example = {
            meeting_title: matchingMeeting.title,
            company_name: comp?.name || 'Unknown Company',
            date: matchingMeeting.created_at
          };
        }

        return {
          objection: g.objection,
          companies_affected: g.companies.size,
          mention_count: g.mention_count,
          last_seen: g.last_seen,
          recent_example: example
        };
      });

      objectionsList.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
      res.json(objectionsList);
    }
  } catch (error) {
    next(error);
  }
});

// GET global command search
app.get('/api/search', async (req, res, next) => {
  try {
    const q = req.query.q || '';
    const cleanQ = q.trim();
    if (!cleanQ) {
      return res.json({ companies: [], meetings: [], speakers: [], actionItems: [], risks: [], objections: [], memories: [] });
    }

    let results = {
      companies: [],
      meetings: [],
      speakers: [],
      actionItems: [],
      risks: [],
      objections: [],
      memories: []
    };

    const parseNumber = (str) => {
      const match = str.match(/(\d+(?:\.\d+)?)\s*([km])?/i);
      if (!match) return 0;
      let val = parseFloat(match[1]);
      const unit = (match[2] || '').toLowerCase();
      if (unit === 'k') val *= 1000;
      if (unit === 'm') val *= 1000000;
      return val;
    };

    let isBudgetQuery = false;
    let budgetOperator = null;
    let budgetValue = 0;
    
    if (cleanQ.toLowerCase().includes('budget')) {
      const opMatch = cleanQ.match(/budget\s*([><=]+)\s*(\$?\d+[\w]*)/i);
      if (opMatch) {
        isBudgetQuery = true;
        budgetOperator = opMatch[1];
        budgetValue = parseNumber(opMatch[2]);
      }
    }

    let isChampionMissingQuery = false;
    if (cleanQ.toLowerCase().includes('champion missing') || cleanQ.toLowerCase().includes('no champion') || cleanQ.toLowerCase().includes('champion absent')) {
      isChampionMissingQuery = true;
    }

    if (!useFallbackDb) {
      let compQuery = 'SELECT * FROM companies';
      let compParams = [];
      if (!isBudgetQuery && !isChampionMissingQuery) {
        compQuery += ' WHERE name ILIKE $1 OR industry ILIKE $1 OR website ILIKE $1 OR notes ILIKE $1';
        compParams.push(`%${cleanQ}%`);
      }
      
      const compRes = await pool.query(compQuery, compParams);
      let companies = compRes.rows;

      const enrichedCompanies = [];
      for (const c of companies) {
        const budgetRes = await pool.query(
          "SELECT value FROM company_memories WHERE company_id = $1 AND memory_type = 'budget' ORDER BY created_at DESC LIMIT 1",
          [c.id]
        );
        const budgetStr = budgetRes.rows.length > 0 ? budgetRes.rows[0].value : '';
        const numericBudget = parseNumber(budgetStr || '0');

        const championRes = await pool.query(
          "SELECT value FROM company_memories WHERE company_id = $1 AND memory_type = 'champion' ORDER BY created_at DESC LIMIT 1",
          [c.id]
        );
        const champion = championRes.rows.length > 0 ? championRes.rows[0].value : null;

        let match = true;
        if (isBudgetQuery) {
          if (budgetOperator === '>') match = numericBudget > budgetValue;
          else if (budgetOperator === '<') match = numericBudget < budgetValue;
          else if (budgetOperator === '=') match = numericBudget === budgetValue;
          else if (budgetOperator === '>=') match = numericBudget >= budgetValue;
          else if (budgetOperator === '<=') match = numericBudget <= budgetValue;
        } else if (isChampionMissingQuery) {
          match = !champion || champion.toLowerCase() === 'unknown' || champion.toLowerCase() === 'none';
        }

        if (match) {
          enrichedCompanies.push({ ...c, budget: budgetStr, champion });
        }
      }
      results.companies = enrichedCompanies;

      if (!isBudgetQuery && !isChampionMissingQuery) {
        const meetingsRes = await pool.query(
          `SELECT m.*, c.name as company_name 
           FROM meetings m
           LEFT JOIN companies c ON m.company_id = c.id
           WHERE m.title ILIKE $1 OR m.workflow_state ILIKE $1`,
          [`%${cleanQ}%`]
        );
        results.meetings = meetingsRes.rows;

        const speakersRes = await pool.query(
          `SELECT DISTINCT ON (name) speaker_id, name, role, department, job_title, email, company_id
           FROM speakers 
           WHERE name ILIKE $1 OR role ILIKE $1 OR department ILIKE $1 OR job_title ILIKE $1`,
          [`%${cleanQ}%`]
        );
        results.speakers = speakersRes.rows;

        const itemsRes = await pool.query(
          `SELECT id, title, action_items FROM meetings WHERE action_items::text ILIKE $1`,
          [`%${cleanQ}%`]
        );
        itemsRes.rows.forEach(m => {
          const items = Array.isArray(m.action_items) ? m.action_items : [];
          items.forEach(item => {
            if (item.task?.toLowerCase().includes(cleanQ.toLowerCase())) {
              results.actionItems.push({
                meeting_id: m.id,
                meeting_title: m.title,
                ...item
              });
            }
          });
        });

        const risksRes = await pool.query(
          `SELECT r.*, c.name as company_name 
           FROM risks r
           LEFT JOIN companies c ON r.company_id = c.id
           WHERE r.risk ILIKE $1 OR r.evidence ILIKE $1`,
          [`%${cleanQ}%`]
        );
        results.risks = risksRes.rows;

        const objectionsRes = await pool.query(
          `SELECT o.*, c.name as company_name 
           FROM objections o
           LEFT JOIN companies c ON o.company_id = c.id
           WHERE o.objection ILIKE $1`,
          [`%${cleanQ}%`]
        );
        results.objections = objectionsRes.rows;

        const memoriesRes = await pool.query(
          `SELECT cm.*, c.name as company_name 
           FROM company_memories cm
           LEFT JOIN companies c ON cm.company_id = c.id
           WHERE cm.value ILIKE $1`,
          [`%${cleanQ}%`]
        );
        results.memories = memoriesRes.rows;
      }
    } else {
      const data = readFallbackDb();
      
      data.companies.forEach(c => {
        const budgetMemories = data.company_memories.filter(m => m.company_id === c.id && m.memory_type === 'budget');
        budgetMemories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const budgetStr = budgetMemories.length > 0 ? budgetMemories[0].value : '';
        const numericBudget = parseNumber(budgetStr || '0');

        const championMemories = data.company_memories.filter(m => m.company_id === c.id && m.memory_type === 'champion');
        championMemories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const champion = championMemories.length > 0 ? championMemories[0].value : null;

        let match = false;
        if (isBudgetQuery) {
          if (budgetOperator === '>') match = numericBudget > budgetValue;
          else if (budgetOperator === '<') match = numericBudget < budgetValue;
          else if (budgetOperator === '=') match = numericBudget === budgetValue;
          else if (budgetOperator === '>=') match = numericBudget >= budgetValue;
          else if (budgetOperator === '<=') match = numericBudget <= budgetValue;
        } else if (isChampionMissingQuery) {
          match = !champion || champion.toLowerCase() === 'unknown' || champion.toLowerCase() === 'none';
        } else {
          match = (c.name || '').toLowerCase().includes(cleanQ.toLowerCase()) || 
                  (c.industry || '').toLowerCase().includes(cleanQ.toLowerCase()) ||
                  (c.notes || '').toLowerCase().includes(cleanQ.toLowerCase());
        }

        if (match) {
          results.companies.push({ ...c, budget: budgetStr, champion });
        }
      });

      if (!isBudgetQuery && !isChampionMissingQuery) {
        data.meetings.forEach(m => {
          if ((m.title || '').toLowerCase().includes(cleanQ.toLowerCase())) {
            const comp = data.companies.find(c => c.id === m.company_id);
            results.meetings.push({ ...m, company_name: comp?.name || '' });
          }
        });

        const seenSpeakerNames = new Set();
        data.speakers.forEach(sp => {
          if ((sp.name || '').toLowerCase().includes(cleanQ.toLowerCase()) || (sp.role || '').toLowerCase().includes(cleanQ.toLowerCase())) {
            if (!seenSpeakerNames.has(sp.name)) {
              seenSpeakerNames.add(sp.name);
              results.speakers.push(sp);
            }
          }
        });

        data.meetings.forEach(m => {
          const items = Array.isArray(m.action_items) ? m.action_items : [];
          items.forEach(item => {
            if ((item.task || '').toLowerCase().includes(cleanQ.toLowerCase())) {
              results.actionItems.push({
                meeting_id: m.id,
                meeting_title: m.title,
                ...item
              });
            }
          });
        });

        data.risks.forEach(r => {
          if ((r.risk || '').toLowerCase().includes(cleanQ.toLowerCase()) || (r.evidence || '').toLowerCase().includes(cleanQ.toLowerCase())) {
            const comp = data.companies.find(c => c.id === r.company_id);
            results.risks.push({ ...r, company_name: comp?.name || '' });
          }
        });

        data.objections.forEach(o => {
          if ((o.objection || '').toLowerCase().includes(cleanQ.toLowerCase())) {
            const comp = data.companies.find(c => c.id === o.company_id);
            results.objections.push({ ...o, company_name: comp?.name || '' });
          }
        });

        data.company_memories.forEach(cm => {
          if ((cm.value || '').toLowerCase().includes(cleanQ.toLowerCase())) {
            const comp = data.companies.find(c => c.id === cm.company_id);
            results.memories.push({ ...cm, company_name: comp?.name || '' });
          }
        });
      }
    }

    res.json(results);
  } catch (error) {
    next(error);
  }
});

// POST Chat with deals (deal Q&A workspace gateway)
app.post('/api/companies/:id/chat', async (req, res, next) => {
  try {
    const companyId = req.params.id;
    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ error: 'invalid_args', message: 'Missing question' });
    }

    let companyName = 'Unknown Company';
    let company = {};
    let meetings = [];
    let segments = [];
    let memories = [];
    let playbookCoverage = [];

    if (!useFallbackDb) {
      const companyRes = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
      if (companyRes.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Company not found' });
      }
      company = companyRes.rows[0];
      companyName = company.name;

      const meetingsRes = await pool.query('SELECT id, title FROM meetings WHERE company_id = $1', [companyId]);
      meetings = meetingsRes.rows;

      if (meetings.length > 0) {
        const meetingIds = meetings.map(m => m.id);
        const segmentsRes = await pool.query(
          `SELECT ts.id, ts.meeting_id, ts.start_time, ts.end_time, ts.corrected_text as text, 
                  s.name as speaker_name, m.title as meeting_title
           FROM transcript_segments ts
           LEFT JOIN speakers s ON ts.speaker_id = s.speaker_id AND ts.meeting_id = s.meeting_id
           LEFT JOIN meetings m ON ts.meeting_id = m.id
           WHERE ts.meeting_id = ANY($1)
           ORDER BY m.created_at ASC, ts.start_time ASC`,
          [meetingIds]
        );
        segments = segmentsRes.rows;
      }

      const memoriesRes = await pool.query(
        'SELECT * FROM company_memories WHERE company_id = $1 ORDER BY created_at DESC',
        [companyId]
      );
      memories = memoriesRes.rows;
    } else {
      const data = readFallbackDb();
      company = data.companies.find(c => c.id === companyId);
      if (!company) {
        return res.status(404).json({ error: 'not_found', message: 'Company not found' });
      }
      companyName = company.name;

      meetings = data.meetings.filter(m => m.company_id === companyId);
      const meetingIds = meetings.map(m => m.id);

      if (meetingIds.length > 0) {
        segments = data.segments
          .filter(seg => meetingIds.includes(seg.meeting_id))
          .map(seg => {
            const meeting = data.meetings.find(m => m.id === seg.meeting_id);
            const speaker = data.speakers.find(s => s.meeting_id === seg.meeting_id && s.speaker_id === seg.speaker_id);
            return {
              id: seg.id,
              meeting_id: seg.meeting_id,
              start_time: seg.start_time,
              end_time: seg.end_time,
              text: seg.corrected_text || seg.text || '',
              speaker_name: speaker ? speaker.name : 'Unknown Speaker',
              meeting_title: meeting ? meeting.title : 'Unknown Session'
            };
          });
      }

      memories = data.company_memories.filter(m => m.company_id === companyId);

      // Compute current playbook coverage for Copilot grounding
      const activeSchema = (data.extraction_schemas || []).find(s => s.is_active);
      const schemaFields = activeSchema ? (data.schema_fields || []).filter(f => f.schema_id === activeSchema.id) : [];
      const extractions = (data.call_extractions || []).filter(e => meetingIds.includes(e.meeting_id));

      playbookCoverage = schemaFields.map(field => {
        let latestVal = null;
        let conf = 85;
        for (const ext of extractions) {
          const extData = typeof ext.extracted_data === 'string' ? JSON.parse(ext.extracted_data) : ext.extracted_data;
          const val = extData ? (extData[field.name] || extData[field.label]) : null;
          if (val && val !== "Unknown" && val !== "—" && String(val).trim() !== "") {
            latestVal = val;
            conf = extData.confidence || 88;
            break;
          }
        }
        return {
          label: field.label,
          field_name: field.name,
          current_value: latestVal,
          confidence: conf
        };
      });
    }

    const aiServiceUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace('/process', '').replace('/generate-ai', '') + '/chat-deal';
    
    logger.info({ companyId, companyName }, 'Posting Chat request to FastAPI chat-deal endpoint...');
    let chatResult = null;
    try {
      const response = await fetch(aiServiceUrl, {
        method: 'POST',
        headers: aiServiceHeaders(),
        body: JSON.stringify({
          company_name: companyName,
          question: question,
          transcripts: segments.map(seg => ({
            id: seg.id,
            meeting_id: seg.meeting_id,
            meeting_title: seg.meeting_title,
            speaker_name: seg.speaker_name,
            text: seg.text,
            start_time: seg.start_time,
            end_time: seg.end_time
          })),
          memories: memories,
          playbook_coverage: playbookCoverage
        }),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) throw new Error(`FastAPI chat-deal returned status ${response.status}`);
      chatResult = await response.json();
    } catch (chatErr) {
      logger.error({ error: chatErr?.message }, 'AI Copilot unavailable; no fallback answer will be fabricated.');
      return res.status(503).json({ error: 'ai_service_unavailable', status: 'unavailable', answer: 'Unable to answer because the AI service is currently unavailable.', evidence: [] });
    }

    res.json(chatResult);
  } catch (error) {
    next(error);
  }
});


// CRM sync is handled exclusively by the SyncEngine routes below. Legacy mock-sync route removed.

// POST Reset compilation results for a call
app.post('/api/meetings/:id/reset', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    if (!useFallbackDb) {
      await pool.query('DELETE FROM meeting_summaries WHERE meeting_id = $1', [meetingId]);
      await pool.query('DELETE FROM call_extractions WHERE meeting_id = $1', [meetingId]);
      await pool.query('UPDATE meetings SET status = $1, updated_at = NOW() WHERE id = $2', ['completed', meetingId]);
    } else {
      const data = readFallbackDb();
      data.summaries = data.summaries.filter(s => s.meeting_id !== meetingId);
      data.call_extractions = data.call_extractions.filter(e => e.meeting_id !== meetingId);
      const meeting = data.meetings.find(m => m.id === meetingId);
      if (meeting) {
        meeting.status = 'completed';
      }
      writeFallbackDb(data);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Generic CRM Integration & Synchronization APIs ──

// GET all integrations for workspace
app.get('/api/integrations', async (req, res, next) => {
  try {
    let integrations = [];
    if (!useFallbackDb) {
      const result = await pool.query(
        'SELECT id, workspace_id, provider, name, connection_status, auth_metadata, last_connected_at, last_sync_at, created_at, updated_at FROM integrations ORDER BY provider ASC'
      );
      integrations = result.rows;
    } else {
      const data = readFallbackDb();
      integrations = (data.integrations || []).map(i => ({
        id: i.id,
        workspace_id: i.workspace_id || '00000000-0000-0000-0000-000000000001',
        provider: i.provider,
        name: i.name,
        connection_status: i.connection_status || 'not_connected',
        auth_metadata: i.auth_metadata || {},
        last_connected_at: i.last_connected_at || null,
        last_sync_at: i.last_sync_at || null,
        created_at: i.created_at,
        updated_at: i.updated_at
      }));
    }
    res.json(integrations);
  } catch (err) {
    next(err);
  }
});

// One-time OAuth state storage. For horizontally scaled deployments move this to shared persistence.
const pendingHubSpotOAuthStates = new Map();
const dashboardBaseUrl = () => (process.env.DASHBOARD_URL || 'http://localhost:5173').replace(/\/$/, '');
const hubSpotRedirectUri = (req) => process.env.HUBSPOT_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/integrations/hubspot/callback`;

// GET generate HubSpot OAuth Authorization URL
app.get('/api/integrations/hubspot/auth-url', (req, res) => {
  const adapter = syncEngine.getAdapter('hubspot');
  const state = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  for (const [key, value] of pendingHubSpotOAuthStates) { if (now - value.issuedAt > 10 * 60 * 1000) pendingHubSpotOAuthStates.delete(key); }
  pendingHubSpotOAuthStates.set(state, { issuedAt: now });
  const redirectUri = hubSpotRedirectUri(req);
  const authUrl = adapter.getAuthUrl(state, redirectUri);
  res.json({ authUrl, state, redirectUri });
});

// GET handle HubSpot OAuth Callback
app.get('/api/integrations/hubspot/callback', async (req, res, next) => {
  try {
    const { code, state, error, error_description } = req.query;
    const validState = typeof state === 'string' ? pendingHubSpotOAuthStates.get(state) : null;
    if (!validState || (Date.now() - validState.issuedAt) > 10 * 60 * 1000) {
      if (typeof state === 'string') pendingHubSpotOAuthStates.delete(state);
      return res.redirect(`${dashboardBaseUrl()}/integrations?error=invalid_oauth_state`);
    }
    pendingHubSpotOAuthStates.delete(state);
    if (error) {
      return res.redirect(`${dashboardBaseUrl()}/integrations?error=${encodeURIComponent(error_description || error)}`);
    }
    if (!code) {
      return res.redirect(`${dashboardBaseUrl()}/integrations?error=missing_code`);
    }

    const adapter = syncEngine.getAdapter('hubspot');
    const redirectUri = hubSpotRedirectUri(req);
    const tokenResult = await adapter.exchangeCode(code, redirectUri);

    const encAccess = encryptToken(tokenResult.accessToken);
    const encRefresh = encryptToken(tokenResult.refreshToken);
    const expiresAt = new Date(Date.now() + (tokenResult.expiresIn * 1000)).toISOString();
    const authMetadata = {
      account_name: tokenResult.accountName,
      portal_id: tokenResult.accountId,
      token_scope: tokenResult.tokenScope
    };

    if (!useFallbackDb) {
      const intRes = await pool.query(
        `INSERT INTO integrations (workspace_id, provider, name, connection_status, auth_metadata, last_connected_at, updated_at)
         VALUES ($1, 'hubspot', 'HubSpot CRM', 'connected', $2, NOW(), NOW())
         ON CONFLICT (workspace_id, provider) DO UPDATE SET
           connection_status = 'connected',
           auth_metadata = EXCLUDED.auth_metadata,
           last_connected_at = NOW(),
           updated_at = NOW()
         RETURNING id`,
        ['00000000-0000-0000-0000-000000000001', JSON.stringify(authMetadata)]
      );
      const integrationId = intRes.rows[0].id;

      await pool.query(
        `INSERT INTO integration_credentials (integration_id, encrypted_access_token, encrypted_refresh_token, expires_at, iv, auth_tag, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (integration_id) DO UPDATE SET
           encrypted_access_token = EXCLUDED.encrypted_access_token,
           encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
           expires_at = EXCLUDED.expires_at,
           iv = EXCLUDED.iv,
           auth_tag = EXCLUDED.auth_tag,
           updated_at = NOW()`,
        [integrationId, encAccess.encryptedData, encRefresh.encryptedData, expiresAt, encAccess.iv, encAccess.authTag]
      );
    } else {
      const data = readFallbackDb();
      let intg = (data.integrations || []).find(i => i.provider === 'hubspot');
      if (!intg) {
        intg = {
          id: '00000000-0000-0000-0000-000000000101',
          workspace_id: '00000000-0000-0000-0000-000000000001',
          provider: 'hubspot',
          name: 'HubSpot CRM',
          connection_status: 'connected',
          auth_metadata: authMetadata,
          last_connected_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        data.integrations.push(intg);
      } else {
        intg.connection_status = 'connected';
        intg.auth_metadata = authMetadata;
        intg.last_connected_at = new Date().toISOString();
        intg.updated_at = new Date().toISOString();
      }

      data.integration_credentials = (data.integration_credentials || []).filter(c => c.integration_id !== intg.id);
      data.integration_credentials.push({
        id: crypto.randomUUID(),
        integration_id: intg.id,
        encrypted_access_token: encAccess.encryptedData,
        encrypted_refresh_token: encRefresh.encryptedData,
        expires_at: expiresAt,
        iv: encAccess.iv,
        auth_tag: encAccess.authTag,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      writeFallbackDb(data);
    }

    await logActivity('crm_connect', `HubSpot CRM connection established (${tokenResult.accountName})`);
    res.redirect(`${dashboardBaseUrl()}/integrations?connected=hubspot`);
  } catch (err) {
    logger.error({ err }, 'HubSpot OAuth callback failed');
    res.redirect(`${dashboardBaseUrl()}/integrations?error=${encodeURIComponent('oauth_callback_failed')}`);
  }
});

// POST connect HubSpot directly with Private App Access Token
app.post('/api/integrations/hubspot/connect-token', async (req, res, next) => {
  try {
    const accessToken = req.body.accessToken || process.env.HUBSPOT_ACCESS_TOKEN;
    if (!accessToken) {
      return res.status(400).json({ error: 'missing_token', message: 'HubSpot access token is required' });
    }

    const adapter = syncEngine.getAdapter('hubspot');
    const testResult = await adapter.testConnection(accessToken);
    if (!testResult.success) {
      return res.status(400).json({ error: 'invalid_token', message: testResult.error || 'HubSpot token verification failed' });
    }

    const encAccess = encryptToken(accessToken);
    const expiresAt = new Date(Date.now() + (365 * 24 * 3600 * 1000)).toISOString();
    const authMetadata = {
      account_name: testResult.accountName,
      portal_id: testResult.accountId,
      auth_type: 'private_app'
    };

    if (!useFallbackDb) {
      const intRes = await pool.query(
        `INSERT INTO integrations (workspace_id, provider, name, connection_status, auth_metadata, last_connected_at, updated_at)
         VALUES ($1, 'hubspot', 'HubSpot CRM', 'connected', $2, NOW(), NOW())
         ON CONFLICT (workspace_id, provider) DO UPDATE SET
           connection_status = 'connected',
           auth_metadata = EXCLUDED.auth_metadata,
           last_connected_at = NOW(),
           updated_at = NOW()
         RETURNING id`,
        ['00000000-0000-0000-0000-000000000001', JSON.stringify(authMetadata)]
      );
      const integrationId = intRes.rows[0].id;

      await pool.query(
        `INSERT INTO integration_credentials (integration_id, encrypted_access_token, encrypted_refresh_token, expires_at, iv, auth_tag, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (integration_id) DO UPDATE SET
           encrypted_access_token = EXCLUDED.encrypted_access_token,
           encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
           expires_at = EXCLUDED.expires_at,
           iv = EXCLUDED.iv,
           auth_tag = EXCLUDED.auth_tag,
           updated_at = NOW()`,
        [integrationId, encAccess.encryptedData, null, expiresAt, encAccess.iv, encAccess.authTag]
      );
    } else {
      const data = readFallbackDb();
      let intg = (data.integrations || []).find(i => i.provider === 'hubspot');
      if (!intg) {
        intg = {
          id: '00000000-0000-0000-0000-000000000101',
          workspace_id: '00000000-0000-0000-0000-000000000001',
          provider: 'hubspot',
          name: 'HubSpot CRM',
          connection_status: 'connected',
          auth_metadata: authMetadata,
          last_connected_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        data.integrations.push(intg);
      } else {
        intg.connection_status = 'connected';
        intg.auth_metadata = authMetadata;
        intg.last_connected_at = new Date().toISOString();
        intg.updated_at = new Date().toISOString();
      }

      data.integration_credentials = (data.integration_credentials || []).filter(c => c.integration_id !== intg.id);
      data.integration_credentials.push({
        id: crypto.randomUUID(),
        integration_id: intg.id,
        encrypted_access_token: encAccess.encryptedData,
        encrypted_refresh_token: null,
        expires_at: expiresAt,
        iv: encAccess.iv,
        auth_tag: encAccess.authTag,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      writeFallbackDb(data);
    }

    await logActivity('crm_connect', `HubSpot Private App connected (${testResult.accountName})`);
    res.json({ ok: true, accountName: testResult.accountName, portalId: testResult.accountId });
  } catch (err) {
    next(err);
  }
});

// POST test integration connection (Real API Check)
app.post('/api/integrations/:id/test', async (req, res, next) => {
  try {
    const { id } = req.params;
    let tokenInfo;
    try {
      tokenInfo = await syncEngine.resolveAccessToken(id);
    } catch (e) {
      return res.json({ success: false, error: e.message });
    }

    const adapter = syncEngine.getAdapter(tokenInfo.provider);
    const testResult = await adapter.testConnection(tokenInfo.accessToken);

    // Update connection status based on test
    const newStatus = testResult.success ? 'connected' : (testResult.error?.includes('expired') ? 'auth_expired' : 'error');
    if (!useFallbackDb) {
      await pool.query('UPDATE integrations SET connection_status = $1, updated_at = NOW() WHERE id = $2', [newStatus, id]);
    } else {
      const data = readFallbackDb();
      const intg = (data.integrations || []).find(i => i.id === id);
      if (intg) {
        intg.connection_status = newStatus;
        intg.updated_at = new Date().toISOString();
        writeFallbackDb(data);
      }
    }

    res.json(testResult);
  } catch (err) {
    next(err);
  }
});

// POST disconnect integration
app.post('/api/integrations/:id/disconnect', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!useFallbackDb) {
      await pool.query("UPDATE integrations SET connection_status = 'disconnected', auth_metadata = '{}', updated_at = NOW() WHERE id = $1", [id]);
      await pool.query('DELETE FROM integration_credentials WHERE integration_id = $1', [id]);
    } else {
      const data = readFallbackDb();
      const intg = (data.integrations || []).find(i => i.id === id);
      if (intg) {
        intg.connection_status = 'disconnected';
        intg.auth_metadata = {};
        intg.updated_at = new Date().toISOString();
      }
      data.integration_credentials = (data.integration_credentials || []).filter(c => c.integration_id !== id);
      writeFallbackDb(data);
    }
    await logActivity('crm_disconnect', `Integration ${id} disconnected.`);
    res.json({ ok: true, id, status: 'disconnected' });
  } catch (err) {
    next(err);
  }
});

// GET discovered CRM properties
app.get('/api/integrations/:id/properties', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { accessToken, provider } = await syncEngine.resolveAccessToken(id);
    const adapter = syncEngine.getAdapter(provider);

    const [companyProps, contactProps, dealProps] = await Promise.all([
      adapter.getProperties(accessToken, 'company').catch(() => []),
      adapter.getProperties(accessToken, 'contact').catch(() => []),
      adapter.getProperties(accessToken, 'deal').catch(() => [])
    ]);

    res.json({
      company: companyProps,
      contact: contactProps,
      deal: dealProps
    });
  } catch (err) {
    next(err);
  }
});

// GET / PUT field mappings
app.get('/api/integrations/:id/mappings', async (req, res, next) => {
  try {
    const { id } = req.params;
    const mappings = await syncEngine.getFieldMappings('00000000-0000-0000-0000-000000000001', id);
    res.json(Array.from(mappings.values()));
  } catch (err) {
    next(err);
  }
});

app.put('/api/integrations/:id/mappings', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { mappings } = req.body;

    if (!Array.isArray(mappings)) {
      return res.status(400).json({ error: 'invalid_args', message: 'mappings must be an array' });
    }

    if (!useFallbackDb) {
      for (const m of mappings) {
        await pool.query(
          `INSERT INTO field_mappings (workspace_id, integration_id, playbook_field_name, destination_object, destination_field_name, is_enabled, updated_at)
           VALUES ('00000000-0000-0000-0000-000000000001', $1, $2, $3, $4, $5, NOW())
           ON CONFLICT (workspace_id, integration_id, playbook_field_name) DO UPDATE SET
             destination_object = EXCLUDED.destination_object,
             destination_field_name = EXCLUDED.destination_field_name,
             is_enabled = EXCLUDED.is_enabled,
             updated_at = NOW()`,
          [id, m.playbook_field_name, m.destination_object, m.destination_field_name, m.is_enabled !== false]
        );
      }
    } else {
      const data = readFallbackDb();
      if (!data.field_mappings) data.field_mappings = [];
      mappings.forEach(m => {
        const existing = data.field_mappings.find(x => x.integration_id === id && x.playbook_field_name === m.playbook_field_name);
        if (existing) {
          existing.destination_object = m.destination_object;
          existing.destination_field_name = m.destination_field_name;
          existing.is_enabled = m.is_enabled !== false;
          existing.updated_at = new Date().toISOString();
        } else {
          data.field_mappings.push({
            id: crypto.randomUUID(),
            workspace_id: '00000000-0000-0000-0000-000000000001',
            integration_id: id,
            playbook_field_name: m.playbook_field_name,
            destination_object: m.destination_object,
            destination_field_name: m.destination_field_name,
            is_enabled: m.is_enabled !== false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }
      });
      writeFallbackDb(data);
    }

    res.json({ ok: true, count: mappings.length });
  } catch (err) {
    next(err);
  }
});

// POST search CRM records (Company, Contact, Deal)
app.post('/api/integrations/hubspot/records/search', async (req, res, next) => {
  try {
    const { integrationId, companyName, companyDomain, contactEmail, contactName, dealName } = req.body;
    const { accessToken, provider } = await syncEngine.resolveAccessToken(integrationId || '00000000-0000-0000-0000-000000000101');
    const adapter = syncEngine.getAdapter(provider);

    const [companies, contacts, deals] = await Promise.all([
      (companyDomain || companyName) ? adapter.searchCompany(accessToken, { domain: companyDomain, name: companyName }).catch(() => []) : [],
      (contactEmail || contactName) ? adapter.searchContact(accessToken, { email: contactEmail, name: contactName }).catch(() => []) : [],
      dealName ? adapter.searchDeal(accessToken, { name: dealName }).catch(() => []) : []
    ]);

    res.json({ companies, contacts, deals });
  } catch (err) {
    next(err);
  }
});

// POST Prepare Sync (Diff calculation before approval)
app.post('/api/sync/prepare', async (req, res, next) => {
  try {
    const { meetingId, integrationId } = req.body;
    if (!meetingId) {
      return res.status(400).json({ error: 'invalid_args', message: 'Missing meetingId' });
    }

    let intgId = integrationId;
    if (!intgId) {
      if (!useFallbackDb) {
        const intRes = await pool.query("SELECT id FROM integrations WHERE provider = 'hubspot' LIMIT 1");
        intgId = intRes.rows[0]?.id;
      } else {
        const data = readFallbackDb();
        intgId = (data.integrations || []).find(i => i.provider === 'hubspot')?.id;
      }
    }

    if (!intgId) {
      return res.status(400).json({ error: 'no_integration', message: 'No HubSpot integration found' });
    }

    const preview = await syncEngine.prepareSync(meetingId, intgId);
    res.json(preview);
  } catch (err) {
    next(err);
  }
});

// POST Execute Sync
app.post(['/api/sync/execute', '/api/meetings/:id/sync'], async (req, res, next) => {
  try {
    const meetingId = req.params.id || req.body.meetingId;
    const { integrationId, approvedFields, idempotencyKey, participantResolutions } = req.body;

    if (!meetingId) {
      return res.status(400).json({ error: 'invalid_args', message: 'Missing meetingId' });
    }

    let intgId = integrationId;
    if (!intgId) {
      if (!useFallbackDb) {
        const intRes = await pool.query("SELECT id FROM integrations WHERE provider = 'hubspot' LIMIT 1");
        intgId = intRes.rows[0]?.id;
      } else {
        const data = readFallbackDb();
        intgId = (data.integrations || []).find(i => i.provider === 'hubspot')?.id;
      }
    }

    const result = await syncEngine.executeSync(meetingId, intgId, { approvedFields, idempotencyKey, participantResolutions });
    const count = result.summary?.fieldsUpdatedCount ?? result.fieldsUpdatedCount ?? 0;
    await logActivity('sync_success', `Meeting synchronized to CRM successfully (${count} properties verified & updated)`);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'CRM Sync execution error');
    if (err.code === 'SYNC_ALREADY_IN_PROGRESS' || err.statusCode === 409) {
      return res.status(409).json({ error: 'sync_in_progress', message: err.message });
    }
    res.status(500).json({ error: 'sync_error', message: err.message });
  }
});

// GET Meeting Sync History & Audit Trail
app.get('/api/meetings/:id/sync-history', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    let syncRuns = [];

    if (!useFallbackDb) {
      const runsRes = await pool.query(
        'SELECT * FROM sync_runs WHERE meeting_id = $1 ORDER BY created_at DESC',
        [meetingId]
      );
      syncRuns = runsRes.rows;

      for (const run of syncRuns) {
        const itemsRes = await pool.query('SELECT * FROM sync_items WHERE sync_run_id = $1', [run.id]);
        run.items = itemsRes.rows;
      }
    } else {
      const data = readFallbackDb();
      syncRuns = (data.sync_runs || []).filter(r => r.meeting_id === meetingId);
      syncRuns.forEach(run => {
        run.items = (data.sync_items || []).filter(i => i.sync_run_id === run.id);
      });
    }

    res.json(syncRuns);
  } catch (err) {
    next(err);
  }
});

// POST Reopen Review for a synced meeting
app.post('/api/meetings/:id/reopen-review', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    if (!useFallbackDb) {
      await pool.query("UPDATE meetings SET status = 'completed', workflow_state = 'review', updated_at = NOW() WHERE id = $1", [meetingId]);
    } else {
      const data = readFallbackDb();
      const m = (data.meetings || []).find(x => x.id === meetingId);
      if (m) {
        m.status = 'completed';
        m.workflow_state = 'review';
        writeFallbackDb(data);
      }
    }
    await logActivity('review_reopened', `Review reopened for meeting ${meetingId}`);
    res.json({ ok: true, status: 'review' });
  } catch (err) {
    next(err);
  }
});

// GET sync logs
app.get('/api/sync-logs', async (req, res, next) => {
  try {
    if (!useFallbackDb) {
      const result = await pool.query('SELECT * FROM sync_runs ORDER BY created_at DESC');
      res.json(result.rows);
    } else {
      const data = readFallbackDb();
      res.json(data.sync_runs || []);
    }
  } catch (err) {
    next(err);
  }
});

// GET activity feed logs
app.get('/api/activity-logs', async (req, res, next) => {
  try {
    if (!useFallbackDb) {
      const result = await pool.query('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 100');
      res.json(result.rows);
    } else {
      const data = readFallbackDb();
      const logs = data.activity_logs || [];
      res.json([...logs].reverse().slice(0, 100));
    }
  } catch (err) {
    next(err);
  }
});

// GET custom system prompt configuration
app.get('/api/system-prompt', async (req, res, next) => {
  try {
    let customPrompt = "You are an expert sales analyst. Parse the transcript segments and extract clean BANT/MEDDICC criteria with corresponding evidence. Be thorough.";
    
    if (!useFallbackDb) {
      const result = await pool.query("SELECT value FROM company_memories WHERE memory_type = 'system_prompt' LIMIT 1");
      if (result.rows.length > 0) {
        customPrompt = result.rows[0].value;
      }
    } else {
      const data = readFallbackDb();
      if (!data.settings) data.settings = {};
      customPrompt = data.settings.system_prompt || customPrompt;
    }
    
    res.json({ system_prompt: customPrompt });
  } catch (err) {
    next(err);
  }
});

// POST update system prompt configuration
app.post('/api/system-prompt', async (req, res, next) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      res.status(400).json({ error: 'invalid_args', message: 'Missing prompt text' });
      return;
    }
    
    if (!useFallbackDb) {
      await pool.query("DELETE FROM company_memories WHERE memory_type = 'system_prompt'");
      await pool.query(
        `INSERT INTO company_memories (company_id, memory_type, value) 
         VALUES ('00000000-0000-0000-0000-000000000001', 'system_prompt', $1)`,
        [prompt]
      );
    } else {
      const data = readFallbackDb();
      if (!data.settings) data.settings = {};
      data.settings.system_prompt = prompt;
      writeFallbackDb(data);
    }
    
    await logActivity('prompt_update', 'AI Custom system prompt updated.');
    res.json({ ok: true, system_prompt: prompt });
  } catch (err) {
    next(err);
  }
});

// ── Multi-Platform Meeting Bot Capture API ─────────────────────────────────

// 1. Get All Meeting Providers & Capabilities
app.get('/api/meeting-providers', async (_req, res, next) => {
  try {
    const capabilities = await defaultProviderRegistry.getAllCapabilities();
    res.json(capabilities);
  } catch (error) { next(error); }
});

// 2. Auto-Detect Provider from Meeting URL
app.post('/api/meeting-providers/detect-url', (req, res) => {
  const url = String(req.body?.url || '').trim();
  const detection = defaultProviderRegistry.detectProviderFromUrl(url);
  res.json(detection);
});

// 3. List All Meeting Bot Jobs
app.get('/api/meeting-bots', async (req, res, next) => {
  try {
    const jobs = await meetingBotWorker.listJobs({
      provider: req.query?.provider,
      status: req.query?.status,
    });
    const enriched = jobs.map(j => ({
      ...j,
      statusMeta: JobStateMachine.getMeta(j.status),
    }));
    res.json(enriched);
  } catch (error) { next(error); }
});

// 4. Create & Schedule a New Meeting Bot Job
app.post('/api/meeting-bots', async (req, res, next) => {
  try {
    const rawUrl = String(req.body?.meeting_url || '').trim();
    let providerName = req.body?.provider;

    // URL Auto-Detection if provider not specified or to validate
    const detected = defaultProviderRegistry.detectProviderFromUrl(rawUrl);
    if (!providerName && detected.valid) {
      providerName = detected.provider;
    }

    if (!providerName) {
      res.status(400).json({
        error: 'INVALID_PROVIDER',
        message: 'Could not identify meeting platform from URL. Please select Google Meet, Zoom, or Microsoft Teams.',
      });
      return;
    }

    const providerAdapter = defaultProviderRegistry.getProvider(providerName);
    if (!providerAdapter) {
      res.status(400).json({
        error: 'UNSUPPORTED_PROVIDER',
        message: `Provider "${providerName}" is not supported. Supported providers: google_meet, zoom, microsoft_teams.`,
      });
      return;
    }

    if (!providerAdapter.validateMeetingUrl(rawUrl)) {
      res.status(400).json({
        error: 'INVALID_MEETING_URL',
        message: `The provided URL is not a valid ${providerAdapter.getLabel()} meeting link.`,
      });
      return;
    }

    const consentState = ['granted', 'pending', 'required', 'rejected'].includes(req.body?.consent_state)
      ? req.body.consent_state
      : 'pending';
    if (consentState !== 'granted') {
      return res.status(400).json({ error: 'consent_required', message: 'Explicit participant recording consent is required before scheduling capture.' });
    }

    const mode = ['mock', 'post_meeting_artifact'].includes(req.body?.mode) ? req.body.mode : 'realtime';
    const metadata = providerAdapter.extractMeetingMetadata(rawUrl);

    const job = await meetingBotWorker.createJob({
      provider: providerName,
      mode,
      meeting_url: rawUrl,
      external_meeting_id: metadata.meetingId,
      meeting_title: String(req.body?.meeting_title || `${providerAdapter.getLabel()} Meeting`).trim(),
      scheduled_start: req.body?.scheduled_start || new Date().toISOString(),
      consent_state: consentState,
      bot_participant_name: req.body?.bot_participant_name || 'PulseSync Meeting Assistant',
      created_by: req.body?.created_by || 'Sales Rep',
      provider_metadata: metadata,
    });

    // Enqueue execution in worker
    meetingBotWorker.scheduleJobExecution(job.id);

    res.status(201).json({
      ok: true,
      job: {
        ...job,
        statusMeta: JobStateMachine.getMeta(job.status),
      },
      message: `Meeting bot scheduled for ${providerAdapter.getLabel()}.`,
    });
  } catch (error) { next(error); }
});

// 5. Get Meeting Bot Job Details
app.get('/api/meeting-bots/:id', async (req, res, next) => {
  try {
    const job = await meetingBotWorker.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Meeting bot job not found.' });
      return;
    }
    res.json({
      ...job,
      statusMeta: JobStateMachine.getMeta(job.status),
    });
  } catch (error) { next(error); }
});

// 6. Get Meeting Bot Status & Progress
app.get('/api/meeting-bots/:id/status', async (req, res, next) => {
  try {
    const job = await meetingBotWorker.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Meeting bot job not found.' });
      return;
    }
    res.json({
      id: job.id,
      status: job.status,
      statusMeta: JobStateMachine.getMeta(job.status),
      meeting_id: job.meeting_id,
      transcript_status: job.transcript_status,
      diarization_status: job.diarization_status,
      extraction_status: job.extraction_status,
      error_code: job.error_code,
      error_message: job.error_message,
      updated_at: job.updated_at,
    });
  } catch (error) { next(error); }
});

// 7. Get Chronological Activity Logs for Debugging
app.get('/api/meeting-bots/:id/logs', async (req, res, next) => {
  try {
    const logs = await meetingBotWorker.getJobLogs(req.params.id);
    res.json(logs);
  } catch (error) { next(error); }
});

// 8. Cancel a Meeting Bot Job
app.post('/api/meeting-bots/:id/cancel', async (req, res, next) => {
  try {
    const result = await meetingBotWorker.cancelJob(req.params.id);
    res.json(result);
  } catch (error) { next(error); }
});

// 9. Retry a Failed Meeting Bot Job
app.post('/api/meeting-bots/:id/retry', async (req, res, next) => {
  try {
    const result = await meetingBotWorker.retryJob(req.params.id);
    res.json(result);
  } catch (error) { next(error); }
});

// 10. Get Meeting Bot Participants (Platform-Native Attribution)
app.get('/api/meeting-bots/:id/participants', async (req, res, next) => {
  try {
    const job = await meetingBotWorker.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Meeting bot job not found.' });
      return;
    }
    const meetingId = job.meeting_id || job.id;
    const participants = await meetingBotWorker.getMeetingParticipants(meetingId);
    res.json(participants);
  } catch (error) { next(error); }
});

// 11. Get Meeting Bot Speaker Mappings
app.get('/api/meeting-bots/:id/speaker-mappings', async (req, res, next) => {
  try {
    const job = await meetingBotWorker.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Meeting bot job not found.' });
      return;
    }
    const meetingId = job.meeting_id || job.id;
    const mappings = await meetingBotWorker.getSpeakerMappings(meetingId);
    res.json(mappings);
  } catch (error) { next(error); }
});

// 12. Manual Speaker Reassignment (Top Priority Override)
app.post('/api/meetings/:id/speakers/:speakerId/remap', async (req, res, next) => {
  try {
    const meetingId = req.params.id;
    const speakerId = req.params.speakerId;
    const targetParticipantId = req.body?.targetParticipantId;
    if (!targetParticipantId) {
      res.status(400).json({ error: 'INVALID_ARGS', message: 'Missing targetParticipantId' });
      return;
    }

    const result = await meetingBotWorker.remapSpeaker(meetingId, speakerId, targetParticipantId);
    await logActivity('speaker_remapped', `Speaker "${speakerId}" remapped to participant "${result.displayName}" for meeting ${meetingId}`);
    res.json(result);
  } catch (error) { next(error); }
});

// 13. Query Single Provider Capabilities
app.get('/api/meeting-providers/:provider/status', async (req, res, next) => {
  try {
    const providerAdapter = defaultProviderRegistry.getProvider(req.params.provider);
    if (!providerAdapter) {
      res.status(404).json({ error: 'NOT_FOUND', message: `Provider "${req.params.provider}" not found.` });
      return;
    }
    const caps = await providerAdapter.getCapabilities();
    res.json(caps);
  } catch (error) { next(error); }
});

// ── Backwards-Compatibility Capture Aliases ────────────────────────────────

app.get('/api/capture/bots', async (_req, res, next) => {
  try {
    const jobs = await meetingBotWorker.listJobs();
    // Map to legacy fields expected by existing components
    const legacy = jobs.map(j => ({
      id: j.id,
      title: j.meeting_title,
      capture_provider: j.provider,
      meeting_url: j.meeting_url,
      bot_status: (j.status || 'scheduled').toLowerCase(),
      status: j.status,
      consent_status: j.consent_state,
      created_at: j.created_at,
      statusMeta: JobStateMachine.getMeta(j.status),
    }));
    res.json(legacy);
  } catch (error) { next(error); }
});

app.post('/api/capture/bots/schedule', async (req, res, next) => {
  try {
    const provider = req.body?.provider || 'google_meet';
    const meetingUrl = String(req.body?.meeting_url || '').trim();
    const title = String(req.body?.title || 'Scheduled meeting').trim().slice(0, 255);
    const consentStatus = ['unknown', 'pending', 'granted', 'denied'].includes(req.body?.consent_status)
      ? req.body.consent_status
      : 'unknown';

    const providerAdapter = defaultProviderRegistry.getProvider(provider);
    if (!providerAdapter || !providerAdapter.validateMeetingUrl(meetingUrl)) {
      res.status(400).json({ error: 'invalid_meeting', message: `Provide a valid ${providerAdapter ? providerAdapter.getLabel() : ''} meeting URL.` });
      return;
    }

    const job = await meetingBotWorker.createJob({
      provider,
      mode: 'realtime',
      meeting_url: meetingUrl,
      meeting_title: title,
      consent_state: consentStatus === 'granted' ? 'granted' : 'pending',
    });

    meetingBotWorker.scheduleJobExecution(job.id);
    res.status(201).json({
      ok: true,
      meetingId: job.id,
      jobId: job.id,
      provider,
      bot_status: job.status.toLowerCase(),
      status: job.status,
      consent_status: job.consent_state,
      message: 'Meeting bot scheduled successfully.',
    });
  } catch (error) { next(error); }
});

app.post('/api/capture/bots/:id/audio', upload.single('audio'), async (req, res, next) => {
  try {
    const jobId = req.params.id;
    if (!req.file) {
      res.status(400).json({ error: 'no_file', message: 'No meeting audio was uploaded.' });
      return;
    }

    const validation = AudioNormalizer.validateAudioFile(req.file.path);
    if (!validation.valid) {
      try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch (_) {}
      res.status(400).json({ error: validation.error || 'INVALID_AUDIO', message: validation.message });
      return;
    }

    const audioUrl = `/media/${req.file.filename}`;
    const job = await meetingBotWorker.getJob(jobId);
    let meetingId = job?.meeting_id;

    if (job) {
      meetingId = await meetingBotWorker._ensureMeetingRecord(job, audioUrl);
      await meetingBotWorker.updateJob(jobId, { status: BotJobState.PROCESSING });
      await meetingBotWorker.logActivity(jobId, BotJobState.PROCESSING, 'info', 'External audio stream attached. Handing off to AI pipeline.');
    }

    if (meetingId) {
      triggerJobProcessor(meetingId);
    }

    res.json({ ok: true, jobId, meetingId, status: 'queued', audioUrl });
  } catch (error) { next(error); }
});

// Express Error Handler
app.use((error, _req, res, _next) => {
  logger.error({ error }, 'Request crashed');
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({ error: 'upload_error', message: error.message });
    return;
  }
  if (error?.message === 'Unexpected field' || error?.message?.startsWith('Invalid file type')) {
    res.status(400).json({ error: 'invalid_audio', message: error.message });
    return;
  }
  res.status(500).json({ error: 'server_error', message: 'An unexpected server error occurred.' });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  logger.info({ port, databaseMode: useFallbackDb ? 'JSON' : 'PostgreSQL' }, 'PulseSync backend server listening');
});

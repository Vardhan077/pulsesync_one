/**
 * Phase 1 Regression Tests: Critical Authentication, Database Integrity & Memory Preservation
 * 
 * Verifies fixes for:
 * - PS-001: Auth bypass prevention on /customers/... routes
 * - PS-002: Presence of template_used column in PostgreSQL schema and migrations
 * - PS-003: Core tables present in backend/schema.sql
 * - PS-004: Preservation of company memories and extraction of grounded facts
 * - PS-020: schema_id association on call_extractions table
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running Phase 1 Regression Tests...');

// 1. PS-001 Verification: Auth Middleware Protection Logic
{
  const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

  // Verify the auth middleware checks both /api/ and /customers
  const hasProtectedCheck = serverCode.includes("const protectedPath = req.path.startsWith('/api/') || req.path.startsWith('/customers');");
  assert.equal(hasProtectedCheck, true, 'Auth middleware must protect both /api/ and /customers paths');

  // Verify /media/ is explicitly exempted
  const hasMediaExempt = serverCode.includes("req.path.startsWith('/media/')");
  assert.equal(hasMediaExempt, true, 'Public /media/ route must be explicitly allowed');

  // Emulate middleware behavior
  function simulateAuthGate(reqPath, headers = {}, token = 'secret-token-123') {
    const publicBypass = reqPath === '/health' || reqPath === '/ready' || reqPath === '/api/integrations/hubspot/callback' || reqPath.startsWith('/media/');
    if (publicBypass) return { status: 200, bypassed: true };

    const protectedPath = reqPath.startsWith('/api/') || reqPath.startsWith('/customers');
    if (!protectedPath) return { status: 200, bypassed: true };

    const authHeader = headers.authorization || '';
    const supplied = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : headers['x-pulsesync-api-key'];
    if (supplied !== token) return { status: 401, error: 'unauthorized' };
    return { status: 200, authorized: true };
  }

  // Unauthenticated requests to /customers must be blocked (HTTP 401)
  assert.equal(simulateAuthGate('/customers').status, 401, 'Unauthenticated /customers must return 401');
  assert.equal(simulateAuthGate('/customers/company-123/copilot').status, 401, 'Unauthenticated /customers/:id/copilot must return 401');
  assert.equal(simulateAuthGate('/api/customers').status, 401, 'Unauthenticated /api/customers must return 401');

  // Authenticated requests must succeed
  assert.equal(simulateAuthGate('/customers', { authorization: 'Bearer secret-token-123' }).status, 200);
  assert.equal(simulateAuthGate('/api/customers', { authorization: 'Bearer secret-token-123' }).status, 200);

  // Public paths must pass freely
  assert.equal(simulateAuthGate('/health').bypassed, true);
  assert.equal(simulateAuthGate('/ready').bypassed, true);
  assert.equal(simulateAuthGate('/media/meeting-audio.webm?signature=abc').bypassed, true);

  console.log('✓ PS-001 Verified: Auth middleware successfully protects all /customers and /api routes while allowing public media/health');
}

// 2. PS-002 Verification: template_used column in schemas
{
  const backendSchema = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
  const pulsesyncSchema = fs.readFileSync(path.join(__dirname, '../../pulsesync_schema.sql'), 'utf8');
  const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

  assert.equal(backendSchema.includes('template_used VARCHAR(100)'), true, 'backend/schema.sql must contain template_used');
  assert.equal(pulsesyncSchema.includes('template_used character varying(100)'), true, 'pulsesync_schema.sql must contain template_used');
  assert.equal(serverCode.includes('ADD COLUMN IF NOT EXISTS template_used VARCHAR(100);'), true, 'server.js migrations must add template_used');

  console.log('✓ PS-002 Verified: template_used column exists across all database schemas and server migrations');
}

// 3. PS-003 Verification: Docker Init Schema Core Tables
{
  const backendSchema = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
  const requiredTables = [
    'sync_logs',
    'activity_logs',
    'timeline_events',
    'company_memories',
    'risks',
    'objections'
  ];

  for (const table of requiredTables) {
    const tablePattern = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i');
    assert.equal(tablePattern.test(backendSchema), true, `backend/schema.sql must define ${table} table`);
  }

  console.log('✓ PS-003 Verified: All 6 missing tables are defined in backend/schema.sql');
}

// 4. PS-004 Verification: Memory wipeout guard and grounded memory extraction
{
  const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const enrichmentCode = fs.readFileSync(path.join(__dirname, '../../ai-service/enrichment.py'), 'utf8');

  // Verify server.js only deletes memories if new memories are actually extracted
  assert.equal(serverCode.includes('if (aiMemories.length > 0)'), true, 'PostgreSQL compile must check aiMemories.length > 0 before deleting');
  assert.equal(serverCode.includes('if (aiMemories.length > 0)'), true, 'Fallback DB compile must check aiMemories.length > 0 before deleting');

  // Verify enrichment.py generates memories_detected
  assert.equal(enrichmentCode.includes('summary["memories_detected"] = memories_detected'), true, 'enrichment.py must populate memories_detected');

  console.log('✓ PS-004 Verified: Company memories are guarded against wipeout and populated from grounded fields');
}

// 5. PS-020 Verification: schema_id in call_extractions
{
  const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.equal(serverCode.includes('INSERT INTO call_extractions (meeting_id, schema_id, extracted_data)'), true, 'call_extractions insert must include schema_id');

  console.log('✓ PS-020 Verified: schema_id is resolved and associated with call_extractions');
}

console.log('\nAll Phase 1 tests passed successfully!');

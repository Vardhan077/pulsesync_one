/**
 * playbook_dynamic_lifecycle_test.js
 * 
 * Verifies Acceptance Criteria Tests A through G from the specification:
 * - Test A: Create custom playbook with >= 2 fields and unique guidelines, verify DB persistence
 * - Test B: Select custom playbook for extraction, verify exact DB record resolution
 * - Test C: Verify guideline propagation to AI extraction context (distinctive instructions)
 * - Test D: Update guideline, re-extract, verify updated guideline propagation
 * - Test E: Switch playbooks, verify extraction uses second playbook without retaining prior fields
 * - Test F: Reload and persistence across reads
 * - Test G: Isolation and invalid selection (reject invalid playbook IDs, zero silent fallback)
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_PORT = 3299;
const AI_MOCK_PORT = 8091;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const AI_MOCK_URL = `http://localhost:${AI_MOCK_PORT}`;
const TEST_API_TOKEN = 'pulsesync-test-api-token-0123456789-ABCD';
const DB_URL = process.env.DATABASE_URL || 'postgresql://pulsesync:password777@localhost:5433/pulsesync';

const pool = new Pool({ connectionString: DB_URL });

async function apiFetch(url, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${TEST_API_TOKEN}`);
  headers.set('Content-Type', 'application/json');
  return fetch(url, { ...init, headers });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Track AI service requests received during testing
const aiRequestsReceived = [];

function startMockAiService() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      aiRequestsReceived.push({
        url: req.url,
        method: req.method,
        body: parsed
      });

      // Return valid enrichment response
      const fields = (parsed.profile?.fields || parsed.schema_fields || []).map(f => ({
        field_id: f.id || f.name,
        name: f.name || f.label,
        value: `Extracted ${f.name || f.label}`,
        status: 'explicit',
        confidence: 0.95,
        quote: 'Supported by transcript evidence'
      }));

      const responsePayload = {
        summary: {
          overview: 'Test meeting grounded overview.',
          summary_sections: [
            { section_id: 'executive_summary', name: 'Executive Summary', content: 'Test executive summary.' }
          ],
          risks: [],
          objections: [],
          action_items: []
        },
        fields,
        template_fields: fields,
        deal_signals: {
          budget: '$50,000'
        },
        risks: [],
        objections: [],
        action_items: [],
        call_type: 'discovery',
        call_type_confidence: 0.95
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responsePayload));
    });
  });

  return new Promise(resolve => {
    server.listen(AI_MOCK_PORT, () => resolve(server));
  });
}

async function waitForServer() {
  const maxRetries = 40;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return true;
    } catch {
      await sleep(250);
    }
  }
  throw new Error('Server did not start within timeout');
}

async function run() {
  console.log('\n================================================================');
  console.log('   PulseSync Dynamic Playbook -> Database -> AI Extraction E2E  ');
  console.log('================================================================\n');

  let mockAiServer;
  let serverProcess;

  const createdProfileIds = [];
  const createdMeetingIds = [];

  try {
    // 1. Start Mock AI Service
    mockAiServer = await startMockAiService();
    console.log(`✓ Mock AI Service listening on port ${AI_MOCK_PORT}`);

    // 2. Start Backend Server
    const serverEnv = {
      ...process.env,
      PORT: String(TEST_PORT),
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      DATABASE_URL: DB_URL,
      ALLOW_JSON_FALLBACK: 'false',
      PULSESYNC_API_TOKEN: TEST_API_TOKEN,
      AI_SERVICE_URL: `${AI_MOCK_URL}/generate-ai`,
      AI_PROCESS_URL: `${AI_MOCK_URL}/process`,
      AI_GENERATE_AI_URL: `${AI_MOCK_URL}/generate-ai`
    };

    serverProcess = spawn('node', ['backend/server.js'], {
      cwd: path.resolve(__dirname, '../..'),
      env: serverEnv,
      stdio: 'pipe'
    });

    await waitForServer();
    console.log(`✓ PulseSync backend server active on port ${TEST_PORT}\n`);

    // Setup: Create a test meeting with transcript segments in Postgres
    const testMeetingId = '11111111-2222-3333-4444-555555555555';
    createdMeetingIds.push(testMeetingId);

    await pool.query(
      `INSERT INTO meetings (id, title, status, workflow_state, created_at, updated_at)
       VALUES ($1, 'Enterprise Discovery Session', 'completed', 'review', NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET workflow_state = 'review'`,
      [testMeetingId]
    );

    await pool.query(
      `DELETE FROM transcript_segments WHERE meeting_id = $1`,
      [testMeetingId]
    );

    await pool.query(
      `INSERT INTO transcript_segments (meeting_id, speaker_name, text, start_time, end_time, confidence)
       VALUES 
       ($1, 'Alice Corp', 'Our primary economic buyer is Sarah Jenkins, VP of Engineering.', 0.0, 5.0, 0.95),
       ($1, 'Bob Vendor', 'Understood. What is the approved capital allocation?', 5.0, 10.0, 0.95),
       ($1, 'Alice Corp', 'The allocated budget is two hundred thousand dollars for year one.', 10.0, 15.0, 0.95)`,
      [testMeetingId]
    );

    // ══════════════════════════════════════════════════════════════════════════
    // TEST A: Create a Custom Playbook with >= 2 fields and unique guidelines
    // ══════════════════════════════════════════════════════════════════════════
    console.log('• TEST A: Create custom playbook and verify database persistence...');
    const customPlaybookId = `test_custom_playbook_${Date.now()}`;
    createdProfileIds.push(customPlaybookId);

    const testAGuideline = 'Mark this field as identified only when the transcript explicitly establishes who controls or approves the budget. Do not infer the economic buyer from job title alone.';
    const testABudgetGuideline = 'Extract the exact authorized project budget. Return NOT_IDENTIFIED unless explicit dollar figures or currency terms are spoken.';

    const createPayload = {
      id: customPlaybookId,
      name: 'Custom Enterprise Evaluation Playbook',
      description: 'Custom playbook for testing dynamic database configuration to AI extraction propagation.',
      summary_sections: [
        { id: 'executive_summary', name: 'Executive Summary', description: 'Brief conversation outcome summary.', max_words: 100, enabled: true },
        { id: 'commercial_readiness', name: 'Commercial Readiness', description: 'Budget signoff and authority evaluation.', max_words: 80, enabled: true }
      ],
      fields: [
        {
          id: 'economic_buyer',
          name: 'Economic Buyer',
          type: 'person',
          description: 'The executive holding budget signoff authority.',
          prompt_hint: testAGuideline,
          ai_instruction: testAGuideline,
          semantic_contract: 'Explicit financial authority over purchase.',
          evidence_required: true,
          options: []
        },
        {
          id: 'authorized_budget',
          name: 'Authorized Budget',
          type: 'currency',
          description: 'Explicit monetary commitment or budget envelope.',
          prompt_hint: testABudgetGuideline,
          ai_instruction: testABudgetGuideline,
          semantic_contract: 'Numeric or currency statement of budget.',
          evidence_required: true,
          options: []
        }
      ],
      is_active: false
    };

    const createRes = await apiFetch(`${BASE_URL}/api/extraction-profiles`, {
      method: 'POST',
      body: JSON.stringify(createPayload)
    });
    assert.equal(createRes.status, 201, `Expected HTTP 201 Created, got ${createRes.status}`);
    const createdData = await createRes.json();
    assert.equal(createdData.id, customPlaybookId);
    assert.equal(createdData.name, 'Custom Enterprise Evaluation Playbook');

    // Verify DB record in extraction_profiles table directly via SQL
    const dbCheck = await pool.query('SELECT * FROM extraction_profiles WHERE id = $1', [customPlaybookId]);
    assert.equal(dbCheck.rows.length, 1, 'Custom playbook must exist in public.extraction_profiles table');
    const dbFields = dbCheck.rows[0].fields;
    assert.equal(dbFields.length, 2, 'Must have persisted exactly 2 configured fields');
    
    const dbEbField = dbFields.find(f => f.id === 'economic_buyer');
    assert.ok(dbEbField, 'economic_buyer field must exist in database record');
    assert.equal(dbEbField.prompt_hint, testAGuideline, 'Field guideline must match in database');
    assert.equal(dbEbField.ai_instruction, testAGuideline, 'Field ai_instruction guideline must match in database');

    const dbBudgetField = dbFields.find(f => f.id === 'authorized_budget');
    assert.ok(dbBudgetField, 'authorized_budget field must exist in database record');
    assert.equal(dbBudgetField.prompt_hint, testABudgetGuideline, 'Budget guideline must match in database');

    // Verify GET /api/extraction-profiles/:id returns the saved record (page refresh simulation)
    const getRes = await apiFetch(`${BASE_URL}/api/extraction-profiles/${customPlaybookId}`);
    assert.equal(getRes.status, 200, 'GET /api/extraction-profiles/:id must return 200');
    const fetchedData = await getRes.json();
    assert.equal(fetchedData.id, customPlaybookId);
    assert.equal(fetchedData.fields[0].prompt_hint, testAGuideline);
    console.log('  ✓ Test A PASSED: Custom playbook created, persisted to database, and retrieved with full guidelines\n');

    // ══════════════════════════════════════════════════════════════════════════
    // TEST B & C: Select Custom Playbook & Verify Guideline Propagation to AI
    // ══════════════════════════════════════════════════════════════════════════
    console.log('• TEST B & C: Select custom playbook before extraction & verify guideline propagation...');
    aiRequestsReceived.length = 0; // Clear received AI requests

    const compileRes = await apiFetch(`${BASE_URL}/api/meetings/${testMeetingId}/compile`, {
      method: 'POST',
      body: JSON.stringify({
        templateId: customPlaybookId,
        call_type: 'discovery'
      })
    });
    assert.equal(compileRes.status, 200, `Expected compile HTTP 200, got ${compileRes.status}`);

    // Verify that the AI service received the exact database playbook configuration
    assert.equal(aiRequestsReceived.length, 1, 'AI service must have received exactly one request');
    const sentToAi = aiRequestsReceived[0].body;

    // 1. Playbook identity
    assert.equal(sentToAi.profile.id, customPlaybookId, 'AI payload profile.id must match selected custom playbook');
    assert.equal(sentToAi.template.id, customPlaybookId, 'AI payload template.id must match selected custom playbook');

    // 2. Fields count and names
    assert.equal(sentToAi.profile.fields.length, 2, 'AI profile fields must match database configured fields (exactly 2)');
    const sentEbField = sentToAi.profile.fields.find(f => f.id === 'economic_buyer');
    const sentBudgetField = sentToAi.profile.fields.find(f => f.id === 'authorized_budget');
    assert.ok(sentEbField, 'economic_buyer field must be present in profile sent to AI');
    assert.ok(sentBudgetField, 'authorized_budget field must be present in profile sent to AI');

    // 3. Exact field guidelines propagation
    assert.equal(sentEbField.prompt_hint, testAGuideline, 'AI engine must receive exact saved Economic Buyer guideline');
    assert.equal(sentEbField.ai_instruction, testAGuideline, 'AI engine must receive exact saved Economic Buyer ai_instruction');
    assert.equal(sentBudgetField.prompt_hint, testABudgetGuideline, 'AI engine must receive exact saved Budget guideline');

    // 4. Schema fields list propagation
    const sentSchemaEb = sentToAi.schema_fields.find(f => f.name === 'economic_buyer');
    assert.ok(sentSchemaEb, 'schema_fields must contain economic_buyer');
    assert.equal(sentSchemaEb.prompt_hint, testAGuideline, 'schema_fields must contain exact guideline');

    // 5. Verify call_extractions stored the profile snapshot in database
    const extDbCheck = await pool.query('SELECT * FROM call_extractions WHERE meeting_id = $1', [testMeetingId]);
    assert.equal(extDbCheck.rows.length, 1, 'call_extractions record must exist in DB');
    const savedExtProfile = extDbCheck.rows[0].extracted_data.profile;
    assert.equal(savedExtProfile.id, customPlaybookId, 'call_extractions must store exact custom playbook profile snapshot');
    assert.equal(savedExtProfile.fields[0].prompt_hint, testAGuideline, 'call_extractions snapshot must preserve guideline');

    // 6. Verify meeting template_used is updated in DB
    const meetingDbCheck = await pool.query('SELECT template_used FROM meetings WHERE id = $1', [testMeetingId]);
    assert.equal(meetingDbCheck.rows[0].template_used, customPlaybookId, 'meeting.template_used must match custom playbook ID');
    console.log('  ✓ Test B & C PASSED: Custom playbook resolved from DB and exact guidelines forwarded to AI engine\n');

    // ══════════════════════════════════════════════════════════════════════════
    // TEST D: Change the Guideline and Re-extract
    // ══════════════════════════════════════════════════════════════════════════
    console.log('• TEST D: Update guideline in database and verify extraction uses updated instruction...');
    const updatedEbGuideline = 'Return NOT_IDENTIFIED unless the transcript explicitly names the person responsible for budget approval and board signoff has occurred.';

    const updatedFields = [
      {
        id: 'economic_buyer',
        name: 'Economic Buyer',
        type: 'person',
        description: 'The executive holding budget signoff authority.',
        prompt_hint: updatedEbGuideline,
        ai_instruction: updatedEbGuideline,
        semantic_contract: 'Explicit financial authority over purchase.',
        evidence_required: true,
        options: []
      },
      {
        id: 'authorized_budget',
        name: 'Authorized Budget',
        type: 'currency',
        description: 'Explicit monetary commitment or budget envelope.',
        prompt_hint: testABudgetGuideline,
        ai_instruction: testABudgetGuideline,
        semantic_contract: 'Numeric or currency statement of budget.',
        evidence_required: true,
        options: []
      }
    ];

    const putRes = await apiFetch(`${BASE_URL}/api/extraction-profiles/${customPlaybookId}`, {
      method: 'PUT',
      body: JSON.stringify({
        fields: updatedFields
      })
    });
    assert.equal(putRes.status, 200, `Expected PUT HTTP 200, got ${putRes.status}`);

    // Verify DB reflects updated guideline
    const dbUpdateCheck = await pool.query('SELECT fields FROM extraction_profiles WHERE id = $1', [customPlaybookId]);
    const updatedEbInDb = dbUpdateCheck.rows[0].fields.find(f => f.id === 'economic_buyer');
    assert.equal(updatedEbInDb.prompt_hint, updatedEbGuideline, 'Database must contain updated guideline');

    // Re-run extraction
    aiRequestsReceived.length = 0;
    const recompileRes = await apiFetch(`${BASE_URL}/api/meetings/${testMeetingId}/compile`, {
      method: 'POST',
      body: JSON.stringify({
        templateId: customPlaybookId,
        call_type: 'discovery'
      })
    });
    assert.equal(recompileRes.status, 200);

    assert.equal(aiRequestsReceived.length, 1);
    const reSentToAi = aiRequestsReceived[0].body;
    const reSentEb = reSentToAi.profile.fields.find(f => f.id === 'economic_buyer');
    assert.equal(reSentEb.prompt_hint, updatedEbGuideline, 'AI request must contain updated guideline, NOT the old version');
    assert.notEqual(reSentEb.prompt_hint, testAGuideline, 'Must not contain stale previous guideline');
    console.log('  ✓ Test D PASSED: Updating guideline persisted to DB and immediately reflected in new AI extraction request\n');

    // ══════════════════════════════════════════════════════════════════════════
    // TEST E: Switch Playbooks
    // ══════════════════════════════════════════════════════════════════════════
    console.log('• TEST E: Switch to a different playbook with different fields...');
    const secondPlaybookId = `test_security_playbook_${Date.now()}`;
    createdProfileIds.push(secondPlaybookId);

    const secondPlaybookPayload = {
      id: secondPlaybookId,
      name: 'Security & Compliance Review',
      description: 'Audit technical security standards and certifications.',
      summary_sections: [
        { id: 'security_summary', name: 'Security Summary', description: 'Overall security findings.', max_words: 80, enabled: true }
      ],
      fields: [
        {
          id: 'soc2_certified',
          name: 'SOC2 Certification',
          type: 'text',
          description: 'SOC2 Type II compliance status.',
          prompt_hint: 'Look for explicit confirmation of SOC2 Type II.',
          ai_instruction: 'Look for explicit confirmation of SOC2 Type II.',
          evidence_required: true,
          options: []
        },
        {
          id: 'data_retention',
          name: 'Data Retention Policy',
          type: 'text',
          description: 'Days or years customer data is retained.',
          prompt_hint: 'Look for specific retention timeframes (e.g. 90 days, 7 years).',
          ai_instruction: 'Look for specific retention timeframes (e.g. 90 days, 7 years).',
          evidence_required: true,
          options: []
        },
        {
          id: 'encryption_standards',
          name: 'Encryption Standards',
          type: 'text',
          description: 'At-rest and in-transit encryption standards discussed.',
          prompt_hint: 'Identify AES-256 or TLS 1.3 mentions.',
          ai_instruction: 'Identify AES-256 or TLS 1.3 mentions.',
          evidence_required: true,
          options: []
        }
      ],
      is_active: false
    };

    const createSecondRes = await apiFetch(`${BASE_URL}/api/extraction-profiles`, {
      method: 'POST',
      body: JSON.stringify(secondPlaybookPayload)
    });
    assert.equal(createSecondRes.status, 201);

    // Run extraction with the second playbook
    aiRequestsReceived.length = 0;
    const compileSecondRes = await apiFetch(`${BASE_URL}/api/meetings/${testMeetingId}/compile`, {
      method: 'POST',
      body: JSON.stringify({
        templateId: secondPlaybookId,
        call_type: 'technical_validation'
      })
    });
    assert.equal(compileSecondRes.status, 200);

    const secondSentToAi = aiRequestsReceived[0].body;
    assert.equal(secondSentToAi.profile.id, secondPlaybookId);
    assert.equal(secondSentToAi.profile.fields.length, 3, 'Must have exactly the 3 security fields');

    const fieldIds = secondSentToAi.profile.fields.map(f => f.id);
    assert.deepEqual(fieldIds.sort(), ['data_retention', 'encryption_standards', 'soc2_certified'].sort());

    // CRITICAL: Ensure fields from previous playbook are NOT retained!
    assert.equal(fieldIds.includes('economic_buyer'), false, 'Previous playbook field economic_buyer must NOT be present');
    assert.equal(fieldIds.includes('authorized_budget'), false, 'Previous playbook field authorized_budget must NOT be present');

    // Check meeting template_used
    const meetingAfterSwitch = await pool.query('SELECT template_used FROM meetings WHERE id = $1', [testMeetingId]);
    assert.equal(meetingAfterSwitch.rows[0].template_used, secondPlaybookId, 'meeting.template_used must be updated to second playbook');
    console.log('  ✓ Test E PASSED: Switching playbooks changed extraction context completely with no stale field retention\n');

    // ══════════════════════════════════════════════════════════════════════════
    // TEST F: Reload and Persistence
    // ══════════════════════════════════════════════════════════════════════════
    console.log('• TEST F: Verify reload and persistence across REST queries...');
    const listRes = await apiFetch(`${BASE_URL}/api/extraction-profiles`);
    assert.equal(listRes.status, 200);
    const allProfiles = await listRes.json();
    
    const foundFirst = allProfiles.find(p => p.id === customPlaybookId);
    const foundSecond = allProfiles.find(p => p.id === secondPlaybookId);
    assert.ok(foundFirst, 'First custom playbook must appear in profile list');
    assert.ok(foundSecond, 'Second custom playbook must appear in profile list');
    assert.equal(foundFirst.fields[0].prompt_hint, updatedEbGuideline, 'Field guidelines must match DB record');

    const singleRes = await apiFetch(`${BASE_URL}/api/extraction-profiles/${secondPlaybookId}`);
    assert.equal(singleRes.status, 200);
    const singleData = await singleRes.json();
    assert.equal(singleData.fields.length, 3);

    // Verify dynamic schema fields save (POST /api/schemas/:id/fields) from Playbooks editor
    const schemaSaveRes = await apiFetch(`${BASE_URL}/api/schemas/00000000-0000-0000-0000-000000000002/fields`, {
      method: 'POST',
      body: JSON.stringify({
        fields: [
          {
            id: 'sf-bant-b',
            label: 'Project Budget',
            name: 'project_budget',
            field_type: 'currency',
            description: 'Total budget discussed.',
            prompt_hint: 'Look for currency symbols.',
            is_required: true,
            options: []
          },
          {
            id: 'economic_buyer',
            label: 'Economic Buyer',
            name: 'economic_buyer',
            field_type: 'string',
            description: 'Ultimate budget signer.',
            prompt_hint: 'VP or C-level executive.',
            is_required: true,
            options: []
          },
          {
            id: 'temp-1729524000123',
            label: 'Client Need',
            name: 'business_need',
            type: 'text',
            description: 'Key business pain points.',
            prompt_hint: 'Client requirements.',
            is_required: false,
            options: []
          }
        ]
      })
    });
    assert.equal(schemaSaveRes.status, 200, `POST /api/schemas/:id/fields must succeed with 200, got ${schemaSaveRes.status}`);
    const schemaSaveData = await schemaSaveRes.json();
    assert.equal(schemaSaveData.ok, true);
    assert.equal(schemaSaveData.count, 3);

    const schemaGetRes = await apiFetch(`${BASE_URL}/api/schemas/00000000-0000-0000-0000-000000000002/fields`);
    assert.equal(schemaGetRes.status, 200);
    const schemaFieldsList = await schemaGetRes.json();
    assert.equal(schemaFieldsList.length, 3);
    for (const sf of schemaFieldsList) {
      assert.match(sf.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Field id must be a valid UUID');
    }

    console.log('  ✓ Test F PASSED: Playbooks and configurations persist reliably and match DB records\n');

    // ══════════════════════════════════════════════════════════════════════════
    // TEST G: Isolation and Invalid Selection
    // ══════════════════════════════════════════════════════════════════════════
    console.log('• TEST G: Verify workspace isolation and rejection of invalid playbook selections...');
    aiRequestsReceived.length = 0;

    // 1. Invalid / Non-existent playbook ID must produce 404, NOT silent fallback to default
    const invalidIdRes = await apiFetch(`${BASE_URL}/api/meetings/${testMeetingId}/compile`, {
      method: 'POST',
      body: JSON.stringify({
        templateId: 'completely_nonexistent_playbook_id_99999',
        call_type: 'discovery'
      })
    });
    assert.equal(invalidIdRes.status, 404, `Invalid playbook ID must return HTTP 404, got ${invalidIdRes.status}`);
    const errBody = await invalidIdRes.json();
    assert.equal(errBody.error, 'playbook_not_found', 'Error code must be playbook_not_found');
    assert.equal(aiRequestsReceived.length, 0, 'No AI extraction request must be dispatched when playbook is invalid');

    // 2. Cross-workspace isolation: Create a profile in a different workspace
    const foreignWorkspaceId = '99999999-9999-9999-9999-999999999999';
    const foreignPlaybookId = `foreign_playbook_${Date.now()}`;
    createdProfileIds.push(foreignPlaybookId);

    // Insert workspace and profile
    await pool.query(
      `INSERT INTO workspaces (id, name, slug) VALUES ($1, 'Foreign Tenant', 'foreign') ON CONFLICT (id) DO NOTHING`,
      [foreignWorkspaceId]
    );
    await pool.query(
      `INSERT INTO extraction_profiles (id, workspace_id, name, description, summary_sections, fields, is_active)
       VALUES ($1, $2, 'Foreign Isolated Playbook', 'Belongs to other tenant', '[]', '[]', false)`,
      [foreignPlaybookId, foreignWorkspaceId]
    );

    // Attempt to compile testMeeting (in workspace 00000000-0000-0000-0000-000000000001) using foreign playbook
    const foreignRes = await apiFetch(`${BASE_URL}/api/meetings/${testMeetingId}/compile`, {
      method: 'POST',
      body: JSON.stringify({
        templateId: foreignPlaybookId,
        call_type: 'discovery'
      })
    });
    assert.equal(foreignRes.status, 404, `Cross-workspace playbook request must be rejected with HTTP 404, got ${foreignRes.status}`);
    assert.equal(aiRequestsReceived.length, 0, 'Cross-workspace playbook must NOT trigger AI compilation');
    console.log('  ✓ Test G PASSED: Invalid and cross-workspace playbooks rejected with 404; zero silent fallback\n');

    console.log('================================================================');
    console.log('   ALL PLAYBOOK DYNAMIC LIFECYCLE TESTS (A - G) PASSED!         ');
    console.log('================================================================\n');

  } catch (err) {
    console.error('\n❌ Test failed with error:', err);
    process.exitCode = 1;
  } finally {
    // Cleanup created test records
    console.log('Cleaning up test records from database...');
    for (const pid of createdProfileIds) {
      await pool.query('DELETE FROM extraction_profiles WHERE id = $1', [pid]).catch(() => {});
    }
    for (const mid of createdMeetingIds) {
      await pool.query('DELETE FROM transcript_segments WHERE meeting_id = $1', [mid]).catch(() => {});
      await pool.query('DELETE FROM call_extractions WHERE meeting_id = $1', [mid]).catch(() => {});
      await pool.query('DELETE FROM meetings WHERE id = $1', [mid]).catch(() => {});
    }
    await pool.query(`DELETE FROM workspaces WHERE id = '99999999-9999-9999-9999-999999999999'`).catch(() => {});
    await pool.end().catch(() => {});

    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
    if (mockAiServer) {
      mockAiServer.close();
    }
  }
}

run();

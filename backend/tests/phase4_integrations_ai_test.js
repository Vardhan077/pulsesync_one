/**
 * Phase 4 Regression Tests: AI Extraction & Integration Reliability
 * 
 * Verifies fixes for:
 * - PS-010: Dynamic HubSpot portal ID resolution (no hardcoded '247215704')
 * - PS-011: Dynamic workspace domains in RoleResolver and MeetingBotWorker
 * - PS-012: Tightened substring evidence matching rejecting short fillers
 * - PS-014: Disabled/Coming soon states for Salesforce and Pipedrive in Step 7
 * - PS-016: CHAMP and SPIN templates in extraction engines
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running Phase 4 Regression Tests...');

// 1. PS-010 Verification: Elimination of hardcoded HubSpot portal ID 247215704
{
  const dashboardCode = fs.readFileSync(path.join(__dirname, '../../pulsesync_react/pulsesync-dashboard/src/pages/Dashboard.jsx'), 'utf8');
  const hubspotAdapterCode = fs.readFileSync(path.join(__dirname, '../services/integration/HubSpotAdapter.js'), 'utf8');
  const syncEngineCode = fs.readFileSync(path.join(__dirname, '../services/integration/SyncEngine.js'), 'utf8');

  // Verify '247215704' does not appear in HubSpotAdapter.js
  assert.equal(hubspotAdapterCode.includes('247215704'), false, 'HubSpotAdapter.js must not contain hardcoded portal ID 247215704');

  // Verify '247215704' does not appear in SyncEngine.js
  assert.equal(syncEngineCode.includes('247215704'), false, 'SyncEngine.js must not contain hardcoded portal ID 247215704');

  // Verify '247215704' does not appear in Dashboard.jsx
  assert.equal(dashboardCode.includes('247215704'), false, 'Dashboard.jsx must not contain hardcoded portal ID 247215704');

  console.log('✓ PS-010: Hardcoded portal ID 247215704 eliminated across adapters, sync engine, and UI');
}

// 2. PS-011 Verification: Dynamic workspace domains in RoleResolver and MeetingBotWorker
{
  const roleResolverCode = fs.readFileSync(path.join(__dirname, '../services/meeting-bot/attribution/RoleResolver.js'), 'utf8');
  const workerCode = fs.readFileSync(path.join(__dirname, '../workers/MeetingBotWorker.js'), 'utf8');

  assert.equal(roleResolverCode.includes('process.env.WORKSPACE_INTERNAL_DOMAINS'), true, 'RoleResolver must check WORKSPACE_INTERNAL_DOMAINS');
  assert.equal(workerCode.includes('job.workspace_id'), true, 'MeetingBotWorker must query workspace-specific domains when available');

  console.log('✓ PS-011: Workspace domains dynamically resolved in RoleResolver and MeetingBotWorker');
}

// 3. PS-012 Verification: EvidenceValidator rejects short utterance matches
{
  const validatorCode = fs.readFileSync(path.join(__dirname, '../services/ai/EvidenceValidator.js'), 'utf8');

  // Must not have the old faulty slice match
  assert.equal(validatorCode.includes('cleanQuote.slice(0, 15)'), false, 'EvidenceValidator must not use cleanQuote.slice(0, 15)');
  assert.equal(validatorCode.includes('cleanQuote.length >= 10'), true, 'EvidenceValidator must enforce minimum quote length');
  assert.equal(validatorCode.includes('segTxt.length < 10'), true, 'EvidenceValidator must reject short segments under 10 chars');

  console.log('✓ PS-012: Evidence matching tightened with length and substring guards');
}

// 4. PS-014 Verification: Coming soon state for Salesforce and Pipedrive
{
  const dashboardCode = fs.readFileSync(path.join(__dirname, '../../pulsesync_react/pulsesync-dashboard/src/pages/Dashboard.jsx'), 'utf8');

  assert.equal(dashboardCode.includes("activeSyncTab !== 'hubspot'"), true, 'Dashboard must render dedicated coming-soon view for non-hubspot destinations');
  assert.equal(dashboardCode.includes("Integration — Coming Soon"), true, 'Dashboard must display "Integration — Coming Soon" heading');

  console.log('✓ PS-014: Non-HubSpot CRM destinations display Coming Soon state');
}

// 5. PS-016 Verification: CHAMP and SPIN templates present
{
  const pyEngineCode = fs.readFileSync(path.join(__dirname, '../../ai-service/extraction_engine.py'), 'utf8');
  const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

  assert.equal(pyEngineCode.includes('"champ":'), true, 'Python extraction engine must define champ template');
  assert.equal(pyEngineCode.includes('"spin":'), true, 'Python extraction engine must define spin template');
  assert.equal(serverCode.includes('id: "champ"'), true, 'Node server must define champ template');
  assert.equal(serverCode.includes('id: "spin"'), true, 'Node server must define spin template');

  console.log('✓ PS-016: CHAMP and SPIN templates present in AI service and backend server');
}

console.log('All Phase 4 Regression Tests Passed Successfully!');

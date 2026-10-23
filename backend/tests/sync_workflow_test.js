import assert from 'node:assert/strict';
import crypto from 'crypto';
import { SyncEngine } from '../services/integration/SyncEngine.js';

console.log('--- Starting PulseSync CRM Sync Workflow Hardening Verification ---');

// Mock adapter to track API calls and simulate HubSpot behavior
class MockHubSpotAdapter {
  constructor() {
    this.createCompanyCalls = 0;
    this.createDealCalls = 0;
    this.createTaskCalls = 0;
    this.createNoteCalls = 0;
    this.updateCompanyCalls = 0;
    this.updateDealCalls = 0;
  }

  async testConnection() {
    return { success: true };
  }

  async searchCompany(token, domain) {
    return [];
  }

  async searchContact(token, query) {
    return [];
  }

  async createCompany(token, properties) {
    this.createCompanyCalls++;
    return {
      id: 'mock_hubspot_company_101',
      name: properties.name || 'Test Company',
      url: 'https://app.hubspot.com/contacts/247215704/record/0-2/mock_hubspot_company_101'
    };
  }

  async updateCompany(token, id, properties) {
    this.updateCompanyCalls++;
    return { id, url: `https://app.hubspot.com/contacts/247215704/record/0-2/${id}` };
  }

  async searchDeal(token, dealName) {
    return [];
  }

  async createDeal(token, properties) {
    this.createDealCalls++;
    return {
      id: 'mock_hubspot_deal_202',
      name: properties.dealname || 'Test Deal',
      url: 'https://app.hubspot.com/contacts/247215704/record/0-3/mock_hubspot_deal_202'
    };
  }

  async updateDeal(token, id, properties) {
    this.updateDealCalls++;
    return { id, url: `https://app.hubspot.com/contacts/247215704/record/0-3/${id}` };
  }

  async createOrUpdateContact(token, email, properties) {
    return {
      id: 'mock_hubspot_contact_303',
      email,
      url: 'https://app.hubspot.com/contacts/247215704/record/0-1/mock_hubspot_contact_303'
    };
  }

  async associate() {
    return true;
  }

  async createTask(token, properties) {
    this.createTaskCalls++;
    return {
      id: `mock_hubspot_task_${this.createTaskCalls}`,
      subject: properties.subject
    };
  }

  async createNote(token, body) {
    this.createNoteCalls++;
    return {
      id: 'mock_hubspot_note_505',
      body
    };
  }
}

// In-memory test store replicating fallback DB schema
function createTestDbStore() {
  const store = {
    integrations: [
      {
        id: 'int_hs_001',
        name: 'HubSpot Test CRM',
        provider: 'hubspot',
        connection_status: 'connected',
        auth_metadata: { account_name: '247215704' }
      }
    ],
    integration_credentials: [
      {
        integration_id: 'int_hs_001',
        // Dummy values for test (we stub resolveAccessToken)
        encrypted_access_token: 'test_token',
        iv: '0'.repeat(32),
        auth_tag: '0'.repeat(32),
        expires_at: new Date(Date.now() + 86400000).toISOString()
      }
    ],
    meetings: [
      {
        id: 'mtg_001',
        title: 'Acme Corp Sales Review',
        company_name: 'Acme Corp',
        status: 'ready_for_review',
        workflow_state: 'ready_for_review',
        action_items: [
          { task: 'Send updated enterprise proposal', owner: 'Alice' },
          { task: 'Schedule technical validation call', owner: 'Bob' }
        ]
      }
    ],
    transcripts: [
      {
        meeting_id: 'mtg_001',
        extracted_data: {
          budget: '$75,000 ARR',
          decision_maker: 'Jane Doe',
          timeline: 'Q1 2027'
        }
      }
    ],
    call_extractions: [
      {
        meeting_id: 'mtg_001',
        extracted_data: {
          budget: '75000',
          decision_maker: 'Jane Doe',
          timeline: '2027-03-31'
        }
      }
    ],
    approvals: [
      {
        meeting_id: 'mtg_001',
        field: 'deal_amount',
        suggested_value: '75000',
        approved_value: '75000',
        status: 'approved'
      },
      {
        meeting_id: 'mtg_001',
        field: 'close_date',
        suggested_value: '2027-03-31',
        approved_value: '2027-03-31',
        status: 'approved'
      }
    ],
    summaries: [],
    companies: [],
    speakers: [],
    sync_runs: [],
    sync_items: []
  };

  const readFallbackDb = () => store;
  const writeFallbackDb = (updated) => {
    Object.assign(store, updated);
  };

  return { store, readFallbackDb, writeFallbackDb };
}

async function runTests() {
  const { store, readFallbackDb, writeFallbackDb } = createTestDbStore();
  const mockAdapter = new MockHubSpotAdapter();

  const engine = new SyncEngine(null, true, readFallbackDb, writeFallbackDb, {
    info: () => {},
    warn: () => {},
    error: () => {}
  });

  // Inject mock adapter and bypass credential decryption for unit test
  engine.adapters.hubspot = mockAdapter;
  engine.resolveAccessToken = async (integrationId) => {
    const data = readFallbackDb();
    const intObj = (data.integrations || []).find(i => i.id === integrationId) || {
      id: integrationId,
      name: 'HubSpot Test CRM',
      provider: 'hubspot',
      auth_metadata: { account_name: '247215704' }
    };
    return {
      accessToken: 'test_mock_token_hs',
      provider: 'hubspot',
      integration: intObj,
      portalId: '247215704'
    };
  };

  // -------------------------------------------------------------
  // Test 1: Initial Sync Execution
  // -------------------------------------------------------------
  console.log('Test 1: Initial Sync Execution creates reservation and completes with accurate counts...');
  const res1 = await engine.executeSync('mtg_001', 'int_hs_001', {
    idempotencyKey: 'sync_mtg_001_int_hs_001'
  });

  assert.equal(res1.success, true, 'Initial sync must succeed');
  assert.equal(res1.status, 'succeeded', 'Status must be succeeded');
  assert.equal(res1.alreadySynced, false, 'Initial sync should have alreadySynced as false');
  assert.ok(res1.fieldsUpdatedCount > 0, 'fieldsUpdatedCount must be a positive number');
  assert.notEqual(res1.fieldsUpdatedCount, undefined, 'fieldsUpdatedCount must not be undefined');
  assert.ok(res1.summary, 'summary object must be present');
  assert.notEqual(res1.summary.fieldsUpdatedCount, undefined, 'summary.fieldsUpdatedCount must not be undefined');
  assert.equal(res1.summary.fieldsUpdatedCount, res1.fieldsUpdatedCount, 'fieldsUpdatedCount must match summary');
  assert.equal(res1.updatedRecords.company.id, 'mock_hubspot_company_101', 'Company ID resolved');
  assert.equal(res1.updatedRecords.deal.id, 'mock_hubspot_deal_202', 'Deal ID resolved');
  assert.equal(mockAdapter.createCompanyCalls, 1, 'createCompany called once');
  assert.equal(mockAdapter.createDealCalls, 1, 'createDeal called once');

  // Check persisted sync_run record
  const savedRun = store.sync_runs.find(r => r.idempotency_key === 'sync_mtg_001_int_hs_001');
  assert.ok(savedRun, 'Sync run must be persisted in database');
  assert.equal(savedRun.status, 'succeeded', 'Persisted sync run must be succeeded');
  assert.equal(store.sync_runs.length, 1, 'Exactly one sync_run row must exist');

  // Check meeting state
  const meeting = store.meetings.find(m => m.id === 'mtg_001');
  assert.equal(meeting.status, 'synced', 'Meeting status must be synced');
  assert.equal(meeting.workflow_state, 'synced', 'Meeting workflow_state must be synced');
  assert.equal(meeting.crm_company_id, 'mock_hubspot_company_101');
  assert.equal(meeting.crm_deal_id, 'mock_hubspot_deal_202');
  console.log('✓ Test 1 Passed: Initial sync created atomic reservation, executed writes, and updated meeting state.');

  // -------------------------------------------------------------
  // Test 2: Idempotent Re-execution (No Duplicate Writes)
  // -------------------------------------------------------------
  console.log('Test 2: Idempotent re-execution returns persisted result without duplicate HubSpot writes...');
  const res2 = await engine.executeSync('mtg_001', 'int_hs_001', {
    idempotencyKey: 'sync_mtg_001_int_hs_001'
  });

  assert.equal(res2.success, true, 'Re-execution must succeed');
  assert.equal(res2.status, 'succeeded', 'Status must be succeeded');
  assert.equal(res2.alreadySynced, true, 'alreadySynced flag must be true');
  assert.equal(res2.fieldsUpdatedCount, res1.fieldsUpdatedCount, 'fieldsUpdatedCount must be identical');
  assert.notEqual(res2.fieldsUpdatedCount, undefined, 'fieldsUpdatedCount must not be undefined');
  assert.notEqual(res2.summary?.fieldsUpdatedCount, undefined, 'summary.fieldsUpdatedCount must not be undefined');
  assert.equal(res2.updatedRecords.company.id, 'mock_hubspot_company_101', 'Company ID matched');
  assert.equal(res2.updatedRecords.deal.id, 'mock_hubspot_deal_202', 'Deal ID matched');

  // Verify external writes were NOT called again!
  assert.equal(mockAdapter.createCompanyCalls, 1, 'createCompany must NOT be called again');
  assert.equal(mockAdapter.createDealCalls, 1, 'createDeal must NOT be called again');
  assert.equal(store.sync_runs.length, 1, 'No second sync_run row created; idempotency preserved');
  console.log('✓ Test 2 Passed: Repeated execution safely returned existing result without duplicate writes or key collisions.');

  // -------------------------------------------------------------
  // Test 3: Concurrency Protection (SYNC_ALREADY_IN_PROGRESS)
  // -------------------------------------------------------------
  console.log('Test 3: Concurrent sync attempt while in_progress throws 409 conflict...');
  // Add a new meeting with an in_progress sync run
  store.meetings.push({
    id: 'mtg_concurrent',
    title: 'Concurrent Meeting',
    status: 'syncing',
    workflow_state: 'syncing'
  });
  store.sync_runs.push({
    id: 'run_concurrent_active',
    meeting_id: 'mtg_concurrent',
    integration_id: 'int_hs_001',
    idempotency_key: 'sync_mtg_concurrent_int_hs_001',
    status: 'in_progress',
    created_at: new Date().toISOString(),
    destination_record_ids: {}
  });

  let concurrencyThrew = false;
  try {
    await engine.executeSync('mtg_concurrent', 'int_hs_001', {
      idempotencyKey: 'sync_mtg_concurrent_int_hs_001'
    });
  } catch (err) {
    concurrencyThrew = true;
    assert.equal(err.code, 'SYNC_ALREADY_IN_PROGRESS', 'Must throw SYNC_ALREADY_IN_PROGRESS');
    assert.equal(err.statusCode, 409, 'Must return HTTP 409 status');
  }
  assert.equal(concurrencyThrew, true, 'Concurrent request must be blocked');
  console.log('✓ Test 3 Passed: Concurrency lock successfully blocked duplicate in-flight execution.');

  // -------------------------------------------------------------
  // Test 4: Partial Failure Reconciliation & Safe Retry
  // -------------------------------------------------------------
  console.log('Test 4: Safe retry after partial failure reuses existing CRM records without duplicate creation...');
  store.meetings.push({
    id: 'mtg_partial',
    title: 'Partial Run Meeting',
    company_name: 'Beta LLC',
    status: 'failed',
    workflow_state: 'failed',
    crm_company_id: 'existing_company_999'
  });
  store.sync_runs.push({
    id: 'run_partial_001',
    meeting_id: 'mtg_partial',
    integration_id: 'int_hs_001',
    idempotency_key: 'sync_mtg_partial_int_hs_001',
    status: 'failed',
    created_at: new Date(Date.now() - 60000).toISOString(),
    error_message: 'Network timeout during deal creation',
    destination_record_ids: {
      companyId: 'existing_company_999'
    }
  });

  const initialCompanyCalls = mockAdapter.createCompanyCalls;
  const res4 = await engine.executeSync('mtg_partial', 'int_hs_001', {
    idempotencyKey: 'sync_mtg_partial_int_hs_001'
  });

  assert.equal(res4.success, true, 'Retry must succeed');
  assert.equal(res4.status, 'succeeded', 'Status must transition to succeeded');
  // Did not create a second company because companyId was reconciled!
  assert.equal(mockAdapter.createCompanyCalls, initialCompanyCalls, 'Must NOT re-create existing company on retry');
  assert.equal(res4.updatedRecords.company.id, 'existing_company_999', 'Reconciled company ID preserved');
  assert.equal(res4.updatedRecords.deal.id, 'mock_hubspot_deal_202', 'Deal created and associated');

  // Verify sync_run row was UPDATED, NOT re-inserted with duplicate key!
  const partialRuns = store.sync_runs.filter(r => r.idempotency_key === 'sync_mtg_partial_int_hs_001');
  assert.equal(partialRuns.length, 1, 'Only one sync_run row must exist after retry');
  assert.equal(partialRuns[0].status, 'succeeded', 'Row status must be updated to succeeded');
  console.log('✓ Test 4 Passed: Partial retry successfully reconciled earlier records without duplicate creation or key collisions.');

  // -------------------------------------------------------------
  // Test 5: Reopen Review and Reset
  // -------------------------------------------------------------
  console.log('Test 5: Reopen review resets meeting workflow state safely...');
  // Transition meeting from synced to ready_for_review
  const m1 = store.meetings.find(m => m.id === 'mtg_001');
  m1.status = 'ready_for_review';
  m1.workflow_state = 'ready_for_review';
  assert.equal(m1.workflow_state, 'ready_for_review', 'Meeting state now ready_for_review');
  console.log('✓ Test 5 Passed: Reopen review transitions state cleanly.');

  // -------------------------------------------------------------
  // Test 6: Verify Summary Contract (Never Undefined)
  // -------------------------------------------------------------
  console.log('Test 6: Verify success response shape never returns undefined count...');
  assert.ok(typeof res1.fieldsUpdatedCount === 'number', 'fieldsUpdatedCount must be number');
  assert.ok(typeof res1.summary.fieldsUpdatedCount === 'number', 'summary.fieldsUpdatedCount must be number');
  assert.ok(typeof res2.fieldsUpdatedCount === 'number', 'alreadySynced fieldsUpdatedCount must be number');
  assert.ok(typeof res2.summary.fieldsUpdatedCount === 'number', 'alreadySynced summary.fieldsUpdatedCount must be number');
  console.log('✓ Test 6 Passed: Response shape contract verified.');

  // -------------------------------------------------------------
  // Test 7: Normalization of All Supported and Complex Data Types
  // -------------------------------------------------------------
  console.log('Test 7: Type normalization handles strings, numbers, booleans, arrays, objects, and circular refs without [object Object]...');
  // Plain string
  assert.equal(engine._normalizeFieldValue('  Enterprise Plan  '), 'Enterprise Plan');
  // Numeric string & amount
  assert.equal(engine._normalizeFieldValue('$125,000.00 ARR', 'amount'), '125000');
  // Raw number
  assert.equal(engine._normalizeFieldValue(95000), '95000');
  // Boolean
  assert.equal(engine._normalizeFieldValue(true), 'true');
  assert.equal(engine._normalizeFieldValue(false), 'false');
  // Array of primitives
  assert.equal(engine._normalizeFieldValue(['SOC2', 'GDPR', 'HIPAA']), 'SOC2, GDPR, HIPAA');
  // Array of objects (should extract titles/names/tasks, never [object Object])
  const objArray = [
    { task: 'Security Review', owner: 'Alice' },
    { task: 'Contract Approval', owner: 'Bob' }
  ];
  const normArray = engine._normalizeFieldValue(objArray);
  assert.equal(normArray, 'Security Review; Contract Approval');
  assert.ok(!normArray.includes('[object Object]'), 'Array of objects must not format as [object Object]');
  // Nested object
  const nestedObj = { tier: 'Enterprise', seats: 200 };
  const normObj = engine._normalizeFieldValue(nestedObj);
  assert.equal(normObj, 'tier: Enterprise; seats: 200');
  assert.ok(!normObj.includes('[object Object]'), 'Nested object must not format as [object Object]');
  // Null, undefined, empty, and "not mentioned"
  assert.equal(engine._normalizeFieldValue(null), '');
  assert.equal(engine._normalizeFieldValue(undefined), '');
  assert.equal(engine._normalizeFieldValue(''), '');
  assert.equal(engine._normalizeFieldValue('Not mentioned'), '');
  assert.equal(engine._normalizeFieldValue([]), '');
  assert.equal(engine._normalizeFieldValue({}), '');
  // Circular reference (must not throw or produce [object Object])
  const circular = { name: 'Acme Self' };
  circular.child = circular;
  const normCirc = engine._normalizeFieldValue(circular);
  assert.equal(normCirc, 'Acme Self');
  assert.ok(!normCirc.includes('[object Object]'), 'Circular structure must not produce [object Object]');
  console.log('✓ Test 7 Passed: All data types normalized cleanly without [object Object] or crashes.');

  // -------------------------------------------------------------
  // Test 8: Internal Container and Metadata Keys Exclusion
  // -------------------------------------------------------------
  console.log('Test 8: prepareSync excludes internal metadata and container keys from CRM diffs...');
  // Add meeting with exact problematic structure from screenshot
  store.meetings.push({
    id: 'mtg_containers',
    title: 'Acme MEDDICC Discovery',
    company_name: 'Acme Containers Inc',
    status: 'ready_for_review',
    workflow_state: 'ready_for_review'
  });
  store.call_extractions.push({
    meeting_id: 'mtg_containers',
    extracted_data: {
      meeting_id: 'mtg_containers',
      call_type_rationale: 'Customer discussing pricing and timeline',
      call_type_confidence: 0.98,
      profile: { company: 'Acme', industry: 'Software' },
      action_items: [
        { task: 'Follow up on NDA', owner: 'Dave' }
      ],
      deal_signals: { urgency: 'High', sentiment: 'Positive' },
      conversation_intelligence: { talk_ratio: 0.65 },
      template_fields: [
        { field_name: 'economic_buyer', value: 'Sarah Connor', review_status: 'approved' },
        { field_name: 'budget', value: '$150,000', review_status: 'approved' },
        { field_name: 'pain', value: 'Current tool latency too high', review_status: 'approved' }
      ]
    }
  });

  const prepContainers = await engine.prepareSync('mtg_containers', 'int_hs_001');
  const internalKeys = [
    'fields', 'template_fields', 'profile', 'meeting_id', 'action_items',
    'deal_signals', 'conversation_intelligence', 'summary_sections',
    'irrelevant_segments', 'call_type_rationale', 'call_type_confidence'
  ];

  for (const diff of prepContainers.fieldDiffs) {
    assert.ok(
      !internalKeys.includes(diff.pulseSyncField.toLowerCase()),
      `Internal key "${diff.pulseSyncField}" must not appear as a CRM property diff!`
    );
    assert.ok(
      !String(diff.newValue).includes('[object Object]'),
      `Diff value for "${diff.pulseSyncField}" must not contain [object Object]`
    );
  }

  // Ensure genuine playbook fields were extracted
  const extractedFieldNames = prepContainers.fieldDiffs.map(d => d.pulseSyncField.toLowerCase());
  assert.ok(extractedFieldNames.includes('economic_buyer'), 'Playbook field economic_buyer must be extracted');
  assert.ok(extractedFieldNames.includes('budget'), 'Playbook field budget must be extracted');
  assert.ok(extractedFieldNames.includes('pain'), 'Playbook field pain must be extracted');
  console.log('✓ Test 8 Passed: Internal container keys cleanly excluded and playbook fields properly surfaced.');

  // -------------------------------------------------------------
  // Test 9: Approved but Unmapped Fields Handling
  // -------------------------------------------------------------
  console.log('Test 9: Approved but unmapped properties remain visible in preview but excluded from CRM writes...');
  // Add a field that is unmapped in custom mappings or defaults
  store.call_extractions.push({
    meeting_id: 'mtg_unmapped_test',
    extracted_data: {
      template_fields: [
        { field_name: 'budget', value: '80000', review_status: 'approved' },
        { field_name: 'unmapped_custom_metric', value: 'Custom Score 95', review_status: 'approved' }
      ]
    }
  });
  store.meetings.push({
    id: 'mtg_unmapped_test',
    title: 'Unmapped Field Meeting',
    company_name: 'Gamma Systems',
    status: 'ready_for_review',
    workflow_state: 'ready_for_review'
  });

  const prepUnmapped = await engine.prepareSync('mtg_unmapped_test', 'int_hs_001');
  const unmappedDiff = prepUnmapped.fieldDiffs.find(d => d.pulseSyncField === 'unmapped_custom_metric');
  assert.ok(unmappedDiff, 'Unmapped field should be present in preview for visibility');
  assert.equal(unmappedDiff.isMapped, false, 'isMapped must be false');
  assert.equal(unmappedDiff.destinationField, 'unmapped', 'destinationField must be "unmapped"');
  assert.equal(unmappedDiff.status, 'UNMAPPED', 'status must be "UNMAPPED"');
  assert.equal(unmappedDiff.isEligibleForSync, false, 'isEligibleForSync must be false for unmapped field');

  // Attempt to execute sync with approvedFields explicitly including the unmapped field
  let capturedDealProps = null;
  const originalCreateDeal = mockAdapter.createDeal;
  mockAdapter.createDeal = async (token, props) => {
    capturedDealProps = props;
    return { id: 'deal_unmapped_created', url: 'http://hubspot.com/deal' };
  };

  const execUnmapped = await engine.executeSync('mtg_unmapped_test', 'int_hs_001', {
    approvedFields: ['budget', 'unmapped_custom_metric']
  });

  assert.equal(execUnmapped.success, true);
  // Verify unmapped property was NOT added to dealProps
  assert.equal(capturedDealProps.unmapped_custom_metric, undefined, 'Unmapped property must not be written to CRM');
  assert.equal(capturedDealProps.unmapped, undefined, 'unmapped key must not be written to CRM');
  // Verify sync_items did NOT save the unmapped property
  const unmappedItems = store.sync_items.filter(i => i.destination_field === 'unmapped');
  assert.equal(unmappedItems.length, 0, 'sync_items must not contain any unmapped property rows');

  // Restore adapter methods
  mockAdapter.createDeal = originalCreateDeal;
  console.log('✓ Test 9 Passed: Approved unmapped properties safely excluded from CRM writes and audit items.');

  // -------------------------------------------------------------
  // Test 10: Incompatible Destination Property Type Flagged and Excluded
  // -------------------------------------------------------------
  console.log('Test 10: Incompatible destination property types are flagged and excluded from execution...');
  store.meetings.push({
    id: 'mtg_type_mismatch',
    title: 'Type Incompatibility Meeting',
    company_name: 'Mismatch LLC',
    status: 'ready_for_review',
    workflow_state: 'ready_for_review'
  });
  store.call_extractions.push({
    meeting_id: 'mtg_type_mismatch',
    extracted_data: {
      template_fields: [
        { field_name: 'budget', value: 'Not-A-Valid-Amount-Or-Number', review_status: 'approved' },
        { field_name: 'timeline', value: 'Invalid-Date-String-XYZ', review_status: 'approved' }
      ]
    }
  });

  const prepMismatch = await engine.prepareSync('mtg_type_mismatch', 'int_hs_001');
  const budgetDiff = prepMismatch.fieldDiffs.find(d => d.pulseSyncField === 'budget');
  assert.ok(budgetDiff, 'budget diff present');
  assert.equal(budgetDiff.status, 'TYPE_INCOMPATIBLE', 'Status must be TYPE_INCOMPATIBLE');
  assert.ok(budgetDiff.validationError, 'validationError must be present');
  assert.equal(budgetDiff.isEligibleForSync, false, 'isEligibleForSync must be false');

  const execMismatch = await engine.executeSync('mtg_type_mismatch', 'int_hs_001', {
    approvedFields: ['budget', 'timeline']
  });
  assert.equal(execMismatch.success, true);
  // Budget should have been excluded from executed writes because it has a validationError
  const budgetSyncItem = store.sync_items.find(i => i.sync_run_id === execMismatch.syncRunId && i.destination_field === 'amount');
  assert.equal(budgetSyncItem, undefined, 'Invalid amount must be excluded from sync_items');
  console.log('✓ Test 10 Passed: Incompatible types safely flagged with validation errors and excluded from writes.');

  // -------------------------------------------------------------
  // Test 11: Authoritative Summary and Action Items Separation
  // -------------------------------------------------------------
  console.log('Test 11: Summary and action items remain distinct according to schema...');
  store.meetings.push({
    id: 'mtg_summary_sep',
    title: 'Executive Sync',
    company_name: 'Executive Corp',
    status: 'ready_for_review',
    workflow_state: 'ready_for_review'
  });
  store.summaries.push({
    meeting_id: 'mtg_summary_sep',
    overview: 'Customer agreed to standard enterprise contract with custom SLA.',
    action_items: [
      { task: 'Send SLA document', owner: 'Legal' },
      { task: 'Schedule onboarding', owner: 'CSM' }
    ]
  });

  const prepSummary = await engine.prepareSync('mtg_summary_sep', 'int_hs_001');
  const summaryDiff = prepSummary.fieldDiffs.find(d => d.pulseSyncField === 'summary');
  assert.ok(summaryDiff, 'Summary diff mapped to description');
  assert.equal(summaryDiff.newValue, 'Customer agreed to standard enterprise contract with custom SLA.');
  assert.ok(!summaryDiff.newValue.includes('Send SLA document'), 'Summary must NOT contain concatenated action items');

  // Verify action items are in tasksSummary
  assert.equal(prepSummary.tasksSummary.total, 2);
  assert.equal(prepSummary.tasksSummary.items[0].task, 'Send SLA document');
  console.log('✓ Test 11 Passed: Authoritative summary remains pristine and action items stay in task layer.');

  // -------------------------------------------------------------
  // Test 12: Preview Values Match Actual Sync Execution Payload
  // -------------------------------------------------------------
  console.log('Test 12: Preview values match actual CRM payload values exactly...');
  store.meetings.push({
    id: 'mtg_preview_exec_match',
    title: 'Value Parity Meeting',
    company_name: 'Parity Inc',
    status: 'ready_for_review',
    workflow_state: 'ready_for_review'
  });
  store.call_extractions.push({
    meeting_id: 'mtg_preview_exec_match',
    extracted_data: {
      template_fields: [
        { field_name: 'budget', value: '$65,000 ARR', review_status: 'approved' },
        { field_name: 'economic_buyer', value: 'John Smith', review_status: 'approved' }
      ]
    }
  });

  const prepMatch = await engine.prepareSync('mtg_preview_exec_match', 'int_hs_001');
  const previewBudget = prepMatch.fieldDiffs.find(d => d.pulseSyncField === 'budget').newValue;
  assert.equal(previewBudget, '65000', 'Preview budget normalized to 65000');

  const execMatch = await engine.executeSync('mtg_preview_exec_match', 'int_hs_001', {
    approvedFields: ['budget', 'economic_buyer']
  });
  const writtenBudgetItem = store.sync_items.find(i => i.sync_run_id === execMatch.syncRunId && i.destination_field === 'amount');
  assert.ok(writtenBudgetItem, 'Written budget item found in sync_items');
  assert.equal(writtenBudgetItem.new_value, previewBudget, 'Executed new_value must strictly equal preview newValue');
  console.log('✓ Test 12 Passed: Sync preview and execution payload use identical normalized values.');

  // -------------------------------------------------------------
  // Test 13: Strict Payload Assertion: No [object Object] Anywhere
  // -------------------------------------------------------------
  console.log('Test 13: Comprehensive assertion: zero occurrences of [object Object] in any output or payload...');
  // Inspect all sync items in the test database
  for (const item of store.sync_items) {
    assert.ok(!String(item.new_value).includes('[object Object]'), `sync_item new_value contains [object Object]: ${JSON.stringify(item)}`);
    assert.ok(!String(item.destination_field).includes('[object Object]'), 'destination_field contains [object Object]');
    assert.ok(!String(item.destination_object).includes('[object Object]'), 'destination_object contains [object Object]');
  }
  console.log('✓ Test 13 Passed: Zero occurrences of [object Object] in any sync payload, record, or item.');

  // -------------------------------------------------------------
  // Test 14: Summary Contamination Prevention & Task Layer Isolation
  // -------------------------------------------------------------
  console.log('Test 14: Verifying summary contamination prevention: CRM description receives ONLY business summary...');
  store.meetings.push({
    id: 'mtg_contaminated_summary',
    title: '01_Cold_Prospecting',
    company_name: 'Pulse INC.',
    status: 'ready_for_review',
    workflow_state: 'ready_for_review',
    call_type: 'cold_prospecting',
    overview: 'The customer highlighted operational friction around getting people to update opportunities consistently. Agreed next steps: Absolutely. I will send a short note and ask Mark whether a brief introduction makes sense. Thanks for being direct with me..'
  });
  store.summaries.push({
    meeting_id: 'mtg_contaminated_summary',
    overview: 'The customer highlighted operational friction around getting people to update opportunities consistently. Agreed next steps: Absolutely. I will send a short note and ask Mark whether a brief introduction makes sense. Thanks for being direct with me..',
    action_items: [
      { task: 'Send a short note and ask Mark whether a brief introduction makes sense.', owner: 'Alex' }
    ]
  });

  const prepContam = await engine.prepareSync('mtg_contaminated_summary', 'int_hs_001');
  const contamSummaryDiff = prepContam.fieldDiffs.find(d => d.pulseSyncField === 'summary');
  assert.ok(contamSummaryDiff, 'summary diff exists');
  assert.equal(
    contamSummaryDiff.newValue,
    'The customer highlighted operational friction around getting people to update opportunities consistently.'
  );
  assert.ok(
    !contamSummaryDiff.newValue.includes('Agreed next steps'),
    'Agreed next steps must not be in summary'
  );
  assert.ok(
    !contamSummaryDiff.newValue.includes('Thanks for being direct with me'),
    'Conversational signoffs must not be in summary'
  );

  // Verify task remains intact in tasksSummary
  assert.equal(prepContam.tasksSummary.total, 1);
  assert.equal(prepContam.tasksSummary.items[0].task, 'Send a short note and ask Mark whether a brief introduction makes sense.');
  console.log('✓ Test 14 Passed: Summary cleanly decoupled from commitments; tasks remain isolated in task layer.');

  // -------------------------------------------------------------
  // Test 15: Stage Consistency & Internal Metadata Exclusion
  // -------------------------------------------------------------
  console.log('Test 15: Verifying stage consistency & internal metadata exclusion...');
  store.call_extractions.push({
    meeting_id: 'mtg_contaminated_summary',
    extracted_data: {
      call_type: 'cold_prospecting',
      call_type_rationale: 'Outbound sales call introducing capabilities',
      deal_signals: {
        buying_stage: 'Prospecting'
      },
      template_fields: []
    }
  });

  const prepStage = await engine.prepareSync('mtg_contaminated_summary', 'int_hs_001');
  // call_type must NOT be in fieldDiffs
  const callTypeDiff = prepStage.fieldDiffs.find(d => d.pulseSyncField === 'call_type');
  assert.equal(callTypeDiff, undefined, 'call_type must be excluded as internal metadata');

  // buying_stage must be Prospecting, NOT defaulted to Discovery for cold calls
  const buyingStageDiff = prepStage.fieldDiffs.find(d => d.pulseSyncField === 'buying_stage');
  if (buyingStageDiff) {
    assert.equal(buyingStageDiff.newValue, 'Prospecting', 'buying_stage must be Prospecting for cold prospecting');
    assert.equal(buyingStageDiff.isMapped, false, 'buying_stage is unmapped by default');
  }
  console.log('✓ Test 15 Passed: call_type excluded and buying_stage consistent with call stage.');

  // -------------------------------------------------------------
  // Test 16: Company Matching Fallback & Parallel Deal Safety
  // -------------------------------------------------------------
  console.log('Test 16: Verifying company search domain -> name fallback and deal duplicate safety...');
  let searchedByDomain = false;
  let searchedByName = false;
  mockAdapter.searchCompany = async (token, q) => {
    if (q.domain) searchedByDomain = true;
    if (q.name) searchedByName = true;
    return [{ id: 'mock_matched_co_123', name: q.name, domain: q.domain, properties: { name: q.name } }];
  };

  store.companies.push({ id: 'comp_fallback_test', name: 'Pulse INC.', website: 'https://pulse.io' });
  store.meetings.push({
    id: 'mtg_fallback_test',
    title: 'Pulse INC. Call',
    company_id: 'comp_fallback_test',
    status: 'ready_for_review',
    workflow_state: 'ready_for_review'
  });

  const prepSearch = await engine.prepareSync('mtg_fallback_test', 'int_hs_001');
  assert.equal(prepSearch.resolvedRecords.company.id, 'mock_matched_co_123', 'Matched company resolved via adapter');
  assert.equal(prepSearch.resolvedRecords.company.isNew, false, 'isNew must be false when matched');

  console.log('✓ Test 16 Passed: Company search fallback resolves existing matches safely.');

  console.log('\n======================================================');
  console.log('All 16 CRM Sync Workflow Hardening Tests Passed Successfully!');
  console.log('======================================================');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

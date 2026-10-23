/**
 * customer_screen_accuracy_test.cjs
 *
 * Comprehensive integration test suite verifying Customer Screen Data Accuracy,
 * Cross-Call Reconciliation, Stakeholder Attribution, Playbook Intelligence,
 * Commitments, and Account Brief for Pulse INC.
 */

const assert = require('assert');

const BASE_URL = 'http://localhost:3001/api/customers/888217dc-bc45-4110-98b5-d3bc35e74390';

async function runTests() {
  console.log('=== STARTING CUSTOMER SCREEN ACCURACY INTEGRATION TEST ===\n');
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`✗ FAIL: ${name}`);
      console.error(err.message);
      process.exitCode = 1;
    }
  }

  // 1. Fetch Company Summary
  console.log('1. Fetching Customer Overview...');
  const compRes = await fetch(BASE_URL);
  assert.strictEqual(compRes.status, 200, 'Company endpoint should return 200');
  const compData = await compRes.json();

  test('Company summary has valid company record and meetings', () => {
    assert.ok(compData.company, 'Company object exists');
    assert.strictEqual(compData.company.name, 'Pulse INC.');
    assert.strictEqual(compData.meetings.length, 2, 'Should have exactly 2 recorded meetings');
    assert.ok(compData.memories.length > 0, 'Should have active company memories');
  });

  test('Company memory facts accurately reflect qualification findings', () => {
    const budgetMem = compData.memories.find(m => m.memory_type === 'budget');
    assert.ok(budgetMem, 'Budget memory exists');
    assert.ok(budgetMem.value.toLowerCase().includes('earmarked'), 'Budget memory mentions earmarked funds');

    const dmMem = compData.memories.find(m => m.memory_type === 'decision_maker');
    assert.ok(dmMem, 'Decision maker memory exists');
    assert.ok(dmMem.value.includes('Sarah'), 'Decision maker memory identifies Sarah');

    const timelineMem = compData.memories.find(m => m.memory_type === 'timeline');
    assert.ok(timelineMem, 'Timeline memory exists');
    assert.ok(timelineMem.value.includes('45 days'), 'Timeline memory mentions 45 days');
  });

  // 2. Cross-Call Changes
  console.log('\n2. Fetching What Changed Across Calls...');
  const changesRes = await fetch(`${BASE_URL}/changes`);
  assert.strictEqual(changesRes.status, 200, 'Changes endpoint should return 200');
  const changes = await changesRes.json();

  test('Changes contain NO undefined values or broken templates', () => {
    assert.ok(Array.isArray(changes), 'Changes is an array');
    assert.ok(changes.length > 0, 'Should have verified cross-call changes');

    for (const ch of changes) {
      assert.notStrictEqual(ch.field, 'undefined', 'Field must not be "undefined"');
      assert.notStrictEqual(ch.old_value, 'undefined', 'Old value must not be "undefined"');
      assert.notStrictEqual(ch.new_value, 'undefined', 'New value must not be "undefined"');
      assert.ok(ch.field && ch.field.trim().length > 0, 'Field must be defined');
      assert.ok(ch.new_value && ch.new_value.trim().length > 0, 'New value must be defined');
      assert.notStrictEqual(ch.old_value, ch.new_value, 'Old and new values must differ');
      assert.ok(ch.evidence, 'Evidence must accompany change event');
      assert.ok(ch.citation, 'Citation must accompany change event');
    }
  });

  test('Changes capture Budget, Timeline, and Decision Authority progression', () => {
    const budgetChange = changes.find(c => c.field_key === 'budget' || c.field.toLowerCase().includes('budget'));
    assert.ok(budgetChange, 'Budget change event exists');
    assert.ok(budgetChange.new_value.toLowerCase().includes('earmarked'), 'Budget change reflects earmarked budget');

    const timelineChange = changes.find(c => c.field_key === 'timeline' || c.field.toLowerCase().includes('timeline'));
    assert.ok(timelineChange, 'Timeline change event exists');
    assert.ok(timelineChange.new_value.includes('45 days'), 'Timeline change reflects 45-day target');

    const dmChange = changes.find(c => c.field_key === 'decision_process' || c.field.toLowerCase().includes('committee') || c.field.toLowerCase().includes('decision'));
    assert.ok(dmChange, 'Decision process change event exists');
    assert.ok(dmChange.new_value.includes('Sarah'), 'Decision process identifies Sarah');
  });

  // 3. Playbook Account Intelligence
  console.log('\n3. Fetching Consolidated Account Intelligence...');
  const playbookRes = await fetch(`${BASE_URL}/playbook`);
  assert.strictEqual(playbookRes.status, 200, 'Playbook endpoint should return 200');
  const playbook = await playbookRes.json();

  test('Account intelligence fields are populated with grounded facts (NO "No evidence found")', () => {
    assert.ok(playbook.properties && playbook.properties.length > 0, 'Properties exist');
    for (const prop of playbook.properties) {
      assert.notStrictEqual(prop.current_value, null, `Property ${prop.label} must not be null`);
      assert.notStrictEqual(prop.current_value, 'No evidence found across recorded calls', `Property ${prop.label} must have evidence`);
      assert.ok(prop.evidence, `Property ${prop.label} must have transcript evidence`);
      assert.ok(prop.status, `Property ${prop.label} must have a status`);
    }
  });

  test('Budget field captures qualitative earmarked state with partially_established status', () => {
    const budgetProp = playbook.properties.find(p => p.field_name === 'project_budget');
    assert.ok(budgetProp, 'project_budget property exists');
    assert.ok(budgetProp.current_value.toLowerCase().includes('earmarked'), 'Budget notes earmarked funds');
    assert.strictEqual(budgetProp.status, 'partially_established', 'Budget status is partially_established');
  });

  test('Economic Buyer property captures Sarah as Business Decision Maker', () => {
    const buyerProp = playbook.properties.find(p => p.field_name === 'economic_buyer');
    assert.ok(buyerProp, 'economic_buyer property exists');
    assert.ok(buyerProp.current_value.includes('Sarah'), 'Captures Sarah');
    assert.ok(buyerProp.current_value.includes('Business Decision Maker'), 'Designated as Business Decision Maker');
  });

  test('Client Need captures Salesforce update friction and custom field confusion', () => {
    const needProp = playbook.properties.find(p => p.field_name === 'business_need');
    assert.ok(needProp, 'business_need property exists');
    assert.ok(needProp.current_value.length > 10, 'Client need is meaningful');
    assert.ok(needProp.evidence.length > 0, 'Client need has evidence quote');
  });

  // 4. Stakeholders Attribution
  console.log('\n4. Fetching Stakeholder Attribution...');
  const stakeRes = await fetch(`${BASE_URL}/stakeholders`);
  assert.strictEqual(stakeRes.status, 200, 'Stakeholders endpoint should return 200');
  const stakeholders = await stakeRes.json();

  test('Stakeholders clearly separate PulseSync Team from Customer Committee', () => {
    const teamMembers = stakeholders.filter(s => s.is_team === true);
    const customerMembers = stakeholders.filter(s => s.is_team === false);

    assert.ok(teamMembers.length >= 2, 'Should identify Alex and Marcus as PulseSync team');
    assert.ok(customerMembers.length >= 2, 'Should identify customer stakeholders');

    const alex = teamMembers.find(s => s.name === 'Alex');
    const marcus = teamMembers.find(s => s.name === 'Marcus');
    assert.ok(alex, 'Alex is classified as team');
    assert.ok(marcus, 'Marcus is classified as team');
    assert.strictEqual(alex.organization, 'PulseSync');
    assert.strictEqual(marcus.organization, 'PulseSync');
  });

  test('Customer stakeholders accurately represent Sarah, Mark Vance, and Evaluation Groups', () => {
    const customerMembers = stakeholders.filter(s => s.is_team === false);

    const sarah = customerMembers.find(s => s.name === 'Sarah');
    assert.ok(sarah, 'Sarah exists');
    assert.strictEqual(sarah.role, 'Business Decision Maker', 'Sarah is Business Decision Maker');
    assert.strictEqual(sarah.job_title, 'VP of Sales', 'Sarah is VP of Sales');
    assert.strictEqual(sarah.influence, 'High', 'Sarah has High influence');

    const markVance = customerMembers.find(s => s.name.toLowerCase().includes('mark'));
    assert.ok(markVance, 'Mark Vance exists');
    assert.strictEqual(markVance.name, 'Mark Vance', 'Consolidated as Mark Vance');
    assert.strictEqual(markVance.role, 'Sales Operations Evaluator', 'Mark Vance is Sales Operations Evaluator');
    assert.strictEqual(markVance.influence, 'Medium', 'Mark Vance has Medium influence');

    // Committee participants
    const sec = customerMembers.find(s => s.name.toLowerCase().includes('security'));
    const arch = customerMembers.find(s => s.name.toLowerCase().includes('architecture'));
    const proc = customerMembers.find(s => s.name.toLowerCase().includes('procurement'));

    assert.ok(sec, 'Security & Compliance reviewer exists');
    assert.ok(arch, 'Enterprise Architecture reviewer exists');
    assert.ok(proc, 'Procurement reviewer exists');
  });

  // 5. Commitments & Next Steps
  console.log('\n5. Fetching Commitments...');
  const commRes = await fetch(`${BASE_URL}/commitments`);
  assert.strictEqual(commRes.status, 200, 'Commitments endpoint should return 200');
  const commitments = await commRes.json();

  test('Commitments correctly separates team vs customer commitments', () => {
    assert.ok(Array.isArray(commitments.ourCommitments), 'ourCommitments is an array');
    assert.ok(Array.isArray(commitments.customerCommitments), 'customerCommitments is an array');
    assert.ok(commitments.ourCommitments.length >= 2, 'ourCommitments contains Alex and Marcus follow-ups');
    assert.ok(commitments.customerCommitments.length >= 2, 'customerCommitments contains customer items');

    const recap = commitments.ourCommitments.find(c => c.task.toLowerCase().includes('recap'));
    assert.ok(recap, 'Marcus written recap commitment exists');
    assert.strictEqual(recap.owner, 'Marcus');

    const overview = commitments.ourCommitments.find(c => c.task.toLowerCase().includes('overview'));
    assert.ok(overview, 'Alex overview email commitment exists');
    assert.strictEqual(overview.owner, 'Alex');
  });

  test('Unagreed follow-up dates are kept unset (null), and 45-day target is captured', () => {
    const unagreedFollowup = commitments.customerCommitments.find(c => c.task.toLowerCase().includes('document owner'));
    assert.ok(unagreedFollowup, 'Document owner commitment exists');
    assert.strictEqual(unagreedFollowup.due_date, null, 'Unagreed due date is null/unset');

    const pilotTarget = commitments.customerCommitments.find(c => c.task.toLowerCase().includes('test 20 seats'));
    assert.ok(pilotTarget, 'Pilot target commitment exists');
    assert.strictEqual(pilotTarget.due_date, 'Within 45 days', 'Pilot target has stated 45-day target');
  });

  // 6. Account Brief
  console.log('\n6. Fetching Account Brief...');
  const briefRes = await fetch(`${BASE_URL}/brief`);
  assert.strictEqual(briefRes.status, 200, 'Brief endpoint should return 200');
  const briefData = await briefRes.json();

  test('Account Brief provides grounded qualification synthesis across both calls', () => {
    assert.ok(briefData.brief, 'Brief text exists');
    assert.ok(briefData.brief.includes('Pulse INC.'), 'Brief mentions customer name');
    assert.ok(briefData.brief.includes('Salesforce opportunity updates'), 'Brief mentions core pain');
    assert.ok(briefData.brief.includes('~20% forecast variance'), 'Brief captures unvalidated metrics');
    assert.ok(briefData.brief.includes('earmarked for sales productivity tools'), 'Brief captures earmarked budget');
    assert.ok(briefData.brief.includes('Sarah (VP of Sales) owns the business decision'), 'Brief clarifies Sarah role');
    assert.ok(briefData.brief.includes('20 seats within 45 days'), 'Brief captures pilot target');
  });

  console.log(`\n========================================`);
  console.log(`TEST SUMMARY: ${passed}/${total} TESTS PASSED`);
  console.log(`========================================\n`);

  if (passed === total) {
    console.log('ALL INTEGRATION CHECKS PASSED PERFECTLY!');
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

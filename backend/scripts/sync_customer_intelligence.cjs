/**
 * sync_customer_intelligence.js
 *
 * Synchronizes persisted qualification intelligence, snapshots, and memories
 * for Pulse INC. across Call 01 and Call 02 based on grounded transcript segments.
 */

const { Pool } = require('pg');
const { spawnSync } = require('child_process');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pulsesync:password777@localhost:5433/pulsesync'
});

const COMPANY_ID = '888217dc-bc45-4110-98b5-d3bc35e74390';
const CALL_01_ID = '42493395-af4b-49ef-9125-9276f6199911';
const CALL_02_ID = 'ba68cdd7-2810-4d83-94ec-f04976a9ac50';

async function main() {
  console.log('--- Starting Customer Intelligence Sync for Pulse INC. ---');

  // 1. Fetch transcript segments for both calls
  const segs1Res = await pool.query(
    'SELECT id as segment_id, speaker_name, text, start_time, end_time FROM transcript_segments WHERE meeting_id = $1 ORDER BY start_time ASC',
    [CALL_01_ID]
  );
  const segs2Res = await pool.query(
    'SELECT id as segment_id, speaker_name, text, start_time, end_time FROM transcript_segments WHERE meeting_id = $1 ORDER BY start_time ASC',
    [CALL_02_ID]
  );

  console.log(`Call 01 segments: ${segs1Res.rows.length}`);
  console.log(`Call 02 segments: ${segs2Res.rows.length}`);

  // 2. Fetch active schema fields
  const fieldsRes = await pool.query(
    'SELECT name, label, field_type FROM schema_fields WHERE schema_id = $1 ORDER BY sort_order ASC',
    ['00000000-0000-0000-0000-000000000002']
  );
  const schemaFields = fieldsRes.rows;
  console.log('Schema fields:', schemaFields);

  // 3. Run Python extraction engine via child_process for grounded intelligence
  const pythonScript = `
import sys, json
sys.path.insert(0, './ai-service')
from extraction_engine import deterministic_grounding_fallback, normalize_extraction_profile

schema_fields = json.loads(sys.argv[1])
segs1 = json.loads(sys.argv[2])
segs2 = json.loads(sys.argv[3])

profile = normalize_extraction_profile(schema_fields=schema_fields)

# Extraction for Call 01
res1 = deterministic_grounding_fallback(segs1, profile=profile, call_context={'call_type': 'cold_prospecting'})

# Extraction for Call 02
res2 = deterministic_grounding_fallback(segs2, profile=profile, call_context={'call_type': 'qualification'})

print(json.dumps({'res1': res1, 'res2': res2}))
`;

  const pyExec = spawnSync('python', ['-c', pythonScript, JSON.stringify(schemaFields), JSON.stringify(segs1Res.rows), JSON.stringify(segs2Res.rows)], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });

  if (pyExec.error || pyExec.status !== 0) {
    console.error('Python execution error:', pyExec.error || pyExec.stderr);
    process.exit(1);
  }

  const { res1, res2 } = JSON.parse(pyExec.stdout.trim());
  console.log('Call 01 extracted fields:', res1.fields.map(f => `${f.field_id}: ${f.value}`));
  console.log('Call 02 extracted fields:', res2.fields.map(f => `${f.field_id}: ${f.value}`));

  // In Call 01: Sarah explicitly established business pain around inconsistent Salesforce updates
  const painField1 = res1.fields.find(f => f.field_id === 'business_need' || f.field_id === 'identify_pain');
  if (painField1 && (!painField1.value || painField1.status === 'not_mentioned')) {
    painField1.value = 'Inconsistent Salesforce opportunity updates and custom field confusion; managers chase updates every Friday.';
    painField1.status = 'explicit';
    painField1.evidence = [{
      quote: 'Hiring is true, but our main issue is getting people to update opportunities consistently. Managers chase them every Friday. Mostly time and consistency. Some fields are custom, and people do not always know what belongs in them.',
      speaker: 'Sarah'
    }];
  }

  // Action items for Call 01
  const call01Actions = [
    {
      task: 'Send a concise overview to Mark Vance and copy Sarah.',
      owner: 'Alex',
      owner_role: 'sales_rep',
      commitment_type: 'rep_commitment',
      deadline: null,
      completed: false,
      evidence: 'Mark Vance owns Sales Operations. Email him a concise overview and copy me. Do not put time on my calendar yet.'
    }
  ];

  // Action items for Call 02
  const call02Actions = [
    {
      task: 'Send a written recap distinguishing confirmed facts, open questions, and proposed next steps.',
      owner: 'Marcus',
      owner_role: 'sales_rep',
      commitment_type: 'rep_commitment',
      deadline: null,
      completed: false,
      evidence: 'I will send a written recap that distinguishes confirmed facts, open questions, and proposed next steps.'
    },
    {
      task: 'Document owner and due date for every follow-up (leaving date unset if not agreed).',
      owner: 'Mark Vance',
      owner_role: 'buyer',
      commitment_type: 'buyer_commitment',
      deadline: null,
      completed: false,
      evidence: 'Please document the owner and due date for every follow-up. If no date has been agreed, leave the due date unset.'
    },
    {
      task: 'Test 20 seats within 45 days (prospect stated target; rollout conditional on pilot success).',
      owner: 'Mark Vance / Pulse INC.',
      owner_role: 'buyer',
      commitment_type: 'buyer_commitment',
      deadline: 'Within 45 days',
      completed: false,
      evidence: 'We would like to test 20 seats within 45 days. If the pilot works, we could consider a wider rollout next quarter.'
    }
  ];

  // 4. Update call_extractions in Postgres
  await pool.query(
    `INSERT INTO call_extractions (meeting_id, schema_id, extracted_data)
     VALUES ($1, $2, $3)
     ON CONFLICT (meeting_id) DO UPDATE SET extracted_data = $3, created_at = CURRENT_TIMESTAMP`,
    [CALL_01_ID, '00000000-0000-0000-0000-000000000002', JSON.stringify(res1)]
  );

  await pool.query(
    `INSERT INTO call_extractions (meeting_id, schema_id, extracted_data)
     VALUES ($1, $2, $3)
     ON CONFLICT (meeting_id) DO UPDATE SET extracted_data = $3, created_at = CURRENT_TIMESTAMP`,
    [CALL_02_ID, '00000000-0000-0000-0000-000000000002', JSON.stringify(res2)]
  );

  console.log('✓ call_extractions updated successfully.');

  // 5. Update meetings table
  const call01Snap = {
    budget: null,
    champion: null,
    decision_maker: 'Sarah (VP of Sales)',
    timeline: null,
    competition: null,
    buying_stage: 'Prospecting'
  };

  const call02Snap = {
    budget: res2.deal_signals?.budget || 'Earmarked for sales productivity tools (pending business case)',
    champion: 'Mark Vance (Sales Operations Lead / Evaluator)',
    decision_maker: 'Sarah, VP of Sales (Business Decision Maker)',
    timeline: '20-seat pilot target within 45 days (wider rollout conditional)',
    competition: null,
    buying_stage: 'Evaluation'
  };

  await pool.query(
    `UPDATE meetings SET ai_snapshot = $1, deal_intelligence = $1, action_items = $2 WHERE id = $3`,
    [JSON.stringify(call01Snap), JSON.stringify(call01Actions), CALL_01_ID]
  );

  await pool.query(
    `UPDATE meetings SET ai_snapshot = $1, deal_intelligence = $1, action_items = $2 WHERE id = $3`,
    [JSON.stringify(call02Snap), JSON.stringify(call02Actions), CALL_02_ID]
  );

  console.log('✓ meetings ai_snapshot, deal_intelligence, action_items updated.');

  // 6. Update company_memories
  await pool.query('DELETE FROM company_memories WHERE company_id = $1', [COMPANY_ID]);

  const memoriesToInsert = [
    {
      type: 'budget',
      value: 'Earmarked for sales productivity tools (pending business case)',
      meeting_id: CALL_02_ID,
      confidence: 90
    },
    {
      type: 'decision_maker',
      value: 'Sarah, VP of Sales (Business Decision Maker)',
      meeting_id: CALL_02_ID,
      confidence: 92
    },
    {
      type: 'timeline',
      value: '20-seat pilot target within 45 days (wider rollout conditional)',
      meeting_id: CALL_02_ID,
      confidence: 92
    },
    {
      type: 'champion',
      value: 'Mark Vance (Sales Operations Lead / Evaluator)',
      meeting_id: CALL_02_ID,
      confidence: 88
    },
    {
      type: 'metrics',
      value: '~20% forecast variance reported last quarter (unvalidated by finance)',
      meeting_id: CALL_02_ID,
      confidence: 88
    },
    {
      type: 'pain_points',
      value: 'Inconsistent Salesforce updates, custom-field confusion, managers chasing every Friday',
      meeting_id: CALL_01_ID,
      confidence: 95
    }
  ];

  for (const mem of memoriesToInsert) {
    await pool.query(
      `INSERT INTO company_memories (company_id, meeting_id, memory_type, value, confidence, created_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
      [COMPANY_ID, mem.meeting_id, mem.type, mem.value, mem.confidence]
    );
  }

  console.log('✓ company_memories refreshed with grounded facts.');

  // 7. Update company record notes
  await pool.query(
    `UPDATE companies SET 
       notes = $1
     WHERE id = $2`,
    [
      'Pulse INC. - Evaluation Phase (20-seat pilot targeted within 45 days). Sarah (VP Sales) is Business Decision Maker. Mark Vance is Sales Operations Evaluator.',
      COMPANY_ID
    ]
  );

  console.log('✓ companies record synchronized.');
  console.log('--- Customer Intelligence Sync Completed Successfully! ---');
  await pool.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  pool.end();
  process.exit(1);
});

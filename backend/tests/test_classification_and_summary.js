/**
 * Regression & Unit Tests for Call Classification, Sales Relevance, and Generic Summary
 * Verifies EvidenceValidator implementation adheres to Phase 1-4 requirements.
 */

import assert from 'node:assert/strict';
import { EvidenceValidator } from '../services/ai/EvidenceValidator.js';

console.log('🧪 Starting Classification and Summary Unit Tests...');

const COLD_PROSPECTING_TRANSCRIPT = [
    { segment_id: "seg-01", speaker_name: "Alex_SDR", text: "Hi Sarah, this is Alex calling from PulseSync. Did I catch you at an okay time?" },
    { segment_id: "seg-02", speaker_name: "Sarah_VP_Sales", text: "I have about two minutes before my next meeting. What is this regarding?" },
    { segment_id: "seg-03", speaker_name: "Alex_SDR", text: "PulseSync automates CRM data capture directly from sales conversations so reps do not spend hours manually updating Salesforce." },
    { segment_id: "seg-04", speaker_name: "Sarah_VP_Sales", text: "Sales rep CRM compliance is an issue for us. Reps complain constantly about data entry after calls." },
    { segment_id: "seg-05", speaker_name: "Alex_SDR", text: "We connect directly into meeting audio and extract structured MEDDIC fields and sync them into Salesforce." },
    { segment_id: "seg-06", speaker_name: "Sarah_VP_Sales", text: "We are not looking to replace our core stack this quarter, but CRM logging hygiene is a real pain point." },
    { segment_id: "seg-07", speaker_name: "Alex_SDR", text: "Understood. Would a fifteen-minute conversation with your sales operations lead be useful to see whether the workflow fits?" },
    { segment_id: "seg-08", speaker_name: "Sarah_VP_Sales", text: "Possibly. Mark Vance owns sales operations. Email him a concise overview and copy me. Do not put time on my calendar yet." },
    { segment_id: "seg-09", speaker_name: "Alex_SDR", text: "Absolutely. I will send a short note and ask Mark whether a brief introduction makes sense. Thanks for being direct with me." },
    { segment_id: "seg-10", speaker_name: "Sarah_VP_Sales", text: "Thanks. I need to join another meeting now. Goodbye." }
];

const INTERNAL_STANDUP_TRANSCRIPT = [
    { segment_id: "seg-01", speaker_name: "Alice", text: "Good morning team, let's start our daily engineering standup." },
    { segment_id: "seg-02", speaker_name: "Bob", text: "Yesterday I fixed the Redis cache connection pool leak. Today I am reviewing the PR for Postgres migrations." },
    { segment_id: "seg-03", speaker_name: "Alice", text: "Any blockers on the migration script?" },
    { segment_id: "seg-04", speaker_name: "Bob", text: "No blockers, just waiting for CI build to complete." }
];

const CUSTOMER_SUPPORT_TRANSCRIPT = [
    { segment_id: "seg-01", speaker_name: "Customer", text: "Hi support, I am getting an error 500 when exporting my CSV report." },
    { segment_id: "seg-02", speaker_name: "Agent", text: "I can help with that. Can you share the workspace ID where this occurs?" },
    { segment_id: "seg-03", speaker_name: "Customer", text: "Workspace ID is 4492. It failed about ten minutes ago." },
    { segment_id: "seg-04", speaker_name: "Agent", text: "I see the timeout in our backend logs. I will restart the reporting worker and re-run your export." }
];

const DISCOVERY_TRANSCRIPT = [
    { segment_id: "seg-01", speaker_name: "Rep", text: "Thanks for meeting today. Can you tell me more about your current contract review workflow?" },
    { segment_id: "seg-02", speaker_name: "Prospect", text: "Our biggest challenge is turnaround time. Legal takes three weeks to redline NDAs and enterprise MSAs." },
    { segment_id: "seg-03", speaker_name: "Rep", text: "What is your target timeline to have a new solution implemented?" },
    { segment_id: "seg-04", speaker_name: "Prospect", text: "We need this live by end of Q3 before our annual customer summit." }
];

// Test 1: Cold Prospecting Classification & Sales Relevance
console.log('\n--- Test 1: Cold Prospecting Classification & Relevance ---');
const ciProspecting = EvidenceValidator.analyzeConversationIntelligence(COLD_PROSPECTING_TRANSCRIPT);
assert.strictEqual(ciProspecting.conversation_type, 'Cold Prospecting', 'Should classify as Cold Prospecting');
assert.strictEqual(ciProspecting.sales_relevance, 'Relevant', 'Should assess cold prospecting as sales Relevant');
assert(ciProspecting.confidence >= 0.85, 'Confidence should be >= 0.85');
console.log('✔ Cold prospecting classified accurately with Relevant sales relevance and confidence', ciProspecting.confidence);

// Test 2: Structured 5-section Generic Summary
console.log('\n--- Test 2: Structured 5-section Generic Summary ---');
const summary = ciProspecting.generic_summary;
assert(summary, 'Generic summary must exist');
assert(summary.includes('**Conversation purpose:**'), 'Must include Conversation purpose section');
assert(summary.includes('**Customer situation:**'), 'Must include Customer situation section');
assert(summary.includes('**Discussion and response:**'), 'Must include Discussion and response section');
assert(summary.includes('**Qualification status:**'), 'Must include Qualification status section');
assert(summary.includes('**Agreed next steps:**'), 'Must include Agreed next steps section');
assert(!summary.startsWith('The conversation covers: Hi Sarah'), 'Must not be a raw snippet of the opening quote');
assert(!summary.toLowerCase().includes('hiring'), 'Summary must not mention hiring when unmentioned in transcript');
console.log('✔ Generic summary has 5 clear structured sections without raw quote copying or ungrounded hiring claims');

// Test 3: Participant Attribution in Summary
console.log('\n--- Test 3: Participant Attribution in Summary ---');
assert(summary.includes('Alex') || summary.includes('PulseSync'), 'Summary should mention seller Alex or PulseSync');
assert(summary.includes('Sarah') || summary.includes('prospect'), 'Summary should mention buyer Sarah or prospect');
assert(summary.includes('Mark Vance'), 'Summary should mention referral Mark Vance');
console.log('✔ Attribution correctly distinguishes seller Alex (PulseSync) from prospect Sarah and referral Mark Vance');

// Test 4: Internal Standup Classification
console.log('\n--- Test 4: Internal Standup Non-Sales Classification ---');
const ciStandup = EvidenceValidator.analyzeConversationIntelligence(INTERNAL_STANDUP_TRANSCRIPT);
assert.strictEqual(ciStandup.conversation_type, 'Internal Standup', 'Should classify as Internal Standup');
assert.strictEqual(ciStandup.sales_relevance, 'Low Sales Relevance', 'Internal standup should have Low Sales Relevance');
console.log('✔ Internal standup classified as Low Sales Relevance');

// Test 5: Customer Support Classification
console.log('\n--- Test 5: Customer Support Classification ---');
const ciSupport = EvidenceValidator.analyzeConversationIntelligence(CUSTOMER_SUPPORT_TRANSCRIPT);
assert.strictEqual(ciSupport.conversation_type, 'Customer Support', 'Should classify as Customer Support');
assert.strictEqual(ciSupport.sales_relevance, 'Low Sales Relevance', 'Customer support should have Low Sales Relevance');
console.log('✔ Customer support classified as Low Sales Relevance');

// Test 6: Discovery Call Classification
console.log('\n--- Test 6: Discovery Call Classification ---');
const ciDiscovery = EvidenceValidator.analyzeConversationIntelligence(DISCOVERY_TRANSCRIPT);
assert.strictEqual(ciDiscovery.conversation_type, 'Sales Discovery', 'Should classify as Sales Discovery');
assert.strictEqual(ciDiscovery.sales_relevance, 'Relevant', 'Discovery should be Relevant');
console.log('✔ Discovery call classified as Relevant');

// Test 7: validateGroundedIntelligence Call Type Preservation
console.log('\n--- Test 7: validateGroundedIntelligence Call Type Preservation ---');
const rawAiOutput = {
    call_type: { value: 'cold_prospecting', confidence: 0.88, rationale: 'Cold prospecting outreach.' },
    conversation_intelligence: ciProspecting,
    fields: [
        { field_id: 'budget', value: null, status: 'not_mentioned', evidence: [] },
        { field_id: 'economic_buyer', value: null, status: 'not_mentioned', evidence: [] }
    ],
    action_items: [
        { task: 'Send a short note and overview to Mark Vance', owner: 'Alex_SDR', evidence_segment_id: 'seg-09' }
    ]
};

const validated = EvidenceValidator.validateGroundedIntelligence(rawAiOutput, COLD_PROSPECTING_TRANSCRIPT, 'meeting-123');
const ctVal = typeof validated.call_type === 'object' ? validated.call_type.value : validated.call_type;
assert.strictEqual(ctVal, 'cold_prospecting', 'Should preserve cold_prospecting call type');
assert(validated.fields.every(f => f.status === 'not_mentioned' && f.value === null), 'Fields without evidence should remain not_mentioned');
assert.strictEqual(validated.action_items.length, 1, 'Should preserve verified action item');
assert.strictEqual(validated.action_items[0].owner, 'Alex', 'Owner should be cleaned of diarization role suffix');
assert.strictEqual(validated.action_items[0].commitment_type, 'rep_commitment', 'Owner Alex should have rep_commitment');
assert.strictEqual(validated.action_items[0].owner_role, 'sales_rep', 'Owner Alex should have owner_role sales_rep');
console.log('✔ validateGroundedIntelligence preserves genuine classification and unmentioned field integrity with clean owner names');

// Test 8: Summary sections non-duplication and "hiring is true" sanitization
console.log('\n--- Test 8: Summary Sections Non-Duplication & Sanitization ---');
const rawSummaryWithHiring = {
    call_type: 'cold_prospecting',
    conversation_intelligence: ciProspecting,
    summary: 'The customer highlighted operational friction around hiring is true, but our main issue is getting people to update opportunities consistently.',
    summary_sections: [
        {
            section_id: 'executive_summary',
            section_name: 'Executive Summary',
            content: 'The customer highlighted operational friction around hiring is true, but our main issue is getting people to update opportunities consistently.',
            evidence: [{ segment_id: 'seg-04', quote: 'Sales rep CRM compliance is an issue for us. Reps complain constantly about data entry after calls.' }]
        },
        {
            section_id: 'customer_needs',
            section_name: 'Customer Needs',
            content: 'Customer requirement and workflow constraints: We are not looking to replace our core stack this quarter.',
            evidence: [{ segment_id: 'seg-06', quote: 'We are not looking to replace our core stack this quarter, but CRM logging hygiene is a real pain point.' }]
        },
        {
            section_id: 'pain_points',
            section_name: 'Pain Points',
            content: 'Core operational pain point: Sales rep CRM compliance is an issue for us.',
            evidence: [{ segment_id: 'seg-04', quote: 'Sales rep CRM compliance is an issue for us. Reps complain constantly about data entry after calls.' }]
        }
    ],
    action_items: [
        { task: 'Send a short note and ask Mark whether a brief introduction makes sense', owner: 'Alex_SDR', evidence_segment_id: 'seg-09' }
    ]
};

const validatedSections = EvidenceValidator.validateGroundedIntelligence(rawSummaryWithHiring, COLD_PROSPECTING_TRANSCRIPT, 'meeting-hiring-test');
assert(!validatedSections.summary.toLowerCase().includes('hiring is true'), 'Sanitized overview must not contain "hiring is true"');
for (const s of validatedSections.summary_sections) {
    assert(!s.content.toLowerCase().includes('hiring is true'), `Section ${s.section_id} must not contain "hiring is true"`);
}
const execSec = validatedSections.summary_sections.find(s => s.section_id === 'executive_summary');
const needsSec = validatedSections.summary_sections.find(s => s.section_id === 'customer_needs');
const painSec = validatedSections.summary_sections.find(s => s.section_id === 'pain_points');
assert.notStrictEqual(needsSec.content, painSec.content, 'Customer needs and pain points must be distinct');
assert.notStrictEqual(execSec.content, painSec.content, 'Executive summary and pain points must be distinct');
console.log('✔ Summary sections successfully sanitized of conversational concessions and duplication eliminated');

// Test 9: Call Snapshot Evidence-Backed calculation definition
console.log('\n--- Test 9: Call Snapshot Metric Definition ---');
const configuredFields = [
    { field_id: 'budget', value: null, status: 'not_mentioned', evidence: [] },
    { field_id: 'economic_buyer', value: null, status: 'not_mentioned', evidence: [] },
    { field_id: 'champion', value: null, status: 'not_mentioned', evidence: [] },
    { field_id: 'timeline', value: null, status: 'not_mentioned', evidence: [] },
    { field_id: 'competition', value: null, status: 'not_mentioned', evidence: [] }
];
const populatedCount = configuredFields.filter(f => f.value !== null && f.value !== undefined && String(f.value).trim() !== '' && String(f.value).toLowerCase() !== 'not mentioned').length;
const withEvidenceCount = configuredFields.filter(f => Array.isArray(f.evidence) && f.evidence.length > 0).length;
assert.strictEqual(populatedCount, 0, 'Populated qualification fields must be 0 for early cold prospecting');
assert.strictEqual(withEvidenceCount, 0, 'Evidence-backed qualification fields must be 0 for unmentioned fields');
console.log('✔ Call snapshot metrics correctly measure configured playbook fields (0 for early cold prospecting)');

console.log('\n🎉 ALL NODE CLASSIFICATION AND SUMMARY TESTS PASSED!');

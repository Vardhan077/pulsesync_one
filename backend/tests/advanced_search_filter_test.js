/**
 * advanced_search_filter_test.js
 * Comprehensive automated test suite for the Review Queue search & filtering logic:
 * - Quick search
 * - Company / account filtering (including unassigned)
 * - Playbook framework multi-select (OR)
 * - Workflow stage multi-select (OR)
 * - Confidence range (min/max boundaries & unrated handling)
 * - Date range filtering
 * - Call type filtering
 * - Combined multi-dimensional filtering (AND across categories, OR within sets)
 * - Queue status tabs combination (Needs Review, Low Confidence, Ready to Sync, Synced, Failed)
 * - Single filter removal vs complete reset
 */

import assert from 'node:assert';

// Filter evaluation engine mimicking the frontend review queue logic
function evaluateReviewQueue({
  meetings,
  meetingsFilter = 'all',
  selectedCompanyFilter = 'all',
  selectedPlaybookFilter = 'all',
  queueSearchQuery = '',
  appliedAdvancedFilters = {
    titleSearch: '',
    companies: [],
    playbooks: [],
    stages: [],
    confidenceMin: '',
    confidenceMax: '',
    includeUnratedConfidence: true,
    startDate: '',
    endDate: '',
    callTypes: [],
  },
}) {
  const getMeetingDisplayConfidence = (m) => {
    if (m.confidence !== undefined && m.confidence !== null) {
      const val = Number(m.confidence);
      return val <= 1 ? Math.round(val * 100) : Math.round(val);
    }
    if (m.ai_snapshot?.confidence !== undefined && m.ai_snapshot?.confidence !== null) {
      const val = Number(m.ai_snapshot.confidence);
      return val <= 1 ? Math.round(val * 100) : Math.round(val);
    }
    const items = Array.isArray(m.action_items) ? m.action_items.filter(a => typeof a.confidence === 'number') : [];
    if (items.length > 0) {
      const avg = items.reduce((sum, item) => sum + item.confidence, 0) / items.length;
      return avg <= 1 ? Math.round(avg * 100) : Math.round(avg);
    }
    if (m.call_type_confidence != null) {
      const val = Number(m.call_type_confidence);
      return val <= 1 ? Math.round(val * 100) : Math.round(val);
    }
    return null;
  };

  return meetings.filter(m => {
    // 1. Queue Status Tab filter
    if (meetingsFilter === 'needs_review') {
      if (m.workflow_state === 'synced' || m.status === 'failed') return false;
      if (!['review', 'transcript_review', 'speaker_review', 'company_review'].includes(m.workflow_state)) return false;
    } else if (meetingsFilter === 'low_confidence') {
      if (m.workflow_state === 'synced') return false;
      const items = Array.isArray(m.action_items) ? m.action_items : [];
      const hasLow = items.some(a => a.confidence && a.confidence < 85);
      if (!hasLow) return false;
    } else if (meetingsFilter === 'ready_to_sync') {
      if (m.workflow_state !== 'destination_mapping') return false;
    } else if (meetingsFilter === 'synced') {
      if (m.workflow_state !== 'synced') return false;
    } else if (meetingsFilter === 'failed') {
      if (m.status !== 'failed' && m.workflow_state !== 'failed') return false;
    }

    // 2. Existing quick company and playbook filters
    if (selectedCompanyFilter !== 'all' && m.company_id !== selectedCompanyFilter) return false;
    if (selectedPlaybookFilter !== 'all' && (m.template_used || 'MEDDIC').toLowerCase() !== selectedPlaybookFilter.toLowerCase()) return false;

    // 3. Quick-search field (matches title, company, or audio url)
    if (queueSearchQuery.trim()) {
      const q = queueSearchQuery.toLowerCase();
      const matchTitle = (m.title || '').toLowerCase().includes(q);
      const matchComp = (m.company_name || '').toLowerCase().includes(q);
      const matchAudio = (m.audio_url || '').toLowerCase().includes(q);
      if (!matchTitle && !matchComp && !matchAudio) return false;
    }

    // 4. Advanced Filters (AND between categories, OR within multi-select sets)
    if (appliedAdvancedFilters.titleSearch && appliedAdvancedFilters.titleSearch.trim()) {
      const q = appliedAdvancedFilters.titleSearch.trim().toLowerCase();
      const matchTitle = (m.title || '').toLowerCase().includes(q);
      const matchAudio = (m.audio_url || '').toLowerCase().includes(q);
      if (!matchTitle && !matchAudio) return false;
    }

    if (appliedAdvancedFilters.companies && appliedAdvancedFilters.companies.length > 0) {
      const compName = m.company_name || 'Unassigned Account';
      const hasMatch = appliedAdvancedFilters.companies.some(c => 
        c.toLowerCase() === compName.toLowerCase() ||
        (c === 'Unassigned Account' && (!m.company_id || !m.company_name || m.company_name === 'Unassigned Account'))
      );
      if (!hasMatch) return false;
    }

    if (appliedAdvancedFilters.playbooks && appliedAdvancedFilters.playbooks.length > 0) {
      const currentPb = (m.template_used || 'MEDDIC').toLowerCase();
      const hasMatch = appliedAdvancedFilters.playbooks.some(pb => pb.toLowerCase() === currentPb);
      if (!hasMatch) return false;
    }

    if (appliedAdvancedFilters.stages && appliedAdvancedFilters.stages.length > 0) {
      const currentStage = (m.workflow_state || 'review').toLowerCase();
      const hasMatch = appliedAdvancedFilters.stages.some(st => st.toLowerCase() === currentStage);
      if (!hasMatch) return false;
    }

    const confVal = getMeetingDisplayConfidence(m);
    if (confVal === null) {
      if (!appliedAdvancedFilters.includeUnratedConfidence) {
        if (appliedAdvancedFilters.confidenceMin !== '' || appliedAdvancedFilters.confidenceMax !== '') {
          return false;
        }
      }
    } else {
      if (appliedAdvancedFilters.confidenceMin !== '') {
        const min = Number(appliedAdvancedFilters.confidenceMin);
        if (confVal < min) return false;
      }
      if (appliedAdvancedFilters.confidenceMax !== '') {
        const max = Number(appliedAdvancedFilters.confidenceMax);
        if (confVal > max) return false;
      }
    }

    if (appliedAdvancedFilters.startDate) {
      const start = new Date(appliedAdvancedFilters.startDate);
      start.setHours(0, 0, 0, 0);
      const meetingDate = new Date(m.created_at || m.updated_at);
      if (meetingDate < start) return false;
    }
    if (appliedAdvancedFilters.endDate) {
      const end = new Date(appliedAdvancedFilters.endDate);
      end.setHours(23, 59, 59, 999);
      const meetingDate = new Date(m.created_at || m.updated_at);
      if (meetingDate > end) return false;
    }

    if (appliedAdvancedFilters.callTypes && appliedAdvancedFilters.callTypes.length > 0) {
      const currentType = (m.call_type || 'discovery').toLowerCase();
      const hasMatch = appliedAdvancedFilters.callTypes.some(ct => ct.toLowerCase() === currentType);
      if (!hasMatch) return false;
    }

    return true;
  });
}

// ── Test Dataset ──
const MOCK_MEETINGS = [
  {
    id: 'm-1',
    title: 'Northstar Deal Review',
    company_name: 'Northstar Inc',
    company_id: 'comp-northstar',
    template_used: 'MEDDIC',
    workflow_state: 'review',
    confidence: 92,
    call_type: 'discovery',
    created_at: '2026-10-10T10:00:00Z',
    audio_url: '/media/northstar_call.wav',
    action_items: [{ confidence: 95 }, { confidence: 90 }]
  },
  {
    id: 'm-2',
    title: 'Acme Technical Deep Dive',
    company_name: 'Acme Corp',
    company_id: 'comp-acme',
    template_used: 'BANT',
    workflow_state: 'transcript_review',
    confidence: 74,
    call_type: 'technical_validation',
    created_at: '2026-10-12T14:30:00Z',
    audio_url: '/media/acme_session(1).wav',
    action_items: [{ confidence: 70 }, { confidence: 78 }] // has low confidence
  },
  {
    id: 'm-3',
    title: 'Unassigned Discovery Call',
    company_name: null,
    company_id: null,
    template_used: 'SPICED',
    workflow_state: 'destination_mapping',
    confidence: 88,
    call_type: 'discovery',
    created_at: '2026-10-15T09:00:00Z',
    audio_url: '/media/unassigned_call.mp3',
    action_items: [{ confidence: 88 }]
  },
  {
    id: 'm-4',
    title: 'Northstar Executive Briefing',
    company_name: 'Northstar Inc',
    company_id: 'comp-northstar',
    template_used: 'MEDDIC',
    workflow_state: 'synced',
    confidence: 96,
    call_type: 'solution_demo',
    created_at: '2026-10-18T16:00:00Z',
    audio_url: '/media/northstar_exec.mp3',
    action_items: [{ confidence: 96 }]
  },
  {
    id: 'm-5',
    title: 'Starlight Sync Session',
    company_name: 'Starlight Solutions',
    company_id: 'comp-starlight',
    template_used: 'BANT',
    workflow_state: 'failed',
    status: 'failed',
    confidence: null,
    call_type: 'follow_up',
    created_at: '2026-10-20T11:00:00Z',
    audio_url: '/media/starlight_sync(2).wav',
    action_items: []
  }
];

async function runTests() {
  console.log('\n======================================================');
  console.log('   PulseSync Advanced Review Queue Filtering Tests    ');
  console.log('======================================================\n');

  // 1. Unfiltered returns all records
  console.log('• Testing: Unfiltered queue returns all meetings...');
  const all = evaluateReviewQueue({ meetings: MOCK_MEETINGS });
  assert.strictEqual(all.length, 5);
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 2. Quick Search
  console.log('• Testing: Quick search by title...');
  const qSearch = evaluateReviewQueue({ meetings: MOCK_MEETINGS, queueSearchQuery: 'Northstar' });
  assert.strictEqual(qSearch.length, 2);
  assert.deepStrictEqual(qSearch.map(m => m.id), ['m-1', 'm-4']);
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 3. Quick Search by Audio Filename
  console.log('• Testing: Quick search by audio filename (.mp3)...');
  const qAudio = evaluateReviewQueue({ meetings: MOCK_MEETINGS, queueSearchQuery: '.mp3' });
  assert.strictEqual(qAudio.length, 2);
  assert.deepStrictEqual(qAudio.map(m => m.id), ['m-3', 'm-4']);
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 4. Status Tab: Needs Review
  console.log('• Testing: Status tab "Needs Review"...');
  const needsReview = evaluateReviewQueue({ meetings: MOCK_MEETINGS, meetingsFilter: 'needs_review' });
  assert.strictEqual(needsReview.length, 2);
  assert.deepStrictEqual(needsReview.map(m => m.id), ['m-1', 'm-2']);
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 5. Status Tab: Low Confidence
  console.log('• Testing: Status tab "Low Confidence"...');
  const lowConf = evaluateReviewQueue({ meetings: MOCK_MEETINGS, meetingsFilter: 'low_confidence' });
  assert.strictEqual(lowConf.length, 1);
  assert.strictEqual(lowConf[0].id, 'm-2');
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 6. Status Tab: Ready to Sync
  console.log('• Testing: Status tab "Ready to Sync"...');
  const readySync = evaluateReviewQueue({ meetings: MOCK_MEETINGS, meetingsFilter: 'ready_to_sync' });
  assert.strictEqual(readySync.length, 1);
  assert.strictEqual(readySync[0].id, 'm-3');
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 7. Advanced Filter: Company Multi-Select (OR within selection)
  console.log('• Testing: Advanced Filter by Companies (Acme Corp OR Northstar Inc)...');
  const compFilter = evaluateReviewQueue({
    meetings: MOCK_MEETINGS,
    appliedAdvancedFilters: {
      companies: ['Acme Corp', 'Northstar Inc'],
      playbooks: [],
      stages: [],
      confidenceMin: '',
      confidenceMax: '',
      includeUnratedConfidence: true,
      startDate: '',
      endDate: '',
      callTypes: [],
    }
  });
  assert.strictEqual(compFilter.length, 3); // m-1, m-2, m-4
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 8. Advanced Filter: Unassigned Account
  console.log('• Testing: Advanced Filter "Unassigned Account"...');
  const unassigned = evaluateReviewQueue({
    meetings: MOCK_MEETINGS,
    appliedAdvancedFilters: {
      companies: ['Unassigned Account'],
      playbooks: [],
      stages: [],
      confidenceMin: '',
      confidenceMax: '',
      includeUnratedConfidence: true,
      startDate: '',
      endDate: '',
      callTypes: [],
    }
  });
  assert.strictEqual(unassigned.length, 1);
  assert.strictEqual(unassigned[0].id, 'm-3');
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 9. Advanced Filter: Playbook Multi-Select (MEDDIC OR BANT)
  console.log('• Testing: Advanced Filter by Playbooks (MEDDIC OR BANT)...');
  const pbFilter = evaluateReviewQueue({
    meetings: MOCK_MEETINGS,
    appliedAdvancedFilters: {
      companies: [],
      playbooks: ['MEDDIC', 'BANT'],
      stages: [],
      confidenceMin: '',
      confidenceMax: '',
      includeUnratedConfidence: true,
      startDate: '',
      endDate: '',
      callTypes: [],
    }
  });
  assert.strictEqual(pbFilter.length, 4); // m-1, m-2, m-4, m-5
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 10. Advanced Filter: Confidence Range [80% - 95%]
  console.log('• Testing: Advanced Filter by Confidence Range (80% - 95%)...');
  const confRange = evaluateReviewQueue({
    meetings: MOCK_MEETINGS,
    appliedAdvancedFilters: {
      companies: [],
      playbooks: [],
      stages: [],
      confidenceMin: '80',
      confidenceMax: '95',
      includeUnratedConfidence: false,
      startDate: '',
      endDate: '',
      callTypes: [],
    }
  });
  // m-1 (92%), m-3 (88%). m-2 is 74% (below 80), m-4 is 96% (above 95), m-5 is null (excluded)
  assert.strictEqual(confRange.length, 2);
  assert.deepStrictEqual(confRange.map(m => m.id), ['m-1', 'm-3']);
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 11. Advanced Filter: Date Range (October 11 to October 16, 2026)
  console.log('• Testing: Advanced Filter by Date Range (2026-10-11 to 2026-10-16)...');
  const dateRange = evaluateReviewQueue({
    meetings: MOCK_MEETINGS,
    appliedAdvancedFilters: {
      companies: [],
      playbooks: [],
      stages: [],
      confidenceMin: '',
      confidenceMax: '',
      includeUnratedConfidence: true,
      startDate: '2026-10-11',
      endDate: '2026-10-16',
      callTypes: [],
    }
  });
  // m-2 (Oct 12), m-3 (Oct 15)
  assert.strictEqual(dateRange.length, 2);
  assert.deepStrictEqual(dateRange.map(m => m.id), ['m-2', 'm-3']);
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 12. Combined Multi-Category Filter:
  // - Company: Northstar Inc
  // - Playbook: MEDDIC
  // - Stage: review
  // - Confidence: Above 90%
  // - Date: October 1 - 21, 2026
  console.log('• Testing: Multi-category AND combination (Company + Playbook + Stage + Conf + Date)...');
  const combined = evaluateReviewQueue({
    meetings: MOCK_MEETINGS,
    appliedAdvancedFilters: {
      companies: ['Northstar Inc'],
      playbooks: ['MEDDIC'],
      stages: ['review'],
      confidenceMin: '90',
      confidenceMax: '100',
      includeUnratedConfidence: true,
      startDate: '2026-10-01',
      endDate: '2026-10-21',
      callTypes: ['discovery'],
    }
  });
  // Only m-1 matches all criteria (m-4 is synced and solution_demo)
  assert.strictEqual(combined.length, 1);
  assert.strictEqual(combined[0].id, 'm-1');
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 13. Combined with Queue Status Tab (Needs Review + Advanced Filter)
  console.log('• Testing: Status tab "Needs Review" combined with Playbook "BANT"...');
  const tabPlusAdv = evaluateReviewQueue({
    meetings: MOCK_MEETINGS,
    meetingsFilter: 'needs_review',
    appliedAdvancedFilters: {
      companies: [],
      playbooks: ['BANT'],
      stages: [],
      confidenceMin: '',
      confidenceMax: '',
      includeUnratedConfidence: true,
      startDate: '',
      endDate: '',
      callTypes: [],
    }
  });
  // In needs_review: m-1 (MEDDIC) and m-2 (BANT). Matching BANT gives m-2!
  assert.strictEqual(tabPlusAdv.length, 1);
  assert.strictEqual(tabPlusAdv[0].id, 'm-2');
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 14. Removing one filter chip while preserving others
  console.log('• Testing: Removing Playbook filter chip while preserving Company filter...');
  const afterChipRemoval = evaluateReviewQueue({
    meetings: MOCK_MEETINGS,
    appliedAdvancedFilters: {
      companies: ['Northstar Inc'],
      playbooks: [], // Playbook chip removed
      stages: [],
      confidenceMin: '',
      confidenceMax: '',
      includeUnratedConfidence: true,
      startDate: '',
      endDate: '',
      callTypes: [],
    }
  });
  assert.strictEqual(afterChipRemoval.length, 2); // m-1 and m-4
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 15. Empty results state
  console.log('• Testing: Zero matches produces empty array...');
  const noMatches = evaluateReviewQueue({
    meetings: MOCK_MEETINGS,
    queueSearchQuery: 'Nonexistent Customer Corp XYZ',
  });
  assert.strictEqual(noMatches.length, 0);
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 16. Quick search combined with advanced filters
  console.log('• Testing: Quick search combined with advanced filters...');
  const quickPlusAdv = evaluateReviewQueue({
    meetings: MOCK_MEETINGS,
    queueSearchQuery: 'Northstar',
    appliedAdvancedFilters: {
      companies: [],
      playbooks: ['MEDDIC'],
      stages: ['synced'],
      confidenceMin: '',
      confidenceMax: '',
      includeUnratedConfidence: true,
      startDate: '',
      endDate: '',
      callTypes: [],
    }
  });
  // In Northstar + MEDDIC: m-1 (review) and m-4 (synced). Stage synced isolates m-4!
  assert.strictEqual(quickPlusAdv.length, 1);
  assert.strictEqual(quickPlusAdv[0].id, 'm-4');
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 17. Reset all filters restores full dataset
  console.log('• Testing: Resetting all filters restores full dataset...');
  const resetResult = evaluateReviewQueue({
    meetings: MOCK_MEETINGS,
    meetingsFilter: 'all',
    selectedCompanyFilter: 'all',
    selectedPlaybookFilter: 'all',
    queueSearchQuery: '',
    appliedAdvancedFilters: {
      titleSearch: '',
      companies: [],
      playbooks: [],
      stages: [],
      confidenceMin: '',
      confidenceMax: '',
      includeUnratedConfidence: true,
      startDate: '',
      endDate: '',
      callTypes: [],
    }
  });
  assert.strictEqual(resetResult.length, MOCK_MEETINGS.length);
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 18. Sorting & Pagination combined with filtering (filter-before-paginate)
  console.log('• Testing: Filtering before pagination preserves ordering and items across pages...');
  const filtered = evaluateReviewQueue({
    meetings: MOCK_MEETINGS,
    appliedAdvancedFilters: {
      companies: [],
      playbooks: ['MEDDIC', 'BANT'],
      stages: [],
      confidenceMin: '',
      confidenceMax: '',
      includeUnratedConfidence: true,
      startDate: '',
      endDate: '',
      callTypes: [],
    }
  });
  // Sort descending by date
  const sorted = [...filtered].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  // Page 1 (pageSize = 2)
  const page1 = sorted.slice(0, 2);
  // Page 2 (pageSize = 2)
  const page2 = sorted.slice(2, 4);
  assert.strictEqual(page1.length, 2);
  assert.strictEqual(page2.length, 2);
  assert.notStrictEqual(page1[0].id, page2[0].id);
  assert.strictEqual(page1.length + page2.length, 4);
  console.log('  \x1b[32mPASSED\x1b[0m');

  // 19. Graceful handling of missing or null fields
  console.log('• Testing: Graceful evaluation with null / undefined fields...');
  const sparseMeetings = [
    { id: 'sparse-1', title: null, audio_url: null, company_name: null, template_used: null, workflow_state: null },
    { id: 'sparse-2' }
  ];
  const sparseResult = evaluateReviewQueue({
    meetings: sparseMeetings,
    queueSearchQuery: 'search',
  });
  assert.strictEqual(sparseResult.length, 0);
  console.log('  \x1b[32mPASSED\x1b[0m');

  console.log('\n------------------------------------------------------');
  console.log('   All Advanced Search & Filter Tests PASSED!          ');
  console.log('------------------------------------------------------\n');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

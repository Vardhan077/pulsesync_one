import React, { useState, useEffect } from 'react';
import { 
  X, 
  Check, 
  Calendar, 
  Building2, 
  BookOpen, 
  ShieldCheck, 
  TrendingUp, 
  RotateCcw,
  Tag,
  SlidersHorizontal,
  Activity
} from 'lucide-react';

const STAGE_OPTIONS = [
  { id: 'review', label: 'Review' },
  { id: 'transcript_review', label: 'Transcript Review' },
  { id: 'speaker_review', label: 'Speaker Review' },
  { id: 'destination_mapping', label: 'Ready to Sync' },
  { id: 'synced', label: 'Synced' },
  { id: 'failed', label: 'Failed' },
  { id: 'processing', label: 'Processing' },
  { id: 'uploaded', label: 'Uploaded / Queued' },
];

const CALL_TYPE_OPTIONS = [
  { id: 'discovery', label: 'Discovery' },
  { id: 'qualification', label: 'Qualification' },
  { id: 'solution_demo', label: 'Solution / Demo' },
  { id: 'technical_validation', label: 'Technical Validation' },
  { id: 'negotiation', label: 'Negotiation' },
  { id: 'follow_up', label: 'Follow-up' },
  { id: 'renewal_expansion', label: 'Renewal / Expansion' },
  { id: 'cold_prospecting', label: 'Cold / Prospecting' },
];

export const DEFAULT_ADVANCED_FILTERS = {
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
};

export default function AdvancedFiltersPanel({
  isOpen,
  onClose,
  filters = DEFAULT_ADVANCED_FILTERS,
  onApplyFilters,
  onClearFilters,
  availableCompanies = [],
  availablePlaybooks = ['MEDDIC', 'BANT', 'SPICED', 'CHAMP', 'SPIN', 'CS QBR'],
  totalMatches = 0,
}) {
  const [draft, setDraft] = useState(filters);
  const [confidenceError, setConfidenceError] = useState(null);
  const [dateError, setDateError] = useState(null);

  // Sync draft whenever parent applied filters change or panel opens
  useEffect(() => {
    setDraft(filters);
    setConfidenceError(null);
    setDateError(null);
  }, [filters, isOpen]);

  if (!isOpen) return null;

  const toggleArrayItem = (key, item) => {
    setDraft(prev => {
      const current = prev[key] || [];
      const exists = current.includes(item);
      const updated = exists ? current.filter(x => x !== item) : [...current, item];
      return { ...prev, [key]: updated };
    });
  };

  const handleApply = () => {
    // Validate confidence range
    const minVal = draft.confidenceMin !== '' ? Number(draft.confidenceMin) : null;
    const maxVal = draft.confidenceMax !== '' ? Number(draft.confidenceMax) : null;

    if (minVal !== null && (isNaN(minVal) || minVal < 0 || minVal > 100)) {
      setConfidenceError('Min confidence must be between 0% and 100%');
      return;
    }
    if (maxVal !== null && (isNaN(maxVal) || maxVal < 0 || maxVal > 100)) {
      setConfidenceError('Max confidence must be between 0% and 100%');
      return;
    }
    if (minVal !== null && maxVal !== null && minVal > maxVal) {
      setConfidenceError('Min confidence cannot exceed Max confidence');
      return;
    }
    setConfidenceError(null);

    // Validate date range
    if (draft.startDate && draft.endDate && new Date(draft.startDate) > new Date(draft.endDate)) {
      setDateError('Start date must be before end date');
      return;
    }
    setDateError(null);

    onApplyFilters(draft);
  };

  const handleClear = () => {
    setDraft(DEFAULT_ADVANCED_FILTERS);
    setConfidenceError(null);
    setDateError(null);
    onClearFilters();
  };

  // Normalize playbook options
  const normalizedPlaybooks = Array.from(
    new Set([
      'MEDDIC',
      'BANT',
      'SPICED',
      'CHAMP',
      'SPIN',
      'CS QBR',
      ...availablePlaybooks.map(p => (typeof p === 'string' ? p.toUpperCase() : p?.name || ''))
    ].filter(Boolean))
  );

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-lg p-5 mb-4 animate-in fade-in slide-in-from-top-2 duration-150 text-left select-none">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-[#0F766E]">
            <SlidersHorizontal size={14} />
          </div>
          <div>
            <h3 className="text-xs font-bold text-[#0F172A] tracking-tight">Advanced Filter Criteria</h3>
            <p className="text-[10.5px] text-[#64748B] font-medium">
              Combine multi-category criteria across account, playbook, stage, confidence, and timestamps.
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition"
          title="Collapse Filter Panel"
        >
          <X size={15} />
        </button>
      </div>

      {/* Grid of Filter Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        
        {/* Category A: Meeting Title / Audio Filename */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
            <Tag size={12} className="text-[#14B8A6]" />
            <span>Title / Audio Filename</span>
          </label>
          <input
            type="text"
            placeholder="e.g. North_Daniel or .wav..."
            value={draft.titleSearch}
            onChange={(e) => setDraft({ ...draft, titleSearch: e.target.value })}
            className="w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-xs text-[#0F172A] outline-none placeholder-[#94A3B8] focus:border-[#14B8A6]"
          />
          <p className="text-[9.5px] text-[#94A3B8]">Matches meeting session titles or stored audio filenames</p>
        </div>

        {/* Category B: Company / Account */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
            <Building2 size={12} className="text-[#14B8A6]" />
            <span>Company / Account</span>
          </label>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg">
            <button
              type="button"
              onClick={() => toggleArrayItem('companies', 'Unassigned Account')}
              className={`px-2 py-0.5 rounded text-[10.5px] font-semibold border transition ${
                draft.companies.includes('Unassigned Account')
                  ? 'bg-[#0F172A] text-white border-[#0F172A]'
                  : 'bg-white text-[#475569] border-[#E2E8F0] hover:bg-slate-50'
              }`}
            >
              Unassigned Account
            </button>
            {availableCompanies.map(c => {
              const name = typeof c === 'string' ? c : c.name;
              if (!name || name === 'Unassigned Account') return null;
              const active = draft.companies.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleArrayItem('companies', name)}
                  className={`px-2 py-0.5 rounded text-[10.5px] font-semibold border transition ${
                    active
                      ? 'bg-[#0F172A] text-white border-[#0F172A]'
                      : 'bg-white text-[#475569] border-[#E2E8F0] hover:bg-slate-50'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <p className="text-[9.5px] text-[#94A3B8]">Filter by customer account (OR within selection)</p>
        </div>

        {/* Category C: Playbook */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
            <BookOpen size={12} className="text-[#14B8A6]" />
            <span>Playbook Extraction Framework</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {normalizedPlaybooks.map(pb => {
              const active = draft.playbooks.map(x => x.toLowerCase()).includes(pb.toLowerCase());
              return (
                <button
                  key={pb}
                  type="button"
                  onClick={() => toggleArrayItem('playbooks', pb)}
                  className={`px-2.5 py-1 rounded-md text-[10.5px] font-mono font-bold border transition ${
                    active
                      ? 'bg-[#0F172A] text-white border-[#0F172A]'
                      : 'bg-[#F8FAFC] text-[#475569] border-[#E2E8F0] hover:bg-slate-100'
                  }`}
                >
                  {pb}
                </button>
              );
            })}
          </div>
        </div>

        {/* Category D: Verification Stage */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
            <ShieldCheck size={12} className="text-[#14B8A6]" />
            <span>Workflow Verification Stage</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {STAGE_OPTIONS.map(st => {
              const active = draft.stages.includes(st.id);
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => toggleArrayItem('stages', st.id)}
                  className={`px-2 py-0.5 rounded text-[10.5px] font-semibold border transition ${
                    active
                      ? 'bg-[#14B8A6] text-white border-[#14B8A6]'
                      : 'bg-[#F8FAFC] text-[#475569] border-[#E2E8F0] hover:bg-slate-100'
                  }`}
                >
                  {st.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Category E: Confidence Range */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
            <TrendingUp size={12} className="text-[#14B8A6]" />
            <span>Confidence Range (%)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="100"
              placeholder="Min %"
              value={draft.confidenceMin}
              onChange={(e) => setDraft({ ...draft, confidenceMin: e.target.value })}
              className="w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 text-xs text-[#0F172A] outline-none focus:border-[#14B8A6]"
            />
            <span className="text-xs text-[#94A3B8] font-bold">to</span>
            <input
              type="number"
              min="0"
              max="100"
              placeholder="Max %"
              value={draft.confidenceMax}
              onChange={(e) => setDraft({ ...draft, confidenceMax: e.target.value })}
              className="w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 text-xs text-[#0F172A] outline-none focus:border-[#14B8A6]"
            />
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-[#64748B] font-medium cursor-pointer pt-0.5">
            <input
              type="checkbox"
              checked={draft.includeUnratedConfidence}
              onChange={(e) => setDraft({ ...draft, includeUnratedConfidence: e.target.checked })}
              className="rounded text-[#14B8A6]"
            />
            <span>Include calls without confidence scores</span>
          </label>
          {confidenceError && (
            <p className="text-[10px] text-rose-600 font-semibold">{confidenceError}</p>
          )}
        </div>

        {/* Category F: Last Activity Date Range */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
            <Calendar size={12} className="text-[#14B8A6]" />
            <span>Last Activity Date Range</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[9px] text-[#64748B] block mb-0.5">Start Date</span>
              <input
                type="date"
                value={draft.startDate}
                onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                className="w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg px-2 py-1 text-[11px] text-[#0F172A] outline-none focus:border-[#14B8A6]"
              />
            </div>
            <div>
              <span className="text-[9px] text-[#64748B] block mb-0.5">End Date</span>
              <input
                type="date"
                value={draft.endDate}
                onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                className="w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg px-2 py-1 text-[11px] text-[#0F172A] outline-none focus:border-[#14B8A6]"
              />
            </div>
          </div>
          {dateError && (
            <p className="text-[10px] text-rose-600 font-semibold">{dateError}</p>
          )}
        </div>

      </div>

      {/* Category G: Call Type */}
      <div className="mt-4 pt-3 border-t border-[#F1F5F9] space-y-1.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
          <Activity size={12} className="text-[#14B8A6]" />
          <span>Call Type Metadata</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {CALL_TYPE_OPTIONS.map(ct => {
            const active = draft.callTypes.includes(ct.id);
            return (
              <button
                key={ct.id}
                type="button"
                onClick={() => toggleArrayItem('callTypes', ct.id)}
                className={`px-2 py-0.5 rounded text-[10.5px] font-semibold border transition ${
                  active
                    ? 'bg-[#0F172A] text-white border-[#0F172A]'
                    : 'bg-[#F8FAFC] text-[#475569] border-[#E2E8F0] hover:bg-slate-100'
                }`}
              >
                {ct.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Action Footer */}
      <div className="mt-5 pt-3 border-t border-[#F1F5F9] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-[11px] text-[#64748B] font-medium">
          Matching calls in view: <strong className="text-[#0F172A] font-bold">{totalMatches}</strong>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleClear}
            className="px-3 py-1.5 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#64748B] text-xs font-semibold rounded-lg transition flex items-center gap-1.5"
          >
            <RotateCcw size={12} />
            <span>Clear All</span>
          </button>

          <button
            type="button"
            onClick={handleApply}
            className="px-4 py-1.5 bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-bold rounded-lg transition shadow-3xs flex items-center gap-1.5"
          >
            <Check size={13} className="text-[#14B8A6]" />
            <span>Apply Filters</span>
          </button>
        </div>
      </div>
    </div>
  );
}

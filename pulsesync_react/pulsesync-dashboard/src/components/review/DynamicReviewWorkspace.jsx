import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BadgeInfo,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Edit2,
  Eye,
  FileText,
  Info,
  MessageSquare,
  Save,
  ShieldCheck,
  Tag,
  X,
  XCircle,
} from "lucide-react";

const STATUS = {
  needs_review: { label: "Needs review", dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  approved: { label: "Approved", dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  not_mentioned: { label: "Not mentioned", dot: "bg-slate-400", badge: "bg-slate-50 text-slate-500 border-slate-200" },
  insufficient_evidence: { label: "Insufficient evidence", dot: "bg-slate-400", badge: "bg-slate-50 text-slate-500 border-slate-200" },
  rejected: { label: "Rejected", dot: "bg-rose-500", badge: "bg-rose-50 text-rose-700 border-rose-200" },
};

const normalizeStatus = (value) => {
  const key = String(value || "needs_review").toLowerCase();
  return STATUS[key] ? key : "needs_review";
};

const hasValue = (value) => {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== "" && normalized !== "not mentioned" && normalized !== "unknown";
};

const fieldKey = (field) => field.fieldKey || field.field_id || field.id;

function StatusBadge({ status }) {
  const meta = STATUS[normalizeStatus(status)];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function SectionTitle({ eyebrow, title, icon }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-[0.13em] font-bold text-[#94A3B8]">{eyebrow}</div>
        <h3 className="mt-0.5 text-[14px] font-extrabold text-[#0F172A]">{title}</h3>
      </div>
      {icon}
    </div>
  );
}

function renderFormattedSummary(rawText) {
  if (!rawText) return "Summary not available for this session.";
  const lines = String(rawText).split("\n").filter((line) => line.trim().length > 0);
  return (
    <div className="space-y-1.5">
      {lines.map((line, idx) => {
        const headerMatch = line.match(/^\*\*(.+?):\*\*\s*(.*)$/);
        if (headerMatch) {
          return (
            <p key={idx} className="leading-relaxed">
              <span className="font-bold text-[#0F172A]">{headerMatch[1]}: </span>
              <span className="text-[#334155]">{headerMatch[2]}</span>
            </p>
          );
        }
        if (line.includes("**")) {
          const parts = line.split(/(\*\*.*?\*\*)/g);
          return (
            <p key={idx} className="leading-relaxed text-[#334155]">
              {parts.map((p, pIdx) => {
                if (p.startsWith("**") && p.endsWith("**")) {
                  return <strong key={pIdx} className="font-bold text-[#0F172A]">{p.slice(2, -2)}</strong>;
                }
                return p;
              })}
            </p>
          );
        }
        return <p key={idx} className="leading-relaxed text-[#334155]">{line}</p>;
      })}
    </div>
  );
}

export default function DynamicReviewWorkspace({
  apiUrl,
  meetingId,
  profile,
  callType,
  conversationIntelligence = null,
  summarySections = [],
  fields = [],
  actionItems = [],
  risks = [],
  objections = [],
  executiveSummary = "",
  isMeetingSynced = false,
  onOpenEvidence,
  onProceedToSync,
  onToast,
  onFieldsChange,
}) {
  const [savingFieldId, setSavingFieldId] = useState(null);
  const [editingFieldId, setEditingFieldId] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [expandedFieldId, setExpandedFieldId] = useState(null);
  const [expandedSummaryId, setExpandedSummaryId] = useState(null);

  const stats = useMemo(() => {
    const total = fields.length;
    const needsReview = fields.filter((f) => normalizeStatus(f.review_status) === "needs_review").length;
    const approved = fields.filter((f) => normalizeStatus(f.review_status) === "approved").length;
    const notMentioned = fields.filter((f) => ["not_mentioned", "insufficient_evidence"].includes(normalizeStatus(f.review_status))).length;
    const rejected = fields.filter((f) => normalizeStatus(f.review_status) === "rejected").length;
    const populated = fields.filter((f) => hasValue(f.value)).length;
    const withEvidence = fields.filter((f) => Array.isArray(f.evidence) && f.evidence.length > 0).length;
    return { total, needsReview, approved, notMentioned, rejected, populated, withEvidence, reviewed: total - needsReview };
  }, [fields]);

  const effectiveFilter = useMemo(() => {
    if (activeFilter === "needs_review" && stats.needsReview === 0 && stats.total > 0) {
      return "all";
    }
    return activeFilter;
  }, [activeFilter, stats.needsReview, stats.total]);

  const filteredFields = useMemo(() => {
    if (effectiveFilter === "all") return fields;
    if (effectiveFilter === "not_mentioned") {
      return fields.filter((field) => ["not_mentioned", "insufficient_evidence"].includes(normalizeStatus(field.review_status)));
    }
    return fields.filter((field) => normalizeStatus(field.review_status) === effectiveFilter);
  }, [fields, effectiveFilter]);

  const effectiveExecutiveSummary = String(executiveSummary || "").trim() || conversationIntelligence?.generic_summary || "";
  const visibleSummary = summarySections.filter((section) => String(section.content || "").trim());
  const summaryUnavailable = visibleSummary.length === 0 && !effectiveExecutiveSummary;

  const persistReview = async (nextFields, changedFieldId, toast) => {
    if (!meetingId) return false;
    try {
      const response = await fetch(`${apiUrl}/api/meetings/${meetingId}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: nextFields.filter((field) => fieldKey(field) === changedFieldId).map((field) => ({
            field_id: fieldKey(field),
            value: ["not_mentioned", "insufficient_evidence"].includes(normalizeStatus(field.review_status)) ? null : field.value,
            review_status: normalizeStatus(field.review_status),
            reviewed_by: "user",
          })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not save review state");
      const persisted = Array.isArray(data.fields) ? data.fields : nextFields;
      onFieldsChange?.(
        persisted.map((field) => {
          const key = fieldKey(field);
          const previous = fields.find((item) => fieldKey(item) === key);
          const status = normalizeStatus(field.review_status);
          return {
            ...previous,
            ...field,
            id: field.id || field.field_id,
            fieldKey: field.fieldKey || field.field_id,
            field: field.field || field.field_name || field.name || previous?.field,
            value: field.value == null ? "Not mentioned" : String(field.value),
            review_status: status,
            approved: status === "approved",
            definition: field.definition || previous?.definition || {},
          };
        })
      );
      onToast?.(toast);
      return true;
    } catch (error) {
      console.error("Review persistence failed:", error);
      onToast?.(error.message || "Could not save review state");
      return false;
    }
  };

  const updateField = async (field, patch, toast) => {
    if (isMeetingSynced) return;
    const id = fieldKey(field);
    const nextFields = fields.map((item) => (fieldKey(item) === id ? { ...item, ...patch } : item));
    onFieldsChange?.(nextFields);
    setSavingFieldId(id);
    await persistReview(nextFields, id, toast);
    setSavingFieldId(null);
  };

  const approve = (field) => {
    const evidence = Array.isArray(field.evidence) ? field.evidence : [];
    if (!hasValue(field.value) || evidence.length === 0) {
      onToast?.("Approve is available only when the AI value has grounded evidence.");
      return;
    }
    updateField(field, { review_status: "approved", approved: true }, "Field approved for sync");
  };

  const markNotMentioned = (field) => updateField(field, { value: "Not mentioned", review_status: "not_mentioned", approved: false }, "Field marked not mentioned");
  const reject = (field) => updateField(field, { review_status: "rejected", approved: false }, "Field rejected");

  const startEdit = (field) => {
    setEditingFieldId(fieldKey(field));
    setEditingValue(hasValue(field.value) ? String(field.value) : "");
  };

  const saveEdit = async (field) => {
    const value = editingValue.trim();
    setEditingFieldId(null);
    await updateField(
      field,
      { value: value || "Not mentioned", review_status: value ? "needs_review" : "not_mentioned", approved: false, edited: true },
      value ? "Edit saved — field returned to review" : "Field marked not mentioned"
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden text-[#0F172A]">
      {/* Scrollable Review Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
        {/* 1. Review overview header */}
      <section className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden shadow-3xs">
        <div className="px-5 py-4 flex flex-col xl:flex-row xl:items-center gap-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-[#64748B]">Review</span>
              {callType && <span className="rounded-md bg-[#F0FDFA] border border-[#CCFBF1] px-2 py-0.5 text-[10px] font-bold text-[#0F766E]">{String(callType).replace(/_/g, " ")}</span>}
              {profile?.name && <span className="rounded-md bg-[#F8FAFC] border border-[#E2E8F0] px-2 py-0.5 text-[10px] font-bold text-[#475569]">{profile.name}</span>}
              {conversationIntelligence?.conversation_type && (
                <span className="rounded-md bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 text-[10px] font-bold text-[#1D4ED8] inline-flex items-center gap-1">
                  <Compass size={11} className="text-[#2563EB]" />
                  {conversationIntelligence.conversation_type}
                </span>
              )}
              {conversationIntelligence?.sales_relevance && (
                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold inline-flex items-center gap-1 ${
                  conversationIntelligence.sales_relevance === 'Relevant'
                    ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]'
                    : conversationIntelligence.sales_relevance === 'Partially Relevant'
                    ? 'bg-[#FEFCE8] border-[#FEF08A] text-[#854D0E]'
                    : 'bg-[#F8FAFC] border-[#E2E8F0] text-[#64748B]'
                }`}>
                  <BadgeInfo size={11} />
                  {conversationIntelligence.sales_relevance}
                </span>
              )}
            </div>
            <h2 className="mt-1.5 text-[18px] font-extrabold tracking-[-0.01em]">Verify AI findings before sync</h2>
            <p className="mt-1 text-[11px] text-[#64748B] max-w-2xl leading-relaxed">
              Review what PulseSync extracted from this transcript. For non-sales or educational discussions, empty extraction fields reflect accurate lack of sales evidence rather than an analysis failure.
            </p>
          </div>

          <div className="grid grid-cols-4 divide-x divide-[#E2E8F0] rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] shrink-0">
            <div className="px-4 py-2.5 min-w-[82px]"><div className="text-[17px] font-extrabold">{stats.total}</div><div className="text-[9px] text-[#64748B]">Fields</div></div>
            <div className="px-4 py-2.5 min-w-[82px]"><div className="text-[17px] font-extrabold text-amber-700">{stats.needsReview}</div><div className="text-[9px] text-[#64748B]">Review</div></div>
            <div className="px-4 py-2.5 min-w-[82px]"><div className="text-[17px] font-extrabold text-emerald-700">{stats.approved}</div><div className="text-[9px] text-[#64748B]">Approved</div></div>
            <div className="px-4 py-2.5 min-w-[82px]"><div className="text-[17px] font-extrabold text-slate-500">{stats.notMentioned}</div><div className="text-[9px] text-[#64748B]">Not found</div></div>
          </div>
        </div>
        <div className="h-1 bg-[#F1F5F9]"><div className="h-full bg-[#14B8A6] transition-all" style={{ width: `${stats.total ? (stats.reviewed / stats.total) * 100 : 0}%` }} /></div>
      </section>

      {/* 2. Conversation Intelligence Overview Card */}
      {conversationIntelligence && (
        <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-4 shadow-3xs">
          <SectionTitle
            eyebrow="Conversation intelligence"
            title="Meeting Context & Classification"
            icon={<Compass size={16} className="text-[#0F766E]" />}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left Column: Classification & Sales Relevance */}
            <div className="space-y-3">
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[9px] uppercase tracking-wider font-bold text-[#64748B]">Classification</span>
                  <span className="rounded bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 text-[10px] font-bold text-[#1D4ED8]">
                    {conversationIntelligence.conversation_type || "General Discussion"}
                    {conversationIntelligence.conversation_type_confidence ? ` · ${Math.round(conversationIntelligence.conversation_type_confidence * 100)}% confidence` : ""}
                  </span>
                </div>
                {conversationIntelligence.conversation_type_rationale && (
                  <p className="text-[11px] leading-relaxed text-[#334155]">
                    {conversationIntelligence.conversation_type_rationale}
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[9px] uppercase tracking-wider font-bold text-[#64748B]">Sales Relevance Assessment</span>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-bold border ${
                    conversationIntelligence.sales_relevance === 'Relevant'
                      ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]'
                      : conversationIntelligence.sales_relevance === 'Partially Relevant'
                      ? 'bg-[#FEFCE8] border-[#FEF08A] text-[#854D0E]'
                      : 'bg-slate-100 border-slate-200 text-slate-700'
                  }`}>
                    {conversationIntelligence.sales_relevance || "Low Sales Relevance"}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-[#475569]">
                  {conversationIntelligence.sales_relevance_explanation || "No clear customer buying discussion or sales qualification signals were identified."}
                </p>
              </div>

              {/* Discussion Signals / Main Topics */}
              {Array.isArray(conversationIntelligence.signals?.main_topics) && conversationIntelligence.signals.main_topics.length > 0 && (
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 space-y-2">
                  <span className="text-[9px] uppercase tracking-wider font-bold text-[#64748B] block">Discussion Topics</span>
                  <div className="flex flex-wrap gap-1.5">
                    {conversationIntelligence.signals.main_topics.map((topic, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2 py-1 text-[10px] font-medium text-[#334155]">
                        <Tag size={10} className="text-[#0F766E]" />
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Generic Summary & Quality Notices */}
            <div className="space-y-3 flex flex-col justify-between">
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 space-y-2 flex-1">
                <span className="text-[9px] uppercase tracking-wider font-bold text-[#64748B] block">Generic Conversation Summary</span>
                <div className="mt-1 text-[11px] leading-relaxed text-[#334155]">
                  {renderFormattedSummary(conversationIntelligence.generic_summary || effectiveExecutiveSummary)}
                </div>
                {Array.isArray(conversationIntelligence.signals?.problems_questions) && conversationIntelligence.signals.problems_questions.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-[#E2E8F0]">
                    <span className="text-[8px] uppercase tracking-wider font-bold text-[#64748B] block">Questions / Queries Raised</span>
                    <ul className="mt-1 space-y-1">
                      {conversationIntelligence.signals.problems_questions.map((q, idx) => (
                        <li key={idx} className="text-[10px] text-[#475569] italic flex items-start gap-1.5">
                          <span className="text-[#0F766E] font-bold">·</span>
                          <span>"{q}"</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {conversationIntelligence.transcript_quality_warning && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 flex items-start gap-2.5 text-[10px] text-amber-800">
                  <AlertTriangle size={15} className="shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <span className="font-bold">Transcript Quality Notice: </span>
                    {conversationIntelligence.transcript_quality_warning}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 3. Call snapshot */}
      <section className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-3">
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-3xs">
          <SectionTitle eyebrow="Conversation summary" title="What matters from this call" icon={<FileText size={15} className="text-[#14B8A6]" />} />
          {summaryUnavailable ? (
            <div className="mt-3 rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-4 py-3">
              <div className="text-[11px] font-bold text-[#475569]">Summary not available yet</div>
              <p className="mt-1 text-[10px] leading-relaxed text-[#64748B]">No grounded synthesized summary was returned. PulseSync intentionally does not replace it with raw transcript text.</p>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {(visibleSummary.length ? visibleSummary : [{ id: "executive", name: "Executive Summary", content: effectiveExecutiveSummary }]).map((section, index) => {
                const id = section.section_id || section.id || `summary-${index}`;
                const content = String(section.content || effectiveExecutiveSummary || "").trim();
                const expanded = expandedSummaryId === id;
                return (
                  <div key={id} className="rounded-lg border border-[#E2E8F0] bg-[#FBFCFD] p-3">
                    <div className="flex items-center justify-between gap-2"><span className="text-[9px] uppercase tracking-wider font-bold text-[#64748B]">{section.section_name || section.name || "Summary"}</span>{content.length > 260 && <button onClick={() => setExpandedSummaryId(expanded ? null : id)} className="text-[#0F766E]">{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button>}</div>
                    <p className={`mt-1.5 text-[10px] leading-relaxed text-[#334155] ${!expanded && content.length > 260 ? "line-clamp-4" : ""}`}>{content}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-3xs flex flex-col justify-between">
          <div>
            <SectionTitle eyebrow="Call snapshot" title="Captured sales signals" icon={<ShieldCheck size={15} className="text-[#14B8A6]" />} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] p-3">
                <div className="text-[17px] font-extrabold">{stats.populated}</div>
                <div className="text-[9px] text-[#64748B]">Fields with values</div>
              </div>
              <div className="rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] p-3">
                <div className="text-[17px] font-extrabold">{stats.withEvidence}</div>
                <div className="text-[9px] text-[#64748B]">Evidence-backed</div>
              </div>
              <div className="rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] p-3">
                <div className="text-[17px] font-extrabold">{actionItems.length}</div>
                <div className="text-[9px] text-[#64748B]">Commitments</div>
              </div>
              <div className="rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] p-3">
                <div className="text-[17px] font-extrabold">{risks.length + objections.length}</div>
                <div className="text-[9px] text-[#64748B]">Risks / objections</div>
              </div>
            </div>
          </div>
          {stats.populated === 0 && (
            <div className="mt-2.5 rounded-md bg-[#F8FAFC] border border-[#E2E8F0] p-2 text-[9px] text-[#64748B] flex items-center gap-1.5">
              <Info size={12} className="text-[#0284C7] shrink-0" />
              <span>0 qualification values found — expected for early outreach, cold prospecting, or non-sales calls.</span>
            </div>
          )}
        </div>
      </section>

      {/* 4. Commitments */}
      <section className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden shadow-3xs">
        <div className="px-5 py-3 border-b border-[#F1F5F9]"><SectionTitle eyebrow="Commitments" title="Explicit follow-ups" icon={<MessageSquare size={15} className="text-[#14B8A6]" />} /></div>
        {actionItems.length === 0 ? (
          <div className="m-4 rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-4 py-3 text-[10px] text-[#64748B]">No explicit commitments were captured.</div>
        ) : (
          <div className="divide-y divide-[#F1F5F9]">
            {actionItems.map((item, index) => (
              <div key={item.id || index} className="px-5 py-2.5 flex items-center gap-3">
                <div className="h-6 w-6 rounded-full bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center shrink-0"><Check size={12} className="text-[#047857]" /></div>
                <div className="min-w-0 flex-1"><div className="text-[10px] font-bold text-[#0F172A] truncate">{item.task}</div><div className="mt-0.5 text-[9px] text-[#64748B]">{item.owner || "Unassigned"}{item.deadline ? ` · ${item.deadline}` : ""}</div></div>
                {item.evidenceDetails && <button onClick={() => onOpenEvidence?.({ ...item.evidenceDetails, field: "Action Item", extractedValue: item.task })} className="text-[9px] font-bold text-[#0F766E] hover:underline">View evidence</button>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. Dynamic profile review */}
      <section className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden shadow-3xs">
        <div className="px-5 py-3.5 border-b border-[#F1F5F9] flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div><div className="text-[10px] uppercase tracking-[0.12em] font-bold text-[#94A3B8]">Profile review</div><div className="mt-0.5 flex items-center gap-2"><h3 className="text-[15px] font-extrabold">{profile?.name || "Selected profile"}</h3><span className="text-[9px] text-[#94A3B8]">{stats.total} configured fields</span></div></div>
          <div className="flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-1 self-start overflow-x-auto">
            {["all", "needs_review", "approved", "not_mentioned"].map((filter) => {
              const count = filter === "needs_review" ? stats.needsReview : filter === "approved" ? stats.approved : filter === "not_mentioned" ? stats.notMentioned : stats.total;
              const label = filter === "needs_review" ? "Needs review" : filter === "not_mentioned" ? "Not mentioned" : filter === "all" ? "All" : "Approved";
              return (
                <button
                  key={filter}
                  onClick={() => setActiveFilter(filter)}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[9px] font-bold ${
                    effectiveFilter === filter ? "bg-white text-[#0F172A] shadow-sm border border-[#E2E8F0]" : "text-[#64748B]"
                  }`}
                >
                  {label} {count}
                </button>
              );
            })}
          </div>
        </div>

        {/* Informative banner when 0 fields are populated */}
        {stats.populated === 0 && stats.total > 0 && (
          <div className="mx-5 my-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 flex items-start gap-2.5">
            <Info size={15} className="text-[#0284C7] shrink-0 mt-0.5" />
            <div className="text-[10px] leading-relaxed text-[#334155]">
              <span className="font-bold text-[#0F172A]">No {profile?.name || "framework"} fields found in this transcript. </span>
              {conversationIntelligence?.sales_relevance === 'Relevant' ? (
                <>
                  This conversation is classified as {conversationIntelligence?.conversation_type || "sales outreach"} ({conversationIntelligence?.sales_relevance}). Because this is an early exploratory conversation, formal qualification parameters were not discussed. All {stats.total} configured fields are accurately marked as <strong>Not mentioned</strong>.
                </>
              ) : (
                <>
                  Because this conversation is classified as {conversationIntelligence?.conversation_type || "non-sales"} ({conversationIntelligence?.sales_relevance || "Low Sales Relevance"}), PulseSync intentionally did not force data into extraction fields. All {stats.total} configured fields are accurately marked as <strong>Not mentioned</strong>.
                </>
              )}
            </div>
          </div>
        )}

        <div className="hidden lg:grid grid-cols-[190px_minmax(0,1fr)_280px_210px] gap-3 px-5 py-2 bg-[#F8FAFC] border-b border-[#E2E8F0] text-[8px] uppercase tracking-[0.12em] font-bold text-[#94A3B8]">
          <div>Field</div><div>Extracted value</div><div>Evidence</div><div className="text-right">Decision</div>
        </div>

        {filteredFields.length === 0 ? (
          <div className="m-4 rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-4 py-5 text-center text-[10px] text-[#64748B]">No fields match this filter.</div>
        ) : (
          <div className="divide-y divide-[#F1F5F9]">
            {filteredFields.map((field) => {
              const id = fieldKey(field);
              const status = normalizeStatus(field.review_status);
              const evidence = Array.isArray(field.evidence) ? field.evidence : [];
              const canApprove = hasValue(field.value) && evidence.length > 0;
              const expanded = expandedFieldId === id;
              const saving = savingFieldId === id;
              const definition = field.definition || {};
              const firstEvidence = evidence[0] || {};
              const displayValue = hasValue(field.value) ? String(field.value) : "Not mentioned";

              return (
                <div key={id} className={`px-5 py-3 ${status === "needs_review" ? "bg-white" : "bg-[#FCFDFD]"}`}>
                  <div className="grid grid-cols-1 lg:grid-cols-[190px_minmax(0,1fr)_280px_210px] gap-3 lg:items-center">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-extrabold">{field.field}</span>
                        <StatusBadge status={status} />
                      </div>
                      {definition.description && <p className="mt-1 text-[8px] leading-relaxed text-[#94A3B8] line-clamp-2">{definition.description}</p>}
                    </div>

                    <div className="min-w-0">
                      {editingFieldId === id ? (
                        <div className="flex gap-2">
                          <textarea value={editingValue} onChange={(e) => setEditingValue(e.target.value)} rows={2} autoFocus className="min-w-0 flex-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-2 text-[10px] outline-none focus:border-[#14B8A6] resize-y" />
                          <div className="flex gap-1">
                            <button disabled={saving} onClick={() => saveEdit(field)} className="rounded-md bg-[#0F766E] px-2 py-1.5 text-white"><Save size={11} /></button>
                            <button onClick={() => setEditingFieldId(null)} className="rounded-md border border-[#E2E8F0] px-2 py-1.5 text-[#64748B]"><X size={11} /></button>
                          </div>
                        </div>
                      ) : (
                        <div className={`text-[11px] leading-snug font-semibold ${hasValue(field.value) ? "text-[#0F172A]" : "text-[#94A3B8] italic"}`}>
                          {displayValue}
                          {field.edited && <span className="ml-2 rounded border border-sky-200 bg-sky-50 px-1 py-0.5 text-[8px] font-bold text-sky-700">edited</span>}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      {evidence.length > 0 ? (
                        <button onClick={() => onOpenEvidence?.({ ...field, extractedValue: field.value, quote: firstEvidence.quote, speaker: firstEvidence.speaker, timestamp: firstEvidence.timestamp, timestampSecs: firstEvidence.start_time, endTimeSecs: firstEvidence.end_time })} className="block w-full text-left group">
                          <div className="flex items-center gap-1.5 text-[8px] font-bold text-[#64748B] group-hover:text-[#0F766E]"><span>{firstEvidence.speaker || "Transcript"}</span><span>·</span><span>{firstEvidence.timestamp || "Evidence"}</span><Eye size={10} className="ml-auto" /></div>
                          <div className="mt-1 text-[9px] leading-snug text-[#475569] line-clamp-2">“{firstEvidence.quote || "View evidence"}”</div>
                        </button>
                      ) : <span className="text-[9px] text-[#94A3B8]">No evidence captured</span>}
                    </div>

                    <div className="flex lg:flex-col xl:flex-row items-center justify-end gap-1.5">
                      <button disabled={isMeetingSynced} onClick={() => startEdit(field)} title="Edit" className="rounded-md border border-[#E2E8F0] p-1.5 text-[#64748B] hover:bg-[#F8FAFC] disabled:opacity-40"><Edit2 size={11} /></button>
                      <button onClick={() => setExpandedFieldId(expanded ? null : id)} title="Details" className="rounded-md border border-[#E2E8F0] p-1.5 text-[#64748B]">{expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}</button>
                      {status === "needs_review" && canApprove && <button disabled={saving} onClick={() => approve(field)} className="rounded-md bg-[#0F766E] px-2.5 py-1.5 text-[9px] font-bold text-white disabled:opacity-40"><CheckCircle2 size={10} className="inline mr-1" />Approve</button>}
                      {status === "needs_review" && <button disabled={saving} onClick={() => markNotMentioned(field)} className="rounded-md border border-[#E2E8F0] px-2 py-1.5 text-[9px] font-bold text-[#64748B] disabled:opacity-40">Not mentioned</button>}
                      {status === "needs_review" && <button disabled={saving} onClick={() => reject(field)} className="rounded-md border border-rose-200 px-2 py-1.5 text-[9px] font-bold text-rose-600 disabled:opacity-40"><XCircle size={10} className="inline mr-1" />Reject</button>}
                      {status === "approved" && <button disabled={saving} onClick={() => updateField(field, { review_status: "needs_review", approved: false }, "Approval removed")} className="rounded-md border border-amber-200 px-2 py-1.5 text-[9px] font-bold text-amber-700">Reopen</button>}
                      {status === "rejected" && <button disabled={saving} onClick={() => updateField(field, { review_status: "needs_review", approved: false }, "Field returned to review")} className="rounded-md border border-[#E2E8F0] px-2 py-1.5 text-[9px] font-bold text-[#475569]">Review again</button>}
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-2.5 ml-0 lg:ml-[190px] rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div><div className="text-[8px] uppercase tracking-wider font-bold text-[#94A3B8]">Field contract</div><p className="mt-1 text-[9px] leading-relaxed text-[#475569]">{definition.semantic_contract || definition.description || "No semantic contract provided."}</p></div>
                      <div><div className="text-[8px] uppercase tracking-wider font-bold text-[#94A3B8]">Grounding</div>{evidence.length ? <blockquote className="mt-1 border-l-2 border-[#14B8A6] pl-2 text-[9px] leading-relaxed text-[#475569]">“{firstEvidence.quote || firstEvidence.text || "Evidence available"}”</blockquote> : <p className="mt-1 text-[9px] text-[#94A3B8]">No grounded evidence was returned.</p>}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      </div>

      {/* Review gate footer pinned to review workspace bottom without overlapping sidebar */}
      <div className="flex-shrink-0 border-t border-[#E2E8F0] bg-white/95 backdrop-blur px-5 py-2.5 z-10 shadow-sm">
        <div className="mx-auto max-w-[1500px] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <div className="text-[10px] font-bold">
              {stats.needsReview ? `${stats.needsReview} field${stats.needsReview === 1 ? "" : "s"} still need a decision` : "Review complete"}
            </div>
            <div className="text-[8px] text-[#94A3B8]">
              {stats.approved === 0
                ? "No fields approved for update. Destination sync will safely record the completed review without modifying CRM deal data."
                : "Only human-approved values will be sent to the destination."}
            </div>
          </div>
          <button
            disabled={!isMeetingSynced && stats.needsReview > 0}
            onClick={onProceedToSync}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0F766E] px-4 py-2 text-[10px] font-bold text-white shadow-sm hover:bg-[#0D9488] disabled:bg-[#CBD5E1] disabled:cursor-not-allowed"
          >
            {isMeetingSynced
              ? "View sync result"
              : stats.needsReview > 0
              ? "Finish review to continue"
              : stats.approved === 0
              ? "Continue to destination sync (0 fields to update)"
              : "Continue to destination sync"}
            <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import { FileText } from 'lucide-react';

export default function ExecutiveBrief({ overview, topics = [], objections = [] }) {
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <FileText size={14} className="text-[#64748B]" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
          Summary
        </h3>
      </div>

      {/* Overview */}
      <p className="text-[13px] text-[#64748B] leading-relaxed font-medium line-clamp-4 mb-6">
        {overview || 'No summary available for this session.'}
      </p>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Topics Discussed */}
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B] mb-3">
            Topics Discussed
          </h4>
          {topics.length === 0 ? (
            <p className="text-[11px] font-medium text-[#94A3B8]">No topics recorded.</p>
          ) : (
            <ul className="space-y-2">
              {topics.map((topic, idx) => (
                <li key={idx} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#14B8A6] shrink-0" />
                    <span className="text-[13px] font-medium text-[#0F172A]">{topic.topic}</span>
                  </div>
                  <span className="text-[11px] font-semibold font-mono text-[#64748B]">{topic.duration}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Risks & Blockers */}
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B] mb-3">
            Risks & Blockers
          </h4>
          {objections.length === 0 ? (
            <p className="text-[11px] font-medium text-[#94A3B8]">No risks identified.</p>
          ) : (
            <ul className="space-y-2">
              {objections.map((obj, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] shrink-0 mt-1.5" />
                  <span className="text-[13px] font-medium text-[#0F172A]">{obj.concern}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

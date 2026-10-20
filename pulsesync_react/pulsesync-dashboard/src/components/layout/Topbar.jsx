import React, { useState, useRef, useEffect } from 'react';
import { 
  ArrowLeft, 
  Search, 
  Bell, 
  ChevronDown, 
  Building2, 
  FileText, 
  User, 
  AlertTriangle, 
  AlertCircle, 
  MessageSquare,
  Sparkles,
  CheckCircle2
} from 'lucide-react';

const formatDuration = (seconds) => {
  if (!seconds) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

export default function Topbar({ 
  selectedMeeting, 
  onBack, 
  viewMode,
  searchQuery,
  onSearchChange,
  searchResults,
  onSelectSearchResult,
  onClearSearch
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  // Close search dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e) => {
    onSearchChange(e.target.value);
    setShowDropdown(true);
  };

  const handleResultClick = (type, item) => {
    onSelectSearchResult(type, item);
    setShowDropdown(false);
    onClearSearch();
  };

  const hasResults = searchResults && (
    (searchResults.companies?.length || 0) > 0 ||
    (searchResults.meetings?.length || 0) > 0 ||
    (searchResults.speakers?.length || 0) > 0 ||
    (searchResults.actionItems?.length || 0) > 0 ||
    (searchResults.risks?.length || 0) > 0 ||
    (searchResults.objections?.length || 0) > 0 ||
    (searchResults.memories?.length || 0) > 0
  );

  return (
    <div className="flex flex-col border-b border-[#E5E7EB] bg-white w-full select-none flex-shrink-0 relative">
      {/* Primary bar */}
      <div className="flex items-center justify-between h-[52px] px-6">
        {/* Simple Brand */}
        <div className="flex items-center gap-2 text-[14px]">
          <span className="text-[#0F172A] font-bold tracking-tight">PulseSync</span>
          <span className="text-[#94A3B8] font-medium px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[10px] uppercase tracking-widest">Enterprise</span>
        </div>

        {/* Right actions with Global Search Bar */}
        <div className="flex items-center gap-3 relative" ref={dropdownRef}>
          <div className="relative w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" size={14} />
            <input
              id="topbar-search"
              type="text"
              placeholder="Search Marcus, budget > 50k, SOC2..."
              value={searchQuery || ""}
              onChange={handleInputChange}
              onFocus={() => setShowDropdown(true)}
              className="w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-md pl-8 pr-3 py-1.5 text-[12px] text-[#0F172A] outline-none placeholder-[#94A3B8] focus:border-[#14B8A6] transition"
            />
          </div>

          {/* Search Results Dropdown Overlay */}
          {showDropdown && searchQuery && (
            <div className="absolute right-0 top-11 w-[400px] bg-white border border-[#E5E7EB] shadow-xl rounded-lg max-h-[380px] overflow-y-auto z-[999] p-2 divide-y divide-[#F1F5F9] text-left">
              {!hasResults ? (
                <div className="p-4 text-center text-xs text-[#94A3B8] italic">
                  No matching results found for "{searchQuery}"
                </div>
              ) : (
                <>
                  {/* Category: Companies */}
                  {searchResults.companies?.length > 0 && (
                    <div className="py-2 first:pt-0">
                      <div className="px-2 pb-1 text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider flex items-center gap-1">
                        <Building2 size={10} /> Companies
                      </div>
                      {searchResults.companies.map(c => (
                        <div
                          key={c.id}
                          onClick={() => handleResultClick('company', c)}
                          className="px-2 py-1.5 hover:bg-[#F8FAFC] rounded-md cursor-pointer text-xs font-semibold flex items-center justify-between"
                        >
                          <span className="text-[#0F172A]">{c.name}</span>
                          <span className="text-[10px] text-[#64748B] font-medium font-mono">{c.industry}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Category: Meetings */}
                  {searchResults.meetings?.length > 0 && (
                    <div className="py-2">
                      <div className="px-2 pb-1 text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider flex items-center gap-1">
                        <FileText size={10} /> Meetings
                      </div>
                      {searchResults.meetings.map(m => (
                        <div
                          key={m.id}
                          onClick={() => handleResultClick('meeting', m)}
                          className="px-2 py-1.5 hover:bg-[#F8FAFC] rounded-md cursor-pointer text-xs font-semibold flex flex-col"
                        >
                          <span className="text-[#0F172A]">{m.title}</span>
                          <span className="text-[9px] text-[#94A3B8] font-mono mt-0.5">{new Date(m.created_at || m.updated_at).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Category: Speakers */}
                  {searchResults.speakers?.length > 0 && (
                    <div className="py-2">
                      <div className="px-2 pb-1 text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider flex items-center gap-1">
                        <User size={10} /> Contacts
                      </div>
                      {searchResults.speakers.map((sp, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleResultClick('speaker', sp)}
                          className="px-2 py-1.5 hover:bg-[#F8FAFC] rounded-md cursor-pointer text-xs font-semibold flex items-center justify-between"
                        >
                          <span className="text-[#0F172A]">{sp.name}</span>
                          <span className="text-[10px] text-[#64748B] font-mono">{sp.role || "Attendee"}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Category: Action Items */}
                  {searchResults.actionItems?.length > 0 && (
                    <div className="py-2">
                      <div className="px-2 pb-1 text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider flex items-center gap-1">
                        <CheckCircle2 size={10} className="text-emerald-500" /> Actions
                      </div>
                      {searchResults.actionItems.map((ai, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleResultClick('action_item', ai)}
                          className="px-2 py-1.5 hover:bg-[#F8FAFC] rounded-md cursor-pointer text-xs font-semibold flex flex-col"
                        >
                          <span className="text-[#0F172A] line-clamp-1">{ai.task}</span>
                          <span className="text-[9px] text-[#94A3B8] mt-0.5">Session: "{ai.meeting_title}"</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Category: Risks */}
                  {searchResults.risks?.length > 0 && (
                    <div className="py-2">
                      <div className="px-2 pb-1 text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider flex items-center gap-1">
                        <AlertTriangle size={10} className="text-rose-500" /> Risks
                      </div>
                      {searchResults.risks.map((r, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleResultClick('risk', r)}
                          className="px-2 py-1.5 hover:bg-[#F8FAFC] rounded-md cursor-pointer text-xs font-semibold flex flex-col"
                        >
                          <span className="text-red-700">{r.risk}</span>
                          <span className="text-[9px] text-[#94A3B8] mt-0.5">Account: {r.company_name}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Category: Objections */}
                  {searchResults.objections?.length > 0 && (
                    <div className="py-2">
                      <div className="px-2 pb-1 text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider flex items-center gap-1">
                        <AlertCircle size={10} className="text-amber-500" /> Objections
                      </div>
                      {searchResults.objections.map((obj, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleResultClick('objection', obj)}
                          className="px-2 py-1.5 hover:bg-[#F8FAFC] rounded-md cursor-pointer text-xs font-semibold flex flex-col"
                        >
                          <span className="text-[#0F172A]">{obj.objection}</span>
                          <span className="text-[9px] text-[#94A3B8] mt-0.5">Account: {obj.company_name}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Category: Memories */}
                  {searchResults.memories?.length > 0 && (
                    <div className="py-2">
                      <div className="px-2 pb-1 text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider flex items-center gap-1">
                        <MessageSquare size={10} /> Memories
                      </div>
                      {searchResults.memories.map((m, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleResultClick('memory', m)}
                          className="px-2 py-1.5 hover:bg-[#F8FAFC] rounded-md cursor-pointer text-xs font-semibold flex flex-col"
                        >
                          <span className="text-[#0F172A] line-clamp-1">{m.value}</span>
                          <span className="text-[9px] text-[#94A3B8] mt-0.5">Type: {m.memory_type} | Account: {m.company_name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <button
            id="topbar-notifications"
            className="relative p-1.5 rounded-md text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition"
            title="Notifications"
          >
            <Bell size={16} />
            <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[#DC2626]" />
          </button>

          <div className="h-5 w-px bg-[#E5E7EB]" />

          <button
            id="topbar-avatar"
            className="flex items-center gap-1.5 rounded-md hover:bg-[#F1F5F9] px-1.5 py-1 transition"
            title="Account menu"
          >
            <div className="h-6 w-6 rounded-full bg-[#14B8A6] text-white flex items-center justify-center text-[10px] font-semibold">
              VM
            </div>
            <ChevronDown size={12} className="text-[#94A3B8]" />
          </button>
        </div>
      </div>
    </div>
  );
}
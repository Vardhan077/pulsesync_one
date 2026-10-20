import React, { useEffect } from "react";
import { 
  Inbox, 
  CheckSquare, 
  Users, 
  BookOpen, 
  Link as LinkIcon, 
  Settings, 
  LogOut, 
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Layers,
  BarChart3,
  RadioTower,
  Sparkles
} from "lucide-react";

export default function Sidebar({
  selectedMeetingId,
  onClearSelection,
  isAnyProcessing,
  activeMeetingStatus,
  viewMode,
  onViewChange,
  isCollapsed,
  onToggleCollapse
}) {
  const isActive = (key) => !selectedMeetingId && viewMode === key;
  const isProcessing = isAnyProcessing || ['queued', 'processing'].includes(activeMeetingStatus);

  // Auto-collapse preference persistence
  useEffect(() => {
    const saved = localStorage.getItem("ps_sidebar_collapsed");
    if (saved !== null && JSON.parse(saved) !== isCollapsed) {
      if (onToggleCollapse) onToggleCollapse();
    }
  }, []);

  const handleToggle = () => {
    const nextState = !isCollapsed;
    localStorage.setItem("ps_sidebar_collapsed", JSON.stringify(nextState));
    if (onToggleCollapse) onToggleCollapse();
  };

  const WORKSPACE_NAV = [
    { key: 'review_center', label: 'Home', icon: Inbox, shortcut: '1' },
    { key: 'board', label: 'Reviews', icon: CheckSquare, shortcut: '2' },
    { key: 'customers', label: 'Customers', icon: Users, shortcut: '3' },
    { key: 'analytics', label: 'Analytics', icon: BarChart3, shortcut: '4' },
    { key: 'capture', label: 'Capture', icon: RadioTower, shortcut: '5' },
  ];

  const CONFIG_NAV = [
    { key: 'playbooks', label: 'Playbooks', icon: BookOpen, shortcut: '6' },
    { key: 'extraction_profiles', label: 'AI Extraction', icon: Sparkles, shortcut: '7' },
    { key: 'integrations', label: 'Integrations', icon: LinkIcon, shortcut: '8' },
    { key: 'settings', label: 'Settings', icon: Settings, shortcut: '9' },
  ];

  return (
    <aside 
      className={`border-r border-[#E5E7EB] bg-white flex flex-col flex-shrink-0 h-screen transition-all duration-200 select-none ${
        isCollapsed ? "w-[68px]" : "w-[240px]"
      }`}
    >
      {/* Brand Header */}
      <div className="px-4 py-3.5 border-b border-[#F1F5F9] flex items-center justify-between">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="h-8 w-8 rounded-lg bg-[#14B8A6] flex items-center justify-center text-white text-[12px] font-extrabold tracking-tight flex-shrink-0 shadow-3xs">
            PS
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-[14px] font-bold text-[#0F172A] tracking-tight truncate leading-none">
                PulseSync AI
              </span>
              <span className="text-[10px] text-[#64748B] font-medium tracking-normal mt-0.5">
                Enterprise Intelligence
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="px-2.5 pt-4 pb-2 flex-1 overflow-y-auto scroll-thin space-y-4">
        
        {/* WORKSPACE SECTION */}
        <div>
          {!isCollapsed && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8] px-2.5 mb-1.5 block">
              Workspace
            </span>
          )}
          <div className="space-y-0.5">
            {WORKSPACE_NAV.map(({ key, label, icon: Icon, shortcut }) => {
              const active = isActive(key);
              return (
                <button
                  key={key}
                  id={`nav-${key}`}
                  title={isCollapsed ? label : undefined}
                  onClick={() => { onClearSelection(); onViewChange(key); }}
                  className={`w-full flex items-center px-2.5 py-2 rounded-lg text-[13px] font-semibold transition-all group relative ${
                    active
                      ? "bg-[#F0FDFA] text-[#0F766E] shadow-3xs"
                      : "text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0F172A]"
                  } ${isCollapsed ? "justify-center" : "justify-between"}`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon size={16} className={`flex-shrink-0 ${active ? "text-[#14B8A6]" : "text-[#64748B] group-hover:text-[#0F172A]"}`} />
                    {!isCollapsed && <span>{label}</span>}
                  </span>
                  {!isCollapsed && (
                    <span className="text-[10px] font-mono text-[#94A3B8] opacity-70">
                      {shortcut}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* CONFIGURATION SECTION */}
        <div>
          {!isCollapsed && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8] px-2.5 mb-1.5 block">
              Configuration
            </span>
          )}
          <div className="space-y-0.5">
            {CONFIG_NAV.map(({ key, label, icon: Icon, shortcut }) => {
              const active = isActive(key);
              return (
                <button
                  key={key}
                  id={`nav-${key}`}
                  title={isCollapsed ? label : undefined}
                  onClick={() => { onClearSelection(); onViewChange(key); }}
                  className={`w-full flex items-center px-2.5 py-2 rounded-lg text-[13px] font-semibold transition-all group relative ${
                    active
                      ? "bg-[#F0FDFA] text-[#0F766E] shadow-3xs"
                      : "text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0F172A]"
                  } ${isCollapsed ? "justify-center" : "justify-between"}`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon size={16} className={`flex-shrink-0 ${active ? "text-[#14B8A6]" : "text-[#64748B] group-hover:text-[#0F172A]"}`} />
                    {!isCollapsed && <span>{label}</span>}
                  </span>
                  {!isCollapsed && (
                    <span className="text-[10px] font-mono text-[#94A3B8] opacity-70">
                      {shortcut}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Session Context (When in Meeting Workspace) */}
        {selectedMeetingId && !isCollapsed && (
          <div className="pt-3 border-t border-[#F1F5F9] animate-in fade-in duration-200">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8] px-2.5 block mb-1.5">
              Active Call
            </span>
            <div className="mx-1 rounded-lg border border-[#14B8A6]/20 bg-[#F0FDFA] p-2.5 shadow-3xs">
              <span className="text-[11px] text-[#0F766E] font-bold block truncate">
                Meeting Workspace
              </span>
              <span className="text-[10px] text-[#64748B] font-medium block mt-0.5">
                Review & Verification flow
              </span>
            </div>
            <button
              id="back-to-board"
              title="Return to Review Queue"
              onClick={onClearSelection}
              className="flex items-center gap-1.5 mt-2 px-2.5 text-[11px] font-bold text-[#0284C7] hover:text-[#0369A1] transition-colors"
            >
              <ArrowLeft size={12} />
              <span>Exit to Queue</span>
            </button>
          </div>
        )}
      </nav>

      {/* System Ingestion Connection Status */}
      <div className={`px-4 py-2 border-t border-[#F1F5F9] flex items-center justify-between ${
        isCollapsed ? "justify-center" : ""
      }`}>
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full flex-shrink-0 ${isProcessing ? "bg-amber-500 animate-pulse" : "bg-[#14B8A6]"}`} />
          {!isCollapsed && (
            <span className="text-[11px] font-semibold text-[#64748B]">
              {isProcessing ? "Ingesting Call..." : "Connected"}
            </span>
          )}
        </div>
        {!isCollapsed && (
          <span className="text-[10px] font-mono text-[#94A3B8] font-bold">v2.0</span>
        )}
      </div>

      {/* Collapse / Expand Toggle */}
      <div className="px-2 py-2 border-t border-[#F1F5F9]">
        <button
          onClick={handleToggle}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0F172A] transition"
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isCollapsed ? (
            <ChevronRight size={15} className="mx-auto" />
          ) : (
            <>
              <ChevronLeft size={14} />
              <span>Collapse Sidebar</span>
            </>
          )}
        </button>
      </div>

      {/* Account Strip */}
      <div className="px-3.5 py-3 border-t border-[#E5E7EB] flex items-center justify-between flex-shrink-0 bg-[#F8FAFC]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-7 w-7 rounded-full bg-[#E0F2FE] text-[#0284C7] font-bold text-[11px] flex items-center justify-center flex-shrink-0 border border-[#BAE6FD]">
            VM
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-[12px] font-bold text-[#0F172A] truncate">
                Vardhan M.
              </span>
              <span className="text-[10px] font-mono text-[#94A3B8] truncate">
                Enterprise AE
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
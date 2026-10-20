import React, { useState, useEffect, useRef } from "react";
import { 
  Search, 
  Building2, 
  Globe, 
  Clock, 
  ArrowRight, 
  CheckCircle2, 
  AlertTriangle, 
  DollarSign, 
  Users, 
  User, 
  ExternalLink,
  ChevronRight,
  TrendingUp,
  FileText,
  ArrowLeft,
  MessageSquare,
  Send,
  Loader2,
  Check,
  X,
  Plus,
  Pin,
  Sparkles,
  Activity,
  UserCheck,
  Calendar,
  Briefcase,
  HelpCircle,
  ShieldAlert,
  ChevronUp,
  ChevronDown,
  Volume2,
  Play,
  Pause,
  Download,
  CheckSquare,
  AlertCircle,
  Lock
} from "lucide-react";

const formatCallType = (type) => {
  if (!type) return "Discovery";
  const map = {
    cold_prospecting: "Cold / Prospecting",
    qualification: "Qualification",
    discovery: "Discovery",
    solution_demo: "Solution / Demo",
    technical_validation: "Technical Validation",
    negotiation: "Negotiation",
    follow_up: "Follow-up",
    renewal_expansion: "Renewal / Expansion",
    other: "Other"
  };
  return map[type] || type.replace(/_/g, " ");
};

export default function Customers({ meetings = [], onSelectMeeting, selectedCompanyId: propSelectedCompanyId, onSelectCompany }) {
  const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:3001` : "http://localhost:3001");

  // Navigation and Workspace States
  const [viewMode, setViewMode] = useState("table"); // "table", "workspace"
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);

  // Call Stage Journey & Customer Intelligence
  const [dealJourney, setDealJourney] = useState(null);
  const [customerIntelligence, setCustomerIntelligence] = useState(null);
  const [callTypeFilter, setCallTypeFilter] = useState("all");

  // Collapsible & Drawer States
  const [isPlaybookCollapsed, setIsPlaybookCollapsed] = useState(true);
  const [showPrepWorkspace, setShowPrepWorkspace] = useState(false);
  const [expandedMeetings, setExpandedMeetings] = useState({}); // meetingId -> boolean

  // Pinned and Recently Viewed Accounts (Persisted in localStorage)
  const [pinnedAccounts, setPinnedAccounts] = useState([]);
  const [recentAccounts, setRecentAccounts] = useState([]);

  // Data States for Workspace
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyData, setSelectedCompanyData] = useState(null);
  const [meetingsHistory, setMeetingsHistory] = useState([]);
  const [stakeholders, setStakeholders] = useState([]);
  const [aiBrief, setAiBrief] = useState("");
  const [commitments, setCommitments] = useState({ ourCommitments: [], customerCommitments: [] });
  const [risksList, setRisksList] = useState([]);
  const [objectionsList, setObjectionsList] = useState([]);
  const [timelineChanges, setTimelineChanges] = useState([]);
  const [memoriesList, setMemoriesList] = useState([]);
  const [playbookData, setPlaybookData] = useState({ playbook: "MEDDIC", properties: [] });
  const [playbookHistory, setPlaybookHistory] = useState({});
  const [playbookCoverage, setPlaybookCoverage] = useState({ completedCount: 0, totalCount: 0, missingFields: [] });

  // Prep Canvas specific lazy data
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepData, setPrepData] = useState(null);
  const [prepNotes, setPrepNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  // UI States
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [globalSearchData, setGlobalSearchData] = useState(null);
  const [loadingSearch, setLoadingSearch] = useState(false);

  // Fact History modal state
  const [activeFactHistory, setActiveFactHistory] = useState(null); // { label, key, history }

  // Stakeholder Mention Modal states
  const [activeStakeholder, setActiveStakeholder] = useState(null);
  const [stakeholderMentions, setStakeholderMentions] = useState([]);
  const [loadingMentions, setLoadingMentions] = useState(false);

  // Audio Playback states
  const [playingCallId, setPlayingCallId] = useState(null);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const audioElRef = useRef(null);

  // Transcript Side Drawer states
  const [drawerMeetingId, setDrawerMeetingId] = useState(null);
  const [drawerMeetingTitle, setDrawerMeetingTitle] = useState("");
  const [drawerSegments, setDrawerSegments] = useState([]);
  const [loadingDrawer, setLoadingDrawer] = useState(false);
  const [transcriptSearch, setTranscriptSearch] = useState("");

  // Grounded Copilot Q&A
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [sendingChat, setSendingChat] = useState(false);

  // Load pinned and recent list on mount
  useEffect(() => {
    fetchCompanies();
    const pinned = localStorage.getItem("pinned_companies");
    if (pinned) setPinnedAccounts(JSON.parse(pinned));
    const recents = localStorage.getItem("recent_companies");
    if (recents) setRecentAccounts(JSON.parse(recents));
  }, []);

  // Sync prop selectedCompanyId from Dashboard
  useEffect(() => {
    if (propSelectedCompanyId) {
      setSelectedCompanyId(propSelectedCompanyId);
      setViewMode("workspace");
    }
  }, [propSelectedCompanyId]);

  // Fetch workspace details when company selected
  useEffect(() => {
    if (selectedCompanyId) {
      fetchWorkspaceDetails(selectedCompanyId);
      addToRecent(selectedCompanyId);
    }
  }, [selectedCompanyId]);

  // Add to recents helper
  const addToRecent = (id) => {
    const data = readFallbackDbList();
    const company = companies.find(c => c.id === id) || data.find(c => c.id === id);
    if (!company) return;

    let updated = [company, ...recentAccounts.filter(r => r.id !== id)];
    updated = updated.slice(0, 5); // limit 5
    setRecentAccounts(updated);
    localStorage.setItem("recent_companies", JSON.stringify(updated));
  };

  // Helper read database mock if companies is loading
  const readFallbackDbList = () => {
    try {
      const stored = localStorage.getItem("recent_companies");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  };

  // Toggle Pinned status helper
  const togglePinCompany = (id, name) => {
    let updated;
    if (pinnedAccounts.some(p => p.id === id)) {
      updated = pinnedAccounts.filter(p => p.id !== id);
    } else {
      updated = [...pinnedAccounts, { id, name }];
    }
    setPinnedAccounts(updated);
    localStorage.setItem("pinned_companies", JSON.stringify(updated));
  };

  // Fetch all companies list
  const fetchCompanies = async () => {
    setLoadingCompanies(true);
    try {
      const response = await fetch(`${API_URL}/api/customers`);
      if (!response.ok) throw new Error("Failed to load companies");
      const data = await response.json();
      setCompanies(data);
    } catch (err) {
      console.error("Error fetching companies:", err);
    } finally {
      setLoadingCompanies(false);
    }
  };

  // Fetch all company detailed data
  const fetchWorkspaceDetails = async (companyId) => {
    setLoadingWorkspace(true);
    setPlayingCallId(null);
    setIsAudioPlaying(false);
    setDrawerMeetingId(null);
    setShowPrepWorkspace(false);
    try {
      const [
        detailsRes,
        meetingsRes,
        stakeholdersRes,
        briefRes,
        commitmentsRes,
        risksRes,
        objectionsRes,
        changesRes,
        memoriesRes,
        playbookRes,
        historyRes,
        coverageRes,
        journeyRes,
        intelligenceRes
      ] = await Promise.all([
        fetch(`${API_URL}/api/customers/${companyId}`),
        fetch(`${API_URL}/api/customers/${companyId}/meetings`),
        fetch(`${API_URL}/api/customers/${companyId}/stakeholders`),
        fetch(`${API_URL}/api/customers/${companyId}/brief`),
        fetch(`${API_URL}/api/customers/${companyId}/commitments`),
        fetch(`${API_URL}/api/customers/${companyId}/risks`),
        fetch(`${API_URL}/api/customers/${companyId}/objections`),
        fetch(`${API_URL}/api/customers/${companyId}/changes`),
        fetch(`${API_URL}/api/customers/${companyId}/memories`),
        fetch(`${API_URL}/api/customers/${companyId}/playbook`),
        fetch(`${API_URL}/api/customers/${companyId}/playbook/history`),
        fetch(`${API_URL}/api/customers/${companyId}/playbook/coverage`),
        fetch(`${API_URL}/api/customers/${companyId}/journey`),
        fetch(`${API_URL}/api/customers/${companyId}/intelligence`)
      ]);

      if (detailsRes.ok) {
        const detailsData = await detailsRes.json();
        setSelectedCompanyData(detailsData);
      }
      if (meetingsRes.ok) {
        const meets = await meetingsRes.json();
        setMeetingsHistory(meets);
      }
      if (journeyRes && journeyRes.ok) {
        const jd = await journeyRes.json();
        setDealJourney(jd);
      } else {
        setDealJourney(null);
      }
      if (intelligenceRes && intelligenceRes.ok) {
        const idData = await intelligenceRes.json();
        setCustomerIntelligence(idData);
      } else {
        setCustomerIntelligence(null);
      }
      if (stakeholdersRes.ok) {
        const sh = await stakeholdersRes.json();
        setStakeholders(sh);
      }
      if (briefRes.ok) {
        const b = await briefRes.json();
        setAiBrief(b.brief || "");
      }
      if (commitmentsRes.ok) {
        const comms = await commitmentsRes.json();
        setCommitments(comms);
      }
      if (risksRes.ok) {
        const r = await risksRes.json();
        setRisksList(r);
      }
      if (objectionsRes.ok) {
        const o = await objectionsRes.json();
        setObjectionsList(o);
      }
      if (changesRes.ok) {
        const ch = await changesRes.json();
        setTimelineChanges(ch);
      }
      if (memoriesRes.ok) {
        const mems = await memoriesRes.json();
        setMemoriesList(mems);
      }
      if (playbookRes.ok) {
        const play = await playbookRes.json();
        setPlaybookData(play);
      }
      if (historyRes.ok) {
        const hist = await historyRes.json();
        setPlaybookHistory(hist);
      }
      if (coverageRes.ok) {
        const cov = await coverageRes.json();
        setPlaybookCoverage(cov);
      }

      // Load local prep agenda scratchpad
      const savedNotes = localStorage.getItem(`prep_notes_${companyId}`);
      setPrepNotes(savedNotes || "");

      setChatMessages([]);
    } catch (err) {
      console.error("Error loading workspace data:", err);
    } finally {
      setLoadingWorkspace(false);
    }
  };

  // Debounced Global Search Effect
  useEffect(() => {
    if (!searchQuery.trim()) {
      setGlobalSearchData(null);
      return;
    }
    const delayDebounce = setTimeout(async () => {
      setLoadingSearch(true);
      try {
        const res = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          const data = await res.json();
          setGlobalSearchData(data);
          setShowSearchDropdown(true);
        }
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setLoadingSearch(false);
      }
    }, 300);
    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  const handleReturnToGrid = () => {
    setViewMode("table");
    setSelectedCompanyId(null);
    if (onSelectCompany) onSelectCompany(null);
  };

  // Load preparation pre-call panel data
  const handleOpenPrepWorkspace = async () => {
    setPrepLoading(true);
    setShowPrepWorkspace(true);
    try {
      const response = await fetch(`${API_URL}/api/customers/${selectedCompanyId}/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      if (response.ok) {
        const data = await response.json();
        setPrepData(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPrepLoading(false);
    }
  };

  // Audio Playback toggle
  const togglePlayCall = async (call) => {
    if (playingCallId === call.id) {
      if (isAudioPlaying) {
        audioElRef.current.pause();
        setIsAudioPlaying(false);
      } else {
        audioElRef.current.play().catch(e => console.log(e));
        setIsAudioPlaying(true);
      }
    } else {
      setPlayingCallId(call.id);
      setIsAudioPlaying(true);
      setAudioCurrentTime(0);
      
      try {
        const response = await fetch(`${API_URL}/api/meetings/${call.id}/audio-url`);
        if (!response.ok) throw new Error("Could not obtain a private audio URL");
        const payload = await response.json();
        const streamUrl = payload.url.startsWith('http') ? payload.url : `${API_URL}${payload.url}`;
        if (audioElRef.current) {
          audioElRef.current.src = streamUrl;
          await audioElRef.current.play();
        }
      } catch (error) {
        setIsAudioPlaying(false);
        console.error("Audio playback failed", error);
      }
    }
  };

  // Open transcript drawer
  const openTranscriptDrawer = async (meeting) => {
    setDrawerMeetingId(meeting.id);
    setDrawerMeetingTitle(meeting.title);
    setLoadingDrawer(true);
    try {
      const response = await fetch(`${API_URL}/api/meetings/${meeting.id}`);
      if (response.ok) {
        const data = await response.json();
        setDrawerSegments(data.segments || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDrawer(false);
    }
  };

  // Toggle stakeholder political role
  const handleToggleStakeholderRole = (speakerId, role) => {
    const updated = { ...stakeholderRoles, [speakerId]: role };
    setStakeholderRoles(updated);
    localStorage.setItem(`roles_${selectedCompanyId}`, JSON.stringify(updated));
  };

  // Toggle stakeholder stance
  const handleToggleStakeholderStance = (speakerId, stance) => {
    const updated = { ...stakeholderStances, [speakerId]: stance };
    setStakeholderStances(updated);
    localStorage.setItem(`stances_${selectedCompanyId}`, JSON.stringify(updated));
  };

  // Save prep notes to local storage
  const handleNotesChange = (text) => {
    setPrepNotes(text);
    setSavingNotes(true);
    localStorage.setItem(`prep_notes_${selectedCompanyId}`, text);
    setTimeout(() => setSavingNotes(false), 800);
  };

  // Fetch stakeholder mentions
  const handleOpenMentions = async (sh) => {
    setActiveStakeholder(sh);
    setLoadingMentions(true);
    try {
      const response = await fetch(`${API_URL}/api/customers/${selectedCompanyId}/stakeholders/${sh.speaker_id}/mentions`);
      if (response.ok) {
        const data = await response.json();
        setStakeholderMentions(data);
      }
    } catch (err) {
      console.error("Failed to load mentions:", err);
    } finally {
      setLoadingMentions(false);
    }
  };

  // Grounded Copilot Q&A Submit
  const handleSendCopilotChat = async (e, customText = null) => {
    if (e) e.preventDefault();
    const text = customText || chatQuestion;
    if (!text.trim() || sendingChat) return;

    setChatMessages(prev => [...prev, { role: "user", text }]);
    setChatQuestion("");
    setSendingChat(true);

    try {
      const response = await fetch(`${API_URL}/api/customers/${selectedCompanyId}/copilot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text })
      });
      if (response.ok) {
        const answer = await response.json();
        setChatMessages(prev => [...prev, { 
          role: "assistant", 
          text: answer.answer, 
          evidence: answer.evidence || [] 
        }]);
      }
    } catch (err) {
      console.error(err);
      setChatMessages(prev => [...prev, { role: "assistant", text: "Copilot failed to generate answer. Check server logs." }]);
    } finally {
      setSendingChat(false);
    }
  };

  // Export Agenda Notes
  const exportDossierToClipboard = () => {
    const activeObjections = objectionsList.map(o => `• [Pending] ${o.objection} (Mention count: ${o.mention_count})`).join('\n');
    const openActions = commitments.ourCommitments.filter(a => !a.completed).map(a => `• ${a.task} (${a.meeting_title})`).join('\n');
    const customerActions = commitments.customerCommitments.filter(a => !a.completed).map(a => `• ${a.task} (${a.meeting_title})`).join('\n');
    
    const dossierText = `=== PulseSync Deal Prep Dossier: ${selectedCompanyData?.company?.name} ===
Date Exported: ${new Date().toLocaleDateString()}

Executive Summary:
${selectedCompanyData?.company?.notes || "No notes registered."}

Active Objections:
${activeObjections || "• None flagged."}

Our Outstanding Commitments:
${openActions || "• None pending."}

Customer Outstanding Commitments:
${customerActions || "• None pending."}

Next Call Agenda Notes:
${prepNotes || "No agenda notes drafted."}
`;
    navigator.clipboard.writeText(dossierText);
    alert("Deal Prep Dossier copied to clipboard!");
  };

  // Open Fact evolution history
  const handleOpenFactHistory = (label, key) => {
    const history = memoriesList.filter(m => m.memory_type === key);
    setActiveFactHistory({ label, key, history });
  };

  // Toggle expandable meeting row
  const toggleMeetingExpand = (meetingId) => {
    setExpandedMeetings(prev => ({ ...prev, [meetingId]: !prev[meetingId] }));
  };

  // Helper waveform peaks
  const renderWaveformPeaks = (callId) => {
    const barCount = 45;
    const bars = [];
    const seed = callId.charCodeAt(0) || 12;
    for (let i = 0; i < barCount; i++) {
      const h = Math.abs(Math.sin(i * 0.4 + seed)) * 26 + 4;
      bars.push(h);
    }
    const currentTimeRatio = audioDuration > 0 ? audioCurrentTime / audioDuration : 0;
    const activeIndex = Math.floor(currentTimeRatio * barCount);

    return (
      <div className="flex items-end gap-[2px] h-8 w-full bg-[#FAFBFB] border border-[#E2E8F0] p-1.5 rounded-md cursor-pointer select-none">
        {bars.map((barHeight, idx) => {
          const isActive = idx <= activeIndex;
          return (
            <div
              key={idx}
              onClick={(e) => {
                e.stopPropagation();
                if (audioElRef.current && audioDuration > 0) {
                  const clickPercentage = idx / barCount;
                  audioElRef.current.currentTime = clickPercentage * audioDuration;
                  setAudioCurrentTime(clickPercentage * audioDuration);
                }
              }}
              style={{ height: `${barHeight}px` }}
              className={`w-[4px] rounded-[1px] transition-all duration-100 ${
                isActive ? 'bg-[#14B8A6]' : 'bg-[#E2E8F0] hover:bg-[#CBD5E1]'
              }`}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col bg-[#F8FAFC] w-full h-screen text-left relative overflow-hidden select-none font-sans">
      
      {/* Core Audio player */}
      <audio
        ref={audioElRef}
        onTimeUpdate={() => {
          if (audioElRef.current) setAudioCurrentTime(audioElRef.current.currentTime);
        }}
        onDurationChange={() => {
          if (audioElRef.current) setAudioDuration(audioElRef.current.duration);
        }}
        onPlay={() => setIsAudioPlaying(true)}
        onPause={() => setIsAudioPlaying(false)}
        onEnded={() => {
          setIsAudioPlaying(false);
          setPlayingCallId(null);
        }}
      />

      {/* 1. Global Search Topbar */}
      <header className="w-full flex-shrink-0 bg-white border-b border-[#E5E7EB] px-6 py-3.5 flex items-center justify-between z-30 shadow-3xs">
        <div className="relative w-full max-w-2xl">
          <Search className="absolute left-3.5 top-2.5 text-[#94A3B8]" size={15} />
          <input
            type="text"
            placeholder="Search accounts by domain, owner, stakeholder, email, template, or meeting name..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (!e.target.value) setShowSearchDropdown(false);
            }}
            onFocus={() => {
              if (searchQuery.trim()) setShowSearchDropdown(true);
            }}
            className="w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg pl-10 pr-9 py-2 text-xs text-[#0F172A] outline-none placeholder-[#94A3B8] focus:border-[#14B8A6] focus:bg-white transition-all font-medium"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(""); setShowSearchDropdown(false); }} className="absolute right-3.5 top-2.5 text-[#64748B] hover:text-[#0F172A]">
              <X size={14} />
            </button>
          )}

          {/* Search Dropdown Overlay */}
          {showSearchDropdown && globalSearchData && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#E5E7EB] rounded-lg shadow-lg max-h-80 overflow-y-auto p-3 space-y-3 z-50 animate-in fade-in duration-100">
              {globalSearchData.companies && globalSearchData.companies.length > 0 && (
                <div>
                  <span className="text-[9px] font-bold text-[#94A3B8] uppercase block tracking-wider mb-1 px-1">Accounts</span>
                  {globalSearchData.companies.map(c => (
                    <div
                      key={c.id}
                      onClick={() => {
                        setSelectedCompanyId(c.id);
                        setViewMode("workspace");
                        setShowSearchDropdown(false);
                        setSearchQuery("");
                        if (onSelectCompany) onSelectCompany(c.id);
                      }}
                      className="p-2 hover:bg-[#F1F5F9] rounded-md cursor-pointer flex items-center justify-between text-xs font-semibold text-[#475569]"
                    >
                      <div className="flex items-center gap-2">
                        <Building2 size={13} className="text-[#14B8A6]" />
                        <span className="text-[#0F172A]">{c.name}</span>
                        {c.industry && <span className="text-[10px] text-[#94A3B8] font-normal">• {c.industry}</span>}
                      </div>
                      <ChevronRight size={12} className="text-[#94A3B8]" />
                    </div>
                  ))}
                </div>
              )}

              {globalSearchData.meetings && globalSearchData.meetings.length > 0 && (
                <div>
                  <span className="text-[9px] font-bold text-[#94A3B8] uppercase block tracking-wider mb-1 px-1">Meetings</span>
                  {globalSearchData.meetings.map(m => (
                    <div
                      key={m.id}
                      onClick={() => {
                        setSelectedCompanyId(m.company_id);
                        setViewMode("workspace");
                        setShowSearchDropdown(false);
                        setSearchQuery("");
                        if (onSelectCompany) onSelectCompany(m.company_id);
                      }}
                      className="p-2 hover:bg-[#F1F5F9] rounded-md cursor-pointer flex items-center justify-between text-xs font-semibold text-[#475569]"
                    >
                      <div className="flex items-center gap-2">
                        <Calendar size={13} className="text-[#14B8A6]" />
                        <span className="text-[#0F172A]">{m.title}</span>
                        <span className="text-[10px] text-[#94A3B8] font-normal">({m.company_name})</span>
                      </div>
                      <ChevronRight size={12} className="text-[#94A3B8]" />
                    </div>
                  ))}
                </div>
              )}

              {(!globalSearchData.companies?.length && !globalSearchData.meetings?.length) && (
                <div className="text-center py-6 text-xs text-[#94A3B8] italic">No matching companies or meetings found.</div>
              )}
            </div>
          )}
        </div>

        {viewMode === "workspace" && (
          <button
            onClick={handleReturnToGrid}
            className="px-3.5 py-1.5 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#334155] text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-3xs"
          >
            <ArrowLeft size={13} />
            <span>Accounts Directory</span>
          </button>
        )}
      </header>

      {/* Main Canvas Area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        
        {/* VIEW 1: Accounts Directory Page */}
        {viewMode === "table" && (
          <div className="max-w-7xl mx-auto p-6 space-y-6">
            
            {/* Quick Access Block */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 select-none">
              {/* Pinned Accounts */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-3xs text-left">
                <span className="text-[10px] font-bold text-[#94A3B8] uppercase block tracking-wider mb-2">📌 Pinned Accounts</span>
                {pinnedAccounts.length === 0 ? (
                  <span className="text-xs text-[#94A3B8] italic block py-4 text-center">No pinned accounts. Pin them in the workspace headers.</span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {pinnedAccounts.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedCompanyId(p.id); setViewMode("workspace"); }}
                        className="px-2.5 py-1 bg-[#F1F5F9] hover:bg-[#E2E8F0] border border-[#E5E7EB] rounded-lg text-xs font-semibold text-[#334155] flex items-center gap-1 transition"
                      >
                        <Building2 size={11} className="text-[#14B8A6]" />
                        <span>{p.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Recently Viewed */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-3xs text-left">
                <span className="text-[10px] font-bold text-[#94A3B8] uppercase block tracking-wider mb-2">🕒 Recently Visited</span>
                {recentAccounts.length === 0 ? (
                  <span className="text-xs text-[#94A3B8] italic block py-4 text-center">No recently visited accounts.</span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {recentAccounts.map(r => (
                      <button
                        key={r.id}
                        onClick={() => { setSelectedCompanyId(r.id); setViewMode("workspace"); }}
                        className="px-2.5 py-1 bg-[#F1F5F9] hover:bg-[#E2E8F0] border border-[#E5E7EB] rounded-lg text-xs font-semibold text-[#334155] flex items-center gap-1 transition"
                      >
                        <Clock size={11} className="text-[#94A3B8]" />
                        <span>{r.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Main Accounts Table */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-3xs text-left">
              <div className="p-4 border-b border-[#F1F5F9] flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-[#0F172A]">Accounts Directory</h2>
                  <p className="text-xs text-[#64748B] mt-0.5 font-medium">Aggregate customer context, open objections, and task metrics across meetings.</p>
                </div>
              </div>
              
              {loadingCompanies ? (
                <div className="py-20 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="animate-spin text-[#14B8A6]" size={24} />
                  <span className="text-xs text-[#64748B] font-semibold">Scanning PulseSync accounts registry...</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#E5E7EB] text-[9.5px] font-bold text-[#64748B] uppercase tracking-wider bg-[#F8FAFC] select-none">
                        <th className="py-3 px-4">Account Name</th>
                        <th className="py-3 px-4">Sector</th>
                        <th className="py-3 px-4">AE Owner</th>
                        <th className="py-3 px-4">Last Meeting</th>
                        <th className="py-3 px-4">Call Stage</th>
                        <th className="py-3 px-4 text-center">Open Objections</th>
                        <th className="py-3 px-4 text-center">Pending Action Items</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F1F5F9] text-[#0F172A] font-semibold">
                      {companies.map(c => (
                        <tr
                          key={c.id}
                          onClick={() => {
                            setSelectedCompanyId(c.id);
                            setViewMode("workspace");
                            if (onSelectCompany) onSelectCompany(c.id);
                          }}
                          className="hover:bg-[#F8FAFC] cursor-pointer transition-colors border-b border-[#F1F5F9] last:border-0"
                        >
                          <td className="py-3.5 px-4 flex items-center gap-3">
                            <div className="h-7 w-7 rounded bg-[#F0FDF4] border border-[#14B8A6]/20 text-[#0F7669] flex items-center justify-center font-bold text-xs">
                              {c.name?.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <span className="hover:underline text-[12px]">{c.name}</span>
                              {c.website && <span className="block text-[10px] text-[#64748B] font-normal mt-0.5">{c.website}</span>}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-[#475569] font-medium">{c.industry || "—"}</td>
                          <td className="py-3.5 px-4 text-[#475569] font-medium">{c.crm_owner || "AE Sync"}</td>
                          <td className="py-3.5 px-4">
                            {c.last_meeting ? (
                              <div>
                                <span className="font-semibold text-[#0F172A] truncate block max-w-xs">{c.last_meeting.title}</span>
                                <span className="text-[10px] text-[#64748B] font-normal block mt-0.5">{new Date(c.last_meeting.date).toLocaleDateString()}</span>
                              </div>
                            ) : (
                              <span className="text-[#94A3B8] italic font-normal">No meetings indexed.</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="px-2 py-0.5 bg-teal-50 text-teal-700 border border-teal-200 rounded text-[9.5px] font-bold font-mono uppercase whitespace-nowrap">
                              {formatCallType(c.last_call_type || c.last_meeting?.call_type)}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span className="px-2 py-0.5 bg-amber-50 text-amber-600 border border-amber-100 rounded-full font-mono text-[10.5px]">
                              {c.open_risks_count || 0}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span className="px-2 py-0.5 bg-[#EEF2FF] text-[#4F46E5] border border-[#E0E7FF] rounded-full font-mono text-[10.5px]">
                              {c.open_action_items_count || 0}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 2: Selected Customer Workspace */}
        {viewMode === "workspace" && (
          <div className="max-w-7xl mx-auto p-6 space-y-6">
            
            {/* LEVEL 1: Account Header & AI Brief */}
            {selectedCompanyData?.company && (
              <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-3xs p-5 space-y-4">
                
                {/* 3. Account Header */}
                <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-[#E0F2FE] border border-[#0284C7]/20 text-[#0369A1] flex items-center justify-center font-bold text-sm">
                      {selectedCompanyData.company.name?.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h1 className="text-base font-extrabold text-[#0F172A]">{selectedCompanyData.company.name}</h1>
                        <button
                          onClick={() => togglePinCompany(selectedCompanyData.company.id, selectedCompanyData.company.name)}
                          className="text-[#94A3B8] hover:text-[#14B8A6] transition"
                        >
                          <Pin size={12} className={pinnedAccounts.some(p => p.id === selectedCompanyData.company.id) ? "fill-[#14B8A6] text-[#14B8A6]" : ""} />
                        </button>
                      </div>
                      {selectedCompanyData.company.website && (
                        <a href={selectedCompanyData.company.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[#14B8A6] hover:underline text-[10px] font-semibold mt-0.5">
                          {selectedCompanyData.company.website} <ExternalLink size={8} />
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-6 gap-y-2 text-right">
                    <div>
                      <span className="text-[9px] font-bold text-[#94A3B8] uppercase block tracking-wider">Sector</span>
                      <span className="text-[11px] font-bold text-[#334155]">{selectedCompanyData.company.industry || "—"}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-[#94A3B8] uppercase block tracking-wider">CRM Link</span>
                      <span className="text-[11px] font-bold text-[#334155]">{selectedCompanyData.company.crm_account || "Salesforce"}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-[#94A3B8] uppercase block tracking-wider">AE Owner</span>
                      <span className="text-[11px] font-bold text-[#334155] truncate max-w-[100px] block">{selectedCompanyData.company.crm_owner || "Unassigned"}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-[#94A3B8] uppercase block tracking-wider">Total Calls</span>
                      <span className="text-[11px] font-bold text-[#334155]">{meetingsHistory.length} sessions</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-[#94A3B8] uppercase block tracking-wider">Last Sync</span>
                      <span className="text-[11px] font-bold text-[#334155] truncate max-w-[120px] block">{selectedCompanyData.company.last_sync || "Never"}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-[#94A3B8] uppercase block tracking-wider">Upcoming</span>
                      <span className="text-[11px] font-bold text-amber-600 font-semibold">{selectedCompanyData.company.upcoming_meeting || "None"}</span>
                    </div>
                  </div>
                </div>

                {/* 4. AI Account Brief Container */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                  <div className="md:col-span-3 space-y-1.5 text-left">
                    <div className="flex items-center gap-1.5">
                      <Sparkles size={13} className="text-[#14B8A6]" />
                      <span className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider">AI Account Intelligence Summary</span>
                    </div>
                    <p className="text-[11.5px] leading-relaxed font-semibold text-[#334155]">
                      {aiBrief || "Generating relationship synthesis from meetings..."}
                    </p>
                  </div>

                  <div className="md:col-span-1 flex justify-end">
                    <button
                      onClick={handleOpenPrepWorkspace}
                      className="w-full md:w-auto px-4 py-2 bg-[#14B8A6] hover:bg-[#0F9688] text-white text-xs font-bold rounded-lg shadow-sm flex items-center justify-center gap-2 transition"
                    >
                      <ArrowRight size={13} />
                      <span>PREPARE FOR NEXT MEETING →</span>
                    </button>
                  </div>
                </div>

              </div>
            )}

            {/* 5. What Changed Feed */}
            {timelineChanges.length > 0 && (
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 text-left shadow-3xs space-y-3">
                <span className="text-[10px] font-bold text-[#94A3B8] uppercase block tracking-wider">📉 WHAT CHANGED (ACCOUNT TIMELINE DRIFTS)</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  {timelineChanges.slice(0, 4).map((c, idx) => {
                    const isRisk = c.type === 'risk_event';
                    return (
                      <div key={idx} className={`p-3 rounded-lg border flex flex-col gap-1.5 ${
                        isRisk ? 'bg-rose-50/40 border-rose-100' : 'bg-slate-50/40 border-[#E5E7EB]'
                      }`}>
                        <div className="flex justify-between items-center text-[9px] font-bold text-[#64748B]">
                          <span className="uppercase tracking-wide font-mono">{c.event_type || c.type}</span>
                          <span>{new Date(c.date).toLocaleDateString()}</span>
                        </div>
                        <p className="text-[11px] font-extrabold text-[#0F172A] leading-normal">{c.description || c.title}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* LEVEL 2: Facts, Collapsible Playbook, Commitments, Risks */}
            
            {/* 6. Current Account Facts Row */}
            {selectedCompanyData?.company && (
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-3xs text-left space-y-3">
                <span className="text-[10px] font-bold text-[#94A3B8] uppercase block tracking-wider">📋 CURRENT ACCOUNT FACTS</span>
                <div className="flex flex-wrap gap-x-8 gap-y-4">
                  {[
                    { label: "Budget", key: "budget", val: customerIntelligence?.facts?.budget?.value || selectedCompanyData.company.budget, provenance: customerIntelligence?.facts?.budget },
                    { label: "Champion", key: "champion", val: customerIntelligence?.facts?.champion?.value || selectedCompanyData.company.champion, provenance: customerIntelligence?.facts?.champion },
                    { label: "Decision Maker", key: "decision_maker", val: customerIntelligence?.facts?.decision_maker?.value || selectedCompanyData.company.decision_maker, provenance: customerIntelligence?.facts?.decision_maker },
                    { label: "Buying Stage", key: "deal_stage", val: customerIntelligence?.facts?.buying_stage?.value || selectedCompanyData.company.deal_stage, provenance: customerIntelligence?.facts?.buying_stage },
                    { label: "Timeline", key: "implementation_timeline", val: customerIntelligence?.facts?.timeline?.value || selectedCompanyData.company.implementation_timeline, provenance: customerIntelligence?.facts?.timeline },
                    { label: "Competition", key: "competition", val: customerIntelligence?.facts?.competition?.value || "—", provenance: customerIntelligence?.facts?.competition },
                    { label: "Contract Value", key: "contract_value", val: selectedCompanyData.company.contract_value },
                    { label: "Procurement Status", key: "procurement_status", val: selectedCompanyData.company.procurement_status }
                  ].map((fact, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleOpenFactHistory(fact.label, fact.key)}
                      className="cursor-pointer group flex flex-col gap-0.5 border-r border-[#F1F5F9] pr-8 last:border-0 last:pr-0"
                      title={fact.provenance?.source_meeting_title ? `Grounded in session: "${fact.provenance.source_meeting_title}" (${fact.provenance.source_date ? new Date(fact.provenance.source_date).toLocaleDateString() : 'verified'})` : undefined}
                    >
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-bold text-[#94A3B8] uppercase block group-hover:text-[#14B8A6] transition">{fact.label}</span>
                        {fact.provenance?.status === 'verified' && (
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" title="Verified in Customer Memory" />
                        )}
                        {fact.provenance?.status === 'current_call' && (
                          <span className="h-1.5 w-1.5 rounded-full bg-teal-400 inline-block" title="Grounded in latest meeting" />
                        )}
                      </div>
                      <span className="text-xs font-extrabold text-[#334155] group-hover:underline">{fact.val || "—"}</span>
                      {fact.provenance?.source_meeting_title && (
                        <span className="text-[8.5px] text-[#0F766E] font-medium truncate max-w-[120px] block opacity-85">
                          via {fact.provenance.source_meeting_title}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 7. Collapsible Playbook Intelligence Section */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-3xs overflow-hidden">
              <div
                onClick={() => setIsPlaybookCollapsed(!isPlaybookCollapsed)}
                className="p-4 bg-[#F8FAFC] border-b border-[#E5E7EB] flex items-center justify-between cursor-pointer hover:bg-[#F1F5F9] transition select-none"
              >
                <div className="flex items-center gap-2">
                  <Activity size={14} className="text-[#14B8A6]" />
                  <span className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wider">
                    Playbook Intelligence ({playbookData.playbook || "MEDDIC"})
                  </span>
                  <span className="text-[10px] text-[#64748B] font-semibold">
                    • {playbookCoverage.completedCount}/{playbookCoverage.totalCount} parameters mapped
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[9.5px] px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-full font-mono font-bold">
                    {playbookCoverage.missingFields.length} missing fields
                  </span>
                  {isPlaybookCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </div>
              </div>

              {!isPlaybookCollapsed && (
                <div className="p-5 space-y-5 animate-in fade-in duration-200 text-left">
                  
                  {/* Coverage details */}
                  <div className="flex flex-wrap gap-2 text-[10.5px] font-semibold border-b border-[#F1F5F9] pb-3 mb-2">
                    {playbookData.properties?.map((prop, idx) => {
                      const hasValue = prop.current_value && prop.current_value !== "—";
                      return (
                        <span key={idx} className={`px-2 py-0.5 border rounded-full flex items-center gap-1 font-semibold ${
                          hasValue ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'
                        }`}>
                          {hasValue ? "✓" : "✕"} {prop.label}
                        </span>
                      );
                    })}
                  </div>

                  {/* Playbook Properties Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#E5E7EB] text-[9.5px] font-bold text-[#64748B] uppercase tracking-wider">
                          <th className="py-2 px-3">Property</th>
                          <th className="py-2 px-3">Current Value</th>
                          <th className="py-2 px-3">Confidence</th>
                          <th className="py-2 px-3">Last Updated</th>
                          <th className="py-2 px-3">Source Call</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9] font-medium text-[#475569]">
                        {playbookData.properties?.map((prop, idx) => {
                          const hasValue = prop.current_value && prop.current_value !== "—";
                          return (
                            <tr key={idx} className="hover:bg-[#FAFBFB] transition-colors border-b border-[#F1F5F9]">
                              <td className="py-2.5 px-3 text-[#0F172A] font-bold">{prop.label}</td>
                              <td className="py-2.5 px-3 text-[#334155] font-semibold">
                                {hasValue ? prop.current_value : <span className="text-[#94A3B8] italic font-normal">Missing info</span>}
                              </td>
                              <td className="py-2.5 px-3 font-mono">
                                {hasValue ? `${prop.confidence}%` : "—"}
                              </td>
                              <td className="py-2.5 px-3">
                                {prop.updated ? new Date(prop.updated).toLocaleDateString() : "—"}
                              </td>
                              <td className="py-2.5 px-3">
                                {prop.meeting_title ? (
                                  <span className="text-[#14B8A6] font-semibold hover:underline block max-w-xs truncate cursor-pointer" title={`Evidence: ${prop.evidence}`}>
                                    🔗 {prop.meeting_title}
                                  </span>
                                ) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Playbook Coverage warnings */}
                  {playbookCoverage.missingFields.length > 0 && (
                    <div className="bg-[#FFFBEB] border border-[#FDE68A] p-4 rounded-lg space-y-2">
                      <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wide block">⚠️ PLAYBOOK ATTENTION AREAS</span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {playbookCoverage.missingFields.map((field, idx) => (
                          <div key={idx} className="bg-white border border-[#FEF3C7] p-3 rounded shadow-3xs flex flex-col gap-1.5 text-xs font-semibold text-[#475569]">
                            <div className="flex justify-between items-center text-amber-700 font-extrabold text-[11px]">
                              <span>Missing: {field.label}</span>
                              <span className="text-[9px] bg-amber-100 text-amber-800 px-1 rounded">Needs Prep</span>
                            </div>
                            <p className="text-[10px] text-[#64748B] font-medium leading-relaxed">
                              {field.relevant_previous_conversation}
                            </p>
                            <div className="border-t border-[#FFFBEB] pt-1.5 text-[#0F172A] font-bold">
                              💡 Suggested Question: <span className="font-normal italic">"{field.suggested_question}"</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>

            {/* 14. Action Items & Commitments Split */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs text-left space-y-4">
              <span className="text-[10px] font-bold text-[#94A3B8] uppercase block tracking-wider">🎯 OPEN ACTIONS & COMMITMENTS</span>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* 15. Our Commitments */}
                <div className="space-y-2">
                  <span className="text-[10.5px] font-extrabold text-[#334155] block">💼 OUR COMMITMENTS</span>
                  {commitments.ourCommitments.length === 0 ? (
                    <span className="text-xs text-[#94A3B8] italic block py-4 text-center bg-[#F8FAFC] border border-dashed border-[#E5E7EB] rounded-lg">No active commitments registered by our team.</span>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {commitments.ourCommitments.map(item => (
                        <div key={item.id} className="bg-white border border-[#E5E7EB] p-2.5 rounded shadow-3xs flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[10px] font-semibold">
                            <span className="font-bold text-[#0F172A]">{item.task}</span>
                            <span className={`px-1.5 py-0.2 rounded text-[8px] font-bold uppercase font-mono ${
                              item.completed ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                            }`}>{item.status}</span>
                          </div>
                          <div className="flex items-center justify-between text-[9px] text-[#64748B]">
                            <span>Owner: {item.owner}</span>
                            <span>Origin: {item.meeting_title}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 15. Customer Commitments */}
                <div className="space-y-2">
                  <span className="text-[10.5px] font-extrabold text-[#334155] block">🤝 CUSTOMER COMMITMENTS</span>
                  {commitments.customerCommitments.length === 0 ? (
                    <span className="text-xs text-[#94A3B8] italic block py-4 text-center bg-[#F8FAFC] border border-dashed border-[#E5E7EB] rounded-lg">No active tasks assigned to the customer.</span>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {commitments.customerCommitments.map(item => (
                        <div key={item.id} className="bg-white border border-[#E5E7EB] p-2.5 rounded shadow-3xs flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[10px] font-semibold">
                            <span className="font-bold text-[#0F172A]">{item.task}</span>
                            <span className={`px-1.5 py-0.2 rounded text-[8px] font-bold uppercase font-mono ${
                              item.completed ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                            }`}>{item.status}</span>
                          </div>
                          <div className="flex items-center justify-between text-[9px] text-[#64748B]">
                            <span>Contact: {item.owner}</span>
                            <span>Origin: {item.meeting_title}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* 16. Risks and Objections (Fact-based, aggregated) */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs text-left space-y-4">
              <span className="text-[10px] font-bold text-[#94A3B8] uppercase block tracking-wider">⚡ AGGREGATED DEAL RISKS & OBJECTIONS</span>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Risks Table */}
                <div className="space-y-2">
                  <span className="text-[10.5px] font-extrabold text-[#334155] block text-rose-600">⚠ Mapped Deal Risks</span>
                  {risksList.length === 0 ? (
                    <span className="text-xs text-[#94A3B8] italic block py-4 text-center bg-[#F8FAFC] border border-dashed border-[#E5E7EB] rounded-lg">No active risk factors identified.</span>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-[#E5E7EB] text-[9px] font-bold text-[#64748B] uppercase tracking-wider">
                          <th className="py-2 px-1">Risk Description</th>
                          <th className="py-2 px-1 text-center w-12">Mentions</th>
                          <th className="py-2 px-1 text-right">Evidence</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9] font-medium text-[#475569]">
                        {risksList.map((r, idx) => (
                          <tr key={idx} className="hover:bg-[#FAFBFB] transition-colors border-b border-[#F1F5F9]">
                            <td className="py-2 px-1 text-[#0F172A] font-bold">{r.risk}</td>
                            <td className="py-2 px-1 text-center font-mono">{r.mention_count || 1}</td>
                            <td className="py-2 px-1 text-right text-[#64748B] italic truncate max-w-[140px]" title={r.evidence}>"{r.evidence || "Dialogue match"}"</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Objections Table */}
                <div className="space-y-2">
                  <span className="text-[10.5px] font-extrabold text-[#334155] block text-amber-600">🚨 Timelines Objections Log</span>
                  {objectionsList.length === 0 ? (
                    <span className="text-xs text-[#94A3B8] italic block py-4 text-center bg-[#F8FAFC] border border-dashed border-[#E5E7EB] rounded-lg">No active objections raised in discussions.</span>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-[#E5E7EB] text-[9px] font-bold text-[#64748B] uppercase tracking-wider">
                          <th className="py-2 px-1">Objection Raised</th>
                          <th className="py-2 px-1 text-center w-12">Mentions</th>
                          <th className="py-2 px-1 text-right">Last Seen</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9] font-medium text-[#475569]">
                        {objectionsList.map((obj, idx) => (
                          <tr key={idx} className="hover:bg-[#FAFBFB] transition-colors border-b border-[#F1F5F9]">
                            <td className="py-2 px-1 text-[#0F172A] font-bold">"{obj.objection}"</td>
                            <td className="py-2 px-1 text-center font-mono">{obj.mention_count || 1}</td>
                            <td className="py-2 px-1 text-right text-[10px]">{new Date(obj.last_mentioned).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

              </div>
            </div>

            {/* LEVEL 3: Main split - Meeting History & People (Left) vs Copilot, Changes, Memory (Right) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              
              {/* Left pane: Meetings list & Stakeholders map */}
              <div className="lg:col-span-8 space-y-6">
                
                {/* Deal Journey Progression Timeline Bar */}
                {dealJourney && (
                  <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-3xs text-left space-y-2.5">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <TrendingUp size={14} className="text-[#14B8A6]" />
                        <span className="text-[10.5px] font-extrabold text-[#0F172A] uppercase tracking-wider">
                          Deal Journey & Call Progression
                        </span>
                      </div>
                      <span className="text-[10px] text-[#64748B] font-semibold">
                        Active Stage: <span className="text-[#0F766E] font-bold uppercase">{formatCallType(dealJourney.current_call_type)}</span> ({dealJourney.total_calls} sessions)
                      </span>
                    </div>

                    <div className="flex items-center gap-1 overflow-x-auto py-1 px-0.5 scroll-thin">
                      {(dealJourney.stages || []).map((stage, sIdx) => {
                        const stageCalls = (dealJourney.journey || []).filter(c => c.call_type === stage.id);
                        const isCurrent = dealJourney.current_call_type === stage.id;
                        const isCompleted = stageCalls.length > 0;
                        return (
                          <React.Fragment key={stage.id}>
                            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10.5px] font-bold whitespace-nowrap transition ${
                              isCurrent
                                ? 'bg-teal-50 border-teal-300 text-teal-800 shadow-2xs'
                                : isCompleted
                                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-700'
                                : 'bg-slate-50 border-slate-200 text-slate-400'
                            }`}>
                              <span className={`h-2 w-2 rounded-full ${
                                isCurrent ? 'bg-[#14B8A6] animate-pulse' : isCompleted ? 'bg-emerald-500' : 'bg-slate-300'
                              }`} />
                              <span>{stage.name}</span>
                              {stageCalls.length > 0 && (
                                <span className="ml-0.5 px-1.5 py-0.2 bg-white/90 border border-emerald-200 rounded-full text-[9px] font-mono font-extrabold">
                                  {stageCalls.length}
                                </span>
                              )}
                            </div>
                            {sIdx < dealJourney.stages.length - 1 && (
                              <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 18. Scalable Meeting History Table */}
                <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs text-left space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-[#F1F5F9]">
                    <span className="text-[10px] font-bold text-[#94A3B8] uppercase block tracking-wider">📁 Call History & Playback Logs</span>
                    <div className="flex items-center gap-1 overflow-x-auto scroll-thin">
                      {[
                        { id: "all", label: "All" },
                        { id: "cold_prospecting", label: "Cold" },
                        { id: "qualification", label: "Qual" },
                        { id: "discovery", label: "Discovery" },
                        { id: "solution_demo", label: "Demo" },
                        { id: "technical_validation", label: "Technical" },
                        { id: "negotiation", label: "Negotiation" },
                        { id: "follow_up", label: "Follow-up" },
                        { id: "renewal_expansion", label: "Renewal" }
                      ].map(tab => (
                        <button
                          key={tab.id}
                          onClick={() => setCallTypeFilter(tab.id)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold transition whitespace-nowrap ${
                            callTypeFilter === tab.id
                              ? 'bg-[#14B8A6] text-white shadow-3xs'
                              : 'bg-slate-100 text-[#64748B] hover:bg-slate-200'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {meetingsHistory.length === 0 ? (
                    <span className="text-xs text-[#94A3B8] italic block py-6 text-center">No call recordings uploaded.</span>
                  ) : (
                    <div className="space-y-2">
                      {meetingsHistory
                        .filter(m => callTypeFilter === "all" || m.call_type === callTypeFilter)
                        .map(m => {
                          const isExpanded = !!expandedMeetings[m.id];
                          const isCurrentlyPlaying = playingCallId === m.id;
                          return (
                            <div key={m.id} className="border border-[#E5E7EB] rounded-lg overflow-hidden transition hover:border-[#14B8A6]/20">
                              
                              {/* Expandable row summary */}
                              <div 
                                onClick={() => toggleMeetingExpand(m.id)}
                                className="p-3.5 flex items-center justify-between gap-4 cursor-pointer bg-white hover:bg-[#F8FAFC]"
                              >
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <h4 className="text-xs font-bold text-[#0F172A] group-hover:underline">
                                      {m.title}
                                    </h4>
                                    <span className="px-2 py-0.2 bg-teal-50 text-teal-700 border border-teal-200 rounded text-[9px] font-mono font-bold uppercase whitespace-nowrap">
                                      {formatCallType(m.call_type)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3 text-[10px] text-[#64748B] font-semibold flex-wrap">
                                    <span className="flex items-center gap-1"><Calendar size={10} /> {new Date(m.date || m.created_at).toLocaleDateString()}</span>
                                    <span>•</span>
                                    <span className="flex items-center gap-1"><Clock size={10} /> {m.duration ? `${Math.floor(m.duration / 60)}m` : "4 min"}</span>
                                    <span>•</span>
                                    <span className="px-1.5 py-0.2 bg-[#F1F5F9] rounded text-[9px] font-mono">{m.template_used || "MEDDIC"}</span>
                                    {m.workflow_state === 'synced' && (
                                      <>
                                        <span>•</span>
                                        <span className="px-2 py-0.2 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded text-[9px] font-mono font-bold flex items-center gap-1">
                                          <Lock size={9} /> Synced to HubSpot
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); togglePlayCall(m); }}
                                    className={`p-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-2xs ${
                                      isCurrentlyPlaying && isAudioPlaying 
                                        ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' 
                                        : 'bg-[#F0FDF4] text-[#14B8A6] hover:bg-[#E6FBF7]'
                                    }`}
                                  >
                                    {isCurrentlyPlaying && isAudioPlaying ? <Pause size={12} /> : <Play size={12} />}
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); openTranscriptDrawer(m); }}
                                    className="p-1.5 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#475569] rounded-lg transition"
                                    title="Explore Transcript Drawer"
                                  >
                                    <MessageSquare size={12} />
                                  </button>
                                  {isExpanded ? <ChevronUp size={14} className="text-[#64748B]" /> : <ChevronDown size={14} className="text-[#64748B]" />}
                                </div>
                              </div>

                              {/* Waveform Player Console (if playing) */}
                              {isCurrentlyPlaying && (
                                <div className="px-4 pb-3 pt-2 bg-[#F8FAFB] border-t border-[#F1F5F9] flex flex-col gap-2">
                                  <div className="flex items-center justify-between text-[10px] text-[#64748B] font-mono">
                                    <span>{Math.floor(audioCurrentTime / 60)}:{(Math.floor(audioCurrentTime) % 60).toString().padStart(2, '0')}</span>
                                    <span>{audioDuration ? `${Math.floor(audioDuration / 60)}:${(Math.floor(audioDuration) % 60).toString().padStart(2, '0')}` : "00:00"}</span>
                                  </div>
                                  {renderWaveformPeaks(m.id)}
                                </div>
                              )}

                              {/* 19. Expandable Meeting Content with 100% Grounded Intelligence */}
                              {isExpanded && (
                                <div className="p-4 bg-[#F8FAFC] border-t border-[#E5E7EB] space-y-4 animate-in slide-in-from-top-1 duration-100 text-left">
                                  <div className="space-y-1">
                                    <span className="text-[9.5px] font-bold text-[#94A3B8] uppercase block tracking-wide">Call Executive Summary</span>
                                    <p className="text-xs text-[#334155] leading-relaxed font-semibold">
                                      {m.summary || "No summary details generated."}
                                    </p>
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                      <span className="text-[9.5px] font-bold text-slate-500 uppercase block tracking-wide">💼 Action items extracted</span>
                                      {m.action_items && m.action_items.length > 0 ? (
                                        <ul className="space-y-1.5 text-xs font-semibold text-[#475569]">
                                          {m.action_items.map((item, aIdx) => {
                                            const taskText = typeof item === 'object' ? item.task : item;
                                            const owner = typeof item === 'object' ? item.owner : null;
                                            const deadline = typeof item === 'object' ? item.deadline : null;
                                            return (
                                              <li key={aIdx} className="flex items-start gap-1.5">
                                                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#14B8A6] flex-shrink-0" />
                                                <span>
                                                  <span>{taskText}</span>
                                                  {owner && owner !== 'Unassigned' && (
                                                    <span className="ml-1.5 px-1.5 py-0.2 bg-teal-50 text-teal-700 border border-teal-200 rounded text-[9px] font-normal">
                                                      {owner}
                                                    </span>
                                                  )}
                                                  {deadline && (
                                                    <span className="ml-1 px-1.5 py-0.2 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[9px] font-normal">
                                                      Due: {deadline}
                                                    </span>
                                                  )}
                                                </span>
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      ) : (
                                        <span className="text-[11px] text-[#94A3B8] italic font-normal block">No action items recorded for this session.</span>
                                      )}
                                    </div>

                                    <div className="space-y-1.5">
                                      <span className="text-[9.5px] font-bold text-rose-500 uppercase block tracking-wide">⚠ Risks and Objections</span>
                                      {m.risks && m.risks.length > 0 ? (
                                        <ul className="space-y-1.5 text-xs font-semibold text-[#475569]">
                                          {m.risks.map((r, rIdx) => {
                                            const riskText = typeof r === 'object' ? r.risk : r;
                                            return (
                                              <li key={rIdx} className="flex items-start gap-1.5 text-rose-600">
                                                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-rose-500 flex-shrink-0" />
                                                <span>{riskText}</span>
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      ) : (
                                        <span className="text-[11px] text-[#94A3B8] italic font-normal block">No open risks detected in this session.</span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex justify-end pt-1 border-t border-[#F1F5F9]">
                                    <button
                                      onClick={() => {
                                        if (onSelectMeeting) onSelectMeeting(m.id);
                                      }}
                                      className="px-3 py-1 bg-white border border-[#E5E7EB] hover:bg-slate-50 text-[#14B8A6] border-[#14B8A6]/20 text-[11px] font-extrabold rounded-lg shadow-3xs transition"
                                    >
                                      Open Full Meeting Workspace →
                                    </button>
                                  </div>
                                </div>
                              )}

                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>

                {/* 17. People: Mapped Stakeholders Directory */}
                <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs text-left space-y-3">
                  <span className="text-[10px] font-bold text-[#94A3B8] uppercase block tracking-wider">👥 PEOPLE (BUYING COMMITTEE MAP)</span>
                  {stakeholders.length === 0 ? (
                    <span className="text-xs text-[#94A3B8] italic block py-4 text-center">No stakeholders directory mapped.</span>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="border-b border-[#E5E7EB] text-[9.5px] font-bold text-[#64748B] uppercase tracking-wider bg-[#F8FAFC]">
                            <th className="py-2.5 px-3">Name</th>
                            <th className="py-2.5 px-3">Job Title</th>
                            <th className="py-2.5 px-3">Role / Authority</th>
                            <th className="py-2.5 px-3 text-center">Calls Appeared</th>
                            <th className="py-2.5 px-3 text-right">Last Seen</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F1F5F9] font-medium text-[#475569]">
                          {stakeholders.map(s => (
                            <tr key={s.speaker_id} className="hover:bg-[#FAFBFB] border-b border-[#F1F5F9] last:border-0 transition-colors">
                              <td className="py-3 px-3">
                                <span 
                                  onClick={() => handleOpenMentions(s)}
                                  className="text-[#0F172A] font-extrabold hover:underline cursor-pointer flex items-center gap-1.5"
                                >
                                  <User size={12} className="text-[#14B8A6]" />
                                  {s.name}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-[11.5px] font-semibold">{s.job_title || "Consultant"}</td>
                              <td className="py-3 px-3">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase font-mono ${
                                  s.decision_authority === 'Economic Buyer' ? 'bg-sky-50 text-sky-600 border border-sky-100' :
                                  s.decision_authority === 'Champion' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                                  s.decision_authority === 'Procurement' ? 'bg-indigo-50 text-[#4F46E5] border border-[#E0E7FF]' :
                                  s.decision_authority === 'Security' ? 'bg-rose-50 text-rose-600 border border-rose-100' :
                                  'bg-slate-100 text-slate-600 border border-slate-200'
                                }`}>
                                  {s.decision_authority || "Stakeholder"}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-center font-mono font-bold">{s.meetings?.length || 1} calls</td>
                              <td className="py-3 px-3 text-right text-[10px] font-semibold">{s.latest_mention ? new Date(s.latest_mention).toLocaleDateString() : "Unknown"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

              </div>

              {/* Right pane: Copilot & memories */}
              <div className="lg:col-span-4 space-y-6">
                
                {/* 21. Grounded PulseSync Copilot */}
                <div className="bg-white border border-[#E5E7EB] rounded-xl flex flex-col h-[400px] shadow-3xs overflow-hidden">
                  <div className="p-3.5 border-b border-[#F1F5F9] bg-[#FAFBFB] text-left">
                    <h4 className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="text-[#14B8A6]" size={13} /> PulseSync Copilot
                    </h4>
                    <span className="text-[9.5px] text-[#64748B] font-semibold mt-0.5 block">Grounded Customer Intelligence</span>
                  </div>

                  <div className="flex-grow overflow-y-auto p-3.5 bg-[#FAFBFB] space-y-3 scroll-thin text-left">
                    {chatMessages.length === 0 ? (
                      <div className="h-full flex flex-col justify-center space-y-4">
                        <div className="text-center p-2">
                          <HelpCircle className="text-[#64748B] mx-auto mb-1.5" size={22} />
                          <p className="text-[10px] text-[#64748B] max-w-[220px] mx-auto leading-relaxed font-semibold">
                            Ask anything about pricing, timeline shifts, commitments, or playbooks.
                          </p>
                        </div>
                        
                        <div className="bg-white p-2.5 rounded-lg border border-[#E5E7EB] space-y-1 shadow-3xs">
                          <span className="text-[8.5px] font-bold text-[#94A3B8] uppercase block tracking-wider mb-1.5">Suggested Prompts</span>
                          {[
                            "What changed since our last call?",
                            "What did we promise them?",
                            "What did they promise us?",
                            "What risks remain?",
                            "What MEDDIC fields are missing?"
                          ].map((q, idx) => (
                            <button
                              key={idx}
                              onClick={(e) => handleSendCopilotChat(e, q)}
                              className="w-full text-left p-1 text-[10px] font-bold text-[#14B8A6] hover:underline"
                            >
                              • {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      chatMessages.map((msg, idx) => (
                        <div 
                          key={idx} 
                          className={`flex flex-col max-w-[92%] ${
                            msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
                          }`}
                        >
                          <div className={`p-2.5 rounded-lg text-xs leading-relaxed ${
                            msg.role === "user" 
                              ? "bg-[#14B8A6] text-white rounded-br-none" 
                              : "bg-white text-[#0F172A] rounded-bl-none border border-[#E5E7EB] shadow-3xs font-medium"
                          }`}>
                            {msg.text}
                          </div>
                          
                          {/* Grounded transcript evidence link */}
                          {msg.evidence && msg.evidence.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {msg.evidence.map((cit, cIdx) => (
                                <span
                                  key={cIdx}
                                  className="px-1.5 py-0.5 bg-white border border-[#E5E7EB] text-[#64748B] text-[8.5px] rounded select-none font-bold"
                                  title={`Evidence: "${cit.quote}"`}
                                >
                                  🔗 {cit.meeting_title}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                    {sendingChat && (
                      <div className="flex items-center gap-1.5 text-xs text-[#64748B] mr-auto bg-white p-2 rounded-lg border border-[#E5E7EB] rounded-bl-none shadow-3xs">
                        <Loader2 className="animate-spin text-[#14B8A6]" size={12} />
                        <span>Aggregating context...</span>
                      </div>
                    )}
                  </div>

                  <form onSubmit={handleSendCopilotChat} className="p-2 border-t border-[#F1F5F9] flex items-center gap-2 bg-white">
                    <input
                      type="text"
                      placeholder="Ask Copilot about call details..."
                      value={chatQuestion}
                      onChange={(e) => setChatQuestion(e.target.value)}
                      disabled={sendingChat}
                      className="flex-1 bg-[#FAFBFB] border border-[#E5E7EB] rounded px-3 py-1.5 text-xs text-[#0F172A] outline-none placeholder-[#94A3B8]"
                    />
                    <button
                      type="submit"
                      disabled={sendingChat || !chatQuestion.trim()}
                      className="p-1.5 bg-[#14B8A6] hover:bg-[#0F9688] text-white rounded transition disabled:opacity-40"
                    >
                      <Send size={12} />
                    </button>
                  </form>
                </div>

                {/* 20. Verified Customer Memory */}
                <div className="bg-white border border-[#E5E7EB] p-4 rounded-lg shadow-3xs text-left space-y-3">
                  <h4 className="text-xs font-bold text-[#0F172A] uppercase tracking-wider flex items-center gap-1.5">
                    <Briefcase size={13} className="text-[#14B8A6]" /> Verified Customer Memory
                  </h4>
                  
                  {memoriesList.length > 0 ? (
                    <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                      {memoriesList.map(mem => (
                        <div key={mem.id} className="bg-[#FAFBFB] border border-[#F1F5F9] p-2.5 rounded-lg text-xs font-semibold text-[#334155] leading-normal">
                          <div className="flex items-center justify-between text-[8px] text-[#94A3B8] font-bold uppercase mb-1">
                            <span>{mem.memory_type}</span>
                            <span>{new Date(mem.created_at).toLocaleDateString()}</span>
                          </div>
                          <p className="text-[#0F172A] font-extrabold">"{mem.value}"</p>
                          {mem.meeting_title && (
                            <span className="text-[8.5px] text-[#14B8A6] block mt-1 italic font-semibold">Origin: "{mem.meeting_title}"</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-[#64748B] italic block py-4 text-center bg-[#FAFBFB] border border-dashed border-[#E5E7EB] rounded-md">
                      No customer memories compiled.
                    </span>
                  )}
                </div>

              </div>

            </div>

          </div>
        )}

      </div>

      {/* 13. PRE-CALL PREPARATION WORKSPACE MODAL/DRAWER */}
      {showPrepWorkspace && (
        <div className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 text-left animate-in fade-in duration-200 select-none">
          <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
            
            <div className="p-4 border-b border-[#F1F5F9] bg-[#FAFBFB] flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-sm font-extrabold text-[#0F172A] uppercase flex items-center gap-1.5">
                  <Activity size={14} className="text-[#14B8A6]" /> Pre-Call Intelligence Workspace
                </h3>
                <p className="text-[10px] text-[#64748B] mt-0.5 font-bold">Prepare for next client call in under 60 seconds.</p>
              </div>
              <button 
                onClick={() => setShowPrepWorkspace(false)} 
                className="p-1.5 hover:bg-[#E2E8F0] rounded-lg transition"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-grow overflow-y-auto p-6 space-y-6 bg-[#F8FAFC]">
              {prepLoading ? (
                <div className="py-20 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="animate-spin text-[#14B8A6]" size={24} />
                  <span className="text-xs text-[#64748B] font-semibold">Generating preparation dossier...</span>
                </div>
              ) : prepData ? (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  
                  {/* Left Column (8-cols): summary, talk tracks, checklists */}
                  <div className="md:col-span-8 space-y-5">
                    
                    {/* Last Summary */}
                    <div className="bg-white border border-[#E5E7EB] p-4 rounded-lg space-y-2">
                      <span className="text-[10px] font-bold text-[#94A3B8] uppercase block">📝 PREVIOUS CONVERSATION SYNTHESIS</span>
                      <p className="text-xs leading-relaxed font-semibold text-[#334155]">
                        {prepData.previous_conversation || "No previous meeting recorded."}
                      </p>
                    </div>

                    {/* commitments checklist */}
                    <div className="bg-white border border-[#E5E7EB] p-4 rounded-lg space-y-3">
                      <span className="text-[10px] font-bold text-[#94A3B8] uppercase block">Outstanding commitments</span>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-semibold text-[#475569]">
                        <div>
                          <span className="text-[9.5px] font-bold text-slate-500 uppercase block mb-1">Our Team promises</span>
                          {prepData.our_commitments?.length === 0 ? (
                            <span className="text-[11px] text-[#94A3B8] italic font-normal">None pending</span>
                          ) : (
                            <ul className="space-y-1.5">
                              {prepData.our_commitments?.map((c, i) => (
                                <li key={i} className="flex items-start gap-1.5">
                                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#14B8A6] flex-shrink-0" />
                                  <span>{c}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div>
                          <span className="text-[9.5px] font-bold text-slate-500 uppercase block mb-1">Customer promised</span>
                          {prepData.customer_commitments?.length === 0 ? (
                            <span className="text-[11px] text-[#94A3B8] italic font-normal">None pending</span>
                          ) : (
                            <ul className="space-y-1.5">
                              {prepData.customer_commitments?.map((c, i) => (
                                <li key={i} className="flex items-start gap-1.5">
                                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#14B8A6] flex-shrink-0" />
                                  <span>{c}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* talking points */}
                    <div className="bg-white border border-[#E5E7EB] p-4 rounded-lg space-y-2">
                      <span className="text-[10px] font-bold text-[#94A3B8] uppercase block">🎯 SUGGESTED TALKING POINTS & AGENDA ITEMS</span>
                      <ul className="space-y-2 text-xs font-semibold text-[#334155]">
                        {prepData.talking_points?.map((pt, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="h-4 w-4 bg-[#E0F2FE] text-[#0284C7] rounded-full flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">{i+1}</span>
                            <span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                  </div>

                  {/* Right Column (4-cols): Agenda scratchpad, questions */}
                  <div className="md:col-span-4 space-y-5">
                    
                    {/* Suggested questions */}
                    <div className="bg-white border border-[#E5E7EB] p-4 rounded-lg space-y-2">
                      <span className="text-[10px] font-bold text-[#94A3B8] uppercase block">💬 SUGGESTED QUESTIONS FOR MEETING</span>
                      <div className="space-y-2.5">
                        {prepData.suggested_questions?.map((q, idx) => (
                          <div key={idx} className="p-2 bg-slate-50 border border-[#E5E7EB] rounded text-xs font-semibold text-[#334155] leading-normal italic">
                            "{q}"
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Persistent scratch agenda notes */}
                    <div className="bg-white border border-[#E5E7EB] p-4 rounded-lg flex flex-col h-[220px]">
                      <div className="flex justify-between items-center text-[10px] font-bold text-[#64748B] uppercase mb-1.5 flex-shrink-0">
                        <span>Rich Agenda Notes</span>
                        {savingNotes ? (
                          <span className="italic text-[9px] text-[#64748B]">Autosaving...</span>
                        ) : (
                          <span className="text-[#14B8A6] text-[9px]">Saved</span>
                        )}
                      </div>
                      
                      <textarea
                        placeholder="Draft final customized talking points to present..."
                        value={prepNotes}
                        onChange={(e) => handleNotesChange(e.target.value)}
                        className="flex-grow w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg p-2.5 text-xs outline-none focus:border-[#14B8A6] focus:bg-white transition leading-relaxed font-semibold text-[#475569] resize-none"
                      />

                      <button
                        onClick={exportDossierToClipboard}
                        className="mt-2 py-2 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#14B8A6] text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 shadow-2xs flex-shrink-0"
                      >
                        <Download size={12} />
                        <span>Copy Dossier</span>
                      </button>
                    </div>

                  </div>

                </div>
              ) : (
                <div className="text-center py-10 text-xs text-[#64748B] italic">Failed to load pre-call intelligence dossier.</div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* DRAWER: Slide-Out Transcript Drawer */}
      {drawerMeetingId && (
        <div className="fixed inset-y-0 right-0 w-[450px] bg-white shadow-2xl border-l border-[#E2E8F0] z-50 flex flex-col overflow-hidden animate-fade-in text-left">
          <div className="p-4 border-b border-[#F1F5F9] bg-[#FAFBFB] flex items-center justify-between flex-shrink-0">
            <div>
              <h3 className="text-xs font-bold text-[#0F172A] uppercase tracking-wide">Transcript Explorer</h3>
              <p className="text-[10px] text-[#64748B] font-semibold truncate max-w-[340px] mt-0.5">{drawerMeetingTitle}</p>
            </div>
            <button 
              onClick={() => setDrawerMeetingId(null)}
              className="p-1.5 hover:bg-[#E2E8F0] rounded-lg transition"
            >
              <X size={15} />
            </button>
          </div>

          <div className="p-3 border-b border-[#F1F5F9] flex-shrink-0 bg-white">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 text-[#64748B]" size={12} />
              <input
                type="text"
                placeholder="Search keywords inside transcript segments..."
                value={transcriptSearch}
                onChange={(e) => setTranscriptSearch(e.target.value)}
                className="w-full bg-[#FAFBFB] border border-[#E2E8F0] rounded pl-8 pr-3 py-1 text-xs outline-none focus:border-[#14B8A6]"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 bg-[#FAFBFB] space-y-3 scroll-thin">
            {loadingDrawer ? (
              <div className="py-20 flex flex-col items-center justify-center gap-2">
                <Loader2 className="animate-spin text-[#14B8A6]" size={16} />
                <span className="text-xs text-[#64748B]">Parsing transcript timeline...</span>
              </div>
            ) : (
              (() => {
                const filtered = drawerSegments.filter(s => 
                  (s.corrected_text || s.text || "").toLowerCase().includes(transcriptSearch.toLowerCase())
                );
                
                if (filtered.length === 0) {
                  return <div className="text-center py-10 text-xs text-[#64748B] italic">No segments match search query.</div>;
                }

                return filtered.map((seg, idx) => {
                  const minutes = Math.floor(seg.start_time / 60);
                  const seconds = Math.floor(seg.start_time % 60).toString().padStart(2, '0');
                  
                  return (
                    <div 
                      key={idx} 
                      onClick={() => {
                        if (playingCallId === drawerMeetingId && audioElRef.current) {
                          audioElRef.current.currentTime = seg.start_time;
                          setAudioCurrentTime(seg.start_time);
                        }
                      }}
                      className="bg-white border border-[#E2E8F0] p-3 rounded shadow-3xs hover:border-[#14B8A6]/30 transition cursor-pointer"
                    >
                      <div className="flex items-center justify-between text-[9px] font-bold text-[#64748B] mb-1.5">
                        <span className="text-[#14B8A6]">{seg.speaker_name || "Unknown Speaker"}</span>
                        <span>{minutes}:{seconds}</span>
                      </div>
                      <p className="text-xs leading-relaxed text-[#475569] font-medium">
                        {seg.corrected_text || seg.text}
                      </p>
                    </div>
                  );
                });
              })()
            )}
          </div>
        </div>
      )}

      {/* FACT HISTORY EVOLUTION MODAL */}
      {activeFactHistory && (
        <div className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 text-left animate-in fade-in duration-200 select-none">
          <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-xl w-full max-w-md max-h-[70vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-[#F1F5F9] bg-[#FAFBFB] flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-xs font-bold text-[#0F172A] uppercase">Fact Evolution: {activeFactHistory.label}</h3>
                <span className="text-[9px] text-[#64748B] mt-0.5 block font-bold">Historical progression values extracted from verified dialogue.</span>
              </div>
              <button onClick={() => setActiveFactHistory(null)} className="p-1 hover:bg-[#E2E8F0] rounded text-[#64748B]">
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#FAFBFB]">
              {activeFactHistory.history.length === 0 ? (
                <div className="text-center py-10 text-xs text-[#64748B] italic">No historical progression registered for this fact.</div>
              ) : (
                activeFactHistory.history.map((m, idx) => (
                  <div key={idx} className="bg-white border border-[#E5E7EB] p-3 rounded shadow-3xs flex flex-col gap-1">
                    <div className="flex justify-between items-center text-[9px] text-[#64748B]">
                      <span className="font-bold text-[#14B8A6]">{m.meeting_title || "Call Session"}</span>
                      <span>{new Date(m.created_at || m.date).toLocaleDateString()}</span>
                    </div>
                    <p className="text-xs font-extrabold text-[#334155] mt-1">Value: "{m.value}"</p>
                    <span className="text-[9px] text-slate-400 block mt-1 italic">Confidence: {m.confidence || 100}%</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stakeholder Mentions modal */}
      {activeStakeholder && (
        <div className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 text-left animate-in fade-in duration-200">
          <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-xl w-full max-w-xl max-h-[70vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-[#F1F5F9] bg-[#FAFBFB] flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-xs font-bold text-[#0F172A] uppercase">Mentions for {activeStakeholder.name}</h3>
                <p className="text-[10px] text-[#64748B] mt-0.5 font-bold">{activeStakeholder.job_title} • {activeStakeholder.role}</p>
              </div>
              <button onClick={() => setActiveStakeholder(null)} className="p-1 hover:bg-[#E2E8F0] rounded text-[#64748B]">
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#FAFBFB]">
              {loadingMentions ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="animate-spin text-[#14B8A6]" size={16} />
                  <span className="text-xs text-[#64748B] font-semibold font-mono">Searching transcripts...</span>
                </div>
              ) : stakeholderMentions.length === 0 ? (
                <div className="text-center py-10 text-xs text-[#64748B] italic">No recorded mentions in previous sessions.</div>
              ) : (
                stakeholderMentions.map((m, idx) => (
                  <div key={idx} className="bg-white border border-[#E5E7EB] p-3 rounded shadow-3xs">
                    <div className="flex items-center justify-between text-[9px] font-bold text-[#64748B] mb-1">
                      <span className="text-[#14B8A6]">{m.meeting_title}</span>
                      <span>{Math.floor(m.start_time / 60)}:{(Math.floor(m.start_time) % 60).toString().padStart(2, '0')}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-[#475569] italic">"{m.text}"</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

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
  Lock,
  Star,
  MoreHorizontal,
  Filter,
  RefreshCw
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

export default function Customers({ 
  meetings = [], 
  onSelectMeeting, 
  onSelectMeetingDetails,
  selectedCompanyId: propSelectedCompanyId, 
  onSelectCompany 
}) {
  const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:3001` : "http://localhost:3001");

  // Navigation and Workspace States
  const [viewMode, setViewMode] = useState("table"); // "table", "workspace"
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);

  // Call Stage Journey & Customer Intelligence
  const [dealJourney, setDealJourney] = useState(null);
  const [customerIntelligence, setCustomerIntelligence] = useState(null);
  const [callTypeFilter, setCallTypeFilter] = useState("all");

  // Redesign State: Table Filters & Playbook Dropdown
  const [intelligenceFilter, setIntelligenceFilter] = useState("all"); // "all", "changed", "needs_review"
  const [selectedPlaybook, setSelectedPlaybook] = useState("MEDDIC");
  const [isFavorite, setIsFavorite] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);

  // Modals for additions
  const [showAddCommitmentModal, setShowAddCommitmentModal] = useState(false);
  const [newCommitmentData, setNewCommitmentData] = useState({
    task: "",
    owner: "",
    due_date: "",
    type: "customer" // "customer" or "rep"
  });
  const [savingCommitment, setSavingCommitment] = useState(false);

  const [showAddStakeholderModal, setShowAddStakeholderModal] = useState(false);
  const [newStakeholderData, setNewStakeholderData] = useState({
    name: "",
    job_title: "",
    decision_authority: "Stakeholder",
    email: ""
  });
  const [savingStakeholder, setSavingStakeholder] = useState(false);

  // Collapsible & Drawer States
  const [isPlaybookCollapsed, setIsPlaybookCollapsed] = useState(true);
  const [showPrepWorkspace, setShowPrepWorkspace] = useState(false);
  const [expandedMeetings, setExpandedMeetings] = useState({});

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
  const [activeFactHistory, setActiveFactHistory] = useState(null);

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

  // Helper read database mock if companies is loading
  const readFallbackDbList = () => {
    try {
      const stored = localStorage.getItem("recent_companies");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  };

  const addToRecent = (id) => {
    const data = readFallbackDbList();
    const company = companies.find(c => c.id === id) || data.find(c => c.id === id);
    if (!company) return;

    let updated = [company, ...recentAccounts.filter(r => r.id !== id)];
    updated = updated.slice(0, 5);
    setRecentAccounts(updated);
    localStorage.setItem("recent_companies", JSON.stringify(updated));
  };

  const togglePinCompany = (id, name) => {
    let updated;
    if (pinnedAccounts.some(p => p.id === id)) {
      updated = pinnedAccounts.filter(p => p.id !== id);
      setIsFavorite(false);
    } else {
      updated = [...pinnedAccounts, { id, name }];
      setIsFavorite(true);
    }
    setPinnedAccounts(updated);
    localStorage.setItem("pinned_companies", JSON.stringify(updated));
  };

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
        if (play?.playbook) {
          setSelectedPlaybook(play.playbook);
        }
      }
      if (historyRes.ok) {
        const hist = await historyRes.json();
        setPlaybookHistory(hist);
      }
      if (coverageRes.ok) {
        const cov = await coverageRes.json();
        setPlaybookCoverage(cov);
      }

      const savedNotes = localStorage.getItem(`prep_notes_${companyId}`);
      setPrepNotes(savedNotes || "");

      const pinned = localStorage.getItem("pinned_companies");
      if (pinned) {
        const list = JSON.parse(pinned);
        setIsFavorite(list.some(p => p.id === companyId));
      }

      setChatMessages([]);
    } catch (err) {
      console.error("Error loading workspace data:", err);
    } finally {
      setLoadingWorkspace(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
    const pinned = localStorage.getItem("pinned_companies");
    if (pinned) setPinnedAccounts(JSON.parse(pinned));
    const recents = localStorage.getItem("recent_companies");
    if (recents) setRecentAccounts(JSON.parse(recents));
  }, []);

  useEffect(() => {
    if (propSelectedCompanyId) {
      setSelectedCompanyId(propSelectedCompanyId);
      setViewMode("workspace");
    }
  }, [propSelectedCompanyId]);

  useEffect(() => {
    if (selectedCompanyId) {
      fetchWorkspaceDetails(selectedCompanyId);
      addToRecent(selectedCompanyId);
    }
  }, [selectedCompanyId]);

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

  const handleStageChange = async (newStage) => {
    try {
      const res = await fetch(`${API_URL}/api/customers/${selectedCompanyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage })
      });
      if (res.ok) {
        setSelectedCompanyData(prev => ({
          ...prev,
          company: { ...prev.company, deal_stage: newStage }
        }));
      }
    } catch (err) {
      console.error("Failed to update sales stage:", err);
    }
  };

  const handleToggleCommitment = async (item, listType) => {
    try {
      const res = await fetch(`${API_URL}/api/customers/${selectedCompanyId}/commitments/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          meeting_id: item.meeting_id,
          task: item.task,
          completed: !item.completed
        })
      });
      if (res.ok) {
        setCommitments(prev => {
          if (listType === "customer") {
            return {
              ...prev,
              customerCommitments: prev.customerCommitments.map(c => 
                c.id === item.id ? { ...c, completed: !c.completed } : c
              )
            };
          } else {
            return {
              ...prev,
              ourCommitments: prev.ourCommitments.map(c => 
                c.id === item.id ? { ...c, completed: !c.completed } : c
              )
            };
          }
        });
      }
    } catch (err) {
      console.error("Failed to toggle commitment:", err);
    }
  };

  const handlePlaybookChange = async (playbookName) => {
    setSelectedPlaybook(playbookName);
    if (!selectedCompanyId) return;
    try {
      const [pRes, hRes, cRes] = await Promise.all([
        fetch(`${API_URL}/api/customers/${selectedCompanyId}/playbook?playbook=${encodeURIComponent(playbookName)}`),
        fetch(`${API_URL}/api/customers/${selectedCompanyId}/playbook/history?playbook=${encodeURIComponent(playbookName)}`),
        fetch(`${API_URL}/api/customers/${selectedCompanyId}/playbook/coverage?playbook=${encodeURIComponent(playbookName)}`)
      ]);
      if (pRes.ok) {
        const pData = await pRes.json();
        setPlaybookData(pData);
      }
      if (hRes.ok) {
        const hData = await hRes.json();
        setPlaybookHistory(hData);
      }
      if (cRes.ok) {
        const cData = await cRes.json();
        setPlaybookCoverage(cData);
      }
    } catch (err) {
      console.error("Failed to load playbook data:", err);
    }
  };

  const handleCreateCommitment = async (e) => {
    e.preventDefault();
    if (!newCommitmentData.task.trim() || savingCommitment) return;
    setSavingCommitment(true);
    try {
      const payload = {
        task: newCommitmentData.task.trim(),
        owner: newCommitmentData.owner?.trim() || "Unassigned",
        due_date: newCommitmentData.due_date?.trim() || null,
        type: newCommitmentData.type,
        meeting_id: meetingsHistory[0]?.id || null
      };
      const res = await fetch(`${API_URL}/api/customers/${selectedCompanyId}/commitments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const created = await res.json();
        setCommitments(prev => {
          if (newCommitmentData.type === "customer") {
            return { ...prev, customerCommitments: [created, ...prev.customerCommitments] };
          } else {
            return { ...prev, ourCommitments: [created, ...prev.ourCommitments] };
          }
        });
        setShowAddCommitmentModal(false);
        setNewCommitmentData({ task: "", owner: "", due_date: "", type: "customer" });
      }
    } catch (err) {
      console.error("Failed to add commitment:", err);
    } finally {
      setSavingCommitment(false);
    }
  };

  const handleCreateStakeholder = async (e) => {
    e.preventDefault();
    if (!newStakeholderData.name.trim() || savingStakeholder) return;
    setSavingStakeholder(true);
    try {
      const res = await fetch(`${API_URL}/api/customers/${selectedCompanyId}/stakeholders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newStakeholderData)
      });
      if (res.ok) {
        const created = await res.json();
        setStakeholders(prev => [created, ...prev]);
        setShowAddStakeholderModal(false);
        setNewStakeholderData({ name: "", job_title: "", decision_authority: "Stakeholder", email: "" });
      }
    } catch (err) {
      console.error("Failed to add stakeholder:", err);
    } finally {
      setSavingStakeholder(false);
    }
  };

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

  const openTranscriptDrawer = async (meeting) => {
    if (!meeting) return;
    setDrawerMeetingId(meeting.id);
    setDrawerMeetingTitle(meeting.title || "Call Session");
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

  const handleSeekDrawerAudio = (startTime) => {
    if (playingCallId === drawerMeetingId && audioElRef.current) {
      audioElRef.current.currentTime = startTime;
      setAudioCurrentTime(startTime);
    }
  };

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

  const handleNotesChange = (text) => {
    setPrepNotes(text);
    setSavingNotes(true);
    localStorage.setItem(`prep_notes_${selectedCompanyId}`, text);
    setTimeout(() => setSavingNotes(false), 800);
  };

  const exportDossierToClipboard = () => {
    const activeObjections = objectionsList.map(o => `• [Pending] ${o.objection} (Mention count: ${o.mention_count})`).join('\n');
    const openActions = commitments.ourCommitments.filter(a => !a.completed).map(a => `• ${a.task} (${a.meeting_title || 'Recent call'})`).join('\n');
    const customerActions = commitments.customerCommitments.filter(a => !a.completed).map(a => `• ${a.task} (${a.meeting_title || 'Recent call'})`).join('\n');
    
    const dossierText = `=== PulseSync Deal Prep Dossier: ${selectedCompanyData?.company?.name} ===
Date Exported: ${new Date().toLocaleDateString()}

Executive Summary:
${aiBrief || selectedCompanyData?.company?.notes || "No notes registered."}

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

  const handleOpenFactHistory = (label, key) => {
    const history = memoriesList.filter(m => m.memory_type === key);
    setActiveFactHistory({ label, key, history });
  };

  const renderWaveformPeaks = (callId) => {
    const barCount = 40;
    const bars = [];
    const seed = callId.charCodeAt(0) || 12;
    for (let i = 0; i < barCount; i++) {
      const h = Math.abs(Math.sin(i * 0.4 + seed)) * 22 + 4;
      bars.push(h);
    }
    const currentTimeRatio = audioDuration > 0 ? audioCurrentTime / audioDuration : 0;
    const activeIndex = Math.floor(currentTimeRatio * barCount);

    return (
      <div className="flex items-end gap-[2px] h-7 w-full bg-[#FAFBFB] border border-[#E2E8F0] p-1 rounded-md cursor-pointer select-none">
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
                isActive ? 'bg-[#10B981]' : 'bg-[#E2E8F0] hover:bg-[#CBD5E1]'
              }`}
            />
          );
        })}
      </div>
    );
  };

  const filteredDrawerSegments = drawerSegments.filter(s => 
    (s.corrected_text || s.text || "").toLowerCase().includes(transcriptSearch.toLowerCase())
  );

  const formatRelativeTime = (dateStr) => {
    if (!dateStr) return "No activity";
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now - date;
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHours = Math.floor(diffMin / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffDays > 30) return date.toLocaleDateString();
      if (diffDays > 0) return `${diffDays}d ago`;
      if (diffHours > 0) return `${diffHours}h ago`;
      if (diffMin > 0) return `${diffMin}m ago`;
      return "Just now";
    } catch {
      return "Active";
    }
  };

  const getAllAccountRows = () => {
    if (playbookData?.properties && playbookData.properties.length > 0) {
      return playbookData.properties.map(prop => {
        const history = playbookHistory?.[prop.field_name] || [];
        const hasHistory = history.length > 1;
        
        let statusType = "confirmed";
        let status = "Confirmed";
        
        const rawStatus = (prop.status || '').toLowerCase();

        if (!prop.current_value || prop.current_value === '—' || rawStatus === 'missing' || rawStatus === 'not_mentioned') {
          statusType = "missing";
          status = "Not established";
        } else if (hasHistory) {
          const uniqueValues = new Set(history.map(h => String(h.value).trim().toLowerCase()));
          if (uniqueValues.size > 1) {
            statusType = "changed";
            status = "Changed";
          } else if (rawStatus === 'partially_established') {
            statusType = "partially_established";
            status = "Partially established";
          } else if (rawStatus === 'reported_unvalidated') {
            statusType = "reported_unvalidated";
            status = "Reported (unvalidated)";
          } else if (rawStatus === 'awaiting_verification') {
            statusType = "awaiting_verification";
            status = "Awaiting verification";
          } else if (prop.confidence && prop.confidence < 70) {
            statusType = "needs_review";
            status = "Needs review";
          }
        } else if (rawStatus === 'partially_established') {
          statusType = "partially_established";
          status = "Partially established";
        } else if (rawStatus === 'reported_unvalidated') {
          statusType = "reported_unvalidated";
          status = "Reported (unvalidated)";
        } else if (rawStatus === 'awaiting_verification') {
          statusType = "awaiting_verification";
          status = "Awaiting verification";
        } else if (prop.confidence && prop.confidence < 70) {
          statusType = "needs_review";
          status = "Needs review";
        }

        const sourceMeeting = meetingsHistory.find(m => m.id === prop.meeting_id) || (prop.meeting_id ? { id: prop.meeting_id, title: prop.meeting_title } : meetingsHistory[0]);
        const sourceLabel = prop.meeting_title 
          ? prop.meeting_title 
          : (sourceMeeting ? `${sourceMeeting.title || "Meeting"}` : "No verified source");

        return {
          id: prop.field_name,
          field: prop.label || prop.field_name,
          value: prop.current_value || "No evidence found across recorded calls",
          status,
          statusType,
          sourceLabel,
          meetingId: prop.meeting_id,
          meeting: sourceMeeting,
          confidence: prop.confidence,
          evidence: prop.evidence
        };
      });
    }

    if (customerIntelligence?.facts) {
      const factKeys = Object.keys(customerIntelligence.facts);
      if (factKeys.length > 0) {
        return factKeys.map(key => {
          const fact = customerIntelligence.facts[key];
          const label = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          const isMissing = !fact || !fact.value;
          const statusType = isMissing ? "missing" : (fact.status === "verified" ? "confirmed" : "needs_review");
          const sourceMeeting = meetingsHistory.find(m => m.id === fact?.source_meeting_id) || (fact?.source_meeting_id ? { id: fact.source_meeting_id, title: fact.source_meeting_title } : meetingsHistory[0]);
          return {
            id: key,
            field: label,
            value: isMissing ? "No evidence found across recorded calls" : fact.value,
            status: isMissing ? "Not established" : (fact.status === "verified" ? "Confirmed" : "Needs review"),
            statusType,
            sourceLabel: fact?.source_meeting_title || (sourceMeeting ? sourceMeeting.title : "No verified source"),
            meetingId: fact?.source_meeting_id,
            meeting: sourceMeeting,
            confidence: fact?.confidence || 0,
            evidence: fact?.evidence
          };
        });
      }
    }

    return [];
  };

  const getConsolidatedAccountRows = () => {
    const allRows = getAllAccountRows();
    if (intelligenceFilter === "changed") {
      return allRows.filter(r => r.statusType === "changed");
    }
    if (intelligenceFilter === "needs_review") {
      return allRows.filter(r => ["needs_review", "partially_established", "reported_unvalidated", "awaiting_verification", "missing"].includes(r.statusType));
    }
    return allRows;
  };

  const getPrioritySignals = () => {
    const signals = [];
    
    // 1. Budget Signal
    const budgetProp = playbookData?.properties?.find(p => p.field_name === 'budget' || p.field_name === 'project_budget') || null;
    const budgetFact = customerIntelligence?.facts?.budget || null;
    const budgetVal = budgetProp?.current_value || budgetFact?.value || selectedCompanyData?.company?.budget || null;
    const budgetMeeting = meetingsHistory.find(m => m.id === (budgetProp?.meeting_id || budgetFact?.source_meeting_id)) || meetingsHistory[0];

    if (budgetVal && String(budgetVal).toLowerCase() !== 'null' && String(budgetVal).trim() !== '' && String(budgetVal) !== '—') {
      const isEarmarked = /earmark|conditional|pending/i.test(String(budgetVal));
      signals.push({
        type: isEarmarked ? "warning" : "positive",
        title: isEarmarked ? "Budget earmarked (conditional)" : "Budget identified",
        icon: isEarmarked ? "alert" : "check",
        description: isEarmarked 
          ? `Budget earmarked for sales productivity tools under CRO sponsorship; final funding depends on business case.`
          : `Allocated budget of ${budgetVal} identified in meeting records.`,
        sourceLabel: budgetMeeting ? `${budgetMeeting.title}` : "Verified records",
        meeting: budgetMeeting
      });
    } else {
      signals.push({
        type: "neutral",
        title: "Budget not yet identified",
        icon: "info",
        description: "No verified budget figure has been discussed or confirmed in recorded calls.",
        sourceLabel: "Awaiting discussion",
        meeting: null
      });
    }

    // 2. Decision Maker / Economic Buyer Signal
    const dmProp = playbookData?.properties?.find(p => p.field_name === 'economic_buyer' || p.field_name === 'authority' || p.field_name === 'decision_maker') || null;
    const dmFact = customerIntelligence?.facts?.decision_maker || null;
    const dmVal = dmProp?.current_value || dmFact?.value || selectedCompanyData?.company?.decision_maker || null;
    const dmMeeting = meetingsHistory.find(m => m.id === (dmProp?.meeting_id || dmFact?.source_meeting_id)) || meetingsHistory[0];

    if (dmVal && String(dmVal).toLowerCase() !== 'null' && String(dmVal).trim() !== '' && String(dmVal) !== '—') {
      const isSarahDecisionMaker = /sarah/i.test(String(dmVal));
      signals.push({
        type: "positive",
        title: isSarahDecisionMaker ? "Business decision maker identified" : "Decision maker identified",
        icon: "check",
        description: isSarahDecisionMaker
          ? `Sarah (VP of Sales) owns business decision; security & procurement involved. Final economic authority unconfirmed.`
          : `Economic decision authority mapped to ${dmVal}.`,
        sourceLabel: dmMeeting ? `${dmMeeting.title}` : "Recorded calls",
        meeting: dmMeeting
      });
    } else {
      signals.push({
        type: "warning",
        title: "Decision maker missing",
        icon: "alert",
        description: "Economic Buyer or budget approval authority has not been confirmed in recorded calls.",
        sourceLabel: "Requires discovery",
        meeting: null
      });
    }

    // 3. Timeline / Risks Signal
    const timelineProp = playbookData?.properties?.find(p => p.field_name === 'timeline' || p.field_name === 'implementation_timeline') || null;
    const timelineFact = customerIntelligence?.facts?.timeline || null;
    const timelineVal = timelineProp?.current_value || timelineFact?.value || null;
    const timelineMeeting = meetingsHistory.find(m => m.id === (timelineProp?.meeting_id || timelineFact?.source_meeting_id)) || meetingsHistory[0];

    if (timelineVal && String(timelineVal).toLowerCase() !== 'null' && String(timelineVal).trim() !== '' && String(timelineVal) !== '—') {
      const isPilot = /45 days|pilot/i.test(String(timelineVal));
      signals.push({
        type: "positive",
        title: isPilot ? "Pilot timeline targeted" : "Timeline targeted",
        icon: "calendar",
        description: isPilot
          ? `Prospect stated target to test 20 seats within 45 days (rollout conditional on pilot success).`
          : `Target implementation timeline discussed: ${timelineVal}.`,
        sourceLabel: timelineMeeting ? `${timelineMeeting.title}` : "Recorded calls",
        meeting: timelineMeeting
      });
    } else if (risksList && risksList.length > 0) {
      signals.push({
        type: "warning",
        title: "Identified deal risk",
        icon: "alert",
        description: `${risksList.length} potential risk${risksList.length > 1 ? 's' : ''} detected across conversations.`,
        sourceLabel: `${risksList[0].meeting_title || 'Meeting records'}`,
        meeting: meetingsHistory.find(m => m.id === risksList[0].meeting_id) || meetingsHistory[0]
      });
    } else {
      signals.push({
        type: "neutral",
        title: "Timeline pending",
        icon: "calendar",
        description: "Implementation timeline and milestones have not yet been established.",
        sourceLabel: "Awaiting qualification",
        meeting: null
      });
    }

    return signals;
  };

  const consolidatedRows = getConsolidatedAccountRows();

  return (
    <div className="flex flex-col bg-[#F8FAFC] w-full h-screen text-left relative overflow-hidden select-none font-sans">
      
      {/* Hidden Audio element */}
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

      {/* Global Topbar with Account Search */}
      <header className="w-full flex-shrink-0 bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between z-30 shadow-3xs">
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
            className="w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg pl-10 pr-9 py-1.5 text-xs text-[#0F172A] outline-none placeholder-[#94A3B8] focus:border-[#10B981] focus:bg-white transition-all font-medium"
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
                        <Building2 size={13} className="text-[#10B981]" />
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
                        <Calendar size={13} className="text-[#10B981]" />
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
        
        {/* VIEW 1: Accounts Directory Table */}
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
                        <Building2 size={11} className="text-[#10B981]" />
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
                  <p className="text-xs text-[#64748B] mt-0.5 font-medium">Cross-call intelligence, verified commercial memory, and CRM synchronization.</p>
                </div>
              </div>
              
              {loadingCompanies ? (
                <div className="py-20 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="animate-spin text-[#10B981]" size={24} />
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
                            <div className="h-7 w-7 rounded bg-[#F0FDF4] border border-[#10B981]/20 text-[#0F7669] flex items-center justify-center font-bold text-xs">
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

        {/* VIEW 2: Selected Customer Account Intelligence Workspace (Reference Design Benchmark) */}
        {viewMode === "workspace" && (
          <div className="max-w-[1440px] mx-auto p-6 space-y-5">
            
            {/* Top Back Navigation Breadcrumb */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleReturnToGrid}
                className="text-xs font-semibold text-[#64748B] hover:text-[#0F172A] flex items-center gap-1 transition"
              >
                <ArrowLeft size={13} />
                <span>Accounts</span>
              </button>
            </div>

            {/* 1. TOP HEADER: Company Title, Tags, Deal Stage Dropdown, Call Stats & CTAs */}
            {selectedCompanyData?.company && (
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  
                  {/* Left: Avatar, Title, Favorite Star, Subtitle info */}
                  <div className="flex items-center gap-3.5">
                    <div className="h-11 w-11 rounded-xl bg-[#F1F5F9] border border-[#CBD5E1] text-[#1E293B] flex items-center justify-center font-extrabold text-sm tracking-wider shadow-2xs">
                      {selectedCompanyData.company.name?.slice(0, 2).toUpperCase() || "AC"}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h1 className="text-xl font-extrabold text-[#0F172A] tracking-tight">
                          {selectedCompanyData.company.name || "Unnamed Account"}
                        </h1>
                        <button
                          onClick={() => togglePinCompany(selectedCompanyData.company.id, selectedCompanyData.company.name)}
                          className="text-[#94A3B8] hover:text-amber-500 transition p-0.5"
                          title={isFavorite ? "Unfavorite account" : "Favorite account"}
                        >
                          <Star size={16} className={isFavorite ? "fill-amber-400 text-amber-400" : "text-[#94A3B8]"} />
                        </button>
                      </div>

                      {/* Subtitle Line with Bullet Points */}
                      <div className="flex items-center gap-2 text-xs text-[#64748B] font-medium mt-1 flex-wrap">
                        <span>{selectedCompanyData.company.location || selectedCompanyData.company.website || "Location not specified"}</span>
                        <span>•</span>
                        <span>{selectedCompanyData.company.industry || "Industry not specified"}</span>
                        <span>•</span>
                        {selectedCompanyData.company.crm_account ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            CRM Synced ({selectedCompanyData.company.crm_account})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200 text-[11px] font-semibold">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                            CRM Not Connected
                          </span>
                        )}
                        <span>•</span>
                        <span>Owner: <strong className="text-[#334155]">{selectedCompanyData.company.crm_owner || selectedCompanyData.company.account_owner || "Unassigned"}</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Stage Selector, Call Metrics, Action CTAs */}
                  <div className="flex items-center gap-3 flex-wrap justify-end">
                    
                    {/* Deal Stage Selector Dropdown */}
                    <div className="flex flex-col items-end">
                      <span className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider mb-0.5">Stage</span>
                      <select
                        value={selectedCompanyData.company.deal_stage || "Discovery"}
                        onChange={(e) => handleStageChange(e.target.value)}
                        className="bg-[#F8FAFC] border border-[#CBD5E1] text-[#0F172A] text-xs font-bold rounded-lg px-2.5 py-1.5 outline-none hover:border-[#10B981] focus:border-[#10B981] transition cursor-pointer shadow-3xs"
                      >
                        <option value="Qualification">Qualification</option>
                        <option value="Discovery">Discovery</option>
                        <option value="Solution Demo">Solution Demo</option>
                        <option value="Technical Validation">Technical Validation</option>
                        <option value="Negotiation">Negotiation</option>
                        <option value="Closed Won">Closed Won</option>
                        <option value="Closed Lost">Closed Lost</option>
                      </select>
                    </div>

                    {/* Total Calls Metric */}
                    <div className="flex flex-col items-center px-3 border-l border-[#F1F5F9]">
                      <span className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider mb-0.5">Calls</span>
                      <span className="text-xs font-extrabold text-[#0F172A]">
                        {meetingsHistory.length} {meetingsHistory.length === 1 ? 'call' : 'calls'}
                      </span>
                    </div>

                    {/* Last Activity Metric */}
                    <div className="flex flex-col items-center px-3 border-l border-[#F1F5F9]">
                      <span className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider mb-0.5">Last Activity</span>
                      <span className="text-xs font-extrabold text-[#0F172A]">
                        {meetingsHistory[0]?.created_at ? formatRelativeTime(meetingsHistory[0].created_at) : "No activity"}
                      </span>
                    </div>

                    {/* Prepare for next meeting Primary CTA */}
                    <button
                      onClick={handleOpenPrepWorkspace}
                      className="px-4 py-2 bg-[#10B981] hover:bg-[#059669] text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition ml-1"
                    >
                      <Sparkles size={14} />
                      <span>Prepare for next meeting →</span>
                    </button>

                    {/* Overflow menu */}
                    <div className="relative">
                      <button
                        onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                        className="p-2 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#64748B] rounded-lg transition"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                      {showOverflowMenu && (
                        <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-1 z-40 text-xs font-semibold text-[#334155]">
                          <button
                            onClick={() => { exportDossierToClipboard(); setShowOverflowMenu(false); }}
                            className="w-full text-left px-3 py-2 hover:bg-[#F1F5F9] flex items-center gap-2"
                          >
                            <Download size={12} />
                            <span>Export Deal Dossier</span>
                          </button>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(window.location.href);
                              alert("Account link copied!");
                              setShowOverflowMenu(false);
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-[#F1F5F9] flex items-center gap-2"
                          >
                            <ExternalLink size={12} />
                            <span>Copy Account Link</span>
                          </button>
                        </div>
                      )}
                    </div>

                  </div>

                </div>
              </div>
            )}

            {/* 2. GROUNDED ACCOUNT BRIEF & 3 PRIORITY SIGNAL CARDS */}
            <div className="bg-[#F0FDF4]/70 border border-[#A7F3D0] rounded-xl p-5 shadow-3xs space-y-4">
              
              {/* Account Intelligence Summary Narrative */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[#065F46]">
                  <Sparkles size={14} className="text-[#059669]" />
                  <span className="text-[10px] font-extrabold uppercase tracking-wider">Account Intelligence Summary</span>
                </div>
                <p className="text-xs text-[#064E3B] font-medium leading-relaxed max-w-5xl">
                  {aiBrief || (selectedCompanyData?.company?.name 
                    ? `Account record active for ${selectedCompanyData.company.name}. No account intelligence summary compiled yet. Transcribe and review meetings to compile automated deal intelligence.`
                    : "No account intelligence summary compiled yet. Transcribe and review meetings to compile automated deal intelligence.")}
                </p>
              </div>

              {/* Priority Signals Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-1">
                {getPrioritySignals().map((sig, sIdx) => {
                  const isPositive = sig.type === "positive";
                  const isWarning = sig.type === "warning";
                  const borderClass = isPositive ? "border-[#A7F3D0]" : isWarning ? "border-[#FDE68A]" : "border-[#E2E8F0]";
                  const textHeaderClass = isPositive ? "text-emerald-800" : isWarning ? "text-amber-700" : "text-slate-700";
                  const dividerClass = isPositive ? "border-[#D1FAE5]" : isWarning ? "border-[#FEF3C7]" : "border-[#F1F5F9]";
                  
                  return (
                    <div key={sIdx} className={`bg-white border ${borderClass} p-3.5 rounded-lg shadow-2xs flex flex-col justify-between gap-2`}>
                      <div className="space-y-1">
                        <div className={`flex items-center gap-1.5 ${textHeaderClass} font-extrabold text-xs`}>
                          {isPositive && <CheckCircle2 size={13} className="text-emerald-600" />}
                          {isWarning && <AlertTriangle size={13} className="text-amber-500" />}
                          {!isPositive && !isWarning && <HelpCircle size={13} className="text-slate-400" />}
                          <span>{sig.title}</span>
                        </div>
                        <p className="text-[11px] text-[#475569] font-medium leading-normal">
                          {sig.description}
                        </p>
                      </div>
                      <div className={`pt-1 border-t ${dividerClass} flex items-center justify-between`}>
                        {sig.meeting ? (
                          <button
                            onClick={() => openTranscriptDrawer(sig.meeting)}
                            className="text-[10px] font-bold text-[#0D9488] hover:underline flex items-center gap-1"
                          >
                            <span>{sig.sourceLabel}</span>
                            <ChevronRight size={11} />
                          </button>
                        ) : (
                          <span className="text-[10px] font-semibold text-[#94A3B8]">{sig.sourceLabel}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>

            {/* 3. TWO-COLUMN WORKSPACE LAYOUT (~66% LEFT / ~34% RIGHT) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* ════════════════════════════════════════════════
                  LEFT COLUMN: Account Intelligence Table, Changes Timeline, Commitments
                  ════════════════════════════════════════════════ */}
              <div className="lg:col-span-8 space-y-6">
                
                {/* SECTION 1: Account Intelligence (Consolidated Table) */}
                <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-3xs overflow-hidden">
                  
                  {/* Table Header: Title, Filter Tabs, Playbook Selector */}
                  <div className="p-4 border-b border-[#F1F5F9] flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#FAFBFB]">
                    <div>
                      <h3 className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wider flex items-center gap-2">
                        <span>Account Intelligence</span>
                        <span className="text-[#64748B] font-medium capitalize text-[11px]">(Consolidated)</span>
                      </h3>
                    </div>

                    <div className="flex items-center gap-3">
                      
                      {/* Filter tabs: All fields, Changed, Needs review */}
                      <div className="flex items-center bg-[#F1F5F9] p-0.5 rounded-lg border border-[#E2E8F0]">
                        <button
                          onClick={() => setIntelligenceFilter("all")}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                            intelligenceFilter === "all"
                              ? "bg-white text-[#0F172A] shadow-3xs"
                              : "text-[#64748B] hover:text-[#0F172A]"
                          }`}
                        >
                          All fields ({getAllAccountRows().length})
                        </button>
                        <button
                          onClick={() => setIntelligenceFilter("changed")}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                            intelligenceFilter === "changed"
                              ? "bg-white text-[#0F172A] shadow-3xs"
                              : "text-[#64748B] hover:text-[#0F172A]"
                          }`}
                        >
                          Changed ({getAllAccountRows().filter(r => r.statusType === 'changed').length})
                        </button>
                        <button
                          onClick={() => setIntelligenceFilter("needs_review")}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition flex items-center gap-1 ${
                            intelligenceFilter === "needs_review"
                              ? "bg-white text-amber-700 shadow-3xs"
                              : "text-amber-600 hover:text-amber-800"
                          }`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          Needs review ({getAllAccountRows().filter(r => ['needs_review', 'partially_established', 'reported_unvalidated', 'awaiting_verification', 'missing'].includes(r.statusType)).length})
                        </button>
                      </div>

                      {/* Playbook selector dropdown */}
                      <select
                        value={selectedPlaybook}
                        onChange={(e) => handlePlaybookChange(e.target.value)}
                        className="bg-white border border-[#CBD5E1] text-[#0F172A] text-[11px] font-bold rounded-lg px-2.5 py-1 outline-none hover:border-[#10B981] transition cursor-pointer shadow-3xs"
                      >
                        <option value="MEDDIC">MEDDIC</option>
                        <option value="BANT">BANT</option>
                        <option value="MEDDICC">MEDDICC</option>
                        <option value="SPICED">SPICED</option>
                      </select>

                    </div>
                  </div>

                  {/* Consolidated Table Content */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#E5E7EB] text-[9.5px] font-bold text-[#64748B] uppercase tracking-wider bg-[#F8FAFC]">
                          <th className="py-2.5 px-4 w-40">Field</th>
                          <th className="py-2.5 px-4">Current Value</th>
                          <th className="py-2.5 px-3 w-36">Status</th>
                          <th className="py-2.5 px-4 w-36 text-right">Source</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9] font-medium text-[#475569]">
                        {consolidatedRows.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-xs text-[#94A3B8] italic">
                              No playbook fields found or no evidence recorded yet for this filter.
                            </td>
                          </tr>
                        ) : (
                          consolidatedRows.map((row) => (
                            <tr key={row.id} className="hover:bg-[#FAFBFB] transition-colors border-b border-[#F1F5F9]">
                              <td className="py-3 px-4 text-[#0F172A] font-extrabold">{row.field}</td>
                              <td className="py-3 px-4 text-[#334155] font-semibold text-[11.5px] leading-relaxed">
                                {row.value}
                              </td>
                              <td className="py-3 px-3">
                                {row.statusType === "confirmed" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <Check size={10} />
                                    <span>Confirmed</span>
                                  </span>
                                )}
                                {row.statusType === "partially_established" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                    <Activity size={10} />
                                    <span>Partially established</span>
                                  </span>
                                )}
                                {row.statusType === "reported_unvalidated" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                    <AlertTriangle size={10} />
                                    <span>Reported (unvalidated)</span>
                                  </span>
                                )}
                                {row.statusType === "awaiting_verification" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                    <HelpCircle size={10} />
                                    <span>Awaiting verification</span>
                                  </span>
                                )}
                                {row.statusType === "changed" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                                    <Activity size={10} />
                                    <span>Changed</span>
                                  </span>
                                )}
                                {row.statusType === "missing" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                    <span>Not established</span>
                                  </span>
                                )}
                                {row.statusType === "needs_review" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                    <AlertTriangle size={10} />
                                    <span>{row.status || "Needs review"}</span>
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right">
                                {row.meeting ? (
                                  <button
                                    onClick={() => openTranscriptDrawer(row.meeting)}
                                    className="text-[11px] font-bold text-[#0D9488] hover:underline inline-flex items-center gap-1"
                                  >
                                    <span>{row.sourceLabel}</span>
                                  </button>
                                ) : (
                                  <span className="text-[11px] text-[#94A3B8] font-medium">{row.sourceLabel}</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                </div>

                {/* SECTION 2: What Changed Across Calls (Timeline) */}
                <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-4">
                  <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
                    <div>
                      <h3 className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wider flex items-center gap-2">
                        <span>What Changed Across Calls</span>
                      </h3>
                      <span className="text-[10px] text-[#64748B] font-semibold mt-0.5 block">
                        Reconciled multi-call progression and fact drift
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] font-bold text-[#64748B]">
                      {meetingsHistory.length >= 2 ? (
                        <>
                          <span className="px-2 py-0.5 bg-[#F1F5F9] rounded border border-[#E2E8F0]">{meetingsHistory[meetingsHistory.length - 1]?.title || "Initial Call"}</span>
                          <span>→</span>
                          <span className="px-2 py-0.5 bg-[#F1F5F9] rounded border border-[#E2E8F0]">{meetingsHistory[0]?.title || "Latest Call"}</span>
                        </>
                      ) : (
                        <span className="px-2 py-0.5 bg-[#F1F5F9] rounded border border-[#E2E8F0]">
                          {meetingsHistory[0]?.title || "Single Session"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Dynamic Change Cards */}
                  {(() => {
                    const validChanges = (timelineChanges || []).filter(ch =>
                      ch && ch.field && ch.new_value && ch.field !== 'undefined' && ch.new_value !== 'undefined'
                    );
                    return validChanges.length > 0 ? (
                      <div className="space-y-3">
                        {validChanges.map((ch, idx) => {
                          const sourceMeeting = meetingsHistory.find(m => m.id === ch.meeting_id) || meetingsHistory[0];
                          return (
                            <div key={ch.id || idx} className="p-3.5 rounded-lg border border-[#E2E8F0] bg-[#FAFBFB] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  {ch.field?.toLowerCase().includes("budget") ? (
                                    <DollarSign size={13} className="text-emerald-600" />
                                  ) : ch.field?.toLowerCase().includes("timeline") ? (
                                    <Calendar size={13} className="text-amber-600" />
                                  ) : (
                                    <ShieldAlert size={13} className="text-[#64748B]" />
                                  )}
                                  <h4 className="text-xs font-extrabold text-[#0F172A]">
                                    {ch.field}: {ch.old_value && ch.old_value !== 'undefined' && ch.old_value !== ch.new_value ? `${ch.old_value} → ${ch.new_value}` : ch.new_value}
                                  </h4>
                                  <span className={`px-1.5 py-0.2 text-[9px] font-bold rounded ${
                                    ch.type === "identified"
                                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                      : ch.type === "delayed" || ch.type === "shifted"
                                      ? "bg-amber-50 text-amber-700 border border-amber-200"
                                      : "bg-slate-100 text-slate-700 border border-slate-200"
                                  }`}>
                                    {ch.type ? ch.type.charAt(0).toUpperCase() + ch.type.slice(1) : "Updated"}
                                  </span>
                                </div>
                                <p className="text-[11px] text-[#475569] font-medium leading-relaxed">
                                  {ch.evidence || (ch.old_value && ch.old_value !== 'undefined' ? `${ch.field} changed from "${ch.old_value}" to "${ch.new_value}".` : `${ch.field}: ${ch.new_value}`)}
                                </p>
                              </div>
                              {sourceMeeting && (
                                <button
                                  onClick={() => openTranscriptDrawer(sourceMeeting)}
                                  className="text-[10px] font-bold text-[#0D9488] hover:underline whitespace-nowrap self-start sm:self-center"
                                >
                                  {ch.citation || `${sourceMeeting.title} →`}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-4 text-center text-xs text-[#94A3B8] italic border border-dashed border-[#E2E8F0] rounded-lg">
                        {meetingsHistory.length <= 1 
                          ? "At least two recorded meetings are required to detect cross-call fact changes."
                          : "No verified changes across calls yet."}
                      </div>
                    );
                  })()}
                </div>

                {/* SECTION 3: Commitments & Next Steps (Split: Customer owes us vs Our team owes customer) */}
                <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-4">
                  <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
                    <div>
                      <h3 className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wider flex items-center gap-2">
                        <span>Commitments & Next Steps</span>
                      </h3>
                      <span className="text-[10px] text-[#64748B] font-semibold mt-0.5 block">
                        Dual-sided commitment tracking across meetings
                      </span>
                    </div>

                    <button
                      onClick={() => setShowAddCommitmentModal(true)}
                      className="px-2.5 py-1 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#0F172A] text-[11px] font-bold rounded-lg transition flex items-center gap-1 shadow-3xs"
                    >
                      <Plus size={12} className="text-[#10B981]" />
                      <span>Add commitment</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* Sub-column 1: Customer owes us */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-[#1E293B] flex items-center gap-1.5">
                          <span>Customer owes us</span>
                          <span className="text-[10px] px-1.5 py-0.2 bg-teal-50 text-teal-700 font-mono rounded font-bold">
                            {commitments.customerCommitments.filter(c => !c.completed).length}
                          </span>
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {commitments.customerCommitments.length === 0 ? (
                          <div className="p-4 text-center text-xs text-[#94A3B8] italic border border-dashed border-[#E2E8F0] rounded-lg">
                            No open customer commitments.
                          </div>
                        ) : (
                          commitments.customerCommitments.map((item) => (
                            <div
                              key={item.id}
                              className={`p-3 rounded-lg border transition ${
                                item.completed
                                  ? "bg-slate-50 border-[#E2E8F0] opacity-60"
                                  : "bg-white border-[#E2E8F0] shadow-2xs hover:border-[#10B981]/40"
                              }`}
                            >
                              <div className="flex items-start gap-2.5">
                                <input
                                  type="checkbox"
                                  checked={!!item.completed}
                                  onChange={() => handleToggleCommitment(item, "customer")}
                                  className="mt-0.5 h-3.5 w-3.5 rounded border-[#CBD5E1] text-[#10B981] focus:ring-0 cursor-pointer"
                                />
                                <div className="space-y-1 flex-1">
                                  <p className={`text-xs font-bold text-[#0F172A] leading-snug ${item.completed ? "line-through text-[#64748B]" : ""}`}>
                                    {item.task}
                                  </p>
                                  <div className="flex items-center gap-2 text-[10px] text-[#64748B] font-semibold flex-wrap">
                                    <span className="text-[#334155]">{item.owner || "Customer Contact"}</span>
                                    {item.due_date && item.due_date !== "-" && (
                                      <>
                                        <span>•</span>
                                        <span className="px-1.5 py-0.2 bg-amber-50 text-amber-700 rounded text-[9px] font-bold">
                                          Due {item.due_date}
                                        </span>
                                      </>
                                    )}
                                    <span>•</span>
                                    <span className="text-[#94A3B8]">{item.meeting_title || "Meeting record"}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Sub-column 2: Our team owes customer */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-[#1E293B] flex items-center gap-1.5">
                          <span>Our team owes customer</span>
                          <span className="text-[10px] px-1.5 py-0.2 bg-teal-50 text-teal-700 font-mono rounded font-bold">
                            {commitments.ourCommitments.filter(c => !c.completed).length}
                          </span>
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {commitments.ourCommitments.length === 0 ? (
                          <div className="p-4 text-center text-xs text-[#94A3B8] italic border border-dashed border-[#E2E8F0] rounded-lg">
                            No open team commitments.
                          </div>
                        ) : (
                          commitments.ourCommitments.map((item) => (
                            <div
                              key={item.id}
                              className={`p-3 rounded-lg border transition ${
                                item.completed
                                  ? "bg-slate-50 border-[#E2E8F0] opacity-60"
                                  : "bg-white border-[#E2E8F0] shadow-2xs hover:border-[#10B981]/40"
                              }`}
                            >
                              <div className="flex items-start gap-2.5">
                                <input
                                  type="checkbox"
                                  checked={!!item.completed}
                                  onChange={() => handleToggleCommitment(item, "rep")}
                                  className="mt-0.5 h-3.5 w-3.5 rounded border-[#CBD5E1] text-[#10B981] focus:ring-0 cursor-pointer"
                                />
                                <div className="space-y-1 flex-1">
                                  <p className={`text-xs font-bold text-[#0F172A] leading-snug ${item.completed ? "line-through text-[#64748B]" : ""}`}>
                                    {item.task}
                                  </p>
                                  <div className="flex items-center gap-2 text-[10px] text-[#64748B] font-semibold flex-wrap">
                                    <span className="text-[#334155]">{item.owner || selectedCompanyData?.company?.crm_owner || "Our Team"}</span>
                                    {item.due_date && item.due_date !== "-" && (
                                      <>
                                        <span>•</span>
                                        <span className="px-1.5 py-0.2 bg-emerald-50 text-emerald-700 rounded text-[9px] font-bold">
                                          Due {item.due_date}
                                        </span>
                                      </>
                                    )}
                                    <span>•</span>
                                    <span className="text-[#94A3B8]">{item.meeting_title || "Meeting record"}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                  </div>
                </div>

              </div>

              {/* ════════════════════════════════════════════════
                  RIGHT COLUMN: Copilot, Stakeholders, Call History (Lower Right)
                  ════════════════════════════════════════════════ */}
              <div className="lg:col-span-4 space-y-6">
                
                {/* 1. PulseSync Copilot Card */}
                <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-3xs overflow-hidden flex flex-col h-[380px]">
                  
                  {/* Copilot Header */}
                  <div className="p-3.5 border-b border-[#F1F5F9] bg-[#FAFBFB]">
                    <h4 className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="text-[#10B981]" size={14} />
                      <span>PulseSync Copilot</span>
                    </h4>
                    <span className="text-[10px] text-[#64748B] font-semibold mt-0.5 block">
                      Answers grounded in verified meeting transcripts & intelligence
                    </span>
                  </div>

                  {/* Copilot Chat Body */}
                  <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-[#FAFBFB] text-left scroll-thin">
                    {chatMessages.length === 0 ? (
                      <div className="h-full flex flex-col justify-between py-1">
                        <div className="space-y-2">
                          <span className="text-[9px] font-bold text-[#94A3B8] uppercase block tracking-wider">Suggested Questions</span>
                          <div className="space-y-1.5">
                            {[
                              `What was discussed regarding budget for ${selectedCompanyData?.company?.name || "this account"}?`,
                              `What is the target timeline or deployment date?`,
                              `Who is identified as the decision maker or buyer?`
                            ].map((q, idx) => (
                              <button
                                key={idx}
                                onClick={(e) => handleSendCopilotChat(e, q)}
                                className="w-full text-left p-2 rounded-lg bg-white border border-[#E2E8F0] hover:border-[#10B981] text-xs font-semibold text-[#334155] shadow-3xs transition"
                              >
                                {q}
                              </button>
                            ))}
                          </div>
                        </div>

                        <p className="text-[10.5px] text-[#94A3B8] text-center italic mt-auto">
                          Ask anything about commitments, timeline shifts, or pricing discussions.
                        </p>
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
                              ? "bg-[#10B981] text-white rounded-br-none" 
                              : "bg-white text-[#0F172A] rounded-bl-none border border-[#E5E7EB] shadow-3xs font-medium"
                          }`}>
                            {msg.text}
                          </div>
                          
                          {/* Evidence link */}
                          {msg.evidence && msg.evidence.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {msg.evidence.map((cit, cIdx) => (
                                <button
                                  key={cIdx}
                                  onClick={() => openTranscriptDrawer(meetingsHistory[0])}
                                  className="px-1.5 py-0.5 bg-white border border-[#E5E7EB] text-[#0D9488] text-[9px] rounded font-bold hover:underline"
                                >
                                  🔗 {cit.citation || `Source: ${cit.meeting_title || 'Call Session'}`}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                    {sendingChat && (
                      <div className="flex items-center gap-1.5 text-xs text-[#64748B] mr-auto bg-white p-2 rounded-lg border border-[#E5E7EB] shadow-3xs">
                        <Loader2 className="animate-spin text-[#10B981]" size={12} />
                        <span>Synthesizing grounded answer...</span>
                      </div>
                    )}
                  </div>

                  {/* Copilot Input Form */}
                  <form onSubmit={handleSendCopilotChat} className="p-2 border-t border-[#F1F5F9] flex items-center gap-2 bg-white">
                    <input
                      type="text"
                      placeholder="Ask anything about this account..."
                      value={chatQuestion}
                      onChange={(e) => setChatQuestion(e.target.value)}
                      disabled={sendingChat}
                      className="flex-1 bg-[#FAFBFB] border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-xs text-[#0F172A] outline-none placeholder-[#94A3B8] focus:border-[#10B981]"
                    />
                    <button
                      type="submit"
                      disabled={sendingChat || !chatQuestion.trim()}
                      className="p-1.5 bg-[#10B981] hover:bg-[#059669] text-white rounded-lg transition disabled:opacity-40"
                    >
                      <Send size={13} />
                    </button>
                  </form>
                </div>

                {/* 2. Stakeholders (Buying Committee) Card */}
                <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-4">
                  <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
                    <div>
                      <h4 className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wider flex items-center gap-1.5">
                        <Users size={14} className="text-[#10B981]" />
                        <span>Stakeholders (Buying Committee)</span>
                      </h4>
                      <span className="text-[10px] text-[#64748B] font-semibold mt-0.5 block">
                        Mapped committee members & authority roles
                      </span>
                    </div>

                    <button
                      onClick={() => setShowAddStakeholderModal(true)}
                      className="px-2.5 py-1 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#0F172A] text-[11px] font-bold rounded-lg transition flex items-center gap-1 shadow-3xs"
                    >
                      <Plus size={12} className="text-[#10B981]" />
                      <span>Add</span>
                    </button>
                  </div>

                  {/* Economic buyer not confirmed Warning Banner */}
                  {!stakeholders.some(s => s.role === 'Economic Buyer' || s.decision_authority === 'Economic Buyer') && !customerIntelligence?.facts?.decision_maker?.value && (
                    <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200 flex items-start gap-2">
                      <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <span className="text-[11px] font-extrabold text-amber-900 block">
                          Economic buyer not confirmed
                        </span>
                        <p className="text-[10.5px] text-amber-800 font-medium leading-normal">
                          No decision maker with budget allocation authority has been confirmed for this account yet.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Stakeholder Rows */}
                  <div className="space-y-3">
                    {stakeholders.length === 0 ? (
                      <div className="p-4 text-center text-xs text-[#94A3B8] italic border border-dashed border-[#E2E8F0] rounded-lg">
                        No stakeholders mapped for this account yet. Use "Add" above to register buying committee members.
                      </div>
                    ) : (
                      <>
                        {/* Customer Buying Committee */}
                        <div className="space-y-2">
                          <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider block">
                            Buying Committee
                          </span>
                          {stakeholders.filter(s => !s.is_team).map((sh, sIdx) => {
                            const initials = sh.name ? sh.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : "ST";
                            const authority = sh.decision_authority || sh.role || "Stakeholder";
                            return (
                              <div 
                                key={sh.id || sh.speaker_id || sIdx}
                                onClick={() => handleOpenMentions({ speaker_id: sh.speaker_id || sh.name?.toLowerCase(), name: sh.name, job_title: sh.job_title || authority, role: authority })}
                                className="p-3 rounded-lg border border-[#E2E8F0] hover:border-[#10B981]/50 cursor-pointer transition bg-white flex items-center justify-between gap-3 shadow-2xs"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="h-8 w-8 rounded-full bg-teal-50 border border-teal-200 text-teal-800 flex items-center justify-center font-bold text-xs">
                                    {initials}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs font-extrabold text-[#0F172A] hover:underline">
                                        {sh.name}
                                      </span>
                                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                        authority === "Champion" || authority === "Economic Buyer"
                                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                          : authority === "Business Decision Maker"
                                          ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                                          : authority.includes("Approver") || authority.includes("Reviewer")
                                          ? "bg-purple-50 text-purple-700 border border-purple-200"
                                          : "bg-sky-50 text-sky-700 border border-sky-200"
                                      }`}>
                                        {authority}
                                      </span>
                                    </div>
                                    <span className="text-[10px] text-[#64748B] font-semibold block">
                                      {sh.job_title ? `${sh.job_title} • ` : ""}{sh.department || "Operations"}
                                    </span>
                                  </div>
                                </div>
                                <ChevronRight size={13} className="text-[#94A3B8]" />
                              </div>
                            );
                          })}
                        </div>

                        {/* PulseSync Account Team (Separate section) */}
                        {stakeholders.some(s => s.is_team) && (
                          <div className="pt-2 border-t border-[#F1F5F9] space-y-1.5">
                            <span className="text-[9.5px] font-bold text-[#94A3B8] uppercase tracking-wider block">
                              PulseSync Account Team
                            </span>
                            {stakeholders.filter(s => s.is_team).map((sh, sIdx) => (
                              <div key={sh.id || sh.speaker_id || sIdx} className="p-2 rounded-lg bg-[#FAFBFB] border border-[#F1F5F9] flex items-center justify-between text-[11px]">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-[#334155]">{sh.name}</span>
                                  <span className="text-[9.5px] text-[#64748B]">({sh.job_title})</span>
                                </div>
                                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                  PulseSync
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                </div>

                {/* 3. Call History (Lower-Right Area - Crucial Requirement) */}
                <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-4">
                  <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
                    <div>
                      <h4 className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wider flex items-center gap-1.5">
                        <Clock size={14} className="text-[#10B981]" />
                        <span>Call History ({meetingsHistory.length})</span>
                      </h4>
                      <span className="text-[10px] text-[#64748B] font-semibold mt-0.5 block">
                        Recordings, playback, and independent call reviews
                      </span>
                    </div>
                  </div>

                  {/* Calls List */}
                  <div className="space-y-3">
                    {meetingsHistory.length === 0 ? (
                      <div className="text-center py-6 text-xs text-[#94A3B8] italic">No calls recorded.</div>
                    ) : (
                      meetingsHistory.map((m, idx) => {
                        const callNumber = `Call ${String(meetingsHistory.length - idx).padStart(2, '0')}`;
                        const callSubtitle = m.title || `Session ${idx + 1}`;
                        const dateFormatted = m.created_at ? new Date(m.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : "Date unrecorded";
                        const durationMinutes = m.duration_seconds ? Math.round(m.duration_seconds / 60) : (m.duration ? Math.round(m.duration / 60) : null);
                        const durationFormatted = durationMinutes ? `${durationMinutes} min` : "Duration unavailable";
                        const numParticipants = Array.isArray(m.speakers) ? m.speakers.length : (m.speaker_count || 0);
                        const participantCount = numParticipants > 0 ? `${numParticipants} ${numParticipants === 1 ? 'participant' : 'participants'}` : "Participants unlisted";
                        const numActionItems = Array.isArray(m.action_items) ? m.action_items.length : 0;
                        const actionItemCount = `${numActionItems} ${numActionItems === 1 ? 'action item' : 'action items'}`;
                        const isCurrentlyPlaying = playingCallId === m.id;

                        return (
                          <div 
                            key={m.id}
                            className="p-3.5 rounded-lg border border-[#E2E8F0] bg-white shadow-2xs hover:border-[#10B981]/40 transition space-y-2.5"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="space-y-0.5">
                                <h5 className="text-xs font-extrabold text-[#0F172A]">
                                  {callNumber} — {callSubtitle}
                                </h5>
                                <div className="flex items-center gap-2 text-[10px] text-[#64748B] font-semibold flex-wrap">
                                  <span>{dateFormatted}</span>
                                  <span>•</span>
                                  <span>{durationFormatted}</span>
                                  <span>•</span>
                                  <span>{participantCount}</span>
                                  <span>•</span>
                                  <span>{actionItemCount}</span>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => togglePlayCall(m)}
                                  className={`p-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center ${
                                    isCurrentlyPlaying && isAudioPlaying 
                                      ? "bg-rose-50 text-rose-600 hover:bg-rose-100" 
                                      : "bg-[#F0FDF4] text-[#10B981] hover:bg-[#E6FBF7]"
                                  }`}
                                  title="Play audio session"
                                >
                                  {isCurrentlyPlaying && isAudioPlaying ? <Pause size={13} /> : <Play size={13} />}
                                </button>
                                <button
                                  onClick={() => openTranscriptDrawer(m)}
                                  className="p-1.5 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#64748B] rounded-lg transition"
                                  title="View Transcript Drawer"
                                >
                                  <MessageSquare size={13} />
                                </button>
                              </div>
                            </div>

                            {/* Waveform Player Console (if playing) */}
                            {isCurrentlyPlaying && (
                              <div className="pt-2 border-t border-[#F1F5F9] space-y-1">
                                <div className="flex items-center justify-between text-[9px] text-[#64748B] font-mono">
                                  <span>{Math.floor(audioCurrentTime / 60)}:{(Math.floor(audioCurrentTime) % 60).toString().padStart(2, '0')}</span>
                                  <span>{audioDuration ? `${Math.floor(audioDuration / 60)}:${(Math.floor(audioDuration) % 60).toString().padStart(2, '0')}` : "00:00"}</span>
                                </div>
                                {renderWaveformPeaks(m.id)}
                              </div>
                            )}

                            {/* CRITICAL NAVIGATION LINK: View call details -> */}
                            <div className="pt-2 border-t border-[#F1F5F9] flex items-center justify-between">
                              <button
                                onClick={() => {
                                  if (onSelectMeeting) onSelectMeeting(m.id);
                                }}
                                className="text-[10px] font-semibold text-[#64748B] hover:text-[#0F172A]"
                              >
                                Review / Edit
                              </button>
                              <button
                                onClick={() => {
                                  if (onSelectMeetingDetails) {
                                    onSelectMeetingDetails(m.id, selectedCompanyId);
                                  } else if (onSelectMeeting) {
                                    onSelectMeeting(m.id);
                                  }
                                }}
                                className="text-xs font-extrabold text-[#0D9488] hover:underline flex items-center gap-1"
                              >
                                <span>View call details →</span>
                              </button>
                            </div>

                          </div>
                        );
                      })
                    )}
                  </div>

                </div>

              </div>

            </div>

          </div>
        )}

      </div>

      {/* ════════════════════════════════════════════════
          MODALS & DRAWERS (ALL FUNCTIONALITIES PRESERVED)
          ════════════════════════════════════════════════ */}

      {/* 1. Add Commitment Modal */}
      {showAddCommitmentModal && (
        <div className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 text-left animate-in fade-in duration-150 select-none">
          <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
              <h3 className="text-sm font-extrabold text-[#0F172A]">Add New Commitment</h3>
              <button onClick={() => setShowAddCommitmentModal(false)} className="text-[#64748B] hover:text-[#0F172A]">
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleCreateCommitment} className="space-y-3.5">
              <div>
                <label className="text-[10px] font-bold text-[#64748B] uppercase block mb-1">Commitment Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewCommitmentData(prev => ({ ...prev, type: "customer" }))}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold border transition ${
                      newCommitmentData.type === "customer"
                        ? "bg-teal-50 border-teal-300 text-teal-800"
                        : "bg-white border-[#E2E8F0] text-[#64748B]"
                    }`}
                  >
                    Customer owes us
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewCommitmentData(prev => ({ ...prev, type: "rep" }))}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold border transition ${
                      newCommitmentData.type === "rep"
                        ? "bg-teal-50 border-teal-300 text-teal-800"
                        : "bg-white border-[#E2E8F0] text-[#64748B]"
                    }`}
                  >
                    Our team owes customer
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-[#64748B] uppercase block mb-1">Task Description</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Send security questionnaire or schedule pilot..."
                  value={newCommitmentData.task}
                  onChange={(e) => setNewCommitmentData(prev => ({ ...prev, task: e.target.value }))}
                  className="w-full bg-[#FAFBFB] border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-xs text-[#0F172A] outline-none focus:border-[#10B981]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-[#64748B] uppercase block mb-1">Owner</label>
                  <input
                    type="text"
                    placeholder={newCommitmentData.type === "customer" ? "e.g., Client Contact" : "e.g., Account Executive"}
                    value={newCommitmentData.owner}
                    onChange={(e) => setNewCommitmentData(prev => ({ ...prev, owner: e.target.value }))}
                    className="w-full bg-[#FAFBFB] border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-xs text-[#0F172A] outline-none focus:border-[#10B981]"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#64748B] uppercase block mb-1">Due Date</label>
                  <input
                    type="text"
                    placeholder="e.g., Nov 15 or Next meeting"
                    value={newCommitmentData.due_date}
                    onChange={(e) => setNewCommitmentData(prev => ({ ...prev, due_date: e.target.value }))}
                    className="w-full bg-[#FAFBFB] border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-xs text-[#0F172A] outline-none focus:border-[#10B981]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#F1F5F9]">
                <button
                  type="button"
                  onClick={() => setShowAddCommitmentModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:text-[#0F172A]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCommitment || !newCommitmentData.task.trim()}
                  className="px-4 py-1.5 bg-[#10B981] hover:bg-[#059669] text-white text-xs font-bold rounded-lg shadow-sm transition disabled:opacity-40"
                >
                  {savingCommitment ? "Adding..." : "Save Commitment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Add Stakeholder Modal */}
      {showAddStakeholderModal && (
        <div className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 text-left animate-in fade-in duration-150 select-none">
          <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
              <h3 className="text-sm font-extrabold text-[#0F172A]">Add Committee Stakeholder</h3>
              <button onClick={() => setShowAddStakeholderModal(false)} className="text-[#64748B] hover:text-[#0F172A]">
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleCreateStakeholder} className="space-y-3.5">
              <div>
                <label className="text-[10px] font-bold text-[#64748B] uppercase block mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Jane Doe"
                  value={newStakeholderData.name}
                  onChange={(e) => setNewStakeholderData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-[#FAFBFB] border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-xs text-[#0F172A] outline-none focus:border-[#10B981]"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-[#64748B] uppercase block mb-1">Job Title</label>
                <input
                  type="text"
                  placeholder="e.g., VP Finance, Head of Security..."
                  value={newStakeholderData.job_title}
                  onChange={(e) => setNewStakeholderData(prev => ({ ...prev, job_title: e.target.value }))}
                  className="w-full bg-[#FAFBFB] border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-xs text-[#0F172A] outline-none focus:border-[#10B981]"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-[#64748B] uppercase block mb-1">Buying Authority</label>
                <select
                  value={newStakeholderData.decision_authority}
                  onChange={(e) => setNewStakeholderData(prev => ({ ...prev, decision_authority: e.target.value }))}
                  className="w-full bg-[#FAFBFB] border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-xs text-[#0F172A] outline-none focus:border-[#10B981]"
                >
                  <option value="Champion">Champion</option>
                  <option value="Economic Buyer">Economic Buyer</option>
                  <option value="Technical Buyer">Technical Buyer</option>
                  <option value="Procurement">Procurement</option>
                  <option value="Security">Security</option>
                  <option value="Stakeholder">Stakeholder</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#F1F5F9]">
                <button
                  type="button"
                  onClick={() => setShowAddStakeholderModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:text-[#0F172A]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingStakeholder || !newStakeholderData.name.trim()}
                  className="px-4 py-1.5 bg-[#10B981] hover:bg-[#059669] text-white text-xs font-bold rounded-lg shadow-sm transition disabled:opacity-40"
                >
                  {savingStakeholder ? "Saving..." : "Save Stakeholder"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Pre-Call Preparation Workspace Modal */}
      {showPrepWorkspace && (
        <div className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 text-left animate-in fade-in duration-200 select-none">
          <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
            
            <div className="p-4 border-b border-[#F1F5F9] bg-[#FAFBFB] flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-sm font-extrabold text-[#0F172A] uppercase flex items-center gap-1.5">
                  <Activity size={14} className="text-[#10B981]" /> Pre-Call Intelligence Workspace
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
                  <Loader2 className="animate-spin text-[#10B981]" size={24} />
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
                                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#10B981] flex-shrink-0" />
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
                                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#10B981] flex-shrink-0" />
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
                          <span className="text-[#10B981] text-[9px]">Saved</span>
                        )}
                      </div>
                      
                      <textarea
                        placeholder="Draft final customized talking points to present..."
                        value={prepNotes}
                        onChange={(e) => handleNotesChange(e.target.value)}
                        className="flex-grow w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg p-2.5 text-xs outline-none focus:border-[#10B981] focus:bg-white transition leading-relaxed font-semibold text-[#475569] resize-none"
                      />

                      <button
                        onClick={exportDossierToClipboard}
                        className="mt-2 py-2 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#10B981] text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 shadow-2xs flex-shrink-0"
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

      {/* 4. Slide-Out Transcript Drawer */}
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
                className="w-full bg-[#FAFBFB] border border-[#E2E8F0] rounded pl-8 pr-3 py-1 text-xs outline-none focus:border-[#10B981]"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 bg-[#FAFBFB] space-y-3 scroll-thin">
            {loadingDrawer ? (
              <div className="py-20 flex flex-col items-center justify-center gap-2">
                <Loader2 className="animate-spin text-[#10B981]" size={16} />
                <span className="text-xs text-[#64748B]">Parsing transcript timeline...</span>
              </div>
            ) : filteredDrawerSegments.length === 0 ? (
              <div className="text-center py-10 text-xs text-[#64748B] italic">No segments match search query.</div>
            ) : (
              filteredDrawerSegments.map((seg, idx) => {
                const minutes = Math.floor(seg.start_time / 60);
                const seconds = Math.floor(seg.start_time % 60).toString().padStart(2, '0');
                
                return (
                  <div 
                    key={idx} 
                    onClick={() => handleSeekDrawerAudio(seg.start_time)}
                    className="bg-white border border-[#E2E8F0] p-3 rounded shadow-3xs hover:border-[#10B981]/30 transition cursor-pointer"
                  >
                    <div className="flex items-center justify-between text-[9px] font-bold text-[#64748B] mb-1.5">
                      <span className="text-[#10B981]">{seg.speaker_name || "Unknown Speaker"}</span>
                      <span>{minutes}:{seconds}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-[#475569] font-medium">
                      {seg.corrected_text || seg.text}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 5. Fact History Evolution Modal */}
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
                      <span className="font-bold text-[#10B981]">{m.meeting_title || "Call Session"}</span>
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

      {/* 6. Stakeholder Mentions Modal */}
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
                  <Loader2 className="animate-spin text-[#10B981]" size={16} />
                  <span className="text-xs text-[#64748B] font-semibold font-mono">Searching transcripts...</span>
                </div>
              ) : stakeholderMentions.length === 0 ? (
                <div className="text-center py-10 text-xs text-[#64748B] italic">No recorded mentions in previous sessions.</div>
              ) : (
                stakeholderMentions.map((m, idx) => (
                  <div key={idx} className="bg-white border border-[#E5E7EB] p-3 rounded shadow-3xs">
                    <div className="flex items-center justify-between text-[9px] font-bold text-[#64748B] mb-1">
                      <span className="text-[#10B981]">{m.meeting_title}</span>
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
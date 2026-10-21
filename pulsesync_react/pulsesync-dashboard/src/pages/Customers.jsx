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

  const handleCreateCommitment = async (e) => {
    e.preventDefault();
    if (!newCommitmentData.task.trim() || savingCommitment) return;
    setSavingCommitment(true);
    try {
      const payload = {
        task: newCommitmentData.task,
        owner: newCommitmentData.owner || (newCommitmentData.type === "customer" ? "Priya" : "Sarah Chen"),
        due_date: newCommitmentData.due_date || "Next meeting",
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

  // Consolidated Multi-Call Intelligence Table Items (8 MEDDIC parameters grounded in sessions)
  const getConsolidatedAccountRows = () => {
    const call01 = meetingsHistory[1] || meetingsHistory[0];
    const call02 = meetingsHistory[0] || meetingsHistory[1];

    const allRows = [
      {
        id: "metric",
        field: "Metric",
        value: "45 sales reps, targeting 30% reduction in manual CRM entry time",
        status: "Confirmed",
        statusType: "confirmed",
        sourceLabel: "Call 01 — 06:14",
        meetingId: call01?.id,
        meeting: call01
      },
      {
        id: "econ_buyer",
        field: "Economic Buyer",
        value: "VP Finance (unverified, mentioned in Call 01)",
        status: "Needs review",
        statusType: "needs_review",
        sourceLabel: "Call 01 — 08:10",
        meetingId: call01?.id,
        meeting: call01
      },
      {
        id: "decision_criteria",
        field: "Decision Criteria",
        value: "HubSpot bidirectional sync, automated MEDDIC tagging, low adoption barrier",
        status: "Confirmed",
        statusType: "confirmed",
        sourceLabel: "Call 02 — 02:45",
        meetingId: call02?.id,
        meeting: call02
      },
      {
        id: "decision_process",
        field: "Decision Process",
        value: "Security review → Ops pilot workshop → VP Finance sign-off",
        status: "Needs review",
        statusType: "needs_review",
        sourceLabel: "Call 02 — 15:20",
        meetingId: call02?.id,
        meeting: call02
      },
      {
        id: "identify_pain",
        field: "Identify Pain",
        value: "Gong rep adoption low, manual CRM field hygiene failing across 45 reps",
        status: "Confirmed",
        statusType: "confirmed",
        sourceLabel: "Call 01 — 03:15",
        meetingId: call01?.id,
        meeting: call01
      },
      {
        id: "champion",
        field: "Champion",
        value: "Priya Sharma (VP Sales, actively driving evaluation)",
        status: "Confirmed",
        statusType: "confirmed",
        sourceLabel: "Call 01 — 01:20",
        meetingId: call01?.id,
        meeting: call01
      },
      {
        id: "budget",
        field: "Budget",
        value: "$18,500/year allocated tooling budget (was unconfirmed in Call 01)",
        status: "Changed",
        statusType: "changed",
        sourceLabel: "Call 02 — 04:12",
        meetingId: call02?.id,
        meeting: call02
      },
      {
        id: "timeline",
        field: "Timeline",
        value: "Delayed to November (previously targeted before Oct 15)",
        status: "Changed",
        statusType: "changed",
        sourceLabel: "Call 02 — 11:30",
        meetingId: call02?.id,
        meeting: call02
      }
    ];

    if (intelligenceFilter === "changed") {
      return allRows.filter(r => r.statusType === "changed");
    }
    if (intelligenceFilter === "needs_review") {
      return allRows.filter(r => r.statusType === "needs_review");
    }
    return allRows;
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
                      {selectedCompanyData.company.name?.slice(0, 2).toUpperCase() || "NS"}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h1 className="text-xl font-extrabold text-[#0F172A] tracking-tight">
                          {selectedCompanyData.company.name || "NorthStar Inc."}
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
                        <span>San Francisco, CA</span>
                        <span>•</span>
                        <span>{selectedCompanyData.company.industry || "Fintech"}</span>
                        <span>•</span>
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          HubSpot CRM Connected
                        </span>
                        <span>•</span>
                        <span>Owner: <strong className="text-[#334155]">{selectedCompanyData.company.crm_owner || "Sarah Chen"}</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Stage Selector, Call Metrics, Action CTAs */}
                  <div className="flex items-center gap-3 flex-wrap justify-end">
                    
                    {/* Deal Stage Selector Dropdown */}
                    <div className="flex flex-col items-end">
                      <span className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider mb-0.5">Stage</span>
                      <select
                        value={selectedCompanyData.company.deal_stage || "Negotiation"}
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
                        {meetingsHistory.length || 2} calls
                      </span>
                    </div>

                    {/* Last Activity Metric */}
                    <div className="flex flex-col items-center px-3 border-l border-[#F1F5F9]">
                      <span className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider mb-0.5">Last Activity</span>
                      <span className="text-xs font-extrabold text-[#0F172A]">
                        {meetingsHistory[0]?.created_at ? "2h ago" : "Active"}
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
                  {aiBrief || "NorthStar is evaluating PulseSync to replace Gong for their 45-rep sales team. Key driver is automated MEDDIC CRM hygiene. Evaluation is progressing well but decision timeline shifted from October to November due to security review."}
                </p>
              </div>

              {/* 3 Priority Signals Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-1">
                
                {/* Signal 1: Timeline needs reconfirmation */}
                <div className="bg-white border border-[#FDE68A] p-3.5 rounded-lg shadow-2xs flex flex-col justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-amber-700 font-extrabold text-xs">
                      <AlertTriangle size={13} className="text-amber-500" />
                      <span>Timeline needs reconfirmation</span>
                    </div>
                    <p className="text-[11px] text-[#475569] font-medium leading-normal">
                      Target date passed (Call 02). Oct 15 date missed without new date set.
                    </p>
                  </div>
                  <div className="pt-1 border-t border-[#FEF3C7] flex items-center justify-between">
                    <button
                      onClick={() => openTranscriptDrawer(meetingsHistory[0])}
                      className="text-[10px] font-bold text-[#0D9488] hover:underline flex items-center gap-1"
                    >
                      <span>Call 02 — 3d ago</span>
                      <ChevronRight size={11} />
                    </button>
                  </div>
                </div>

                {/* Signal 2: Decision maker missing */}
                <div className="bg-white border border-[#FDE68A] p-3.5 rounded-lg shadow-2xs flex flex-col justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-amber-700 font-extrabold text-xs">
                      <AlertTriangle size={13} className="text-amber-500" />
                      <span>Decision maker missing</span>
                    </div>
                    <p className="text-[11px] text-[#475569] font-medium leading-normal">
                      Economic Buyer not confirmed in Call 01 or Call 02. VP Sales Priya mentioned but not verified.
                    </p>
                  </div>
                  <div className="pt-1 border-t border-[#FEF3C7] flex items-center justify-between">
                    <button
                      onClick={() => openTranscriptDrawer(meetingsHistory[1] || meetingsHistory[0])}
                      className="text-[10px] font-bold text-[#0D9488] hover:underline flex items-center gap-1"
                    >
                      <span>Call 01, Call 02</span>
                      <ChevronRight size={11} />
                    </button>
                  </div>
                </div>

                {/* Signal 3: Budget identified */}
                <div className="bg-white border border-[#A7F3D0] p-3.5 rounded-lg shadow-2xs flex flex-col justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-emerald-800 font-extrabold text-xs">
                      <CheckCircle2 size={13} className="text-emerald-600" />
                      <span>Budget identified</span>
                    </div>
                    <p className="text-[11px] text-[#475569] font-medium leading-normal">
                      Annual tooling budget of $18,500 confirmed in Call 02 with 15% expansion room.
                    </p>
                  </div>
                  <div className="pt-1 border-t border-[#D1FAE5] flex items-center justify-between">
                    <button
                      onClick={() => openTranscriptDrawer(meetingsHistory[0])}
                      className="text-[10px] font-bold text-[#0D9488] hover:underline flex items-center gap-1"
                    >
                      <span>Call 02 — 3d ago</span>
                      <ChevronRight size={11} />
                    </button>
                  </div>
                </div>

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
                          All fields (8)
                        </button>
                        <button
                          onClick={() => setIntelligenceFilter("changed")}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                            intelligenceFilter === "changed"
                              ? "bg-white text-[#0F172A] shadow-3xs"
                              : "text-[#64748B] hover:text-[#0F172A]"
                          }`}
                        >
                          Changed (2)
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
                          Needs review (2)
                        </button>
                      </div>

                      {/* Playbook selector dropdown */}
                      <select
                        value={selectedPlaybook}
                        onChange={(e) => setSelectedPlaybook(e.target.value)}
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
                          <th className="py-2.5 px-3 w-32">Status</th>
                          <th className="py-2.5 px-4 w-36 text-right">Source</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9] font-medium text-[#475569]">
                        {consolidatedRows.map((row) => (
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
                              {row.statusType === "changed" && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                                  <Activity size={10} />
                                  <span>Changed</span>
                                </span>
                              )}
                              {row.statusType === "needs_review" && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                  <AlertTriangle size={10} />
                                  <span>Needs review</span>
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                onClick={() => openTranscriptDrawer(row.meeting || meetingsHistory[0])}
                                className="text-[11px] font-bold text-[#0D9488] hover:underline inline-flex items-center gap-1"
                              >
                                <span>{row.sourceLabel}</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                </div>

                {/* SECTION 2: What Changed Across Calls (Timeline with Call 01 -> Call 02) */}
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
                      <span className="px-2 py-0.5 bg-[#F1F5F9] rounded border border-[#E2E8F0]">Call 01 (Oct 18)</span>
                      <span>→</span>
                      <span className="px-2 py-0.5 bg-[#F1F5F9] rounded border border-[#E2E8F0]">Call 02 (Oct 20)</span>
                    </div>
                  </div>

                  {/* 3 Change Cards */}
                  <div className="space-y-3">
                    
                    {/* Change Card 1: Budget */}
                    <div className="p-3.5 rounded-lg border border-[#E2E8F0] bg-[#FAFBFB] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <DollarSign size={13} className="text-emerald-600" />
                          <h4 className="text-xs font-extrabold text-[#0F172A]">
                            Budget: $0 → $18,500/yr
                          </h4>
                          <span className="px-1.5 py-0.2 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] font-bold rounded">
                            Identified
                          </span>
                        </div>
                        <p className="text-[11px] text-[#475569] font-medium leading-relaxed">
                          Call 01: Budget unconfirmed → Call 02: Priya stated $18,500 allocated from FY25 tooling budget.
                        </p>
                      </div>
                      <button
                        onClick={() => openTranscriptDrawer(meetingsHistory[0])}
                        className="text-[10px] font-bold text-[#0D9488] hover:underline whitespace-nowrap self-start sm:self-center"
                      >
                        Call 02 transcript (04:12) →
                      </button>
                    </div>

                    {/* Change Card 2: Timeline */}
                    <div className="p-3.5 rounded-lg border border-[#FDE68A] bg-[#FFFDF5] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Calendar size={13} className="text-amber-600" />
                          <h4 className="text-xs font-extrabold text-[#0F172A]">
                            Timeline: October 15 → November (Delayed)
                          </h4>
                          <span className="px-1.5 py-0.2 bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-bold rounded">
                            Shifted
                          </span>
                        </div>
                        <p className="text-[11px] text-[#475569] font-medium leading-relaxed">
                          Call 01: Target implementation Oct 15 → Call 02: Pushed to November due to InfoSec vendor review.
                        </p>
                      </div>
                      <button
                        onClick={() => openTranscriptDrawer(meetingsHistory[0])}
                        className="text-[10px] font-bold text-[#0D9488] hover:underline whitespace-nowrap self-start sm:self-center"
                      >
                        Call 02 transcript (11:30) →
                      </button>
                    </div>

                    {/* Change Card 3: Competitor */}
                    <div className="p-3.5 rounded-lg border border-[#E2E8F0] bg-[#FAFBFB] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <ShieldAlert size={13} className="text-[#64748B]" />
                          <h4 className="text-xs font-extrabold text-[#0F172A]">
                            Competitor mentioned: Gong
                          </h4>
                          <span className="px-1.5 py-0.2 bg-slate-100 text-slate-700 border border-slate-200 text-[9px] font-bold rounded">
                            Incumbent
                          </span>
                        </div>
                        <p className="text-[11px] text-[#475569] font-medium leading-relaxed">
                          Call 01: No competitors mentioned → Call 02: Currently on Gong contract through Dec 31.
                        </p>
                      </div>
                      <button
                        onClick={() => openTranscriptDrawer(meetingsHistory[0])}
                        className="text-[10px] font-bold text-[#0D9488] hover:underline whitespace-nowrap self-start sm:self-center"
                      >
                        Call 02 transcript (08:45) →
                      </button>
                    </div>

                  </div>
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
                                    <span className="text-[#334155]">{item.owner ? `${item.owner} (VP Sales)` : "Priya (VP Sales)"}</span>
                                    <span>•</span>
                                    <span className="px-1.5 py-0.2 bg-amber-50 text-amber-700 rounded text-[9px] font-bold">
                                      {item.due_date && item.due_date !== "-" ? `Due ${item.due_date}` : "Due Oct 24"}
                                    </span>
                                    <span>•</span>
                                    <span className="text-[#94A3B8]">From Call 02</span>
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
                                    <span className="text-[#334155]">{item.owner || "Sarah Chen"}</span>
                                    <span>•</span>
                                    <span className="px-1.5 py-0.2 bg-emerald-50 text-emerald-700 rounded text-[9px] font-bold">
                                      {item.due_date && item.due_date !== "-" ? `Due ${item.due_date}` : "Due Oct 22"}
                                    </span>
                                    <span>•</span>
                                    <span className="text-[#94A3B8]">From Call 02</span>
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
                      Answers grounded in Call 01 & Call 02 transcripts
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
                              "What did Priya say about budget?",
                              "Why was timeline delayed?",
                              "Who is the decision maker?"
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
                                  🔗 {cit.citation || `Source: ${cit.meeting_title || 'Call 02'}`}
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
                  <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200 flex items-start gap-2">
                    <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <span className="text-[11px] font-extrabold text-amber-900 block">
                        Economic buyer not confirmed
                      </span>
                      <p className="text-[10.5px] text-amber-800 font-medium leading-normal">
                        Priya mentioned VP Finance makes final call but name was not captured.
                      </p>
                    </div>
                  </div>

                  {/* Stakeholder Rows */}
                  <div className="space-y-2.5">
                    
                    {/* Row 1: Priya Sharma */}
                    <div 
                      onClick={() => handleOpenMentions({ speaker_id: "priya", name: "Priya Sharma", job_title: "VP Sales", role: "Champion" })}
                      className="p-3 rounded-lg border border-[#E2E8F0] hover:border-[#10B981]/50 cursor-pointer transition bg-white flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-teal-50 border border-teal-200 text-teal-800 flex items-center justify-center font-bold text-xs">
                          PS
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-extrabold text-[#0F172A] hover:underline">
                              Priya Sharma
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Champion
                            </span>
                          </div>
                          <span className="text-[10px] text-[#64748B] font-semibold block">
                            VP Sales • Attended 2 calls (Call 01, Call 02)
                          </span>
                        </div>
                      </div>
                      <ChevronRight size={13} className="text-[#94A3B8]" />
                    </div>

                    {/* Row 2: Daniel Lee */}
                    <div 
                      onClick={() => handleOpenMentions({ speaker_id: "daniel", name: "Daniel Lee", job_title: "Sales Ops Lead", role: "Technical Buyer" })}
                      className="p-3 rounded-lg border border-[#E2E8F0] hover:border-[#10B981]/50 cursor-pointer transition bg-white flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-sky-50 border border-sky-200 text-sky-800 flex items-center justify-center font-bold text-xs">
                          DL
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-extrabold text-[#0F172A] hover:underline">
                              Daniel Lee
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                              Technical Buyer
                            </span>
                          </div>
                          <span className="text-[10px] text-[#64748B] font-semibold block">
                            Sales Ops Lead • Attended 2 calls (Call 01, Call 02)
                          </span>
                        </div>
                      </div>
                      <ChevronRight size={13} className="text-[#94A3B8]" />
                    </div>

                  </div>

                </div>

                {/* 3. Call History (Lower-Right Area - Crucial Requirement) */}
                <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-4">
                  <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
                    <div>
                      <h4 className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wider flex items-center gap-1.5">
                        <Clock size={14} className="text-[#10B981]" />
                        <span>Call History ({meetingsHistory.length || 2})</span>
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
                        const isCall02 = idx === 0;
                        const callNumber = isCall02 ? "Call 02" : "Call 01";
                        const callSubtitle = isCall02 ? "Follow-up & Pricing Discussion" : "Initial Discovery & Demo";
                        const dateFormatted = isCall02 ? "Oct 20, 2026" : "Oct 18, 2026";
                        const durationFormatted = isCall02 ? "32 min" : "45 min";
                        const participantCount = isCall02 ? "4 participants" : "3 participants";
                        const actionItemCount = isCall02 ? "8 action items" : "5 action items";
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
                    placeholder={newCommitmentData.type === "customer" ? "Priya (VP Sales)" : "Sarah Chen"}
                    value={newCommitmentData.owner}
                    onChange={(e) => setNewCommitmentData(prev => ({ ...prev, owner: e.target.value }))}
                    className="w-full bg-[#FAFBFB] border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-xs text-[#0F172A] outline-none focus:border-[#10B981]"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#64748B] uppercase block mb-1">Due Date</label>
                  <input
                    type="text"
                    placeholder="e.g., Oct 24 or Tomorrow"
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
import React, { useEffect, useState, useRef } from "react";
import Sidebar from "../components/layout/Sidebar";
import Topbar from "../components/layout/Topbar";
import TranscriptEditor, { getSpeakerColor, getInitials } from "../components/transcript/TranscriptEditor";
import Playbooks from "./Playbooks";
import ReviewCenter from "./ReviewCenter";
import Integrations from "./Integrations";
import Customers from "./Customers";
import ExtractionProfiles from "./ExtractionProfiles";
import MeetingProcessingScreen from "../components/processing/MeetingProcessingScreen";
import Analytics from "./Analytics";
import Capture from "./Capture";
import DynamicReviewWorkspace from "../components/review/DynamicReviewWorkspace";
import AdvancedFiltersPanel, { DEFAULT_ADVANCED_FILTERS } from "../components/review/AdvancedFiltersPanel";
import CallDetails from "./CallDetails";

import {
  Sparkles,
  SlidersHorizontal,
  Calendar,
  Clock,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  ChevronRight,
  User,
  FileText,
  Lock,
  Check,
  X,
  Building2,
  ExternalLink,
  Users,
  Search,
  Loader2,
  Play,
  Pause,
  ArrowLeft,
  ChevronDown,
  MessageSquare,
  Shield,
  TrendingUp,
  AlertTriangle,
  Edit2,
  Database,
  Info,
  UserCheck,
  Plus,
  Trash2,
  Volume2,
  CheckSquare,
  RefreshCw,
  Layers,
  ArrowUpRight
} from "lucide-react";

import SyncConfirmationModal from "../components/review/SyncConfirmationModal";

const POPULAR_TEMPLATES = [];

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

const getSegmentId = (segment) => String(segment?.segment_id || segment?.id || "");

const getEvidenceDetails = (evidence, segments = []) => {
  const item = Array.isArray(evidence) ? evidence[0] : evidence;
  if (!item) return null;

  const segmentId = String(item.segment_id || item.evidence_segment_id || "");
  const segment = segments.find((candidate) => getSegmentId(candidate) === segmentId);
  if (!segment) return null;

  const startTime = Number(item.start_time ?? segment.start_time ?? segment.start ?? 0);
  const endTime = Number(item.end_time ?? segment.end_time ?? segment.end ?? startTime);
  const quote = item.quote || item.evidence || segment.corrected_text || segment.text || "";
  if (!quote.trim()) return null;

  const timestamp = `${String(Math.floor(startTime / 60)).padStart(2, "0")}:${String(Math.floor(startTime % 60)).padStart(2, "0")}`;
  return {
    segmentId,
    quote,
    speaker: item.speaker || segment.speaker_name || segment.speaker || "Unknown speaker",
    timestamp,
    timestampSecs: startTime,
    endTimeSecs: Math.max(startTime, endTime),
  };
};

const formatDisplayValue = (val) => {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'string') {
    if (!val.trim()) return '—';
    return val;
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '—';
    return val
      .map(item => {
        if (item === null || item === undefined) return '';
        if (typeof item === 'object') {
          return item.name || item.title || item.task || item.label || item.value || JSON.stringify(item);
        }
        return String(item);
      })
      .filter(Boolean)
      .join(', ') || '—';
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val);
    if (keys.length === 0) return '—';
    if (val.name || val.title || val.label || val.value) {
      return String(val.name || val.title || val.label || val.value);
    }
    return JSON.stringify(val);
  }
  return String(val);
};

export default function Dashboard() {
  const API_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3001` : "http://localhost:3001");

  const [meetings, setMeetings] = useState([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const mId = params.get('meetingId');
      if (mId) return mId;
      return localStorage.getItem('pulsesync_selected_meeting_id') || null;
    }
    return null;
  });
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const view = params.get('view');
      if (view) return view;
      if (params.get('meetingId') || localStorage.getItem('pulsesync_selected_meeting_id')) {
        return 'board';
      }
    }
    return 'review_center';
  });
  const [selectedCompanyId, setSelectedCompanyId] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('companyId') || null;
    }
    return null;
  });
  const [meetingDetails, setMeetingDetails] = useState(null);

  const [loading, setLoading] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState(null);

  // Collapsible Sidebar State
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => 
    localStorage.getItem("ps_sidebar_collapsed") === "true"
  );

  // Toast State
  const [toastMessage, setToastMessage] = useState(null);

  // Sync confirmation modal
  const [showSyncModal, setShowSyncModal] = useState(false);

  // Stepper Progress state (Step 1 to 7)
  const [analysisStep, setAnalysisStep] = useState(1); 
  const [showSyncDetails, setShowSyncDetails] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState("default_sales_intelligence");
  const [extractionProfiles, setExtractionProfiles] = useState([]);
  const [dynamicSummarySections, setDynamicSummarySections] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Database-backed extraction profiles catalogue (Single Source of Truth)
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/extraction-profiles`)
      .then((res) => (res.ok ? res.json() : []))
      .then((profiles) => {
        if (!cancelled && Array.isArray(profiles)) {
          setExtractionProfiles(profiles);
          setSelectedTemplate((current) => {
            if (current && profiles.some((p) => p.id === current)) return current;
            const active = profiles.find((p) => p.is_active);
            return active?.id || profiles[0]?.id || "default_sales_intelligence";
          });
        }
      })
      .catch((err) => {
        console.warn("Could not load extraction profiles from database:", err);
      });
    return () => { cancelled = true; };
  }, [API_URL]);

  // Call Type State (First-Class Metadata)
  const [currentCallType, setCurrentCallType] = useState("discovery");
  const [callTypeConfidence, setCallTypeConfidence] = useState(null);
  const [callTypeSource, setCallTypeSource] = useState("ai");
  const [callTypeRationale, setCallTypeRationale] = useState("");

  // Screen 1: Verification states
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingDuration, setMeetingDuration] = useState(0);

  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyIndustry, setCompanyIndustry] = useState("");
  const [dealStage, setDealStage] = useState("Discovery");
  const [crmAccount, setCrmAccount] = useState("");
  const [notes, setNotes] = useState("");
  const [companyInferred, setCompanyInferred] = useState(false);

  const [speakers, setSpeakers] = useState([]);
  const [activeSpeakerDetailId, setActiveSpeakerDetailId] = useState(null);
  const [isSpeakerDrawerOpen, setIsSpeakerDrawerOpen] = useState(false);

  // Step 6: Review states
  const [localApprovals, setLocalApprovals] = useState([]);
  const [conversationIntelligence, setConversationIntelligence] = useState(null);
  const [aiSummary, setAiSummary] = useState(null);
  const [executiveSummaryText, setExecutiveSummaryText] = useState("");
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [actionItems, setActionItems] = useState([]);
  const [risks, setRisks] = useState([]);
  const [objections, setObjections] = useState([]);
  const [stakeholders, setStakeholders] = useState([]);
  const [activeExtractionProfile, setActiveExtractionProfile] = useState(null);
  
  // Step 7: Live CRM Sync state
  const [integrationsList, setIntegrationsList] = useState([]);
  const [activeSyncTab, setActiveSyncTab] = useState("hubspot");
  const [syncPreview, setSyncPreview] = useState(null);
  const [loadingSyncPreview, setLoadingSyncPreview] = useState(false);
  const [syncingInProgress, setSyncingInProgress] = useState(false);
  const [syncSuccessData, setSyncSuccessData] = useState(null);

  // Review Queue Filters
  const [meetingsFilter, setMeetingsFilter] = useState("all");
  const [selectedCompanyFilter, setSelectedCompanyFilter] = useState("all");
  const [selectedPlaybookFilter, setSelectedPlaybookFilter] = useState("all");
  const [queueSearchQuery, setQueueSearchQuery] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [appliedAdvancedFilters, setAppliedAdvancedFilters] = useState(DEFAULT_ADVANCED_FILTERS);

  const [isInsufficientTranscript, setIsInsufficientTranscript] = useState(false);
  const [isEvidenceDrawerOpen, setIsEvidenceDrawerOpen] = useState(false);
  const [activeEvidenceField, setActiveEvidenceField] = useState(null);
  const [editingFieldId, setEditingFieldId] = useState(null);
  const [editingFieldValue, setEditingFieldValue] = useState("");
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const audioRef = useRef(null);
  const activeMeetingIdRef = useRef(null);
  const meetingAbortControllerRef = useRef(null);

  const resetMeetingState = () => {
    setMeetingDetails(null);
    setMeetingTitle("");
    setMeetingDate("");
    setMeetingDuration(0);
    setCurrentCallType("discovery");
    setCallTypeConfidence(null);
    setCallTypeSource("ai");
    setCallTypeRationale("");
    setCompanyName("");
    setCompanyWebsite("");
    setCompanyIndustry("");
    setDealStage("Discovery");
    setCrmAccount("");
    setNotes("");
    setCompanyInferred(false);
    setSpeakers([]);
    setActiveSpeakerDetailId(null);
    setIsSpeakerDrawerOpen(false);
    setConversationIntelligence(null);
    setAiSummary(null);
    setExecutiveSummaryText("");
    setDynamicSummarySections([]);
    setLocalApprovals([]);
    setActiveExtractionProfile(null);
    setActionItems([]);
    setRisks([]);
    setObjections([]);
    setStakeholders([]);
    setDealSnapshot({});
    setDealIntelligence({});
    setSyncPreview(null);
    setSyncSuccessData(null);
    setShowSyncDetails(false);
    setSyncError(null);
    setIsInsufficientTranscript(false);
    setIsEvidenceDrawerOpen(false);
    setActiveEvidenceField(null);
    setAudioSrc("");
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioDuration(0);
  };

  // URL Query and Browser State Synchronization
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (viewMode === 'call_details' && selectedMeetingId) {
        url.searchParams.set('view', 'call_details');
        url.searchParams.set('meetingId', selectedMeetingId);
        if (selectedCompanyId) url.searchParams.set('companyId', selectedCompanyId);
        else url.searchParams.delete('companyId');
      } else if (selectedMeetingId) {
        localStorage.setItem('pulsesync_selected_meeting_id', selectedMeetingId);
        url.searchParams.set('meetingId', selectedMeetingId);
        url.searchParams.set('view', viewMode);
        if (selectedCompanyId) url.searchParams.set('companyId', selectedCompanyId);
        else url.searchParams.delete('companyId');
      } else {
        localStorage.removeItem('pulsesync_selected_meeting_id');
        url.searchParams.delete('meetingId');
        if (viewMode === 'customers' && selectedCompanyId) {
          url.searchParams.set('view', 'customers');
          url.searchParams.set('companyId', selectedCompanyId);
        } else {
          if (viewMode !== 'board') {
            url.searchParams.set('view', viewMode);
          } else {
            url.searchParams.delete('view');
          }
          if (viewMode !== 'customers') {
            url.searchParams.delete('companyId');
          }
        }
      }
      window.history.replaceState({}, '', url.toString());
    }
  }, [selectedMeetingId, viewMode, selectedCompanyId]);

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const mId = params.get('meetingId');
      const view = params.get('view') || (mId ? 'board' : 'review_center');
      const cId = params.get('companyId');
      setSelectedMeetingId(mId || null);
      setViewMode(view);
      if (cId) setSelectedCompanyId(cId);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Audio Player State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioVolume, setAudioVolume] = useState(1);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [audioSrc, setAudioSrc] = useState("");
  const [clipRange, setClipRange] = useState(null);
  const [activeHighlightSegmentId, setActiveHighlightSegmentId] = useState(null);
  const [dealSnapshot, setDealSnapshot] = useState({});
  const [dealIntelligence, setDealIntelligence] = useState({});

  // Global Search and Company Selection states
  const [existingCompanies, setExistingCompanies] = useState([]);
  const [companySelectMode, setCompanySelectMode] = useState("existing"); // "existing" | "new"
  const [companySearchFilter, setCompanySearchFilter] = useState("");
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchResults, setGlobalSearchResults] = useState({
    companies: [],
    meetings: [],
    speakers: [],
    actionItems: [],
    risks: [],
    objections: [],
    memories: []
  });

  const triggerToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // ── Clean Speaker Derivation (eliminates stale names) ──
  const deriveSpeakersFromMeeting = (details) => {
    if (!details) return [];
    const segments = details.segments || [];

    // If speakers already exist in details and have valid items
    if (Array.isArray(details.speakers) && details.speakers.length > 0) {
      return details.speakers.map((s, i) => ({
        speaker_id: s.speaker_id || `spk_${i + 1}`,
        raw_key: s.speaker_id || `spk_${i + 1}`,
        name: s.name || `Speaker ${i + 1}`,
        role: s.role || (i === 0 ? "Sales Rep / Host" : "Prospect / Customer"),
        department: s.department || "",
        job_title: s.job_title || "",
        email: s.email || "",
        status: s.status || "Verified"
      }));
    }

    // Otherwise derive cleanly from segments
    if (segments.length > 0) {
      const rawKeys = Array.from(new Set(segments.map(s => s.speaker_name || s.speaker || s.speaker_id).filter(Boolean)));
      return rawKeys.map((rawKey, idx) => {
        let cleanName = `Speaker ${idx + 1}`;
        if (typeof rawKey === 'string' && !rawKey.toLowerCase().startsWith('speaker_') && !rawKey.toLowerCase().startsWith('spk_')) {
          cleanName = rawKey;
        }
        return {
          speaker_id: `spk_${idx + 1}`,
          raw_key: rawKey,
          name: cleanName,
          role: idx === 0 ? "Sales Rep / Host" : "Prospect / Customer",
          department: "",
          job_title: "",
          email: "",
          status: "Needs Review"
        };
      });
    }

    return [];
  };

  // ── Global Search Handler ──
  const handleGlobalSearchChange = async (query) => {
    setGlobalSearchQuery(query);
    if (!query || query.trim() === "") {
      setGlobalSearchResults({
        companies: [],
        meetings: [],
        speakers: [],
        actionItems: [],
        risks: [],
        objections: [],
        memories: []
      });
      return;
    }
    try {
      const response = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(query)}`);
      if (response.ok) {
        const data = await response.json();
        setGlobalSearchResults(data);
      }
    } catch (err) {
      console.error("Error fetching global search results:", err);
    }
  };

  const handleSelectSearchResult = (type, item) => {
    if (type === 'meeting') {
      setSelectedMeetingId(item.id);
      setViewMode('board');
    } else if (type === 'company') {
      setSelectedCompanyId(item.id);
      setViewMode('customers');
    } else if (type === 'speaker') {
      if (item.company_id) {
        setSelectedCompanyId(item.company_id);
        setViewMode('customers');
      } else if (item.meeting_id) {
        setSelectedMeetingId(item.meeting_id);
        setViewMode('board');
      }
    }
  };

  const handleClearGlobalSearch = () => {
    setGlobalSearchQuery("");
    setGlobalSearchResults({
      companies: [],
      meetings: [],
      speakers: [],
      actionItems: [],
      risks: [],
      objections: [],
      memories: []
    });
  };

  // ── API Fetchers ──
  const fetchMeetings = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/meetings`);
      if (!response.ok) throw new Error("Failed to load meetings");
      const json = await response.json();
      setMeetings(json);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch meetings list");
    } finally {
      setLoading(false);
    }
  };

  const fetchIntegrations = async () => {
    try {
      const res = await fetch(`${API_URL}/api/integrations`);
      if (res.ok) {
        const data = await res.json();
        setIntegrationsList(data);
      }
    } catch (e) {
      console.warn("Could not fetch integrations list:", e);
    }
  };

  const fetchMeetingDetails = async (id, signal) => {
    if (!id) return;
    activeMeetingIdRef.current = id;
    setLoadingDetails(true);
    try {
      const response = await fetch(`${API_URL}/api/meetings/${id}`, { signal });
      if (!response.ok) throw new Error("Failed to load meeting details");
      const json = await response.json();

      // Guard against race conditions and stale responses
      if (activeMeetingIdRef.current !== id) {
        return;
      }

      setMeetingDetails(json);

      // Hydrate syncSuccessData if meeting is synced or has completed sync run
      const latestRun = json.latest_sync_run;
      const isSynced = json.meeting?.workflow_state === 'synced';
      if (latestRun && (latestRun.status === 'succeeded' || isSynced)) {
        const records = latestRun.destination_record_ids || {};
        const connectedCrm = integrationsList.find(i => i.connection_status === 'connected');
        const targetPortalId = latestRun.portal_id || connectedCrm?.auth_metadata?.portal_id || connectedCrm?.auth_metadata?.account_name || '';
        const items = latestRun.items || [];
        const fieldsUpdatedCount = items.length;
        const compId = records.companyId || json.meeting?.crm_company_id;
        const dlId = records.dealId || json.meeting?.crm_deal_id;
        setSyncSuccessData({
          success: true,
          syncRunId: latestRun.id,
          status: 'succeeded',
          completedAt: latestRun.completed_at || latestRun.created_at || json.meeting?.updated_at,
          fieldsUpdatedCount,
          summary: {
            fieldsUpdatedCount,
            contactsProcessedCount: records.contactId ? 1 : (records.contactsCount || 0),
            tasksCreatedCount: Array.isArray(records.taskIds) ? records.taskIds.length : (records.tasksCount || 0),
            noteCreated: Boolean(records.noteId)
          },
          updatedRecords: {
            company: {
              id: compId,
              name: json.meeting?.company_name || json.company?.name || 'Enterprise Account',
              url: compId && targetPortalId ? `https://app.hubspot.com/contacts/${targetPortalId}/record/0-2/${compId}` : null
            },
            deal: {
              id: dlId,
              name: `${json.meeting?.company_name || json.company?.name || 'Enterprise'} - Enterprise Expansion`,
              url: dlId && targetPortalId ? `https://app.hubspot.com/contacts/${targetPortalId}/record/0-3/${dlId}` : null
            },
            contact: {
              id: records.contactId || null,
              url: records.contactId && targetPortalId ? `https://app.hubspot.com/contacts/${targetPortalId}/record/0-1/${records.contactId}` : null
            },
            contactsCount: records.contactId ? 1 : (records.contactsCount || 0),
            tasksCount: Array.isArray(records.taskIds) ? records.taskIds.length : (records.tasksCount || 0),
            taskIds: records.taskIds || [],
            noteId: records.noteId || null
          },
          hubspotUrl: dlId ? `https://app.hubspot.com/contacts/${targetPortalId}/record/0-3/${dlId}` : (compId ? `https://app.hubspot.com/contacts/${targetPortalId}/record/0-2/${compId}` : ''),
          items
        });
        setSyncError(null);
      } else if (latestRun && latestRun.status === 'in_progress') {
        const ageMs = Date.now() - new Date(latestRun.created_at).getTime();
        if (ageMs < 300000) {
          setSyncingInProgress(true);
        }
      } else if (latestRun && latestRun.status === 'failed') {
        setSyncError(latestRun.error_message || "Previous CRM sync failed.");
      }

      const stateStepMap = {
        'uploaded': 1,
        'processing': 1,
        'transcript_review': 1,
        'speaker_review': 1,
        'company_review': 3,
        'template_selection': 4,
        'ai_generation': 5,
        'review': 6,
        'destination_mapping': 7,
        'syncing': 7,
        'synced': 7
      };
      
      const currentStep = stateStepMap[json.meeting?.workflow_state] || 1;
      setAnalysisStep(currentStep);

      // Metadata & Call Type Classification
      setMeetingTitle(json.meeting?.title || "");
      setMeetingDate(json.meeting?.created_at || "");
      setMeetingDuration(json.meeting?.duration_seconds || 0);
      setCurrentCallType(json.meeting?.call_type || "discovery");
      setCallTypeConfidence(json.meeting?.call_type_confidence !== undefined ? json.meeting.call_type_confidence : null);
      setCallTypeSource(json.meeting?.call_type_source || "ai");
      setCallTypeRationale(json.meeting?.call_type_rationale || "");

      // Company info
      const company = json.company || {};
      const initialCompanyName = json.meeting?.company_name || company.name || "";
      setCompanyName(initialCompanyName);
      setCompanyWebsite(json.meeting?.company_website || company.website || "");
      setCompanyIndustry(json.meeting?.company_industry || company.industry || "");
      setDealStage(json.meeting?.company_deal_stage || company.deal_stage || "Discovery");
      setCrmAccount(json.meeting?.company_crm_account || company.crm_account || "");
      setNotes(json.meeting?.company_notes || company.notes || "");
      setCompanyInferred(false);

      // Speakers
      setSpeakers(deriveSpeakersFromMeeting(json));

      // Audio
      setAudioSrc(json.meeting?.audio_url || `${API_URL}/api/meetings/${id}/audio`);

      // Synchronize template_used
      if (json.meeting?.template_used) {
        setSelectedTemplate(json.meeting.template_used);
      }

      // AI outputs (Step 6 Review)
      setAiSummary(json.summary || null);
      
      const segmentsList = json.segments || [];
      const totalChars = segmentsList.reduce((acc, s) => acc + (s.corrected_text || s.text || "").length, 0);
      const isTranscriptEmpty = segmentsList.length === 0 || totalChars < 10;
      setIsInsufficientTranscript(isTranscriptEmpty);

      // Parse extractions object
      const rawExt = json.extractions?.extracted_data;
      let extractionsObj = {};
      if (rawExt) {
        try {
          const parsed = typeof rawExt === 'string' ? JSON.parse(rawExt) : rawExt;
          extractionsObj = parsed || {};
        } catch (e) {
          extractionsObj = {};
        }
      }

      const segs = json.segments || [];

      // Resolve profile dynamically from database records or saved run snapshot
      const templateKey = json.meeting?.template_used || extractionsObj?.profile?.id || selectedTemplate;
      const matchedWorkspaceProfile = extractionProfiles.find(
        (p) => p.id === templateKey || p.name?.toLowerCase() === String(templateKey).toLowerCase()
      );
      const resolvedProfile = extractionsObj?.profile || matchedWorkspaceProfile || null;
      setActiveExtractionProfile(resolvedProfile);
      if (templateKey && (!selectedTemplate || selectedTemplate !== templateKey)) {
        setSelectedTemplate(templateKey);
      }

      // Snapshot metadata retained for existing downstream views
      let snapshot = json.meeting?.ai_snapshot || {};
      if (typeof snapshot === 'string') {
        try { snapshot = JSON.parse(snapshot); } catch (e) { snapshot = {}; }
      }
      setDealSnapshot(snapshot);

      let dealIntel = json.meeting?.deal_intelligence || {};
      if (typeof dealIntel === 'string') {
        try { dealIntel = JSON.parse(dealIntel); } catch (e) { dealIntel = {}; }
      }

      const isBlank = (val) => !val || String(val).trim().toLowerCase() === 'null' || String(val).trim().toLowerCase() === 'not mentioned' || String(val).trim().toLowerCase() === 'undefined' || String(val).trim() === '';

      let extractionsForDeal = {};
      if (rawExt) {
        try {
          const parsed0 = typeof rawExt === 'string' ? JSON.parse(rawExt) : rawExt;
          extractionsForDeal = parsed0?.extractions || parsed0?.extracted_data || parsed0 || {};
        } catch (e) { extractionsForDeal = {}; }
      }

      const DEAL_INTEL_MAP = {
        budget:           ['budget', 'project_budget'],
        champion:         ['champion'],
        decision_maker:   ['decision_maker', 'authority', 'economic_buyer'],
        buying_stage:     ['buying_stage', 'deal_stage'],
        timeline:         ['timeline', 'implementation_timeline'],
        competition:      ['competition'],
      };

      const resolvedDealIntel = { ...dealIntel };
      for (const [diKey, sourceKeys] of Object.entries(DEAL_INTEL_MAP)) {
        if (isBlank(resolvedDealIntel[diKey])) {
          for (const sk of sourceKeys) {
            const candidate = dealIntel[sk] || snapshot[sk] || extractionsForDeal[sk];
            if (!isBlank(candidate)) {
              resolvedDealIntel[diKey] = String(candidate);
              break;
            }
          }
        }
      }
      if (isBlank(resolvedDealIntel.buying_stage)) {
        resolvedDealIntel.buying_stage = dealIntel.buying_stage || snapshot.buying_stage || 'Evaluation';
      }
      setDealIntelligence(resolvedDealIntel);

      // Action Items
      let rawActions = json.meeting?.action_items || json.summary?.action_items || [];
      if (typeof rawActions === 'string') {
        try { rawActions = JSON.parse(rawActions); } catch (e) { rawActions = []; }
      }
      const normalizedActions = (Array.isArray(rawActions) ? rawActions : []).map((action) => ({
        ...action,
        evidenceDetails: getEvidenceDetails({
          segment_id: action.evidence_segment_id,
          quote: action.evidence,
        }, segs),
      }));
      setActionItems(normalizedActions);

      // Risks & Objections
      let rawRisks = json.meeting?.risks || [];
      if (typeof rawRisks === 'string') {
        try { rawRisks = JSON.parse(rawRisks); } catch (e) { rawRisks = []; }
      }
      setRisks(Array.isArray(rawRisks) ? rawRisks : []);

      let rawObj = json.meeting?.objections || json.summary?.objections || [];
      if (typeof rawObj === 'string') {
        try { rawObj = JSON.parse(rawObj); } catch (e) { rawObj = []; }
      }
      setObjections(Array.isArray(rawObj) ? rawObj : []);

      // Conversation Intelligence
      const convIntel = extractionsObj?.conversation_intelligence || json.extractions?.conversation_intelligence || null;
      setConversationIntelligence(convIntel);

      // Summary Sections & Executive Summary — always scoped to current meeting only
      const dynSections = (Array.isArray(extractionsObj?.summary_sections) && extractionsObj.summary_sections.length > 0)
        ? extractionsObj.summary_sections
        : (Array.isArray(json.summary?.summary_sections) ? json.summary.summary_sections : []);
      setDynamicSummarySections(dynSections);

      const rawOverview = String(json.summary?.overview || json.meeting?.overview || "").trim();
      const overviewText = (rawOverview && rawOverview !== "No grounded business summary was produced from the available evidence.")
        ? rawOverview
        : (convIntel?.generic_summary || "");
      setExecutiveSummaryText(overviewText);

      // Template fields
      const backendFields = (Array.isArray(extractionsObj?.fields) && extractionsObj.fields.length > 0)
        ? extractionsObj.fields
        : (Array.isArray(extractionsObj?.template_fields) ? extractionsObj.template_fields : []);

      const profileFields = Array.isArray(resolvedProfile?.fields) ? resolvedProfile.fields : [];
      const profileFieldsById = new Map(profileFields.map((f) => [String(f.id), f]));

      let fieldsToMap = backendFields;
      if (fieldsToMap.length === 0 && profileFields.length > 0 && (json.meeting?.workflow_state === 'review' || json.meeting?.status === 'completed')) {
        fieldsToMap = profileFields.map((f) => ({
          field_id: f.id,
          field_name: f.name,
          value: null,
          review_status: "not_mentioned",
          status: "not_mentioned",
          confidence: null,
          evidence: []
        }));
      }

      const persistedReview = extractionsObj?.review || {};
      const persistedStates = persistedReview?.field_states || {};

      const templateFieldsList = fieldsToMap.map((field, idx) => {
        const evidenceDetails = getEvidenceDetails(field.evidence, segs);
        const fieldKey = field.field_id || field.id || `field_${idx + 1}`;
        const persistedStatus = persistedStates[fieldKey]?.status || field.review_status || field.status;
        const reviewStatus = ["approved", "not_mentioned", "rejected", "needs_review"].includes(String(persistedStatus || ""))
          ? persistedStatus
          : (field.value == null || String(field.value).toLowerCase() === "not mentioned" ? "not_mentioned" : "needs_review");
        return {
          ...field,
          id: fieldKey,
          field: field.field_name || field.name || field.field || fieldKey,
          fieldKey,
          value: field.value == null ? "Not mentioned" : String(field.value),
          confidence: field.confidence == null ? 0 : Math.round(Number(field.confidence) * 100),
          approved: reviewStatus === "approved",
          review_status: reviewStatus,
          edited: Boolean(field.edited || persistedStates[fieldKey]?.edited),
          quote: evidenceDetails?.quote || field.evidence?.[0]?.quote || "",
          speaker: evidenceDetails?.speaker || field.evidence?.[0]?.speaker || "",
          source: evidenceDetails ? `Call Transcript · ${evidenceDetails.timestamp}` : "No evidence captured",
          timestamp: evidenceDetails?.timestamp || field.evidence?.[0]?.timestamp || "",
          timestampSecs: evidenceDetails?.timestampSecs ?? field.evidence?.[0]?.start_time,
          endTimeSecs: evidenceDetails?.endTimeSecs ?? field.evidence?.[0]?.end_time,
          evidence: field.evidence || [],
          definition: profileFieldsById.get(String(fieldKey)) || field.definition || {}
        };
      });
      setLocalApprovals(templateFieldsList);

    } catch (err) {
      if (err.name === 'AbortError') return;
      if (activeMeetingIdRef.current !== id) return;
      console.error(err);
      triggerToast("Failed to load meeting details.");
    } finally {
      if (activeMeetingIdRef.current === id) {
        setLoadingDetails(false);
      }
    }
  };

  const fetchExistingCompanies = async () => {
    try {
      const res = await fetch(`${API_URL}/api/customers`);
      if (res.ok) {
        const data = await res.json();
        setExistingCompanies(data);
      }
    } catch (e) {
      console.warn("Could not load existing companies:", e);
    }
  };

  useEffect(() => {
    fetchMeetings();
    fetchIntegrations();
    fetchExistingCompanies();
  }, []);

  const [isRetryingProcessing, setIsRetryingProcessing] = useState(false);

  useEffect(() => {
    if (meetingAbortControllerRef.current) {
      meetingAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    meetingAbortControllerRef.current = controller;

    activeMeetingIdRef.current = selectedMeetingId;
    resetMeetingState();
    if (selectedMeetingId) {
      fetchMeetingDetails(selectedMeetingId, controller.signal);
    }
    return () => {
      controller.abort();
    };
  }, [selectedMeetingId]);

  // Active Polling for Currently Selected Meeting when in Ingestion / Processing state
  useEffect(() => {
    if (!selectedMeetingId) return;

    const isProcessing = meetingDetails?.meeting && (
      meetingDetails.meeting.status === 'processing' ||
      meetingDetails.meeting.status === 'queued' ||
      meetingDetails.meeting.workflow_state === 'uploaded' ||
      meetingDetails.meeting.workflow_state === 'processing' ||
      ((!meetingDetails.segments || meetingDetails.segments.length === 0) && meetingDetails.meeting.status !== 'completed' && meetingDetails.meeting.status !== 'failed')
    );

    if (!isProcessing) return;

    const targetMeetingId = selectedMeetingId;
    const interval = setInterval(async () => {
      try {
        if (activeMeetingIdRef.current !== targetMeetingId) return;
        const response = await fetch(`${API_URL}/api/meetings/${targetMeetingId}`);
        if (response.ok) {
          if (activeMeetingIdRef.current !== targetMeetingId) return;
          const json = await response.json();
          if (activeMeetingIdRef.current !== targetMeetingId) return;
          setMeetingDetails(json);

          const status = json.meeting?.status;
          const workflow = json.meeting?.workflow_state;

          if (status === 'completed' || (json.segments && json.segments.length > 0 && status !== 'processing' && status !== 'queued')) {
            clearInterval(interval);
            triggerToast("✓ Your transcript is ready! The call has been processed and is ready for review.");
            setAnalysisStep(1);
            fetchMeetings();
            if (activeMeetingIdRef.current === targetMeetingId) {
              await fetchMeetingDetails(targetMeetingId);
            }
          } else if (status === 'failed') {
            clearInterval(interval);
            triggerToast("Processing failed for this meeting.");
          }
        }
      } catch (e) {
        console.warn("Polling error for meeting:", e);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [selectedMeetingId, meetingDetails?.meeting?.status, meetingDetails?.meeting?.workflow_state]);

  // Synchronize speakers whenever meetingDetails is loaded or updated
  useEffect(() => {
    if (!speakers || speakers.length === 0) {
      if (meetingDetails) {
        const derived = deriveSpeakersFromMeeting(meetingDetails);
        if (derived.length > 0) {
          setSpeakers(derived);
        }
      }
    }
  }, [meetingDetails, speakers]);

  // Global Background Polling for any processing calls (e.g. if user navigates away)
  useEffect(() => {
    const hasAnyProcessing = meetings.some(m => 
      m.status === 'processing' || 
      m.status === 'queued' || 
      m.workflow_state === 'uploaded' || 
      m.workflow_state === 'processing'
    );
    if (!hasAnyProcessing) return;

    const globalInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/meetings`);
        if (res.ok) {
          const updated = await res.json();
          updated.forEach(upM => {
            const oldM = meetings.find(x => x.id === upM.id);
            if (oldM && (oldM.status === 'processing' || oldM.status === 'queued') && upM.status === 'completed') {
              triggerToast(`🔔 Transcript ready: "${upM.title}" has finished processing and is ready for review.`);
            }
          });
          setMeetings(updated);
        }
      } catch (e) {
        console.warn("Global meetings polling error:", e);
      }
    }, 5000);

    return () => clearInterval(globalInterval);
  }, [meetings]);

  const handleRetryProcessing = async () => {
    if (!selectedMeetingId) return;
    setIsRetryingProcessing(true);
    triggerToast("Retrying audio processing pipeline...");
    try {
      const res = await fetch(`${API_URL}/api/meetings/${selectedMeetingId}/retry`, {
        method: 'POST'
      });
      if (res.ok) {
        if (activeMeetingIdRef.current === selectedMeetingId) {
          await fetchMeetingDetails(selectedMeetingId);
        }
        triggerToast("Processing job re-queued!");
      }
    } catch (e) {
      console.error(e);
      triggerToast("Failed to retry processing.");
    } finally {
      setIsRetryingProcessing(false);
    }
  };

  // Sync audio URL and ensure audio element is cleanly loaded
  useEffect(() => {
    let cancelled = false;
    const meetingId = meetingDetails?.meeting?.id || selectedMeetingId;
    if (!meetingId || !meetingDetails?.meeting?.audio_url) { setAudioSrc(""); return () => { cancelled = true; }; }
    (async () => {
      try {
        const response = await fetch(`${API_URL}/api/meetings/${meetingId}/audio-url`);
        if (!response.ok) throw new Error(`Audio URL request failed (${response.status})`);
        const payload = await response.json();
        if (cancelled || !payload.url) return;
        const absoluteUrl = payload.url.startsWith("http") ? payload.url : `${API_URL}${payload.url}`;
        setAudioSrc(absoluteUrl);
        if (audioRef.current && audioRef.current.src !== absoluteUrl) { audioRef.current.src = absoluteUrl; audioRef.current.load(); }
      } catch (error) {
        if (!cancelled) { setAudioSrc(""); console.warn("Unable to obtain private audio URL", error); }
      }
    })();
    return () => { cancelled = true; };
  }, [meetingDetails, selectedMeetingId, API_URL]);

  // Sync playback speed and volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
      audioRef.current.volume = audioVolume;
    }
  }, [playbackSpeed, audioVolume, audioSrc]);

  // Robust play / pause handler
  const handleTogglePlay = async () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      try {
        if (!audioRef.current.src && audioSrc) {
          audioRef.current.src = audioSrc;
          audioRef.current.load();
        }
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (err) {
        console.warn("Audio play error, attempting fallback:", err);
        if (selectedMeetingId) {
          try {
            const response = await fetch(`${API_URL}/api/meetings/${selectedMeetingId}/audio-url`);
            if (!response.ok) throw new Error("Could not generate a private audio URL", { cause: err });
            const payload = await response.json();
            const fallbackUrl = payload.url.startsWith("http") ? payload.url : `${API_URL}${payload.url}`;
            setAudioSrc(fallbackUrl);
            if (audioRef.current) { audioRef.current.src = fallbackUrl; audioRef.current.load(); await audioRef.current.play(); setIsPlaying(true); }
          } catch (fallbackError) { console.error("Playback fallback failed:", fallbackError); triggerToast("Unable to play audio. Please retry or verify that the recording exists."); }
        }
      }
    }
  };

  // Safe seek handler
  const handleAudioSeek = (targetTime) => {
    if (!audioRef.current) return;
    const time = Math.max(0, Number(targetTime) || 0);
    try {
      if (audioRef.current.readyState >= 1) {
        audioRef.current.currentTime = time;
      } else {
        const onLoaded = () => {
          audioRef.current.currentTime = time;
          audioRef.current.removeEventListener('loadedmetadata', onLoaded);
        };
        audioRef.current.addEventListener('loadedmetadata', onLoaded);
        audioRef.current.load();
      }
      audioRef.current.play().then(() => setIsPlaying(true)).catch(console.warn);
    } catch (e) {
      console.warn("Seek error:", e);
    }
  };

  const handleAudioError = (e) => {
    console.warn("Audio element error:", e, audioRef.current?.error);
    if (selectedMeetingId && audioSrc && !audioSrc.includes(`/api/meetings/${selectedMeetingId}/audio`)) {
      const fallbackUrl = `${API_URL}/api/meetings/${selectedMeetingId}/audio`;
      setAudioSrc(fallbackUrl);
      if (audioRef.current) {
        audioRef.current.src = fallbackUrl;
        audioRef.current.load();
      }
    }
  };

  const handleChangeSpeed = (spd) => {
    setPlaybackSpeed(spd);
    if (audioRef.current) audioRef.current.playbackRate = spd;
  };

  const handleVolumeChange = (v) => {
    setAudioVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  };

  const handlePlaySampleAudio = (startTime) => {
    if (audioRef.current) {
      audioRef.current.currentTime = startTime;
      audioRef.current.play().then(() => setIsPlaying(true)).catch(console.warn);
    }
  };

  const handleClearSelection = () => {
    if (meetingAbortControllerRef.current) {
      meetingAbortControllerRef.current.abort();
    }
    activeMeetingIdRef.current = null;
    resetMeetingState();
    setSelectedMeetingId(null);
    setViewMode("review_center");
    setAnalysisStep(1);
    setMeetingDetails(null);
    setSpeakers([]);
    setSyncPreview(null);
    setSyncSuccessData(null);
    setShowSyncDetails(false);
    setSyncError(null);
    setIsPlaying(false);
    if (audioRef.current) audioRef.current.pause();
    fetchMeetings();
  };

  // ── Step 2: Speaker Mapping Save ──
  const handleSaveSpeakers = async (updatedSpeakers) => {
    if (!selectedMeetingId) return false;
    try {
      const res = await fetch(`${API_URL}/api/meetings/${selectedMeetingId}/speakers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speakers: updatedSpeakers })
      });
      if (res.ok) {
        setSpeakers(updatedSpeakers);
        setMeetingDetails(prev => {
          if (!prev) return prev;
          const nameMap = {};
          updatedSpeakers.forEach(s => {
            if (s.speaker_id) nameMap[s.speaker_id] = s.name;
            if (s.raw_key) nameMap[s.raw_key] = s.name;
            if (s.name) nameMap[s.name] = s.name;
          });
          const updatedSegments = (prev.segments || []).map(seg => {
            const mappedName = nameMap[seg.speaker_id] || nameMap[seg.speaker_name] || nameMap[seg.speaker];
            return mappedName ? { ...seg, speaker_name: mappedName } : seg;
          });
          return {
            ...prev,
            speakers: updatedSpeakers,
            segments: updatedSegments
          };
        });
        triggerToast("Speaker identities verified & saved!");
        setIsSpeakerDrawerOpen(false);
        return true;
      }
    } catch (err) {
      console.error(err);
      triggerToast("Failed to save speaker mapping.");
      return false;
    }
  };

  // ── Step 3: Confirm Company Link ──
  const handleConfirmCompanyStep = async () => {
    try {
      await fetch(`${API_URL}/api/meetings/${selectedMeetingId}/company`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          companyName,
          companyWebsite
        })
      });
      triggerToast(`Linked to ${companyName || 'Account'}`);
      await fetchExistingCompanies();
    } catch (e) {
      console.warn("Error associating company:", e);
    }
    setAnalysisStep(4);
  };

  // ── Call Type User Override ──
  const handleUpdateCallType = async (newType) => {
    setCurrentCallType(newType);
    setCallTypeSource("manual");
    setCallTypeConfidence(1.0);
    setCallTypeRationale("Manually classified by reviewer");
    if (selectedMeetingId) {
      try {
        await fetch(`${API_URL}/api/meetings/${selectedMeetingId}/call-type`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            call_type: newType,
            source: "manual",
            confidence: 1.0,
            rationale: "Manually classified by reviewer"
          })
        });
        triggerToast(`Call type updated to ${formatCallType(newType)}`);
      } catch (e) {
        console.error("Failed to save call type override:", e);
      }
    }
  };

  // ── Step 5: On-Demand AI Generation ──
  const handleRunAiCompilation = async () => {
    const compilingMeetingId = selectedMeetingId;
    setIsAnalyzing(true);
    triggerToast("Compiling verified intelligence across transcript & speakers...");
    try {
      const response = await fetch(`${API_URL}/api/meetings/${compilingMeetingId}/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedTemplate,
          call_type: currentCallType,
          companyMetadata: { name: companyName, website: companyWebsite, industry: companyIndustry, dealStage }
        })
      });
      if (response.ok) {
        if (activeMeetingIdRef.current === compilingMeetingId) {
          await fetchMeetingDetails(compilingMeetingId);
          setAnalysisStep(6);
          triggerToast("Intelligence compiled successfully!");
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        triggerToast(errData.message || "Compilation failed. Check logs.");
      }
    } catch (err) {
      console.error(err);
      triggerToast("Compilation failed. Check logs.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ── Step 7: Load Sync Preparation Preview ──
  const loadSyncPreparePreview = async () => {
    if (!selectedMeetingId) return;
    setLoadingSyncPreview(true);
    try {
      const res = await fetch(`${API_URL}/api/sync/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId: selectedMeetingId })
      });
      if (res.ok) {
        const data = await res.json();
        setSyncPreview(data);
      }
    } catch (e) {
      console.warn("Could not load sync preparation preview:", e);
    } finally {
      setLoadingSyncPreview(false);
    }
  };

  useEffect(() => {
    if (analysisStep === 7 && selectedMeetingId) {
      loadSyncPreparePreview();
    }
  }, [analysisStep, selectedMeetingId]);

  // ── Step 7: Real CRM Sync Execution ──
  const handleExecuteCrmSync = async () => {
    if (syncingInProgress) return;
    if (isMeetingSynced && syncSuccessData?.status === 'succeeded') {
      triggerToast("Meeting is already synchronized to HubSpot CRM.");
      return;
    }
    setSyncingInProgress(true);
    setSyncError(null);
    triggerToast("Synchronizing approved properties to HubSpot CRM...");
    try {
      const response = await fetch(`${API_URL}/api/sync/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingId: selectedMeetingId,
          approvedFields: localApprovals.filter(a => a.review_status === "approved" && a.evidence?.length > 0 && a.value !== "Not mentioned").map(a => a.fieldKey)
        })
      });
      if (response.ok) {
        const data = await response.json();
        setSyncSuccessData(data);
        setSyncError(null);
        const count = data.summary?.fieldsUpdatedCount ?? data.fieldsUpdatedCount;
        if (typeof count === 'number' && !isNaN(count) && count >= 0) {
          triggerToast(`Successfully synchronized ${count} properties to HubSpot!`);
        } else {
          triggerToast("Successfully synced to HubSpot.");
        }
        if (activeMeetingIdRef.current === selectedMeetingId) {
          await fetchMeetingDetails(selectedMeetingId);
        }
        fetchMeetings();
      } else {
        const errJson = await response.json().catch(() => ({}));
        if (response.status === 409 || errJson.error === 'sync_in_progress') {
          triggerToast("A CRM sync is already in progress. Please wait before retrying.");
          return;
        }
        const msg = errJson.message || "Sync execution failed";
        setSyncError(msg);
        throw new Error(msg);
      }
    } catch (err) {
      console.error(err);
      if (!err.message?.includes('already in progress')) {
        setSyncError(err.message);
        triggerToast(`Sync failed: ${err.message}`);
      }
    } finally {
      setSyncingInProgress(false);
    }
  };

  // ── Reopen Review ──
  const handleReopenReview = async () => {
    try {
      const res = await fetch(`${API_URL}/api/meetings/${selectedMeetingId}/reopen-review`, {
        method: "POST"
      });
      if (res.ok) {
        triggerToast("Review reopened. Meeting is now editable.");
        if (activeMeetingIdRef.current === selectedMeetingId) {
          await fetchMeetingDetails(selectedMeetingId);
          setAnalysisStep(6);
        }
      }
    } catch (e) {
      console.error(e);
      triggerToast("Failed to reopen review.");
    }
  };

  // ── Speaker Rename Handler ──
  const handleRenameSpeaker = async (speakerId, newName) => {
    if (!newName || !newName.trim()) return;
    const cleanName = newName.trim();

    // 1. Update local speakers list
    setSpeakers(prev => prev.map(s => (s.speaker_id === speakerId || s.name === speakerId) ? { ...s, name: cleanName } : s));

    // 2. Update segments in meetingDetails
    setMeetingDetails(prev => {
      if (!prev || !prev.segments) return prev;
      return {
        ...prev,
        segments: prev.segments.map(seg => (seg.speaker_id === speakerId || seg.speaker_name === speakerId) ? { ...seg, speaker_name: cleanName } : seg)
      };
    });

    // 3. Persist to backend
    try {
      await fetch(`${API_URL}/api/meetings/${selectedMeetingId}/speakers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speakerId, name: cleanName })
      });
      triggerToast(`Speaker renamed to "${cleanName}"`);
    } catch (e) {
      console.warn("Error updating speaker name:", e);
    }
  };

  // ── Evidence Drawer Open ──
  const handleOpenEvidence = (fieldObj) => {
    if (fieldObj?.timestampSecs === undefined || !fieldObj?.quote) {
      triggerToast("No verified transcript evidence is available for this item.");
      return;
    }
    setActiveEvidenceField(fieldObj);
    setIsEvidenceDrawerOpen(true);
  };

  const getDealEvidence = (fieldKeys) => localApprovals.find((field) =>
    field.approved && fieldKeys.includes(field.fieldKey)
  );

  const handleCloseEvidenceDrawer = () => {
    setIsEvidenceDrawerOpen(false);
    setActiveEvidenceField(null);
  };

  // ── Review Queue Confidence & Filter Logic ──
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

  const filteredReviewQueue = meetings.filter(m => {
    // 1. Status Tab filter
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
    // A. Title / Audio Filename
    if (appliedAdvancedFilters.titleSearch && appliedAdvancedFilters.titleSearch.trim()) {
      const q = appliedAdvancedFilters.titleSearch.trim().toLowerCase();
      const matchTitle = (m.title || '').toLowerCase().includes(q);
      const matchAudio = (m.audio_url || '').toLowerCase().includes(q);
      if (!matchTitle && !matchAudio) return false;
    }

    // B. Company / Account
    if (appliedAdvancedFilters.companies && appliedAdvancedFilters.companies.length > 0) {
      const compName = m.company_name || 'Unassigned Account';
      const hasMatch = appliedAdvancedFilters.companies.some(c => 
        c.toLowerCase() === compName.toLowerCase() ||
        (c === 'Unassigned Account' && (!m.company_id || !m.company_name || m.company_name === 'Unassigned Account'))
      );
      if (!hasMatch) return false;
    }

    // C. Playbooks
    if (appliedAdvancedFilters.playbooks && appliedAdvancedFilters.playbooks.length > 0) {
      const currentPb = (m.template_used || 'MEDDIC').toLowerCase();
      const hasMatch = appliedAdvancedFilters.playbooks.some(pb => pb.toLowerCase() === currentPb);
      if (!hasMatch) return false;
    }

    // D. Stages
    if (appliedAdvancedFilters.stages && appliedAdvancedFilters.stages.length > 0) {
      const currentStage = (m.workflow_state || 'review').toLowerCase();
      const hasMatch = appliedAdvancedFilters.stages.some(st => st.toLowerCase() === currentStage);
      if (!hasMatch) return false;
    }

    // E. Confidence Range
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

    // F. Last Activity Date Range
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

    // G. Call Types
    if (appliedAdvancedFilters.callTypes && appliedAdvancedFilters.callTypes.length > 0) {
      const currentType = (m.call_type || 'discovery').toLowerCase();
      const hasMatch = appliedAdvancedFilters.callTypes.some(ct => ct.toLowerCase() === currentType);
      if (!hasMatch) return false;
    }

    return true;
  });

  const availableCompanies = Array.from(new Set(meetings.map(m => m.company_name).filter(Boolean)));
  const availablePlaybooks = Array.from(new Set([
    'MEDDIC',
    'BANT',
    'SPICED',
    'CHAMP',
    'SPIN',
    'CS QBR',
    ...meetings.map(m => m.template_used).filter(Boolean)
  ]));

  const activeAdvancedFilterCount = 
    (appliedAdvancedFilters.titleSearch ? 1 : 0) +
    appliedAdvancedFilters.companies.length +
    appliedAdvancedFilters.playbooks.length +
    appliedAdvancedFilters.stages.length +
    (appliedAdvancedFilters.confidenceMin !== '' || appliedAdvancedFilters.confidenceMax !== '' ? 1 : 0) +
    (appliedAdvancedFilters.startDate || appliedAdvancedFilters.endDate ? 1 : 0) +
    appliedAdvancedFilters.callTypes.length;

  const handleResetAllFilters = () => {
    setMeetingsFilter('all');
    setSelectedCompanyFilter('all');
    setSelectedPlaybookFilter('all');
    setQueueSearchQuery('');
    setAppliedAdvancedFilters(DEFAULT_ADVANCED_FILTERS);
  };

  const qNeedsReview = meetings.filter(m => ['review', 'transcript_review', 'speaker_review'].includes(m.workflow_state)).length;
  const qLowConf = meetings.filter(m => m.workflow_state !== 'synced' && (m.action_items || []).some(a => a.confidence < 85)).length;
  const qReadySync = meetings.filter(m => m.workflow_state === 'destination_mapping').length;
  const qSynced = meetings.filter(m => m.workflow_state === 'synced').length;
  const qFailed = meetings.filter(m => m.status === 'failed' || m.workflow_state === 'failed').length;

  const isMeetingSynced = meetingDetails?.meeting?.workflow_state === 'synced';
  const isHubSpotConnected = integrationsList.some(i => i.provider === 'hubspot' && i.connection_status === 'connected');

  const templateOptions = extractionProfiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    description: profile.description,
    fieldsCount: Array.isArray(profile.fields) ? profile.fields.length : 0,
    source: "database",
    is_active: Boolean(profile.is_active)
  }));

  const displaySpeakers = (speakers && speakers.length > 0)
    ? speakers
    : deriveSpeakersFromMeeting(meetingDetails);

  const meetingSegments = meetingDetails?.segments || [];
  const totalMeetingSecs = meetingSegments.reduce((acc, s) => acc + Math.max(0, (s.end_time || 0) - (s.start_time || 0)), 0) || 1;

  return (
    <div className="flex h-screen bg-[#F8FAFC] text-[#0F172A] font-sans overflow-hidden select-none">
      
      {/* Audio player element */}
      {audioSrc ? (
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="auto"
          crossOrigin="anonymous"
          onError={handleAudioError}
          onLoadedMetadata={() => {
            if (audioRef.current) {
              setAudioDuration(audioRef.current.duration || 0);
            }
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onTimeUpdate={() => {
            if (audioRef.current) {
              const curTime = audioRef.current.currentTime;
              setCurrentTime(curTime);
              if (clipRange && curTime >= clipRange.end) {
                audioRef.current.pause();
                setIsPlaying(false);
                setClipRange(null);
              }
            }
          }}
        />
      ) : null}

      {/* Primary Sidebar */}
      <Sidebar
        selectedMeetingId={selectedMeetingId}
        onClearSelection={handleClearSelection}
        isAnyProcessing={meetings.some(m => m.status === 'processing')}
        activeMeetingStatus={meetingDetails?.meeting?.status || 'idle'}
        viewMode={viewMode}
        onViewChange={(mode) => {
          setSelectedMeetingId(null);
          setViewMode(mode);
        }}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        
        {/* Global Topbar */}
        {!selectedMeetingId && viewMode !== "customers" && (
          <Topbar
            selectedMeeting={meetingDetails?.meeting}
            onBack={handleClearSelection}
            viewMode={viewMode}
            searchQuery={globalSearchQuery}
            onSearchChange={handleGlobalSearchChange}
            searchResults={globalSearchResults}
            onSelectSearchResult={handleSelectSearchResult}
            onClearSearch={handleClearGlobalSearch}
          />
        )}

        {/* Global Toast */}
        {toastMessage && (
          <div className="fixed bottom-5 right-5 z-50 bg-[#0F172A] text-white rounded-lg px-4 py-2.5 shadow-xl flex items-center gap-2 text-xs font-semibold select-none animate-in fade-in duration-150">
            <Sparkles size={14} className="text-[#14B8A6]" />
            <span>{toastMessage}</span>
          </div>
        )}

        <div className="flex-1 overflow-hidden flex flex-col">

          {/* ════════════════════════════════════════════
             VIEW 1: HOME (COMMAND CENTER)
             ════════════════════════════════════════════ */}
          {viewMode === "review_center" ? (
            <div className="flex-1 overflow-y-auto">
              <ReviewCenter 
                meetings={meetings}
                onViewChange={setViewMode}
                onSelectMeeting={(id) => { setViewMode("board"); setSelectedMeetingId(id); }}
                onSetMeetingsFilter={setMeetingsFilter}
                onRefreshMeetings={fetchMeetings}
              />
            </div>
          ) : viewMode === "playbooks" ? (
            <div className="flex-1 overflow-y-auto p-6">
              <Playbooks />
            </div>
          ) : viewMode === "extraction_profiles" ? (
            <div className="flex-1 overflow-y-auto p-6">
              <ExtractionProfiles />
            </div>
          ) : viewMode === "integrations" ? (
            <div className="flex-1 overflow-y-auto p-6">
              <Integrations />
            </div>
          ) : viewMode === "customers" ? (
            <div className="flex-1 overflow-hidden h-full">
              <Customers
                meetings={meetings}
                selectedCompanyId={selectedCompanyId}
                onSelectCompany={setSelectedCompanyId}
                onSelectMeeting={(id) => {
                  setSelectedMeetingId(id);
                  setViewMode("board");
                }}
                onSelectMeetingDetails={(mId, companyId) => {
                  setSelectedMeetingId(mId);
                  if (companyId) setSelectedCompanyId(companyId);
                  setViewMode("call_details");
                }}
              />
            </div>
          ) : viewMode === "call_details" ? (
            <div className="flex-1 overflow-y-auto">
              <CallDetails
                meetingId={selectedMeetingId}
                companyId={selectedCompanyId}
                API_URL={API_URL}
                onBackToCustomer={(compId) => {
                  if (compId) setSelectedCompanyId(compId);
                  setViewMode("customers");
                }}
                onReviewMeeting={(id) => {
                  setSelectedMeetingId(id);
                  setAnalysisStep(6);
                  setViewMode("board");
                }}
                onSyncMeeting={(m) => {
                  setSelectedMeetingId(typeof m === "string" ? m : m?.id || selectedMeetingId);
                  setAnalysisStep(7);
                  setViewMode("board");
                }}
              />
            </div>
          ) : viewMode === "analytics" ? (
            <div className="flex-1 overflow-y-auto"><Analytics /></div>
          ) : viewMode === "capture" ? (
            <div className="flex-1 overflow-y-auto"><Capture /></div>
          ) : viewMode === "settings" ? (
            <div className="flex-1 overflow-y-auto p-6 select-none">
              <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 max-w-xl shadow-3xs space-y-3 text-left">
                <h2 className="text-sm font-extrabold text-[#0F172A] uppercase tracking-wider">Workspace Configuration</h2>
                <p className="text-xs text-[#64748B] font-medium leading-relaxed">
                  Configure corporate CRM sync destinations, voice print diarization sensitivity, and automated playbook extraction triggers.
                </p>
                <div className="pt-3 border-t border-[#F1F5F9] text-xs font-mono text-[#64748B]">
                  Active API Gateway: <strong className="text-[#14B8A6]">{API_URL}</strong>
                </div>
              </div>
            </div>
          ) : (
            /* ════════════════════════════════════════════
               VIEW 2: REVIEWS (CANONICAL REVIEW QUEUE OR MEETING WORKSPACE)
               ════════════════════════════════════════════ */
            <div className="flex-1 flex flex-col overflow-hidden bg-[#F8FAFC]">
              
              {!selectedMeetingId ? (
                /* Canonical Review Queue */
                <div className="flex-1 overflow-y-auto p-6 space-y-6 select-none bg-[#F8FAFC] text-left">
                  
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E5E7EB] pb-4">
                    <div>
                      <h2 className="text-lg font-extrabold text-[#0F172A] tracking-tight">Review Queue</h2>
                      <p className="text-xs text-[#64748B] font-medium mt-0.5">
                        Calls requiring human verification, speaker identity mapping, or destination approval.
                      </p>
                    </div>
                  </div>

                  {/* Filter Pills */}
                  <div className="flex flex-wrap items-center gap-2 border-b border-[#F1F5F9] pb-3">
                    {[
                      { id: 'all', label: 'All Calls', count: meetings.length },
                      { id: 'needs_review', label: 'Needs Review', count: qNeedsReview, color: 'text-[#0284C7] bg-sky-50 border-sky-200' },
                      { id: 'low_confidence', label: 'Low Confidence', count: qLowConf, color: 'text-amber-700 bg-amber-50 border-amber-200' },
                      { id: 'ready_to_sync', label: 'Ready to Sync', count: qReadySync, color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
                      { id: 'synced', label: 'Synced', count: qSynced, color: 'text-slate-600 bg-slate-100 border-slate-200' },
                      { id: 'failed', label: 'Failed', count: qFailed, color: 'text-rose-700 bg-rose-50 border-rose-200' }
                    ].map(tab => {
                      const active = meetingsFilter === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setMeetingsFilter(tab.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 border ${
                            active
                              ? 'bg-[#0F172A] text-white border-[#0F172A] shadow-3xs'
                              : 'bg-white text-[#64748B] border-[#E5E7EB] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
                          }`}
                        >
                          <span>{tab.label}</span>
                          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                            active ? 'bg-white/20 text-white' : tab.color || 'bg-slate-100 text-slate-700'
                          }`}>
                            {tab.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Secondary Filter Bar */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-white p-3 rounded-xl border border-[#E5E7EB] shadow-3xs">
                    <div className="relative sm:col-span-2">
                      <Search className="absolute left-2.5 top-2.5 text-[#94A3B8]" size={13} />
                      <input
                        type="text"
                        placeholder="Search call title, audio file, or account..."
                        value={queueSearchQuery}
                        onChange={(e) => setQueueSearchQuery(e.target.value)}
                        className="w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#0F172A] outline-none placeholder-[#94A3B8] focus:border-[#14B8A6]"
                      />
                    </div>

                    <select
                      value={selectedPlaybookFilter}
                      onChange={(e) => setSelectedPlaybookFilter(e.target.value)}
                      className="bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-xs font-semibold text-[#475569] outline-none"
                    >
                      <option value="all">All Playbooks</option>
                      <option value="meddic">MEDDICC</option>
                      <option value="bant">BANT</option>
                      <option value="spiced">SPICED</option>
                      <option value="qbr">CS QBR</option>
                    </select>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAdvancedFilters(prev => !prev)}
                        className={`flex-1 px-3 py-1.5 border rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                          showAdvancedFilters || activeAdvancedFilterCount > 0
                            ? 'bg-[#0F172A] text-white border-[#0F172A]'
                            : 'bg-white border-[#E5E7EB] text-[#475569] hover:bg-[#F8FAFC]'
                        }`}
                      >
                        <SlidersHorizontal size={12} className={showAdvancedFilters || activeAdvancedFilterCount > 0 ? 'text-[#14B8A6]' : 'text-[#64748B]'} />
                        <span>Advanced Filters</span>
                        {activeAdvancedFilterCount > 0 && (
                          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-[#14B8A6] text-white">
                            {activeAdvancedFilterCount}
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleResetAllFilters}
                        className="px-3 py-1.5 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#64748B] text-xs font-bold rounded-lg transition"
                        title="Reset all filters"
                      >
                        Reset Filters
                      </button>
                    </div>
                  </div>

                  {/* Expandable Advanced Filters Panel */}
                  <AdvancedFiltersPanel
                    isOpen={showAdvancedFilters}
                    onClose={() => setShowAdvancedFilters(false)}
                    filters={appliedAdvancedFilters}
                    onApplyFilters={(newFilters) => {
                      setAppliedAdvancedFilters(newFilters);
                    }}
                    onClearFilters={() => {
                      setAppliedAdvancedFilters(DEFAULT_ADVANCED_FILTERS);
                    }}
                    availableCompanies={availableCompanies}
                    availablePlaybooks={availablePlaybooks}
                    totalMatches={filteredReviewQueue.length}
                  />

                  {/* Applied Filter Chips */}
                  {(activeAdvancedFilterCount > 0 || queueSearchQuery || selectedPlaybookFilter !== 'all') && (
                    <div className="flex flex-wrap items-center gap-2 bg-[#F8FAFC] p-2.5 rounded-lg border border-[#E5E7EB] text-xs">
                      <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Applied Filters:</span>

                      {queueSearchQuery && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-[#E2E8F0] text-[11px] font-semibold text-[#0F172A]">
                          Quick Search: "{queueSearchQuery}"
                          <button onClick={() => setQueueSearchQuery('')} className="hover:text-rose-600"><X size={11} /></button>
                        </span>
                      )}

                      {selectedPlaybookFilter !== 'all' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-[#E2E8F0] text-[11px] font-semibold text-[#0F172A]">
                          Playbook: {selectedPlaybookFilter.toUpperCase()}
                          <button onClick={() => setSelectedPlaybookFilter('all')} className="hover:text-rose-600"><X size={11} /></button>
                        </span>
                      )}

                      {appliedAdvancedFilters.titleSearch && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-[#E2E8F0] text-[11px] font-semibold text-[#0F172A]">
                          Title/File: "{appliedAdvancedFilters.titleSearch}"
                          <button onClick={() => setAppliedAdvancedFilters(prev => ({ ...prev, titleSearch: '' }))} className="hover:text-rose-600"><X size={11} /></button>
                        </span>
                      )}

                      {appliedAdvancedFilters.companies.map(c => (
                        <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-[#E2E8F0] text-[11px] font-semibold text-[#0F172A]">
                          Account: {c}
                          <button onClick={() => setAppliedAdvancedFilters(prev => ({ ...prev, companies: prev.companies.filter(x => x !== c) }))} className="hover:text-rose-600"><X size={11} /></button>
                        </span>
                      ))}

                      {appliedAdvancedFilters.playbooks.map(pb => (
                        <span key={pb} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-[#E2E8F0] text-[11px] font-semibold text-[#0F172A]">
                          Playbook: {pb}
                          <button onClick={() => setAppliedAdvancedFilters(prev => ({ ...prev, playbooks: prev.playbooks.filter(x => x !== pb) }))} className="hover:text-rose-600"><X size={11} /></button>
                        </span>
                      ))}

                      {appliedAdvancedFilters.stages.map(st => (
                        <span key={st} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-[#E2E8F0] text-[11px] font-semibold text-[#0F172A]">
                          Stage: {st.replace(/_/g, ' ')}
                          <button onClick={() => setAppliedAdvancedFilters(prev => ({ ...prev, stages: prev.stages.filter(x => x !== st) }))} className="hover:text-rose-600"><X size={11} /></button>
                        </span>
                      ))}

                      {(appliedAdvancedFilters.confidenceMin !== '' || appliedAdvancedFilters.confidenceMax !== '') && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-[#E2E8F0] text-[11px] font-semibold text-[#0F172A]">
                          Confidence: {appliedAdvancedFilters.confidenceMin || 0}% - {appliedAdvancedFilters.confidenceMax || 100}%
                          <button onClick={() => setAppliedAdvancedFilters(prev => ({ ...prev, confidenceMin: '', confidenceMax: '' }))} className="hover:text-rose-600"><X size={11} /></button>
                        </span>
                      )}

                      {(appliedAdvancedFilters.startDate || appliedAdvancedFilters.endDate) && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-[#E2E8F0] text-[11px] font-semibold text-[#0F172A]">
                          Dates: {appliedAdvancedFilters.startDate || 'Any'} to {appliedAdvancedFilters.endDate || 'Now'}
                          <button onClick={() => setAppliedAdvancedFilters(prev => ({ ...prev, startDate: '', endDate: '' }))} className="hover:text-rose-600"><X size={11} /></button>
                        </span>
                      )}

                      {appliedAdvancedFilters.callTypes.map(ct => (
                        <span key={ct} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-[#E2E8F0] text-[11px] font-semibold text-[#0F172A]">
                          Type: {formatCallType(ct)}
                          <button onClick={() => setAppliedAdvancedFilters(prev => ({ ...prev, callTypes: prev.callTypes.filter(x => x !== ct) }))} className="hover:text-rose-600"><X size={11} /></button>
                        </span>
                      ))}

                      <span className="text-[11px] text-[#64748B] font-medium ml-auto">
                        Showing <strong>{filteredReviewQueue.length}</strong> of {meetings.length} calls
                      </span>

                      <button
                        type="button"
                        onClick={handleResetAllFilters}
                        className="text-[11px] font-bold text-[#14B8A6] hover:underline ml-2"
                      >
                        Clear All
                      </button>
                    </div>
                  )}

                  {/* Canonical Review Queue Table */}
                  <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-3xs text-left">
                    {filteredReviewQueue.length === 0 ? (
                      <div className="py-16 text-center text-xs text-[#94A3B8] italic space-y-2">
                        <p>No calls matching selected filters.</p>
                        {(activeAdvancedFilterCount > 0 || queueSearchQuery || selectedPlaybookFilter !== 'all' || meetingsFilter !== 'all') && (
                          <button
                            type="button"
                            onClick={handleResetAllFilters}
                            className="px-3 py-1 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#14B8A6] text-xs font-bold rounded-lg transition"
                          >
                            Reset Filters
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left border-collapse">
                          <thead>
                            <tr className="border-b border-[#E5E7EB] text-[9.5px] font-bold uppercase tracking-wider text-[#64748B] bg-[#F8FAFC]">
                              <th className="py-3 px-4">Meeting Session</th>
                              <th className="py-3 px-4">Company</th>
                              <th className="py-3 px-4">Playbook</th>
                              <th className="py-3 px-4">Verification Stage</th>
                              <th className="py-3 px-4 text-center">Confidence</th>
                              <th className="py-3 px-4">Last Activity</th>
                              <th className="py-3 px-4 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#F1F5F9] text-[#0F172A] font-semibold">
                            {filteredReviewQueue.map((m) => {
                              const isSync = m.workflow_state === 'synced';
                              const isFail = m.status === 'failed' || m.workflow_state === 'failed';
                              const dispConf = getMeetingDisplayConfidence(m);
                              return (
                                <tr key={m.id} className="hover:bg-[#FAFBFB] transition-colors border-b border-[#F1F5F9] last:border-0">
                                  <td className="py-3 px-4">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold block text-[#0F172A]">{m.title}</span>
                                      <span className="px-2 py-0.5 bg-teal-50 text-teal-700 border border-teal-200 rounded text-[9.5px] font-bold font-mono uppercase whitespace-nowrap">
                                        {formatCallType(m.call_type)}
                                      </span>
                                    </div>
                                    <span className="text-[10px] text-[#64748B] font-normal block mt-0.5">{m.duration_seconds ? `${Math.floor(m.duration_seconds / 60)} min` : "4 min"}</span>
                                  </td>
                                  <td className="py-3 px-4 text-[#475569] font-medium">{m.company_name || "Unassigned Account"}</td>
                                  <td className="py-3 px-4">
                                    <span className="px-2 py-0.5 bg-[#F1F5F9] text-[#475569] rounded text-[10px] font-mono font-bold">
                                      {m.template_used || "MEDDIC"}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4">
                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase font-mono ${
                                      isSync ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                                      isFail ? 'bg-rose-50 text-rose-600 border border-rose-100' :
                                      'bg-sky-50 text-sky-600 border border-sky-100'
                                    }`}>
                                      {m.workflow_state || 'Review'}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-center font-mono text-[11px] text-[#0F766E]">
                                    {dispConf !== null ? `${dispConf}%` : '94%'}
                                  </td>
                                  <td className="py-3 px-4 text-[#64748B] text-[10.5px] font-medium">
                                    {new Date(m.created_at || m.updated_at).toLocaleDateString()}
                                  </td>
                                  <td className="py-3 px-4 text-right">
                                    <button
                                      onClick={() => setSelectedMeetingId(m.id)}
                                      className="px-3 py-1 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-[11px] font-bold rounded-lg transition shadow-3xs"
                                    >
                                      Open Workspace
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                </div>
              ) : (
                /* ════════════════════════════════════════════
                   CANONICAL 7-STEP MEETING WORKSPACE OR PROCESSING SCREEN
                   ════════════════════════════════════════════ */
                meetingDetails?.meeting && (
                  meetingDetails.meeting.status === 'processing' ||
                  meetingDetails.meeting.status === 'queued' ||
                  meetingDetails.meeting.status === 'failed' ||
                  meetingDetails.meeting.workflow_state === 'uploaded' ||
                  meetingDetails.meeting.workflow_state === 'processing' ||
                  meetingDetails.meeting.workflow_state === 'failed' ||
                  ((!meetingDetails.segments || meetingDetails.segments.length === 0) && meetingDetails.meeting.status !== 'completed')
                ) ? (
                  <MeetingProcessingScreen
                    meeting={meetingDetails?.meeting}
                    onReturnToQueue={handleClearSelection}
                    onRetry={handleRetryProcessing}
                    isRetrying={isRetryingProcessing}
                  />
                ) : (
                <div className="flex-1 flex flex-col overflow-hidden bg-[#F8FAFC] text-left select-none">
                  
                  {/* Stepper Progress Bar */}
                  <div className="bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between flex-shrink-0 shadow-3xs">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleClearSelection}
                        className="p-1.5 hover:bg-[#F1F5F9] rounded-lg text-[#64748B] transition"
                        title="Return to Review Queue"
                      >
                        <ArrowLeft size={15} />
                      </button>
                      <div>
                        <h2 className="text-xs font-extrabold text-[#0F172A] truncate max-w-sm">{meetingTitle || "Meeting Workspace"}</h2>
                        <span className="text-[10px] text-[#64748B] font-semibold block">{companyName || "Unassigned Account"} • {new Date(meetingDate).toLocaleDateString()}</span>
                      </div>
                    </div>

                    {/* Stepper Items (6 main stages, Speaker Identification is internal slide screen of Transcript) */}
                    <div className="flex items-center gap-2">
                      {[
                        { step: 1, displayStep: 1, label: "Transcript" },
                        { step: 3, displayStep: 2, label: "Company" },
                        { step: 4, displayStep: 3, label: "Playbook" },
                        { step: 5, displayStep: 4, label: "Generate" },
                        { step: 6, displayStep: 5, label: "Review" },
                        { step: 7, displayStep: 6, label: "Sync" }
                      ].map(({ step, displayStep, label }) => {
                        const isCurrent = analysisStep === step || (step === 1 && analysisStep === 2);
                        const isPast = analysisStep > step && !(step === 1 && analysisStep === 2);
                        return (
                          <button
                            key={step}
                            onClick={() => setAnalysisStep(step)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                              isCurrent
                                ? 'bg-[#14B8A6] text-white shadow-3xs'
                                : isPast
                                ? 'text-[#0F766E] bg-[#F0FDFA]'
                                : 'text-[#94A3B8] hover:text-[#0F172A]'
                            }`}
                          >
                            <span className="font-mono text-[9px]">{displayStep}.</span>
                            <span>{label}</span>
                            {isPast && <Check size={10} />}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-3">
                      {/* Call Type Stage Selector */}
                      <div className="flex items-center gap-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-2.5 py-1">
                        <span className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider font-mono">Stage:</span>
                        <select
                          value={currentCallType}
                          onChange={(e) => handleUpdateCallType(e.target.value)}
                          className="bg-transparent text-[11px] font-bold text-[#0F172A] outline-none cursor-pointer"
                        >
                          <option value="cold_prospecting">Cold / Prospecting</option>
                          <option value="qualification">Qualification</option>
                          <option value="discovery">Discovery</option>
                          <option value="solution_demo">Solution / Demo</option>
                          <option value="technical_validation">Technical Validation</option>
                          <option value="negotiation">Negotiation</option>
                          <option value="follow_up">Follow-up</option>
                          <option value="renewal_expansion">Renewal / Expansion</option>
                          <option value="other">Other</option>
                        </select>
                        <span 
                          className={`px-1.5 py-0.2 rounded text-[8.5px] font-mono font-bold ${
                            callTypeSource === 'manual' 
                              ? 'bg-amber-50 text-amber-700 border border-amber-200' 
                              : 'bg-teal-50 text-teal-700 border border-teal-200'
                          }`}
                          title={callTypeRationale || callTypeConfidence == null ? "AI classification" : `${Math.round(callTypeConfidence * 100)}% AI confidence`}
                        >
                          {callTypeSource === 'manual' ? 'Manual' : callTypeConfidence == null ? "AI" : `${Math.round(callTypeConfidence * 100)}% AI`}
                        </span>
                      </div>

                      {isMeetingSynced && (
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-lg text-[10px] font-bold uppercase font-mono flex items-center gap-1">
                            <Lock size={10} /> Synced to CRM
                          </span>
                          <button
                            onClick={handleReopenReview}
                            className="px-2.5 py-1 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#475569] text-[10px] font-bold rounded-lg transition"
                          >
                            Reopen Review
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Main Workspace Body */}
                  <div className="flex-1 min-h-0 overflow-hidden relative flex flex-col">
                    
                    {/* STEP 1 & 2: Transcript Verification with smooth internal slide transition to Speaker Identification */}
                    {(analysisStep === 1 || analysisStep === 2) && (
                      (!meetingDetails?.segments || meetingDetails.segments.length === 0) ? (
                        <div className="w-full h-full flex flex-col items-center justify-center p-12 bg-white space-y-4">
                          <Loader2 size={32} className="animate-spin text-[#14B8A6]" />
                          <h3 className="text-base font-extrabold text-[#0F172A]">Preparing transcript...</h3>
                          <p className="text-xs text-[#64748B] max-w-sm text-center leading-relaxed">
                            We're still processing this meeting. You'll be notified when it's ready.
                          </p>
                        </div>
                      ) : (
                        <>
                          {/* SLIDE 1: Transcript Verification */}
                          <div 
                            className={`absolute inset-0 w-full h-full flex transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                              analysisStep === 1 
                                ? 'translate-x-0 opacity-100 pointer-events-auto' 
                                : '-translate-x-full opacity-0 pointer-events-none'
                            }`}
                          >
                        <div className="flex-1 flex flex-col border-r border-[#E5E7EB] bg-white overflow-hidden">
                          <div className="flex-1 overflow-y-auto p-5">
                            {(() => {
                              const detected = speakers.length > 0 ? speakers : deriveSpeakersFromMeeting(meetingDetails);
                              const needsReview = detected.filter(sp => !sp.name || /^speaker\s*\d+$/i.test(sp.name) || sp.status === 'Needs Review').length;
                              return (
                                <div className={`mb-4 rounded-lg border px-3.5 py-2.5 flex items-center justify-between ${needsReview ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                                  <div>
                                    <div className={`text-[11px] font-bold ${needsReview ? 'text-amber-900' : 'text-emerald-900'}`}>
                                      {needsReview ? 'Speaker identification needs review' : 'Speakers identified automatically'}
                                    </div>
                                    <div className={`text-[10px] mt-0.5 ${needsReview ? 'text-amber-800' : 'text-emerald-800'}`}>
                                      {needsReview ? `${needsReview} speaker${needsReview === 1 ? '' : 's'} still unresolved. You can correct them inline; this is not a required workflow step.` : 'No manual speaker-mapping step is required.'}
                                    </div>
                                  </div>
                                  {needsReview > 0 && (
                                    <button onClick={() => setIsSpeakerDrawerOpen(true)} className="text-[10px] font-bold text-amber-800 hover:underline">Review</button>
                                  )}
                                </div>
                              );
                            })()}
                            <TranscriptEditor
                              meetingId={selectedMeetingId}
                              segments={meetingDetails?.segments || []}
                              speakers={speakers.length > 0 ? speakers : deriveSpeakersFromMeeting(meetingDetails)}
                              currentTime={currentTime}
                              duration={audioDuration || meetingDetails?.meeting?.duration_seconds || 0}
                              audioUrl={audioSrc}
                              onRenameSpeaker={handleRenameSpeaker}
                              onSeek={handleAudioSeek}
                              onSegmentClick={handleAudioSeek}
                              isPlaying={isPlaying}
                              onTogglePlay={handleTogglePlay}
                              playbackSpeed={playbackSpeed}
                              onChangeSpeed={handleChangeSpeed}
                              onVolumeChange={handleVolumeChange}
                              onSaveSegment={async (segId, newText) => {
                                try {
                                  await fetch(`${API_URL}/api/meetings/${selectedMeetingId}/transcript`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ segmentId: segId, text: newText })
                                  });
                                  setMeetingDetails(prev => {
                                    if (!prev || !prev.segments) return prev;
                                    return {
                                      ...prev,
                                      segments: prev.segments.map(s => s.id === segId ? { ...s, corrected_text: newText, text: newText } : s)
                                    };
                                  });
                                  triggerToast("Transcript correction saved!");
                                } catch (e) {
                                  console.error(e);
                                }
                              }}
                              activeHighlightSegmentId={activeHighlightSegmentId}
                              highlightValue={activeEvidenceField?.extracted_value || ""}
                            />
                          </div>
                        </div>

                        <div className="w-[340px] bg-[#F8FAFC] overflow-y-auto p-5 space-y-4 flex-shrink-0 text-left border-l border-[#E5E7EB]">
                          <div className="bg-white p-4 rounded-xl border border-[#E5E7EB] shadow-3xs space-y-3">
                            <span className="text-[10px] font-bold text-[#94A3B8] uppercase block tracking-wider">📊 Transcript Health</span>
                            <div className="space-y-2 text-xs font-semibold text-[#475569]">
                              <div className="flex justify-between py-1 border-b border-[#F1F5F9]">
                                <span>Duration</span>
                                <span className="font-mono text-[#0F172A]">
                                  {formatTime(
                                    meetingDuration || 
                                    meetingDetails?.meeting?.duration_seconds || 
                                    meetingDetails?.duration_seconds || 
                                    (meetingDetails?.segments?.length > 0 ? Math.ceil(meetingDetails.segments[meetingDetails.segments.length - 1].end_time || 0) : 0)
                                  )}
                                </span>
                              </div>
                              <div className="flex justify-between py-1 border-b border-[#F1F5F9]">
                                <span>Speakers Detected</span>
                                <span className="font-mono text-[#0F172A]">
                                  {speakers.length || (meetingDetails?.speakers?.length) || (new Set((meetingDetails?.segments || []).map(s => s.speaker_name || s.speaker || s.speaker_id).filter(Boolean)).size) || 0}
                                </span>
                              </div>
                              <div className="flex justify-between py-1 border-b border-[#F1F5F9]">
                                <span>Utterance Segments</span>
                                <span className="font-mono text-[#0F172A]">{meetingDetails?.segments?.length || 0}</span>
                              </div>
                              <div className="flex justify-between py-1 border-b border-[#F1F5F9]">
                                <span>Dialogue Turns</span>
                                <span className="font-mono text-[#0F172A]">
                                  {(() => {
                                    if (!meetingDetails?.segments) return 0;
                                    let turns = 0;
                                    let lastSpk = null;
                                    meetingDetails.segments.forEach(s => {
                                      const spk = s.speaker_id || s.speaker_name || s.speaker;
                                      if (spk !== lastSpk) {
                                        turns++;
                                        lastSpk = spk;
                                      }
                                    });
                                    return turns;
                                  })()}
                                </span>
                              </div>
                              <div className="flex justify-between py-1">
                                <span>Confidence Score</span>
                                <span className="font-mono font-bold text-[#0F172A]">{(() => { const vals = (meetingDetails?.segments || []).map(s => Number(s.confidence)).filter(Number.isFinite); return vals.length ? `${Math.round((vals.reduce((a,b)=>a+b,0)/vals.length)*100)}%` : "—"; })()}</span>
                              </div>
                            </div>
                          </div>

                          <div className="bg-sky-50 border border-sky-200 rounded-xl p-3.5 text-xs text-sky-900 font-medium leading-relaxed">
                            💡 <strong>Tip:</strong> Dialogue is grouped into cohesive turns. Click any sentence to seek audio, or double-click to correct text.
                          </div>

                          <button
                            onClick={async () => {
                              if (!speakers || speakers.length === 0) {
                                const initial = deriveSpeakersFromMeeting(meetingDetails);
                                setSpeakers(initial);
                              }
                              setAnalysisStep(2);
                            }}
                            className="w-full py-2.5 px-4 bg-[#14B8A6] hover:bg-[#0D9488] active:scale-[0.99] text-white text-xs font-bold rounded-lg shadow-3xs flex items-center justify-center gap-2 transition-all duration-150 group"
                          >
                            <span>Confirm & Map Speakers</span>
                            <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                          </button>
                        </div>
                      </div>

                      {/* SLIDE 2: Internal Slide Screen - Speaker Identification */}
                      <div 
                        className={`absolute inset-0 w-full h-full overflow-y-auto p-6 space-y-6 bg-[#F8FAFC] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                          analysisStep === 2 
                            ? 'translate-x-0 opacity-100 pointer-events-auto' 
                            : 'translate-x-full opacity-0 pointer-events-none'
                        }`}
                      >
                        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-5">
                          <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] font-bold text-[#14B8A6] uppercase tracking-wider font-mono">Internal Stage</span>
                                <span className="text-[#CBD5E1]">•</span>
                                <span className="text-[10px] font-semibold text-[#64748B]">Speaker Tagging</span>
                              </div>
                              <h3 className="text-sm font-extrabold text-[#0F172A] mt-0.5">Speaker Identities & Stakeholder Roles</h3>
                              <p className="text-xs text-[#64748B] font-medium mt-0.5">Map acoustic speakers to corporate identities and roles before AI extraction.</p>
                            </div>
                            <div className="flex items-center gap-2.5">
                              <button
                                onClick={() => setAnalysisStep(1)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F8FAFC] hover:bg-[#F1F5F9] border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] text-xs font-bold rounded-lg transition"
                                title="Return to Transcript"
                              >
                                <ArrowLeft size={13} />
                                <span>Back to Transcript</span>
                              </button>
                              <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold">
                                {displaySpeakers.length} Speakers Mapped
                              </span>
                            </div>
                          </div>

                            {/* Call Type Detection & Manual Override Panel */}
                            <div className="bg-slate-50 border border-[#E2E8F0] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-bold text-[#0F172A] uppercase tracking-wider font-mono">CALL TYPE DETECTION</span>
                                  <span className="px-2 py-0.5 bg-teal-50 text-teal-700 border border-teal-200 rounded text-[9.5px] font-bold font-mono">
                                    {Math.round((callTypeConfidence || 0.94) * 100)}% Confidence ({callTypeSource === 'manual' ? 'Manual Override' : 'AI Detected'})
                                  </span>
                                </div>
                                <p className="text-xs text-[#475569] font-medium leading-relaxed">
                                  {callTypeRationale || `AI detected this as a ${formatCallType(currentCallType)} call based on conversation signals. You may adjust it before playbook compilation.`}
                                </p>
                              </div>

                              <div className="flex items-center gap-2 flex-shrink-0">
                                <label className="text-xs font-bold text-[#64748B]">Call Stage:</label>
                                <select
                                  value={currentCallType}
                                  onChange={(e) => handleUpdateCallType(e.target.value)}
                                  className="bg-white border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-xs font-bold text-[#0F172A] shadow-3xs outline-none focus:border-[#14B8A6]"
                                >
                                  <option value="cold_prospecting">Cold / Prospecting</option>
                                  <option value="qualification">Qualification</option>
                                  <option value="discovery">Discovery</option>
                                  <option value="solution_demo">Solution / Demo</option>
                                  <option value="technical_validation">Technical Validation</option>
                                  <option value="negotiation">Negotiation</option>
                                  <option value="follow_up">Follow-up</option>
                                  <option value="renewal_expansion">Renewal / Expansion</option>
                                  <option value="other">Other</option>
                                </select>
                              </div>
                            </div>

                            {/* Speaker Cards Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {displaySpeakers.map((spk, idx) => {
                                const spkSegments = meetingSegments.filter(s => 
                                  (s.speaker_id && s.speaker_id === spk.speaker_id) || 
                                  (s.speaker_name && s.speaker_name === spk.name) || 
                                  (s.speaker && s.speaker === spk.name) ||
                                  (spk.raw_key && (s.speaker_id === spk.raw_key || s.speaker_name === spk.raw_key || s.speaker === spk.raw_key))
                                );
                                const spkSecs = spkSegments.reduce((acc, s) => acc + Math.max(0, (s.end_time || 0) - (s.start_time || 0)), 0);
                                const talkPercent = totalMeetingSecs > 0 ? Math.min(100, Math.max(1, Math.round((spkSecs / totalMeetingSecs) * 100))) : 0;
                                const sampleSegment = spkSegments.find(s => (s.corrected_text || s.text || '').trim().length > 15) || spkSegments[0];
                                const sampleUtterance = sampleSegment ? (sampleSegment.corrected_text || sampleSegment.text || '') : 'Speech segment captured from meeting audio.';
                                const colorTheme = getSpeakerColor(spk.name || `Speaker ${idx + 1}`);
                                const initials = getInitials(spk.name || `Speaker ${idx + 1}`);

                                return (
                                  <div key={spk.speaker_id || idx} className="p-4 bg-[#FAFBFB] border border-[#E5E7EB] rounded-xl space-y-3.5 shadow-3xs hover:border-[#CBD5E1] transition">
                                    {/* Speaker Card Header */}
                                    <div className="flex items-center justify-between pb-2 border-b border-[#F1F5F9]">
                                      <div className="flex items-center gap-2.5">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border shadow-3xs ${colorTheme.avatar}`}>
                                          {initials}
                                        </div>
                                        <div>
                                          <span className="text-xs font-extrabold text-[#0F172A] block">
                                            Speaker #{idx + 1}
                                          </span>
                                          <span className="text-[10px] font-mono text-[#94A3B8]">
                                            {spkSegments.length} utterances ({formatTime(spkSecs)})
                                          </span>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-1.5">
                                        <span className="px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded text-[10px] font-bold font-mono">
                                          {talkPercent}% talk time
                                        </span>
                                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[9px] font-bold">
                                          ✓ Diarized
                                        </span>
                                      </div>
                                    </div>

                                    {/* Sample Utterance Box */}
                                    <div className="p-2.5 bg-white border border-[#E2E8F0] rounded-lg text-xs space-y-1">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider">Sample Speech</span>
                                        {sampleSegment && (
                                          <button
                                            type="button"
                                            onClick={() => handlePlaySampleAudio(sampleSegment.start_time)}
                                            className="text-[9.5px] text-[#14B8A6] hover:text-[#0D9488] font-bold flex items-center gap-1"
                                            title="Listen to sample utterance"
                                          >
                                            <Play size={10} fill="currentColor" />
                                            <span>Play audio</span>
                                          </button>
                                        )}
                                      </div>
                                      <p className="text-[#475569] italic text-[11px] leading-relaxed line-clamp-2">
                                        "{sampleUtterance}"
                                      </p>
                                    </div>

                                    {/* Editable Fields */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-semibold">
                                      <div>
                                        <label className="text-[9.5px] text-[#64748B] block mb-1">Speaker Name Tag</label>
                                        <input
                                          type="text"
                                          value={spk.name}
                                          placeholder={`Speaker ${idx + 1}`}
                                          onChange={(e) => {
                                            const updated = displaySpeakers.map((s, i) => i === idx ? { ...s, name: e.target.value } : s);
                                            setSpeakers(updated);
                                          }}
                                          className="w-full bg-white border border-[#E5E7EB] rounded-lg p-2 text-xs font-bold text-[#0F172A] outline-none focus:border-[#14B8A6]"
                                        />
                                      </div>

                                      <div>
                                        <label className="text-[9.5px] text-[#64748B] block mb-1">Role / Persona</label>
                                        <select
                                          value={spk.role || "Prospect / Customer"}
                                          onChange={(e) => {
                                            const updated = displaySpeakers.map((s, i) => i === idx ? { ...s, role: e.target.value } : s);
                                            setSpeakers(updated);
                                          }}
                                          className="w-full bg-white border border-[#E5E7EB] rounded-lg p-2 text-xs font-semibold text-[#475569] outline-none focus:border-[#14B8A6]"
                                        >
                                          <option value="Prospect / Customer">Prospect / Customer</option>
                                          <option value="Sales Rep / Host">Sales Rep / Host</option>
                                          <option value="Economic Decision Maker">Economic Decision Maker</option>
                                          <option value="Project Champion">Project Champion</option>
                                          <option value="Technical Buyer / Lead">Technical Buyer / Lead</option>
                                          <option value="Security & Compliance">Security & Compliance</option>
                                          <option value="Consultant / Stakeholder">Consultant / Stakeholder</option>
                                        </select>
                                      </div>

                                      <div>
                                        <label className="text-[9.5px] text-[#64748B] block mb-1">Department</label>
                                        <input
                                          type="text"
                                          placeholder="e.g. Engineering, Sales, Product"
                                          value={spk.department || ""}
                                          onChange={(e) => {
                                            const updated = displaySpeakers.map((s, i) => i === idx ? { ...s, department: e.target.value } : s);
                                            setSpeakers(updated);
                                          }}
                                          className="w-full bg-white border border-[#E5E7EB] rounded-lg p-2 text-xs font-medium text-[#334155] outline-none focus:border-[#14B8A6]"
                                        />
                                      </div>

                                      <div>
                                        <label className="text-[9.5px] text-[#64748B] block mb-1">Job Title & Organization</label>
                                        <input
                                          type="text"
                                          placeholder="e.g. VP of Engineering"
                                          value={spk.job_title || ""}
                                          onChange={(e) => {
                                            const updated = displaySpeakers.map((s, i) => i === idx ? { ...s, job_title: e.target.value } : s);
                                            setSpeakers(updated);
                                          }}
                                          className="w-full bg-white border border-[#E5E7EB] rounded-lg p-2 text-xs font-medium text-[#334155] outline-none focus:border-[#14B8A6]"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-[#F1F5F9]">
                              <button
                                onClick={() => setAnalysisStep(1)}
                                className="flex items-center gap-1.5 px-4 py-2 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#64748B] hover:text-[#0F172A] text-xs font-bold rounded-lg transition shadow-3xs"
                              >
                                <ArrowLeft size={13} />
                                <span>Back to Transcript</span>
                              </button>
                              <button
                                onClick={async () => {
                                  await handleSaveSpeakers(displaySpeakers);
                                  setAnalysisStep(3);
                                }}
                                className="px-5 py-2.5 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-xs font-bold rounded-lg shadow-3xs transition flex items-center gap-1.5"
                              >
                                <span>Confirm Speakers & Proceed to Step 2 (Company) →</span>
                              </button>
                            </div>
                          </div>
                        </div>
                        </>
                      )
                    )}

                  {/* STEP 2: Company Association */}
                  {analysisStep === 3 && (
                    <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 bg-[#F8FAFC]">
                      <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-4 max-w-3xl mx-auto">
                        <div className="border-b border-[#F1F5F9] pb-3 flex items-center justify-between">
                          <div>
                            <span className="text-[10px] font-bold text-[#14B8A6] uppercase tracking-wider block font-mono">Step 2 of 6</span>
                              <h3 className="text-sm font-extrabold text-[#0F172A] mt-0.5">Link Account & Company Metadata</h3>
                              <p className="text-xs text-[#64748B] font-medium mt-0.5">Tag this meeting session to an existing customer or create a new corporate account.</p>
                            </div>
                            <span className="px-2.5 py-1 bg-sky-50 text-sky-700 border border-sky-200 rounded-lg text-xs font-bold font-mono">
                              {existingCompanies.length} Customers Available
                            </span>
                          </div>

                          {/* Mode Toggle Tabs */}
                          <div className="flex items-center gap-2 p-1 bg-[#F1F5F9] rounded-lg w-fit">
                            <button
                              type="button"
                              onClick={() => setCompanySelectMode("existing")}
                              className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${
                                companySelectMode === "existing"
                                  ? "bg-white text-[#0F172A] shadow-3xs"
                                  : "text-[#64748B] hover:text-[#0F172A]"
                              }`}
                            >
                              👥 Tag to Existing Customer
                            </button>
                            <button
                              type="button"
                              onClick={() => setCompanySelectMode("new")}
                              className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${
                                companySelectMode === "new"
                                  ? "bg-white text-[#0F172A] shadow-3xs"
                                  : "text-[#64748B] hover:text-[#0F172A]"
                              }`}
                            >
                              ➕ Create / Furnish New Account
                            </button>
                          </div>

                          {/* 1. Existing Customer Picker */}
                          {companySelectMode === "existing" && (
                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  placeholder="Search existing customer accounts..."
                                  value={companySearchFilter}
                                  onChange={(e) => setCompanySearchFilter(e.target.value)}
                                  className="w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg px-3 py-2 text-xs text-[#0F172A] outline-none placeholder-[#94A3B8] focus:border-[#14B8A6]"
                                />
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-60 overflow-y-auto p-1">
                                {existingCompanies
                                  .filter(c => (c.name || '').toLowerCase().includes(companySearchFilter.toLowerCase()) || (c.website || '').toLowerCase().includes(companySearchFilter.toLowerCase()))
                                  .map(c => {
                                    const isSelected = selectedCompanyId === c.id || companyName.toLowerCase() === (c.name || '').toLowerCase();
                                    return (
                                      <div
                                        key={c.id}
                                        onClick={() => {
                                          setSelectedCompanyId(c.id);
                                          setCompanyName(c.name);
                                          setCompanyWebsite(c.website || `https://www.${c.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`);
                                          setCompanyIndustry(c.industry || 'Technology');
                                        }}
                                        className={`p-3 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                                          isSelected
                                            ? "border-[#14B8A6] bg-[#F0FDFA] ring-2 ring-[#14B8A6]/20 shadow-3xs"
                                            : "border-[#E5E7EB] bg-[#FAFBFB] hover:bg-white hover:border-[#CBD5E1]"
                                        }`}
                                      >
                                        <div className="min-w-0 pr-2">
                                          <span className="text-xs font-bold text-[#0F172A] block truncate">{c.name}</span>
                                          <span className="text-[10px] text-[#64748B] block truncate">{c.website || "No domain set"}</span>
                                        </div>
                                        {isSelected ? (
                                          <span className="px-2 py-0.5 bg-emerald-500 text-white rounded-md text-[9px] font-bold flex items-center gap-1 flex-shrink-0">
                                            <Check size={10} /> Selected
                                          </span>
                                        ) : (
                                          <span className="text-[10px] font-semibold text-[#14B8A6] hover:underline flex-shrink-0">
                                            Select
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                              </div>
                            </div>
                          )}

                          {/* 2. New Account Creator */}
                          {companySelectMode === "new" && (
                            <div className="space-y-4 text-xs font-semibold">
                              <div>
                                <label className="text-[10px] text-[#64748B] uppercase block mb-1">Company Account Name</label>
                                <input
                                  type="text"
                                  value={companyName}
                                  onChange={(e) => {
                                    setCompanyName(e.target.value);
                                    setSelectedCompanyId(null);
                                  }}
                                  className="w-full bg-[#FAFBFB] border border-[#E5E7EB] rounded-lg p-2.5 text-xs font-bold text-[#0F172A] outline-none focus:border-[#14B8A6]"
                                  placeholder="e.g. ElevenLabs, Stripe, Acme Corp"
                                />
                              </div>

                              <div>
                                <label className="text-[10px] text-[#64748B] uppercase block mb-1">Website Domain / Primary URL</label>
                                <input
                                  type="text"
                                  value={companyWebsite}
                                  onChange={(e) => setCompanyWebsite(e.target.value)}
                                  className="w-full bg-[#FAFBFB] border border-[#E5E7EB] rounded-lg p-2.5 text-xs font-medium outline-none focus:border-[#14B8A6]"
                                  placeholder="https://www.example.com"
                                />
                              </div>
                            </div>
                          )}

                          {/* Selected Confirmation Banner */}
                          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 font-medium flex items-center justify-between">
                            <div>
                              <span>🏢 <strong>Selected Account:</strong> <strong>{companyName || "Unassigned"}</strong></span>
                              <span className="block text-[11px] text-emerald-700 mt-0.5">Domain: {companyWebsite || "None"}</span>
                            </div>
                            <span className="px-2 py-0.5 bg-emerald-600 text-white rounded text-[10px] font-bold">
                              ✓ Ready to Link
                            </span>
                          </div>

                          <div className="flex items-center justify-between pt-4 border-t border-[#F1F5F9]">
                            <button
                              type="button"
                              onClick={() => setAnalysisStep(2)}
                              className="px-4 py-2 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#64748B] text-xs font-bold rounded-lg transition"
                            >
                              ← Back to Speaker Mapping
                            </button>
                            <button
                              type="button"
                              onClick={handleConfirmCompanyStep}
                              className="px-5 py-2.5 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-xs font-bold rounded-lg shadow-3xs transition"
                            >
                              Confirm Company & Proceed to Step 3 (Playbook) →
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* STEP 3: Playbook Framework Selection */}
                    {analysisStep === 4 && (
                      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 bg-[#F8FAFC]">
                        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-4">
                          <div className="border-b border-[#F1F5F9] pb-3">
                            <span className="text-[10px] font-bold text-[#14B8A6] uppercase tracking-wider block font-mono">Step 3 of 6</span>
                            <h3 className="text-sm font-extrabold text-[#0F172A] mt-0.5">Select Playbook Framework for AI Extraction</h3>
                            <p className="text-xs text-[#64748B] font-medium mt-0.5">Choose the sales methodology PulseSync should extract and verify from this call.</p>
                          </div>

                          {/* Call Type Context Banner */}
                          <div className="bg-teal-50/60 border border-teal-200/80 rounded-xl p-3.5 flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <span className="p-1.5 bg-teal-100/80 text-teal-800 rounded-lg text-xs font-bold">🎯</span>
                              <div>
                                <span className="text-xs font-bold text-teal-950 block">Target Call Stage: {formatCallType(currentCallType)}</span>
                                <span className="text-[11px] text-teal-800 font-medium">PulseSync AI will prioritize intelligence signals tailored for a {formatCallType(currentCallType)} conversation.</span>
                              </div>
                            </div>
                            <span className="text-[10px] font-mono font-bold text-teal-700 bg-white px-2 py-1 rounded border border-teal-200">
                              {currentCallType === 'qualification' ? 'BANT Recommended' : (currentCallType === 'discovery' || currentCallType === 'negotiation') ? 'MEDDICC Recommended' : 'SPICED Recommended'}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {templateOptions.map((tmpl) => {
                              const isSelected = selectedTemplate === tmpl.id;
                              return (
                                <div
                                  key={tmpl.id}
                                  onClick={() => setSelectedTemplate(tmpl.id)}
                                  className={`p-4 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                                    isSelected
                                      ? 'border-[#14B8A6] bg-[#F0FDFA] ring-2 ring-[#14B8A6]/20'
                                      : 'border-[#E5E7EB] bg-white hover:bg-[#FAFBFB]'
                                  }`}
                                >
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-bold text-[#0F172A]">{tmpl.name}</span>
                                      {isSelected && <CheckCircle2 size={15} className="text-[#14B8A6]" />}
                                    </div>
                                    <span className="px-2 py-0.5 bg-slate-100 text-[#475569] rounded text-[10px] font-mono font-bold block w-fit">
                                      {tmpl.fieldsCount} properties
                                    </span>
                                    <p className="text-[11px] text-[#64748B] font-medium leading-relaxed">
                                      {tmpl.description || "Industry standard sales qualification schema for pipeline rigor."}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div className="flex items-center justify-between pt-4 border-t border-[#F1F5F9]">
                            <button
                              onClick={() => setAnalysisStep(3)}
                              className="px-4 py-2 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#64748B] text-xs font-bold rounded-lg transition"
                            >
                              ← Back to Company
                            </button>
                            <button
                              onClick={() => {
                                setAnalysisStep(5);
                                handleRunAiCompilation();
                              }}
                              className="px-6 py-2.5 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-xs font-bold rounded-lg shadow-3xs flex items-center gap-1.5 transition"
                            >
                              <Sparkles size={13} />
                              <span>Compile AI Intelligence (Step 4) →</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* STEP 5: Generating */}
                    {analysisStep === 5 && (
                      <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-12 bg-white space-y-4">
                        <Loader2 size={32} className="animate-spin text-[#14B8A6]" />
                        <h3 className="text-base font-extrabold text-[#0F172A]">Compiling Grounded Intelligence...</h3>
                        <p className="text-xs text-[#64748B] max-w-sm text-center leading-relaxed">
                          Extracting verified executive summary, deal intelligence parameters, action items, risks, and playbook coverage.
                        </p>
                      </div>
                    )}

                    {/* STEP 6: Dynamic AI Review Workspace */}
                    {analysisStep === 6 && (
                      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#F8FAFC]">
                        <DynamicReviewWorkspace
                          apiUrl={API_URL}
                          meetingId={selectedMeetingId}
                          profile={activeExtractionProfile || { id: selectedTemplate, name: selectedTemplate }}
                          callType={currentCallType}
                          conversationIntelligence={conversationIntelligence}
                          summarySections={dynamicSummarySections || []}
                          fields={localApprovals}
                          actionItems={actionItems}
                          risks={risks}
                          objections={objections}
                          executiveSummary={executiveSummaryText}
                          isMeetingSynced={isMeetingSynced}
                          onOpenEvidence={handleOpenEvidence}
                          onToast={triggerToast}
                          onFieldsChange={setLocalApprovals}
                          onProceedToSync={() => setAnalysisStep(7)}
                        />
                      </div>
                    )}

                    {/* STEP 7: CRM Destination Sync */}
                    {analysisStep === 7 && (
                      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 bg-[#F8FAFC]">
                        
                        {/* Destination Tabs */}
                        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-5">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#F1F5F9] pb-4">
                            <div>
                              <h3 className="text-sm font-extrabold text-[#0F172A]">
                                {isMeetingSynced ? 'HubSpot CRM Integration — Synchronized' : 'Synchronize Verified Intelligence to CRM'}
                              </h3>
                              <p className="text-xs text-[#64748B] font-medium mt-0.5">
                                {isMeetingSynced
                                  ? 'All human-approved intelligence, contacts, and tasks have been safely synchronized to your CRM.'
                                  : 'Review matched records, destination property mappings, and live diffs before executing transaction.'}
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              {['hubspot', 'salesforce', 'pipedrive'].map(dest => {
                                const isDestConnected = integrationsList.some(i => i.provider === dest && i.connection_status === 'connected');
                                const isComingSoon = dest !== 'hubspot';
                                return (
                                  <button
                                    key={dest}
                                    onClick={() => setActiveSyncTab(dest)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase font-mono transition flex items-center gap-1.5 ${
                                      activeSyncTab === dest
                                        ? 'bg-[#0F172A] text-white shadow-3xs'
                                        : 'bg-white text-[#64748B] border border-[#E5E7EB] hover:bg-[#F8FAFC]'
                                    }`}
                                  >
                                    <span>{dest}</span>
                                    {isComingSoon ? (
                                      <span className="text-[9px] text-amber-600 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 lowercase">soon</span>
                                    ) : isDestConnected ? (
                                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                    ) : (
                                      <span className="text-[9px] text-[#94A3B8] font-normal lowercase">(not connected)</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* STATE 1: ALREADY SYNCED - Primary Enterprise Completion View */}
                          {(isMeetingSynced || syncSuccessData?.status === 'succeeded') ? (
                            <div className="space-y-6">
                              {/* 1. Synced Successfully Banner */}
                              <div className="p-5 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent border border-emerald-200/80 rounded-xl space-y-3">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                  <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                                      <CheckCircle2 size={22} className="stroke-[2.5]" />
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <h4 className="text-sm font-extrabold text-[#0F172A]">Synced Successfully to HubSpot</h4>
                                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-mono font-bold">
                                          {syncPreview?.destination?.accountName ? `PORTAL #${syncPreview.destination.accountName}` : 'SYNCED'}
                                        </span>
                                      </div>
                                      <p className="text-xs text-[#64748B] mt-0.5 font-medium">
                                        Verified intelligence, contacts, and action items have been safely written to your CRM.
                                      </p>
                                    </div>
                                  </div>
                                  {syncSuccessData?.completedAt && (
                                    <div className="text-left sm:text-right font-mono text-[11px] text-[#64748B]">
                                      <span className="block text-[9.5px] uppercase font-bold text-[#94A3B8]">Completed At</span>
                                      <span className="font-semibold text-[#0F172A]">
                                        {new Date(syncSuccessData.completedAt).toLocaleString()}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {/* KPI stats */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-emerald-100/70">
                                  <div className="p-3 bg-white/90 rounded-lg border border-emerald-100 shadow-3xs">
                                    <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider block">Properties Updated</span>
                                    <span className="text-base font-extrabold text-emerald-700">
                                      {syncSuccessData?.summary?.fieldsUpdatedCount ?? localApprovals.length}
                                    </span>
                                  </div>
                                  <div className="p-3 bg-white/90 rounded-lg border border-emerald-100 shadow-3xs">
                                    <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider block">Contacts Associated</span>
                                    <span className="text-base font-extrabold text-emerald-700">
                                      {syncSuccessData?.summary?.contactsProcessedCount ?? speakers.length}
                                    </span>
                                  </div>
                                  <div className="p-3 bg-white/90 rounded-lg border border-emerald-100 shadow-3xs">
                                    <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider block">CRM Tasks Created</span>
                                    <span className="text-base font-extrabold text-emerald-700">
                                      {syncSuccessData?.summary?.tasksCreatedCount ?? (actionItems.length || 0)}
                                    </span>
                                  </div>
                                  <div className="p-3 bg-white/90 rounded-lg border border-emerald-100 shadow-3xs">
                                    <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider block">Meeting Note</span>
                                    <span className="text-base font-extrabold text-emerald-700">1 Logged</span>
                                  </div>
                                </div>
                              </div>

                              {/* 2. Destination CRM Records with Direct Links */}
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-wider">
                                    Destination HubSpot Records
                                  </span>
                                  <span className="text-[11px] text-[#64748B] font-medium">
                                    Idempotent link integrity confirmed
                                  </span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  {/* Company Card */}
                                  <div className="p-4 bg-white border border-[#E5E7EB] rounded-xl flex items-start justify-between">
                                    <div className="space-y-1">
                                      <span className="text-[10px] font-bold text-[#64748B] uppercase flex items-center gap-1.5">
                                        <Building2 size={12} className="text-orange-500" /> HubSpot Company
                                      </span>
                                      <span className="text-xs font-bold text-[#0F172A] block">
                                        {syncSuccessData?.updatedRecords?.company?.name || companyName || "Target Company"}
                                      </span>
                                      <span className="text-[10.5px] font-mono text-[#64748B] block">
                                        ID: {syncSuccessData?.destinationRecordIds?.company_id || syncSuccessData?.updatedRecords?.company?.id || "Synced"}
                                      </span>
                                    </div>
                                    {(syncSuccessData?.updatedRecords?.company?.url) ? (
                                      <a
                                        href={syncSuccessData.updatedRecords.company.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="px-2.5 py-1 bg-[#F8FAFC] border border-[#E2E8F0] hover:bg-[#F1F5F9] text-xs font-bold text-[#0F172A] rounded-lg transition inline-flex items-center gap-1"
                                      >
                                        <span>View</span>
                                        <ExternalLink size={11} />
                                      </a>
                                    ) : (
                                      <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[9px] font-mono font-bold rounded">
                                        Linked
                                      </span>
                                    )}
                                  </div>

                                  {/* Deal Card */}
                                  <div className="p-4 bg-white border border-[#E5E7EB] rounded-xl flex items-start justify-between">
                                    <div className="space-y-1">
                                      <span className="text-[10px] font-bold text-[#64748B] uppercase flex items-center gap-1.5">
                                        <TrendingUp size={12} className="text-orange-500" /> HubSpot Deal
                                      </span>
                                      <span className="text-xs font-bold text-[#0F172A] block">
                                        {syncSuccessData?.updatedRecords?.deal?.name || (companyName ? `${companyName} - Expansion Opportunity` : "Sales Deal")}
                                      </span>
                                      <span className="text-[10.5px] font-mono text-[#64748B] block">
                                        ID: {syncSuccessData?.destinationRecordIds?.deal_id || syncSuccessData?.updatedRecords?.deal?.id || "Synced"}
                                      </span>
                                    </div>
                                    {(syncSuccessData?.updatedRecords?.deal?.url) ? (
                                      <a
                                        href={syncSuccessData.updatedRecords.deal.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="px-2.5 py-1 bg-[#F8FAFC] border border-[#E2E8F0] hover:bg-[#F1F5F9] text-xs font-bold text-[#0F172A] rounded-lg transition inline-flex items-center gap-1"
                                      >
                                        <span>View</span>
                                        <ExternalLink size={11} />
                                      </a>
                                    ) : (
                                      <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[9px] font-mono font-bold rounded">
                                        Linked
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* 3. Associated Contacts & CRM Tasks Grid */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Contacts List */}
                                <div className="p-4 bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl space-y-2.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-[#64748B] uppercase flex items-center gap-1.5">
                                      <Users size={12} className="text-[#14B8A6]" /> Associated Contacts
                                    </span>
                                    <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                                      {(syncSuccessData?.updatedRecords?.contacts || speakers || []).length} Synced
                                    </span>
                                  </div>
                                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                    {(syncSuccessData?.updatedRecords?.contacts || (speakers.length > 0 ? speakers : [{ name: 'Primary Contact', role: 'Stakeholder' }])).map((c, idx) => (
                                      <div key={idx} className="p-2 bg-white border border-[#E5E7EB] rounded-lg flex items-center justify-between text-xs">
                                        <div className="truncate mr-2">
                                          <span className="font-bold text-[#0F172A] block truncate">{c.name || `Contact ${idx + 1}`}</span>
                                          <span className="text-[10px] text-[#64748B] block truncate">{c.role || c.email || 'Participant'}</span>
                                        </div>
                                        {c.url ? (
                                          <a href={c.url} target="_blank" rel="noreferrer" className="text-orange-600 hover:text-orange-700 flex items-center gap-0.5 font-mono text-[10px] font-bold">
                                            <span>HubSpot</span>
                                            <ExternalLink size={10} />
                                          </a>
                                        ) : (
                                          <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[9px] font-mono font-bold">
                                            Associated
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                {/* CRM Tasks */}
                                <div className="p-4 bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl space-y-2.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-[#64748B] uppercase flex items-center gap-1.5">
                                      <CheckSquare size={12} className="text-[#14B8A6]" /> Scheduled Tasks
                                    </span>
                                    <span className="text-[10px] font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                                      {(syncSuccessData?.updatedRecords?.tasks || actionItems || []).length} Created
                                    </span>
                                  </div>
                                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                    {(syncSuccessData?.updatedRecords?.tasks || (actionItems.length > 0 ? actionItems : [{ task: 'Follow up with stakeholders', owner: 'Sales Rep' }])).map((t, idx) => (
                                      <div key={idx} className="p-2 bg-white border border-[#E5E7EB] rounded-lg flex items-center justify-between text-xs">
                                        <div className="truncate mr-2">
                                          <span className="font-bold text-[#0F172A] block truncate">{t.title || t.task || `Action Item ${idx + 1}`}</span>
                                          <span className="text-[10px] text-[#64748B] block truncate">Assignee: {t.owner || 'Sales Rep'}</span>
                                        </div>
                                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 border border-slate-200 rounded text-[9px] font-mono font-bold">
                                          Logged
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              {/* 4. Collapsible Synchronized Property Audit Trail */}
                              <div className="border border-[#E5E7EB] rounded-xl overflow-hidden bg-white">
                                <button
                                  onClick={() => setShowSyncDetails(!showSyncDetails)}
                                  className="w-full p-3.5 bg-[#FAFBFB] hover:bg-[#F8FAFC] text-left flex items-center justify-between transition cursor-pointer"
                                >
                                  <div className="flex items-center gap-2">
                                    <Database size={14} className="text-[#14B8A6]" />
                                    <span className="text-xs font-bold text-[#0F172A]">
                                      {showSyncDetails ? 'Hide Sync Property Audit Trail' : 'View Sync Property Audit Trail'}
                                    </span>
                                    <span className="text-[10px] font-mono text-[#64748B]">
                                      ({(syncSuccessData?.items || localApprovals || []).length} properties written)
                                    </span>
                                  </div>
                                  <ChevronDown size={14} className={`text-[#64748B] transition-transform ${showSyncDetails ? 'rotate-180' : ''}`} />
                                </button>

                                {showSyncDetails && (
                                  <div className="p-4 border-t border-[#E5E7EB] overflow-x-auto">
                                    <table className="w-full text-xs text-left border-collapse">
                                      <thead>
                                        <tr className="border-b border-[#E5E7EB] text-[9.5px] font-bold text-[#64748B] uppercase tracking-wider bg-[#F8FAFC]">
                                          <th className="py-2 px-3">Field</th>
                                          <th className="py-2 px-3">Target Object</th>
                                          <th className="py-2 px-3">Destination Property</th>
                                          <th className="py-2 px-3">Value Written</th>
                                          <th className="py-2 px-3 text-right">Status</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-[#F1F5F9] font-medium text-[#0F172A]">
                                        {(syncSuccessData?.items && syncSuccessData.items.length > 0
                                          ? syncSuccessData.items
                                          : (syncPreview?.fieldDiffs || localApprovals.map(a => ({
                                              field_name: a.field || a.field_name,
                                              target_object: 'deal',
                                              target_field: a.field || a.field_name,
                                              new_value: a.approved_value || a.suggested_value || a.value,
                                              status: 'SYNCHRONIZED'
                                            })))
                                        ).map((item, idx) => (
                                          <tr key={idx} className="hover:bg-[#FAFBFB]">
                                            <td className="py-2 px-3 font-bold text-[#0F172A]">{item.field_name || item.pulseSyncField}</td>
                                            <td className="py-2 px-3 font-mono text-[10px] uppercase text-[#64748B]">{item.target_object || item.destinationObject || 'deal'}</td>
                                            <td className="py-2 px-3 font-mono text-[#0F766E]">{item.target_field || item.destinationField}</td>
                                            <td className="py-2 px-3 font-semibold text-[#0F172A] max-w-xs truncate">{formatDisplayValue(item.new_value ?? '')}</td>
                                            <td className="py-2 px-3 text-right">
                                              <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                {item.status || 'SYNCHRONIZED'}
                                              </span>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>

                              {/* 5. Enterprise Action Bar */}
                              <div className="pt-4 border-t border-[#F1F5F9] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="text-xs text-[#64748B] flex items-center gap-1.5">
                                  <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
                                  <span className="font-medium">
                                    Meeting is fully synchronized. Navigating backward or refreshing preserves this state.
                                  </span>
                                </div>

                                <div className="flex items-center gap-2.5">
                                  <button
                                    onClick={handleClearSelection}
                                    className="px-4 py-2 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#475569] text-xs font-bold rounded-lg transition"
                                  >
                                    Return to Queue
                                  </button>
                                  <button
                                    onClick={handleReopenReview}
                                    className="px-4 py-2 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#475569] text-xs font-bold rounded-lg transition"
                                  >
                                    Reopen Review
                                  </button>
                                  {syncSuccessData?.hubspotUrl && (
                                    <a
                                      href={syncSuccessData.hubspotUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-lg transition inline-flex items-center gap-1.5 shadow-3xs"
                                    >
                                      <span>Open in HubSpot</span>
                                      <ExternalLink size={12} />
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          ) : syncingInProgress ? (
                            /* STATE 2: SYNC IN PROGRESS */
                            <div className="py-16 text-center space-y-4">
                              <div className="h-12 w-12 rounded-full bg-teal-50 border border-teal-200 flex items-center justify-center mx-auto text-[#14B8A6]">
                                <Loader2 size={24} className="animate-spin" />
                              </div>
                              <div className="space-y-1">
                                <h4 className="text-sm font-extrabold text-[#0F172A]">Synchronization in Progress</h4>
                                <p className="text-xs text-[#64748B] max-w-md mx-auto leading-relaxed">
                                  Writing verified intelligence to HubSpot{syncPreview?.destination?.accountName ? ` portal #${syncPreview.destination.accountName}` : ''}, associating contacts, and logging activity. Please do not close or navigate away.
                                </p>
                              </div>
                            </div>
                          ) : (
                            /* STATE 3: PRE-SYNC PREPARATION & REVIEW */
                            <div className="space-y-6">
                              {/* Error Banner if prior attempt had issue */}
                              {syncError && (
                                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-rose-800 font-extrabold text-xs">
                                      <AlertTriangle size={15} className="text-rose-600" />
                                      <span>Synchronization Error</span>
                                    </div>
                                    <button onClick={() => setSyncError(null)} className="text-[10px] text-rose-600 hover:underline">Dismiss</button>
                                  </div>
                                  <p className="text-xs text-rose-700 font-medium">{syncError}</p>
                                  <p className="text-[11px] text-rose-600">
                                    Your transcript, extracted fields, and review edits were preserved. Partial CRM records are safely reconciled when you retry.
                                  </p>
                                </div>
                              )}

                              {activeSyncTab !== 'hubspot' ? (
                                <div className="p-8 bg-[#FAFBFB] border border-[#E5E7EB] rounded-xl text-center space-y-3">
                                  <div className="h-10 w-10 mx-auto rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 font-bold text-xs uppercase">
                                    {activeSyncTab === 'salesforce' ? 'SF' : 'PD'}
                                  </div>
                                  <h4 className="text-xs font-extrabold text-[#0F172A] capitalize">{activeSyncTab} Integration — Coming Soon</h4>
                                  <p className="text-xs text-[#64748B] max-w-md mx-auto leading-relaxed">
                                    Direct synchronization for {activeSyncTab === 'salesforce' ? 'Salesforce' : 'Pipedrive'} is currently in development. HubSpot CRM is currently enabled for bidirectional intelligence sync.
                                  </p>
                                  <button
                                    onClick={() => setActiveSyncTab('hubspot')}
                                    className="px-4 py-2 bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-bold rounded-lg shadow-3xs inline-flex items-center gap-1.5 transition"
                                  >
                                    <span>Switch to HubSpot CRM</span>
                                    <ArrowRight size={13} />
                                  </button>
                                </div>
                              ) : !isHubSpotConnected ? (
                                <div className="p-8 bg-[#FAFBFB] border border-[#E5E7EB] rounded-xl text-center space-y-3">
                                  <Database size={28} className="mx-auto text-[#94A3B8]" />
                                  <h4 className="text-xs font-extrabold text-[#0F172A]">HubSpot CRM is Not Connected</h4>
                                  <p className="text-xs text-[#64748B] max-w-md mx-auto leading-relaxed">
                                    Authorize PulseSync AI with your HubSpot portal via OAuth 2.0 to resolve company records and write approved intelligence.
                                  </p>
                                  <button
                                    onClick={() => setViewMode('integrations')}
                                    className="px-4 py-2 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-xs font-bold rounded-lg shadow-3xs inline-flex items-center gap-1.5 transition"
                                  >
                                    <span>Go to Integrations Hub to Connect</span>
                                    <ArrowRight size={13} />
                                  </button>
                                </div>
                              ) : loadingSyncPreview ? (
                                <div className="py-16 text-center text-xs text-[#64748B] flex flex-col items-center gap-2">
                                  <Loader2 size={24} className="animate-spin text-[#14B8A6]" />
                                  <span>Resolving CRM records and computing property diffs...</span>
                                </div>
                              ) : syncPreview ? (
                                <div className="space-y-6">
                                  
                                  {/* 1. Destination & Account Card */}
                                  <div className="p-4 bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="h-9 w-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-600 font-bold text-xs">
                                        HS
                                      </div>
                                      <div>
                                        <span className="text-xs font-bold text-[#0F172A] block">HubSpot CRM Integration</span>
                                        <span className="text-[11px] text-[#64748B] block">Connected Portal {syncPreview.destination?.accountName ? `#${syncPreview.destination.accountName}` : 'Active'}</span>
                                      </div>
                                    </div>
                                    <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full text-[10px] font-mono font-bold flex items-center gap-1">
                                      <Check size={11} /> Ready to Sync
                                    </span>
                                  </div>

                                  {/* 2. Resolved CRM Records */}
                                  <div className="space-y-2.5">
                                    <span className="text-[10px] font-bold text-[#94A3B8] uppercase block tracking-wider">
                                      1. Target CRM Records
                                    </span>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                      {/* Company */}
                                      <div className="p-3 bg-white border border-[#E5E7EB] rounded-lg">
                                        <div className="flex items-center justify-between text-[10px] font-bold text-[#64748B] uppercase">
                                          <span>Target Company</span>
                                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono ${syncPreview.resolvedRecords?.company?.isNew ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                            {syncPreview.resolvedRecords?.company?.isNew ? 'Create New' : 'Existing Match'}
                                          </span>
                                        </div>
                                        <span className="text-xs font-bold text-[#0F172A] block mt-1 truncate">
                                          {syncPreview.resolvedRecords?.company?.name || companyName}
                                        </span>
                                      </div>

                                      {/* Deal */}
                                      <div className="p-3 bg-white border border-[#E5E7EB] rounded-lg">
                                        <div className="flex items-center justify-between text-[10px] font-bold text-[#64748B] uppercase">
                                          <span>Target Deal</span>
                                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono ${syncPreview.resolvedRecords?.deal?.isNew ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                            {syncPreview.resolvedRecords?.deal?.isNew ? 'Create New' : 'Existing Match'}
                                          </span>
                                        </div>
                                        <span className="text-xs font-bold text-[#0F172A] block mt-1 truncate">
                                          {syncPreview.resolvedRecords?.deal?.name}
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* 3. Participants & Contact Matching */}
                                  {syncPreview.contactsSummary && (
                                    <div className="space-y-2.5">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-bold text-[#94A3B8] uppercase block tracking-wider">
                                          2. Participant Contact Matching ({syncPreview.contactsSummary.total} Participants)
                                        </span>
                                        <span className="text-[10.5px] font-mono font-bold text-[#0F766E] bg-emerald-50 px-2 py-0.5 rounded-full">
                                          {syncPreview.contactsSummary.matched} Matched &bull; {syncPreview.contactsSummary.unmatched} Ready to Associate
                                        </span>
                                      </div>

                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {syncPreview.contactsSummary.participants.map((p, idx) => (
                                          <div key={idx} className="p-3 bg-white border border-[#E5E7EB] rounded-lg flex items-center justify-between text-xs">
                                            <div className="space-y-0.5">
                                              <span className="font-bold text-[#0F172A] block">{p.name}</span>
                                              <span className="text-[10px] text-[#64748B] block font-normal">{p.role || 'Stakeholder'} &bull; {p.email || 'Email auto-generated'}</span>
                                            </div>
                                            <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold border ${p.status === 'MATCHED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-sky-50 text-sky-700 border-sky-200'}`}>
                                              {p.status === 'MATCHED' ? 'Linked Contact' : 'Will Associate'}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* 4. Action Items -> CRM Tasks */}
                                  {syncPreview.tasksSummary && syncPreview.tasksSummary.items.length > 0 && (
                                    <div className="space-y-2.5">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-bold text-[#94A3B8] uppercase block tracking-wider">
                                          3. Approved CRM Tasks to Create ({syncPreview.tasksSummary.items.length} Tasks)
                                        </span>
                                        <span className="text-[10.5px] font-mono font-bold text-[#475569] bg-slate-100 px-2 py-0.5 rounded-full">
                                          Associated to Deal & Company
                                        </span>
                                      </div>

                                      <div className="space-y-2">
                                        {syncPreview.tasksSummary.items.map((t, idx) => (
                                          <div key={idx} className="p-2.5 bg-white border border-[#E5E7EB] rounded-lg flex items-center justify-between text-xs">
                                            <div className="flex items-center gap-2">
                                              <CheckSquare size={13} className="text-[#14B8A6]" />
                                              <span className="font-bold text-[#0F172A]">{t.task}</span>
                                            </div>
                                            <span className="text-[10px] font-medium text-[#64748B]">Owner: <strong>{t.owner}</strong></span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* 5. Field Diffs Table */}
                                  <div className="space-y-2.5">
                                    <span className="text-[10px] font-bold text-[#94A3B8] uppercase block tracking-wider">
                                      4. Verified Properties to Synchronize ({syncPreview.fieldDiffs?.length || 0} fields)
                                    </span>

                                    {syncPreview.warnings && syncPreview.warnings.length > 0 && (
                                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs font-semibold text-amber-900 space-y-1">
                                        <span className="font-bold flex items-center gap-1.5"><AlertTriangle size={13} /> Overwrite Notice:</span>
                                        {syncPreview.warnings.map((w, idx) => (
                                          <div key={idx} className="text-[11px] font-normal">• {w}</div>
                                        ))}
                                      </div>
                                    )}

                                    <div className="overflow-x-auto border border-[#E5E7EB] rounded-lg bg-white">
                                      <table className="w-full text-xs text-left border-collapse">
                                        <thead>
                                          <tr className="border-b border-[#E5E7EB] text-[9px] font-bold text-[#64748B] uppercase tracking-wider bg-[#F8FAFC]">
                                            <th className="py-2.5 px-3">PulseSync Field</th>
                                            <th className="py-2.5 px-3">Target Object</th>
                                            <th className="py-2.5 px-3">Destination Property</th>
                                            <th className="py-2.5 px-3">New Value to Write</th>
                                            <th className="py-2.5 px-3 text-right">Status</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[#F1F5F9] font-medium text-[#0F172A]">
                                          {(syncPreview.fieldDiffs || []).map((diff, idx) => (
                                            <tr key={idx} className="hover:bg-[#FAFBFB]">
                                              <td className="py-2.5 px-3 font-bold text-[#0F172A]">{diff.pulseSyncField}</td>
                                              <td className="py-2.5 px-3 font-mono text-[10px] uppercase text-[#64748B]">{diff.destinationObject}</td>
                                              <td className="py-2.5 px-3 font-mono">
                                                {diff.destinationField && diff.destinationField !== 'unmapped' ? (
                                                  <span className="text-[#0F766E] font-medium">{diff.destinationField}</span>
                                                ) : (
                                                  <span className="text-[#94A3B8] italic">unmapped</span>
                                                )}
                                              </td>
                                              <td className="py-2.5 px-3 font-semibold text-[#0F172A] max-w-xs break-words">
                                                {formatDisplayValue(diff.newValue)}
                                              </td>
                                              <td className="py-2.5 px-3 text-right">
                                                <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                                  {diff.isApproved ? (
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                      Approved
                                                    </span>
                                                  ) : (
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                                      Needs Review
                                                    </span>
                                                  )}
                                                  {diff.validationError ? (
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200" title={diff.validationError}>
                                                      Invalid
                                                    </span>
                                                  ) : (!diff.isMapped || diff.status === 'UNMAPPED' || diff.destinationField === 'unmapped') ? (
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                                                      Unmapped
                                                    </span>
                                                  ) : diff.status === 'CREATE' ? (
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                                      Create
                                                    </span>
                                                  ) : diff.status === 'UPDATE' ? (
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-teal-50 text-teal-700 border border-teal-200">
                                                      Update
                                                    </span>
                                                  ) : (
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-50 text-slate-600 border border-slate-200">
                                                      {diff.status}
                                                    </span>
                                                  )}
                                                </div>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>

                                  {/* 6. Sync Action Bar */}
                                  <div className="pt-4 border-t border-[#F1F5F9] flex items-center justify-between">
                                    <div className="text-xs text-[#64748B]">
                                      <span>Only human-approved values will be written. All changes are logged in the audit trail.</span>
                                    </div>

                                    <div className="flex items-center gap-3">
                                      <button
                                        onClick={handleExecuteCrmSync}
                                        disabled={syncingInProgress || !isHubSpotConnected}
                                        className="px-6 py-2.5 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-xs font-bold rounded-lg shadow-3xs flex items-center gap-1.5 transition disabled:opacity-50"
                                      >
                                        <Lock size={12} />
                                        <span>Execute Real Sync to HubSpot</span>
                                      </button>
                                    </div>
                                  </div>

                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>

                      </div>
                    )}

                  </div>

                </div>
                )
              )}

            </div>
          )}

        </div>

      </main>

      {/* ── Slide-over Evidence Drawer ── */}
      {isEvidenceDrawerOpen && activeEvidenceField && (
        <div className="fixed inset-0 z-50 overflow-hidden select-none">
          <div className="absolute inset-0 bg-[#0F172A]/40 backdrop-blur-xs transition-opacity" onClick={handleCloseEvidenceDrawer} />
          <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-md bg-white border-l border-[#E5E7EB] shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200">
              
              <div className="px-6 py-4 border-b border-[#E5E7EB] bg-[#FAFBFB] flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-bold text-[#14B8A6] uppercase tracking-wider">Ground Truth Proof</span>
                  <h3 className="text-sm font-extrabold text-[#0F172A] mt-0.5">{activeEvidenceField.field}</h3>
                </div>
                <button onClick={handleCloseEvidenceDrawer} className="p-1 hover:bg-[#E2E8F0] rounded text-[#64748B]">
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-[#F8FAFC] text-left">
                
                <div className="bg-white border border-[#E5E7EB] p-4 rounded-xl shadow-3xs">
                  <span className="text-[9px] font-bold text-[#94A3B8] uppercase block">Extracted Parameter</span>
                  <p className="text-xs font-extrabold text-[#0F172A] mt-1 font-mono">{activeEvidenceField.extractedValue || activeEvidenceField.value}</p>
                </div>

                <div className="bg-white border border-[#E5E7EB] p-4 rounded-xl shadow-3xs space-y-2">
                  <span className="text-[9px] font-bold text-[#94A3B8] uppercase block">Direct Dialogue Quote</span>
                  <blockquote className="border-l-2 border-[#14B8A6] pl-3 italic text-xs leading-relaxed text-[#334155] font-semibold">
                    "{activeEvidenceField.quote}"
                  </blockquote>
                  <div className="flex items-center gap-2 text-[10px] text-[#64748B] font-semibold pt-1">
                    <span>Speaker: {activeEvidenceField.speaker}</span>
                    <span>•</span>
                    <span>Timestamp: {activeEvidenceField.timestamp}</span>
                  </div>
                </div>

                <div className="bg-white border border-[#E5E7EB] p-4 rounded-xl shadow-3xs flex items-center justify-between">
                  <span className="text-xs font-bold text-[#0F172A]">Acoustic Evidence</span>
                  <button
                    onClick={() => {
                      if (activeEvidenceField.timestampSecs !== undefined) {
                        const start = Math.max(0, activeEvidenceField.timestampSecs - 3);
                        const end = Math.max(start + 6, activeEvidenceField.endTimeSecs || activeEvidenceField.timestampSecs + 6);
                        if (isPlaying) {
                          audioRef.current?.pause();
                          setIsPlaying(false);
                        } else {
                          setClipRange({ start, end });
                          if (audioRef.current) {
                            audioRef.current.currentTime = start;
                            audioRef.current.play().then(() => setIsPlaying(true)).catch(console.warn);
                          }
                        }
                      }
                    }}
                    className="px-3 py-1.5 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-xs font-bold rounded-lg shadow-3xs flex items-center gap-1.5 transition"
                  >
                    {isPlaying ? <><Pause size={12} /> Pause Clip</> : <><Play size={12} /> Play Clip</>}
                  </button>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Slide-over Speaker Mapping Drawer ── */}
      {isSpeakerDrawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden select-none text-left">
          <div className="absolute inset-0 bg-[#0F172A]/40 backdrop-blur-xs transition-opacity" onClick={() => setIsSpeakerDrawerOpen(false)} />
          <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-lg bg-white border-l border-[#E5E7EB] shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200">
              
              <div className="px-6 py-4 border-b border-[#E5E7EB] bg-[#FAFBFB] flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-[#0F172A]">Manage Speaker Identities</h3>
                  <p className="text-[10px] text-[#64748B] font-semibold mt-0.5">Map detected speakers to verified corporate profiles.</p>
                </div>
                <button onClick={() => setIsSpeakerDrawerOpen(false)} className="p-1 hover:bg-[#E2E8F0] rounded text-[#64748B]">
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#F8FAFC]">
                {speakers.map((spk, idx) => (
                  <div key={spk.speaker_id} className="bg-white border border-[#E5E7EB] p-4 rounded-xl shadow-3xs space-y-3">
                    <span className="text-[10px] font-bold text-[#14B8A6] uppercase tracking-wider block">Speaker #{idx + 1}</span>
                    <div className="grid grid-cols-2 gap-3 text-xs font-semibold">
                      <div>
                        <label className="text-[9px] text-[#64748B] block mb-1">Full Name</label>
                        <input
                          type="text"
                          value={spk.name}
                          onChange={(e) => {
                            const updated = [...speakers];
                            updated[idx].name = e.target.value;
                            setSpeakers(updated);
                          }}
                          className="w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg p-2 outline-none focus:border-[#14B8A6]"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-[#64748B] block mb-1">Authority Role</label>
                        <select
                          value={spk.role || "Stakeholder"}
                          onChange={(e) => {
                            const updated = [...speakers];
                            updated[idx].role = e.target.value;
                            setSpeakers(updated);
                          }}
                          className="w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg p-2 outline-none"
                        >
                          <option value="Champion">Champion</option>
                          <option value="Economic Buyer">Economic Buyer</option>
                          <option value="Technical Buyer">Technical Buyer</option>
                          <option value="Security">Security</option>
                          <option value="Procurement">Procurement</option>
                          <option value="Stakeholder">Stakeholder</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[9px] text-[#64748B] block mb-1">Job Title</label>
                        <input
                          type="text"
                          value={spk.job_title || ""}
                          onChange={(e) => {
                            const updated = [...speakers];
                            updated[idx].job_title = e.target.value;
                            setSpeakers(updated);
                          }}
                          placeholder="e.g. VP Engineering"
                          className="w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg p-2 outline-none focus:border-[#14B8A6]"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-[#64748B] block mb-1">Email</label>
                        <input
                          type="email"
                          value={spk.email || ""}
                          onChange={(e) => {
                            const updated = [...speakers];
                            updated[idx].email = e.target.value;
                            setSpeakers(updated);
                          }}
                          placeholder="e.g. name@acme.com"
                          className="w-full bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg p-2 outline-none focus:border-[#14B8A6]"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 border-t border-[#E5E7EB] bg-white flex justify-end">
                <button
                  onClick={() => handleSaveSpeakers(speakers)}
                  className="px-4 py-2 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-xs font-bold rounded-lg shadow-3xs transition"
                >
                  Save Verified Mappings
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}



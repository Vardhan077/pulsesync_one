import React, { useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Play,
  Pause,
  Volume2,
  VolumeX,
  FileText,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
  Lock,
  Search,
  Sparkles,
  User,
  Sliders,
  RefreshCw,
  TrendingUp,
  Download,
  Share2,
  ChevronRight,
  Shield,
  Layers,
  HelpCircle,
  XCircle,
  Check
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

const formatSeconds = (sec) => {
  if (!sec || isNaN(sec)) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

export default function CallDetails({
  meetingId,
  companyId: propCompanyId,
  API_URL: propApiUrl,
  onBackToCustomer,
  onReviewMeeting,
  onReviewCall,
  onSyncMeeting,
  onSyncCall
}) {
  const API_URL =
    propApiUrl ||
    import.meta.env.VITE_API_URL ||
    (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:3001` : "http://localhost:3001");
  const handleReview = onReviewCall || onReviewMeeting;
  const handleSync = onSyncCall || onSyncMeeting;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [meetingData, setMeetingData] = useState(null);

  // Audio Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef(null);

  // Transcript search
  const [transcriptSearch, setTranscriptSearch] = useState("");

  // Fetch this specific call's independent data
  useEffect(() => {
    if (!meetingId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setIsPlaying(false);
    setCurrentTime(0);

    fetch(`${API_URL}/api/meetings/${meetingId}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Failed to load call details (${res.status}): ${text.slice(0, 100)}`);
        }
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          throw new Error(`Invalid response format from server (received non-JSON). Check API connection.`);
        }
        return res.json();
      })
      .then((data) => {
        setMeetingData(data);
        if (data.meeting?.duration_seconds) {
          setDuration(Number(data.meeting.duration_seconds));
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("Error loading call details:", err);
          setError(err.message || "Could not load call details.");
        }
      })
      .finally(() => {
        setLoading(false);
      });

    return () => controller.abort();
  }, [meetingId, API_URL]);

  // Audio event listeners
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      if (audioRef.current.duration && !isNaN(audioRef.current.duration)) {
        setDuration(audioRef.current.duration);
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current && audioRef.current.duration) {
      setDuration(audioRef.current.duration);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  };

  const seekTo = (seconds) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(seconds, duration || 999999));
    setCurrentTime(audioRef.current.currentTime);
    if (!isPlaying) {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const handleScrubberChange = (e) => {
    const targetTime = Number(e.target.value);
    seekTo(targetTime);
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    const next = !isMuted;
    setIsMuted(next);
    audioRef.current.muted = next;
  };

  const changePlaybackRate = (rate) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  if (loading) {
    return (
      <div className="flex-1 h-full bg-[#F8FAFC] flex flex-col items-center justify-center p-8 select-none">
        <div className="h-9 w-9 rounded-full border-2 border-[#14B8A6] border-t-transparent animate-spin mb-3" />
        <span className="text-xs font-bold text-[#0F172A]">Loading call records...</span>
        <span className="text-[11px] text-[#64748B] mt-0.5 font-mono">Call ID: {meetingId}</span>
      </div>
    );
  }

  if (error || !meetingData?.meeting) {
    return (
      <div className="flex-1 h-full bg-[#F8FAFC] flex flex-col items-center justify-center p-8 select-none">
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl max-w-md text-center space-y-3">
          <AlertTriangle className="text-rose-600 mx-auto" size={28} />
          <h3 className="text-sm font-bold text-rose-900">Call Not Found</h3>
          <p className="text-xs text-rose-700">{error || "The requested call could not be retrieved from storage."}</p>
          <button
            onClick={() => onBackToCustomer(propCompanyId)}
            className="px-4 py-2 bg-white border border-[#E5E7EB] hover:bg-slate-50 text-xs font-bold rounded-lg text-[#0F172A] shadow-3xs transition"
          >
            ← Return to Customer Account
          </button>
        </div>
      </div>
    );
  }

  const { meeting, segments = [], speakers = [], extractions = null, analytics = [], latest_sync_run } = meetingData;
  const companyName = meeting.company_name || "Customer Account";
  const effectiveCompanyId = meeting.company_id || propCompanyId;
  const isSynced = meeting.workflow_state === "synced" || latest_sync_run?.status === "succeeded";

  const aiSnapshot = meeting.ai_snapshot || {};
  const dealIntel = meeting.deal_intelligence || {};
  const actionItems = meeting.action_items || [];
  const objections = meeting.objections || [];
  const risks = meeting.risks || [];

  // Parse Canonical Extractions (Single Source of Truth)
  const extractionObj = Array.isArray(extractions) ? extractions[0] : extractions;
  const extData = typeof extractionObj?.extracted_data === "string"
    ? JSON.parse(extractionObj.extracted_data)
    : (extractionObj?.extracted_data || {});

  const canonicalFields = (Array.isArray(extData.fields) && extData.fields.length > 0)
    ? extData.fields
    : (Array.isArray(extData.template_fields) ? extData.template_fields : []);

  const reviewStates = extData.review?.field_states || {};
  const syncItems = latest_sync_run?.items || [];
  const templateName = meeting.template_used?.toUpperCase() || extData?.profile?.name?.toUpperCase() || "MEDDICC";

  // Dynamic Summary Sections
  const summarySections = (Array.isArray(extData.summary_sections) && extData.summary_sections.length > 0)
    ? extData.summary_sections
    : (Array.isArray(meetingData.summary?.summary_sections) ? meetingData.summary.summary_sections : []);

  const executiveOverview = summarySections.find((s) => s.section_id === "executive_summary")?.content ||
    meetingData.summary?.overview ||
    aiSnapshot.overview ||
    dealIntel.summary ||
    "Discovery conversation focused on evaluating operational pain points, manual reporting friction, and potential pilot milestones.";

  // Helper for Sync Status per field
  const getFieldSyncStatus = (fieldKey, revStatus) => {
    if (revStatus === "rejected") {
      return { status: "excluded", label: "Excluded (Rejected)", badge: "bg-slate-100 text-slate-500 border-slate-200" };
    }
    const matched = syncItems.find((item) => {
      const dest = (item.destination_field || "").toLowerCase();
      const normKey = fieldKey.toLowerCase();
      return (
        dest.includes(normKey) ||
        (normKey === "metrics" && dest === "pulsesync_metrics") ||
        (normKey === "competition" && dest === "pulsesync_competitors") ||
        (normKey === "identify_pain" && dest === "pulsesync_pain_points") ||
        (normKey === "decision_criteria" && dest === "pulsesync_decision_criteria") ||
        (normKey === "decision_process" && dest === "pulsesync_decision_process") ||
        (normKey === "economic_buyer" && dest.includes("economic_buyer"))
      );
    });

    if (matched) {
      const isSuccess = matched.status === "succeeded" || matched.status === "create" || matched.status === "update" || isSynced;
      return {
        status: isSuccess ? "synced" : "pending",
        label: isSuccess ? `Synced (${matched.destination_object || "deal"}.${matched.destination_field})` : "Pending Sync",
        badge: isSuccess ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
      };
    }

    if (isSynced && revStatus === "approved") {
      return { status: "synced", label: "Synced to CRM", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    }

    return { status: "not_eligible", label: "Not Synced", badge: "bg-slate-50 text-slate-400 border-slate-200" };
  };

  // Audio source URL
  const audioSrc = meeting.audio_stream_url
    ? `${API_URL}${meeting.audio_stream_url}`
    : meeting.audio_url
    ? meeting.audio_url.startsWith("http")
      ? meeting.audio_url
      : `${API_URL}${meeting.audio_url}`
    : null;

  // Filter segments
  const filteredSegments = segments.filter((seg) => {
    if (!transcriptSearch.trim()) return true;
    const text = (seg.corrected_text || seg.text || "").toLowerCase();
    const spk = (seg.speaker_name || "").toLowerCase();
    const q = transcriptSearch.toLowerCase();
    return text.includes(q) || spk.includes(q);
  });

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[#F8FAFC] flex flex-col text-left select-none scroll-thin">
      {/* Hidden audio element */}
      {audioSrc && (
        <audio
          ref={audioRef}
          src={audioSrc}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={() => setIsPlaying(false)}
        />
      )}

      {/* ── Top Header Navigation Bar ────────────────────────────────────────── */}
      <header className="bg-white border-b border-[#E5E7EB] px-6 py-3.5 flex-shrink-0 sticky top-0 z-20 shadow-3xs">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Breadcrumb + Back Action */}
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => onBackToCustomer(effectiveCompanyId)}
              className="p-1.5 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F8FAFC] text-[#475569] hover:text-[#0F172A] transition shadow-3xs flex items-center gap-1.5 text-xs font-semibold"
              title={`Back to ${companyName}`}
            >
              <ArrowLeft size={13} />
              <span className="hidden sm:inline">Back to Account</span>
            </button>

            <div className="h-4 w-px bg-[#E2E8F0]" />

            <div className="flex items-center gap-1 text-[11px] font-semibold text-[#64748B] truncate">
              <span
                onClick={() => onBackToCustomer(null)}
                className="hover:text-[#0F172A] cursor-pointer"
              >
                Accounts
              </span>
              <ChevronRight size={11} className="text-[#94A3B8]" />
              <span
                onClick={() => onBackToCustomer(effectiveCompanyId)}
                className="hover:text-[#0F172A] cursor-pointer truncate max-w-[140px]"
              >
                {companyName}
              </span>
              <ChevronRight size={11} className="text-[#94A3B8]" />
              <span className="text-[#0F172A] font-bold truncate max-w-[180px]">
                {meeting.title}
              </span>
            </div>
          </div>

          {/* Workflow Action CTAs */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleReview && handleReview(meeting.id)}
              className="px-3 py-1.5 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#334155] hover:text-[#0F172A] text-xs font-bold rounded-lg shadow-3xs flex items-center gap-1.5 transition"
            >
              <Sliders size={13} className="text-[#14B8A6]" />
              <span>Review / Edit call</span>
            </button>

            <button
              onClick={() => handleSync && handleSync(meeting)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg shadow-3xs flex items-center gap-1.5 transition ${
                isSynced
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                  : "bg-[#14B8A6] hover:bg-[#0F9688] text-white"
              }`}
            >
              {isSynced ? <Lock size={12} /> : <RefreshCw size={12} />}
              <span>{isSynced ? "Synced to CRM" : "Sync to CRM"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Call Identity Strip ──────────────────────────────────────────────── */}
      <section className="bg-white border-b border-[#E5E7EB] px-6 py-4 flex-shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 bg-[#0F172A] text-white rounded text-[10px] font-mono font-bold tracking-tight">
                CALL RECORD
              </span>
              <h1 className="text-lg font-extrabold text-[#0F172A] tracking-tight">
                {meeting.title}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-teal-50 text-teal-700 border border-teal-200">
                {formatCallType(meeting.call_type)}
              </span>
              {isSynced && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                  <Lock size={10} /> Synced (HubSpot)
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs text-[#64748B] font-medium flex-wrap">
              <span className="flex items-center gap-1">
                <Calendar size={12} className="text-[#94A3B8]" />
                {new Date(meeting.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric"
                })}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock size={12} className="text-[#94A3B8]" />
                {duration ? `${Math.floor(duration / 60)} min` : "4 min"}
              </span>
              <span>•</span>
              <span>
                Schema: <strong className="text-[#334155]">{templateName}</strong>
              </span>
              <span>•</span>
              <span>
                Account: <strong className="text-[#0F172A]">{companyName}</strong>
              </span>
            </div>
          </div>

          {/* Audio Player Scrubber Bar */}
          {audioSrc ? (
            <div className="bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl px-4 py-2 flex items-center gap-3 min-w-[320px]">
              <button
                onClick={togglePlay}
                className="h-8 w-8 rounded-lg bg-[#14B8A6] hover:bg-[#0F9688] text-white flex items-center justify-center shadow-3xs transition flex-shrink-0"
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
              </button>

              <div className="flex flex-col flex-grow min-w-0">
                <div className="flex items-center justify-between text-[10px] font-mono text-[#64748B] font-semibold">
                  <span>{formatSeconds(currentTime)}</span>
                  <span>{formatSeconds(duration)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={duration || 100}
                  value={currentTime}
                  onChange={handleScrubberChange}
                  className="w-full h-1 bg-[#E2E8F0] rounded-lg appearance-none cursor-pointer accent-[#14B8A6]"
                />
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={toggleMute}
                  className="p-1 hover:bg-[#E2E8F0] rounded text-[#64748B] transition"
                  title={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </button>
                <button
                  onClick={() => {
                    const rates = [1, 1.25, 1.5, 2];
                    const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
                    changePlaybackRate(next);
                  }}
                  className="px-1.5 py-0.5 text-[9.5px] font-mono font-bold bg-white border border-[#E2E8F0] rounded text-[#475569] hover:text-[#0F172A]"
                >
                  {playbackRate}x
                </button>
              </div>
            </div>
          ) : (
            <div className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-[11px] text-[#64748B] italic">
              Audio recording not available for direct playback
            </div>
          )}
        </div>
      </section>

      {/* ── Main Two-Column Workspace ────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto w-full p-6 flex-grow">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT COLUMN: Call Intelligence, Extracted Facts, Actions & Objections (~60%) */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* 1. Executive Summary & Dynamic Sections */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-4">
              <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-2.5">
                <div className="flex items-center gap-2">
                  <FileText size={15} className="text-[#14B8A6]" />
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#0F172A]">
                    Call Executive Brief & Topics
                  </h3>
                </div>
                <span className="text-[10px] text-[#64748B] font-mono font-bold">
                  Isolated Call Record
                </span>
              </div>

              <p className="text-xs text-[#334155] font-medium leading-relaxed">
                {executiveOverview}
              </p>

              {/* Dynamic Summary Section Evidence */}
              {summarySections.length > 0 && summarySections[0]?.evidence?.length > 0 && (
                <div className="pt-2 border-t border-[#F8FAFC] space-y-2">
                  <span className="text-[9.5px] font-bold text-[#94A3B8] uppercase tracking-wider block">
                    Grounded Summary Evidence
                  </span>
                  <div className="space-y-1.5">
                    {summarySections[0].evidence.map((ev, i) => {
                      const startTime = Number(ev.start_time || 0);
                      return (
                        <div
                          key={i}
                          onClick={() => startTime && seekTo(startTime)}
                          className="p-2 rounded border border-[#E2E8F0] bg-[#FAFBFB] text-[10.5px] text-[#475569] italic cursor-pointer hover:border-[#14B8A6] transition flex items-start justify-between gap-2"
                          title="Click to seek audio to this quote"
                        >
                          <span>
                            <strong className="text-[#0F766E] not-italic mr-1">{ev.speaker || "Speaker"}:</strong>
                            "{ev.quote}"
                          </span>
                          {startTime > 0 && (
                            <span className="text-[9px] font-mono font-bold text-[#14B8A6] flex-shrink-0 flex items-center gap-0.5 not-italic">
                              <Play size={8} /> {formatSeconds(startTime)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Signals from Conversation Intelligence */}
              {extData?.conversation_intelligence?.signals && (
                <div className="pt-2 border-t border-[#F8FAFC] space-y-2">
                  <span className="text-[9.5px] font-bold text-[#94A3B8] uppercase tracking-wider block">
                    Key Topics Covered
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {extData.conversation_intelligence.signals.main_topics?.map((topic, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F1F5F9] text-[#334155]"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 2. Canonical Call-Specific Playbook Extraction (Single Source of Truth) */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-4">
              <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-2.5">
                <div className="flex items-center gap-2">
                  <Sparkles size={15} className="text-[#14B8A6]" />
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#0F172A]">
                    Extracted Playbook Parameters ({templateName})
                  </h3>
                </div>
                <span className="text-[10px] text-[#64748B] font-semibold">
                  Source: Canonical Call Extraction
                </span>
              </div>

              {canonicalFields.length === 0 ? (
                <div className="py-6 text-center text-xs text-[#94A3B8] italic">
                  No playbook parameters extracted for this call yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {canonicalFields.map((field, idx) => {
                    const fKey = field.field_id || field.id || field.fieldKey || `field_${idx}`;
                    const fName = field.field_name || field.name || field.field || fKey;
                    const rawVal = field.value;
                    const hasVal = rawVal !== null &&
                      rawVal !== undefined &&
                      String(rawVal).trim() !== "" &&
                      String(rawVal).toLowerCase() !== "not mentioned" &&
                      String(rawVal).toLowerCase() !== "null" &&
                      rawVal !== "—";

                    const persistedStatus = reviewStates[fKey]?.status || field.review_status || field.status;
                    const revStatus = ["approved", "rejected", "needs_review"].includes(String(persistedStatus || "").toLowerCase())
                      ? String(persistedStatus).toLowerCase()
                      : (hasVal ? "needs_review" : "not_mentioned");

                    const syncStatusObj = getFieldSyncStatus(fKey, revStatus);
                    const evidenceList = Array.isArray(field.evidence) ? field.evidence : [];

                    // Explicit metrics vs budget distinction callout
                    const isMetrics = fKey.toLowerCase() === "metrics";
                    // Past target timeline detection
                    const isPastTimeline = field.qualification === 'past_target_requires_reconfirmation' || Boolean(field.qualification_note);

                    return (
                      <div
                        key={fKey}
                        className="p-3.5 rounded-lg border border-[#F1F5F9] bg-[#FAFBFB] flex flex-col gap-2 hover:border-[#E2E8F0] transition"
                      >
                        {/* Field Header: Name + Badges */}
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-[#0F172A]">{fName}</span>
                            {isMetrics && (
                              <span className="text-[9.5px] text-[#64748B] font-medium">
                                Operational Impact & Lost Time (distinct from monetary budget)
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* Confidence Score */}
                            {field.confidence && (
                              <span className="text-[10px] font-mono text-[#64748B] font-semibold">
                                {Math.round(Number(field.confidence) * 100)}% conf
                              </span>
                            )}

                            {/* Extraction Status */}
                            <span
                              className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase font-mono ${
                                hasVal
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-slate-100 text-slate-500 border border-slate-200"
                              }`}
                            >
                              {hasVal ? "Extracted" : "Not Mentioned"}
                            </span>

                            {/* Review Status */}
                            <span
                              className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase font-mono ${
                                revStatus === "approved"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : revStatus === "rejected"
                                  ? "bg-rose-50 text-rose-700 border border-rose-200"
                                  : "bg-amber-50 text-amber-700 border border-amber-200"
                              }`}
                            >
                              {revStatus === "approved" ? "Approved" : revStatus === "rejected" ? "Rejected" : "Needs Review"}
                            </span>

                            {/* Destination Sync Status */}
                            <span
                              className={`px-2 py-0.5 rounded-full text-[9px] font-bold font-mono border ${syncStatusObj.badge}`}
                            >
                              {syncStatusObj.label}
                            </span>
                          </div>
                        </div>

                        {/* Extracted Value */}
                        <div className="text-xs font-semibold text-[#1E293B] bg-white p-2.5 rounded border border-[#E2E8F0]">
                          {hasVal ? (
                            <span>{String(rawVal)}</span>
                          ) : (
                            <span className="text-[#94A3B8] italic font-normal">
                              Not identified in this call record
                            </span>
                          )}
                        </div>

                        {/* Past-Due Target Warning for Timeline */}
                        {isPastTimeline && (
                          <div className="p-2 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[10.5px] flex items-center gap-1.5">
                            <AlertCircle size={13} className="text-amber-600 flex-shrink-0" />
                            <span>
                              <strong>Past-Target Warning:</strong> {field.qualification_note || "Target date precedes call date; timeline requires active reconfirmation."}
                            </span>
                          </div>
                        )}

                        {/* Genuine Transcript Evidence with Interactive Audio Seek */}
                        {evidenceList.length > 0 ? (
                          <div className="space-y-1.5 mt-0.5">
                            {evidenceList.map((ev, evIdx) => {
                              const startTime = Number(ev.start_time || ev.timestampSecs || 0);
                              return (
                                <div
                                  key={evIdx}
                                  onClick={() => startTime && seekTo(startTime)}
                                  className="text-[10.5px] text-[#475569] italic bg-white p-2 rounded border border-[#E2E8F0] cursor-pointer hover:border-[#14B8A6] hover:bg-teal-50/20 transition flex items-start justify-between gap-2"
                                  title="Click to seek audio to this transcript evidence"
                                >
                                  <span>
                                    {ev.speaker && <strong className="text-[#0F766E] not-italic mr-1">{ev.speaker}:</strong>}
                                    "{ev.quote}"
                                  </span>
                                  {startTime > 0 && (
                                    <span className="text-[9px] font-mono font-bold text-[#14B8A6] flex-shrink-0 flex items-center gap-0.5 not-italic bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded">
                                      <Play size={8} /> {formatSeconds(startTime)}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : hasVal ? (
                          <span className="text-[10px] text-[#94A3B8] italic">
                            No transcript segment cited for this parameter.
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 3. Action Items Extracted in This Session (Deduplicated with Accurate Attribution) */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-3">
              <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-[#14B8A6]" />
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#0F172A]">
                    Extracted Action Items & Commitments ({actionItems.length})
                  </h3>
                </div>
                <span className="text-[10px] text-[#64748B] font-mono font-semibold">
                  Origin: Call Dialogue
                </span>
              </div>

              {actionItems.length === 0 ? (
                <span className="text-xs text-[#94A3B8] italic block py-4 text-center">
                  No action items extracted from this call.
                </span>
              ) : (
                <div className="space-y-2">
                  {actionItems.map((item, idx) => {
                    const task = typeof item === "object" ? item.task : item;
                    const owner = typeof item === "object" ? item.owner : "Unassigned";
                    const isBuyer = item.commitment_type === "buyer_commitment" || item.owner_role === "buyer" || /buyer|prospect|client|customer/i.test(owner);

                    return (
                      <div
                        key={idx}
                        className="p-3 bg-[#FAFBFB] border border-[#E5E7EB] rounded-lg text-xs flex flex-col gap-1.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-bold text-[#0F172A]">{task}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase font-mono flex-shrink-0 border ${
                              isBuyer
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : "bg-teal-50 text-teal-700 border-teal-200"
                            }`}
                          >
                            {isBuyer ? "Customer Commitment (Buyer)" : "Our Commitment (Sales Rep)"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-[#64748B] font-semibold">
                          <span>
                            Owner: <strong className="text-[#334155]">{owner}</strong>
                          </span>
                          {item.deadline && (
                            <span>
                              Due: <strong className="text-[#0F172A]">{item.deadline}</strong>
                            </span>
                          )}
                        </div>

                        {item.evidence && (
                          <div className="text-[10px] text-[#64748B] italic border-t border-[#F1F5F9] pt-1">
                            Evidence: "{item.evidence}"
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 4. Objections & Risks */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-3">
              <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-2.5">
                <div className="flex items-center gap-2">
                  <AlertCircle size={15} className="text-amber-600" />
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#0F172A]">
                    Objections & Deal Risks
                  </h3>
                </div>
                <span className="text-[10px] text-[#64748B] font-mono">
                  {objections.length} objections • {risks.length} risks
                </span>
              </div>

              {objections.length === 0 && risks.length === 0 ? (
                <span className="text-xs text-[#94A3B8] italic block py-4 text-center">
                  No objections or risks registered in this call record.
                </span>
              ) : (
                <div className="space-y-2">
                  {objections.map((obj, i) => (
                    <div
                      key={i}
                      className="p-3 bg-amber-50/50 border border-amber-200 rounded-lg text-xs flex flex-col gap-1 text-amber-900"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold">Objection: "{obj.objection}"</span>
                        <span className="text-[9px] font-mono font-bold bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200">
                          Concern
                        </span>
                      </div>
                      {obj.evidence && (
                        <p className="text-[10.5px] text-amber-800 italic mt-0.5">
                          "{obj.evidence}"
                        </p>
                      )}
                    </div>
                  ))}

                  {risks.map((r, i) => (
                    <div
                      key={i}
                      className="p-3 bg-rose-50/50 border border-rose-200 rounded-lg text-xs flex flex-col gap-1 text-rose-900"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold">Risk: {typeof r === "object" ? r.risk : r}</span>
                        <span className="text-[9px] font-mono font-bold bg-rose-100 px-1.5 py-0.5 rounded border border-rose-200">
                          Critical
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 5. Speaker Analytics */}
            {analytics.length > 0 && (
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-3">
                <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-2.5">
                  <div className="flex items-center gap-2">
                    <TrendingUp size={15} className="text-[#14B8A6]" />
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#0F172A]">
                      Speaker Talk-Time & Participation
                    </h3>
                  </div>
                  <span className="text-[10px] text-[#64748B] font-mono">Acoustic Diarization</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {analytics.map((spk, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-[#FAFBFB] border border-[#E5E7EB] rounded-lg text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[#0F172A]">{spk.speaker_name}</span>
                        <span className="text-[10px] font-mono font-bold text-[#14B8A6]">
                          {spk.participation_percentage}%
                        </span>
                      </div>
                      <div className="w-full bg-[#E2E8F0] h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-[#14B8A6] h-full"
                          style={{ width: `${spk.participation_percentage}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-[#64748B] font-mono pt-1">
                        <span>Talk time: {Math.floor(spk.talk_time_seconds / 60)}m</span>
                        <span>{spk.words_per_minute || 150} WPM</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* RIGHT COLUMN: Interactive Diarized Transcript Explorer (~40%) */}
          <div className="lg:col-span-5 bg-white border border-[#E5E7EB] rounded-xl shadow-3xs flex flex-col h-[750px] overflow-hidden sticky top-20">
            {/* Header */}
            <div className="p-4 border-b border-[#F1F5F9] bg-[#FAFBFB] flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-xs font-bold text-[#0F172A] uppercase tracking-wide">
                  Interactive Transcript
                </h3>
                <span className="text-[10px] text-[#64748B] font-semibold">
                  {filteredSegments.length} segments • Click segment to seek audio
                </span>
              </div>
              <span className="px-2 py-0.5 rounded text-[9.5px] font-mono font-bold bg-[#E2E8F0] text-[#475569]">
                Diarized
              </span>
            </div>

            {/* Search Input */}
            <div className="p-3 border-b border-[#F1F5F9] bg-white flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 text-[#94A3B8]" size={13} />
                <input
                  type="text"
                  placeholder="Search keywords in this call..."
                  value={transcriptSearch}
                  onChange={(e) => setTranscriptSearch(e.target.value)}
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-md pl-8 pr-3 py-1.5 text-xs text-[#0F172A] outline-none focus:border-[#14B8A6] transition"
                />
              </div>
            </div>

            {/* Segments Stream */}
            <div className="flex-grow overflow-y-auto p-4 bg-[#FAFBFB] space-y-3 scroll-thin">
              {filteredSegments.length === 0 ? (
                <div className="py-16 text-center text-xs text-[#94A3B8] italic">
                  No transcript segments found matching query.
                </div>
              ) : (
                filteredSegments.map((seg, idx) => {
                  const startTime = Number(seg.start_time || 0);
                  const isCurrent = currentTime >= startTime && currentTime < Number(seg.end_time || startTime + 5);

                  return (
                    <div
                      key={seg.id || idx}
                      onClick={() => seekTo(startTime)}
                      className={`p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                        isCurrent
                          ? "bg-teal-50/70 border-[#14B8A6] shadow-3xs"
                          : "bg-white border-[#E2E8F0] hover:border-[#14B8A6]/40 shadow-2xs"
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-bold text-[#64748B] mb-1">
                        <span className="text-[#0F766E] flex items-center gap-1">
                          <User size={10} />
                          {seg.speaker_name || "Speaker"}
                        </span>
                        <span className="font-mono text-[#94A3B8] flex items-center gap-1">
                          {isCurrent && <span className="h-1.5 w-1.5 rounded-full bg-[#14B8A6] animate-ping" />}
                          {formatSeconds(startTime)}
                        </span>
                      </div>
                      <p className="text-[#334155] leading-relaxed font-medium">
                        {seg.corrected_text || seg.text}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

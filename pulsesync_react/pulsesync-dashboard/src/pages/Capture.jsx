import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Globe,
  Layers,
  Link2,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Users,
  Video,
  X,
  XCircle,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const PROVIDER_METADATA = {
  google_meet: {
    label: "Google Meet",
    icon: Video,
    placeholder: "https://meet.google.com/abc-defg-hij",
    badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
    docsUrl: "https://developers.google.com/meet/api/guides/overview",
  },
  zoom: {
    label: "Zoom",
    icon: Video,
    placeholder: "https://zoom.us/j/1234567890?pwd=abc",
    badgeColor: "bg-blue-50 text-blue-700 border-blue-200",
    docsUrl: "https://developers.zoom.us/docs/meeting-sdk/",
  },
  microsoft_teams: {
    label: "Microsoft Teams",
    icon: Video,
    placeholder: "https://teams.microsoft.com/l/meetup-join/...",
    badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    docsUrl: "https://learn.microsoft.com/en-us/graph/cloud-communication-concept-overview",
  },
};

const STATUS_BADGES = {
  SCHEDULED: { label: "Scheduled", class: "bg-blue-50 text-blue-700 border-blue-200", pulse: false },
  WAITING_FOR_MEETING: { label: "Awaiting Start", class: "bg-amber-50 text-amber-700 border-amber-200", pulse: true },
  JOINING: { label: "Knocking on Meeting...", class: "bg-indigo-50 text-indigo-700 border-indigo-200", pulse: true },
  WAITING_ROOM: { label: "In Waiting Room (Admit Bot)", class: "bg-amber-100 text-amber-800 border-amber-300 font-bold", pulse: true },
  JOINED: { label: "Admitted / In Call", class: "bg-emerald-50 text-emerald-700 border-emerald-200", pulse: false },
  CAPTURING: { label: "Capturing Audio", class: "bg-emerald-100 text-emerald-800 border-emerald-300", pulse: true },
  PROCESSING: { label: "Normalizing Audio", class: "bg-purple-50 text-purple-700 border-purple-200", pulse: true },
  TRANSCRIBING: { label: "Transcribing (STT)", class: "bg-purple-50 text-purple-700 border-purple-200", pulse: true },
  ATTRIBUTING_SPEAKERS: { label: "Attributing Speakers", class: "bg-indigo-50 text-indigo-700 border-indigo-200", pulse: true },
  DIARIZING: { label: "Cross-Validating Diarization", class: "bg-purple-50 text-purple-700 border-purple-200", pulse: true },
  EXTRACTING: { label: "Synthesizing Insights", class: "bg-purple-100 text-purple-800 border-purple-300", pulse: true },
  READY_FOR_REVIEW: { label: "Ready for Review", class: "bg-emerald-50 text-emerald-700 border-emerald-200", pulse: false },
  SYNCED: { label: "Synced to CRM", class: "bg-slate-100 text-slate-800 border-slate-300", pulse: false },
  JOIN_FAILED: { label: "Join Failed", class: "bg-rose-50 text-rose-700 border-rose-200", pulse: false },
  AUTH_FAILED: { label: "Auth Failed", class: "bg-rose-50 text-rose-700 border-rose-200", pulse: false },
  CONSENT_FAILED: { label: "Consent Missing", class: "bg-rose-50 text-rose-700 border-rose-200", pulse: false },
  MEDIA_FAILED: { label: "Media Failed", class: "bg-rose-50 text-rose-700 border-rose-200", pulse: false },
  TRANSCRIPTION_FAILED: { label: "Transcription Error", class: "bg-rose-50 text-rose-700 border-rose-200", pulse: false },
  ATTRIBUTION_FAILED: { label: "Attribution Error", class: "bg-rose-50 text-rose-700 border-rose-200", pulse: false },
  DIARIZATION_FAILED: { label: "Diarization Error", class: "bg-rose-50 text-rose-700 border-rose-200", pulse: false },
  EXTRACTION_FAILED: { label: "Extraction Error", class: "bg-rose-50 text-rose-700 border-rose-200", pulse: false },
  CRM_SYNC_FAILED: { label: "CRM Sync Error", class: "bg-rose-50 text-rose-700 border-rose-200", pulse: false },
  PROCESSING_FAILED: { label: "Processing Error", class: "bg-rose-50 text-rose-700 border-rose-200", pulse: false },
  PROVIDER_ERROR: { label: "Provider Error", class: "bg-rose-50 text-rose-700 border-rose-200", pulse: false },
  CANCELLED: { label: "Cancelled", class: "bg-slate-100 text-slate-500 border-slate-200", pulse: false },
};

function formatTimestamp(isoString) {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return isoString;
  }
}

// ── Activity / Debug Log Modal ───────────────────────────────────────────────
function ActivityLogModal({ job, onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = useCallback(async () => {
    if (!job?.id) return;
    try {
      const res = await fetch(`${API_URL}/api/meeting-bots/${job.id}/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error("Failed to load logs", err);
    } finally {
      setLoading(false);
    }
  }, [job?.id]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 2500);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
              <Terminal size={18} />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Bot Activity & Debug Logs</h3>
              <p className="text-xs text-slate-500">{job.meeting_title || "Meeting Session"} · ID: {job.id.slice(0, 8)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh(v => !v)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                autoRefresh ? "bg-indigo-50 text-indigo-600 border border-indigo-200" : "bg-slate-100 text-slate-600"
              }`}
            >
              {autoRefresh ? "Live polling ON" : "Polling paused"}
            </button>
            <button onClick={fetchLogs} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <RefreshCw size={16} />
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Log body */}
        <div className="flex-1 overflow-y-auto p-6 font-mono text-xs">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 size={20} className="animate-spin mr-2" /> Loading activity logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-slate-400">
              No activity logs recorded yet. Events will appear as the worker executes.
            </div>
          ) : (
            <div className="space-y-3">
              {logs.map((entry, idx) => {
                const isError = entry.level === "error";
                const isWarn = entry.level === "warn";
                return (
                  <div
                    key={entry.id || idx}
                    className={`flex items-start gap-3 rounded-xl border p-3 ${
                      isError
                        ? "border-rose-200 bg-rose-50/50 text-rose-900"
                        : isWarn
                        ? "border-amber-200 bg-amber-50/50 text-amber-900"
                        : "border-slate-100 bg-slate-50 text-slate-800"
                    }`}
                  >
                    <span className="shrink-0 text-[11px] font-semibold text-slate-400">
                      {formatTimestamp(entry.created_at)}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        isError
                          ? "bg-rose-200/80 text-rose-800"
                          : isWarn
                          ? "bg-amber-200/80 text-amber-800"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {entry.stage}
                    </span>
                    <p className="flex-1 leading-relaxed break-words font-sans text-xs">{entry.message}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 bg-slate-50 rounded-b-2xl text-xs text-slate-500">
          <span>Total events: {logs.length}</span>
          <button
            onClick={onClose}
            className="rounded-lg bg-white border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Live Participant Attribution Modal ───────────────────────────────────────
function ParticipantsModal({ job, onClose }) {
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!job?.id) return;
    fetch(`${API_URL}/api/meeting-bots/${job.id}/participants`)
      .then((r) => r.json())
      .then((data) => {
        setParticipants(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load participants", err);
        setLoading(false);
      });
  }, [job?.id]);

  const getSourceBadge = (source) => {
    switch (source) {
      case "google_meet_csrc":
        return <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">Meet CSRC (RTP)</span>;
      case "zoom_user_id":
        return <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">Zoom RTMS</span>;
      case "teams_participant":
        return <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800">Teams Calling Bot</span>;
      case "platform_transcript":
        return <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-800">Platform Captions</span>;
      case "manual":
        return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">Manual Override</span>;
      default:
        return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">{source || "Platform Native"}</span>;
    }
  };

  const getRoleBadge = (role) => {
    switch (role) {
      case "sales_rep":
        return <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[11px] font-semibold text-blue-700">Sales Rep</span>;
      case "buyer":
        return <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Buyer</span>;
      case "prospect":
        return <span className="rounded-full bg-cyan-50 border border-cyan-200 px-2 py-0.5 text-[11px] font-semibold text-cyan-700">Prospect</span>;
      case "customer":
        return <span className="rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">Customer</span>;
      case "bot":
        return <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Bot Assistant</span>;
      default:
        return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{role || "Unknown"}</span>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <Users size={18} />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Platform-Native Participant Attribution</h3>
              <p className="text-xs text-slate-500">
                {job?.meeting_title} • {participants.length} participants identified
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-xs text-slate-400">
              <Loader2 size={20} className="animate-spin mr-2" /> Resolving platform identities...
            </div>
          ) : participants.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-slate-400 text-xs">
              No participants attributed yet. Attribution runs in real time when the meeting begins.
            </div>
          ) : (
            <div className="space-y-3">
              {participants.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
                      {p.display_name ? p.display_name.charAt(0).toUpperCase() : "P"}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{p.display_name}</span>
                        {p.organization && (
                          <span className="text-xs text-slate-500 font-medium">({p.organization})</span>
                        )}
                        {p.is_host && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.2 text-[10px] font-bold text-amber-800">Host</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {p.email || `ID: ${p.platform_participant_id}`}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    {getRoleBadge(p.role)}
                    {getSourceBadge(p.identity_source)}
                    <span className="rounded bg-slate-200/70 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                      {Math.round((p.identity_confidence || 1.0) * 100)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 bg-slate-50 rounded-b-2xl text-xs text-slate-500">
          <span>Primary: Platform-Native Metadata • Fallback: ML Diarization</span>
          <button
            onClick={onClose}
            className="rounded-lg bg-white border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Capture Page ────────────────────────────────────────────────────────
export default function Capture() {
  // Capture method tabs: 'bot' or 'extension'
  const [activeCaptureTab, setActiveCaptureTab] = useState("bot");

  // Form state
  const [provider, setProvider] = useState("google_meet");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [title, setTitle] = useState("");
  const [botMode, setBotMode] = useState("realtime");
  const [botName, setBotName] = useState("PulseSync AI");
  const [scheduleType, setScheduleType] = useState("now"); // 'now' or 'later'
  const [scheduledDate, setScheduledDate] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  // URL Auto-detection status
  const [detectedProvider, setDetectedProvider] = useState(null);
  const [isUrlValid, setIsUrlValid] = useState(null);

  // Data & Jobs state
  const [botJobs, setBotJobs] = useState([]);
  const [providersInfo, setProvidersInfo] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [scheduling, setScheduling] = useState(false);
  const [message, setMessage] = useState(null);

  // Debug Log modal
  const [selectedLogJob, setSelectedLogJob] = useState(null);
  const [selectedParticipantsJob, setSelectedParticipantsJob] = useState(null);

  // URL Auto-Detection Effect
  useEffect(() => {
    if (!meetingUrl.trim()) {
      setDetectedProvider(null);
      setIsUrlValid(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/meeting-providers/detect-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: meetingUrl.trim() }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.valid && data.provider) {
            setDetectedProvider(data.provider);
            setProvider(data.provider);
            setIsUrlValid(true);
          } else {
            setDetectedProvider(null);
            setIsUrlValid(false);
          }
        }
      } catch (err) {
        console.error("Error detecting provider", err);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [meetingUrl]);

  // Load provider capabilities
  const loadProviders = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/meeting-providers`);
      if (res.ok) {
        setProvidersInfo(await res.json());
      }
    } catch (err) {
      console.error("Failed to load providers", err);
    }
  }, []);

  // Load bot jobs list
  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const res = await fetch(`${API_URL}/api/meeting-bots`);
      if (res.ok) {
        const data = await res.json();
        setBotJobs(data);
      }
    } catch (err) {
      console.error("Failed to load bot jobs", err);
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    loadProviders();
    loadJobs();
  }, [loadProviders, loadJobs]);

  // Periodic polling for active job status updates with proper cleanup
  useEffect(() => {
    const hasActiveJobs = botJobs.some(j => {
      const statusUpper = String(j.status || '').toUpperCase();
      return !['READY_FOR_REVIEW', 'SYNCED', 'CANCELLED', 'JOIN_FAILED', 'AUTH_FAILED', 'PROCESSING_FAILED'].includes(statusUpper);
    });

    if (!hasActiveJobs) return;

    const interval = setInterval(loadJobs, 3000);
    return () => clearInterval(interval);
  }, [botJobs, loadJobs]);

  const selectedMeta = PROVIDER_METADATA[provider] || PROVIDER_METADATA.google_meet;
  const currentProviderInfo = providersInfo.find(p => p.provider === provider);

  // Handle Form Submit
  const handleScheduleBot = async (e) => {
    e.preventDefault();
    setMessage(null);

    if (!consentConfirmed) {
      setMessage({
        type: "error",
        text: "Participant consent confirmation is required before scheduling a meeting bot.",
      });
      return;
    }

    setScheduling(true);

    try {
      const scheduledStart = scheduleType === "later" && scheduledDate
        ? new Date(scheduledDate).toISOString()
        : new Date().toISOString();

      const response = await fetch(`${API_URL}/api/meeting-bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          meeting_url: meetingUrl.trim(),
          meeting_title: title.trim() || `${selectedMeta.label} Discovery Call`,
          mode: botMode,
          bot_participant_name: botName.trim() || "PulseSync AI",
          consent_state: "granted",
          scheduled_start: scheduledStart,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || "Failed to schedule meeting bot.");
      }

      const scheduledUrl = meetingUrl.trim();
      setMessage({
        type: "success",
        text: `Meeting bot scheduled for ${selectedMeta.label}. The bot is opening Chrome to knock on your meeting. Remember to click [Admit] in your meeting window!`,
        meetingUrl: scheduledUrl,
      });
      setMeetingUrl("");
      setTitle("");
      await loadJobs();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setScheduling(false);
    }
  };

  // Cancel Job Action
  const handleCancel = async (jobId) => {
    try {
      const res = await fetch(`${API_URL}/api/meeting-bots/${jobId}/cancel`, { method: "POST" });
      if (res.ok) await loadJobs();
    } catch (err) {
      console.error("Cancel failed", err);
    }
  };

  // Retry Job Action
  const handleRetry = async (jobId) => {
    try {
      const res = await fetch(`${API_URL}/api/meeting-bots/${jobId}/retry`, { method: "POST" });
      if (res.ok) await loadJobs();
    } catch (err) {
      console.error("Retry failed", err);
    }
  };

  return (
    <div className="mx-auto max-w-[1300px] p-7 space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-indigo-600 border border-indigo-100">
            Multi-Platform Conversation Capture
          </span>
          {currentProviderInfo?.status === "mock" && (
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
              Dev / Mock Mode Active
            </span>
          )}
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
          Capture Online Meetings
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          PulseSync supports two unified capture methods: an in-browser Chrome Extension and autonomous Meeting Bots for Google Meet, Zoom, and Microsoft Teams. Both converge directly on the same speech transcription, speaker diarization, AI extraction, and CRM sync pipeline.
        </p>
      </div>

      {/* Dual Capture Methods Cards */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Method A: Chrome Extension */}
        <div
          onClick={() => setActiveCaptureTab("extension")}
          className={`cursor-pointer rounded-2xl border p-6 transition-all shadow-sm ${
            activeCaptureTab === "extension"
              ? "border-indigo-600 bg-indigo-50/20 ring-2 ring-indigo-500/20"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <Globe size={22} />
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              Capture Method A
            </span>
          </div>
          <h2 className="mt-5 text-lg font-semibold text-slate-900">Chrome Browser Extension</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Capture meetings directly from your browser tab without adding a participant to the call. Ideal for rep-controlled local sessions.
          </p>
          <div className="mt-4 space-y-2 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
              <span>Deterministic local rep vs meeting audio separation</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
              <span>Zero external bot participant in the meeting</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
              <span>Instantly uploads into the shared PulseSync AI pipeline</span>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.open("http://localhost:5173", "_blank");
            }}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition"
          >
            Launch Browser Capture <ExternalLink size={14} />
          </button>
        </div>

        {/* Method B: Meeting Bot */}
        <div
          onClick={() => setActiveCaptureTab("bot")}
          className={`cursor-pointer rounded-2xl border p-6 transition-all shadow-sm ${
            activeCaptureTab === "bot"
              ? "border-indigo-600 bg-indigo-50/20 ring-2 ring-indigo-500/20"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Bot size={22} />
            </div>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 border border-indigo-100">
              Capture Method B
            </span>
          </div>
          <h2 className="mt-5 text-lg font-semibold text-slate-900">Autonomous Meeting Bot</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            PulseSync deploys an AI participant that joins your Google Meet, Zoom, or Microsoft Teams calls autonomously to capture the conversation.
          </p>
          <div className="mt-4 space-y-2 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-indigo-600 shrink-0" />
              <span>Supports Google Meet, Zoom, and Microsoft Teams</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-indigo-600 shrink-0" />
              <span>Real-Time participant join or Post-Meeting artifact ingestion</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-indigo-600 shrink-0" />
              <span>Feeds directly into Customer Intelligence and CRM Sync</span>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActiveCaptureTab("bot");
            }}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 transition"
          >
            Configure Meeting Bot <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Main Form & Job Management Section */}
      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Left: Schedule Form */}
        <form onSubmit={handleScheduleBot} className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <div className="flex items-start gap-3 border-b border-slate-100 pb-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Link2 size={20} />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Schedule Meeting Bot</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure provider, meeting URL, and participant consent.
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            {/* Platform Selection */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Meeting Platform
              </label>
              <div className="mt-2 grid grid-cols-3 gap-3">
                {Object.entries(PROVIDER_METADATA).map(([key, meta]) => {
                  const isSelected = provider === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setProvider(key)}
                      className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center transition ${
                        isSelected
                          ? "border-indigo-600 bg-indigo-50/40 text-indigo-700 font-semibold"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      <meta.icon size={18} />
                      <span className="text-xs">{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Meeting URL Input with live Auto-detection */}
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Meeting URL
                </label>
                {meetingUrl && (
                  <span className="text-xs font-medium">
                    {isUrlValid ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                        <Check size={13} /> {selectedMeta.label} Valid
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-500 font-medium">
                        <XCircle size={13} /> Unsupported URL
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="relative mt-2">
                <input
                  required
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  placeholder={selectedMeta.placeholder}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                Paste any Google Meet, Zoom, or Teams URL. Provider will be auto-detected.
              </p>
            </div>

            {/* Meeting Title & Bot Name */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Meeting Title
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Northstar Discovery Call"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Bot Participant Name
                </label>
                <input
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  placeholder="PulseSync AI"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            </div>

            {/* Bot Mode & Scheduled Timing */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Bot Operating Mode
                </label>
                <select
                  value={botMode}
                  onChange={(e) => setBotMode(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-500 font-medium text-slate-800"
                >
                  <option value="realtime">Real Browser Bot (Joins your actual meeting)</option>
                  <option value="mock">Simulation Mode (Offline test simulation)</option>
                  <option value="post_meeting_artifact">Post-Meeting Artifact Ingestion</option>
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  {botMode === "realtime"
                    ? "Launches an automated Chrome participant to physically knock on your meeting and capture live audio."
                    : botMode === "mock"
                    ? "Simulates bot lifecycle offline with sample audio without opening an actual meeting."
                    : "Monitors and imports recording artifacts after call concludes."}
                </p>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Join Timing
                </label>
                <select
                  value={scheduleType}
                  onChange={(e) => setScheduleType(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-500"
                >
                  <option value="now">Join Immediately / On Meeting Start</option>
                  <option value="later">Schedule for Later Datetime</option>
                </select>
              </div>
            </div>

            {scheduleType === "later" && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Scheduled Start Time
                </label>
                <input
                  type="datetime-local"
                  required
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-indigo-500"
                />
              </div>
            )}

            {/* Consent Checkbox */}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentConfirmed}
                  onChange={(e) => setConsentConfirmed(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="text-xs leading-relaxed text-slate-700">
                  <span className="font-semibold text-slate-900 block">
                    Participant Recording Consent
                  </span>
                  I confirm that all meeting attendees have been informed and consented to PulseSync joining as an AI meeting assistant for conversation transcription and intelligence.
                </div>
              </label>
            </div>

            {/* Provider Capability Notice */}
            {currentProviderInfo && (
              <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-slate-500" />
                <div className="leading-relaxed">
                  <span className="font-semibold text-slate-800">
                    {currentProviderInfo.label} Configuration:
                  </span>{" "}
                  {currentProviderInfo.message}
                </div>
              </div>
            )}

            {message && (
              <div
                className={`flex items-start justify-between gap-3 rounded-xl p-3 text-xs ${
                  message.type === "success"
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                    : "bg-rose-50 text-rose-800 border border-rose-200"
                }`}
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  {message.type === "success" ? (
                    <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-emerald-600" />
                  ) : (
                    <AlertTriangle size={16} className="shrink-0 mt-0.5 text-rose-600" />
                  )}
                  <span className="leading-relaxed">{message.text}</span>
                </div>
                {message.meetingUrl && (
                  <button
                    type="button"
                    onClick={() => window.open(message.meetingUrl, '_blank')}
                    className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 transition flex items-center gap-1 shadow-sm"
                  >
                    Open Meeting <ExternalLink size={12} />
                  </button>
                )}
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={scheduling}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {scheduling ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Scheduling Bot Job...
                </>
              ) : (
                <>
                  <Bot size={16} />
                  Schedule Meeting Bot
                </>
              )}
            </button>
          </div>
        </form>

        {/* Right: Upcoming & Recent Bot Jobs */}
        <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 className="font-semibold text-slate-900">Active & Upcoming Bot Jobs</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time execution status and activity history.
              </p>
            </div>
            <button
              onClick={loadJobs}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw size={13} /> Refresh
            </button>
          </div>

          <div className="mt-5 flex-1 space-y-3.5 overflow-y-auto max-h-[620px] pr-1">
            {loadingJobs && botJobs.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-xs text-slate-400">
                <Loader2 size={18} className="animate-spin mr-2" /> Loading meeting bot jobs...
              </div>
            ) : botJobs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400">
                No meeting bot jobs created yet. Schedule your first bot using the form.
              </div>
            ) : (
              botJobs.map((job) => {
                const pMeta = PROVIDER_METADATA[job.provider] || { label: job.provider, badgeColor: "bg-slate-100 text-slate-700" };
                const sMeta = STATUS_BADGES[job.status] || { label: job.status, class: "bg-slate-100 text-slate-700", pulse: false };
                const isFailed = String(job.status || '').endsWith('_FAILED') || job.status === 'PROVIDER_ERROR';
                const isReady = job.status === 'READY_FOR_REVIEW' || job.status === 'SYNCED';
                const isCancellable = ['SCHEDULED', 'WAITING_FOR_MEETING', 'JOINING', 'WAITING_ROOM', 'CAPTURING'].includes(job.status);

                return (
                  <div
                    key={job.id}
                    className="rounded-xl border border-slate-200 p-4 transition hover:border-slate-300"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${pMeta.badgeColor}`}>
                            {pMeta.label}
                          </span>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 uppercase tracking-wider">
                            {job.mode === 'post_meeting_artifact' ? 'Artifact Import' : 'Real-Time Bot'}
                          </span>
                        </div>
                        <h3 className="mt-2 truncate text-sm font-semibold text-slate-900">
                          {job.meeting_title || "Meeting Session"}
                        </h3>
                        <p className="mt-0.5 truncate text-xs text-slate-400">
                          {job.meeting_url}
                        </p>
                      </div>

                      {/* Status Badge */}
                      <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${sMeta.class}`}>
                        {sMeta.pulse && (
                          <span className="h-1.5 w-1.5 rounded-full bg-current animate-ping" />
                        )}
                        {sMeta.label}
                      </span>
                    </div>

                    {/* Prominent Waiting Room Callout Banner */}
                    {job.status === 'WAITING_ROOM' && (
                      <div className="mt-3.5 rounded-xl border border-amber-300 bg-amber-50/90 p-3 text-xs text-amber-900 flex items-center justify-between gap-3 shadow-sm animate-pulse">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="relative flex h-3 w-3 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                          </span>
                          <div className="leading-snug">
                            <strong className="block text-amber-950 font-semibold">Bot Waiting in Waiting Room!</strong>
                            <span className="text-[11px] text-amber-800">
                              Please switch to your {pMeta.label} meeting and click <strong>[Admit]</strong> to let "{job.bot_participant_name || 'PulseSync AI'}" enter.
                            </span>
                          </div>
                        </div>
                        {job.meeting_url && (
                          <button
                            type="button"
                            onClick={() => window.open(job.meeting_url, '_blank')}
                            className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition flex items-center gap-1 shadow-sm"
                          >
                            Open Meeting <ExternalLink size={12} />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Timeline & Actions Footer */}
                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <Clock size={13} />
                        <span>{formatTimestamp(job.scheduled_start || job.created_at)}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Direct Open Meeting Link */}
                        {job.meeting_url && (
                          <button
                            type="button"
                            onClick={() => window.open(job.meeting_url, '_blank')}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 transition"
                            title="Open meeting room in a new browser tab"
                          >
                            <ExternalLink size={12} /> Open Meeting
                          </button>
                        )}

                        {/* View Participants button */}
                        <button
                          onClick={() => setSelectedParticipantsJob(job)}
                          className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                        >
                          <Users size={12} /> Participants {job.participant_count ? `(${job.participant_count})` : ''}
                        </button>

                        {/* View Debug Logs button */}
                        <button
                          onClick={() => setSelectedLogJob(job)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Terminal size={12} /> Activity Logs
                        </button>

                        {/* Retry button for failures */}
                        {isFailed && (
                          <button
                            onClick={() => handleRetry(job.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                          >
                            <RotateCcw size={12} /> Retry
                          </button>
                        )}

                        {/* Cancel button */}
                        {isCancellable && (
                          <button
                            onClick={() => handleCancel(job.id)}
                            className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-400 hover:text-slate-600"
                          >
                            Cancel
                          </button>
                        )}

                        {/* View in Review Center */}
                        {isReady && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                            <Check size={12} /> Verified
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Activity Log Modal */}
      {selectedLogJob && (
        <ActivityLogModal
          job={selectedLogJob}
          onClose={() => setSelectedLogJob(null)}
        />
      )}

      {/* Participants Modal */}
      {selectedParticipantsJob && (
        <ParticipantsModal
          job={selectedParticipantsJob}
          onClose={() => setSelectedParticipantsJob(null)}
        />
      )}
    </div>
  );
}

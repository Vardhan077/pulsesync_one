import React, { useState, useEffect, useRef } from 'react';
import { 
  Inbox, 
  CheckCircle, 
  XCircle, 
  Search, 
  ArrowRight, 
  ExternalLink, 
  Clock, 
  User, 
  ShieldCheck, 
  AlertCircle,
  FolderOpen,
  Upload,
  BookOpen,
  Link as LinkIcon, 
  TrendingUp, 
  AlertTriangle, 
  Loader2, 
  Database, 
  Calendar, 
  MessageSquare, 
  CheckCircle2, 
  X, 
  Play, 
  FileText,
  Plus,
  Activity,
  ArrowUpRight
} from 'lucide-react';

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

export default function ReviewCenter({ 
  meetings = [], 
  onViewChange, 
  onSelectMeeting, 
  onSetMeetingsFilter, 
  onRefreshMeetings
}) {
  const [integrations, setIntegrations] = useState([]);
  const [syncLogs, setSyncLogs] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  
  // Quick Preview modal state
  const [previewMeetingId, setPreviewMeetingId] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const previewMeetingIdRef = useRef(null);

  const fileInputRef = useRef(null);
  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

  const triggerToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Fetch live system integration & sync data
  useEffect(() => {
    fetchData();
  }, [meetings]);

  const fetchData = async () => {
    try {
      const [intRes, syncRes, actRes] = await Promise.all([
        fetch(`${API_URL}/api/integrations`).then(r => r.ok ? r.json() : []),
        fetch(`${API_URL}/api/sync-logs`).then(r => r.ok ? r.json() : []),
        fetch(`${API_URL}/api/activity-logs`).then(r => r.ok ? r.json() : [])
      ]);
      setIntegrations(intRes);
      setSyncLogs(syncRes);
      setActivityLogs(actRes);
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
    }
  };

  // Quick Preview handler
  const handleOpenPreview = async (meetingId) => {
    previewMeetingIdRef.current = meetingId;
    setPreviewMeetingId(meetingId);
    setPreviewData(null);
    setLoadingPreview(true);
    try {
      const res = await fetch(`${API_URL}/api/meetings/${meetingId}`);
      if (res.ok) {
        if (previewMeetingIdRef.current !== meetingId) return;
        const data = await res.json();
        if (previewMeetingIdRef.current !== meetingId) return;
        setPreviewData(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (previewMeetingIdRef.current === meetingId) {
        setLoadingPreview(false);
      }
    }
  };

  // Upload handler with immediate transition to Processing Screen / Review Workspace
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!consentConfirmed) {
      triggerToast("Please confirm that required participant consent has been obtained before uploading audio.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsUploading(true);
    triggerToast(`Uploading "${file.name}"...`);

    const formData = new FormData();
    formData.append('audio', file);
    formData.append('title', file.name.replace(/\.[^/.]+$/, ""));
    formData.append('duration', 120);
    formData.append('consent_status', 'granted');

    try {
      const response = await fetch(`${API_URL}/api/meetings/upload`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.message || "Upload failed");
      }
      const data = await response.json();
      
      triggerToast("Audio uploaded! Processing transcript...");
      if (onRefreshMeetings) {
        await onRefreshMeetings();
      }
      if (data.meetingId && onSelectMeeting) {
        onSelectMeeting(data.meetingId);
      } else {
        onViewChange('board');
      }
    } catch (err) {
      console.error(err);
      triggerToast(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Calculate Real Operational Counts from Backend Meetings
  const pendingReviewsCount = meetings.filter(m => ['review', 'transcript_review', 'speaker_review', 'company_review'].includes(m.workflow_state)).length;
  
  const lowConfidenceCount = meetings.filter(m => {
    if (m.workflow_state === 'synced') return false;
    const items = Array.isArray(m.action_items) ? m.action_items : [];
    return items.some(a => a.confidence && a.confidence < 85);
  }).length;

  const readyToSyncCount = meetings.filter(m => m.workflow_state === 'destination_mapping').length;
  const syncFailuresCount = meetings.filter(m => m.status === 'failed' || m.workflow_state === 'failed').length;
  const connectedIntegrationsCount = integrations.filter(i => i.status === 'Connected').length;

  // Real Processing Counts
  const totalProcessed = meetings.length;
  const totalReviewed = meetings.filter(m => ['review', 'destination_mapping', 'synced'].includes(m.workflow_state)).length;
  const totalSynced = meetings.filter(m => m.workflow_state === 'synced').length;
  const totalNeedsAttention = pendingReviewsCount + lowConfidenceCount;
  const totalFailed = syncFailuresCount;

  // Filter click navigators
  const navigateWithFilter = (filterKey) => {
    if (onSetMeetingsFilter) onSetMeetingsFilter(filterKey);
    onViewChange('board');
  };

  // Calculate Real Daily Activity Chart (Past 7 days)
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });

  const dailyCounts = last7Days.map(dayStr => {
    const dayMeetings = meetings.filter(m => (m.created_at || '').startsWith(dayStr));
    return {
      day: new Date(dayStr).toLocaleDateString(undefined, { weekday: 'short' }),
      count: dayMeetings.length
    };
  });
  const maxDayCount = Math.max(...dailyCounts.map(d => d.count), 1);

  // Recent 5 meetings
  const recentMeetings = [...meetings].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

  return (
    <div className="flex-1 bg-[#F8FAFC] min-h-screen p-6 text-left select-none overflow-y-auto font-sans">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-[#0F172A] text-white px-4 py-2.5 rounded-lg shadow-xl text-xs font-semibold flex items-center gap-2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <Activity size={14} className="text-[#14B8A6]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="audio/*,video/webm,video/mp4,.mp3,.wav,.m4a,.webm,.ogg,.flac,.mp4"
        className="hidden"
      />

      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Top Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E5E7EB] pb-4">
          <div>
            <h1 className="text-lg font-extrabold text-[#0F172A] tracking-tight">
              Operational Command Center
            </h1>
            <p className="text-xs text-[#64748B] font-medium mt-0.5">
              Live intelligence queue, processing pipelines, and pending CRM sync actions.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <label className="flex max-w-md items-start gap-2 text-[11px] text-[#475569]">
              <input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} className="mt-0.5" />
              <span>I confirm the required participants have been informed and consented to recording and AI processing.</span>
            </label>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || !consentConfirmed}
              className="px-3.5 py-1.5 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-xs font-bold rounded-lg shadow-3xs flex items-center gap-1.5 transition disabled:opacity-50"
            >
              {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              <span>{isUploading ? "Uploading..." : "New Call"}</span>
            </button>
          </div>
        </div>

        {/* 1. Primary Operational Attention Metrics (Clickable Filters) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          
          {/* Pending Reviews */}
          <div
            onClick={() => navigateWithFilter('needs_review')}
            className="bg-white border border-[#E5E7EB] hover:border-[#14B8A6] p-4 rounded-xl shadow-3xs cursor-pointer transition flex flex-col justify-between group"
          >
            <div className="flex items-center justify-between text-[10px] font-bold uppercase text-[#64748B]">
              <span>Pending Reviews</span>
              <Inbox size={14} className="text-[#0284C7] group-hover:scale-110 transition-transform" />
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-extrabold text-[#0F172A]">{pendingReviewsCount}</span>
              <span className="text-[10px] font-bold text-[#0284C7] flex items-center gap-0.5 group-hover:underline">
                View <ArrowUpRight size={10} />
              </span>
            </div>
          </div>

          {/* Low Confidence Alerts */}
          <div
            onClick={() => navigateWithFilter('low_confidence')}
            className="bg-white border border-[#E5E7EB] hover:border-amber-400 p-4 rounded-xl shadow-3xs cursor-pointer transition flex flex-col justify-between group"
          >
            <div className="flex items-center justify-between text-[10px] font-bold uppercase text-[#64748B]">
              <span>Low Confidence</span>
              <AlertTriangle size={14} className="text-amber-500 group-hover:scale-110 transition-transform" />
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-extrabold text-[#0F172A]">{lowConfidenceCount}</span>
              <span className="text-[10px] font-bold text-amber-600 flex items-center gap-0.5 group-hover:underline">
                View <ArrowUpRight size={10} />
              </span>
            </div>
          </div>

          {/* Ready to Sync */}
          <div
            onClick={() => navigateWithFilter('ready_to_sync')}
            className="bg-white border border-[#E5E7EB] hover:border-emerald-400 p-4 rounded-xl shadow-3xs cursor-pointer transition flex flex-col justify-between group"
          >
            <div className="flex items-center justify-between text-[10px] font-bold uppercase text-[#64748B]">
              <span>Ready to Sync</span>
              <CheckCircle2 size={14} className="text-emerald-500 group-hover:scale-110 transition-transform" />
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-extrabold text-[#0F172A]">{readyToSyncCount}</span>
              <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-0.5 group-hover:underline">
                View <ArrowUpRight size={10} />
              </span>
            </div>
          </div>

          {/* Sync Failures */}
          <div
            onClick={() => navigateWithFilter('failed')}
            className="bg-white border border-[#E5E7EB] hover:border-rose-400 p-4 rounded-xl shadow-3xs cursor-pointer transition flex flex-col justify-between group"
          >
            <div className="flex items-center justify-between text-[10px] font-bold uppercase text-[#64748B]">
              <span>Sync Failures</span>
              <XCircle size={14} className="text-rose-500 group-hover:scale-110 transition-transform" />
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-extrabold text-[#0F172A]">{syncFailuresCount}</span>
              <span className="text-[10px] font-bold text-rose-600 flex items-center gap-0.5 group-hover:underline">
                View <ArrowUpRight size={10} />
              </span>
            </div>
          </div>

          {/* Integrations Connected */}
          <div
            onClick={() => onViewChange('integrations')}
            className="bg-white border border-[#E5E7EB] hover:border-[#14B8A6] p-4 rounded-xl shadow-3xs cursor-pointer transition flex flex-col justify-between group"
          >
            <div className="flex items-center justify-between text-[10px] font-bold uppercase text-[#64748B]">
              <span>Integrations</span>
              <LinkIcon size={14} className="text-[#14B8A6] group-hover:scale-110 transition-transform" />
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-extrabold text-[#0F172A]">{connectedIntegrationsCount}</span>
              <span className="text-[10px] font-bold text-[#14B8A6] flex items-center gap-0.5 group-hover:underline">
                Manage <ArrowUpRight size={10} />
              </span>
            </div>
          </div>

        </div>

        {/* 2. Processing Activity Analytics & Real Chart */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs space-y-4">
          <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
            <div>
              <h3 className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wider">
                Processing Activity & Throughput
              </h3>
              <p className="text-[10px] text-[#64748B] font-semibold mt-0.5">
                Real historical conversation processing and CRM sync progression.
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs font-semibold">
              <span className="text-[#64748B]">Total: <strong className="text-[#0F172A] font-extrabold">{totalProcessed}</strong></span>
              <span className="text-[#64748B]">Reviewed: <strong className="text-[#0284C7] font-extrabold">{totalReviewed}</strong></span>
              <span className="text-[#64748B]">Synced: <strong className="text-emerald-600 font-extrabold">{totalSynced}</strong></span>
              <span className="text-[#64748B]">Failed: <strong className="text-rose-600 font-extrabold">{totalFailed}</strong></span>
            </div>
          </div>

          {/* Simple Clean Operational Bar Chart */}
          {meetings.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#94A3B8] italic">
              No activity yet. Upload a call recording to begin processing.
            </div>
          ) : (
            <div className="pt-2">
              <div className="flex items-end justify-between gap-4 h-28 px-4 border-b border-[#F1F5F9] pb-2">
                {dailyCounts.map((item, idx) => {
                  const heightPercent = Math.max((item.count / maxDayCount) * 100, item.count > 0 ? 15 : 4);
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
                      <span className="text-[9px] font-bold text-[#64748B] opacity-0 group-hover:opacity-100 transition font-mono">
                        {item.count}
                      </span>
                      <div
                        style={{ height: `${heightPercent}%` }}
                        className={`w-full max-w-[36px] rounded-t-sm transition-all ${
                          item.count > 0 ? 'bg-[#14B8A6] group-hover:bg-[#0D9488]' : 'bg-[#F1F5F9]'
                        }`}
                      />
                      <span className="text-[10px] font-bold text-[#94A3B8] font-mono mt-1">
                        {item.day}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 3. Recent Activity Stream */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-3xs text-left">
          <div className="p-4 border-b border-[#F1F5F9] flex items-center justify-between">
            <div>
              <h3 className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wider">
                Recent Activity
              </h3>
              <p className="text-[10px] text-[#64748B] font-semibold mt-0.5">
                Latest customer conversation sessions requiring review or synced to CRM.
              </p>
            </div>
            
            <button
              onClick={() => onViewChange('board')}
              className="text-xs font-bold text-[#14B8A6] hover:underline flex items-center gap-1"
            >
              <span>View All in Review Queue</span>
              <ArrowRight size={12} />
            </button>
          </div>

          {recentMeetings.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#94A3B8] italic">
              No meetings registered yet. Click <strong>+ New Call</strong> to start.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E5E7EB] text-[9.5px] font-bold text-[#64748B] uppercase tracking-wider bg-[#F8FAFC]">
                    <th className="py-2.5 px-4">Meeting Session</th>
                    <th className="py-2.5 px-4">Account</th>
                    <th className="py-2.5 px-4">Playbook</th>
                    <th className="py-2.5 px-4">Workflow Status</th>
                    <th className="py-2.5 px-4">Last Activity</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9] text-[#0F172A] font-semibold">
                  {recentMeetings.map(m => {
                    const isSynced = m.workflow_state === 'synced';
                    const isFailed = m.status === 'failed' || m.workflow_state === 'failed';
                    return (
                      <tr key={m.id} className="hover:bg-[#FAFBFB] transition-colors border-b border-[#F1F5F9] last:border-0">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[#0F172A] block">{m.title}</span>
                            <span className="px-2 py-0.5 bg-teal-50 text-teal-700 border border-teal-200 rounded text-[9.5px] font-bold font-mono uppercase whitespace-nowrap">
                              {formatCallType(m.call_type)}
                            </span>
                          </div>
                          <span className="text-[10px] text-[#64748B] font-normal block mt-0.5">{m.duration_seconds ? `${Math.floor(m.duration_seconds / 60)} min` : "4 min"}</span>
                        </td>
                        <td className="py-3 px-4 text-[#475569] font-semibold">{m.company_name || "Unassigned"}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 bg-[#F1F5F9] text-[#475569] rounded text-[10px] font-mono font-bold">
                            {m.template_used || "MEDDIC"}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase font-mono ${
                            isSynced ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                            isFailed ? 'bg-rose-50 text-rose-600 border border-rose-100' :
                            'bg-sky-50 text-sky-600 border border-sky-100'
                          }`}>
                            {m.workflow_state || 'Review'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-[#64748B] text-[10.5px] font-medium">
                          {new Date(m.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-right space-x-2">
                          <button
                            onClick={() => handleOpenPreview(m.id)}
                            className="px-2 py-1 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#475569] text-[10.5px] font-bold rounded-lg transition shadow-3xs"
                          >
                            Preview
                          </button>
                          <button
                            onClick={() => onSelectMeeting(m.id)}
                            className="px-2.5 py-1 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-[10.5px] font-bold rounded-lg transition shadow-3xs"
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

      {/* Quick Preview Modal */}
      {previewMeetingId && (
        <div className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150 select-none">
          <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-xl w-full max-w-2xl max-h-[75vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-[#F1F5F9] bg-[#FAFBFB] flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-xs font-bold text-[#0F172A] uppercase">Session Quick Preview</h3>
                <p className="text-[10px] text-[#64748B] font-semibold truncate max-w-sm mt-0.5">{previewData?.meeting?.title || "Meeting Overview"}</p>
              </div>
              <button onClick={() => setPreviewMeetingId(null)} className="p-1 hover:bg-[#E2E8F0] rounded text-[#64748B]">
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#F8FAFC]">
              {loadingPreview ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="animate-spin text-[#14B8A6]" size={18} />
                  <span className="text-xs text-[#64748B]">Loading session summary...</span>
                </div>
              ) : previewData ? (
                <div className="space-y-4 text-xs font-semibold text-[#334155]">
                  <div className="bg-white p-3.5 rounded-lg border border-[#E5E7EB] space-y-1.5">
                    <span className="text-[9px] font-bold text-[#94A3B8] uppercase block">Executive Summary</span>
                    <p className="leading-relaxed">
                      {previewData.summary?.overview || previewData.meeting?.overview || "No executive summary available for this meeting."}
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white p-3 rounded-lg border border-[#E5E7EB]">
                      <span className="text-[9px] font-bold text-[#94A3B8] uppercase block mb-1">Company Association</span>
                      <span className="font-bold text-[#0F172A] block truncate">{previewData.company?.name || "Unassigned Account"}</span>
                    </div>

                    <div className="bg-white p-3 rounded-lg border border-[#E5E7EB]">
                      <span className="text-[9px] font-bold text-[#94A3B8] uppercase block mb-1">Playbook Framework</span>
                      <span className="font-bold text-[#14B8A6] block">{previewData.meeting?.template_used || "MEDDIC"}</span>
                    </div>

                    <div className="bg-white p-3 rounded-lg border border-[#E5E7EB]">
                      <span className="text-[9px] font-bold text-[#94A3B8] uppercase block mb-1">Call Stage / Type</span>
                      <span className="font-bold text-teal-700 block truncate">{formatCallType(previewData.meeting?.call_type)}</span>
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={() => {
                        const mId = previewMeetingId;
                        setPreviewMeetingId(null);
                        onSelectMeeting(mId);
                      }}
                      className="px-3.5 py-1.5 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-xs font-bold rounded-lg shadow-3xs flex items-center gap-1.5 transition"
                    >
                      <span>Open Full Meeting Workspace</span>
                      <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-[#64748B] italic">No preview data found.</div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

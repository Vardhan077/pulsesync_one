import React, { useState, useEffect } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  RotateCw,
  FileAudio,
  Sparkles,
  Users,
  Mic,
  Clock,
  ShieldCheck
} from "lucide-react";

export default function MeetingProcessingScreen({
  meeting,
  onReturnToQueue,
  onRetry,
  isRetrying
}) {
  // Persistently track processing start time so switching tabs/views doesn't reset or alter the timer
  const getStartTime = () => {
    if (!meeting?.id) return Date.now();
    const storageKey = `pulsesync_processing_start_${meeting.id}`;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed > 0 && parsed <= Date.now()) {
          return parsed;
        }
      }
    } catch (_) {}

    // Fall back to server timestamp if recent (within 24 hours)
    const serverTs = meeting.updated_at || meeting.created_at;
    if (serverTs) {
      const parsed = new Date(serverTs).getTime();
      if (!isNaN(parsed)) {
        const diff = Date.now() - parsed;
        if (diff >= 0 && diff < 24 * 60 * 60 * 1000) {
          try {
            localStorage.setItem(storageKey, String(parsed));
          } catch (_) {}
          return parsed;
        }
      }
    }

    const now = Date.now();
    try {
      localStorage.setItem(storageKey, String(now));
    } catch (_) {}
    return now;
  };

  const [elapsedSeconds, setElapsedSeconds] = useState(() => {
    const startMs = getStartTime();
    return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  });

  useEffect(() => {
    if (!meeting?.id) return;
    const storageKey = `pulsesync_processing_start_${meeting.id}`;

    // Clean up storage if processing has finished
    if (meeting.status === 'completed' || meeting.processing_stage === 'ready') {
      try {
        localStorage.removeItem(storageKey);
      } catch (_) {}
      return;
    }

    const startMs = getStartTime();

    const updateElapsed = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((now - startMs) / 1000));
      setElapsedSeconds(diff);
    };

    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        updateElapsed();
      }
    };
    const handleFocus = () => {
      updateElapsed();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [meeting?.id, meeting?.status, meeting?.processing_stage]);

  const handleRetryClick = (e) => {
    if (meeting?.id) {
      try {
        localStorage.setItem(`pulsesync_processing_start_${meeting.id}`, String(Date.now()));
      } catch (_) {}
    }
    setElapsedSeconds(0);
    if (onRetry) onRetry(e);
  };

  const formatElapsed = (sec) => {
    const totalSec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const isFailed = meeting?.status === 'failed' || meeting?.workflow_state === 'failed';
  const stage = meeting?.processing_stage || (meeting?.status === 'queued' ? 'queued' : 'transcribing');

  // Milestone Progress State Calculation
  const isUploadedDone = true;
  const isTranscribingActive = !isFailed && (stage === 'transcribing' || stage === 'queued');
  const isTranscribingDone = !isFailed && (stage === 'diarizing' || stage === 'persisting' || stage === 'ready');
  
  const isDiarizingActive = !isFailed && stage === 'diarizing';
  const isDiarizingDone = !isFailed && (stage === 'persisting' || stage === 'ready');

  const isPersistingActive = !isFailed && stage === 'persisting';
  const isReady = !isFailed && stage === 'ready';

  return (
    <div className="flex-1 flex flex-col bg-[#F8FAFC] text-left select-none overflow-y-auto">
      {/* Top Breadcrumb Bar */}
      <div className="bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between flex-shrink-0 shadow-3xs">
        <div className="flex items-center gap-3">
          <button
            onClick={onReturnToQueue}
            className="p-1.5 hover:bg-[#F1F5F9] rounded-lg text-[#64748B] hover:text-[#0F172A] transition flex items-center gap-1.5 text-xs font-semibold"
            title="Return to Review Queue"
          >
            <ArrowLeft size={14} />
            <span>Review Queue</span>
          </button>
          <div className="h-4 w-px bg-[#E2E8F0]" />
          <div>
            <h2 className="text-xs font-extrabold text-[#0F172A] truncate max-w-md">
              {meeting?.title || "Processing Call"}
            </h2>
            <span className="text-[10px] text-[#64748B] font-semibold block">
              {meeting?.created_at ? new Date(meeting.created_at).toLocaleDateString() : "Just now"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded-full text-[10px] font-mono font-bold flex items-center gap-1.5">
            {isFailed ? (
              <>
                <AlertCircle size={11} className="text-rose-600" />
                <span className="text-rose-700">Processing Failed</span>
              </>
            ) : (
              <>
                <Loader2 size={11} className="animate-spin text-amber-600" />
                <span>Background Processing Active</span>
              </>
            )}
          </span>
        </div>
      </div>

      {/* Main Processing Center Card */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-xl bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-8 sm:p-10 space-y-8">
          
          {isFailed ? (
            /* FAILED STATE */
            <div className="space-y-6 text-center">
              <div className="h-14 w-14 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto shadow-3xs">
                <AlertCircle size={28} />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-extrabold text-[#0F172A]">
                  We couldn't process this call
                </h3>
                <p className="text-xs text-[#64748B] max-w-md mx-auto leading-relaxed">
                  Something went wrong while transcribing the audio file. You can retry the ingestion pipeline or verify that the audio recording is intact.
                </p>
                {meeting?.error_message && (
                  <div className="mt-3 p-3 bg-[#F8FAFC] border border-rose-100 rounded-lg text-[11px] text-rose-800 font-mono text-left max-w-md mx-auto truncate">
                    Error: {meeting.error_message}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={handleRetryClick}
                  disabled={isRetrying}
                  className="px-5 py-2.5 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-xs font-bold rounded-xl transition flex items-center gap-2 shadow-3xs disabled:opacity-50"
                >
                  <RotateCw size={13} className={isRetrying ? "animate-spin" : ""} />
                  <span>{isRetrying ? "Retrying Pipeline..." : "Retry Processing"}</span>
                </button>
                <button
                  onClick={onReturnToQueue}
                  className="px-4 py-2.5 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#475569] text-xs font-bold rounded-xl transition"
                >
                  Return to Queue
                </button>
              </div>
            </div>
          ) : (
            /* ACTIVE PROCESSING STATE */
            <>
              {/* Header */}
              <div className="space-y-2 text-center">
                <div className="relative inline-flex items-center justify-center mb-2">
                  <div className="h-12 w-12 rounded-2xl bg-teal-50 border border-teal-100 text-[#14B8A6] flex items-center justify-center shadow-3xs">
                    <Sparkles size={22} className="animate-pulse" />
                  </div>
                </div>
                <h3 className="text-lg font-extrabold text-[#0F172A] tracking-tight">
                  Preparing your meeting
                </h3>
                <p className="text-xs text-[#64748B] max-w-md mx-auto leading-relaxed">
                  Please wait while we process your call. We're transcribing the conversation and identifying speakers. You'll receive a notification when your transcript is ready to review.
                </p>
              </div>

              {/* Progress Milestones Checklist */}
              <div className="space-y-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-5 text-xs font-medium">
                
                {/* Step 1: Audio Uploaded */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                      <CheckCircle2 size={14} />
                    </div>
                    <span className="font-bold text-[#0F172A]">Audio file received & normalized</span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-700 font-bold">Ready</span>
                </div>

                {/* Step 2: Whisper STT Transcription */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isTranscribingDone ? (
                      <div className="h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                        <CheckCircle2 size={14} />
                      </div>
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-teal-100 text-[#0F766E] flex items-center justify-center">
                        <Loader2 size={13} className="animate-spin text-[#14B8A6]" />
                      </div>
                    )}
                    <span className={isTranscribingDone ? "font-bold text-[#0F172A]" : "font-bold text-[#0F766E]"}>
                      Transcribing speech & word timestamps
                    </span>
                  </div>
                  <span className={`text-[11px] font-mono font-bold ${isTranscribingDone ? "text-emerald-700" : "text-[#14B8A6]"}`}>
                    {isTranscribingDone ? "Complete" : "In Progress"}
                  </span>
                </div>

                {/* Step 3: Speaker Diarization */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isDiarizingDone ? (
                      <div className="h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                        <CheckCircle2 size={14} />
                      </div>
                    ) : isDiarizingActive ? (
                      <div className="h-6 w-6 rounded-full bg-teal-100 text-[#0F766E] flex items-center justify-center">
                        <Loader2 size={13} className="animate-spin text-[#14B8A6]" />
                      </div>
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-slate-200 text-slate-400 flex items-center justify-center font-mono text-[10px]">
                        3
                      </div>
                    )}
                    <span className={isDiarizingDone ? "font-bold text-[#0F172A]" : isDiarizingActive ? "font-bold text-[#0F766E]" : "text-[#94A3B8]"}>
                      Detecting acoustic speaker boundaries
                    </span>
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-[#94A3B8]">
                    {isDiarizingDone ? "Complete" : isDiarizingActive ? "In Progress" : "Queued"}
                  </span>
                </div>

                {/* Step 4: Preparing Workspace */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isReady ? (
                      <div className="h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                        <CheckCircle2 size={14} />
                      </div>
                    ) : isPersistingActive ? (
                      <div className="h-6 w-6 rounded-full bg-teal-100 text-[#0F766E] flex items-center justify-center">
                        <Loader2 size={13} className="animate-spin text-[#14B8A6]" />
                      </div>
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-slate-200 text-slate-400 flex items-center justify-center font-mono text-[10px]">
                        4
                      </div>
                    )}
                    <span className={isReady ? "font-bold text-[#0F172A]" : isPersistingActive ? "font-bold text-[#0F766E]" : "text-[#94A3B8]"}>
                      Preparing transcript review workspace
                    </span>
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-[#94A3B8]">
                    {isReady ? "Ready" : isPersistingActive ? "Finalizing" : "Waiting"}
                  </span>
                </div>

              </div>

              {/* Status Footer & Elapsed Time */}
              <div className="flex items-center justify-between pt-2 border-t border-[#F1F5F9] text-[11px] text-[#64748B]">
                <div className="flex items-center gap-1.5 font-medium">
                  <Clock size={13} className="text-[#94A3B8]" />
                  <span>Elapsed time: <strong className="font-mono text-[#0F172A]">{formatElapsed(elapsedSeconds)}</strong></span>
                </div>

                <button
                  onClick={onReturnToQueue}
                  className="text-xs font-semibold text-[#14B8A6] hover:text-[#0D9488] hover:underline flex items-center gap-1"
                >
                  <span>You can navigate away anytime</span>
                  <span className="font-bold">→</span>
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

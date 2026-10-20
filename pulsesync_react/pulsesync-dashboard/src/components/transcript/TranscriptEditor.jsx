import React, { useState, useMemo, useRef } from 'react';
import { 
  Play, 
  Pause, 
  Clock, 
  Sparkles, 
  Check, 
  X, 
  Edit2, 
  Search, 
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Download,
  Zap
} from 'lucide-react';

export const getSpeakerColor = (speakerName) => {
  const hash = Array.from(speakerName || '').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const colors = [
    { 
      text: 'text-[#0D9488]', 
      bg: 'bg-[#E6F4F1]', 
      border: 'border-[#14B8A6]/25', 
      avatar: 'bg-[#E6F4F1] text-[#0D9488] border-[#14B8A6]/30',
      activeRing: 'ring-[#14B8A6]/40 bg-[#E6F4F1]/80 text-[#0F172A]' 
    },
    { 
      text: 'text-[#4F46E5]', 
      bg: 'bg-[#EEF2FF]', 
      border: 'border-[#4F46E5]/20', 
      avatar: 'bg-[#EEF2FF] text-[#4F46E5] border-[#4F46E5]/25',
      activeRing: 'ring-[#4F46E5]/40 bg-[#EEF2FF]/80 text-[#0F172A]' 
    },
    { 
      text: 'text-[#D97706]', 
      bg: 'bg-[#FEF3C7]', 
      border: 'border-[#D97706]/25', 
      avatar: 'bg-[#FEF3C7] text-[#D97706] border-[#D97706]/30',
      activeRing: 'ring-[#D97706]/40 bg-[#FEF3C7]/80 text-[#0F172A]' 
    },
    { 
      text: 'text-[#E11D48]', 
      bg: 'bg-[#FFE4E6]', 
      border: 'border-[#E11D48]/20', 
      avatar: 'bg-[#FFE4E6] text-[#E11D48] border-[#E11D48]/25',
      activeRing: 'ring-[#E11D48]/40 bg-[#FFE4E6]/80 text-[#0F172A]' 
    },
    { 
      text: 'text-[#0284C7]', 
      bg: 'bg-[#E0F2FE]', 
      border: 'border-[#0284C7]/25', 
      avatar: 'bg-[#E0F2FE] text-[#0284C7] border-[#0284C7]/30',
      activeRing: 'ring-[#0284C7]/40 bg-[#E0F2FE]/80 text-[#0F172A]' 
    },
    { 
      text: 'text-[#8B5CF6]', 
      bg: 'bg-[#F3E8FF]', 
      border: 'border-[#8B5CF6]/25', 
      avatar: 'bg-[#F3E8FF] text-[#8B5CF6] border-[#8B5CF6]/30',
      activeRing: 'ring-[#8B5CF6]/40 bg-[#F3E8FF]/80 text-[#0F172A]' 
    },
    { 
      text: 'text-[#C026D3]', 
      bg: 'bg-[#FDF4FF]', 
      border: 'border-[#C026D3]/20', 
      avatar: 'bg-[#FDF4FF] text-[#C026D3] border-[#C026D3]/25',
      activeRing: 'ring-[#C026D3]/40 bg-[#FDF4FF]/80 text-[#0F172A]' 
    },
  ];
  return colors[hash % colors.length];
};

export const getInitials = (name) => {
  if (!name) return 'SP';
  const match = name.match(/Speaker\s*(\d+)/i);
  if (match) return `S${match[1]}`;
  const matchSpk = name.match(/spk_?(\d+)/i);
  if (matchSpk) return `S${matchSpk[1]}`;
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

const formatTimestamp = (sec) => {
  if (sec === undefined || sec === null || isNaN(sec)) return '0:00';
  const minutes = Math.floor(sec / 60);
  const seconds = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

export default function TranscriptEditor({ 
  segments = [], 
  speakers = [],
  speakerRoles = {},
  currentTime = 0,
  duration = 0,
  audioUrl = "",
  isPlaying = false,
  onTogglePlay,
  playbackSpeed = 1,
  onChangeSpeed,
  onSeek,
  onSegmentClick,
  onRenameSpeaker, 
  onEditSegment,
  onSaveSegment,
  onVolumeChange,
  readOnly = false,
  activeHighlightSegmentId = null,
  highlightValue = ""
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [editingSegmentId, setEditingSegmentId] = useState(null);
  const [editingSegmentText, setEditingSegmentText] = useState('');
  const [editingSpeakerId, setEditingSpeakerId] = useState(null);
  const [editingSpeakerName, setEditingSpeakerName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(1);
  const [scrubberHoverTime, setScrubberHoverTime] = useState(null);
  const [scrubberHoverX, setScrubberHoverX] = useState(0);

  const handleSeek = (time) => {
    if (onSegmentClick) {
      onSegmentClick(time);
    } else if (onSeek) {
      onSeek(time);
    }
  };

  const handleSkip = (deltaSeconds) => {
    const target = Math.max(0, Math.min(totalDuration || 9999, currentTime + deltaSeconds));
    handleSeek(target);
  };

  const handleToggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    if (onVolumeChange) {
      onVolumeChange(nextMute ? 0 : volumeLevel);
    }
  };

  const handleVolumeSlider = (e) => {
    const val = parseFloat(e.target.value);
    setVolumeLevel(val);
    setIsMuted(val === 0);
    if (onVolumeChange) {
      onVolumeChange(val);
    }
  };

  const startEditSpeaker = (spkId, curName) => {
    if (readOnly) return;
    setEditingSpeakerId(spkId);
    setEditingSpeakerName(curName);
  };

  const saveEditSpeaker = (spkId) => {
    if (onRenameSpeaker && editingSpeakerName.trim()) {
      onRenameSpeaker(spkId, editingSpeakerName.trim());
    }
    setEditingSpeakerId(null);
  };

  const startEditSegment = (segmentId, currentText) => {
    if (readOnly || showOriginal) return;
    setEditingSegmentId(segmentId);
    setEditingSegmentText(currentText);
  };

  const saveEditSegment = (segmentId) => {
    const trimmed = editingSegmentText.trim();
    if (onSaveSegment) {
      onSaveSegment(segmentId, trimmed);
    }
    if (onEditSegment) {
      onEditSegment(segmentId, trimmed);
    }
    setEditingSegmentId(null);
  };

  const isSegmentActive = (start, end) => {
    return currentTime >= (start || 0) && currentTime < (end || 0);
  };

  // Helper to resolve role for a given speaker
  const getSpeakerRole = (speakerId, speakerName) => {
    if (speakerRoles[speakerId]) return speakerRoles[speakerId];
    if (speakerRoles[speakerName]) return speakerRoles[speakerName];
    if (Array.isArray(speakers)) {
      const found = speakers.find(s => s.speaker_id === speakerId || s.name === speakerName);
      if (found && found.role) return found.role;
    }
    return '';
  };

  // Filter segments based on search
  const filteredSegments = useMemo(() => {
    if (!searchQuery.trim()) return segments;
    const q = searchQuery.toLowerCase().trim();
    return segments.filter(seg => {
      const textVal = showOriginal 
        ? (seg.original_text || seg.text || '') 
        : (seg.corrected_text || seg.text || '');
      const spkName = seg.speaker_name || seg.speaker || '';
      return textVal.toLowerCase().includes(q) || spkName.toLowerCase().includes(q);
    });
  }, [segments, searchQuery, showOriginal]);

  // Aggregate consecutive segments into cohesive speaker dialogue turns with platform attribution
  const groupedTurns = useMemo(() => {
    const turns = [];
    let currentTurn = null;

    filteredSegments.forEach((seg, idx) => {
      const speakerId = seg.speaker_id || seg.speaker_name || seg.speaker || `spk_${idx}`;
      const speakerName = seg.speaker_name || seg.speaker || `Speaker ${speakerId.replace(/\D/g, '') || idx + 1}`;
      const segRole = seg.role || getSpeakerRole(speakerId, speakerName);
      const segOrg = seg.organization || null;
      const attrSource = seg.attribution_source || seg.attributionSource || null;
      const attrConf = seg.attribution_confidence || seg.attributionConfidence || null;

      if (currentTurn && (currentTurn.speakerId === speakerId || currentTurn.speakerName === speakerName)) {
        currentTurn.segments.push(seg);
        currentTurn.endTime = Math.max(currentTurn.endTime, seg.end_time || seg.start_time || 0);
      } else {
        currentTurn = {
          speakerId,
          speakerName,
          role: segRole,
          organization: segOrg,
          attributionSource: attrSource,
          attributionConfidence: attrConf,
          startTime: seg.start_time || 0,
          endTime: seg.end_time || seg.start_time || 0,
          segments: [seg]
        };
        turns.push(currentTurn);
      }
    });

    return turns;
  }, [filteredSegments]);

  // Highlight search text & evidence
  const renderHighlightedContent = (text, isEvidenceActive, isSegmentPlaying) => {
    if (!text) return text;

    // 1. Evidence highlight from Step 6 / Drawer
    if (isEvidenceActive && highlightValue) {
      const valStr = String(highlightValue).trim();
      if (valStr) {
        try {
          const escaped = valStr.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`(${escaped})`, 'gi');
          const parts = text.split(regex);
          return parts.map((part, i) =>
            regex.test(part) ? (
              <mark key={i} className="bg-amber-300 text-amber-950 font-bold px-1 rounded shadow-3xs">
                {part}
              </mark>
            ) : part
          );
        } catch (e) {
          // Fallback to text
        }
      }
    }

    // 2. Search query highlight
    if (searchQuery && searchQuery.trim()) {
      try {
        const escaped = searchQuery.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');
        const parts = text.split(regex);
        return parts.map((part, i) =>
          regex.test(part) ? (
            <mark key={i} className="bg-yellow-200 text-yellow-900 font-semibold px-0.5 rounded">
              {part}
            </mark>
          ) : part
        );
      } catch (e) {
        // Fallback to text
      }
    }

    return text;
  };

  const totalDuration = useMemo(() => {
    if (duration && duration > 0) return duration;
    if (!segments || segments.length === 0) return 0;
    return segments[segments.length - 1]?.end_time || 0;
  }, [segments, duration]);

  const firstSpeechTime = useMemo(() => {
    const first = segments.find(s => (s.text || s.corrected_text || '').trim().length > 0);
    return first ? Number(first.start_time) || 0 : 0;
  }, [segments]);

  return (
    <div className="flex flex-col gap-4">
      {/* Dedicated Audio Player Console */}
      <div className="bg-slate-900 text-white rounded-xl p-3.5 shadow-md border border-slate-800 flex flex-col gap-2.5 select-none">
        
        {/* Main Transport Row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          
          {/* Left: Playback buttons & Time */}
          <div className="flex items-center gap-2">
            {/* Play/Pause Button */}
            {onTogglePlay && (
              <button
                onClick={onTogglePlay}
                className="h-8 px-3.5 bg-[#14B8A6] hover:bg-[#0D9488] active:scale-95 text-white rounded-lg shadow-sm flex items-center gap-1.5 text-xs font-bold transition"
                title={isPlaying ? "Pause audio" : "Play audio"}
              >
                {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                <span>{isPlaying ? "Pause" : "Play"}</span>
              </button>
            )}

            {/* Skip -5s */}
            <button
              onClick={() => handleSkip(-5)}
              className="h-8 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition"
              title="Rewind 5 seconds"
            >
              <RotateCcw size={12} />
              <span className="text-[10px]">5s</span>
            </button>

            {/* Skip +5s */}
            <button
              onClick={() => handleSkip(5)}
              className="h-8 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition"
              title="Fast forward 5 seconds"
            >
              <RotateCw size={12} />
              <span className="text-[10px]">5s</span>
            </button>

            {/* Time Indicator */}
            <div className="flex items-center gap-1.5 font-mono text-xs text-slate-300 bg-slate-800/80 px-2.5 py-1.5 rounded-lg border border-slate-700/60">
              <Clock size={12} className="text-[#14B8A6]" />
              <span className="font-bold text-white">{formatTimestamp(currentTime)}</span>
              <span className="text-slate-400">/</span>
              <span className="text-slate-400">{formatTimestamp(totalDuration)}</span>
            </div>
          </div>

          {/* Center/Right: Speed, Volume, Download, Jump to Speech */}
          <div className="flex items-center gap-2">
            {/* Skip Initial Silence Button (if applicable) */}
            {firstSpeechTime > 3 && currentTime < firstSpeechTime && (
              <button
                onClick={() => handleSeek(firstSpeechTime)}
                className="h-7 px-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition animate-pulse"
                title={`Skip initial silence to first spoken word at ${formatTimestamp(firstSpeechTime)}`}
              >
                <Zap size={11} fill="currentColor" />
                <span>Jump to speech ({formatTimestamp(firstSpeechTime)})</span>
              </button>
            )}

            {/* Playback Speed */}
            {onChangeSpeed && (
              <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700/60 text-[10px] font-bold">
                {[0.75, 1, 1.25, 1.5, 2].map((spd) => (
                  <button
                    key={spd}
                    onClick={() => onChangeSpeed(spd)}
                    className={`px-1.5 py-0.5 rounded transition ${
                      playbackSpeed === spd 
                        ? "bg-[#14B8A6] text-white shadow-xs font-extrabold" 
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            )}

            {/* Volume Control */}
            <div className="flex items-center gap-1.5 bg-slate-800/80 px-2 py-1 rounded-lg border border-slate-700/60">
              <button
                onClick={handleToggleMute}
                className="text-slate-300 hover:text-white transition"
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <VolumeX size={13} className="text-rose-400" /> : <Volume2 size={13} />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volumeLevel}
                onChange={handleVolumeSlider}
                className="w-14 h-1 bg-slate-600 rounded-lg accent-[#14B8A6] cursor-pointer"
                title={`Volume: ${Math.round((isMuted ? 0 : volumeLevel) * 100)}%`}
              />
            </div>

            {/* Direct Audio File Download / Source */}
            {audioUrl && (
              <a
                href={audioUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="h-8 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
                title="Download or open meeting audio recording"
              >
                <Download size={12} />
                <span className="hidden sm:inline text-[11px]">Audio</span>
              </a>
            )}
          </div>
        </div>

        {/* Progress / Seek Scrubber Bar */}
        <div className="relative flex flex-col gap-1 pt-1">
          <div
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              handleSeek(ratio * (totalDuration || 1));
            }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              setScrubberHoverTime(ratio * (totalDuration || 1));
              setScrubberHoverX(e.clientX - rect.left);
            }}
            onMouseLeave={() => setScrubberHoverTime(null)}
            className="w-full h-3 bg-slate-800 hover:h-4 rounded-full cursor-pointer relative overflow-hidden transition-all group flex items-center border border-slate-700/50"
          >
            {/* Played Progress Track */}
            <div
              className="bg-gradient-to-r from-[#14B8A6] to-[#06B6D4] h-full rounded-full transition-all relative"
              style={{
                width: `${totalDuration > 0 ? Math.min(100, Math.max(0, (currentTime / totalDuration) * 100)) : 0}%`
              }}
            >
              {/* Playhead handle indicator */}
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full shadow-md" />
            </div>

            {/* Hover Tooltip */}
            {scrubberHoverTime !== null && (
              <div
                className="absolute -top-7 -translate-x-1/2 bg-black/90 text-white text-[10px] font-mono px-1.5 py-0.5 rounded shadow pointer-events-none border border-slate-700"
                style={{ left: `${scrubberHoverX}px` }}
              >
                {formatTimestamp(scrubberHoverTime)}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Secondary Bar: Search & Text Mode */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E7EB] pb-3 select-none">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">
            Transcript
          </span>
          <span className="text-[11px] text-[#94A3B8]">
            • {segments.length} utterance segment{segments.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Search Box */}
          <div className="relative flex items-center">
            <Search size={12} className="absolute left-2.5 text-[#94A3B8]" />
            <input 
              type="text"
              placeholder="Search transcript..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-48 sm:w-56 bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg pl-7 pr-7 py-1 h-7 text-xs text-[#0F172A] outline-none placeholder-[#94A3B8] focus:border-[#14B8A6] focus:bg-white transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 text-[#94A3B8] hover:text-[#0F172A]"
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Original vs Corrected Toggle */}
          <button
            onClick={() => setShowOriginal(!showOriginal)}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition flex items-center gap-1 ${
              showOriginal 
                ? "bg-amber-50 text-amber-800 border-amber-200" 
                : "bg-[#F8FAFC] text-[#64748B] border-[#E5E7EB] hover:bg-white"
            }`}
            title={showOriginal ? "Showing raw Whisper transcript" : "Showing corrected transcript"}
          >
            <RotateCcw size={10} />
            <span>{showOriginal ? "Raw Whisper" : "Corrected"}</span>
          </button>
        </div>
      </div>

      {/* Aggregate Cohesive Dialogue Display */}
      <div className="space-y-4 overflow-y-auto max-h-[64vh] pr-1.5 scroll-thin">
        {groupedTurns.length === 0 ? (
          <div className="text-center py-16 text-[#94A3B8] text-xs select-none space-y-1">
            <Volume2 size={24} className="mx-auto text-[#CBD5E1] mb-2" />
            <p className="font-semibold text-[#475569]">No dialogue segments match search filter.</p>
            <p className="text-[11px] text-[#94A3B8]">Clear or adjust your search term to see the transcript.</p>
          </div>
        ) : (
          groupedTurns.map((turn, turnIdx) => {
            const colorTheme = getSpeakerColor(turn.speakerName);
            const initials = getInitials(turn.speakerName);
            const role = getSpeakerRole(turn.speakerId, turn.speakerName);

            // Check if any segment within this turn is currently playing
            const isTurnPlaying = turn.segments.some(seg => isSegmentActive(seg.start_time, seg.end_time));

            return (
              <div 
                key={turnIdx} 
                className={`p-4 rounded-xl border transition-all duration-150 space-y-2.5 ${
                  isTurnPlaying
                    ? 'bg-white border-[#14B8A6]/40 shadow-sm ring-1 ring-[#14B8A6]/20'
                    : 'bg-white border-[#E2E8F0]/80 hover:border-[#CBD5E1] hover:shadow-3xs'
                }`}
              >
                {/* Speaker Turn Header */}
                <div className="flex items-center justify-between select-none">
                  <div className="flex items-center gap-2.5">
                    {/* Speaker Initials Avatar */}
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] border shadow-3xs flex-shrink-0 ${colorTheme.avatar}`}>
                      {initials}
                    </div>

                    {/* Speaker Name / Inline Rename */}
                    {editingSpeakerId === turn.speakerId ? (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editingSpeakerName}
                          onChange={(e) => setEditingSpeakerName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditSpeaker(turn.speakerId);
                            if (e.key === 'Escape') setEditingSpeakerId(null);
                          }}
                          className="bg-white border border-[#14B8A6] rounded px-2 py-0.5 text-xs font-bold text-[#0F172A] outline-none shadow-3xs"
                          autoFocus
                        />
                        <button
                          onClick={() => saveEditSpeaker(turn.speakerId)}
                          className="p-1 bg-[#14B8A6] hover:bg-[#0D9488] text-white rounded shadow-3xs"
                          title="Save Speaker Name"
                        >
                          <Check size={12} />
                        </button>
                        <button
                          onClick={() => setEditingSpeakerId(null)}
                          className="p-1 bg-slate-100 hover:bg-slate-200 text-[#64748B] rounded"
                          title="Cancel"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div 
                        onClick={() => startEditSpeaker(turn.speakerId, turn.speakerName)}
                        className="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition group/speaker"
                        title="Click to rename speaker"
                      >
                        <span className={`text-xs font-extrabold ${colorTheme.text}`}>
                          {turn.speakerName}
                        </span>
                        {!readOnly && (
                          <Edit2 size={11} className="text-[#94A3B8] opacity-0 group-hover/speaker:opacity-100 hover:text-[#14B8A6] transition" />
                        )}
                      </div>
                    )}

                    {/* Speaker Role Badge */}
                    {turn.role && turn.role !== 'unknown' && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                        turn.role === 'sales_rep' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        turn.role === 'buyer' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        turn.role === 'customer' || turn.role === 'prospect' ? 'bg-cyan-50 text-cyan-700 border-cyan-200' :
                        'bg-slate-50 text-slate-700 border-slate-200'
                      }`}>
                        {turn.role.replace(/_/g, ' ')}
                      </span>
                    )}

                    {/* Organization Tag */}
                    {turn.organization && (
                      <span className="text-[10px] text-slate-500 font-medium">
                        ({turn.organization})
                      </span>
                    )}

                    {/* Attribution Source Badge */}
                    {turn.attributionSource && (
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        turn.attributionSource === 'google_meet_csrc' ? 'bg-emerald-100 text-emerald-800' :
                        turn.attributionSource === 'zoom_user_id' ? 'bg-blue-100 text-blue-800' :
                        turn.attributionSource === 'teams_participant' ? 'bg-indigo-100 text-indigo-800' :
                        turn.attributionSource === 'manual' ? 'bg-amber-100 text-amber-800' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {turn.attributionSource.replace(/_/g, ' ')} {turn.attributionConfidence ? `• ${Math.round(turn.attributionConfidence * 100)}%` : ''}
                      </span>
                    )}
                  </div>

                  {/* Clean Turn Start Timestamp Button */}
                  <button
                    type="button"
                    onClick={() => handleSeek(turn.startTime)}
                    className="text-[11px] font-mono font-medium text-[#64748B] hover:text-[#0D9488] bg-[#F8FAFC] hover:bg-[#E6F4F1] border border-[#E2E8F0] px-2 py-0.5 rounded-md transition flex items-center gap-1"
                    title={`Jump to start of turn (${formatTimestamp(turn.startTime)})`}
                  >
                    <Clock size={10} className="text-[#94A3B8]" />
                    <span>[{formatTimestamp(turn.startTime)}]</span>
                  </button>
                </div>

                {/* Cohesive Dialogue Paragraph */}
                <div className="text-[13px] leading-relaxed text-[#334155] pl-9.5">
                  {turn.segments.map((seg) => {
                    const active = isSegmentActive(seg.start_time, seg.end_time);
                    const isEvidenceActive = activeHighlightSegmentId === seg.id;
                    const origText = seg.original_text || seg.text || '';
                    const corrText = seg.corrected_text || seg.text || '';
                    const isEdited = !showOriginal && origText && corrText && origText !== corrText;
                    const textToRender = showOriginal ? origText : corrText;

                    // Inline Editor when double-clicked
                    if (editingSegmentId === seg.id) {
                      return (
                        <div key={seg.id} className="block my-2.5 p-2 bg-[#FAFBFB] border-2 border-[#14B8A6] rounded-xl shadow-xs" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-between text-[10px] font-mono text-[#64748B] mb-1.5 font-bold">
                            <span>Editing utterance [{formatTimestamp(seg.start_time)} - {formatTimestamp(seg.end_time)}]</span>
                            <span>Esc to cancel</span>
                          </div>
                          <textarea
                            value={editingSegmentText}
                            onChange={(e) => setEditingSegmentText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                saveEditSegment(seg.id);
                              }
                              if (e.key === 'Escape') setEditingSegmentId(null);
                            }}
                            className="w-full min-h-[60px] bg-white border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] p-2 leading-relaxed outline-none resize-y focus:border-[#14B8A6]"
                            autoFocus
                          />
                          <div className="flex gap-2 justify-end mt-2">
                            <button 
                              onClick={() => saveEditSegment(seg.id)}
                              className="bg-[#14B8A6] hover:bg-[#0D9488] text-white rounded px-3 py-1 text-xs font-bold shadow-3xs transition"
                            >
                              Save Correction
                            </button>
                            <button 
                              onClick={() => setEditingSegmentId(null)}
                              className="border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] rounded px-3 py-1 text-xs text-[#64748B] transition"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      );
                    }

                    // Render segment chunk inline as part of the paragraph
                    return (
                      <span
                        key={seg.id}
                        id={`main-seg-${seg.id}`}
                        onClick={() => handleSeek(seg.start_time)}
                        onDoubleClick={() => startEditSegment(seg.id, corrText)}
                        title={`[${formatTimestamp(seg.start_time)} - ${formatTimestamp(seg.end_time)}] Click to seek audio • Double-click to edit`}
                        className={`inline cursor-pointer rounded px-1 py-0.5 transition-all duration-150 mr-1 select-text ${
                          active
                            ? 'bg-[#14B8A6]/20 text-[#0F172A] font-semibold ring-1 ring-[#14B8A6]/50 shadow-3xs'
                            : isEvidenceActive
                              ? 'bg-amber-100/90 text-amber-950 font-semibold ring-1 ring-amber-400'
                              : 'hover:bg-[#F1F5F9] hover:text-[#0F172A]'
                        }`}
                      >
                        {renderHighlightedContent(textToRender, isEvidenceActive, active)}
                        {isEdited && (
                          <span 
                            className="ml-1 inline-flex items-center text-[9px] bg-slate-100 text-slate-500 font-mono px-1 rounded cursor-help border border-slate-200 select-none align-baseline"
                            title={`Original Whisper: "${origText}"`}
                          >
                            edited
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Tip */}
      <div className="flex items-center gap-1.5 text-[11px] text-[#94A3B8] italic pt-1 border-t border-[#F1F5F9] select-none">
        <Sparkles size={12} className="text-[#14B8A6]" />
        <span>Click any dialogue sentence or timestamp to seek audio. Double-click to correct text. Click speaker names to rename.</span>
      </div>
    </div>
  );
}

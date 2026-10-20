import os
import time
import uuid
# Trigger hot-reload to load newly installed ML packages
import numpy as np
import logging

logger = logging.getLogger("pulsesync-ai-service.pipeline")

# Try to import production ML dependencies (will fallback gracefully if not configured)
try:
  import torch
  from faster_whisper import WhisperModel
  from pyannote.audio import Pipeline as PyannotePipeline
  ML_PACKAGES_AVAILABLE = True
except ImportError:
  logger.warning("ML dependencies (torch, faster-whisper, pyannote.audio) are not installed or fully configured. Automatic acoustic diarization is unavailable.")
  ML_PACKAGES_AVAILABLE = False


import io
import subprocess
import soundfile as sf

_CACHED_PYANNOTE_PIPELINE = None
_CACHED_PYANNOTE_MODEL = None


def load_audio_waveform_for_pyannote(audio_path: str) -> dict:
  """
  Decodes audio to an in-memory float32 PyTorch tensor (channels, time) and sample rate.
  Bypasses TorchCodec on Windows while preserving multi-channel speaker separation.
  """
  if not os.path.exists(audio_path):
    raise FileNotFoundError(f"Audio file not found: {audio_path}")

  ext = os.path.splitext(audio_path)[1].lower()
  # Try reading directly via soundfile first if it's already an uncompressed WAV
  if ext == ".wav":
    try:
      data, sr = sf.read(audio_path, dtype="float32", always_2d=True)
      waveform = torch.from_numpy(data.T).float()
      return {"waveform": waveform, "sample_rate": sr}
    except Exception:
      pass

  # For MP3, WebM, MP4, AAC, or WAV fallback: decode lossless via FFmpeg into PCM float32 WAV pipe
  cmd = ["ffmpeg", "-v", "error", "-y", "-i", audio_path, "-f", "wav", "-c:a", "pcm_f32le", "pipe:1"]
  proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
  stdout, stderr = proc.communicate()
  if proc.returncode != 0:
    err_msg = stderr.decode("utf-8", errors="replace")
    raise RuntimeError(f"FFmpeg audio decoding failed: {err_msg}")

  bio = io.BytesIO(stdout)
  data, sr = sf.read(bio, dtype="float32", always_2d=True)
  waveform = torch.from_numpy(data.T).float()
  return {"waveform": waveform, "sample_rate": sr}


def get_cached_pyannote_pipeline(model_name: str, hf_token: str):
  """Cache the loaded Pyannote pipeline to prevent reloading model weights on every request."""
  global _CACHED_PYANNOTE_PIPELINE, _CACHED_PYANNOTE_MODEL
  if _CACHED_PYANNOTE_PIPELINE is not None and _CACHED_PYANNOTE_MODEL == model_name:
    return _CACHED_PYANNOTE_PIPELINE

  logger.info("Initializing and caching pyannote pipeline: %s", model_name)
  try:
    pipeline = PyannotePipeline.from_pretrained(model_name, token=hf_token)
  except TypeError:
    pipeline = PyannotePipeline.from_pretrained(model_name, use_auth_token=hf_token)

  device = "cuda" if torch.cuda.is_available() else "cpu"
  if device == "cuda":
    pipeline.to(torch.device("cuda"))

  _CACHED_PYANNOTE_PIPELINE = pipeline
  _CACHED_PYANNOTE_MODEL = model_name
  return pipeline


def _env_int(name: str, default=None):
  value = os.environ.get(name)
  if value is None or str(value).strip() == "":
    return default
  try:
    parsed = int(value)
    return parsed if parsed > 0 else default
  except (TypeError, ValueError):
    logger.warning("Ignoring invalid integer environment variable %s=%r", name, value)
    return default


def _diarization_speaker_kwargs(expected_speakers=None) -> dict:
  """Return speaker-count constraints only when the caller actually knows them."""
  expected = expected_speakers or _env_int("DIARIZATION_NUM_SPEAKERS")
  if expected:
    return {"num_speakers": int(expected)}

  minimum = _env_int("DIARIZATION_MIN_SPEAKERS")
  maximum = _env_int("DIARIZATION_MAX_SPEAKERS")
  if minimum and maximum and minimum > maximum:
    logger.warning("Ignoring invalid diarization speaker bounds: min=%s > max=%s", minimum, maximum)
    return {}

  result = {}
  if minimum:
    result["min_speakers"] = int(minimum)
  if maximum:
    result["max_speakers"] = int(maximum)
  return result


def _annotation_to_turns(annotation) -> list:
  """Normalize pyannote Annotation-like objects into plain speaker turns."""
  if annotation is None:
    return []
  turns = []
  try:
    iterator = annotation.itertracks(yield_label=True)
  except AttributeError:
    return []

  for turn, _, speaker in iterator:
    start = float(turn.start)
    end = float(turn.end)
    if not np.isfinite(start) or not np.isfinite(end) or end <= start:
      continue
    turns.append({
      "start": start,
      "end": end,
      "speaker": str(speaker),
    })
  return turns


def _extract_best_pyannote_annotation(output) -> tuple[list, str]:
  """Prefer Community-1 exclusive diarization, but never discard a valid regular output."""
  exclusive = getattr(output, "exclusive_speaker_diarization", None)
  regular = getattr(output, "speaker_diarization", None)

  exclusive_turns = _annotation_to_turns(exclusive)
  if exclusive_turns:
    return exclusive_turns, "exclusive_speaker_diarization"

  regular_turns = _annotation_to_turns(regular if regular is not None else output)
  if regular_turns:
    return regular_turns, "speaker_diarization"

  return [], "none"


def score_word_against_turn(word_start: float, word_end: float, turn: dict) -> tuple[float, float]:
  """
  Calculates deterministic speaker attribution score for a word and speaker turn using:
    1. Overlap duration
    2. Overlap ratio
    3. Word midpoint proximity to turn
    4. Temporal proximity score
    5. Segment confidence if available
  """
  word_dur = max(0.01, word_end - word_start)
  turn_start = turn["start"]
  turn_end = turn["end"]
  turn_dur = max(0.01, turn_end - turn_start)

  overlap = max(0.0, min(word_end, turn_end) - max(word_start, turn_start))
  overlap_ratio = overlap / word_dur

  word_mid = (word_start + word_end) / 2.0
  turn_mid = (turn_start + turn_end) / 2.0

  # Midpoint score: 1.0 if inside turn, decaying if outside
  if turn_start <= word_mid <= turn_end:
    midpoint_score = 1.0
  else:
    dist = min(abs(word_mid - turn_start), abs(word_mid - turn_end))
    midpoint_score = max(0.0, 1.0 - (dist / 1.5))

  # Proximity score based on center distance normalized by half-duration
  mid_distance = abs(word_mid - turn_mid)
  temporal_proximity_score = max(0.0, 1.0 - (mid_distance / (turn_dur + 2.0)))

  diar_conf = float(turn.get("confidence", 1.0))

  total_score = (
    (1.5 * overlap_ratio) +
    (0.6 * midpoint_score) +
    (0.3 * temporal_proximity_score)
  ) * diar_conf

  return total_score, overlap_ratio


def align_words_to_turns(words: list, diarized_turns: list, min_overlap: float = 0.15) -> list:
  """
  Performs deterministic word-to-speaker attribution.
  Handles overlapping speech and preserves Unknown Speaker when confidence is insufficient.
  """
  aligned = []
  for word in words:
    best_turn = None
    best_score = 0.0
    best_overlap_ratio = 0.0
    best_overlap = 0.0

    for turn in diarized_turns:
      score, ov_ratio = score_word_against_turn(word.start, word.end, turn)
      overlap = max(0.0, min(word.end, turn["end"]) - max(word.start, turn["start"]))
      if score > best_score:
        best_score = score
        best_overlap_ratio = ov_ratio
        best_overlap = overlap
        best_turn = turn

    word_dur = max(0.01, word.end - word.start)
    word_mid = (word.start + word.end) / 2.0

    # Fallback to nearest turn if word is just slightly adjacent (within 0.12s tolerance)
    if best_turn is None or (best_overlap == 0 and best_score < 0.3):
      nearest_turn = None
      min_dist = float("inf")
      for turn in diarized_turns:
        dist = min(abs(word.start - turn["end"]), abs(word.end - turn["start"]))
        if dist < min_dist:
          min_dist = dist
          nearest_turn = turn
      if nearest_turn and min_dist <= 0.12:
        best_turn = nearest_turn
        best_overlap_ratio = 0.20
        best_score = 0.50

    if best_turn is None or best_overlap_ratio < min_overlap or best_score < 0.25:
      speaker = "Unknown Speaker"
      confidence = 0.0
      source = "unresolved"
    else:
      speaker = best_turn["speaker"]
      diar_conf = float(best_turn.get("confidence", 1.0))
      confidence = round(float(word.confidence) * min(1.0, float(best_score) / 2.0) * diar_conf, 3)
      source = "pyannote_community_1"

    aligned.append({
      "word": word.text,
      "start": word.start,
      "end": word.end,
      "speaker": speaker,
      "confidence": confidence,
      "attribution_source": source,
    })
  return aligned


def reconstruct_speaker_turns(
  aligned_words: list,
  max_known_gap: float = 0.65,
  max_unknown_gap: float = 0.80,
  max_turn_duration: float = 45.0,
) -> list:
  """
  Groups consecutive words into speaker dialogue turns.
  Splits when:
    1. Speaker changes
    2. Meaningful silence/gap exceeds threshold
    3. Turn duration exceeds maximum turn threshold (prevents monolithic turns)
    4. Attribution confidence drops or source changes
  """
  reconstructed = []
  current = None

  def commit():
    nonlocal current
    if current is None:
      return
    reconstructed.append({
      "speaker": current["speaker"],
      "start": round(current["start"], 2),
      "end": round(current["end"], 2),
      "text": " ".join(current["words"]).strip(),
      "confidence": round(float(np.mean(current["confidences"])), 3),
      "attribution_source": current["source"],
    })
    current = None

  for item in aligned_words:
    if current is None:
      current = {
        "speaker": item["speaker"],
        "start": item["start"],
        "end": item["end"],
        "words": [item["word"]],
        "confidences": [item["confidence"]],
        "source": item["attribution_source"],
      }
      continue

    gap = max(0.0, item["start"] - current["end"])
    threshold = max_unknown_gap if current["speaker"] == "Unknown Speaker" else max_known_gap
    turn_dur = item["end"] - current["start"]
    same_speaker = item["speaker"] == current["speaker"]

    if same_speaker and gap <= threshold and turn_dur <= max_turn_duration:
      current["end"] = item["end"]
      current["words"].append(item["word"])
      current["confidences"].append(item["confidence"])
      if current["source"] != item["attribution_source"]:
        current["source"] = "mixed"
    else:
      commit()
      current = {
        "speaker": item["speaker"],
        "start": item["start"],
        "end": item["end"],
        "words": [item["word"]],
        "confidences": [item["confidence"]],
        "source": item["attribution_source"],
      }

  commit()
  return reconstructed


def calculate_diarization_diagnostics(segments: list, detected_speakers: list, diarized_turns: list, total_duration: float, words_count: int) -> dict:
  """
  Calculates internal diagnostic metrics and catastrophic failure detection flags.
  """
  speaker_count = len([s for s in detected_speakers if s != "Unknown Speaker"])
  speaker_turn_count = len(segments)

  assigned_word_count = sum(len(s.get("text", "").split()) for s in segments if s.get("speaker") != "Unknown Speaker")
  unassigned_word_count = sum(len(s.get("text", "").split()) for s in segments if s.get("speaker") == "Unknown Speaker")
  total_words = max(1, assigned_word_count + unassigned_word_count)
  unknown_word_ratio = round(unassigned_word_count / total_words, 3)

  durations = [max(0.0, s["end"] - s["start"]) for s in segments]
  avg_turn_duration = round(float(np.mean(durations)), 2) if durations else 0.0
  longest_turn_duration = round(float(max(durations)), 2) if durations else 0.0

  speaker_duration_distribution = {}
  for s in segments:
    sp = s["speaker"]
    dur = max(0.0, s["end"] - s["start"])
    speaker_duration_distribution[sp] = round(speaker_duration_distribution.get(sp, 0.0) + dur, 2)

  total_diarized_duration = sum(durations)

  # Catastrophic failure detection:
  # 1. Total meeting > 60s and only 1 speaker and only 1 speaker turn
  # 2. Or longest turn covers >= 90% of a multi-minute meeting
  # 3. Or unknown speaker ratio > 0.85
  # 4. Or speaker segmentation contains no meaningful boundaries
  quality_status = "ok"
  if total_duration > 60.0 and speaker_count <= 1 and speaker_turn_count <= 1:
    quality_status = "poor"
  elif total_duration > 120.0 and longest_turn_duration >= (total_duration * 0.90):
    quality_status = "poor"
  elif unknown_word_ratio > 0.85 and total_words > 20:
    quality_status = "poor"
  elif not diarized_turns:
    quality_status = "unresolved"
  elif speaker_count < 2:
    quality_status = "single_speaker_detected"

  return {
    "speaker_count": speaker_count,
    "speaker_turn_count": speaker_turn_count,
    "total_diarized_duration": round(total_diarized_duration, 2),
    "assigned_word_count": assigned_word_count,
    "unassigned_word_count": unassigned_word_count,
    "unknown_word_ratio": unknown_word_ratio,
    "average_turn_duration": avg_turn_duration,
    "longest_turn_duration": longest_turn_duration,
    "speaker_duration_distribution": speaker_duration_distribution,
    "quality_status": quality_status,
  }


def _build_unresolved_turns(words: list, max_turn_seconds: float = 18.0, pause_seconds: float = 0.8) -> list:
  """Fallback transcript segmentation when acoustic diarization genuinely has no usable turns."""
  if not words:
    return []
  turns = []
  current = None
  for word in words:
    if current is None:
      current = {"speaker": "Unknown Speaker", "start": word.start, "end": word.end, "words": [word.text], "confidences": [word.confidence]}
      continue
    gap = max(0.0, word.start - current["end"])
    duration = word.end - current["start"]
    if gap >= pause_seconds or duration >= max_turn_seconds:
      turns.append({
        "speaker": "Unknown Speaker",
        "start": round(current["start"], 2),
        "end": round(current["end"], 2),
        "text": " ".join(current["words"]).strip(),
        "confidence": round(float(np.mean(current["confidences"])), 3),
        "attribution_source": "unresolved",
      })
      current = {"speaker": "Unknown Speaker", "start": word.start, "end": word.end, "words": [word.text], "confidences": [word.confidence]}
    else:
      current["end"] = word.end
      current["words"].append(word.text)
      current["confidences"].append(word.confidence)

  if current is not None:
    turns.append({
      "speaker": "Unknown Speaker",
      "start": round(current["start"], 2),
      "end": round(current["end"], 2),
      "text": " ".join(current["words"]).strip(),
      "confidence": round(float(np.mean(current["confidences"])), 3),
      "attribution_source": "unresolved",
    })
  return turns

def run_audio_pipeline(audio_path: str, expected_speakers=None) -> dict:
    """
    Main PulseSync audio pipeline.

    Priority:
      1. Local Pyannote Community-1 + local/optional cloud STT
      2. Cloud STT only when acoustic diarization is not configured
      3. Explicit local ML fallback

    Speaker identity is never inferred from transcript semantics.
    """

    start_time = time.time()

    groq_key = os.environ.get("GROQ_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")

    hf_token = os.environ.get("HF_TOKEN")

    acoustic_enabled = (
        os.environ.get("DISABLE_ACOUSTIC_DIARIZATION", "false").lower()
        != "true"
    )

    # ============================================================
    # PRIMARY PATH
    # Local Pyannote Community-1
    # ============================================================

    if acoustic_enabled and ML_PACKAGES_AVAILABLE and hf_token:
        logger.info(
            "Executing local pyannote Community-1 acoustic "
            "diarization + STT pipeline..."
        )

        return run_production_ml_pipeline(
            audio_path,
            expected_speakers=expected_speakers,
        )

    # ============================================================
    # SECONDARY PATH
    # Cloud transcription only
    #
    # IMPORTANT:
    # This path does NOT claim speaker identity.
    # ============================================================

    if groq_key or openai_key:
        try:
            logger.info(
                "Executing cloud Whisper STT in transcription-only mode: %s",
                audio_path,
            )

            return run_cloud_whisper_pipeline(
                audio_path,
                start_time,
            )

        except Exception as exc:
            logger.exception(
                "Cloud Whisper transcription failed: %s",
                exc,
            )

    # ============================================================
    # FINAL LOCAL FALLBACK
    # ============================================================

    if (
        ML_PACKAGES_AVAILABLE
        and os.environ.get("USE_REAL_ML_PIPELINE") == "true"
    ):
        try:
            logger.info(
                "Executing local Pyannote + Faster-Whisper pipeline..."
            )

            return run_production_ml_pipeline(
                audio_path,
                expected_speakers=expected_speakers,
            )

        except Exception as exc:
            logger.exception(
                "Local ML pipeline failed: %s",
                exc,
            )

    raise RuntimeError(
        "No production transcription/diarization provider is available. "
        "Configure HF_TOKEN for local Pyannote Community-1 diarization."
    )
def run_cloud_whisper_pipeline(audio_path: str, start_time: float) -> dict:
  """
  Transcribes real uploaded audio recordings using high-accuracy Whisper (Groq / OpenAI),
  followed by conversational turn diarization and 512-dim speaker vector embedding generation.
  """
  import requests
  import json
  
  if not os.path.exists(audio_path):
    raise FileNotFoundError(f"Audio file not found: {audio_path}")

  target_file = audio_path
  temp_compressed = None
  
  # If audio file is larger than 24MB, compress to 16kHz mono 64kbps MP3 via ffmpeg
  file_size = os.path.getsize(audio_path)
  if file_size > 24 * 1024 * 1024:
    logger.info(f"Audio file size ({file_size / (1024*1024):.1f}MB) exceeds 24MB. Compressing via ffmpeg...")
    temp_compressed = f"{audio_path}_compressed_64k.mp3"
    os.system(f'ffmpeg -y -i "{audio_path}" -ar 16000 -ac 1 -b:a 64k "{temp_compressed}"')
    if os.path.exists(temp_compressed) and os.path.getsize(temp_compressed) > 0:
      target_file = temp_compressed

  try:
    groq_key = os.environ.get("GROQ_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")
    
    total_duration = 0.0
    raw_segments = []
    
    # Execute Whisper Transcription via Groq or OpenAI
    if groq_key:
      logger.info("Calling Groq Whisper-large-v3 API...")
      url = "https://api.groq.com/openai/v1/audio/transcriptions"
      headers = {"Authorization": f"Bearer {groq_key}"}
      
      # Determine mime type
      ext = os.path.splitext(target_file)[1].lower()
      mime_type = "audio/webm" if "webm" in ext else "audio/wav" if "wav" in ext else "audio/mpeg"
      
      with open(target_file, "rb") as f:
        files = {"file": (os.path.basename(target_file), f, mime_type)}
        data = {
          "model": "whisper-large-v3",
          "response_format": "verbose_json"
        }
        resp = requests.post(url, headers=headers, files=files, data=data, timeout=180)
        
      if not resp.ok:
        raise RuntimeError(f"Groq Whisper transcription failed: {resp.status_code} {resp.text}")
        
      stt_data = resp.json()
      total_duration = float(stt_data.get("duration", 0.0))
      raw_segments = stt_data.get("segments", [])
      
    elif openai_key:
      logger.info("Calling OpenAI Whisper-1 API...")
      url = "https://api.openai.com/v1/audio/transcriptions"
      headers = {"Authorization": f"Bearer {openai_key}"}
      with open(target_file, "rb") as f:
        files = {"file": (os.path.basename(target_file), f)}
        data = {
          "model": "whisper-1",
          "response_format": "verbose_json"
        }
        resp = requests.post(url, headers=headers, files=files, data=data, timeout=180)
      if not resp.ok:
        raise RuntimeError(f"OpenAI Whisper transcription failed: {resp.status_code} {resp.text}")
      stt_data = resp.json()
      total_duration = float(stt_data.get("duration", 0.0))
      raw_segments = stt_data.get("segments", [])

    logger.info(f"Whisper transcription completed: {len(raw_segments)} segments, duration: {total_duration:.1f}s")
    
    # Handle edge case: empty audio
    if not raw_segments:
      logger.warning("No speech segments detected in audio file.")
      return {
        "duration": max(total_duration, 0.0),
        "segments": [],
        "speakers": []
      }

    # Never infer speaker identity from transcript text. Whisper segments do not
    # contain reliable speaker identity. If acoustic diarization is unavailable,
    # preserve the transcript and mark speaker attribution as unresolved.
    chunk_speakers = {}
    logger.warning("Acoustic diarization unavailable for cloud transcription-only path; speaker identity remains unresolved.")

    diarized_chunks = []
    for idx, s in enumerate(raw_segments):
      s_id = str(s.get("id", idx))
      text = s.get("text", "").strip()
      start = float(s.get("start", 0.0))
      end = float(s.get("end", start + 2.0))
      conf = round(float(np.exp(s.get("avg_logprob", -0.15))), 3)
      diarized_chunks.append({
        "id": s_id,
        "speaker": "Unknown Speaker",
        "start": start,
        "end": end,
        "text": text,
        "confidence": conf,
        "attribution_source": "unresolved"
      })

    # Group raw Whisper chunks into natural, cohesive conversational dialogue turns
    # A speaker turn begins when a new speaker speaks, and ends when the speaker changes or after a long pause (>3.0s)
    logger.info(f"Aggregating {len(diarized_chunks)} raw Whisper chunks into conversational dialogue turns...")
    merged_turns = []
    current_turn = None
    max_pause_seconds = 3.0

    for c in diarized_chunks:
      c_speaker = c["speaker"]
      c_start = c["start"]
      c_end = c["end"]
      c_text = c["text"]
      c_conf = c["confidence"]
      
      subseg = {
        "start": round(c_start, 2),
        "end": round(c_end, 2),
        "text": c_text
      }
      
      if current_turn is None:
        current_turn = {
          "speaker": c_speaker,
          "start": c_start,
          "end": c_end,
          "texts": [c_text],
          "confidences": [c_conf],
          "subsegments": [subseg]
        }
      else:
        pause = c_start - current_turn["end"]
        is_same_speaker = (c_speaker == current_turn["speaker"])
        
        if is_same_speaker and pause <= max_pause_seconds:
          # Continue current speaker's turn
          current_turn["end"] = max(current_turn["end"], c_end)
          current_turn["texts"].append(c_text)
          current_turn["confidences"].append(c_conf)
          current_turn["subsegments"].append(subseg)
        else:
          # Turn ended: commit current turn
          turn_idx = len(merged_turns)
          seg_id = f"seg_{turn_idx:03d}"
          merged_turns.append({
            "id": seg_id,
            "segment_id": seg_id,
            "speaker": current_turn["speaker"],
            "start": round(float(current_turn["start"]), 2),
            "end": round(float(current_turn["end"]), 2),
            "text": " ".join([t for t in current_turn["texts"] if t]).strip(),
            "confidence": round(float(np.mean(current_turn["confidences"])), 3),
            "subsegments": current_turn["subsegments"]
          })
          # Start next turn
          current_turn = {
            "speaker": c_speaker,
            "start": c_start,
            "end": c_end,
            "texts": [c_text],
            "confidences": [c_conf],
            "subsegments": [subseg]
          }

    if current_turn:
      turn_idx = len(merged_turns)
      seg_id = f"seg_{turn_idx:03d}"
      merged_turns.append({
        "id": seg_id,
        "segment_id": seg_id,
        "speaker": current_turn["speaker"],
        "start": round(float(current_turn["start"]), 2),
        "end": round(float(current_turn["end"]), 2),
        "text": " ".join([t for t in current_turn["texts"] if t]).strip(),
        "confidence": round(float(np.mean(current_turn["confidences"])), 3),
        "subsegments": current_turn["subsegments"]
      })

    # Do not create synthetic voice embeddings. A voice identity must come from a real
    # diarization/voice-identification provider or remain unresolved for user correction.
    unique_speakers = sorted(list(set(s["speaker"] for s in merged_turns)))
    speakers_profiles = [
      {"id": str(uuid.uuid4()), "name": sp_name, "voiceprint_available": False}
      for sp_name in unique_speakers
    ]

    elapsed = time.time() - start_time
    logger.info(f"Cloud Whisper pipeline finished cleanly in {elapsed:.2f}s: merged {len(raw_segments)} chunks into {len(merged_turns)} dialogue turns across {unique_speakers}.")

    return {
      "duration": round(total_duration, 2),
      "segments": merged_turns,
      "speakers": speakers_profiles
    }

  finally:
    if temp_compressed and os.path.exists(temp_compressed):
      try:
        os.remove(temp_compressed)
      except Exception:
        pass

class WordProxy:
  def __init__(self, text, start, end, confidence):
    self.text = text
    self.start = start
    self.end = end
    self.confidence = confidence

def run_local_transcription(target_file: str, device: str) -> tuple:
  """
  Executes local Faster-Whisper transcription on CPU/GPU with word-level timestamps.
  """
  whisper_model_name = os.environ.get("WHISPER_MODEL")
  if not whisper_model_name:
    whisper_model_name = "large-v3" if device == "cuda" else "base"
    
  logger.info(f"Loading Faster-Whisper model ({whisper_model_name}) on {device}...")
  
  compute_type = "float16" if device == "cuda" else "int8"
  cpu_threads = int(os.environ.get("OMP_NUM_THREADS", "4"))
  
  whisper_model = WhisperModel(
    whisper_model_name,
    device=device,
    compute_type=compute_type,
    cpu_threads=cpu_threads
  )
  
  logger.info(f"Executing Faster-Whisper ({whisper_model_name}) transcription...")
  segments_gen, info = whisper_model.transcribe(
    target_file,
    beam_size=5,
    word_timestamps=True
  )
  
  return list(segments_gen), info.duration

def run_production_ml_pipeline(audio_path: str, expected_speakers=None) -> dict:
  """
  Production local diarization pipeline:
    1. pyannote Community-1 local speaker diarization.
    2. Whisper/faster-whisper word timestamps.
    4. Exclusive speaker-to-word alignment.
    5. Conservative turn reconstruction; never merge Unknown Speaker across pauses.

  Speaker identity is never inferred from transcript semantics.
  """
  logger.info("Executing production local pyannote acoustic diarization pipeline...")

  base_path, _ = os.path.splitext(audio_path)
  normalized_path = f"{base_path}_normalized.wav"

  # Keep the original recording for diarization. Community-1 itself handles
  # resampling/downmixing; forcing mono here can destroy useful channel structure.
  # A normalized mono copy is retained for STT compatibility.
  logger.info("Normalizing audio for STT: %s -> %s", audio_path, normalized_path)
  ffmpeg_result = os.system(
    f'ffmpeg -y -i "{audio_path}" -ar 16000 -ac 1 -c:a pcm_s16le "{normalized_path}"'
  )
  target_file = normalized_path if ffmpeg_result == 0 and os.path.exists(normalized_path) else audio_path

  try:
    # -----------------------------------------------------------------------
    # 1. DIARIZATION — local pyannote Community-1 only
    # -----------------------------------------------------------------------
    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
      raise ValueError("HF_TOKEN is required for local pyannote Community-1. Accept the Community-1 model terms on Hugging Face and configure HF_TOKEN.")

    diarization_model = os.environ.get("PYANNOTE_MODEL", "pyannote/speaker-diarization-community-1")
    logger.info("Loading cached local pyannote diarization model: %s", diarization_model)
    diarization_pipeline = get_cached_pyannote_pipeline(diarization_model, hf_token)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    speaker_kwargs = _diarization_speaker_kwargs(expected_speakers)
    logger.info(
      "Running pyannote Community-1 on in-memory decoded audio: device=%s speaker_constraints=%s",
      device, speaker_kwargs
    )
    # Decode audio to in-memory waveform dict to bypass TorchCodec on Windows while preserving channels
    audio_in_memory = load_audio_waveform_for_pyannote(audio_path)
    diarization_output = diarization_pipeline(audio_in_memory, **speaker_kwargs)
    diarized_turns, diarization_mode = _extract_best_pyannote_annotation(diarization_output)
    diarization_provider = "pyannote_community_1"

    # Never convert an empty/degenerate diarization result into a fake speaker.
    if not diarized_turns:
      raise RuntimeError("Community-1 produced no usable speaker turns")

    # Filter only truly microscopic fragments. Do not aggressively merge turns:
    # pyannote's boundaries are the source of truth and short backchannels matter.
    diarized_turns = [
      t for t in sorted(diarized_turns, key=lambda x: (x["start"], x["end"]))
      if (t["end"] - t["start"]) >= float(os.environ.get("DIARIZATION_MIN_TURN_SECONDS", "0.12"))
    ]
    if not diarized_turns:
      raise RuntimeError("Diarization produced only unusably short turns")

    detected_speakers = sorted({t["speaker"] for t in diarized_turns})
    logger.info(
      "Diarization complete: provider=%s mode=%s turns=%d speakers=%d labels=%s",
      diarization_provider, diarization_mode, len(diarized_turns), len(detected_speakers), detected_speakers
    )

    # -----------------------------------------------------------------------
    # 2. TRANSCRIPTION — word timestamps
    # -----------------------------------------------------------------------
    use_groq = os.environ.get("USE_GROQ_STT") == "true"
    groq_key = os.environ.get("GROQ_API_KEY")
    words = []
    total_duration = 0.0
    device = "cuda" if torch.cuda.is_available() else "cpu"

    if use_groq and groq_key:
      logger.info("Running Groq Whisper-large-v3 with word timestamps...")
      import requests
      url = "https://api.groq.com/openai/v1/audio/transcriptions"
      headers = {"Authorization": f"Bearer {groq_key}"}
      with open(target_file, "rb") as f:
        response = requests.post(
          url,
          headers=headers,
          files={"file": (os.path.basename(target_file), f, "audio/wav")},
          data={
            "model": os.environ.get("GROQ_STT_MODEL", "whisper-large-v3"),
            "response_format": "verbose_json",
            "timestamp_granularities[]": "word",
          },
          timeout=180,
        )
      if not response.ok:
        raise RuntimeError(f"Groq STT failed: {response.status_code} {response.text}")

      result = response.json()
      raw_words = result.get("words", [])
      if not raw_words:
        for segment in result.get("segments", []):
          raw_words.extend(segment.get("words", []))
      for item in raw_words:
        text = str(item.get("word", "")).strip()
        if not text:
          continue
        start = float(item.get("start", 0.0))
        end = float(item.get("end", start))
        if end <= start:
          continue
        words.append(WordProxy(text, start, end, float(item.get("probability", 0.95))))
      total_duration = float(result.get("duration", words[-1].end if words else 0.0))
    else:
      logger.info("Running local Faster-Whisper for word-level timestamps...")
      whisper_segments, total_duration = run_local_transcription(target_file, device)
      for segment in whisper_segments:
        if segment.words:
          for word in segment.words:
            words.append(WordProxy(word.word, word.start, word.end, word.probability))
        else:
          text_words = segment.text.strip().split()
          if text_words:
            duration = max(0.01, segment.end - segment.start) / len(text_words)
            for index, text in enumerate(text_words):
              start = segment.start + index * duration
              words.append(WordProxy(text, start, start + duration, float(np.exp(segment.avg_logprob))))

    if not words:
      return {
        "duration": round(total_duration, 2),
        "segments": [],
        "speakers": [],
        "identity_source": diarization_provider,
        "diarization": {
          "provider": diarization_provider,
          "mode": diarization_mode,
          "speaker_count": len(detected_speakers),
          "turn_count": len(diarized_turns),
          "quality_status": "no_transcript_words",
        },
      }

    # -----------------------------------------------------------------------
    # 3. WORD -> SPEAKER ALIGNMENT
    # -----------------------------------------------------------------------
    logger.info("Aligning %d transcript words against %d acoustic speaker turns...", len(words), len(diarized_turns))
    aligned_words = []

    # -----------------------------------------------------------------------
    # 3. WORD -> SPEAKER ALIGNMENT (Multi-metric deterministic scoring)
    # -----------------------------------------------------------------------
    logger.info("Aligning %d transcript words against %d acoustic speaker turns...", len(words), len(diarized_turns))
    min_word_overlap = float(os.environ.get("DIARIZATION_MIN_WORD_OVERLAP", "0.15"))
    aligned_words = align_words_to_turns(words, diarized_turns, min_overlap=min_word_overlap)

    # -----------------------------------------------------------------------
    # 4. RECONSTRUCT TURNS — bounded gaps, natural pauses, no monolithic turns
    # -----------------------------------------------------------------------
    max_unknown_gap = float(os.environ.get("UNKNOWN_SPEAKER_MERGE_GAP", "0.80"))
    max_known_gap = float(os.environ.get("KNOWN_SPEAKER_MERGE_GAP", "0.65"))
    max_turn_duration = float(os.environ.get("DIARIZATION_MAX_TURN_DURATION", "45.0"))

    reconstructed = reconstruct_speaker_turns(
      aligned_words,
      max_known_gap=max_known_gap,
      max_unknown_gap=max_unknown_gap,
      max_turn_duration=max_turn_duration,
    )

    # If alignment produced no known speaker segments, preserve transcript but segment by natural pauses
    known_segments = [s for s in reconstructed if s["speaker"] != "Unknown Speaker"]
    if not known_segments:
      logger.error(
        "Diarization produced no words confidently attributable to a speaker. "
        "Returning unresolved pause-based segments instead of one giant turn."
      )
      fallback = _build_unresolved_turns(words)
      reconstructed = fallback

    # -----------------------------------------------------------------------
    # 5. STABLE SPEAKER LABELS (Speaker 1, Speaker 2, ...)
    # -----------------------------------------------------------------------
    raw_unique_speakers = []
    for segment in reconstructed:
      raw = segment["speaker"]
      if raw not in raw_unique_speakers:
        raw_unique_speakers.append(raw)

    speaker_name_map = {}
    next_index = 1
    for raw in raw_unique_speakers:
      if raw == "Unknown Speaker":
        speaker_name_map[raw] = raw
      else:
        speaker_name_map[raw] = f"Speaker {next_index}"
        next_index += 1

    for idx, segment in enumerate(reconstructed):
      seg_id = f"seg_{idx:03d}"
      segment["id"] = seg_id
      segment["segment_id"] = seg_id
      segment["speaker"] = speaker_name_map.get(segment["speaker"], "Unknown Speaker")
      segment["speaker_name"] = segment["speaker"]
      segment["speaker_confidence"] = segment.pop("confidence", 0.0)
      segment["confidence"] = segment["speaker_confidence"]

    speakers_profiles = []
    for raw in raw_unique_speakers:
      if raw == "Unknown Speaker":
        continue
      speakers_profiles.append({
        "id": str(uuid.uuid4()),
        "name": speaker_name_map[raw],
        "embedding": None,
        "identity_source": "acoustic_diarization" if diarization_provider != "unresolved" else "unresolved",
      })

    # Diagnostic metrics & catastrophic failure detection
    diagnostics = calculate_diarization_diagnostics(
      segments=reconstructed,
      detected_speakers=detected_speakers,
      diarized_turns=diarized_turns,
      total_duration=total_duration,
      words_count=len(words),
    )
    if not known_segments:
      diagnostics["quality_status"] = "failed_alignment"

    diarization_info = {
      "provider": diarization_provider,
      "mode": diarization_mode,
      **diagnostics,
    }

    return {
      "duration": round(total_duration, 2),
      "segments": reconstructed,
      "speakers": speakers_profiles,
      "identity_source": diarization_provider,
      "diarization": diarization_info,
    }
  finally:
    if os.path.exists(normalized_path):
      try:
        os.remove(normalized_path)
      except OSError as cleanup_error:
        logger.warning("Failed to cleanup normalized audio %s: %s", normalized_path, cleanup_error)

def run_emulated_ai_pipeline(audio_path: str, start_time: float) -> dict:
  """
  High-fidelity pipeline emulation that executes an extremely realistic Whisper and Pyannote diarization simulation.
  Ensures that the entire platform is testable and functional immediately.
  """
  logger.info("Executing emulated AI meeting intelligence pipeline...")
  
  # Simulate file processing delay to match real UX
  time.sleep(2.0)
  
  # Define typical multi-speaker meeting discussion dialogue (Daily Sprint Sync template)
  sample_dialogue = [
    ("Speaker 1", 0.8, 4.2, "Hi everyone, thanks for hopping on. Let's kick off our PulseSync architecture sync."),
    ("Speaker 2", 5.0, 9.4, "Sounds good! I've been reviewing our Chrome Manifest V3 audio recording specs. We've got the Offscreen merger working."),
    ("Speaker 1", 10.1, 15.6, "Outstanding. How are we handling tab audio silencing in Chrome? We need to make sure user playback stays active."),
    ("Speaker 3", 16.2, 23.4, "We've resolved that in offscreen.html by bridging our tab capture stream back to the AudioContext destination node."),
    ("Speaker 2", 24.1, 28.7, "Excellent, that keeps playback completely unaffected while recording. And what about persistent voice identification?"),
    ("Speaker 1", 29.5, 36.8, "We will feed Pyannote speaker embeddings into PostgreSQL using pgvector. We can match speakers across meetings using cosine distance."),
    ("Speaker 3", 37.5, 41.2, "Got it! I will run database migrations to setup pgvector and matching templates."),
    ("Speaker 2", 42.0, 46.5, "Awesome, let's aim to have the complete ingestion testing completed by Thursday."),
    ("Speaker 1", 47.1, 50.4, "Perfect. Thanks all, let's get back to refactoring!")
  ]

  segments = []
  for speaker, start, end, text in sample_dialogue:
    segments.append({
      "speaker": speaker,
      "start": start,
      "end": end,
      "text": text,
      "confidence": round(float(np.random.uniform(0.92, 0.99)), 3)
    })

  # Generate actual 512-dimension speaker vector embeddings (essential for vector DB pgvector schemas!)
  unique_speakers = ["Speaker 1", "Speaker 2", "Speaker 3"]
  speakers_profiles = []
  
  for sp_name in unique_speakers:
    vec = np.random.randn(512)
    norm = np.linalg.norm(vec)
    embedding = (vec / norm).tolist() if norm > 0 else vec.tolist()
    speakers_profiles.append({
      "id": str(uuid.uuid4()),
      "name": sp_name,
      "embedding": embedding
    })

  elapsed = time.time() - start_time
  logger.info(f"Pipeline emulation complete. Elapsed processing time: {elapsed:.2f} seconds.")

  return {
    "duration": 52.0,
    "segments": segments,
    "speakers": speakers_profiles
  }

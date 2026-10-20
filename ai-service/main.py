import os
from dotenv import load_dotenv
load_dotenv() # Walk up parent folders and load .env configurations

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import uvicorn
import logging
from pathlib import Path
import hmac

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("pulsesync-ai-service")

app = FastAPI(
  title="PulseSync AI Processing Microservice",
  description="Post-call AI meeting intelligence pipeline using Whisper, Pyannote diarization, pgvector embedding matching, and LLM enrichment."
)

from typing import Optional, List, Union, Dict, Any


@app.exception_handler(RequestValidationError)
async def log_request_validation_error(
    request: Request,
    exc: RequestValidationError
):
    try:
        body = await request.json()
        body_keys = (
            sorted(body.keys())
            if isinstance(body, dict)
            else f"<{type(body).__name__}>"
        )
    except Exception:
        body_keys = "<unreadable>"

    # Log only error locations and messages, never transcript contents.
    safe_errors = [
        {
            "loc": list(error.get("loc", [])),
            "msg": error.get("msg"),
            "type": error.get("type"),
        }
        for error in exc.errors()
    ]

    logger.error(
        "Request validation failed: path=%s method=%s body_keys=%s errors=%s",
        request.url.path,
        request.method,
        body_keys,
        safe_errors,
    )

    return JSONResponse(
        status_code=422,
        content={"detail": safe_errors},
    )

@app.middleware("http")
async def require_internal_service_token(request: Request, call_next):
  # Local development can run without a token. Production must configure a strong
  # AI_SERVICE_TOKEN on both the backend and this service.
  expected = os.getenv("AI_SERVICE_TOKEN", "").strip()
  if request.url.path not in ("/health", "/openapi.json", "/docs", "/redoc"):
    production = os.getenv("NODE_ENV", "development").lower() == "production"
    invalid_production_token = (
      len(expected) < 32
      or any(marker in expected.lower() for marker in ("replace-with", "change-this", "example"))
    )
    if production and invalid_production_token:
      return JSONResponse(status_code=503, content={"detail": "AI service authentication is not securely configured"})
    if expected:
      supplied = request.headers.get("authorization", "")
      wanted = f"Bearer {expected}"
      if not hmac.compare_digest(supplied, wanted):
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
  return await call_next(request)

class ProcessRequest(BaseModel):
  audio_path: str = Field(min_length=1, max_length=2048)
  meeting_id: str = Field(min_length=1, max_length=128)
  schema_fields: Optional[List[dict]] = None
  profile: Optional[dict] = None
  call_context: Optional[dict] = None
  skip_enrichment: Optional[bool] = False
  platform_segments: Optional[List[dict]] = None
  expected_speakers: Optional[int] = None

class EnrichRequest(BaseModel):
  meeting_id: str = Field(min_length=1, max_length=128)
  segments: List[dict] = Field(max_length=20000)
  schema_fields: Optional[List[dict]] = None
  profile: Optional[dict] = None
  call_context: Optional[dict] = None

class GenerateAIRequest(BaseModel):
  meeting_id: str = Field(min_length=1, max_length=128)
  transcript: List[dict] = Field(max_length=20000)
  speaker_mapping: Optional[Union[List[Any], Dict[str, Any]]] = None
  company: Optional[Union[Dict[str, Any], str]] = None
  template: Optional[Union[Dict[str, Any], str]] = None
  schema_fields: Optional[List[dict]] = None
  profile: Optional[dict] = None
  call_context: Optional[dict] = None
  memories: Optional[List[dict]] = None
  call_type: Optional[str] = None


class ChatDealRequest(BaseModel):
  company_name: str = Field(min_length=1, max_length=255)
  question: str = Field(min_length=1, max_length=5000)
  transcripts: List[dict] = Field(max_length=20000)
  memories: Optional[List[dict]] = None
  playbook_coverage: Optional[List[dict]] = None

@app.post("/process")
async def process_audio(payload: ProcessRequest):
  print("PROCESS REQUEST RECEIVED", str(payload))
  logger.info(f"Received audio processing request for meeting ID: {payload.meeting_id}")
  logger.info(f"Audio file path: {payload.audio_path}")

  # uploads_root = Path(os.getenv("UPLOADS_DIR", str(Path(__file__).resolve().parent.parent / "backend" / "uploads"))).resolve()
  # requested_path = Path(payload.audio_path).expanduser().resolve()
  project_root = Path(__file__).resolve().parent.parent

  uploads_dir_value = Path(
      os.getenv("UPLOADS_DIR", "./backend/uploads")
  ).expanduser()

  # Resolve relative upload directories from the project root.
  uploads_root = (
      uploads_dir_value
      if uploads_dir_value.is_absolute()
      else project_root / uploads_dir_value
  ).resolve()

  # Resolve relative audio paths from the project root,
  # not from whichever directory started the AI service.
  audio_path_value = Path(payload.audio_path).expanduser()

  requested_path = (
      audio_path_value
      if audio_path_value.is_absolute()
      else project_root / audio_path_value
  ).resolve()

  try:
      requested_path.relative_to(uploads_root)
  except ValueError:
      logger.warning(
          "Rejected audio path outside the configured uploads directory"
      )
      raise HTTPException(
          status_code=400,
          detail="Audio path is outside the permitted uploads directory"
      )

  if not requested_path.is_file():
      logger.error(
          "Requested audio file was not found in the permitted uploads directory"
      )
      raise HTTPException(
          status_code=404,
          detail="Audio file not found"
      )

  payload.audio_path = str(requested_path)
  try:
    requested_path.relative_to(uploads_root)
  except ValueError:
    logger.warning("Rejected audio path outside the configured uploads directory")
    raise HTTPException(status_code=400, detail="Audio path is outside the permitted uploads directory")
  if not requested_path.is_file():
    logger.error("Requested audio file was not found in the permitted uploads directory")
    raise HTTPException(status_code=404, detail="Audio file not found")
  payload.audio_path = str(requested_path)
  
  try:
    # Lazy imports to support fast startup and graceful fallbacks
    from pipeline import run_audio_pipeline
    from enrichment import calculate_conversational_analytics

    # 1. Prefer platform-native attributed transcript segments when the meeting
    # provider already supplied participant identity. Never overwrite trusted
    # provider attribution with an LLM-generated speaker guess.
    if payload.platform_segments:
      from enrichment import calculate_conversational_analytics
      logger.info("Using platform-attributed transcript segments as the speaker identity source of truth.")
      formatted = []
      for idx, seg in enumerate(payload.platform_segments):
        speaker = seg.get("speaker_name") or seg.get("displayName") or seg.get("speaker") or "Unknown Speaker"
        text = (seg.get("corrected_text") or seg.get("text") or "").strip()
        if not text:
          continue
        start = float(seg.get("start_time") or seg.get("start") or 0.0)
        end = float(seg.get("end_time") or seg.get("end") or start)
        formatted.append({
          **seg,
          "id": seg.get("id") or seg.get("segment_id") or f"platform_seg_{idx}",
          "segment_id": seg.get("segment_id") or seg.get("id") or f"platform_seg_{idx}",
          "speaker": speaker,
          "speaker_name": speaker,
          "text": text,
          "start": start,
          "start_time": start,
          "end": end,
          "end_time": end,
          "speaker_confidence": float(seg.get("attribution_confidence") or seg.get("confidence") or 0.95),
          "attribution_source": seg.get("attribution_source") or "platform_native"
        })
      duration = max([s["end"] for s in formatted], default=0.0)
      unique = []
      seen = set()
      for seg in formatted:
        key = seg["speaker"]
        if key not in seen:
          seen.add(key)
          unique.append({"id": seg.get("speaker_id") or key, "name": key})
      pipeline_result = {
        "duration": duration,
        "segments": formatted,
        "speakers": unique,
        "identity_source": "platform_native"
      }
    else:
      # 1. Run transcription + acoustic diarization + speaker identification.
      logger.info("Executing speech-to-text and acoustic speaker diarization...")
      pipeline_result = run_audio_pipeline(payload.audio_path, expected_speakers=payload.expected_speakers)
    
    if payload.skip_enrichment:
      logger.info("Generating early conversational metrics without LLM enrichment...")
      analytics = calculate_conversational_analytics(pipeline_result["segments"], pipeline_result["duration"])
      return {
        "meeting_id": payload.meeting_id,
        "duration": pipeline_result["duration"],
        "speakers": pipeline_result["speakers"],
        "segments": pipeline_result["segments"],
        "analytics": analytics,
        "summary": None,
        "extracted_data": None
      }

    # 2. Enrich transcript with LLM-based summaries, action items, and conversation metrics
    from enrichment import generate_meeting_enrichment
    logger.info("Generating AI meeting intelligence and analytics...")
    enriched_result = generate_meeting_enrichment(
      pipeline_result=pipeline_result,
      meeting_id=payload.meeting_id,
      schema_fields=payload.schema_fields,
      profile=payload.profile,
      call_context=payload.call_context
    )
    
    logger.info("Meeting analytics pipeline completed successfully.")
    return enriched_result

  except Exception as e:
    logger.exception("Pipeline failed with exception")
    raise HTTPException(status_code=500, detail="AI pipeline processing failed")

@app.post("/generate-ai")
async def generate_ai(payload: GenerateAIRequest):
  logger.info(f"Received generate-ai request for meeting ID: {payload.meeting_id}")
  try:
    from enrichment import generate_meeting_enrichment
    
    # Format segments to the format expected by generate_meeting_enrichment
    formatted_segments = []
    for idx, seg in enumerate(payload.transcript):
      sp_name = seg.get("speaker_name") or seg.get("speaker") or "Unknown Speaker"
      text_val = seg.get("corrected_text") or seg.get("text") or ""
      seg_id = seg.get("id") or seg.get("segment_id") or f"seg_{idx}"
      
      formatted_segments.append({
        "id": seg_id,
        "segment_id": seg_id,
        "speaker": sp_name,
        "speaker_name": sp_name,
        "text": text_val,
        "start": float(seg.get("start_time") or seg.get("start") or 0.0),
        "start_time": float(seg.get("start_time") or seg.get("start") or 0.0),
        "end": float(seg.get("end_time") or seg.get("end") or 0.0),
        "end_time": float(seg.get("end_time") or seg.get("end") or 0.0),
        "speaker_confidence": float(seg.get("confidence") or 0.85)
      })
      
    duration = 0.0
    if formatted_segments:
      duration = max(0.0, formatted_segments[-1]["end"])
      
    # Resolve speakers from mapping
    speakers_list = []
    if payload.speaker_mapping:
      if isinstance(payload.speaker_mapping, list):
        speakers_list = [{"id": s.get("speaker_id") or s.get("id"), "name": s.get("name")} for s in payload.speaker_mapping if isinstance(s, dict) and s.get("name")]
      elif isinstance(payload.speaker_mapping, dict):
        speakers_list = [{"id": k, "name": v} for k, v in payload.speaker_mapping.items()]
    if not speakers_list:
      # unique speakers from segments
      unique_speakers = set(seg.get("speaker") for seg in formatted_segments)
      speakers_list = [{"id": s, "name": s} for s in unique_speakers]
      
    pipeline_result = {
      "segments": formatted_segments,
      "speakers": speakers_list,
      "duration": duration
    }
    
    # Run enrichment with company, template, speaker_mapping context, profile, call_context
    enriched_result = generate_meeting_enrichment(
      pipeline_result=pipeline_result,
      meeting_id=payload.meeting_id,
      schema_fields=payload.schema_fields,
      company=payload.company,
      template=payload.template,
      speaker_mapping=payload.speaker_mapping,
      memories=payload.memories,
      call_type=payload.call_type,
      profile=payload.profile,
      call_context=payload.call_context
    )
    
    return enriched_result
  except Exception as e:
    logger.exception("AI generate-ai enrichment failed")
    raise HTTPException(status_code=500, detail="AI enrichment failed")

@app.post("/enrich")
async def enrich_meeting(payload: EnrichRequest):
  logger.info(f"Received on-demand AI enrichment request for meeting ID: {payload.meeting_id}")
  try:
    from enrichment import generate_meeting_enrichment
    
    # Format segments to the format expected by generate_meeting_enrichment
    formatted_segments = []
    unique_speakers = set()
    
    for seg in payload.segments:
      sp_name = seg.get("speaker_name") or seg.get("speaker") or "Unknown Speaker"
      text_val = seg.get("corrected_text") or seg.get("text") or ""
      
      formatted_segments.append({
        "speaker": sp_name,
        "text": text_val,
        "start": float(seg.get("start_time") or seg.get("start") or 0.0),
        "end": float(seg.get("end_time") or seg.get("end") or 0.0),
        "speaker_confidence": float(seg.get("confidence") or 0.85)
      })
      unique_speakers.add(sp_name)
      
    duration = 0.0
    if formatted_segments:
      duration = max(0.0, formatted_segments[-1]["end"])
      
    pipeline_result = {
      "segments": formatted_segments,
      "speakers": [{"id": s, "name": s} for s in unique_speakers],
      "duration": duration
    }
    
    logger.info(f"Triggering LLM meeting intelligence generation on {len(formatted_segments)} segments...")
    enriched_result = generate_meeting_enrichment(
      pipeline_result=pipeline_result,
      meeting_id=payload.meeting_id,
      schema_fields=payload.schema_fields,
      profile=payload.profile,
      call_context=payload.call_context
    )
    
    return enriched_result
  except Exception as e:
    logger.exception("AI compilation enrichment failed with exception")
    raise HTTPException(status_code=500, detail="AI enrichment failed")

@app.post("/chat-deal")
async def chat_deal(payload: ChatDealRequest):
  logger.info(f"Received chat-deal request for company: {payload.company_name}")
  try:
    from enrichment import ask_deal_question
    answer_result = ask_deal_question(
      company_name=payload.company_name,
      question=payload.question,
      transcripts=payload.transcripts,
      memories=payload.memories,
      playbook_coverage=payload.playbook_coverage
    )
    return answer_result
  except Exception as e:
    logger.exception("Chat deal question failed")
    raise HTTPException(status_code=500, detail="Deal chat request failed")

@app.get("/health")
def healthcheck():
  return {"status": "ok", "service": "pulsesync-ai-processing-service"}

if __name__ == "__main__":
  uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

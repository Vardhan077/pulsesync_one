import os
import json
import logging
import requests
import traceback
import re
from pathlib import Path
from dotenv import load_dotenv

# Load .env configurations
current_dir = Path(__file__).resolve().parent
load_dotenv(current_dir / ".env")
load_dotenv(current_dir.parent / ".env")

logger = logging.getLogger("pulsesync-ai-service.enrichment")

def generate_meeting_enrichment(pipeline_result: dict, meeting_id: str, schema_fields: list = None, company: dict = None, template: dict = None, speaker_mapping: list = None, memories: list = None, call_type: str = None, profile: dict = None, call_context: dict = None) -> dict:
  """
  Analyzes meeting transcripts to compute conversational analytics (talk-time, WPM, interruptions),
  integrates grounded LLM extraction for dynamic summary sections, structured fields, deal signals, and action items.
  """
  from diarization_logger import DiarizationLogger
  from diarization_qa import calculate_qa_metrics
  from extraction_engine import extract_grounded_meeting_intelligence

  segments = pipeline_result["segments"]
  speakers = pipeline_result["speakers"]
  duration = pipeline_result["duration"]

  # Initialize structured debug logging
  diag_logger = DiarizationLogger(meeting_id)
  for idx, seg in enumerate(segments):
    diag_logger.log_heuristic_decision(
      segment_idx=idx,
      text=seg["text"],
      assigned_speaker=seg["speaker"],
      confidence=seg.get("speaker_confidence", 0.80),
      reason=seg.get("turn_change_reason", "n/a")
    )

  # 1. Compute Conversational Analytics Programmatically based on the acoustic truth
  analytics = calculate_conversational_analytics(segments, duration)

  # 2. Extract Grounded Meeting Summaries & Playbook Fields
  logger.info("Executing Grounded Meeting Intelligence Engine...")
  context_data = dict(call_context or {})
  if company and "company" not in context_data:
    context_data["company"] = company
  if call_type and "call_type" not in context_data:
    context_data["call_type"] = call_type
  if memories and "memories" not in context_data:
    context_data["memories"] = memories
  if speaker_mapping and "speaker_mapping" not in context_data:
    context_data["speaker_mapping"] = speaker_mapping
  context_data["meeting_id"] = meeting_id

  grounded = extract_grounded_meeting_intelligence(
    transcript_segments=segments,
    schema_fields=schema_fields,
    template=template,
    call_type=call_type,
    profile=profile,
    call_context=context_data
  )

  # 3. Format structured summary and extracted data
  resolved_call_type = grounded.get("call_type") or call_type
  if not resolved_call_type:
    ci_type = str((grounded.get("conversation_intelligence") or {}).get("conversation_type") or "").lower()
    if "prospect" in ci_type or "cold" in ci_type:
      resolved_call_type = "cold_prospecting"
    elif "discovery" in ci_type:
      resolved_call_type = "discovery"
    elif "qualif" in ci_type:
      resolved_call_type = "qualification"
    elif "demo" in ci_type:
      resolved_call_type = "solution_demo"
    elif "technical" in ci_type:
      resolved_call_type = "technical_validation"
    elif "negotiat" in ci_type:
      resolved_call_type = "negotiation"
    else:
      resolved_call_type = "other"

  resolved_confidence = grounded.get("call_type_confidence")
  if resolved_confidence is None:
    resolved_confidence = (grounded.get("conversation_intelligence") or {}).get("conversation_type_confidence")
  resolved_rationale = grounded.get("call_type_rationale") or (grounded.get("conversation_intelligence") or {}).get("conversation_type_rationale", "")

  summary = {
    "overview": grounded.get("summary", ""),
    "summary_sections": grounded.get("summary_sections", []),
    "deal_snapshot": grounded.get("deal_signals", {}),
    "deal_intelligence": grounded.get("deal_signals", {}),
    "risks": grounded.get("risks", []),
    "objections": grounded.get("objections", []),
    "action_items": grounded.get("action_items", []),
    "insights": grounded.get("insights", []),
    "call_type": resolved_call_type,
    "call_type_confidence": resolved_confidence,
    "call_type_rationale": resolved_rationale,
    "conversation_intelligence": grounded.get("conversation_intelligence", {})
  }

  # Populate grounded company memories detected from verified fields
  memories_detected = []
  mem_type_map = {
    "budget": "budget",
    "champion": "champion",
    "economic_buyer": "decision_maker",
    "decision_maker": "decision_maker",
    "timeline": "timeline",
    "competition": "competitor",
    "competitors": "competitor"
  }
  for fld in (grounded.get("fields") or grounded.get("template_fields") or []):
    fid = fld.get("field_id") or fld.get("id") or ""
    fval = fld.get("value")
    if fid in mem_type_map and fval and isinstance(fval, str) and fval.strip():
      lower_val = fval.strip().lower()
      if lower_val not in ("none", "n/a", "unknown", "not discussed", "not mentioned"):
        memories_detected.append({
          "memory_type": mem_type_map[fid],
          "value": fval.strip(),
          "confidence": int(float(fld.get("confidence", 0.9)) * 100) if fld.get("confidence") is not None else 95,
          "evidence": fld.get("quote") or fld.get("evidence") or ""
        })
  summary["memories_detected"] = memories_detected

  flat_extracted_data = {}
  for tf in grounded.get("fields") or grounded.get("template_fields", []):
    flat_extracted_data[tf["field_id"]] = tf["value"]

  # Calculate Diarization QA Metrics based on pure acoustic segments
  qa_metrics = calculate_qa_metrics(segments, analytics, duration)
  diag_logger.set_qa_metrics(qa_metrics)

  # Log the structured debug report
  debug_report = diag_logger.generate_debug_report()
  logger.info(debug_report)

  return {
    "meeting_id": meeting_id,
    "duration": duration,
    "speakers": speakers,
    "segments": segments,
    "analytics": analytics,
    "summary": summary,
    "summary_sections": grounded.get("summary_sections", []),
    "fields": grounded.get("fields", []),
    "qa_metrics": qa_metrics,
    "extracted_data": flat_extracted_data,
    "template_fields": grounded.get("template_fields", []),
    "deal_signals": grounded.get("deal_signals", {}),
    "deal_signal_objects": grounded.get("deal_signal_objects", []),
    "irrelevant_segments": grounded.get("irrelevant_segments", []),
    "profile": grounded.get("profile", {}),
    "grounded_intelligence": grounded,
    "conversation_intelligence": grounded.get("conversation_intelligence", {}),
    "call_type": resolved_call_type,
    "call_type_confidence": resolved_confidence,
    "call_type_rationale": resolved_rationale
  }

def calculate_conversational_analytics(segments: list, total_duration: float) -> list:
  """
  Runs precise algorithms to compute:
  - Total talk-time in seconds per speaker
  - Interruption metrics (when speaker B's boundary overlaps speaker A's end boundaries)
  - Speech velocity (Words Per Minute)
  - Participation percentage distribution
  """
  logger.info("Computing meeting analytics...")
  
  speaker_data = {}
  
  # Sort segments by start time for sequential overlap scanning
  sorted_segs = sorted(segments, key=lambda x: x["start"])

  # Calculate talk-time and word counts
  for seg in sorted_segs:
    sp = seg["speaker"]
    if sp not in speaker_data:
      speaker_data[sp] = {
        "talk_time": 0.0,
        "word_count": 0,
        "interruptions": 0
      }
    
    seg_dur = max(0.0, seg["end"] - seg["start"])
    speaker_data[sp]["talk_time"] += seg_dur
    
    words = len(seg["text"].split())
    speaker_data[sp]["word_count"] += words

  # Calculate Interruption overlaps
  for i in range(1, len(sorted_segs)):
    prev = sorted_segs[i-1]
    curr = sorted_segs[i]
    
    if curr["speaker"] != prev["speaker"]:
      overlap = prev["end"] - curr["start"]
      if overlap > 0.4: # Overlap threshold (seconds)
        interrupter = curr["speaker"]
        if interrupter in speaker_data:
          speaker_data[interrupter]["interruptions"] += 1

  # Compile metric objects
  total_talk_time = sum(info["talk_time"] for info in speaker_data.values()) or 1.0
  analytics_list = []

  for sp_name, stats in speaker_data.items():
    talk_min = stats["talk_time"] / 60.0
    wpm = int(stats["word_count"] / talk_min) if talk_min > 0 else 0
    participation = round((stats["talk_time"] / total_talk_time) * 100, 2)

    analytics_list.append({
      "speaker": sp_name,
      "talk_time": int(stats["talk_time"]),
      "interruptions": stats["interruptions"],
      "words_per_minute": wpm,
      "participation": participation
    })

  return analytics_list

def generate_summary_and_action_items(segments: list, company: dict = None, template: dict = None, speaker_mapping: list = None, memories: list = None) -> dict:
  """
  Checks for OpenAI or Groq credentials and calls LLMs via direct REST API requests.
  Bypasses the buggy OpenAI SDK to avoid httpx / proxy dependency conflicts.
  """
  openai_key = os.environ.get("OPENAI_API_KEY")
  groq_key = os.environ.get("GROQ_API_KEY")
  
  if openai_key:
    try:
      logger.info("Calling OpenAI GPT model for meeting summarization via REST...")
      return call_llm_rest_api(segments, openai_key, is_groq=False, company=company, template=template, speaker_mapping=speaker_mapping, memories=memories)
    except Exception as e:
      logger.error(f"OpenAI LLM REST API call failed: {str(e)}")
      logger.debug(traceback.format_exc())
      
  if groq_key:
    try:
      logger.info("Calling Groq Llama-3 model for meeting summarization via REST...")
      return call_llm_rest_api(segments, groq_key, is_groq=True, company=company, template=template, speaker_mapping=speaker_mapping, memories=memories)
    except Exception as e:
      logger.error(f"Groq LLM REST API call failed: {str(e)}")
      logger.debug(traceback.format_exc())
  
  logger.warning("No active LLM API key succeeded; returning grounded empty output instead of synthetic CRM data.")
  return {"overview": "", "deal_snapshot": {}, "deal_intelligence": {}, "risks": [], "objections": [], "action_items": [], "memories_detected": []}

def call_llm_rest_api(segments: list, api_key: str, is_groq: bool = False, company: dict = None, template: dict = None, speaker_mapping: list = None, memories: list = None) -> dict:
  """
  Executes direct HTTP POST requests to Groq or OpenAI chat completions endpoint.
  """
  # Format transcript with index markers to assist LLM
  formatted_transcript = ""
  for idx, seg in enumerate(segments):
    formatted_transcript += f"[{idx}] {seg['speaker']}: \"{seg['text']}\"\n\n"

  company_context = ""
  if company:
    company_context = f"""
  ### WORKSPACE CONTEXT:
  - Account/Workspace: {company.get('name', 'N/A')}
  - Website: {company.get('website', 'N/A')}
  - Industry: {company.get('industry', 'N/A')}
  - Current CRM Deal Stage: {company.get('deal_stage', 'N/A')}
  - CRM Account ID: {company.get('crm_account', 'N/A')}
  - Notes: {company.get('notes', 'N/A')}
  (CRITICAL ATTRIBUTION RULE: The workspace account above is the PulseSync user's tenant or account. Do NOT attribute external prospects or buyers to this company unless explicitly stated by the speaker in the transcript.)
  """

  template_context = ""
  if template:
    template_context = f"\n  ### PLAYBOOK TEMPLATE:\n  - Playbook: {template.get('name', 'N/A')} (ID: {template.get('id', 'N/A')})\n"

  speaker_context = ""
  if speaker_mapping:
    mapping_lines = []
    for sp in speaker_mapping:
      mapping_lines.append(f"  - {sp.get('name', 'Unknown')}: Role: {sp.get('role', 'Attendee')}, Title: {sp.get('job_title', 'N/A')}, Department: {sp.get('department', 'N/A')}")
    speaker_context = "\n  ### SPEAKER PROFILES (MAPPED):\n" + "\n".join(mapping_lines) + "\n"

  memories_context = ""
  if memories:
    memory_lines = []
    for m in memories:
      memory_lines.append(f"  - [{m.get('memory_type')}]: {m.get('value')} (Confidence: {m.get('confidence', 100)}%)")
    memories_context = "\n  ### HISTORICAL COMPANY MEMORIES (PREVIOUS CALLS):\n" + "\n".join(memory_lines) + "\n"

  prompt = f"""
  You are an expert AI meeting analyst and enterprise sales intelligence agent. Review the following meeting transcript, speakers, client company, playbook template, and historical company memories context, then output a highly structured JSON.
  {company_context}{template_context}{speaker_context}{memories_context}
  
  Transcript:
  {formatted_transcript}

  Analyze the conversation and extract the requested fields. Since speakers names are verified and mapped, ensure all names in action items, champion, decision maker, etc., refer to the actual mapped name instead of "Speaker 1".
  
  Compare the current conversation with the HISTORICAL COMPANY MEMORIES (if any). Detect any changes or updates in details across calls (e.g. budget increases/decreases, champion changing or missing, decision makers, resolved risks, competitor additions).

  Expected output format:
  1. "overview": A concise paragraph summarizing the meeting's core discussions (max 4-5 sentences).
  2. "deal_snapshot": An object containing (strictly NO close probability or health scores/probabilities):
     - "budget": The budget discussed, e.g. "$180k", or null if not detected.
     - "timeline": The implementation or target timeline, e.g. "October 2026", or null if not detected.
     - "champion": The identified champion's name, or null if not detected.
     - "decision_maker": The identified economic buyer or decision maker's name/role, or null if not detected.
     - "buying_stage": The current buying stage discussed, e.g. "Discovery", "Evaluation", "Procurement", "Negotiation", "Closed Won", or null if not detected.
     - "competition": Competitor companies mentioned during the call, or null if not detected.
     - "pain_points": Primary technical or business bottlenecks mentioned, or null if not detected.
  3. "deal_intelligence": An object containing (strictly NO deal health score or close probability):
     - "buying_stage": "Discovery", "Evaluation", "Procurement", "Negotiation", "Closed Won", "Unknown"
     - "expected_close": Expected close date/month, e.g. "October 2026", or "Unknown"
     - "budget": The numeric or string budget value, or "Unknown"
     - "champion": The name of the champion, or "Unknown"
     - "decision_maker": The name/role of the decision maker, or "Unknown"
  4. "risks": An array of objects representing detected deal risks (e.g., procurement approval, security review, budget uncertainty). If none, return []. Each risk object must contain:
     - "risk": The risk description.
     - "evidence": A brief sentence quote from the transcript as supporting evidence.
  5. "objections": An array of objects representing customer objections or concerns (e.g., pricing, SOC2, migration complexity). If none, return []. Each objection object must contain:
     - "objection": The objection description.
     - "evidence": A brief sentence quote from the transcript as supporting evidence.
  6. "action_items": An array of objects, each containing:
     - "task": The description of the action item.
     - "owner": The name of the inferred speaker/owner, or "Unassigned".
     - "confidence": A confidence percentage (integer between 0 and 100).
     - "evidence": A brief sentence quote from the transcript as supporting evidence.
  7. "memories_detected": An array of objects representing updates or new memory points detected by comparing the current call with HISTORICAL COMPANY MEMORIES. If none, return []. Each object must contain:
     - "memory_type": strictly one of: "budget", "champion", "decision_maker", "risk", "objection", "timeline", "pain_point", "competitor", "stakeholder".
     - "value": A description of the fact or progression (e.g. "The stated budget changed from one amount to another", "A previously mentioned stakeholder was absent from this call", "Pricing objection resolved").
     - "confidence": Integer percentage confidence (0-100).

  Respond ONLY with valid, raw, double-quoted JSON. Do not write markdown tags or preambles.
  """

  if is_groq:
    url = "https://api.groq.com/openai/v1/chat/completions"
    model = "groq/compound-mini" 
  else:
    url = "https://api.openai.com/v1/chat/completions"
    model = "gpt-4o-mini"

  headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
  }
  
  payload = {
    "model": model,
    "messages": [
      {"role": "system", "content": "You are a professional enterprise meeting intelligence API that outputs JSON only."},
      {"role": "user", "content": prompt}
    ],
    "response_format": {"type": "json_object"}
  }

  logger.info(f"Sending direct POST request to {url}")
  response = requests.post(url, headers=headers, json=payload, timeout=45)
  
  if not response.ok:
    logger.error(f"API Error Response Body: {response.text}")
    raise ValueError(f"LLM API returned status {response.status_code}")
    
  result = response.json()
  content_text = result["choices"][0]["message"]["content"]
  
  clean_text = clean_json_markdown(content_text)
  
  try:
    res_dict = json.loads(clean_text)
    # Ensure all required keys exist and default if not present
    if "overview" not in res_dict:
      res_dict["overview"] = ""
    if "deal_snapshot" not in res_dict:
      res_dict["deal_snapshot"] = {}
    if "deal_intelligence" not in res_dict:
      res_dict["deal_intelligence"] = {}
    if "risks" not in res_dict:
      res_dict["risks"] = []
    if "objections" not in res_dict:
      res_dict["objections"] = []
    if "action_items" not in res_dict:
      res_dict["action_items"] = []
    if "memories_detected" not in res_dict:
      res_dict["memories_detected"] = []
    return res_dict
  except json.JSONDecodeError as json_err:
    logger.error(f"Failed to parse cleaned LLM response as JSON. Cleaned response: {clean_text}")
    raise json_err

def clean_json_markdown(text: str) -> str:
  """
  Resilient helper to strip out markdown JSON block wrappers that cause json.loads to crash.
  """
  text = text.strip()
  if text.startswith("```json"):
    text = text[7:]
  elif text.startswith("```"):
    text = text[3:]
  
  if text.endswith("```"):
    text = text[:-3]
    
  return text.strip()

def generate_templated_summary(segments: list) -> dict:
  """Legacy compatibility wrapper; never returns synthetic customer intelligence."""
  return {
    "overview": "",
    "deal_snapshot": {},
    "deal_intelligence": {},
    "action_items": [],
    "risks": [],
    "objections": [],
    "memories_detected": []
  }

def ask_deal_question(company_name: str, question: str, transcripts: list, memories: list = None, playbook_coverage: list = None) -> dict:
  openai_key = os.environ.get("OPENAI_API_KEY")
  groq_key = os.environ.get("GROQ_API_KEY")
  
  # Format context
  transcripts_formatted = []
  for seg in transcripts:
    m_title = seg.get("meeting_title") or "Unknown Meeting"
    sp = seg.get("speaker_name") or "Unknown Speaker"
    txt = seg.get("text") or ""
    start = seg.get("start_time") or 0.0
    minutes = int(start // 60)
    seconds = int(start % 60)
    timestamp = f"{minutes:02d}:{seconds:02d}"
    
    transcripts_formatted.append(f"[{m_title} | {sp} @ {timestamp}]: \"{txt}\"")
  
  transcript_context = "\n".join(transcripts_formatted)
  
  memory_context = ""
  if memories:
    memory_lines = []
    for m in memories:
      memory_lines.append(f"- [{m.get('memory_type')}]: {m.get('value')} (Confidence: {m.get('confidence')})")
    memory_context = "\n".join(memory_lines)

  playbook_lines = []
  if playbook_coverage:
    for prop in playbook_coverage:
      lbl = prop.get("label") or prop.get("field_name") or "Property"
      val = prop.get("current_value")
      conf = prop.get("confidence", 0)
      if val and str(val).strip() and str(val).lower() not in ["missing info", "none", "null", "—"]:
        if str(val).lower() in ["none explicitly mentioned", "unassigned", "unknown"]:
          playbook_lines.append(f"- [UNCONFIRMED / NONE EXPLICITLY MENTIONED] {lbl}: {val}")
        else:
          playbook_lines.append(f"- [VERIFIED PRESENT] {lbl}: \"{val}\" (Confidence: {conf}%)")
      else:
        playbook_lines.append(f"- [MISSING] {lbl}: Missing info / unmapped")
  playbook_context = "\n".join(playbook_lines) if playbook_lines else "No formal playbook configured."
    
  prompt = f"""
  You are an expert sales deal intelligence assistant for the company "{company_name}".
  Answer the following question about the deal using the verified playbook intelligence, company memories, and transcripts provided.
  
  Question:
  {question}
  
  ### VERIFIED PLAYBOOK INTELLIGENCE (MEDDICC STATUS):
  {playbook_context}
  
  ### COMPANY MEMORIES:
  {memory_context}
  
  ### TRANSCRIPT TIMELINES:
  {transcript_context}
  
  ### INSTRUCTIONS:
  1. If the question asks about MEDDIC / playbook fields (what is present, what is missing, parameter values), refer DIRECTLY to the "VERIFIED PLAYBOOK INTELLIGENCE (MEDDICC STATUS)" above.
  2. Answer accurately, concisely, and professionally.
  3. Include supporting evidence citations from the transcripts where available.
  4. Respond ONLY with valid, raw JSON. Do not include markdown wraps or preambles.
  
  Expected JSON structure:
  {{
    "answer": "Detailed answer text here...",
    "evidence": [
      {{
        "quote": "exact quote from transcript",
        "meeting_title": "meeting title",
        "meeting_id": "meeting uuid",
        "speaker": "Speaker Name",
        "timestamp": "MM:SS"
      }}
    ]
  }}
  """
  
  # Attempt LLM call with fallback models
  models_to_try = []
  if groq_key:
    models_to_try.append(("https://api.groq.com/openai/v1/chat/completions", "groq/compound-mini", groq_key))
    models_to_try.append(("https://api.groq.com/openai/v1/chat/completions", "groq/compound", groq_key))
    models_to_try.append(("https://api.groq.com/openai/v1/chat/completions", "openai/gpt-oss-120b", groq_key))
  if openai_key:
    models_to_try.append(("https://api.openai.com/v1/chat/completions", "gpt-4o-mini", openai_key))
    
  for url, model, key in models_to_try:
    try:
      headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
      }
      payload = {
        "model": model,
        "messages": [
          {"role": "system", "content": "You are a professional enterprise sales intelligence assistant that outputs JSON only."},
          {"role": "user", "content": prompt}
        ],
        "response_format": {"type": "json_object"}
      }
      response = requests.post(url, headers=headers, json=payload, timeout=20)
      if response.ok:
        result = response.json()
        content_text = result["choices"][0]["message"]["content"].strip()
        if content_text.startswith("```json"):
          content_text = content_text[7:]
        elif content_text.startswith("```"):
          content_text = content_text[3:]
        if content_text.endswith("```"):
          content_text = content_text[:-3]
        content_text = content_text.strip()
        return json.loads(content_text)
      else:
        logger.warn(f"Model {model} returned status {response.status_code}: {response.text}")
    except Exception as e:
      logger.warn(f"LLM request to {model} failed: {str(e)}")

  # Fail closed: do not fabricate facts or cite unrelated transcript segments when every model fails.
  logger.warning("All configured LLM providers failed; returning an explicit unavailable result.")
  return {
    "answer": "I couldn't verify an answer from the available conversation evidence. The AI service may be unavailable; please retry or review the transcript.",
    "evidence": [],
    "status": "unavailable"
  }

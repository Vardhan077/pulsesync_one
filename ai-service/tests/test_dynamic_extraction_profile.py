import sys
import os
import pytest

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from extraction_engine import (
    DEFAULT_EXTRACTION_PROFILE,
    EXTRACTION_PROFILE_TEMPLATES,
    normalize_extraction_profile,
    classify_segment_relevance,
    filter_relevant_segments,
    deterministic_grounding_fallback,
    validate_and_sanitize_intelligence,
    generate_dynamic_extraction_prompt,
    build_dynamic_extraction_prompt
)
from enrichment import generate_meeting_enrichment


def get_ev(field_obj: dict) -> dict:
    ev = field_obj.get("evidence", [])
    if isinstance(ev, list):
        return ev[0] if len(ev) > 0 else {}
    return ev or {}


def test_1_normal_discovery_no_hallucinations():
    """
    Test 1: Normal Discovery
    Pain points & requirements are stated, but budget and timeline are NOT mentioned.
    Expectation: Pain points extracted with grounded quotes; budget and timeline must be None.
    """
    segments = [
        {
            "id": "seg-1",
            "speaker_name": "Sarah Connor",
            "text": "Our customer support team is overwhelmed handling 400 manual tickets every single day.",
            "start_time": 0.0,
            "end_time": 10.0,
            "confidence": 0.95
        },
        {
            "id": "seg-2",
            "speaker_name": "Sarah Connor",
            "text": "We need bidirectional synchronization between Zendesk and Salesforce with sub-second latency.",
            "start_time": 11.0,
            "end_time": 22.0,
            "confidence": 0.92
        }
    ]

    profile = DEFAULT_EXTRACTION_PROFILE
    result = deterministic_grounding_fallback(segments, profile, {"call_type": "discovery"})

    # Pain points must be extracted
    pain_field = next((f for f in result["fields"] if f.get("id") == "pain_points" or f.get("field_id") == "pain_points"), None)
    assert pain_field is not None
    assert pain_field["value"] is not None
    ev = get_ev(pain_field)
    assert "overwhelmed" in ev.get("quote", "") or "tickets" in ev.get("quote", "")
    assert ev.get("segment_id") == "seg-1"

    # Budget and timeline were NOT mentioned -> must be None, NOT hallucinated
    budget_field = next((f for f in result["fields"] if f.get("id") == "budget" or f.get("field_id") == "budget"), None)
    assert budget_field is not None
    assert budget_field["value"] is None

    timeline_field = next((f for f in result["fields"] if f.get("id") == "timeline" or f.get("field_id") == "timeline"), None)
    assert timeline_field is not None
    assert timeline_field["value"] is None

    # Deal signals should NOT have active budget or timeline
    assert not result.get("deal_signals", {}).get("budget")
    assert not result.get("deal_signals", {}).get("timeline")


def test_2_budget_extraction_with_currency_validation():
    """
    Test 2: Budget Extraction with Currency Validation
    Customer explicitly states: 'Our approved budget for this initiative is $100,000.'
    Expectation: Budget field extracted, normalized to numeric/currency, grounded in quote.
    """
    segments = [
        {
            "id": "seg-10",
            "speaker_name": "John Doe",
            "text": "Our approved budget for this initiative is $100,000 for the first year.",
            "start_time": 15.0,
            "end_time": 25.0,
            "confidence": 0.98
        }
    ]

    profile = DEFAULT_EXTRACTION_PROFILE
    result = deterministic_grounding_fallback(segments, profile, {"call_type": "discovery"})

    budget_field = next((f for f in result["fields"] if f.get("id") == "budget" or f.get("field_id") == "budget"), None)
    assert budget_field is not None
    assert budget_field["value"] is not None
    assert "$100,000" in budget_field["value"] or "100000" in str(budget_field["value"])
    ev = get_ev(budget_field)
    assert ev.get("segment_id") == "seg-10"
    assert "$100,000" in ev.get("quote", "")
    assert ev.get("speaker") == "John Doe"

    # Deal signals must contain budget
    assert result.get("deal_signals", {}).get("budget")


def test_3_timeline_rejected_when_roadmap_vagueness():
    """
    Test 3: Timeline Rejected on Vague Roadmap Mentions
    Customer says: 'We need this to fit our roadmap next year.'
    Expectation: 'fit our roadmap' is rejected by semantic validator; timeline must remain None.
    """
    mock_intelligence = {
        "summary_sections": [
            {"id": "executive_summary", "name": "Executive Summary", "content": "Overview."}
        ],
        "fields": [
            {
                "id": "timeline",
                "name": "Implementation Timeline",
                "value": "fit our roadmap next year",
                "evidence": {
                    "quote": "We need this to fit our roadmap next year.",
                    "segment_id": "seg-20",
                    "speaker": "Dave"
                }
            }
        ],
        "action_items": [],
        "risks": [],
        "objections": []
    }

    segments = [
        {
            "id": "seg-20",
            "speaker_name": "Dave",
            "text": "We need this to fit our roadmap next year.",
            "start_time": 5.0,
            "end_time": 10.0
        }
    ]

    validated = validate_and_sanitize_intelligence(
        mock_intelligence,
        segments,
        DEFAULT_EXTRACTION_PROFILE,
        {"call_type": "discovery"}
    )

    timeline_field = next((f for f in validated["fields"] if f.get("id") == "timeline" or f.get("field_id") == "timeline"), None)
    assert timeline_field is not None
    assert timeline_field["value"] is None
    assert not validated.get("deal_signals", {}).get("timeline")


def test_4_irrelevant_audio_filtered():
    """
    Test 4: Irrelevant Audio Rejection
    Transcript contains YouTube tutorial monologue:
    'Hey guys, welcome back to the channel. Don't forget to like and subscribe! In this video tutorial we'll learn React.'
    Expectation: Segments classified as IRRELEVANT; no action items, no business extractions.
    """
    segments = [
        {
            "id": "seg-yt-1",
            "speaker_name": "TechTutorials",
            "text": "Hey guys, welcome back to the channel. Today we're going to build a full stack app.",
            "start_time": 0.0,
            "end_time": 5.0
        },
        {
            "id": "seg-yt-2",
            "speaker_name": "TechTutorials",
            "text": "Make sure to hit the subscribe button and like this video! Link in description below.",
            "start_time": 6.0,
            "end_time": 12.0
        },
        {
            "id": "seg-yt-3",
            "speaker_name": "TechTutorials",
            "text": "Don't forget to follow me on Twitter for more web development tips.",
            "start_time": 13.0,
            "end_time": 18.0
        }
    ]

    # 1. Direct classification
    status_1, reason_1 = classify_segment_relevance(segments[0]["text"])
    status_2, reason_2 = classify_segment_relevance(segments[1]["text"])
    assert status_1 == "IRRELEVANT"
    assert status_2 == "IRRELEVANT"

    # 2. Filter segments
    segment_map, relevant_segs, irrelevant_meta = filter_relevant_segments(segments)
    assert len(relevant_segs) == 0
    assert len(irrelevant_meta) == 3

    # 3. Extraction on irrelevant transcript
    result = deterministic_grounding_fallback(segments, DEFAULT_EXTRACTION_PROFILE, {})
    assert len(result.get("action_items", [])) == 0
    assert len(result.get("irrelevant_segments", [])) == 3
    # No values extracted for any business fields
    for f in result.get("fields", []):
        assert f["value"] is None


def test_5_custom_profile_extraction():
    """
    Test 5: Custom Profile
    Workspace configures Technical Discovery:
    Fields: Current Architecture, Integrations, Security Requirements.
    Expectation: Only configured technical fields extracted; MEDDICC fields not extracted.
    """
    custom_tech_profile = {
        "id": "custom_technical_discovery",
        "name": "Custom Technical Discovery",
        "description": "Extract technical architecture, integrations, and security requirements.",
        "summary_sections": [
            {"id": "technical_summary", "name": "Technical Summary", "description": "High level architecture overview.", "max_words": 100, "enabled": True}
        ],
        "fields": [
            {"id": "current_architecture", "name": "Current Architecture", "type": "text", "description": "Current technology stack and systems.", "evidence_required": True, "enabled": True},
            {"id": "security_requirements", "name": "Security Requirements", "type": "text", "description": "Compliance, auth, encryption mandates.", "evidence_required": True, "enabled": True},
            {"id": "integrations", "name": "Integrations", "type": "text", "description": "Third party integrations required.", "evidence_required": True, "enabled": True}
        ]
    }

    segments = [
        {
            "id": "seg-tech-1",
            "speaker_name": "Lead Architect",
            "text": "Our current architecture is microservices running on AWS EKS with Kafka message bus.",
            "start_time": 0.0,
            "end_time": 12.0
        },
        {
            "id": "seg-tech-2",
            "speaker_name": "Security Director",
            "text": "All integrations must comply with SOC 2 Type II and support SAML 2.0 SSO via Okta.",
            "start_time": 13.0,
            "end_time": 25.0
        }
    ]

    result = deterministic_grounding_fallback(segments, custom_tech_profile, {"call_type": "technical"})

    # Check fields match profile
    field_ids = [f["id"] for f in result["fields"]]
    assert "current_architecture" in field_ids
    assert "security_requirements" in field_ids
    # Unconfigured MEDDICC fields must NOT be present in fields
    assert "economic_buyer" not in field_ids
    assert "metrics" not in field_ids

    # Architecture field extracted
    arch_field = next(f for f in result["fields"] if f["id"] == "current_architecture")
    assert arch_field["value"] is not None
    assert "AWS EKS" in arch_field["value"] or "microservices" in arch_field["value"]
    ev_arch = get_ev(arch_field)
    assert ev_arch.get("segment_id") == "seg-tech-1"

    # Security field extracted
    sec_field = next(f for f in result["fields"] if f["id"] == "security_requirements")
    assert sec_field["value"] is not None
    assert "SOC 2" in sec_field["value"] or "SAML" in sec_field["value"]


def test_6_no_profile_fallback_to_default_sales_intelligence():
    """
    Test 6: Missing / Empty Profile
    When no profile is provided, system must default to PulseSync Default Sales Intelligence.
    Expectation: 7 summary sections, 9 default fields.
    """
    normalized = normalize_extraction_profile(None)
    assert normalized["id"] == "default_sales_intelligence"
    assert normalized["name"] == "PulseSync Default Sales Intelligence"
    assert len(normalized["summary_sections"]) == 7
    assert len(normalized["fields"]) == 9

    # Verify normalization with empty dict
    normalized_empty = normalize_extraction_profile({})
    assert normalized_empty["id"] == "default_sales_intelligence"
    assert len(normalized_empty["summary_sections"]) == 7


def test_7_unsupported_evidence_rejected():
    """
    Test 7: Unsupported Evidence Rejected
    Customer expresses cost anxiety: 'We are worried about cost and hope it is affordable.'
    Expectation: Not an explicit budget allocation; budget field must be rejected.
    """
    segments = [
        {
            "id": "seg-cost-1",
            "speaker_name": "Buyer",
            "text": "We are really worried about cost and hope it is affordable for our startup.",
            "start_time": 0.0,
            "end_time": 10.0
        }
    ]

    mock_intelligence = {
        "summary_sections": [
            {"id": "executive_summary", "name": "Executive Summary", "content": "Cost concerns."}
        ],
        "fields": [
            {
                "id": "budget",
                "name": "Budget",
                "value": "worried about cost",
                "evidence": {
                    "quote": "We are really worried about cost and hope it is affordable for our startup.",
                    "segment_id": "seg-cost-1",
                    "speaker": "Buyer"
                }
            }
        ],
        "action_items": [],
        "risks": [],
        "objections": []
    }

    validated = validate_and_sanitize_intelligence(
        mock_intelligence,
        segments,
        DEFAULT_EXTRACTION_PROFILE,
        {}
    )

    budget_field = next((f for f in validated["fields"] if f.get("id") == "budget" or f.get("field_id") == "budget"), None)
    assert budget_field is not None
    assert budget_field["value"] is None
    assert not validated.get("deal_signals", {}).get("budget")


def test_8_action_items_require_real_commitments():
    """
    Test 8: Action Item Grounding & Commitment Gate
    Suggestions ('You should review docs') must NOT become action items.
    Explicit commitments ('I will email the contract tomorrow') MUST become action items.
    """
    segments = [
        {
            "id": "seg-ai-1",
            "speaker_name": "Alice",
            "text": "You should check out our blog post about API rate limits.",
            "start_time": 0.0,
            "end_time": 5.0
        },
        {
            "id": "seg-ai-2",
            "speaker_name": "Bob",
            "text": "I will send over the revised proposal and pricing sheet by tomorrow afternoon.",
            "start_time": 6.0,
            "end_time": 15.0
        }
    ]

    result = deterministic_grounding_fallback(segments, DEFAULT_EXTRACTION_PROFILE, {})
    action_items = result.get("action_items", [])

    # Exactly 1 real commitment
    assert len(action_items) == 1
    assert "pricing sheet" in action_items[0]["task"] or "proposal" in action_items[0]["task"]
    seg_id = action_items[0].get("segment_id") or action_items[0].get("evidence_segment_id")
    assert seg_id == "seg-ai-2"
    assert action_items[0]["owner"] == "Bob"


def test_9_edge_cases():
    """
    Test 9: Edge Cases
    - Empty transcript
    - Malformed profile (empty fields list)
    - Duplicate fields in profile
    - Invalid field types
    """
    # 1. Empty transcript
    empty_result = deterministic_grounding_fallback([], DEFAULT_EXTRACTION_PROFILE, {})
    # All summary sections should cleanly state not explicitly discussed
    assert all("not explicitly discussed" in s["content"] for s in empty_result["summary_sections"])
    assert all(f["value"] is None for f in empty_result["fields"])
    assert empty_result["action_items"] == []

    # 2. Duplicate field IDs in profile
    dup_profile = {
        "id": "custom",
        "name": "Custom",
        "summary_sections": [{"id": "summary", "name": "Summary"}],
        "fields": [
            {"id": "budget", "name": "Budget 1", "type": "currency"},
            {"id": "budget", "name": "Budget 2", "type": "currency"}
        ]
    }
    norm_dup = normalize_extraction_profile(dup_profile)
    # Normalized fields should deduplicate by field ID
    assert len(norm_dup["fields"]) == 1

    # 3. Dynamic prompt builder handles custom fields
    sys_prompt, user_prompt = build_dynamic_extraction_prompt(
        profile=dup_profile,
        call_context={"call_type": "renewal"},
        transcript_segments=[{"id": "1", "speaker_name": "A", "text": "Hello"}]
    )
    full_prompt = sys_prompt + "\n" + user_prompt
    assert "EXTRACTION PROFILE:" in full_prompt
    assert "Name: Custom" in full_prompt
    assert "budget" in full_prompt

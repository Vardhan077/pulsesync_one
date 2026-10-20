import os
import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import extraction_engine as ee


def test_irrelevant_transcript_never_reaches_llm(monkeypatch):
    calls = []

    def forbidden_llm(*args, **kwargs):
        calls.append(True)
        raise AssertionError("LLM should not be called when the transcript contains no relevant business discussion")

    monkeypatch.setattr(ee, "call_llm_json", forbidden_llm)
    transcript = [
        {"id": "1", "speaker_name": "Video", "text": "Welcome back to the channel. Like and subscribe!", "start_time": 0, "end_time": 3},
        {"id": "2", "speaker_name": "Video", "text": "In this tutorial we will build a React app.", "start_time": 4, "end_time": 8},
    ]

    result = ee.extract_grounded_meeting_intelligence(transcript_segments=transcript)
    assert calls == []
    assert len(result["irrelevant_segments"]) == 2
    assert all(field["value"] is None for field in result["fields"])
    assert result["action_items"] == []


def test_dynamic_prompt_excludes_irrelevant_content():
    transcript = [
        {"id": "1", "speaker_name": "Buyer", "text": "We need SSO and SOC 2 support before rollout.", "start_time": 0, "end_time": 4},
        {"id": "2", "speaker_name": "Video", "text": "Like and subscribe to my Python series.", "start_time": 5, "end_time": 8},
    ]
    _, relevant, irrelevant = ee.filter_relevant_segments(transcript)
    _, prompt = ee.build_dynamic_extraction_prompt(
        profile=ee.DEFAULT_EXTRACTION_PROFILE,
        call_context=None,
        transcript_segments=relevant,
    )
    assert len(irrelevant) == 1
    assert "SSO" in prompt
    assert "like and subscribe" not in prompt.lower()


def test_custom_profile_is_the_only_source_of_structured_fields():
    profile = {
        "id": "custom",
        "name": "Technical Review",
        "summary_sections": [
            {"id": "technical_summary", "name": "Technical Summary", "description": "Technical discussion", "max_words": 80, "enabled": True}
        ],
        "fields": [
            {"id": "database", "name": "Database", "type": "text", "description": "Database used", "enabled": True, "evidence_required": True}
        ]
    }
    transcript = [{"id": "1", "speaker_name": "Architect", "text": "We currently run PostgreSQL.", "start_time": 0, "end_time": 2}]
    result = ee.deterministic_grounding_fallback(transcript, profile=profile)
    ids = [field["field_id"] for field in result["fields"]]
    assert ids == ["database"]
    assert result["fields"][0]["value"] is not None

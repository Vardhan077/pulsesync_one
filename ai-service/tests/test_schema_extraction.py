import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from extraction_engine import generate_dynamic_extraction_prompt, run_schema_extraction

def test_dynamic_prompt_builder():
    """
    Validates that the dynamic prompt compiler correctly converts field metadata,
    descriptions, type mappings, and prompt hints into plain-text instructions.
    """
    test_schema = [
        {
            "name": "notice_period",
            "field_type": "enum",
            "is_required": True,
            "description": "Notice period of candidate.",
            "prompt_hint": "Look for Immediate, 1 month, or 3 months."
        },
        {
            "name": "expected_salary",
            "field_type": "currency",
            "is_required": False,
            "description": "Expected annual CTC.",
            "prompt_hint": "Look for salary numbers like $120k or one hundred thousand."
        }
    ]

    prompt = generate_dynamic_extraction_prompt(test_schema)
    
    # Assertions
    assert "notice_period" in prompt
    assert "expected_salary" in prompt
    assert "Notice period of candidate." in prompt
    assert "Expected annual CTC." in prompt
    assert "Look for Immediate, 1 month, or 3 months." in prompt
    assert "Look for salary numbers like $120k or one hundred thousand." in prompt
    assert "MUST be exactly one of the following values" in prompt  # enum instruction trigger
    assert "Output numeric values only" in prompt  # currency instruction trigger

def test_fallback_mock_extractions_builder():
    """
    Verifies that the high-fidelity mock extraction engine processes configured
    custom schemas and maps them correctly against the dialogue text.
    """
    transcript = "Vardhan: I am looking for $50,000 for this project sync. Also, I expect to start in 30 days."
    test_schema = [
        {
            "name": "budget",
            "field_type": "currency",
            "is_required": True,
            "description": "Allocated project budget."
        },
        {
            "name": "timeline",
            "field_type": "string",
            "is_required": False,
            "description": "Project implementation timeline."
        },
        {
            "name": "renewal_risk",
            "field_type": "string",
            "is_required": False,
            "description": "Chances of customer churning."
        }
    ]

    extracted = run_schema_extraction(transcript, test_schema)

    # Assertions
    assert extracted is not None
    assert "budget" in extracted
    assert "timeline" in extracted
    assert "renewal_risk" in extracted
    # Offline fallback must not invent or normalize values beyond transcript evidence.
    assert extracted["renewal_risk"] is None

"""
Test Suite: Production-Grade Dynamic Rule Engine & False-Positive Elimination
=============================================================================
Verifies that:
1. Educational / technical tutorial transcripts (such as Testing2) do NOT extract false-positive
   business fields (e.g. Java package structure sentences into BANT 'Need').
2. Genuine sales conversations (such as Northstar) continue to extract real facts with high fidelity.
3. Mixed conversations (technical discussions containing a real sales requirement) correctly extract
   the legitimate requirement without false rejection.
4. Arbitrary custom technical schemas (e.g. Technical Discovery) extract technical entities when
   the schema field definition specifically requests them.
5. DynamicRuleEngine multi-tier validation correctly enforces schema types, discourse gating,
   and semantic family contracts.
"""

import sys
import os
import pytest

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from rule_engine import DynamicRuleEngine
from extraction_engine import (
    DEFAULT_EXTRACTION_PROFILE,
    EXTRACTION_PROFILE_TEMPLATES,
    extract_grounded_meeting_intelligence,
    deterministic_grounding_fallback,
    validate_field_semantics
)


# ─────────────────────────────────────────────────────────────────────────────
# FIXTURES
# ─────────────────────────────────────────────────────────────────────────────

TESTING2_JAVA_TRANSCRIPT = [
    {
        "segment_id": "seg-00",
        "speaker_name": "Instructor",
        "text": "This is an AI assistant, AI chatbot where it will take a command in natural language and it is internally converting it to SQL query and see, it is showing you the results.",
        "start_time": 0.0,
        "end_time": 10.0
    },
    {
        "segment_id": "seg-01",
        "speaker_name": "Instructor",
        "text": "We also have this option for data ingestion where you can connect with different connectors, you know, Salesforce, SQL Server. There are so many different connectors. So you can connect to all these connectors, bring your data into Databricks and work on data engineering, AI, etc.",
        "start_time": 11.0,
        "end_time": 25.0
    },
    {
        "segment_id": "seg-02",
        "speaker_name": "Instructor",
        "text": "Now we will look at data frame basics. For this I will go to my workspace and create a new notebook. Now if you have studied pandas pandas has data frame similarly spark has a data frame and we are using Python here so the module or the library that we are using is PySpark",
        "start_time": 26.0,
        "end_time": 40.0
    },
    {
        "segment_id": "seg-05",
        "speaker_name": "Instructor",
        "text": "Don't you think string is also a class? And one of our favorite class, which is system. System is also a class, right? So when you're using system, we have never imported it. Does system belong to a package? And the answer is yes. This class, system class, belongs to our package java.lang but we never imported it.",
        "start_time": 41.0,
        "end_time": 60.0
    },
    {
        "segment_id": "seg-06",
        "speaker_name": "Instructor",
        "text": "And if you want all the files, you can simply say star. Just like we have tools here. In tools, we only have two files, and we are importing both. So basically, if you want to import all the files, you can say star, okay? So that's how you can create a package in Java.",
        "start_time": 61.0,
        "end_time": 80.0
    },
    {
        "segment_id": "seg-07",
        "speaker_name": "Instructor",
        "text": "Others.tools.calc. Okay, that's how you have to import it and of course you can say star it will import everything now my question to you is if i say import other dot star now is this two line same?",
        "start_time": 81.0,
        "end_time": 100.0
    },
    {
        "segment_id": "seg-08",
        "speaker_name": "Instructor",
        "text": "Inside folder which is tools so if you want others and tools as well so you have to mention others.tools.star so that's how basically you use a package structure now there's one thing you know",
        "start_time": 101.0,
        "end_time": 120.0
    }
]


# ─────────────────────────────────────────────────────────────────────────────
# TEST A: Regression Test for Testing2 Call with BANT and MEDDICC
# ─────────────────────────────────────────────────────────────────────────────

def test_testing2_bant_has_zero_false_positives():
    """
    Test A1: Testing2 Java tutorial transcript evaluated against BANT.
    Expectation:
    - Budget: None
    - Authority: None
    - Need: None (CRITICAL: Java package tutorial must NOT be extracted into Need)
    - Timeline: None
    - All statuses must be 'not_mentioned'
    """
    bant_profile = EXTRACTION_PROFILE_TEMPLATES["bant"]
    result = extract_grounded_meeting_intelligence(TESTING2_JAVA_TRANSCRIPT, profile=bant_profile)

    fields_by_id = {f["field_id"]: f for f in result.get("fields", [])}

    # Verify Need field specifically
    need_field = fields_by_id.get("need")
    assert need_field is not None
    assert need_field["value"] is None, f"Need should be None, but got: {need_field['value']}"
    assert need_field["status"] == "not_mentioned"
    assert need_field["evidence"] == []

    # Verify all other BANT fields
    for fid in ["budget", "authority", "timeline"]:
        field = fields_by_id.get(fid)
        assert field is not None
        assert field["value"] is None, f"{fid} should be None, but got: {field['value']}"
        assert field["status"] == "not_mentioned"

    # Deal intelligence signals must be clean
    signals = result.get("deal_signals", {})
    assert signals.get("budget") is None
    assert signals.get("timeline") is None
    assert signals.get("champion") is None
    assert signals.get("decision_maker") is None


def test_testing2_meddicc_has_zero_false_positives():
    """
    Test A2: Testing2 evaluated against MEDDICC.
    None of the sales methodology fields should be populated from Java tutorial banter.
    """
    meddicc_profile = EXTRACTION_PROFILE_TEMPLATES["meddicc"]
    result = extract_grounded_meeting_intelligence(TESTING2_JAVA_TRANSCRIPT, profile=meddicc_profile)

    for field in result.get("fields", []):
        assert field["value"] is None, f"MEDDICC field {field['field_id']} falsely extracted: {field['value']}"
        assert field["status"] == "not_mentioned"


# ─────────────────────────────────────────────────────────────────────────────
# TEST B: Mixed Conversation (Technical conversation with a real customer requirement)
# ─────────────────────────────────────────────────────────────────────────────

def test_mixed_technical_and_business_conversation():
    """
    Test B: A technical architecture call where the customer states a genuine business requirement.
    The rule engine must NOT globally reject candidates just because the call is technical.
    It must preserve the genuine requirement while rejecting tutorial/syntax chatter.
    """
    mixed_transcript = [
        {
            "segment_id": "seg-01",
            "speaker_name": "Engineer",
            "text": "We run PySpark jobs on Databricks with a SQL connector.",
            "start_time": 0.0,
            "end_time": 10.0
        },
        {
            "segment_id": "seg-02",
            "speaker_name": "Instructor",
            "text": "So if you want others and tools as well so you have to mention others.tools.star.",
            "start_time": 11.0,
            "end_time": 20.0
        },
        {
            "segment_id": "seg-03",
            "speaker_name": "VP Tech",
            "text": "Our primary requirement is to support SOC-2 compliant SSO before November 15th.",
            "start_time": 21.0,
            "end_time": 30.0
        }
    ]

    bant_profile = EXTRACTION_PROFILE_TEMPLATES["bant"]
    result = extract_grounded_meeting_intelligence(mixed_transcript, profile=bant_profile)

    fields_by_id = {f["field_id"]: f for f in result.get("fields", [])}

    # Need should be successfully extracted from seg-03 (genuine customer requirement)
    need_field = fields_by_id.get("need")
    assert need_field is not None
    assert need_field["value"] is not None
    assert "SOC-2" in need_field["value"] or "primary requirement" in need_field["value"]
    assert need_field["status"] == "explicit"

    # Timeline should also extract the November launch target
    timeline_field = fields_by_id.get("timeline")
    assert timeline_field is not None
    assert timeline_field["value"] is not None
    assert "November" in timeline_field["value"]


# ─────────────────────────────────────────────────────────────────────────────
# TEST C: Arbitrary Custom Technical Schema
# ─────────────────────────────────────────────────────────────────────────────

def test_arbitrary_custom_technical_schema():
    """
    Test C: An arbitrary custom schema configured for technical discovery.
    When a field explicitly asks for connectors or programming libraries,
    the rule engine must allow and extract those technical entities.
    """
    custom_tech_profile = {
        "id": "custom_tech_discovery",
        "name": "Custom Tech Discovery",
        "summary_sections": [
            {"id": "tech_overview", "name": "Technical Overview", "description": "Overview of technical stack", "enabled": True}
        ],
        "fields": [
            {
                "id": "data_connectors",
                "name": "Data Connectors",
                "type": "text",
                "description": "Connectors and external integrations discussed (e.g. Salesforce, SQL Server)",
                "enabled": True
            },
            {
                "id": "code_framework",
                "name": "Code Framework",
                "type": "text",
                "description": "Programming language or dataframe framework used (e.g. PySpark, Pandas)",
                "enabled": True
            }
        ]
    }

    result = extract_grounded_meeting_intelligence(TESTING2_JAVA_TRANSCRIPT, profile=custom_tech_profile)

    fields_by_id = {f["field_id"]: f for f in result.get("fields", [])}

    # Connectors should extract from seg-01 (Salesforce, SQL Server)
    conn_field = fields_by_id.get("data_connectors")
    assert conn_field is not None
    assert conn_field["value"] is not None
    assert "Salesforce" in conn_field["value"] or "connectors" in conn_field["value"]

    # Code framework should extract from seg-02 (PySpark, pandas)
    frame_field = fields_by_id.get("code_framework")
    assert frame_field is not None
    assert frame_field["value"] is not None
    assert "PySpark" in frame_field["value"] or "spark" in frame_field["value"].lower()


# ─────────────────────────────────────────────────────────────────────────────
# TEST D: Direct DynamicRuleEngine Unit Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_dynamic_rule_engine_discourse_filter():
    """
    Direct unit test for DynamicRuleEngine discourse and modality detection.
    """
    tutorial_sentence = "inside folder which is tools so if you want others and tools as well so you have to mention others.tools.star so that's how basically you use a package structure now there's one thing you know"
    customer_sentence = "We need bidirectional synchronization between Zendesk and Salesforce with sub-second latency."

    sales_fdef = {"id": "need", "name": "Customer Need", "description": "Business requirement"}
    code_fdef = {"id": "import_syntax", "name": "Import Syntax", "description": "Programming syntax for imports"}

    # Tutorial sentence must be identified as instructional discourse for sales fields
    assert DynamicRuleEngine.is_instructional_or_hypothetical_discourse(tutorial_sentence, sales_fdef) is True

    # Tutorial sentence is NOT filtered out if the field specifically asks for code syntax
    assert DynamicRuleEngine.is_instructional_or_hypothetical_discourse(tutorial_sentence, code_fdef) is False

    # Customer requirement sentence is NOT tutorial discourse
    assert DynamicRuleEngine.is_instructional_or_hypothetical_discourse(customer_sentence, sales_fdef) is False

    # Customer requirement signal detection
    assert DynamicRuleEngine.has_genuine_customer_need_signal(customer_sentence) is True
    assert DynamicRuleEngine.has_genuine_customer_need_signal(tutorial_sentence) is False


def test_dynamic_rule_engine_type_conformance():
    """
    Direct unit test for DynamicRuleEngine schema type conformance.
    """
    # Currency
    ok, val, _ = DynamicRuleEngine.validate_schema_type("$50,000", "currency")
    assert ok and val == "$50,000"

    ok, val, _ = DynamicRuleEngine.validate_schema_type("we have plenty of money", "currency")
    assert not ok

    # Boolean
    ok, val, _ = DynamicRuleEngine.validate_schema_type("yes", "boolean")
    assert ok and val == "true"

    ok, val, _ = DynamicRuleEngine.validate_schema_type("maybe", "boolean")
    assert not ok

    # Enum
    ok, val, _ = DynamicRuleEngine.validate_schema_type("Discovery", "enum", options=["Discovery", "Pilot", "Closed Won"], evidence_text="We are currently in discovery call")
    assert ok and val == "Discovery"

    ok, val, _ = DynamicRuleEngine.validate_schema_type("InvalidStage", "enum", options=["Discovery", "Pilot"])
    assert not ok

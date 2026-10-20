import os
import sys
import pytest

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from extraction_engine import (
    EXTRACTION_PROFILE_TEMPLATES,
    normalize_extraction_profile,
    deterministic_grounding_fallback,
    validate_and_sanitize_intelligence,
    build_dynamic_extraction_prompt,
    extract_grounded_meeting_intelligence
)

NORTHSTAR_TRANSCRIPT = [
    {
        "segment_id": "seg-01",
        "speaker_name": "Daniel",
        "role": "sales_rep",
        "text": "Hi Priya. Thanks for joining. I know you've got a busy schedule, so I'll keep this focused.",
        "start_time": 0.0,
        "end_time": 6.0
    },
    {
        "segment_id": "seg-02",
        "speaker_name": "Priya",
        "role": "buyer",
        "text": "The biggest problem is that information from our customer calls ends up scattered across different places.",
        "start_time": 7.0,
        "end_time": 14.0
    },
    {
        "segment_id": "seg-03",
        "speaker_name": "Priya",
        "role": "buyer",
        "text": "Every Friday, my team spends several hours trying to turn all of that into one report.",
        "start_time": 15.0,
        "end_time": 21.0
    },
    {
        "segment_id": "seg-04",
        "speaker_name": "Priya",
        "role": "buyer",
        "text": "Usually around six to eight hours across the team.",
        "start_time": 22.0,
        "end_time": 26.0
    },
    {
        "segment_id": "seg-05",
        "speaker_name": "Priya",
        "role": "buyer",
        "text": "I'd want the system to identify the important operational issues automatically and give us a consistent view across customer conversations.",
        "start_time": 27.0,
        "end_time": 36.0
    },
    {
        "segment_id": "seg-06",
        "speaker_name": "Priya",
        "role": "buyer",
        "text": "I don't want another dashboard that nobody checks. I want something that actually reduces the reporting work.",
        "start_time": 37.0,
        "end_time": 44.0
    },
    {
        "segment_id": "seg-07",
        "speaker_name": "Priya",
        "role": "buyer",
        "text": "Yes. We're looking at Gong as well.",
        "start_time": 45.0,
        "end_time": 49.0
    },
    {
        "segment_id": "seg-08",
        "speaker_name": "Priya",
        "role": "buyer",
        "text": "Ideally before October 15th.",
        "start_time": 50.0,
        "end_time": 54.0
    },
    {
        "segment_id": "seg-09",
        "speaker_name": "Priya",
        "role": "buyer",
        "text": "Yes. We've set aside $18,500 for the first year.",
        "start_time": 55.0,
        "end_time": 60.0
    },
    {
        "segment_id": "seg-10",
        "speaker_name": "Daniel",
        "role": "sales_rep",
        "text": "I think the best next step would be a small pilot rather than trying to configure everything immediately.",
        "start_time": 61.0,
        "end_time": 68.0
    },
    {
        "segment_id": "seg-11",
        "speaker_name": "Priya",
        "role": "buyer",
        "text": "I agree. I'd rather test it with a limited set of customer conversations first.",
        "start_time": 69.0,
        "end_time": 75.0
    },
    {
        "segment_id": "seg-12",
        "speaker_name": "Daniel",
        "role": "sales_rep",
        "text": "I'll send you a sample data export format that we can use for the pilot.",
        "start_time": 76.0,
        "end_time": 82.0
    },
    {
        "segment_id": "seg-13",
        "speaker_name": "Priya",
        "role": "buyer",
        "text": "I'll send the security questionnaire tomorrow.",
        "start_time": 83.0,
        "end_time": 87.0
    },
    {
        "segment_id": "seg-14",
        "speaker_name": "Daniel",
        "role": "sales_rep",
        "text": "Once we have that, we can run an operations workshop with your team and decide which fields and reporting categories should be included in the pilot.",
        "start_time": 88.0,
        "end_time": 98.0
    },
    {
        "segment_id": "seg-15",
        "speaker_name": "Priya",
        "role": "buyer",
        "text": "I'd also like our customer operations manager to join that workshop.",
        "start_time": 99.0,
        "end_time": 104.0
    },
    {
        "segment_id": "seg-16",
        "speaker_name": "Daniel",
        "role": "sales_rep",
        "text": "I'll send the pilot data requirements and some suggested times for the workshop.",
        "start_time": 105.0,
        "end_time": 112.0
    },
    {
        "segment_id": "seg-17",
        "speaker_name": "Priya",
        "role": "buyer",
        "text": "If the pilot works without creating a lot of additional work for the team, I think we can move forward.",
        "start_time": 113.0,
        "end_time": 120.0
    }
]


def test_northstar_meddicc_semantic_extraction():
    """
    Validates Section 8 & 9:
    When MEDDICC is selected:
    - Metrics: $18,500 / 6-8 hours
    - Economic Buyer: Not mentioned (Priya talks budget but doesn't have approval authority)
    - Decision Criteria: Grounded in requirements
    - Decision Process: Pilot / workshop / questionnaire
    - Identify Pain: Scattered calls / reporting hours
    - Champion: Not mentioned (no active advocacy)
    - Competition: Gong
    """
    meddicc_profile = EXTRACTION_PROFILE_TEMPLATES["meddicc"]
    result = deterministic_grounding_fallback(NORTHSTAR_TRANSCRIPT, profile=meddicc_profile)

    fields_dict = {f["field_id"]: f for f in result["fields"]}

    # Metrics
    assert "metrics" in fields_dict
    assert fields_dict["metrics"]["value"] is not None
    assert "$18,500" in fields_dict["metrics"]["value"] or "hours" in fields_dict["metrics"]["value"].lower()

    # Economic Buyer must be None and not_mentioned
    assert "economic_buyer" in fields_dict
    assert fields_dict["economic_buyer"]["value"] is None
    assert fields_dict["economic_buyer"]["status"] == "not_mentioned"
    assert len(fields_dict["economic_buyer"]["evidence"]) == 0

    # Decision Criteria
    assert "decision_criteria" in fields_dict
    assert fields_dict["decision_criteria"]["value"] is not None
    assert any(w in fields_dict["decision_criteria"]["value"].lower() for w in ["operational", "reporting", "automatic", "consistent"])

    # Decision Process
    assert "decision_process" in fields_dict
    assert fields_dict["decision_process"]["value"] is not None
    assert any(w in fields_dict["decision_process"]["value"].lower() for w in ["pilot", "workshop", "questionnaire"])

    # Identify Pain
    assert "identify_pain" in fields_dict
    assert fields_dict["identify_pain"]["value"] is not None
    assert any(w in fields_dict["identify_pain"]["value"].lower() for w in ["problem", "scattered", "hours"])

    # Champion must be None and not_mentioned
    assert "champion" in fields_dict
    assert fields_dict["champion"]["value"] is None
    assert fields_dict["champion"]["status"] == "not_mentioned"

    # Competition must be Gong
    assert "competition" in fields_dict
    assert fields_dict["competition"]["value"] is not None
    assert "gong" in fields_dict["competition"]["value"].lower()
    ev_comp = fields_dict["competition"]["evidence"][0]
    assert ev_comp["segment_id"] == "seg-07"
    assert "Gong" in ev_comp["quote"]


def test_northstar_action_items_semantic_commitments():
    """
    Validates Section 10:
    Detects semantic commitments:
    - Daniel: send sample data export format
    - Priya: send security questionnaire (deadline: tomorrow)
    - Daniel: send pilot data requirements / workshop times
    - Operations workshop / customer operations manager
    """
    meddicc_profile = EXTRACTION_PROFILE_TEMPLATES["meddicc"]
    result = deterministic_grounding_fallback(NORTHSTAR_TRANSCRIPT, profile=meddicc_profile)

    actions = result.get("action_items", [])
    assert len(actions) >= 3

    # Daniel export format
    daniel_export = next((a for a in actions if "sample data export" in a["task"].lower() or "export format" in a["task"].lower()), None)
    assert daniel_export is not None
    assert daniel_export["owner"] == "Daniel"
    assert daniel_export["commitment_type"] == "rep_commitment"

    # Priya security questionnaire with deadline Tomorrow
    priya_quest = next((a for a in actions if "security questionnaire" in a["task"].lower()), None)
    assert priya_quest is not None
    assert priya_quest["owner"] == "Priya"
    assert priya_quest["commitment_type"] == "buyer_commitment"
    assert priya_quest["deadline"] is not None
    assert "tomorrow" in priya_quest["deadline"].lower()

    # Daniel pilot requirements / suggested times
    daniel_reqs = next((a for a in actions if "pilot data requirements" in a["task"].lower() or "suggested times" in a["task"].lower()), None)
    assert daniel_reqs is not None
    assert daniel_reqs["owner"] == "Daniel"


def test_custom_operations_profile_arbitrary_field_ids():
    """
    Validates Section 2, 3, 5, 19:
    Custom Operations Profile with arbitrary field IDs:
    - customer_problem (type: text)
    - alternative_vendor (type: text)
    - implementation_deadline (type: text)
    - annual_budget (type: currency)
    - implementation_readiness (type: text)

    Must extract correctly from transcript purely based on name, description, and type.
    NO hardcoded field ID branches allowed!
    """
    custom_ops_profile = {
        "id": "custom_operations_review",
        "name": "Operations Assessment",
        "description": "Assess operational workflow friction, vendor alternatives, timeline, and budget.",
        "summary_sections": [
            {
                "id": "workflow_friction",
                "name": "Workflow Friction",
                "description": "Operational bottlenecks and reporting issues explicitly described.",
                "max_words": 100,
                "enabled": True
            },
            {
                "id": "rollout_plan",
                "name": "Rollout Plan",
                "description": "Agreed pilot and operations workshop plan.",
                "max_words": 80,
                "enabled": True
            }
        ],
        "fields": [
            {
                "id": "customer_problem",
                "name": "Primary Customer Problem",
                "type": "text",
                "description": "The main operational or business problem explicitly described by the customer.",
                "evidence_required": True,
                "enabled": True
            },
            {
                "id": "alternative_vendor",
                "name": "Alternative Vendor Evaluated",
                "type": "text",
                "description": "External tools or vendors explicitly named as being evaluated.",
                "evidence_required": True,
                "enabled": True
            },
            {
                "id": "implementation_deadline",
                "name": "Target Go-Live Date",
                "type": "text",
                "description": "Explicit deadline or timeframe stated.",
                "evidence_required": True,
                "enabled": True
            },
            {
                "id": "annual_budget",
                "name": "Allocated Budget",
                "type": "currency",
                "description": "Monetary amount allocated for the solution.",
                "evidence_required": True,
                "enabled": True
            },
            {
                "id": "implementation_readiness",
                "name": "Implementation Readiness",
                "type": "text",
                "description": "Customer readiness to test with a small pilot.",
                "evidence_required": True,
                "enabled": True
            }
        ]
    }

    result = deterministic_grounding_fallback(NORTHSTAR_TRANSCRIPT, profile=custom_ops_profile)

    fields_dict = {f["field_id"]: f for f in result["fields"]}

    # Verify only the configured custom field IDs are returned
    assert set(fields_dict.keys()) == {
        "customer_problem",
        "alternative_vendor",
        "implementation_deadline",
        "annual_budget",
        "implementation_readiness"
    }

    # customer_problem: Primary Customer Problem
    prob = fields_dict["customer_problem"]
    assert prob["value"] is not None
    assert prob["status"] == "explicit"
    assert any(w in prob["value"].lower() for w in ["problem", "scattered", "hours"])

    # alternative_vendor: Alternative Vendor Evaluated -> Gong
    alt = fields_dict["alternative_vendor"]
    assert alt["value"] is not None
    assert alt["status"] == "explicit"
    assert "gong" in alt["value"].lower()

    # implementation_deadline: Target Go-Live Date -> before October 15th
    deadline = fields_dict["implementation_deadline"]
    assert deadline["value"] is not None
    assert deadline["status"] == "explicit"
    assert "october 15" in deadline["value"].lower()

    # annual_budget: Allocated Budget -> $18,500
    budget = fields_dict["annual_budget"]
    assert budget["value"] is not None
    assert budget["status"] == "explicit"
    assert "$18,500" in budget["value"]

    # implementation_readiness: small pilot with limited set
    readiness = fields_dict["implementation_readiness"]
    assert readiness["value"] is not None
    assert readiness["status"] == "explicit"
    assert any(w in readiness["value"].lower() for w in ["pilot", "test", "conversations"])

    # Deal signals: dynamically derived from the custom fields
    assert result["deal_signals"]["budget"] == "$18,500 for the first year" or "$18,500" in str(result["deal_signals"]["budget"])
    assert result["deal_signals"]["competition"] == "Gong"
    assert "october 15" in str(result["deal_signals"]["timeline"]).lower()


def test_bant_template_on_northstar():
    """
    Validates BANT template dynamically extracts:
    - Budget: $18,500
    - Authority: Not mentioned (Priya has no explicit signoff)
    - Need: Scattered customer call notes / reporting friction
    - Timeline: Before October 15th
    """
    bant_profile = EXTRACTION_PROFILE_TEMPLATES["bant"]
    result = deterministic_grounding_fallback(NORTHSTAR_TRANSCRIPT, profile=bant_profile)

    fields_dict = {f["field_id"]: f for f in result["fields"]}

    # Budget
    assert fields_dict["budget"]["value"] is not None
    assert "$18,500" in fields_dict["budget"]["value"]

    # Authority: Not mentioned
    assert fields_dict["authority"]["value"] is None
    assert fields_dict["authority"]["status"] == "not_mentioned"

    # Need
    assert fields_dict["need"]["value"] is not None
    assert any(w in fields_dict["need"]["value"].lower() for w in ["problem", "scattered", "report", "view"])

    # Timeline
    assert fields_dict["timeline"]["value"] is not None
    assert "october 15" in fields_dict["timeline"]["value"].lower()

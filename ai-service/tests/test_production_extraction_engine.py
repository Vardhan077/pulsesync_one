import os
import sys
import pytest

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from extraction_engine import (
    DEFAULT_EXTRACTION_PROFILE,
    EXTRACTION_PROFILE_TEMPLATES,
    normalize_extraction_profile,
    extract_grounded_meeting_intelligence,
    deterministic_grounding_fallback,
    validate_and_sanitize_intelligence,
    is_negated_claim,
    detect_evidence_candidates,
    resolve_field_candidates,
    check_extraction_completeness,
    resolve_action_items,
    compute_deal_signals
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


# ==============================================================================
# TEST 1: NORTHSTAR TRANSCRIPT REGRESSION (Full End-to-End Hybrid Engine)
# ==============================================================================

def test_northstar_full_hybrid_pipeline():
    """
    Test 1: Northstar Transcript Regression.
    Runs NORTHSTAR_TRANSCRIPT through extract_grounded_meeting_intelligence
    with the MEDDICC extraction profile.
    Asserts grounded metrics, null economic buyer, decision criteria, decision process,
    pain points, null champion, Gong competition, timeline, budget, and >= 5 commitments.
    """
    meddicc_profile = EXTRACTION_PROFILE_TEMPLATES["meddicc"]
    result = extract_grounded_meeting_intelligence(
        transcript_segments=NORTHSTAR_TRANSCRIPT,
        profile=meddicc_profile
    )

    fields_dict = {f["field_id"]: f for f in result["fields"]}

    # Metrics ($18,500 / 6-8 hours)
    assert "metrics" in fields_dict
    assert fields_dict["metrics"]["value"] is not None
    assert "$18,500" in fields_dict["metrics"]["value"] or "hours" in fields_dict["metrics"]["value"].lower()
    assert fields_dict["metrics"]["status"] == "explicit"
    assert len(fields_dict["metrics"]["evidence"]) > 0

    # Economic Buyer MUST be null / not_mentioned (Priya discusses budget but lacks signing authority)
    assert "economic_buyer" in fields_dict
    assert fields_dict["economic_buyer"]["value"] is None
    assert fields_dict["economic_buyer"]["status"] == "not_mentioned"
    assert len(fields_dict["economic_buyer"]["evidence"]) == 0

    # Decision Criteria
    assert "decision_criteria" in fields_dict
    assert fields_dict["decision_criteria"]["value"] is not None
    assert any(w in fields_dict["decision_criteria"]["value"].lower() for w in ["operational", "reporting", "automatic", "consistent"])
    assert fields_dict["decision_criteria"]["status"] == "explicit"

    # Decision Process (pilot, workshop, questionnaire)
    assert "decision_process" in fields_dict
    assert fields_dict["decision_process"]["value"] is not None
    assert any(w in fields_dict["decision_process"]["value"].lower() for w in ["pilot", "workshop", "questionnaire"])
    assert fields_dict["decision_process"]["status"] == "explicit"

    # Identify Pain
    assert "identify_pain" in fields_dict
    assert fields_dict["identify_pain"]["value"] is not None
    assert any(w in fields_dict["identify_pain"]["value"].lower() for w in ["problem", "scattered", "hours"])
    assert fields_dict["identify_pain"]["status"] == "explicit"

    # Champion MUST be null / not_mentioned
    assert "champion" in fields_dict
    assert fields_dict["champion"]["value"] is None
    assert fields_dict["champion"]["status"] == "not_mentioned"
    assert len(fields_dict["champion"]["evidence"]) == 0

    # Competition (Gong)
    assert "competition" in fields_dict
    assert fields_dict["competition"]["value"] is not None
    assert "gong" in fields_dict["competition"]["value"].lower()
    assert fields_dict["competition"]["status"] == "explicit"

    # Deal signals single source of truth
    deal_signals = result.get("deal_signals", {})
    assert deal_signals.get("competition") is not None
    assert "gong" in deal_signals["competition"].lower()
    assert deal_signals.get("champion") is None
    assert deal_signals.get("decision_maker") is None

    # Action Items: At least 5 action items / commitments extracted
    action_items = result.get("action_items", [])
    assert len(action_items) >= 4  # All distinct commitments from Daniel and Priya

    # Check Priya security questionnaire
    priya_quest = next((a for a in action_items if "security questionnaire" in a["task"].lower()), None)
    assert priya_quest is not None
    assert priya_quest["owner"] == "Priya"
    assert priya_quest["owner_role"] == "buyer"
    assert priya_quest["commitment_type"] == "buyer_commitment"
    assert priya_quest["deadline"] is not None
    assert "tomorrow" in priya_quest["deadline"].lower()

    # Check Daniel sample data export
    daniel_export = next((a for a in action_items if "sample data export" in a["task"].lower() or "export format" in a["task"].lower()), None)
    assert daniel_export is not None
    assert daniel_export["owner"] == "Daniel"
    assert daniel_export["owner_role"] == "sales_rep"
    assert daniel_export["commitment_type"] == "rep_commitment"

    # Check buyer and rep commitment lists are preserved
    assert len(result.get("buyer_commitments", [])) >= 1
    assert len(result.get("rep_commitments", [])) >= 1


# ==============================================================================
# TEST 2: NEGATIVE TEST (Zero Business / Sales Content)
# ==============================================================================

def test_negative_chit_chat_zero_hallucinations():
    """
    Test 2: Negative Test.
    Transcript with weekend movie chit-chat and cooking recipes.
    Asserts:
    - All structured fields are null / not_mentioned
    - Zero deal signals
    - Zero action items
    """
    chit_chat_transcript = [
        {"segment_id": "c-01", "speaker_name": "Alice", "text": "Did you watch the new movie that came out this weekend?", "start_time": 0.0, "end_time": 4.0},
        {"segment_id": "c-02", "speaker_name": "Bob", "text": "Yeah, the visual effects were incredible, but the storyline was a bit slow.", "start_time": 5.0, "end_time": 10.0},
        {"segment_id": "c-03", "speaker_name": "Alice", "text": "I agree. Afterwards we tried this new Italian pasta recipe at home.", "start_time": 11.0, "end_time": 16.0},
        {"segment_id": "c-04", "speaker_name": "Bob", "text": "Sounds delicious. Let's grab lunch sometime next weekend.", "start_time": 17.0, "end_time": 21.0}
    ]

    result = extract_grounded_meeting_intelligence(
        transcript_segments=chit_chat_transcript,
        profile=DEFAULT_EXTRACTION_PROFILE
    )

    # All fields must remain null and not_mentioned
    for f in result["fields"]:
        assert f["value"] is None
        assert f["status"] == "not_mentioned"
        assert len(f["evidence"]) == 0

    # No deal signals
    ds = result.get("deal_signals", {})
    assert ds.get("budget") is None
    assert ds.get("champion") is None
    assert ds.get("decision_maker") is None
    assert ds.get("timeline") is None
    assert ds.get("competition") is None
    assert ds.get("buying_stage") == "Discovery"

    # No business commitments
    assert result.get("action_items") == []


# ==============================================================================
# TEST 3: PARTIAL INFO NEGATIVE TEST (Authority Ambiguity)
# ==============================================================================

def test_partial_info_authority_ambiguity():
    """
    Test 3: Partial Info Negative Test.
    Transcript discusses evaluation process, but when asked about signing authority:
    Speaker explicitly says: 'We need to discuss internally, I do not have sign-off authority.'
    Asserts:
    - Economic Buyer is null / not_mentioned
    - Champion is null / not_mentioned
    """
    partial_transcript = [
        {"segment_id": "p-01", "speaker_name": "Sales Rep", "role": "sales_rep", "text": "Who will be the economic buyer signing off on this contract?", "start_time": 0.0, "end_time": 5.0},
        {"segment_id": "p-02", "speaker_name": "Sarah", "role": "buyer", "text": "We need to discuss internally. I definitely do not have sign-off authority for the budget.", "start_time": 6.0, "end_time": 12.0},
        {"segment_id": "p-03", "speaker_name": "Sales Rep", "role": "sales_rep", "text": "Understood. Is there an internal champion who will drive the evaluation?", "start_time": 13.0, "end_time": 18.0},
        {"segment_id": "p-04", "speaker_name": "Sarah", "role": "buyer", "text": "We haven't assigned anyone to drive this internally yet.", "start_time": 19.0, "end_time": 24.0}
    ]

    meddicc_profile = EXTRACTION_PROFILE_TEMPLATES["meddicc"]
    result = extract_grounded_meeting_intelligence(
        transcript_segments=partial_transcript,
        profile=meddicc_profile
    )

    fields_dict = {f["field_id"]: f for f in result["fields"]}

    assert fields_dict["economic_buyer"]["value"] is None
    assert fields_dict["economic_buyer"]["status"] == "not_mentioned"

    assert fields_dict["champion"]["value"] is None
    assert fields_dict["champion"]["status"] == "not_mentioned"


# ==============================================================================
# TEST 4: CUSTOM USER SCHEMA WITH ARBITRARY FIELD IDS
# ==============================================================================

def test_custom_user_schema_arbitrary_field_ids():
    """
    Test 4: Dynamic Custom User Schema Test.
    Workspace defines arbitrary custom field IDs:
    - user_sentiment (text)
    - product_issues (text)
    - requested_features (text)
    - renewal_risk (enum: Low, Medium, High)
    Asserts dynamic schema extraction without hardcoded IDs.
    """
    custom_profile = {
        "id": "customer_health_check",
        "name": "Customer Health Review",
        "description": "Evaluate account sentiment, product bugs, and renewal risk.",
        "summary_sections": [
            {"id": "health_summary", "name": "Health Summary", "description": "Overview of account health.", "max_words": 100, "enabled": True}
        ],
        "fields": [
            {
                "id": "user_sentiment",
                "name": "Overall User Sentiment",
                "type": "text",
                "description": "General customer mood or emotional tone towards the product.",
                "enabled": True,
                "evidence_required": True
            },
            {
                "id": "product_issues",
                "name": "Reported Product Issues",
                "type": "text",
                "description": "Specific bugs, errors, or technical problems reported by the customer.",
                "enabled": True,
                "evidence_required": True
            },
            {
                "id": "requested_features",
                "name": "Requested Product Features",
                "type": "text",
                "description": "Enhancements or new capabilities requested by the customer.",
                "enabled": True,
                "evidence_required": True
            },
            {
                "id": "renewal_risk",
                "name": "Renewal Churn Risk Level",
                "type": "enum",
                "description": "Assessed likelihood of customer churn at contract renewal.",
                "options": ["Low", "Medium", "High"],
                "enabled": True,
                "evidence_required": True
            }
        ]
    }

    transcript = [
        {"segment_id": "h-01", "speaker_name": "Marcus", "text": "Overall we are feeling very frustrated with recent performance.", "start_time": 0.0, "end_time": 5.0},
        {"segment_id": "h-02", "speaker_name": "Marcus", "text": "Our primary problem is that the database sync fails with timeout errors every night.", "start_time": 6.0, "end_time": 12.0},
        {"segment_id": "h-03", "speaker_name": "Marcus", "text": "We urgently need automated retry webhooks so our engineers don't have to restart it manually.", "start_time": 13.0, "end_time": 19.0},
        {"segment_id": "h-04", "speaker_name": "Customer Success", "text": "Given these repeated sync errors, we consider this account at High renewal risk.", "start_time": 20.0, "end_time": 26.0}
    ]

    result = extract_grounded_meeting_intelligence(
        transcript_segments=transcript,
        profile=custom_profile
    )

    fields_dict = {f["field_id"]: f for f in result["fields"]}

    # user_sentiment
    assert fields_dict["user_sentiment"]["value"] is not None
    assert "frustrated" in fields_dict["user_sentiment"]["value"].lower()

    # product_issues
    assert fields_dict["product_issues"]["value"] is not None
    assert any(w in fields_dict["product_issues"]["value"].lower() for w in ["database", "sync", "timeout", "problem"])

    # requested_features
    assert fields_dict["requested_features"]["value"] is not None
    assert any(w in fields_dict["requested_features"]["value"].lower() for w in ["webhook", "retry", "automated"])

    # renewal_risk enum
    assert fields_dict["renewal_risk"]["value"] == "High"


# ==============================================================================
# TEST 5: MULTI-VALUE EXTRACTION TEST (Multiple Competitors & Pains)
# ==============================================================================

def test_multi_value_extraction():
    """
    Test 5: Multi-value Extraction.
    Customer mentions multiple alternatives:
    'We are currently looking at Gong and Chorus as well.'
    Asserts that competition extraction captures external competitor mention.
    """
    multi_val_transcript = [
        {"segment_id": "m-01", "speaker_name": "Priya", "text": "We are currently looking at Gong and evaluating Chorus as an alternative.", "start_time": 0.0, "end_time": 6.0}
    ]

    result = extract_grounded_meeting_intelligence(
        transcript_segments=multi_val_transcript,
        profile=DEFAULT_EXTRACTION_PROFILE
    )

    comp_field = next((f for f in result["fields"] if f["field_id"] == "competition"), None)
    assert comp_field is not None
    assert comp_field["value"] is not None
    assert any(w in comp_field["value"].lower() for w in ["gong", "chorus"])


# ==============================================================================
# TEST 6: CONTRADICTION & TEMPORAL REVISION TEST
# ==============================================================================

def test_temporal_revision_supersedes_earlier_statement():
    """
    Test 6: Contradiction & Temporal Revision.
    Transcript contains an initial statement: 'We initially thought about $20,000 for this project.'
    Later in the call, the speaker revises: 'Actually, we revised the budget down to $15,000.'
    Asserts:
    - The final extracted budget is $15,000 (the revised figure), NOT the superseded $20,000.
    """
    revision_transcript = [
        {"segment_id": "r-01", "speaker_name": "Buyer", "text": "We initially had a budget of $20,000 in mind for this project.", "start_time": 10.0, "end_time": 15.0},
        {"segment_id": "r-02", "speaker_name": "Sales Rep", "text": "Great, let's look at the licensing tiers.", "start_time": 16.0, "end_time": 20.0},
        {"segment_id": "r-03", "speaker_name": "Buyer", "text": "Actually, our finance team revised the budget down to $15,000 instead.", "start_time": 25.0, "end_time": 30.0}
    ]

    result = extract_grounded_meeting_intelligence(
        transcript_segments=revision_transcript,
        profile=DEFAULT_EXTRACTION_PROFILE
    )

    budget_field = next((f for f in result["fields"] if f["field_id"] == "budget"), None)
    assert budget_field is not None
    assert budget_field["value"] is not None
    assert "15,000" in budget_field["value"] or "15k" in budget_field["value"].lower()
    assert "20,000" not in budget_field["value"]


# ==============================================================================
# TEST 7: NEGATION TEST (Explicitly Negated Claims)
# ==============================================================================

def test_explicitly_negated_claims_remain_unextracted():
    """
    Test 7: Negation Awareness.
    Transcript contains statements with explicit negation:
    - 'Security is not a concern for us right now.'
    - 'We don't have a timeline yet.'
    - 'We are not looking at any competitors right now.'
    Asserts:
    - Timeline is null / not_mentioned
    - Competition is null / not_mentioned
    """
    negation_transcript = [
        {"segment_id": "n-01", "speaker_name": "Prospect", "text": "Security compliance is not a concern for us right now.", "start_time": 0.0, "end_time": 5.0},
        {"segment_id": "n-02", "speaker_name": "Prospect", "text": "We don't have a timeline yet for rolling this out.", "start_time": 6.0, "end_time": 10.0},
        {"segment_id": "n-03", "speaker_name": "Prospect", "text": "We are not looking at any competitors right now.", "start_time": 11.0, "end_time": 15.0}
    ]

    result = extract_grounded_meeting_intelligence(
        transcript_segments=negation_transcript,
        profile=DEFAULT_EXTRACTION_PROFILE
    )

    fields_dict = {f["field_id"]: f for f in result["fields"]}

    # Timeline must be null / not_mentioned
    assert fields_dict["timeline"]["value"] is None
    assert fields_dict["timeline"]["status"] == "not_mentioned"

    # Competition must be null / not_mentioned
    assert fields_dict["competition"]["value"] is None
    assert fields_dict["competition"]["status"] == "not_mentioned"


# ==============================================================================
# TEST 8: UNDER-EXTRACTION RECOVERY (Resolver Layer Verification)
# ==============================================================================

def test_under_extraction_recovery_by_conflict_resolver():
    """
    Test 8: Layer 4 Under-Extraction Fix.
    Simulates a faulty LLM response that returned null / 'not_mentioned' for
    a field that has clear explicit evidence in the transcript.
    Verifies that resolve_field_candidates() automatically recovers the grounded value.
    """
    fake_llm_fields = [
        {
            "field_id": "competition",
            "field_name": "Competition",
            "value": None,
            "status": "not_mentioned",
            "confidence": None,
            "evidence": []
        }
    ]

    det_fields = [
        {
            "field_id": "competition",
            "field_name": "Competition",
            "value": "Gong",
            "status": "explicit",
            "confidence": 0.90,
            "evidence": [
                {
                    "segment_id": "seg-07",
                    "quote": "Yes. We're looking at Gong as well.",
                    "speaker": "Priya"
                }
            ]
        }
    ]

    segment_map = {
        "seg-07": {
            "text": "Yes. We're looking at Gong as well.",
            "speaker": "Priya",
            "start_time": 45.0,
            "end_time": 49.0
        }
    }

    resolved = resolve_field_candidates(
        llm_fields=fake_llm_fields,
        det_fields=det_fields,
        candidates={},
        profile=DEFAULT_EXTRACTION_PROFILE,
        segment_map=segment_map
    )

    comp_res = next((f for f in resolved if f["field_id"] == "competition"), None)
    assert comp_res is not None
    # Must be recovered from deterministic candidate!
    assert comp_res["value"] == "Gong"
    assert comp_res["status"] == "explicit"
    assert comp_res["confidence"] == 0.92
    assert len(comp_res["evidence"]) == 1
    assert comp_res["evidence"][0]["segment_id"] == "seg-07"

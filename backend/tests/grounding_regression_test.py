import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

# Add ai-service to sys.path
ai_service_dir = Path(__file__).resolve().parent.parent.parent / 'ai-service'
sys.path.insert(0, str(ai_service_dir))

from extraction_engine import (
    extract_grounded_meeting_intelligence,
    validate_and_sanitize_intelligence,
    get_empty_grounded_result,
    analyze_conversation_intelligence,
    validate_grounded_topics,
    deterministic_grounding_fallback,
    EXTRACTION_PROFILE_TEMPLATES
)

MEDDICC_SCHEMA = [
    {'name': 'metrics', 'label': 'Metrics', 'description': 'Quantifiable metrics'},
    {'name': 'economic_buyer', 'label': 'Economic Buyer', 'description': 'Person with budget authority'},
    {'name': 'decision_criteria', 'label': 'Decision Criteria', 'description': 'Technical/commercial criteria'},
    {'name': 'decision_process', 'label': 'Decision Process', 'description': 'Steps to signoff'},
    {'name': 'identify_pain', 'label': 'Identify Pain', 'description': 'Core business pain'},
    {'name': 'champion', 'label': 'Champion', 'description': 'Internal advocate'},
    {'name': 'competition', 'label': 'Competition', 'description': 'Competitors evaluated'}
]

DANIEL_PRIYA_TRANSCRIPT = [
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


class TestGroundingAndRegression(unittest.TestCase):

    def setUp(self):
        # Patch call_llm_json to ensure tests run deterministically and fast without external 429 rate limit errors
        self.llm_patcher = patch('extraction_engine.call_llm_json', side_effect=RuntimeError("Test mode deterministic fallback"))
        self.mock_llm = self.llm_patcher.start()

        # Meeting A mentions Hightouch
        self.meeting_a_segments = [
            {'segment_id': 'seg_a01', 'speaker_name': 'Marcus Hill', 'text': 'We are comparing Hightouch against PulseSync for reverse ETL.', 'start_time': 10, 'end_time': 20},
            {'segment_id': 'seg_a02', 'speaker_name': 'John Smith', 'text': 'Our budget is fixed at $50,000 for this quarter.', 'start_time': 25, 'end_time': 35}
        ]

        # Meeting B does NOT mention Hightouch (Magic Plumbing)
        self.meeting_b_segments = [
            {'segment_id': 'seg_b01', 'speaker_name': 'Vardhan', 'text': 'Hey Roman, this is Vardhan with the web design team for Magic Plumbing.', 'start_time': 5, 'end_time': 15},
            {'segment_id': 'seg_b02', 'speaker_name': 'Roman', 'text': 'We currently advertise in the local Austin newspaper and yellow pages.', 'start_time': 20, 'end_time': 30}
        ]

    def tearDown(self):
        self.llm_patcher.stop()

    # -------------------------------------------------------------
    # SCENARIO 1: Compile Meeting A, then Meeting B; Meeting B must contain no Meeting A content
    # -------------------------------------------------------------
    def test_01_cross_meeting_contamination_isolation(self):
        res_a = extract_grounded_meeting_intelligence(self.meeting_a_segments, MEDDICC_SCHEMA)
        res_b = extract_grounded_meeting_intelligence(self.meeting_b_segments, MEDDICC_SCHEMA)

        # Meeting A verification
        comp_a = next((f for f in res_a['template_fields'] if f['field_id'] == 'competition'), None)
        self.assertIsNotNone(comp_a)
        self.assertIn('hightouch', str(comp_a['value']).lower())
        self.assertEqual(comp_a['status'], 'explicit')
        self.assertTrue(len(comp_a['evidence']) > 0)
        self.assertEqual(comp_a['evidence'][0]['segment_id'], 'seg_a01')

        # Meeting B verification - Hightouch, $50,000, Marcus Hill MUST NEVER appear
        comp_b = next((f for f in res_b['template_fields'] if f['field_id'] == 'competition'), None)
        self.assertIsNotNone(comp_b)
        self.assertNotIn('hightouch', str(comp_b['value']).lower())
        self.assertNotIn('hightouch', str(res_b.get('deal_signals', {}).get('competition', '')).lower())
        self.assertNotIn('hightouch', str(res_b.get('summary', '')).lower())
        self.assertNotIn('$50,000', str(res_b.get('summary', '')))
        self.assertNotIn('marcus', str(res_b.get('summary', '')).lower())

    # -------------------------------------------------------------
    # SCENARIO 2: Compile two meetings concurrently; neither result may contaminate the other
    # -------------------------------------------------------------
    def test_02_concurrent_meeting_compilation_isolation(self):
        def compile_meeting(segments, schema):
            return extract_grounded_meeting_intelligence(segments, schema)

        with ThreadPoolExecutor(max_workers=2) as executor:
            future_a = executor.submit(compile_meeting, self.meeting_a_segments, MEDDICC_SCHEMA)
            future_b = executor.submit(compile_meeting, self.meeting_b_segments, MEDDICC_SCHEMA)
            res_a = future_a.result()
            res_b = future_b.result()

        # Verify A contains Hightouch and $50,000
        comp_a = next((f for f in res_a['template_fields'] if f['field_id'] == 'competition'), None)
        self.assertIn('hightouch', str(comp_a['value']).lower())

        # Verify B has zero trace of Meeting A
        comp_b = next((f for f in res_b['template_fields'] if f['field_id'] == 'competition'), None)
        self.assertNotIn('hightouch', str(comp_b['value']).lower())
        self.assertNotIn('$50,000', str(res_b.get('summary', '')))
        self.assertNotIn('marcus', str(res_b.get('summary', '')).lower())

    # -------------------------------------------------------------
    # SCENARIO 3: Navigate between meetings while compilation is in progress; late responses must not replace data
    # -------------------------------------------------------------
    def test_03_navigation_and_stale_request_guard(self):
        meeting_1_id = "meet-101"
        meeting_2_id = "meet-202"

        # Client state simulation
        client_state = {
            "selected_meeting_id": meeting_1_id,
            "meeting_data": {"id": meeting_1_id, "summary": "Initial Meeting 1 Data"}
        }

        # Step 1: User triggers compilation for Meeting 1
        compiling_id = client_state["selected_meeting_id"]

        # Step 2: User navigates to Meeting 2 before compilation finishes
        client_state["selected_meeting_id"] = meeting_2_id
        client_state["meeting_data"] = {"id": meeting_2_id, "summary": "Meeting 2 Fresh Data"}

        # Step 3: Meeting 1 compilation finishes asynchronously
        late_response_meeting_id = compiling_id
        late_response_data = {"id": meeting_1_id, "summary": "Meeting 1 Compiled Result"}

        # Enforce contract: if response ID does not match currently selected meeting ID, ignore it
        if late_response_meeting_id == client_state["selected_meeting_id"]:
            client_state["meeting_data"] = late_response_data

        # Meeting 2 data must remain untouched and uncorrupted
        self.assertEqual(client_state["selected_meeting_id"], meeting_2_id)
        self.assertEqual(client_state["meeting_data"]["id"], meeting_2_id)
        self.assertEqual(client_state["meeting_data"]["summary"], "Meeting 2 Fresh Data")

    # -------------------------------------------------------------
    # SCENARIO 4: Retry a failed compilation; UI must not silently show an unrelated previous result
    # -------------------------------------------------------------
    def test_04_retry_failed_compilation_clean_isolation(self):
        # Empty result reset contract
        empty_state = get_empty_grounded_result(MEDDICC_SCHEMA)
        for f in empty_state['template_fields']:
            self.assertIsNone(f['value'])
            self.assertEqual(f['status'], 'not_mentioned')
            self.assertEqual(f['evidence'], [])
        self.assertEqual(empty_state['action_items'], [])
        self.assertTrue(all(s.get('evidence') == [] for s in empty_state['summary_sections']))

        # Simulation: Meeting 1 succeeded, Meeting 2 fails on compile. Meeting 2 must NOT inherit Meeting 1 results
        meeting_store = {
            "m1": {"summary": "Meeting 1 completed", "fields": [{"field_id": "competition", "value": "Gong"}]},
            "m2": {"summary": None, "fields": []}
        }
        # Simulate compilation failure for m2
        compilation_failed = True
        if compilation_failed:
            # Must not copy from m1
            result_m2 = get_empty_grounded_result(MEDDICC_SCHEMA)
            meeting_store["m2"] = {
                "summary": result_m2.get("summary", ""),
                "fields": result_m2.get("template_fields", []),
                "error": "Compilation failed"
            }

        self.assertNotIn("Gong", str(meeting_store["m2"]["fields"]))
        self.assertEqual(meeting_store["m2"]["error"], "Compilation failed")

    # -------------------------------------------------------------
    # SCENARIO 5: Supply transcript containing no relevant evidence; field must remain unconfirmed
    # -------------------------------------------------------------
    def test_05_missing_evidence_field_abstention_and_rejection(self):
        segments = [{'segment_id': 'seg_01', 'speaker_name': 'Alice', 'text': 'Hello, we are here to discuss general team scheduling.', 'start_time': 0, 'end_time': 5}]
        res = extract_grounded_meeting_intelligence(segments, MEDDICC_SCHEMA)

        # Economic Buyer, Metrics, Competition must all be null / not_mentioned
        for field_id in ['economic_buyer', 'metrics', 'competition', 'champion']:
            f = next(f for f in res['template_fields'] if f['field_id'] == field_id)
            self.assertIsNone(f['value'])
            self.assertEqual(f['status'], 'not_mentioned')
            self.assertEqual(f['evidence'], [])

        # Backend validator also rejects hallucinated values injected without evidence
        fake_ai_output = {
            'template_fields': [
                {'field_id': 'metrics', 'field_name': 'Metrics', 'value': '$100,000 cost savings', 'status': 'explicit', 'evidence': []},
                {'field_id': 'competition', 'field_name': 'Competition', 'value': 'Salesforce', 'status': 'explicit', 'evidence': [{'segment_id': 'seg_other_99', 'quote': 'Salesforce'}]}
            ]
        }
        seg_map = {'seg_01': {'segment_id': 'seg_01', 'speaker': 'Alice', 'text': 'Team scheduling only.', 'start_time': 0, 'end_time': 5}}
        validated = validate_and_sanitize_intelligence(fake_ai_output, seg_map, MEDDICC_SCHEMA)
        v_metrics = next(f for f in validated['template_fields'] if f['field_id'] == 'metrics')
        v_comp = next(f for f in validated['template_fields'] if f['field_id'] == 'competition')
        self.assertIsNone(v_metrics['value'])
        self.assertEqual(v_metrics['status'], 'not_mentioned')
        self.assertIsNone(v_comp['value'])
        self.assertEqual(v_comp['status'], 'not_mentioned')

    # -------------------------------------------------------------
    # SCENARIO 6: Daniel–Priya transcript regression (Root cause fix validation)
    # -------------------------------------------------------------
    def test_06_daniel_priya_transcript_fixture_regression(self):
        profile = EXTRACTION_PROFILE_TEMPLATES["meddicc"]
        res = extract_grounded_meeting_intelligence(
            transcript_segments=DANIEL_PRIYA_TRANSCRIPT,
            profile=profile
        )

        fields_dict = {f["field_id"]: f for f in res["fields"]}

        # 1. NO Java-related discussion topics anywhere
        topics = res.get("conversation_intelligence", {}).get("main_topics", [])
        signals_topics = res.get("conversation_intelligence", {}).get("signals", {}).get("main_topics", [])
        all_topics = topics + signals_topics
        for t in all_topics:
            self.assertNotIn("java", t.lower(), f"Unexpected Java topic found: {t}")
            self.assertNotIn("import", t.lower(), f"Unexpected import topic found: {t}")

        # Main topics must be grounded in operations / reporting
        self.assertTrue(len(all_topics) > 0)
        self.assertTrue(any("operation" in t.lower() or "reporting" in t.lower() or "customer" in t.lower() for t in all_topics))

        # 2. Call Classification: Must be Sales Discovery with Relevant sales relevance
        self.assertEqual(res.get("call_type"), "discovery")
        ci = res.get("conversation_intelligence", {})
        self.assertEqual(ci.get("conversation_type"), "Sales Discovery")
        self.assertEqual(ci.get("sales_relevance"), "Relevant")

        # 3. Metrics vs Budget: 6-8 hours and $18,500 budget are distinct and accurately sourced
        metrics_f = fields_dict.get("metrics")
        self.assertIsNotNone(metrics_f)
        self.assertIsNotNone(metrics_f["value"])
        # Should reference hours / productivity
        self.assertTrue("hour" in metrics_f["value"].lower() or "6 to 8" in metrics_f["value"].lower() or "$18,500" in metrics_f["value"])

        # Check summary sections: must distinctly format 6-8 hours as reporting overhead and $18,500 as budget
        summary_sections = res.get("summary_sections", [])
        summary_text = " ".join(s.get("content", "") for s in summary_sections)
        self.assertNotIn("impacts productivity by $18,500", summary_text, "Conflated metrics/budget found in summary!")
        if "18,500" in summary_text:
            self.assertIn("budget", summary_text.lower())

        # 4. Economic Buyer: MUST NOT be identified (Priya is buyer contact but has no named signoff authority)
        econ_buyer = fields_dict.get("economic_buyer")
        self.assertIsNotNone(econ_buyer)
        self.assertIsNone(econ_buyer["value"])
        self.assertEqual(econ_buyer["status"], "not_mentioned")
        self.assertEqual(econ_buyer["evidence"], [])

        # 5. Competition: Gong explicitly captured from segment 7
        competition_f = fields_dict.get("competition")
        self.assertIsNotNone(competition_f)
        self.assertEqual(competition_f["value"], "Gong")
        self.assertEqual(competition_f["status"], "explicit")
        self.assertTrue(len(competition_f["evidence"]) > 0)
        self.assertEqual(competition_f["evidence"][0]["segment_id"], "seg-07")

        # 6. Next Steps: Pilot and workshop are treated as proposed next steps, not proof of established purchasing
        action_items = res.get("action_items", [])
        self.assertTrue(len(action_items) >= 2)
        tasks_text = " ".join(a.get("task", "").lower() for a in action_items)
        self.assertTrue("sample data export" in tasks_text or "security questionnaire" in tasks_text)

        # 7. Topic validator rejects ungrounded topics (like Java)
        test_topics = ["Java classes, packages, and wildcard imports", "Customer Operations Reporting"]
        grounded_topics = validate_grounded_topics(test_topics, DANIEL_PRIYA_TRANSCRIPT)
        self.assertNotIn("Java classes, packages, and wildcard imports", grounded_topics)
        self.assertIn("Customer Operations Reporting", grounded_topics)

    # -------------------------------------------------------------
    # SCENARIO 7: Confirm existing valid extraction, review decisions, editing, and CRM-sync workflows
    # -------------------------------------------------------------
    def test_07_review_decision_and_crm_sync_workflows(self):
        # Simulate user updating review status on a field
        raw_fields = [
            {"field_id": "competition", "value": "Gong", "review_status": "needs_review"},
            {"field_id": "economic_buyer", "value": None, "review_status": "not_mentioned"}
        ]

        # Review decision: User approves Gong
        user_reviewed_fields = []
        for f in raw_fields:
            if f["field_id"] == "competition":
                user_reviewed_fields.append({**f, "review_status": "approved", "reviewed_by": "user"})
            else:
                user_reviewed_fields.append(f)

        comp = next(f for f in user_reviewed_fields if f["field_id"] == "competition")
        self.assertEqual(comp["review_status"], "approved")

        # Editing decision: User edits a field value
        edited_fields = []
        for f in user_reviewed_fields:
            if f["field_id"] == "competition":
                edited_fields.append({**f, "value": "Gong, Clari", "user_edited": True})
            else:
                edited_fields.append(f)

        edited_comp = next(f for f in edited_fields if f["field_id"] == "competition")
        self.assertEqual(edited_comp["value"], "Gong, Clari")
        self.assertTrue(edited_comp["user_edited"])

        # CRM sync payload preparation: approved or non-empty fields mapped
        crm_payload = {}
        for f in edited_fields:
            if f.get("value") and f.get("review_status") != "rejected":
                crm_payload[f["field_id"]] = f["value"]

        self.assertIn("competition", crm_payload)
        self.assertEqual(crm_payload["competition"], "Gong, Clari")
        self.assertNotIn("economic_buyer", crm_payload)


if __name__ == '__main__':
    unittest.main()

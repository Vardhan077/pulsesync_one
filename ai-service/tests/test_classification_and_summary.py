import os
import sys
import unittest
from pathlib import Path

# Add ai-service to sys.path
ai_service_dir = Path(__file__).resolve().parent.parent / 'ai-service'
sys.path.insert(0, str(ai_service_dir))

from extraction_engine import (
    analyze_conversation_intelligence,
    extract_grounded_meeting_intelligence,
    validate_and_sanitize_intelligence,
    EXTRACTION_PROFILE_TEMPLATES
)

COLD_PROSPECTING_TRANSCRIPT = [
    {"segment_id": "seg-01", "speaker_name": "Alex_SDR", "text": "Hi Sarah, this is Alex calling from PulseSync. I know this is an unexpected call, so I will be brief. We help revenue teams reduce the time reps spend writing call notes and updating CRM fields."},
    {"segment_id": "seg-02", "speaker_name": "Sarah_VP_Sales", "text": "I have about two minutes. We already use Salesforce, and I am not looking to replace our CRM. What exactly are you offering?"},
    {"segment_id": "seg-03", "speaker_name": "Alex_SDR", "text": "We do not replace Salesforce. We turn conversations into structured notes and proposed field updates, so reps spend less time typing. I noticed your sales organization has been hiring across several regions."},
    {"segment_id": "seg-04", "speaker_name": "Sarah_VP_Sales", "text": "Hiring is true, but our main issue is getting people to update opportunities consistently. Managers chase them every Friday."},
    {"segment_id": "seg-05", "speaker_name": "Alex_SDR", "text": "That sounds frustrating. Is the bigger problem that reps forget to update fields, or that the fields are unclear and take too long to complete?"},
    {"segment_id": "seg-06", "speaker_name": "Sarah_VP_Sales", "text": "Mostly time and consistency. Some fields are custom, and people do not always know what belongs in them."},
    {"segment_id": "seg-07", "speaker_name": "Alex_SDR", "text": "Understood. I do not want to assume there is a fit from one short call. Would a fifteen-minute conversation with your sales operations lead be useful to see whether the workflow fits your process?"},
    {"segment_id": "seg-08", "speaker_name": "Sarah_VP_Sales", "text": "Possibly. Mark Vance owns sales operations. Email him a concise overview and copy me. Do not put time on my calendar yet."},
    {"segment_id": "seg-09", "speaker_name": "Alex_SDR", "text": "Absolutely. I will send a short note and ask Mark whether a brief introduction makes sense. Thanks for being direct with me."},
    {"segment_id": "seg-10", "speaker_name": "Sarah_VP_Sales", "text": "Thanks. I need to join another meeting now. Goodbye."}
]

DISCOVERY_TRANSCRIPT = [
    {"segment_id": "seg-01", "speaker_name": "Daniel", "text": "Hi Priya, thanks for joining. I would love to explore your current customer reporting workflows."},
    {"segment_id": "seg-02", "speaker_name": "Priya", "text": "The biggest problem is that customer notes are scattered across multiple tools, and our team spends 6-8 hours every Friday manually consolidating them."},
    {"segment_id": "seg-03", "speaker_name": "Daniel", "text": "What are your primary evaluation criteria for resolving this?"},
    {"segment_id": "seg-04", "speaker_name": "Priya", "text": "We want automated issue identification that directly reduces manual reporting work across all customer conversations. We are also evaluating Gong."}
]

QUALIFICATION_TRANSCRIPT = [
    {"segment_id": "seg-01", "speaker_name": "Rep", "text": "Let us review the commercial parameters and budget signoff process for this deployment."},
    {"segment_id": "seg-02", "speaker_name": "Buyer", "text": "We have allocated a first-year budget of $120,000. Our CFO, Marcus Vance, is the economic buyer with signing authority."},
    {"segment_id": "seg-03", "speaker_name": "Rep", "text": "What is your target timeline for final procurement signoff?"},
    {"segment_id": "seg-04", "speaker_name": "Buyer", "text": "We want this in place before October 15th."}
]

TECH_EVAL_TRANSCRIPT = [
    {"segment_id": "seg-01", "speaker_name": "Architect", "text": "We need to conduct an architecture review and evaluate your API endpoint latency and security architecture."},
    {"segment_id": "seg-02", "speaker_name": "Engineer", "text": "Our platform supports OAuth 2.0 and mutual TLS for all connectors. Let us schedule integration testing next week."}
]

SUPPORT_TRANSCRIPT = [
    {"segment_id": "seg-01", "speaker_name": "Customer", "text": "We are getting an error code 500 and a stack trace when exporting user logs on ticket 4021."},
    {"segment_id": "seg-02", "speaker_name": "Support_Agent", "text": "Let me investigate the incident logs and troubleshoot the database timeout issue on your account."}
]

INTERNAL_STANDUP_TRANSCRIPT = [
    {"segment_id": "seg-01", "speaker_name": "Scrum_Master", "text": "Welcome to our daily sync and sprint planning standup. Let us review the sprint progress and operational backlog."},
    {"segment_id": "seg-02", "speaker_name": "Developer", "text": "Yesterday I finished the Kafka connector PR. Today I am unblocking the CI pipeline."}
]

EDUCATIONAL_TRANSCRIPT = [
    {"segment_id": "seg-01", "speaker_name": "Instructor", "text": "In this tutorial we will look at Java class hierarchies and package folder structures. When you say star it should import all classes in the library."},
    {"segment_id": "seg-02", "speaker_name": "Student", "text": "Does java.lang require an explicit import or is it automatically included by the compiler?"}
]

GENERAL_DISCUSSION_TRANSCRIPT = [
    {"segment_id": "seg-01", "speaker_name": "Alice", "text": "The weather has been quite warm this week. Are you planning any travels for the upcoming holidays?"},
    {"segment_id": "seg-02", "speaker_name": "Bob", "text": "Just visiting family upstate. Hopefully traffic will not be too congested on Friday afternoon."}
]

FRAGMENTED_TRANSCRIPT = [
    {"segment_id": "seg-01", "speaker_name": "Speaker 1", "text": "Hello?"},
    {"segment_id": "seg-02", "speaker_name": "Unknown Speaker", "text": "Yes."},
    {"segment_id": "seg-03", "speaker_name": "Speaker 1", "text": "Can you hear me?"},
    {"segment_id": "seg-04", "speaker_name": "Speaker 2", "text": "Okay."}
]

EMPTY_TRANSCRIPT = [
    {"segment_id": "seg-01", "speaker_name": "Speaker 1", "text": "Hi."}
]


class TestClassificationAndSummary(unittest.TestCase):

    def test_01_cold_prospecting_classification_and_relevance(self):
        """Verify cold prospecting call is classified as Cold Prospecting with Relevant sales relevance."""
        ci = analyze_conversation_intelligence(COLD_PROSPECTING_TRANSCRIPT, EXTRACTION_PROFILE_TEMPLATES['sales_discovery'])
        
        self.assertEqual(ci["conversation_type"], "Cold Prospecting")
        self.assertEqual(ci["sales_relevance"], "Relevant")
        self.assertGreaterEqual(ci["conversation_type_confidence"], 0.80)
        self.assertIn("prospecting", ci["sales_relevance_explanation"].lower())
        self.assertIn("outreach", ci["conversation_type_rationale"].lower())

    def test_01_cold_prospecting_summary_structure_and_attribution(self):
        """Verify generic summary has 5 structured sections without repeating opening pitch verbatim."""
        ci = analyze_conversation_intelligence(COLD_PROSPECTING_TRANSCRIPT, EXTRACTION_PROFILE_TEMPLATES['sales_discovery'])
        gen_sum = ci["generic_summary"]

        # Must not start with "The conversation covers: "
        self.assertFalse(gen_sum.startswith("The conversation covers: "))
        self.assertFalse("Hi Sarah, this is Alex calling from PulseSync" in gen_sum)

        # Must contain all 5 structured sections
        self.assertIn("**Conversation purpose:**", gen_sum)
        self.assertIn("**Customer situation:**", gen_sum)
        self.assertIn("**Discussion and response:**", gen_sum)
        self.assertIn("**Qualification status:**", gen_sum)
        self.assertIn("**Agreed next steps:**", gen_sum)

        # Check accurate participant and company attribution
        self.assertIn("Alex", gen_sum)
        self.assertIn("PulseSync", gen_sum)
        self.assertIn("Sarah", gen_sum)
        self.assertIn("Mark Vance", gen_sum)
        self.assertIn("Sales Operations", gen_sum)

        # Must not fabricate ungrounded hiring claims
        self.assertNotIn("hiring", gen_sum.lower())

    def test_sales_discovery_classification(self):
        """Verify discovery call with customer needs is classified as Sales Discovery and Relevant."""
        ci = analyze_conversation_intelligence(DISCOVERY_TRANSCRIPT, EXTRACTION_PROFILE_TEMPLATES['sales_discovery'])
        self.assertEqual(ci["conversation_type"], "Sales Discovery")
        self.assertEqual(ci["sales_relevance"], "Relevant")
        self.assertIn("**Conversation purpose:**", ci["generic_summary"])
        self.assertIn("**Customer situation:**", ci["generic_summary"])

    def test_qualification_classification(self):
        """Verify qualification call with budget and economic buyer is classified accurately and is Relevant."""
        ci = analyze_conversation_intelligence(QUALIFICATION_TRANSCRIPT, EXTRACTION_PROFILE_TEMPLATES['sales_discovery'])
        self.assertIn(ci["conversation_type"], ["Sales Qualification", "Sales Discovery"])
        self.assertEqual(ci["sales_relevance"], "Relevant")

    def test_technical_evaluation_classification(self):
        """Verify technical evaluation is classified as Technical Discussion with Partially Relevant relevance."""
        ci = analyze_conversation_intelligence(TECH_EVAL_TRANSCRIPT, EXTRACTION_PROFILE_TEMPLATES['sales_discovery'])
        self.assertEqual(ci["conversation_type"], "Technical Discussion")
        self.assertEqual(ci["sales_relevance"], "Partially Relevant")

    def test_customer_support_classification(self):
        """Verify customer support ticket discussion is Low Sales Relevance."""
        ci = analyze_conversation_intelligence(SUPPORT_TRANSCRIPT, EXTRACTION_PROFILE_TEMPLATES['sales_discovery'])
        self.assertEqual(ci["conversation_type"], "Customer Support")
        self.assertEqual(ci["sales_relevance"], "Low Sales Relevance")

    def test_internal_standup_classification(self):
        """Verify internal sprint planning is Low Sales Relevance."""
        ci = analyze_conversation_intelligence(INTERNAL_STANDUP_TRANSCRIPT, EXTRACTION_PROFILE_TEMPLATES['sales_discovery'])
        self.assertEqual(ci["conversation_type"], "Internal Meeting")
        self.assertEqual(ci["sales_relevance"], "Low Sales Relevance")

    def test_educational_classification(self):
        """Verify programming tutorial is Low Sales Relevance."""
        ci = analyze_conversation_intelligence(EDUCATIONAL_TRANSCRIPT, EXTRACTION_PROFILE_TEMPLATES['sales_discovery'])
        self.assertEqual(ci["conversation_type"], "Educational / Technical Discussion")
        self.assertEqual(ci["sales_relevance"], "Low Sales Relevance")

    def test_general_discussion_classification(self):
        """Verify non-commercial chatter is classified as General Discussion with Low Sales Relevance."""
        ci = analyze_conversation_intelligence(GENERAL_DISCUSSION_TRANSCRIPT, EXTRACTION_PROFILE_TEMPLATES['sales_discovery'])
        self.assertEqual(ci["conversation_type"], "General Discussion")
        self.assertEqual(ci["sales_relevance"], "Low Sales Relevance")

    def test_fragmented_and_insufficient_transcripts(self):
        """Verify brief or empty transcripts indicate uncertainty or quality warning."""
        ci_empty = analyze_conversation_intelligence(EMPTY_TRANSCRIPT, EXTRACTION_PROFILE_TEMPLATES['sales_discovery'])
        self.assertEqual(ci_empty["conversation_type"], "Unclear or Insufficient Transcript")
        self.assertEqual(ci_empty["sales_relevance"], "Unable to Determine")

        ci_frag = analyze_conversation_intelligence(FRAGMENTED_TRANSCRIPT, EXTRACTION_PROFILE_TEMPLATES['sales_discovery'])
        self.assertIsNotNone(ci_frag.get("transcript_quality_warning"))

    def test_grounded_extraction_with_configured_sales_discovery_playbook(self):
        """Verify Sales Discovery playbook extraction keeps unmentioned fields null without forcing values."""
        res = extract_grounded_meeting_intelligence(
            transcript_segments=COLD_PROSPECTING_TRANSCRIPT,
            profile=EXTRACTION_PROFILE_TEMPLATES['sales_discovery']
        )
        self.assertEqual(res["call_type"], "cold_prospecting")
        ci = res["conversation_intelligence"]
        self.assertEqual(ci["conversation_type"], "Cold Prospecting")
        self.assertEqual(ci["sales_relevance"], "Relevant")

        # Configured fields must remain not_mentioned
        for field in res.get("fields", []):
            self.assertIn(field["field_id"], ["budget", "economic_buyer", "champion", "timeline", "competition"])
            self.assertEqual(field["status"], "not_mentioned")
            self.assertIsNone(field["value"])

        # Concrete action item must be grounded
        actions = res.get("action_items", [])
        self.assertGreaterEqual(len(actions), 1)
        self.assertIn("mark", actions[0]["task"].lower())
        self.assertEqual(actions[0]["owner"], "Alex")

        # Summary must not leak benchmark-specific phrases like 'evaluation pilot' or 'operations workshop'
        sum_text = str(res.get("summary") or "")
        self.assertNotIn("evaluation pilot", sum_text.lower())
        self.assertNotIn("operations workshop", sum_text.lower())
        self.assertNotIn("hiring is true", sum_text.lower())

        # Verify summary sections are distinct, grounded, and free of conversational concessions
        sec_map = {s["section_id"]: s["content"] for s in res.get("summary_sections", [])}
        for sec_id, content in sec_map.items():
            self.assertNotIn("hiring is true", content.lower(), f"Section {sec_id} should not contain conversational concession 'hiring is true'")

        if "customer_needs" in sec_map and "pain_points" in sec_map:
            # Customer Needs and Pain Points must not be duplicate strings
            self.assertNotEqual(sec_map["customer_needs"], sec_map["pain_points"])
            self.assertTrue(any(term in sec_map["customer_needs"].lower() for term in ["crm", "salesforce", "custom fields", "consistency", "opportunity"]))
            self.assertIn("opportunities", sec_map["pain_points"].lower())

        # Concrete action item must be grounded to seller Alex, not buyer Sarah
        actions = res.get("action_items", [])
        self.assertGreaterEqual(len(actions), 1)
        self.assertEqual(actions[0]["owner"], "Alex")
        self.assertEqual(actions[0]["commitment_type"], "rep_commitment")
        self.assertTrue(all(a.get("owner") != "Sarah" for a in actions), "Buyer Sarah should not be assigned rep action items")


if __name__ == '__main__':
    unittest.main()

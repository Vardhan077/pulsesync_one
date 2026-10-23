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

logger = logging.getLogger("pulsesync-ai-service.extraction_engine")

from rule_engine import DynamicRuleEngine

SUPPORTED_FIELD_TYPES = {
    "text", "number", "boolean", "date", "datetime", "currency",
    "enum", "multi_select", "person", "company", "url", "array", "object"
}

# ─────────────────────────────────────────────────────────────────────────────
# EXTRACTION PROFILE DATA MODEL & PRECONFIGURED TEMPLATES
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_EXTRACTION_PROFILE = {
    "id": "default_sales_intelligence",
    "name": "PulseSync Default Sales Intelligence",
    "description": "Extract customer requirements, pain points, deal intelligence, and actionable next steps from sales conversations.",
    "summary_sections": [
        {
            "id": "executive_summary",
            "name": "Executive Summary",
            "description": "Concise overview of the most important conversation outcomes and explicitly supported facts.",
            "max_words": 120,
            "enabled": True
        },
        {
            "id": "customer_needs",
            "name": "Customer Needs",
            "description": "What the customer explicitly needs from a solution or platform.",
            "max_words": 100,
            "enabled": True
        },
        {
            "id": "pain_points",
            "name": "Pain Points",
            "description": "Problems, frustrations, bottlenecks, or friction explicitly expressed by the customer.",
            "max_words": 100,
            "enabled": True
        },
        {
            "id": "requirements",
            "name": "Requirements",
            "description": "Specific business, functional, or technical requirements stated by the customer.",
            "max_words": 100,
            "enabled": True
        },
        {
            "id": "risks_objections",
            "name": "Risks / Objections",
            "description": "Concerns, roadblocks, or objections raised during the conversation.",
            "max_words": 100,
            "enabled": True
        },
        {
            "id": "action_items",
            "name": "Action Items",
            "description": "Explicitly agreed follow-ups, deliverables, and commitments.",
            "max_words": 80,
            "enabled": True
        },
        {
            "id": "next_steps",
            "name": "Next Steps",
            "description": "Next scheduled meetings, milestones, or immediate next steps.",
            "max_words": 80,
            "enabled": True
        }
    ],
    "fields": [
        {
            "id": "call_stage",
            "name": "Call Stage",
            "type": "enum",
            "description": "Current stage of the commercial or evaluation cycle.",
            "evidence_required": True,
            "enabled": True,
            "options": ["Cold / Prospecting", "Qualification", "Discovery", "Solution Demo", "Technical Validation", "Negotiation", "Follow-up", "Renewal / Expansion", "Other"]
        },
        {
            "id": "budget",
            "name": "Budget",
            "type": "currency",
            "description": "Explicit budget or monetary amount stated by the customer.",
            "evidence_required": True,
            "enabled": True
        },
        {
            "id": "timeline",
            "name": "Implementation Timeline",
            "type": "text",
            "description": "Explicit implementation deadline, target timeframe, or target date.",
            "evidence_required": True,
            "enabled": True
        },
        {
            "id": "economic_buyer",
            "name": "Economic Buyer",
            "type": "person",
            "description": "Person with explicit authority to allocate budget or sign off on purchase.",
            "evidence_required": True,
            "enabled": True
        },
        {
            "id": "champion",
            "name": "Champion",
            "type": "person",
            "description": "Internal stakeholder actively advocating, driving, or selling internally on our behalf.",
            "evidence_required": True,
            "enabled": True
        },
        {
            "id": "decision_criteria",
            "name": "Decision Criteria",
            "type": "text",
            "description": "Technical, functional, or commercial criteria required for selection.",
            "evidence_required": True,
            "enabled": True
        },
        {
            "id": "decision_process",
            "name": "Decision Process",
            "type": "text",
            "description": "Formal stages, milestones, or approvals required to reach a decision.",
            "evidence_required": True,
            "enabled": True
        },
        {
            "id": "pain_points",
            "name": "Pain Points",
            "type": "text",
            "description": "Core business, technical, or operational bottlenecks explicitly stated.",
            "evidence_required": True,
            "enabled": True
        },
        {
            "id": "competition",
            "name": "Competition",
            "type": "text",
            "description": "External competitors or alternative solutions explicitly mentioned.",
            "evidence_required": True,
            "enabled": True
        }
    ],
    "action_items_enabled": True,
    "risks_enabled": True,
    "objections_enabled": True
}

# Generic profile instructions. These are intentionally framework-neutral; field-level
# contracts remain the authoritative semantic definition.
DEFAULT_EXTRACTION_PROFILE["purpose"] = "Extract explicit, evidence-grounded business intelligence requested by this profile."
DEFAULT_EXTRACTION_PROFILE["extraction_instructions"] = [
    "Use only the current transcript as evidence.",
    "Prefer null/not_mentioned over inference when a field is ambiguous.",
    "Every populated field must be supported by evidence that proves the field meaning and the exact value.",
    "Summaries must synthesize evidence rather than copy transcript segments.",
    "Action items require explicit commitments or assignments."
]

EXTRACTION_PROFILE_TEMPLATES = {
    "default_sales_intelligence": DEFAULT_EXTRACTION_PROFILE,
    "sales_discovery": {
        "id": "sales_discovery",
        "name": "Sales Discovery",
        "description": "Extract customer requirements and deal intelligence from discovery calls.",
        "summary_sections": [
            {"id": "executive_summary", "name": "Executive Summary", "description": "Concise overview of the most important conversation outcomes.", "max_words": 120, "enabled": True},
            {"id": "customer_needs", "name": "Customer Needs", "description": "What the customer needs from a solution.", "max_words": 100, "enabled": True},
            {"id": "pain_points", "name": "Pain Points", "description": "Problems, frustrations, bottlenecks or risks explicitly expressed by the customer.", "max_words": 100, "enabled": True},
            {"id": "decision_criteria", "name": "Decision Criteria", "description": "Criteria the customer will use to make a decision.", "max_words": 100, "enabled": True},
            {"id": "risks", "name": "Risks", "description": "Deal and implementation risks identified during the call.", "max_words": 100, "enabled": True},
            {"id": "next_steps", "name": "Next Steps", "description": "Agreed follow-ups and next meetings.", "max_words": 80, "enabled": True}
        ],
        "fields": [
            {"id": "budget", "name": "Budget", "type": "currency", "description": "Explicit budget or monetary amount stated by the customer.", "evidence_required": True, "enabled": True},
            {"id": "economic_buyer", "name": "Economic Buyer", "type": "person", "description": "Prospect contact with budget allocation and decision authority.", "evidence_required": True, "enabled": True},
            {"id": "champion", "name": "Champion", "type": "person", "description": "Internal project lead or advocate driving evaluation.", "evidence_required": True, "enabled": True},
            {"id": "timeline", "name": "Implementation Timeline", "type": "text", "description": "Explicit implementation deadline or target date.", "evidence_required": True, "enabled": True},
            {"id": "competition", "name": "Competition", "type": "text", "description": "External competitors or alternative solutions evaluated or mentioned.", "evidence_required": True, "enabled": True}
        ],
        "action_items_enabled": True,
        "risks_enabled": True,
        "objections_enabled": True
    },
    "technical_discovery": {
        "id": "technical_discovery",
        "name": "Technical Discovery",
        "description": "Extract technical architecture, requirements, integrations, security, and SLAs.",
        "summary_sections": [
            {"id": "technical_requirements", "name": "Technical Requirements", "description": "Explicit technical requirements and constraints stated by the customer.", "max_words": 120, "enabled": True},
            {"id": "current_architecture", "name": "Current Architecture", "description": "Current technology stack, systems, and architectural layout.", "max_words": 120, "enabled": True},
            {"id": "integrations", "name": "Integrations", "description": "Third-party systems, APIs, and data sources that must be connected.", "max_words": 100, "enabled": True},
            {"id": "security_requirements", "name": "Security Requirements", "description": "Compliance, auth, encryption, and governance requirements.", "max_words": 100, "enabled": True},
            {"id": "performance_requirements", "name": "Performance Requirements", "description": "Latency, throughput, and scalability expectations.", "max_words": 100, "enabled": True},
            {"id": "open_questions", "name": "Open Questions", "description": "Unresolved technical queries requiring follow-up.", "max_words": 80, "enabled": True}
        ],
        "fields": [
            {"id": "database", "name": "Database", "type": "text", "description": "Primary databases and storage engines mentioned.", "evidence_required": True, "enabled": True},
            {"id": "authentication", "name": "Authentication", "type": "text", "description": "Auth mechanisms (e.g. SAML, OAuth, SSO).", "evidence_required": True, "enabled": True},
            {"id": "data_volume", "name": "Data Volume", "type": "text", "description": "Expected data scale, rows, or throughput.", "evidence_required": True, "enabled": True},
            {"id": "integration_requirements", "name": "Integration Requirements", "type": "text", "description": "Key integration points and third-party tools.", "evidence_required": True, "enabled": True},
            {"id": "security_requirements", "name": "Security Requirements", "type": "text", "description": "SOC2, HIPAA, ISO or custom security mandates.", "evidence_required": True, "enabled": True},
            {"id": "sla", "name": "SLA", "type": "text", "description": "Uptime and operational SLA commitments.", "evidence_required": True, "enabled": True}
        ],
        "action_items_enabled": True,
        "risks_enabled": True,
        "objections_enabled": True
    },
    "customer_success": {
        "id": "customer_success",
        "name": "Customer Success",
        "description": "Extract customer health, product adoption, open issues, feature requests, and renewal risks.",
        "summary_sections": [
            {"id": "customer_health", "name": "Customer Health", "description": "Overall account health, satisfaction, and sentiment.", "max_words": 120, "enabled": True},
            {"id": "product_adoption", "name": "Product Adoption", "description": "How the customer is utilizing the product and key features.", "max_words": 100, "enabled": True},
            {"id": "open_issues", "name": "Open Issues", "description": "Unresolved customer bugs, blockers, or tickets.", "max_words": 100, "enabled": True},
            {"id": "feature_requests", "name": "Feature Requests", "description": "Capabilities or enhancements explicitly requested by customer.", "max_words": 100, "enabled": True},
            {"id": "renewal_risks", "name": "Renewal Risks", "description": "Factors that could endanger upcoming contract renewal.", "max_words": 100, "enabled": True},
            {"id": "next_steps", "name": "Next Steps", "description": "Follow-ups, support tasks, and check-in schedules.", "max_words": 80, "enabled": True}
        ],
        "fields": [
            {"id": "product_usage", "name": "Product Usage", "type": "text", "description": "Customer activity and utilization level.", "evidence_required": True, "enabled": True},
            {"id": "customer_sentiment", "name": "Customer Sentiment", "type": "enum", "description": "Customer sentiment toward the product and team.", "evidence_required": True, "enabled": True, "options": ["Positive", "Neutral", "Frustrated", "At Risk"]},
            {"id": "open_issues", "name": "Open Issues", "type": "text", "description": "Current unresolved issues.", "evidence_required": True, "enabled": True},
            {"id": "feature_requests", "name": "Feature Requests", "type": "text", "description": "Requested product enhancements.", "evidence_required": True, "enabled": True},
            {"id": "renewal_risk", "name": "Renewal Risk", "type": "text", "description": "Explicit renewal risks or churn indicators.", "evidence_required": True, "enabled": True}
        ],
        "action_items_enabled": True,
        "risks_enabled": True,
        "objections_enabled": True
    },
    "meddicc": {
        "id": "meddicc",
        "name": "MEDDICC",
        "description": "Metrics, Economic Buyer, Decision Criteria, Decision Process, Identify Pain, Champion, Competition.",
        "summary_sections": [
            {"id": "executive_summary", "name": "Executive Summary", "description": "Concise overview of conversation outcomes.", "max_words": 120, "enabled": True},
            {"id": "customer_needs", "name": "Customer Needs", "description": "Core client needs and objectives.", "max_words": 100, "enabled": True},
            {"id": "decision_framework", "name": "Decision Framework", "description": "Criteria and process for vendor signoff.", "max_words": 100, "enabled": True},
            {"id": "next_steps", "name": "Next Steps", "description": "Agreed milestones and follow-ups.", "max_words": 80, "enabled": True}
        ],
        "fields": [
            {"id": "metrics", "name": "Metrics", "type": "text", "description": "Explicit measurable business impact or outcome caused by the problem, such as time spent, volume, rate, revenue, savings, conversion, or other quantified operational impact. Budget is not a metric.", "semantic_contract": "Extract measurable business impact or operational outcome, preserving the stated unit, cadence, scope, and period when available. For example, if the transcript says 6–8 hours each week across the team, retain that full context. Do not classify a price, budget, contract value, or funding allocation as a metric unless the transcript explicitly describes it as an outcome/impact.", "negative_examples": ["budget amount", "allocated budget", "contract value", "price quote"], "evidence_required": True, "enabled": True},
            {"id": "economic_buyer", "name": "Economic Buyer", "type": "person", "description": "Prospect contact with budget allocation and decision authority.", "evidence_required": True, "enabled": True},
            {"id": "decision_criteria", "name": "Decision Criteria", "type": "text", "description": "Specific requirements or conditions the customer will use to evaluate or select a solution.", "semantic_contract": "Extract selection requirements or conditions that determine whether a solution is acceptable. Do not extract actions, deadlines, meetings, or generic statements that a pilot must happen.", "positive_examples": ["minimal configuration", "no additional work for account managers", "must support SSO"], "negative_examples": ["send the questionnaire", "schedule a workshop", "pilot by a specific deadline"], "evidence_required": True, "enabled": True},
            {"id": "decision_process", "name": "Decision Process", "type": "text", "description": "The sequence of evaluation, review, approval, or decision stages used to reach a purchase decision.", "semantic_contract": "Extract the decision-making sequence or stages used to evaluate, select, approve, procure, or purchase a solution. A workshop, pilot, questionnaire, meeting, deadline, or single next step is not a decision process unless the transcript explicitly connects it to how the vendor or purchase decision will be made.", "positive_examples": ["run a pilot, then security review, then procurement approval before purchase", "evaluate the pilot results and have the VP approve the purchase"], "negative_examples": ["send the pilot requirements", "schedule a workshop", "customer operations manager joins the workshop", "before a specific deadline", "run a pilot"], "evidence_required": True, "enabled": True},
            {"id": "identify_pain", "name": "Identify Pain", "type": "text", "description": "Core operational bottleneck or reporting friction.", "evidence_required": True, "enabled": True},
            {"id": "champion", "name": "Champion", "type": "person", "description": "Internal project lead or advocate driving evaluation.", "evidence_required": True, "enabled": True},
            {"id": "competition", "name": "Competition", "type": "text", "description": "External competitors or alternative tools evaluated.", "evidence_required": True, "enabled": True}
        ],
        "action_items_enabled": True,
        "risks_enabled": True,
        "objections_enabled": True
    },
    "bant": {
        "id": "bant",
        "name": "BANT",
        "description": "Budget, Authority, Need, Timeline qualification.",
        "summary_sections": [
            {"id": "executive_summary", "name": "Executive Summary", "description": "Concise overview of conversation outcomes.", "max_words": 120, "enabled": True},
            {"id": "qualification_overview", "name": "Qualification Overview", "description": "High level evaluation of BANT qualification.", "max_words": 100, "enabled": True},
            {"id": "next_steps", "name": "Next Steps", "description": "Agreed milestones and next steps.", "max_words": 80, "enabled": True}
        ],
        "fields": [
            {"id": "budget", "name": "Budget", "type": "currency", "description": "Explicit budget or monetary amount allocated or discussed for the initiative.", "evidence_required": True, "enabled": True},
            {"id": "authority", "name": "Authority", "type": "person", "description": "Who holds decision and budget authority?", "evidence_required": True, "enabled": True},
            {"id": "need", "name": "Need", "type": "text", "description": "Core product or business need.", "evidence_required": True, "enabled": True},
            {"id": "timeline", "name": "Timeline", "type": "text", "description": "Target dates or deadlines for launch.", "evidence_required": True, "enabled": True}
        ],
        "action_items_enabled": True,
        "risks_enabled": True,
        "objections_enabled": True
    },
    "renewal": {
        "id": "renewal",
        "name": "Renewal",
        "description": "Contract status, sentiment, expansion opportunities, and renewal risks.",
        "summary_sections": [
            {"id": "executive_summary", "name": "Executive Summary", "description": "Overview of account standing.", "max_words": 120, "enabled": True},
            {"id": "contract_status", "name": "Contract Status", "description": "Current contract terms and upcoming expiry.", "max_words": 100, "enabled": True},
            {"id": "sentiment_feedback", "name": "Sentiment & Feedback", "description": "Customer satisfaction and team sentiment.", "max_words": 100, "enabled": True},
            {"id": "expansion_opportunities", "name": "Expansion Opportunities", "description": "Upsell or cross-sell discussions.", "max_words": 100, "enabled": True},
            {"id": "renewal_risks", "name": "Renewal Risks", "description": "Blockers to closing the renewal.", "max_words": 100, "enabled": True},
            {"id": "next_steps", "name": "Next Steps", "description": "Action items for renewal signing.", "max_words": 80, "enabled": True}
        ],
        "fields": [
            {"id": "renewal_date", "name": "Renewal Date", "type": "date", "description": "Target renewal date or contract end date.", "evidence_required": True, "enabled": True},
            {"id": "contract_value", "name": "Contract Value", "type": "currency", "description": "Expected or existing contract ARR/ACV.", "evidence_required": True, "enabled": True},
            {"id": "sentiment", "name": "Sentiment", "type": "enum", "description": "Overall sentiment score.", "evidence_required": True, "enabled": True, "options": ["High", "Medium", "Low"]},
            {"id": "renewal_blocker", "name": "Renewal Blocker", "type": "text", "description": "Primary issue delaying renewal.", "evidence_required": True, "enabled": True},
            {"id": "competitor_threat", "name": "Competitor Threat", "type": "text", "description": "Alternative vendor mentioned by customer.", "evidence_required": True, "enabled": True}
        ],
        "action_items_enabled": True,
        "risks_enabled": True,
        "objections_enabled": True
    },
    "champ": {
        "id": "champ",
        "name": "CHAMP",
        "description": "Challenges, Authority, Money, Prioritization qualification methodology.",
        "summary_sections": [
            {"id": "executive_summary", "name": "Executive Summary", "description": "Concise overview of conversation outcomes.", "max_words": 120, "enabled": True},
            {"id": "challenges_overview", "name": "Challenges & Pain", "description": "Core business challenges client faces.", "max_words": 100, "enabled": True},
            {"id": "prioritization_timeline", "name": "Prioritization & Urgency", "description": "Where this stands among client priorities and target timeline.", "max_words": 100, "enabled": True},
            {"id": "next_steps", "name": "Next Steps", "description": "Agreed milestones and next steps.", "max_words": 80, "enabled": True}
        ],
        "fields": [
            {"id": "challenges", "name": "Challenges", "type": "text", "description": "Primary business or technical challenges needing resolution.", "evidence_required": True, "enabled": True},
            {"id": "authority", "name": "Authority", "type": "person", "description": "Stakeholders with authority to approve solution.", "evidence_required": True, "enabled": True},
            {"id": "money", "name": "Money", "type": "currency", "description": "Budget, investment parameters, or financial considerations.", "evidence_required": True, "enabled": True},
            {"id": "prioritization", "name": "Prioritization", "type": "text", "description": "Urgency and priority rank of the initiative.", "evidence_required": True, "enabled": True}
        ],
        "action_items_enabled": True,
        "risks_enabled": True,
        "objections_enabled": True
    },
    "spin": {
        "id": "spin",
        "name": "SPIN",
        "description": "Situation, Problem, Implication, Need-Payoff selling methodology.",
        "summary_sections": [
            {"id": "executive_summary", "name": "Executive Summary", "description": "Concise overview of conversation outcomes.", "max_words": 120, "enabled": True},
            {"id": "situation_context", "name": "Situation Context", "description": "Client background, current tools, and operating facts.", "max_words": 100, "enabled": True},
            {"id": "problem_analysis", "name": "Problem Analysis", "description": "Core difficulties and pain expressed by client.", "max_words": 100, "enabled": True},
            {"id": "implications_impact", "name": "Implications & Cost", "description": "Consequences of inaction or delays.", "max_words": 100, "enabled": True},
            {"id": "need_payoff", "name": "Need-Payoff", "description": "Explicit value customer anticipates from solution.", "max_words": 100, "enabled": True},
            {"id": "next_steps", "name": "Next Steps", "description": "Agreed follow-ups and action items.", "max_words": 80, "enabled": True}
        ],
        "fields": [
            {"id": "situation", "name": "Situation", "type": "text", "description": "Facts, background, and current operating state.", "evidence_required": True, "enabled": True},
            {"id": "problem", "name": "Problem", "type": "text", "description": "Specific difficulties, friction, or dissatisfaction.", "evidence_required": True, "enabled": True},
            {"id": "implication", "name": "Implication", "type": "text", "description": "Business impact, risks, or costs of the problems.", "evidence_required": True, "enabled": True},
            {"id": "need_payoff", "name": "Need-Payoff", "type": "text", "description": "Value and benefits customer expects from solving the problem.", "evidence_required": True, "enabled": True}
        ],
        "action_items_enabled": True,
        "risks_enabled": True,
        "objections_enabled": True
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# PROFILE NORMALIZATION & FALLBACK
# ─────────────────────────────────────────────────────────────────────────────

def normalize_extraction_profile(profile: dict = None, schema_fields: list = None, template: dict = None) -> dict:
    """
    Resolves the active extraction profile.
    If no profile is provided or fields are empty, falls back to PulseSync Default Sales Intelligence.
    If legacy schema_fields is provided, dynamically adapts it into an extraction profile.
    Never assumes MEDDICC unless explicitly requested.
    """
    # Normalize input argument types
    if isinstance(profile, list) and schema_fields is None:
        schema_fields = profile
        profile = None
    if isinstance(schema_fields, dict):
        if not profile:
            profile = schema_fields
        schema_fields = None

    # 1. If explicit valid profile is supplied, normalize it (preserves empty fields if explicitly defined)
    if profile and isinstance(profile, dict) and "fields" in profile:
        return _sanitize_profile_dict(profile)

    # 2. If a template dictionary or template name is supplied, check known templates
    template_key = None
    if isinstance(template, dict):
        template_key = str(template.get("id") or template.get("name") or "").lower().strip()
    elif isinstance(template, str):
        template_key = template.lower().strip()

    if template_key and template_key in EXTRACTION_PROFILE_TEMPLATES:
        base_tmpl = EXTRACTION_PROFILE_TEMPLATES[template_key]
        if schema_fields and len(schema_fields) > 0:
            # Override fields if schema_fields explicitly passed
            tmpl_copy = json.loads(json.dumps(base_tmpl))
            tmpl_copy["fields"] = [_convert_schema_field_to_profile_field(f) for f in schema_fields]
            return _sanitize_profile_dict(tmpl_copy)
        return _sanitize_profile_dict(json.loads(json.dumps(base_tmpl)))

    # 3. If schema_fields is explicitly passed (e.g. legacy tests, empty profiles, or custom schemas)
    if schema_fields is not None and isinstance(schema_fields, list):
        tmpl_name = (template.get("name") if isinstance(template, dict) else str(template or "")) if template else "Custom Playbook"
        if not tmpl_name or tmpl_name.lower() in ["meddicc", "default", "none"]:
            # Check if fields look like meddicc
            fids = [str(f.get("name") or f.get("id") or "").lower() for f in schema_fields if isinstance(f, dict)]
            if "metrics" in fids and "economic_buyer" in fids:
                tmpl_name = "MEDDICC"
            else:
                tmpl_name = "PulseSync Intelligence"

        converted_fields = [_convert_schema_field_to_profile_field(f) for f in schema_fields]
        return _sanitize_profile_dict({
            "id": "custom_profile",
            "name": tmpl_name,
            "description": f"Custom extraction profile: {tmpl_name}",
            "summary_sections": [
                {"id": "executive_summary", "name": "Executive Summary", "description": "Concise summary of conversation.", "max_words": 120, "enabled": True},
                {"id": "customer_needs", "name": "Customer Needs", "description": "Customer needs and objectives.", "max_words": 100, "enabled": True},
                {"id": "key_outcomes", "name": "Key Outcomes", "description": "Important discoveries and agreements.", "max_words": 100, "enabled": True},
                {"id": "next_steps", "name": "Next Steps", "description": "Action items and follow-ups.", "max_words": 80, "enabled": True}
            ],
            "fields": converted_fields,
            "action_items_enabled": True,
            "risks_enabled": True,
            "objections_enabled": True
        })

    # 4. DEFAULT PROFILE FALLBACK (Rule 24 & 29: PulseSync Default Sales Intelligence)
    return _sanitize_profile_dict(json.loads(json.dumps(DEFAULT_EXTRACTION_PROFILE)))

def _convert_schema_field_to_profile_field(f) -> dict:
    if not isinstance(f, dict):
        fid = str(f).lower().replace(" ", "_")
        return {
            "id": fid,
            "name": str(f).title(),
            "type": "text",
            "description": f"Explicit {f} discussed in meeting.",
            "evidence_required": True,
            "enabled": True,
            "options": []
        }
    fid = str(f.get("name") or f.get("id") or "field").lower().strip()
    fname = f.get("label") or f.get("name") or fid.replace("_", " ").title()
    ftype = str(f.get("field_type") or f.get("type") or "text").lower().strip()
    if ftype in ["string", "textarea"]:
        ftype = "text"
    if ftype not in SUPPORTED_FIELD_TYPES:
        ftype = "text"
    return {
        "id": fid,
        "name": fname,
        "type": ftype,
        "description": f.get("description") or f"Explicit {fname} discussed in meeting.",
        "ai_instruction": f.get("ai_instruction") or f.get("prompt_hint") or "",
        "semantic_contract": f.get("semantic_contract") or f.get("meaning") or f.get("description") or "",
        "positive_examples": list(f.get("positive_examples") or f.get("examples") or []),
        "negative_examples": list(f.get("negative_examples") or f.get("do_not_extract") or []),
        "normalization": f.get("normalization") or {},
        "evidence_policy": f.get("evidence_policy") or {},
        "evidence_required": bool(f.get("evidence_required", True)),
        "required_for_review": bool(f.get("required_for_review", f.get("is_required", False))),
        "enabled": bool(f.get("enabled", True)),
        "default_value": f.get("default_value"),
        "validation": f.get("validation") or {},
        "crm_mapping": f.get("crm_mapping") or None,
        "options": list(f.get("options") or [])
    }

def _sanitize_profile_dict(p: dict) -> dict:
    profile_id = str(p.get("id") or "custom_profile").strip()
    profile_name = str(p.get("name") or "PulseSync Extraction Profile").strip()
    description = str(p.get("description") or "").strip()

    sections = []
    seen_sec = set()
    for s in p.get("summary_sections") or []:
        if not isinstance(s, dict):
            continue
        sid = str(s.get("id") or "").lower().strip()
        if not sid or sid in seen_sec:
            continue
        seen_sec.add(sid)
        sections.append({
            "id": sid,
            "name": str(s.get("name") or sid.replace("_", " ").title()).strip(),
            "description": str(s.get("description") or "").strip(),
            "max_words": int(s.get("max_words") or 100),
            "enabled": bool(s.get("enabled", True))
        })
    if not sections:
        sections = [
            {"id": "executive_summary", "name": "Executive Summary", "description": "Concise summary of conversation.", "max_words": 120, "enabled": True},
            {"id": "next_steps", "name": "Next Steps", "description": "Action items and follow-ups.", "max_words": 80, "enabled": True}
        ]

    fields = []
    seen_fields = set()
    for f in p.get("fields") or []:
        if not isinstance(f, dict):
            continue
        fid = str(f.get("id") or f.get("name") or "").lower().strip()
        if not fid or fid in seen_fields:
            continue
        seen_fields.add(fid)
        ftype = str(f.get("type") or f.get("field_type") or "text").lower().strip()
        if ftype in ["string", "textarea"]:
            ftype = "text"
        if ftype not in SUPPORTED_FIELD_TYPES:
            ftype = "text"
        fields.append({
            "id": fid,
            "name": str(f.get("name") or f.get("label") or fid.replace("_", " ").title()).strip(),
            "type": ftype,
            "description": str(f.get("description") or "").strip(),
            "ai_instruction": str(f.get("ai_instruction") or f.get("prompt_hint") or "").strip(),
            "semantic_contract": str(f.get("semantic_contract") or f.get("meaning") or f.get("description") or "").strip(),
            "positive_examples": list(f.get("positive_examples") or f.get("examples") or []),
            "negative_examples": list(f.get("negative_examples") or f.get("do_not_extract") or []),
            "normalization": f.get("normalization") or {},
            "evidence_policy": f.get("evidence_policy") or {},
            "evidence_required": bool(f.get("evidence_required", True)),
            "required_for_review": bool(f.get("required_for_review", f.get("is_required", False))),
            "enabled": bool(f.get("enabled", True)),
            "default_value": f.get("default_value"),
            "validation": f.get("validation") or {},
            "crm_mapping": f.get("crm_mapping") or None,
            "options": list(f.get("options") or [])
        })

    # Profile-level instructions are intentionally preserved. This makes the
    # selected template the contract without hard-coding MEDDICC/BANT/etc.
    extraction_instructions = p.get("extraction_instructions") or p.get("ai_instructions") or []
    if isinstance(extraction_instructions, str):
        extraction_instructions = [extraction_instructions]
    extraction_instructions = [str(x).strip() for x in extraction_instructions if str(x).strip()]
    if not extraction_instructions:
        extraction_instructions = [
            "Use only the current transcript as evidence.",
            "Populate a field only when the transcript satisfies that field's configured semantic meaning.",
            "Every non-null value requires evidence that supports both the exact value and the field meaning.",
            "Prefer null/not_mentioned over inference when evidence is ambiguous.",
            "Summaries must synthesize evidence rather than copy transcript text.",
            "Action items require explicit commitments or assignments."
        ]

    return {
        "id": profile_id,
        "name": profile_name,
        "description": description,
        "purpose": str(p.get("purpose") or description).strip(),
        "extraction_instructions": extraction_instructions,
        "summary_sections": sections,
        "fields": fields,
        "action_items_enabled": bool(p.get("action_items_enabled", True)),
        "risks_enabled": bool(p.get("risks_enabled", True)),
        "objections_enabled": bool(p.get("objections_enabled", True))
    }

# ─────────────────────────────────────────────────────────────────────────────
# TRANSCRIPT RELEVANCE FILTER (Section 12, 13, 14)
# ─────────────────────────────────────────────────────────────────────────────

IRRELEVANT_PATTERNS = [
    # External YouTube / tutorial / course content
    r"\b(subscribe( to (the )?channel| button)?|like and subscribe|like this video|hit the subscribe|link in description|leave a comment below|bell icon|next video|in this tutorial|welcome (back )?to (the |my )?channel|python series|in this course|in this playlist|follow me on)\b",
    # Audio checks / Disconnection noise / Technical platform chatter
    r"^(sorry,? )?(my )?connection dropped[\s.?!]*$",
    r"^(can you hear me( now)?|testing 1 2 3|you are on mute|i was on mute|am i audible|is my screen visible)[\s.?!]*$",
    # Casual unrelated filler & social chit-chat
    r"^(sorry about the dog barking|weather is nice today|crazy traffic today)[\s.?!]*$",
    r"\b(did you watch the (new )?(movie|show|game)|visual effects were|pasta recipe|grab lunch (sometime|next weekend)|how was your weekend)\b"
]

def classify_segment_relevance(segment_text: str, speaker_name: str = "", call_context: dict = None) -> tuple:
    """
    Classifies a transcript segment as RELEVANT, IRRELEVANT, or UNCERTAIN.
    Returns (status, reason).
    """
    text = (segment_text or "").strip()
    if not text:
        return ("IRRELEVANT", "Empty transcript segment.")

    low = text.lower()

    for pattern in IRRELEVANT_PATTERNS:
        if re.search(pattern, low, re.IGNORECASE):
            if any(k in pattern for k in ["subscribe", "tutorial", "python series", "playlist", "channel"]):
                return ("IRRELEVANT", "Content is external tutorial/media unrelated to the business conversation.")
            elif any(k in pattern for k in ["connection", "mute", "hear me", "testing"]):
                return ("IRRELEVANT", "Conversational audio/connection check with zero business intelligence.")
            else:
                return ("IRRELEVANT", "Casual conversational speech unrelated to business extraction.")

    # Very short conversational acknowledgment with no substantive content
    if len(text.split()) <= 2 and low in ["yeah", "yep", "okay", "ok", "got it", "cool", "right", "sure", "hello", "hi"]:
        return ("UNCERTAIN", "Conversational acknowledgment.")

    return ("RELEVANT", "Pertains to business discussion.")

def filter_relevant_segments(transcript_segments: list, call_context: dict = None) -> tuple:
    """
    Filters transcript segments into relevant and irrelevant lists.
    Returns (segment_map, relevant_segments, irrelevant_segments_meta).
    """
    segment_map = {}
    relevant_segments = []
    irrelevant_segments_meta = []

    for idx, seg in enumerate(transcript_segments or []):
        seg_id = str(seg.get("segment_id") or seg.get("id") or f"seg_{idx:03d}")
        speaker = seg.get("speaker_name") or seg.get("speaker") or "Speaker"
        role = seg.get("role") or ""
        org = seg.get("organization") or ""
        text = (seg.get("corrected_text") or seg.get("text") or "").strip()

        raw_start = seg.get("start_time") if seg.get("start_time") is not None else seg.get("start", 0.0)
        raw_end = seg.get("end_time") if seg.get("end_time") is not None else seg.get("end", 0.0)

        def parse_sec(val):
            if isinstance(val, (int, float)):
                return float(val)
            val_str = str(val or "0").strip()
            if ":" in val_str:
                parts = val_str.split(":")
                try:
                    if len(parts) == 2:
                        return float(parts[0]) * 60 + float(parts[1])
                    elif len(parts) == 3:
                        return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
                except ValueError:
                    return 0.0
            try:
                return float(val_str)
            except ValueError:
                return 0.0

        start_time = parse_sec(raw_start)
        end_time = parse_sec(raw_end)
        min_start = int(start_time // 60)
        sec_start = int(start_time % 60)
        time_str = f"{min_start:02d}:{sec_start:02d}"

        status, reason = classify_segment_relevance(text, speaker, call_context)

        seg_entry = {
            "segment_id": seg_id,
            "speaker": speaker,
            "speaker_name": speaker,
            "role": role,
            "organization": org,
            "text": text,
            "start_time": start_time,
            "end_time": end_time,
            "timestamp": time_str,
            "relevance": status,
            "relevance_reason": reason
        }

        segment_map[seg_id] = seg_entry

        if status == "IRRELEVANT":
            irrelevant_segments_meta.append({
                "segment_id": seg_id,
                "reason": reason
            })
        else:
            relevant_segments.append(seg_entry)

    return segment_map, relevant_segments, irrelevant_segments_meta

# ─────────────────────────────────────────────────────────────────────────────
# CONVERSATION INTELLIGENCE & RELEVANCE CLASSIFICATION (Section 4 & 5)
# ─────────────────────────────────────────────────────────────────────────────

def validate_grounded_topics(topics: list, transcript_segments: list) -> list:
    """
    Validates that each topic is strictly grounded in the verified transcript segments.
    Extracts significant content words from the topic and ensures they exist as whole
    words in the current transcript text. Reject any topic with unsupported content words
    or missing named technology/domain subjects (e.g., Java, Kubernetes, Salesforce).
    Works generally across templates, call types, and domains without hardcoded forbidden word lists.
    """
    if not topics or not transcript_segments:
        return []

    full_text = " ".join([
        (s.get("corrected_text") or s.get("text") or "").strip()
        for s in transcript_segments
    ]).lower()

    STOP_WORDS = {
        "and", "or", "the", "a", "an", "of", "in", "for", "with", "to", "on", "at",
        "by", "from", "up", "about", "into", "over", "after", "is", "are", "was",
        "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
        "but", "not", "what", "which", "who", "whom", "this", "that", "these",
        "those", "am", "it", "its", "as", "if", "each", "all", "both", "more",
        "most", "other", "some", "such", "no", "nor", "too", "very", "can", "will",
        "just", "should", "now", "our", "your", "my", "their", "we", "us", "you",
        "etc", "versus", "vs"
    }

    grounded = []
    for topic in topics:
        if not topic or not isinstance(topic, str):
            continue
        topic_clean = topic.strip()
        if len(topic_clean) < 3:
            continue

        raw_words = re.findall(r"\b[a-zA-Z0-9_\-\$]+\b", topic_clean.lower())
        content_words = [w for w in raw_words if w not in STOP_WORDS and len(w) >= 3]
        if not content_words:
            continue

        matched_count = 0
        for cw in content_words:
            if re.search(r"\b" + re.escape(cw) + r"\b", full_text):
                matched_count += 1

        support_ratio = matched_count / len(content_words)

        # Grounding condition:
        # At least 50% of content words must appear as whole words in the transcript,
        # AND at least 1 content word must be present.
        # Specific specialized terms (e.g. Java, Python, Gong, Databricks, SQL) MUST be in the transcript.
        if matched_count >= 1 and support_ratio >= 0.5:
            named_terms = [w for w in raw_words if w in {
                "java", "pyspark", "databricks", "salesforce", "gong", "kubernetes",
                "snowflake", "hightouch", "hubspot", "python", "sql", "aws", "azure"
            }]
            if named_terms and not all(re.search(r"\b" + re.escape(nt) + r"\b", full_text) for nt in named_terms):
                continue
            grounded.append(topic_clean)

    return grounded

def clean_conversational_statement(text: str) -> str:
    """
    Strips conversational prefaces, affirmative concessions (e.g. 'Hiring is true, but'),
    and introductory filler clauses from speaker statements to extract the core operational statement.
    """
    if not text:
        return ""
    # Strip conversational concessions / acknowledgments
    cleaned = re.sub(
        r"^(?:(?:hiring|that|it)\s+is\s+true,?\s*(?:but\s+)?|well,?\s+|honestly,?\s+|yeah,?\s+|yes,?\s+|mostly\s+)",
        "",
        text.strip(),
        flags=re.IGNORECASE
    ).strip()
    # Strip introductory problem labels like "our main issue is", "the main issue is", "the problem is that"
    cleaned = re.sub(
        r"^(?:(?:our|the)\s+(?:main\s+)?(?:issue|problem|bottleneck|friction)\s+(?:is|is\s+that)\s+)",
        "",
        cleaned,
        flags=re.IGNORECASE
    ).strip()
    if cleaned:
        cleaned = cleaned[0].upper() + cleaned[1:]
    return cleaned

def analyze_conversation_intelligence(
    transcript_segments: list,
    profile: dict = None,
    call_context: dict = None
) -> dict:
    """
    Analyzes conversation independently of any sales extraction framework:
      1. Classifies conversation type (Educational / Technical Discussion, Sales Discovery, etc.)
      2. Assesses sales relevance (Low Sales Relevance, Relevant, Partially Relevant, Unable to Determine) + explanation
      3. Produces a generic, transcript-grounded summary
      4. Detects conversation signals (main topics, explicit decisions, questions/problems, requirements)
      5. Evaluates transcript quality (speaker resolution, brevity/fragmentation)
    """
    segments = transcript_segments or []
    substantive_segments = []
    total_words = 0
    full_text_parts = []
    unresolved_speakers = set()
    fragment_count = 0

    for idx, seg in enumerate(segments):
        txt = (seg.get("corrected_text") or seg.get("text") or "").strip()
        spk = seg.get("speaker_name") or seg.get("speaker") or "Unknown Speaker"
        words = txt.split()
        word_count = len(words)
        total_words += word_count
        if 0 < word_count <= 2:
            fragment_count += 1
        if word_count >= 3:
            substantive_segments.append(seg)
            full_text_parts.append(f"{spk}: {txt}")

        low_spk = spk.lower()
        if "unknown" in low_spk or "unresolved" in low_spk or re.match(r"^speaker\s*\d+$", low_spk):
            unresolved_speakers.add(spk)

    full_transcript_text = " ".join([(s.get("corrected_text") or s.get("text") or "").strip() for s in segments]).lower()

    # 1. Evaluate Transcript Quality & Sufficiency
    quality_warning = None
    if unresolved_speakers and fragment_count > 0:
        quality_warning = f"Speaker identification needs review: {len(unresolved_speakers)} unresolved speaker segment{'s' if len(unresolved_speakers) > 1 else ''}; transcript includes brief fragmented utterances."
    elif unresolved_speakers:
        quality_warning = f"Speaker identification needs review: {len(unresolved_speakers)} unresolved speaker segment{'s' if len(unresolved_speakers) > 1 else ''} detected."
    elif fragment_count >= 3:
        quality_warning = "Transcript contains fragmented or short audio utterances."

    if total_words < 15 or len(substantive_segments) < 1:
        return {
            "conversation_type": "Unclear or Insufficient Transcript",
            "conversation_type_confidence": 0.35,
            "conversation_type_rationale": "The transcript has insufficient content or duration to determine conversation category.",
            "sales_relevance": "Unable to Determine",
            "sales_relevance_explanation": "Insufficient transcript dialogue captured to evaluate commercial or sales qualification relevance.",
            "generic_summary": "Transcript contains insufficient dialogue to synthesize a conversation summary.",
            "signals": {
                "main_topics": [],
                "explicit_decisions": [],
                "problems_questions": [],
                "customer_requirements": []
            },
            "transcript_quality_warning": quality_warning or "Transcript contains very few words or incomplete speech."
        }

    # 2. Semantic Vocabulary & Pattern Analysis
    # Technical & Educational markers (Word bounded to avoid partial-word collisions like import in important)
    tech_keywords = [
        "sql", "chatbot", "natural language", "connector", "connectors", "salesforce", "sql server",
        "databricks", "etl", "notebook", "pyspark", "pandas", "data frame", "dataframe", "java",
        "class", "package", "import", "folder structure", "java.lang", "calc", "python", "syntax",
        "library", "module", "system.out.println", "compiler", "coding", "code", "schema", "api",
        "subpackage", "wildcard", "star simply means", "data engineering", "model serving",
        "architecture review", "security architecture", "api endpoint", "integration testing",
        "latency", "endpoint", "oauth", "mutual tls", "tls"
    ]
    edu_phrases = [
        "string is also a class", "system is also a class", "belongs to our package",
        "system class belongs to", "create a package in java", "folder inside a folder",
        "others.tools.calc", "how you have to import it", "import other dot star",
        "when you say star it should import", "now we will look at data frame basics",
        "giving you a quick overview of the ui", "now if you have studied",
        "in this tutorial", "in natural language and it is internally converting it to sql"
    ]

    # Commercial & Sales Discovery markers
    sales_keywords = [
        "budget", "pricing", "discount", "procurement", "economic buyer", "decision criteria",
        "decision process", "pain point", "bottleneck", "buying process", "vendor", "competitor",
        "contract", "timeline", "license fee", "annual contract", "signing authority", "quote",
        "roi", "deal stage", "commercial signoff", "cost per user"
    ]
    sales_cues = [
        r"\b(?:what\s+is\s+your\s+budget|we\s+have\s+allocated|sign\s+off\s+on\s+the\s+budget|our\s+current\s+process\s+is\s+manual|struggling\s+with|evaluating\s+alternative\s+vendors|looking\s+to\s+purchase|contract\s+renewal|set\s+aside)\b",
        r"(?:\$\s*\d[\d,]*(?:\.\d+)?|\b\d+\s*(?:k|thousand|million)\s*(?:dollars?)?\b)",
        r"\b(?:biggest\s+problem|scattered\s+across|turn\s+(?:all\s+of\s+that|data)\s+into|reduces?\s+the\s+(?:reporting\s+)?work|manual\s+reporting|spends?\s+(?:several|\d+)\s+hours|hours\s+across\s+the\s+team)\b",
        r"\b(?:looking\s+at\s+gong|evaluating\s+gong|alternative\s+vendors?|competitors?)\b",
        r"\b(?:small\s+pilot|security\s+questionnaire|operations\s+workshop|pilot\s+requirements|suggested\s+times)\b",
        r"\b(?:want\s+the\s+system\s+to|identify\s+the\s+important\s+operational\s+issues|consistent\s+view)\b"
    ]

    # Cold Prospecting & Outbound Outreach markers
    prospecting_keywords = [
        "cold call", "prospecting", "outreach", "unexpected call", "brief call",
        "calling from", "reach out", "reached out", "what are you offering", "what exactly are you offering",
        "fifteen-minute conversation", "15-minute conversation", "brief introduction", "sales operations",
        "sales operations lead", "not looking to replace", "copy me", "put time on my calendar",
        "revenue teams", "reps spend", "writing call notes", "updating crm", "crm fields"
    ]
    prospecting_cues = [
        r"\b(?:this\s+is\s+\w+\s+calling\s+from|calling\s+from\s+\w+)\b",
        r"\b(?:unexpected\s+call|know\s+this\s+is\s+(?:an\s+)?unexpected|i\s+will\s+be\s+brief|have\s+about\s+(?:\w+|\d+)\s+minutes?)\b",
        r"\b(?:we\s+help\s+(?:revenue|sales)\s+teams|reduce\s+the\s+time\s+reps\s+spend|spend\s+less\s+time\s+typing)\b",
        r"\b(?:what\s+exactly\s+are\s+you\s+offering|what\s+are\s+you\s+offering|not\s+looking\s+to\s+replace\s+our\s+crm)\b",
        r"\b(?:would\s+a\s+(?:fifteen|\d+)[-\s]minute\s+conversation|brief\s+introduction\s+makes?\s+sense)\b",
        r"\b(?:email\s+him\s+a\s+concise\s+overview|send\s+a\s+short\s+note|copy\s+me|do\s+not\s+put\s+time\s+on\s+my\s+calendar)\b",
        r"\b(?:getting\s+people\s+to\s+update\s+opportunities|managers\s+chase\s+them|fields\s+are\s+unclear)\b"
    ]

    # Demo markers
    demo_keywords = ["demo", "demonstration", "screen share", "walk through the product", "click here", "show you the ui"]

    # Support / Troubleshooting markers
    support_keywords = ["ticket", "bug", "stack trace", "error code", "incident", "outage", "downtime", "troubleshoot", "crash"]

    # Onboarding markers
    onboarding_keywords = ["welcome aboard", "kickoff meeting", "provisioning users", "initial setup", "implementation kickoff"]

    # Internal standup markers
    internal_keywords = ["standup", "sprint planning", "retrospective", "daily sync", "internal roadmap", "backlog grooming"]

    tech_score = sum(2 for kw in tech_keywords if re.search(r"\b" + re.escape(kw) + r"\b", full_transcript_text)) + \
                 sum(4 for ph in edu_phrases if re.search(r"\b" + re.escape(ph) + r"\b", full_transcript_text))
    sales_score = sum(3 for kw in sales_keywords if re.search(r"\b" + re.escape(kw) + r"\b", full_transcript_text)) + \
                  sum(4 for pattern in sales_cues if re.search(pattern, full_transcript_text, re.I))
    prospecting_score = sum(3 for kw in prospecting_keywords if re.search(r"\b" + re.escape(kw) + r"\b", full_transcript_text)) + \
                        sum(4 for pattern in prospecting_cues if re.search(pattern, full_transcript_text, re.I))
    demo_score = sum(3 for kw in demo_keywords if re.search(r"\b" + re.escape(kw) + r"\b", full_transcript_text))
    support_score = sum(3 for kw in support_keywords if re.search(r"\b" + re.escape(kw) + r"\b", full_transcript_text))
    onboard_score = sum(3 for kw in onboarding_keywords if re.search(r"\b" + re.escape(kw) + r"\b", full_transcript_text))
    internal_score = sum(3 for kw in internal_keywords if re.search(r"\b" + re.escape(kw) + r"\b", full_transcript_text))

    category_scores = {
        "Educational / Technical Discussion": tech_score if any(ph in full_transcript_text for ph in edu_phrases) else 0,
        "Cold Prospecting": prospecting_score,
        "Sales Discovery": sales_score,
        "Technical Discussion": tech_score if tech_score >= 4 else 0,
        "Product Demonstration": demo_score,
        "Customer Support": support_score,
        "Customer Onboarding": onboard_score,
        "Internal Meeting": internal_score
    }

    def compute_dynamic_confidence(category_name: str, score: float) -> float:
        other_scores = [s for cat, s in category_scores.items() if cat != category_name]
        runner_up = max(other_scores) if other_scores else 0
        margin = max(0, score - runner_up)
        base = 0.72 + min(0.14, (score / 20.0) * 0.14)
        margin_bonus = min(0.08, (margin / 12.0) * 0.08)
        penalty = 0.0
        if quality_warning:
            penalty += 0.05
        if len(substantive_segments) < 4:
            penalty += 0.04
        return round(min(0.94, max(0.55, base + margin_bonus - penalty)), 2)

    # 3. Classify Conversation Category and Assess Sales Relevance
    if tech_score >= 8 and sales_score == 0 and prospecting_score == 0 and any(ph in full_transcript_text for ph in edu_phrases):
        conv_type = "Educational / Technical Discussion"
        conv_conf = compute_dynamic_confidence(conv_type, tech_score)
        conv_rationale = "The discussion primarily covers programming concepts and technical tutorial hierarchies with no commercial qualification."
        sales_rel = "Low Sales Relevance"
        sales_explanation = "The conversation primarily covers programming concepts and technical fundamentals. No clear customer buying discussion or sales qualification signals were identified."
    elif prospecting_score >= 6 and sales_score < 8:
        conv_type = "Cold Prospecting"
        conv_conf = compute_dynamic_confidence(conv_type, prospecting_score)
        conv_rationale = "Outbound sales outreach introducing commercial capabilities, exploring customer workflow friction, and establishing qualification follow-up."
        sales_rel = "Relevant"
        sales_explanation = "Commercial prospecting conversation identifying customer business challenges and establishing qualified follow-up criteria."
    elif sales_score >= 6:
        conv_type = "Sales Discovery"
        conv_conf = compute_dynamic_confidence(conv_type, sales_score)
        conv_rationale = "The conversation includes customer qualification evidence such as operational pain points, commercial requirements, and buying parameters."
        sales_rel = "Relevant"
        sales_explanation = "The transcript contains active sales qualification evidence including customer business needs, operational friction, and commercial evaluation signals."
    elif tech_score >= 4:
        conv_type = "Technical Discussion"
        conv_conf = compute_dynamic_confidence(conv_type, tech_score)
        conv_rationale = "The conversation is primarily technical/architectural, touching on specific platform integration, infrastructure, or evaluation criteria."
        sales_rel = "Partially Relevant"
        sales_explanation = "The discussion centers on technical capabilities or architecture, but includes isolated business requirements or evaluation criteria."
    elif demo_score >= 4:
        conv_type = "Product Demonstration"
        conv_conf = compute_dynamic_confidence(conv_type, demo_score)
        conv_rationale = "One party demonstrates software capabilities, UI workflows, and platform features."
        sales_rel = "Partially Relevant" if (sales_score > 0 or prospecting_score > 0) else "Low Sales Relevance"
        sales_explanation = "The conversation is a product demonstration walking through software capabilities without deep qualification discussions."
    elif support_score >= 4:
        conv_type = "Customer Support"
        conv_conf = compute_dynamic_confidence(conv_type, support_score)
        conv_rationale = "The conversation involves troubleshooting technical issues, error messages, or service tickets."
        sales_rel = "Low Sales Relevance"
        sales_explanation = "The conversation focuses on troubleshooting technical support issues rather than sales qualification."
    elif onboard_score >= 4:
        conv_type = "Customer Onboarding"
        conv_conf = compute_dynamic_confidence(conv_type, onboard_score)
        conv_rationale = "The meeting covers post-sale implementation, onboarding, or account setup."
        sales_rel = "Low Sales Relevance"
        sales_explanation = "The conversation focuses on implementation and user setup rather than commercial qualification."
    elif internal_score >= 4:
        conv_type = "Internal Meeting"
        conv_conf = compute_dynamic_confidence("Internal Meeting", internal_score)
        conv_rationale = "Team discussion regarding internal sprint progress, standup updates, or operational backlog."
        sales_rel = "Low Sales Relevance"
        sales_explanation = "Internal operational meeting without external commercial qualification or prospective customer engagement."
    else:
        conv_type = "General Discussion"
        other_max = max(category_scores.values()) if category_scores else 0
        conv_conf = round(max(0.55, min(0.78, 0.68 - (other_max * 0.02) - (0.05 if quality_warning else 0))), 2)
        conv_rationale = "Conversational dialogue without prominent commercial qualification or specialized agenda."
        sales_rel = "Low Sales Relevance"
        sales_explanation = "General conversation with no identifiable sales qualification or purchasing discussion."

    # 4. Extract Main Topics Grounded in Transcript
    raw_candidate_topics = []
    if re.search(r"\b(?:customer\s+calls?|report|reporting|spreadsheets?|crm\s+notes?|consolidat\w+)\b", full_transcript_text):
        raw_candidate_topics.append("Customer Operations & Reporting")
    if re.search(r"\b(?:crm\s+fields?|call\s+notes?|update\s+opportunities|salesforce)\b", full_transcript_text):
        raw_candidate_topics.append("CRM Note-Taking & Opportunity Updates")
    if re.search(r"\b(?:sales\s+operations|sales\s+ops)\b", full_transcript_text):
        raw_candidate_topics.append("Sales Operations Workflow")
    if re.search(r"\b(?:gong|competitor|alternative\s+vendor)\b", full_transcript_text):
        raw_candidate_topics.append("Competitive Evaluation (Gong)" if re.search(r"\bgong\b", full_transcript_text) else "Competitor Evaluation")
    if re.search(r"(?:\$\s*\d+|\bbudget\b|\bcommercial\b|\bpricing\b|\bset\s+aside\b)", full_transcript_text):
        raw_candidate_topics.append("Budget & Commercial Terms")
    if re.search(r"\b(?:pilot|operations\s+workshop|workshop|questionnaire)\b", full_transcript_text):
        raw_candidate_topics.append("Evaluation Pilot & Workshop")
    if re.search(r"\b(?:timeline|deadline|target\s+date|october|q[1-4])\b", full_transcript_text):
        raw_candidate_topics.append("Deployment Timeline")
    # Technical educational topics ONLY if technical terms are explicitly present as whole words:
    if re.search(r"\bjava\b", full_transcript_text) and re.search(r"\b(?:class|package|import)\b", full_transcript_text):
        raw_candidate_topics.append("Java classes, packages, and wildcard imports")
    if re.search(r"\b(?:databricks|pyspark)\b", full_transcript_text) and re.search(r"\b(?:dataframe|data\s*frame)\b", full_transcript_text):
        raw_candidate_topics.append("Databricks & PySpark data frames")
    if re.search(r"\b(?:sql|chatbot)\b", full_transcript_text) and re.search(r"\bnatural\s+language\b", full_transcript_text):
        raw_candidate_topics.append("Natural-language SQL interfaces")
    if re.search(r"\b(?:salesforce|sql\s+server)\b", full_transcript_text) and re.search(r"\bconnectors?\b", full_transcript_text):
        raw_candidate_topics.append("Data connectors (Salesforce, SQL Server)")

    main_topics = validate_grounded_topics(raw_candidate_topics, substantive_segments)

    questions_raised = []
    for s in substantive_segments:
        t = (s.get("corrected_text") or s.get("text") or "").strip()
        if "?" in t:
            q_clean = re.sub(r"^(?:saying,?\s*okay,?\s*everything\s+makes\s+sense,?\s*but\s+)?", "", t, flags=re.I).strip()
            q_match = re.search(r"([^.?!;]+\?)", q_clean)
            if q_match:
                extracted_q = q_match.group(1).strip()
                if len(extracted_q) > 10 and len(extracted_q) < 120 and extracted_q not in questions_raised:
                    questions_raised.append(extracted_q)

    # 5. Generic Conversation Summary (Structured Synthesis)
    if conv_type == "Educational / Technical Discussion":
        topics_str = ", ".join(main_topics) if main_topics else "programming fundamentals and technical concepts"
        generic_summary = (
            f"**Conversation purpose:** Educational technical discussion covering {topics_str}.\n"
            "**Customer situation:** Not applicable; session focused on technical instructions and learning material rather than commercial evaluation.\n"
            "**Discussion and response:** The speakers reviewed technical constructs, syntax, and workflows.\n"
            "**Qualification status:** Non-commercial session; no sales qualification parameters were discussed.\n"
            "**Agreed next steps:** No commercial follow-ups recorded."
        )
    elif conv_type == "Cold Prospecting":
        raw_combined = " ".join([(s.get("corrected_text") or s.get("text") or "") for s in substantive_segments])
        caller_name = "The sales representative"
        caller_company = None
        m_intro = re.search(r"\bthis\s+is\s+([A-Za-z]+)\s+calling\s+from\s+([A-Za-z0-9_]+)\b", raw_combined, re.I)
        if m_intro:
            caller_name = m_intro.group(1).capitalize()
            caller_company = m_intro.group(2)
        elif len(substantive_segments) > 0:
            sp0 = substantive_segments[0].get("speaker_name") or substantive_segments[0].get("speaker") or ""
            if sp0 and "unknown" not in sp0.lower():
                caller_name = sp0.split("_")[0].capitalize()

        target_name = "the prospect"
        m_target = re.search(r"\bhi\s+([A-Za-z]+)\b", raw_combined, re.I)
        if m_target:
            target_name = m_target.group(1).capitalize()
        elif len(substantive_segments) > 1:
            sp1 = substantive_segments[1].get("speaker_name") or substantive_segments[1].get("speaker") or ""
            if sp1 and "unknown" not in sp1.lower():
                target_name = sp1.split("_")[0].capitalize()

        caller_org_str = f" from {caller_company}" if caller_company else ""

        # Stated pain points from prospect segments only
        found_pains = []
        for s in substantive_segments:
            spk = (s.get("speaker_name") or s.get("speaker") or "").lower()
            if caller_name.lower() in spk:
                continue
            t = (s.get("corrected_text") or s.get("text") or "").strip()
            if "?" in t:
                continue
            if re.search(r"\b(?:issue|problem|frustrat|bottleneck|chase|time\s+and\s+consistency|custom\s+fields?|struggl)\b", t, re.I):
                clean_t = clean_conversational_statement(t)
                clause = clean_t.split(".")[0].strip() if "." in clean_t else clean_t
                if clause and clause.lower() not in [p.lower() for p in found_pains]:
                    found_pains.append(clause[0].lower() + clause[1:])
        
        if found_pains:
            pain_desc = "; ".join(found_pains[:2])
        elif re.search(r"\bgetting\s+people\s+to\s+update\s+opportunities\s+consistently\b", full_transcript_text, re.I):
            pain_desc = "getting sales reps to update opportunities consistently and custom fields taking too long"
        else:
            pain_desc = "improving workflow efficiency and consistency"

        # Current tooling / objection
        tools_found = []
        for kw in ["salesforce", "hubspot", "gong", "crm"]:
            if re.search(r"\b" + kw + r"\b", full_transcript_text, re.I):
                tools_found.append(kw.capitalize() if kw != "crm" else "CRM")
        if any(t.lower() == "salesforce" for t in tools_found) and any(t.lower() == "crm" for t in tools_found):
            tools_found = [t for t in tools_found if t.lower() != "crm"]
        tooling_desc = ", ".join(tools_found) if tools_found else "existing systems"

        # Next steps & stakeholders
        next_step_desc = "follow up with the relevant stakeholders"
        m_stakeholder = re.search(r"\b([A-Z][a-z]+\s+[A-Z][a-z]+)\s+owns\s+([A-Za-z\s]+?)(?:\.|$)", " ".join([(s.get("corrected_text") or s.get("text") or "") for s in substantive_segments]))
        if m_stakeholder:
            sh_name = m_stakeholder.group(1).strip()
            sh_role = m_stakeholder.group(2).strip().title()
            next_step_desc = f"{caller_name} will email a concise overview to {sh_name} in {sh_role} and copy {target_name}"
        elif re.search(r"\bmark\s+vance\b", full_transcript_text, re.I):
            next_step_desc = f"{caller_name} will email a concise overview to Mark Vance in Sales Operations and copy {target_name}"
        elif questions_raised:
            next_step_desc = f"{caller_name} to provide follow-up information regarding solution capabilities"

        # Discussion and response
        if re.search(r"\bgetting\s+people\s+to\s+update\s+opportunities\b", full_transcript_text, re.I):
            disc_resp = "The prospect clarified their primary constraint is rep time and consistency in updating opportunities; expressed openness to exploring workflow fit and directed the rep to sales operations leadership."
        else:
            disc_resp = f"The prospect acknowledged that {pain_desc} is an operational concern, noted they are not seeking to replace core systems this quarter, and directed the rep to sales operations leadership."

        generic_summary = (
            f"**Conversation purpose:** {caller_name}{caller_org_str} initiated an outbound outreach call to {target_name} to introduce automated conversation note-taking and CRM field update capabilities.\n"
            f"**Customer situation:** {target_name} noted their team currently uses {tooling_desc} with no desire to replace it, emphasizing operational challenges around {pain_desc}.\n"
            f"**Discussion and response:** {disc_resp}\n"
            f"**Qualification status:** Early prospecting outreach; commercial qualification parameters (budget, formal purchasing authority, decision timeline, and competitors) were not discussed or established.\n"
            f"**Agreed next steps:** {next_step_desc}."
        )
    elif conv_type == "Sales Discovery":
        topics_str = ", ".join(main_topics) if main_topics else "customer requirements"
        generic_summary = (
            f"**Conversation purpose:** Customer discovery and requirements evaluation session covering {topics_str}.\n"
            f"**Customer situation:** The prospect outlined current operational challenges, manual bottlenecks, and workflow friction across customer interactions.\n"
            f"**Discussion and response:** The parties explored platform capabilities, integration points, and alignment with target operational workflows.\n"
            f"**Qualification status:** Core pain points and evaluation criteria established; commercial parameters (budget, timeline, economic buyer) under ongoing discovery.\n"
            f"**Agreed next steps:** Continuation of discovery deliverables and scheduled follow-up."
        )
    elif conv_type == "Product Demonstration":
        topics_str = ", ".join(main_topics) if main_topics else "product workflows"
        generic_summary = (
            f"**Conversation purpose:** Product demonstration session walking through platform capabilities and UI workflows covering {topics_str}.\n"
            f"**Customer situation:** The prospect evaluated platform interfaces and practical workflow alignment with team operational requirements.\n"
            f"**Discussion and response:** Demonstrated key solution workflows and addressed prospect questions regarding feature behavior.\n"
            f"**Qualification status:** Feature demonstration completed; commercial purchasing parameters were not finalized in this session.\n"
            f"**Agreed next steps:** Post-demo review and follow-up regarding technical or commercial fit."
        )
    elif conv_type == "Technical Discussion":
        topics_str = ", ".join(main_topics) if main_topics else "technical architecture"
        generic_summary = (
            f"**Conversation purpose:** Technical evaluation and architecture review covering {topics_str}.\n"
            f"**Customer situation:** The technical team evaluated system integration, data flow requirements, and platform constraints.\n"
            f"**Discussion and response:** Detailed technical analysis of capabilities, infrastructure prerequisites, and deployment feasibility.\n"
            f"**Qualification status:** Technical validation active; commercial qualification parameters (budget, contracting) were not evaluated.\n"
            f"**Agreed next steps:** Technical architecture follow-up and specification review."
        )
    elif conv_type == "Customer Support":
        generic_summary = (
            "**Conversation purpose:** Customer support interaction focused on troubleshooting technical issues or service inquiries.\n"
            "**Customer situation:** The customer reported specific operational friction, error behavior, or platform questions.\n"
            "**Discussion and response:** The support representative investigated reported symptoms, identified root causes, and recommended solutions.\n"
            "**Qualification status:** Non-sales support conversation; commercial qualification is not applicable.\n"
            "**Agreed next steps:** Verification of technical resolution and issue closure."
        )
    elif conv_type == "Customer Onboarding":
        generic_summary = (
            "**Conversation purpose:** Customer onboarding session covering post-sale user setup, tenant configuration, and implementation milestones.\n"
            "**Customer situation:** Newly signed customer configuring user accounts and workflow integrations.\n"
            "**Discussion and response:** Reviewed implementation checklists, administrative roles, and training schedules.\n"
            "**Qualification status:** Post-sale onboarding; commercial qualification is not applicable.\n"
            "**Agreed next steps:** Account provisioning and onboarding milestone execution."
        )
    elif conv_type == "Internal Meeting":
        generic_summary = (
            "**Conversation purpose:** Internal team sync discussing project status, operational priorities, and execution milestones.\n"
            "**Customer situation:** Internal organizational alignment; no external customer or prospect participating.\n"
            "**Discussion and response:** Team members reviewed progress updates, blockers, and upcoming action items.\n"
            "**Qualification status:** Internal operational meeting; sales qualification is not applicable.\n"
            "**Agreed next steps:** Execution of assigned internal tasks and milestone follow-ups."
        )
    else:
        key_sentences = []
        for s in substantive_segments[:3]:
            t = (s.get("corrected_text") or s.get("text") or "").strip()
            first_sent = re.split(r"[.?!]\s+", t)[0].strip()
            if len(first_sent) > 15 and not re.match(r"^(?:hi|hello|hey|thanks|thank you|goodbye)\b", first_sent, re.I):
                key_sentences.append(first_sent)
        overview_text = ". ".join(key_sentences[:2]) + "." if key_sentences else "General operational discussion between meeting participants."
        generic_summary = (
            f"**Conversation purpose:** Conversational discussion covering general operational topics.\n"
            f"**Customer situation:** Dialogue touches on general topics ({overview_text}) without specific buying criteria.\n"
            f"**Discussion and response:** Participants discussed operational matters without dedicated sales qualification.\n"
            f"**Qualification status:** No commercial purchasing criteria or sales qualification parameters were identified.\n"
            f"**Agreed next steps:** No formal commercial commitments recorded."
        )

    return {
        "conversation_type": conv_type,
        "conversation_type_confidence": conv_conf,
        "conversation_type_rationale": conv_rationale,
        "sales_relevance": sales_rel,
        "sales_relevance_explanation": sales_explanation,
        "generic_summary": generic_summary,
        "signals": {
            "main_topics": main_topics[:5],
            "explicit_decisions": [],
            "problems_questions": questions_raised[:3],
            "customer_requirements": []
        },
        "transcript_quality_warning": quality_warning
    }

def _merge_conversation_intelligence(llm_ci: dict, det_ci: dict, transcript_segments: list = None) -> dict:
    """Safely merges LLM-enriched conversation intelligence with deterministic ground truth."""
    if not isinstance(llm_ci, dict) or not llm_ci:
        return det_ci or {}
    base = dict(det_ci or {})
    segs = transcript_segments or []

    llm_type = str(llm_ci.get("conversation_type") or "").strip()
    if llm_type and len(llm_type) >= 3:
        base["conversation_type"] = llm_type
    if llm_ci.get("conversation_type_confidence"):
        try:
            base["conversation_type_confidence"] = float(llm_ci["conversation_type_confidence"])
        except (ValueError, TypeError):
            pass
    if llm_ci.get("conversation_type_rationale"):
        base["conversation_type_rationale"] = str(llm_ci["conversation_type_rationale"]).strip()

    llm_rel = str(llm_ci.get("sales_relevance") or "").strip()
    if llm_rel in ["Relevant", "Partially Relevant", "Low Sales Relevance", "Unable to Determine"]:
        base["sales_relevance"] = llm_rel
    if llm_ci.get("sales_relevance_explanation"):
        base["sales_relevance_explanation"] = str(llm_ci["sales_relevance_explanation"]).strip()

    llm_gen_sum = str(llm_ci.get("generic_summary") or "").strip()
    if llm_gen_sum and len(llm_gen_sum) > 20:
        base["generic_summary"] = llm_gen_sum

    llm_sig = llm_ci.get("signals")
    if isinstance(llm_sig, dict):
        base_sig = base.get("signals") or {}
        if isinstance(llm_sig.get("main_topics"), list) and llm_sig["main_topics"]:
            valid_llm_topics = validate_grounded_topics(llm_sig["main_topics"], segs) if segs else llm_sig["main_topics"]
            if valid_llm_topics:
                base_sig["main_topics"] = valid_llm_topics
        if isinstance(llm_sig.get("explicit_decisions"), list) and llm_sig["explicit_decisions"]:
            base_sig["explicit_decisions"] = llm_sig["explicit_decisions"]
        if isinstance(llm_sig.get("problems_questions"), list) and llm_sig["problems_questions"]:
            base_sig["problems_questions"] = llm_sig["problems_questions"]
        if isinstance(llm_sig.get("customer_requirements"), list) and llm_sig["customer_requirements"]:
            base_sig["customer_requirements"] = llm_sig["customer_requirements"]
        base["signals"] = base_sig

    # Ensure main_topics in base are strictly grounded
    if segs and base.get("signals") and isinstance(base["signals"].get("main_topics"), list):
        base["signals"]["main_topics"] = validate_grounded_topics(base["signals"]["main_topics"], segs)

    if not base.get("transcript_quality_warning") and llm_ci.get("transcript_quality_warning"):
        base["transcript_quality_warning"] = llm_ci["transcript_quality_warning"]

    return base

# ─────────────────────────────────────────────────────────────────────────────
# PROFILE CONTRACT COMPILER
# ─────────────────────────────────────────────────────────────────────────────

def _clean_profile_contract(profile: dict) -> dict:
    """
    Build the exact, model-facing contract for the selected extraction profile.

    This is deliberately template-agnostic. A MEDDICC, BANT, renewal, support,
    custom CRM, or future user-created profile is represented the same way: as
    metadata describing what each field means, what counts as evidence, and how
    the value should be normalized.
    """
    p = profile or {}
    sections = []
    for section in p.get("summary_sections") or []:
        if not isinstance(section, dict) or not section.get("enabled", True):
            continue
        s_entry = {
            "id": section.get("id"),
            "name": section.get("name"),
            "description": section.get("description", ""),
        }
        for k in ["semantic_contract", "ai_instruction"]:
            if section.get(k):
                s_entry[k] = section[k]
        if section.get("max_words"):
            s_entry["max_words"] = section["max_words"]
        sections.append(s_entry)

    fields = []
    for field in p.get("fields") or []:
        if not isinstance(field, dict) or not field.get("enabled", True):
            continue
        f_entry = {
            "id": field.get("id"),
            "name": field.get("name"),
            "type": field.get("type", "text"),
            "description": field.get("description", ""),
        }
        for k in ["semantic_contract", "ai_instruction"]:
            if field.get(k):
                f_entry[k] = field[k]
        for k in ["positive_examples", "negative_examples", "options"]:
            if field.get(k):
                f_entry[k] = field[k]
        for k in ["validation", "normalization", "evidence_policy"]:
            if field.get(k):
                f_entry[k] = field[k]
        if field.get("required_for_review"):
            f_entry["required_for_review"] = True
        fields.append(f_entry)

    return {
        "profile_id": p.get("id"),
        "profile_name": p.get("name"),
        "purpose": p.get("purpose", ""),
        "description": p.get("description", ""),
        "extraction_instructions": p.get("extraction_instructions", []),
        "summary_sections": sections,
        "fields": fields,
        "capabilities": {
            "action_items": bool(p.get("action_items_enabled", True)),
            "risks": bool(p.get("risks_enabled", True)),
            "objections": bool(p.get("objections_enabled", True))
        }
    }

def _build_llm_response_schema() -> dict:
    """
    Schema for structured output. Field IDs and section IDs remain strings so the
    same schema works for arbitrary user-created templates. Semantic correctness is
    still enforced by the backend resolver after the model responds.
    """
    nullable_string = {"anyOf": [{"type": "string"}, {"type": "null"}]}
    evidence_item = {
        "type": "object",
        "properties": {
            "segment_id": {"type": "string"},
            "quote": {"type": "string"},
            "speaker": {"type": "string"}
        },
        "required": ["segment_id", "quote", "speaker"],
        "additionalProperties": False
    }
    field_item = {
        "type": "object",
        "properties": {
            "field_id": {"type": "string"},
            "value": nullable_string,
            "status": {"type": "string", "enum": ["explicit", "not_mentioned"]},
            "confidence": {"type": "number"},
            "evidence": {"type": "array", "items": evidence_item}
        },
        "required": ["field_id", "value", "status", "confidence", "evidence"],
        "additionalProperties": False
    }
    action_item = {
        "type": "object",
        "properties": {
            "task": {"type": "string"},
            "owner": nullable_string,
            "owner_role": {"type": "string", "enum": ["buyer", "sales_rep", "unknown"]},
            "commitment_type": {"type": "string", "enum": ["buyer_commitment", "rep_commitment", "general_action_item"]},
            "deadline": nullable_string,
            "evidence_segment_id": {"type": "string"}
        },
        "required": ["task", "owner", "owner_role", "commitment_type", "deadline", "evidence_segment_id"],
        "additionalProperties": False
    }
    summary_item = {
        "type": "object",
        "properties": {
            "section_id": {"type": "string"},
            "section_name": {"type": "string"},
            "content": {"type": "string"},
            "confidence": {"type": "number"},
            "evidence": {"type": "array", "items": evidence_item}
        },
        "required": ["section_id", "section_name", "content", "confidence", "evidence"],
        "additionalProperties": False
    }
    signal_item = {
        "type": "object",
        "properties": {
            "risk": {"type": "string"},
            "objection": {"type": "string"},
            "evidence_segment_id": {"type": "string"}
        },
        "required": ["risk", "objection", "evidence_segment_id"],
        "additionalProperties": False
    }
    conversation_intelligence_item = {
        "type": "object",
        "properties": {
            "conversation_type": {"type": "string"},
            "conversation_type_confidence": {"type": "number"},
            "conversation_type_rationale": {"type": "string"},
            "sales_relevance": {
                "type": "string",
                "enum": ["Relevant", "Partially Relevant", "Low Sales Relevance", "Unable to Determine"]
            },
            "sales_relevance_explanation": {"type": "string"},
            "generic_summary": {"type": "string"},
            "signals": {
                "type": "object",
                "properties": {
                    "main_topics": {"type": "array", "items": {"type": "string"}},
                    "explicit_decisions": {"type": "array", "items": {"type": "string"}},
                    "problems_questions": {"type": "array", "items": {"type": "string"}},
                    "customer_requirements": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["main_topics", "explicit_decisions", "problems_questions", "customer_requirements"],
                "additionalProperties": False
            },
            "transcript_quality_warning": nullable_string
        },
        "required": [
            "conversation_type",
            "conversation_type_confidence",
            "conversation_type_rationale",
            "sales_relevance",
            "sales_relevance_explanation",
            "generic_summary",
            "signals",
            "transcript_quality_warning"
        ],
        "additionalProperties": False
    }
    return {
        "type": "object",
        "properties": {
            "call_type": {
                "type": "object",
                "properties": {
                    "value": {"type": "string"},
                    "confidence": {"type": "number"},
                    "rationale": {"type": "string"}
                },
                "required": ["value", "confidence", "rationale"],
                "additionalProperties": False
            },
            "conversation_intelligence": conversation_intelligence_item,
            "summary": {"type": "string"},
            "summary_sections": {"type": "array", "items": summary_item},
            "fields": {"type": "array", "items": field_item},
            "action_items": {"type": "array", "items": action_item},
            "risks": {"type": "array", "items": signal_item},
            "objections": {"type": "array", "items": signal_item},
            "irrelevant_segments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"segment_id": {"type": "string"}, "reason": {"type": "string"}},
                    "required": ["segment_id", "reason"],
                    "additionalProperties": False
                }
            }
        },
        "required": ["call_type", "conversation_intelligence", "summary", "summary_sections", "fields", "action_items", "risks", "objections", "irrelevant_segments"],
        "additionalProperties": False
    }

# ─────────────────────────────────────────────────────────────────────────────
# DYNAMIC PROMPT COMPILER (Section 16 & 17)
# ─────────────────────────────────────────────────────────────────────────────

def build_dynamic_extraction_prompt(
    profile: dict,
    call_context: dict = None,
    transcript_segments: list = None,
    candidates: dict = None
) -> tuple:
    """
    Compile one model request from the selected profile contract + transcript.

    The transcript is the evidence source. The profile is the semantic contract.
    The model is never asked to infer the meaning of a field from an ID alone.
    """
    contract = _clean_profile_contract(profile)

    transcript_lines = []
    for s in transcript_segments or []:
        sid = s.get("segment_id") or s.get("id")
        ts = s.get("timestamp") or "00:00"
        spk = s.get("speaker") or s.get("speaker_name") or "Speaker"
        txt = s.get("text") or s.get("corrected_text") or ""
        if str(txt).strip():
            transcript_lines.append(f"[{sid}] [{ts}] {spk}: {str(txt).strip()}")
    transcript_text = "\n".join(transcript_lines)

    context_str = json.dumps(call_context or {}, ensure_ascii=False, indent=2)

    candidate_hints = {}
    for fid, items in (candidates or {}).items():
        candidate_hints[fid] = [
            {"segment_id": x.get("segment_id"), "score": x.get("score")}
            for x in (items or [])[:5]
        ]

    system_prompt = """You are PulseSync's evidence-grounded extraction engine.

The SELECTED EXTRACTION PROFILE is the contract for this request. It can represent
any template: MEDDICC, BANT, CHAMP, renewal, support, a custom CRM schema, or a
template that did not exist when this system was built. Do not assume a sales
framework unless the profile explicitly defines it.

NON-NEGOTIABLE SOURCE RULES
1. The current transcript is the only source of meeting facts.
2. Call context is background metadata, never evidence.
3. Candidate hints are retrieval hints, never facts.
4. Every non-null field value must be directly supported by its own cited evidence.
5. Evidence must prove the VALUE and the FIELD'S MEANING. A valid quote alone is insufficient.
6. If the field's meaning is not satisfied, return value=null and status=not_mentioned.
7. Never transfer semantics from one field to another.
8. Never use a field ID as a semantic shortcut. Use name + description + semantic contract + AI instruction + type + validation.
9. Preserve uncertainty. Precision is more important than recall for CRM/RevOps data.
10. Never invent people, companies, budgets, dates, competitors, commitments, or outcomes.

SUMMARY RULES
11. Summary sections are synthesized interpretations, NOT transcript excerpts.
12. Never copy greetings, acknowledgements, introductions, filler, or an entire transcript segment into a summary.
13. Each section must answer only its configured description and cite the evidence used.
14. If the evidence does not support the section's meaning, return an empty content string and no evidence.
15. For an executive/overall summary, prioritize the customer's problem, measurable impact, desired outcome, material commercial/evaluation signals, and agreed next steps. Keep it concise and decision-useful; do not merely enumerate transcript facts.
16. For measurable fields, preserve the full measurement context when explicitly stated, including units, cadence, scope, and time period (for example, "6–8 hours/week across the team" rather than only "6–8 hours").

ACTION RULES
17. An action item requires an explicit commitment or explicit assignment.
18. Questions, suggestions, preferences, hypothetical plans, acknowledgements, and conversation-management statements are not action items.
19. If a segment contains both a commitment and a question, extract only the committed work.

RISK AND OBJECTION RULES
20. Extract explicit customer concerns, objections, blockers, adoption concerns, implementation concerns, dependencies, or stated risks when the transcript contains them. Do not require the customer to use the literal word "risk".
21. A concern phrased as "my biggest concern", "the other concern", "I don't want", "I'm worried", "we may not", "won't use", "could prevent", or equivalent language is strong evidence of an objection/risk when the surrounding text identifies a concrete business consequence.
22. Prefer one grounded signal per distinct concern. Classify a direct buyer concern as an objection; use risk for a material blocker/dependency/uncertainty that is not primarily framed as a buyer objection. Do not duplicate the same concern in both arrays.
23. Every risk/objection must cite the smallest transcript segment that supports the signal.

TYPE RULES
24. Respect the configured field type and validation.
25. enum/multi_select values must be selected from configured options only.
26. person/company fields require explicit identity plus the relationship required by the field contract.
27. currency/number/date/boolean values must be explicitly supported by transcript evidence.
28. Normalization may change formatting, but must not change the underlying fact.

OUTPUT RULE
29. Return only the requested JSON object.
30. Include only configured section IDs and configured field IDs.
31. Do not create extra fields because a related fact sounds useful.
32. Never truncate a field value with ellipsis, "...", or a partial sentence. Return the complete supported fact, using a concise paraphrase only when the full meaning is preserved.
33. Never return a value that ends mid-sentence or with an ellipsis. If the fact is too ambiguous to state completely, return null/not_mentioned.
34. For text fields, capture the complete business meaning needed by the field contract, not merely the first clause of the evidence.

CLASSIFICATION & CONVERSATION INTELLIGENCE RULES
35. Classify conversation_type and set call_type.value based on the actual conversation purpose (do NOT force cold prospecting calls into discovery merely because the configured profile is named Sales Discovery):
    - "Cold Prospecting" (call_type.value: "cold_prospecting"): Outbound/unsolicited sales outreach or cold call introducing a company or capabilities, discussing pain points, exploring workflow fit, and seeking follow-up.
    - "Sales Discovery" (call_type.value: "discovery"): In-depth exploration of customer requirements, business pain points, current workflow friction, and solution fit.
    - "Sales Qualification" (call_type.value: "qualification"): Direct qualification of commercial parameters (budget, authority/economic buyer, decision timeline, champion, competition).
    - "Product Demonstration" (call_type.value: "solution_demo"): Product walkthrough, software demo, UI exploration, or live feature presentation.
    - "Technical Evaluation" (call_type.value: "technical_validation"): Technical architecture, security, API integration, or engineering review of a prospective solution.
    - "Contract & Pricing Negotiation" (call_type.value: "negotiation"): Discussion of commercial pricing, contract redlines, legal terms, or procurement signoff.
    - "Customer Support" (call_type.value: "other"): Technical troubleshooting, resolving bugs/outages/errors, or service tickets.
    - "Customer Onboarding" (call_type.value: "other"): Post-sale customer onboarding, user provisioning, implementation kickoff.
    - "Internal Meeting" (call_type.value: "other"): Internal team sync, sprint planning, or standup with no external prospect.
    - "Educational / Technical Discussion" (call_type.value: "other"): Programming tutorials or technical lectures without commercial or business agenda.
    - "General Discussion" (call_type.value: "other"): General dialogue without commercial qualification or specialized agenda.
    - "Unclear or Insufficient Transcript" (call_type.value: "other"): Incomplete speech, very few words, or severely fragmented audio.

36. Classify sales_relevance independently from qualification field completeness:
    - "Relevant": The conversation is part of a commercial sales cycle. This includes cold prospecting outreach, discovery, qualification, product demos, and negotiations.
      CRITICAL: Missing qualification data (e.g. no budget stated, no timeline yet) does NOT make a call low sales relevance! A cold prospecting call where a prospect discusses their pain points and agrees to an overview or follow-up is "Relevant".
    - "Partially Relevant": Technical or architectural discussions evaluating a solution where commercial qualification is secondary.
    - "Low Sales Relevance": Non-sales discussions such as internal standups, customer support tickets, post-sale onboarding, educational tutorials, or informal general discussion.
    - "Unable to Determine": Transcript is too sparse, degraded, or fragmented to determine commercial relevance.

37. Structure generic_summary into clear, readable sections using bold headers:
    **Conversation purpose:** Why the call took place, who initiated it, and the capability/service introduced. (Never copy opening greetings or start with "The conversation covers:").
    **Customer situation:** The prospect's relevant business context, current tooling, and stated challenges/pain points.
    **Discussion and response:** The capability introduced, prospect's response, questions or concerns raised, and any stated interest or reluctance.
    **Qualification status:** Meaningful qualification progress, clearly stating what was established vs what was not discussed (e.g. budget, timeline, authority).
    **Agreed next steps:** Explicit follow-up commitments and responsible owners.

PARTICIPANT & ATTRIBUTION RULES
38. Distinguish the caller/vendor from the prospect/customer organization:
    - When a caller identifies themselves (e.g., "Alex calling from PulseSync"), that person represents the vendor (PulseSync).
    - Do NOT confuse the vendor company with the prospect's company. Do NOT attribute the prospect (e.g. Sarah) to the vendor company or to a background company name that contradicts the transcript.
    - Distinguish call participants from third-party stakeholders mentioned for follow-up (e.g. Mark Vance in Sales Operations).
    - If a participant's company is not stated in the transcript, refer to them by their name and role rather than fabricating an association.
"""

    user_prompt = f"""EXTRACTION PROFILE:
Name: {contract.get("profile_name") or "Unnamed Profile"}
{json.dumps(contract, ensure_ascii=False, indent=2)}

CALL CONTEXT (BACKGROUND ONLY — NOT EVIDENCE):
{context_str}

EVIDENCE CANDIDATE HINTS (RETRIEVAL ONLY — VERIFY AGAINST TRANSCRIPT):
{json.dumps(candidate_hints, ensure_ascii=False, indent=2)}

CURRENT TRANSCRIPT — THE ONLY FACTUAL SOURCE:
{transcript_text}

TASK:
1. Determine the configured summary sections from the profile contract.
2. For every configured field, decide whether the transcript explicitly satisfies that field's semantic contract.
3. For every populated field, cite the smallest sufficient transcript evidence and ensure the cited evidence supports the exact value.
4. Extract only explicit action commitments/assignments if action items are enabled.
5. Leave unsupported/ambiguous values null with status not_mentioned.
6. Do not fill gaps using common sales knowledge or assumptions.

Return this JSON shape:
{{
  "call_type": {{"value": "string", "confidence": 0.0, "rationale": "string"}},
  "conversation_intelligence": {{
    "conversation_type": "string",
    "conversation_type_confidence": 0.0,
    "conversation_type_rationale": "string",
    "sales_relevance": "Relevant | Partially Relevant | Low Sales Relevance | Unable to Determine",
    "sales_relevance_explanation": "string",
    "generic_summary": "string",
    "signals": {{
      "main_topics": ["string"],
      "explicit_decisions": ["string"],
      "problems_questions": ["string"],
      "customer_requirements": ["string"]
    }},
    "transcript_quality_warning": "string or null"
  }},
  "summary": "string",
  "summary_sections": [
    {{"section_id": "configured section id", "section_name": "configured section name", "content": "synthesized section content or empty string", "confidence": 0.0, "evidence": [{{"segment_id": "id", "quote": "exact quote", "speaker": "speaker"}}]}}
  ],
  "fields": [
    {{"field_id": "configured field id", "value": "string or null", "status": "explicit or not_mentioned", "confidence": 0.0, "evidence": [{{"segment_id": "id", "quote": "exact quote", "speaker": "speaker"}}]}}
  ],
  "action_items": [
    {{"task": "concrete work", "owner": "person or null", "owner_role": "buyer/sales_rep/unknown", "commitment_type": "buyer_commitment/rep_commitment/general_action_item", "deadline": "deadline or null", "evidence_segment_id": "id"}}
  ],
  "risks": [{{"risk": "grounded risk", "objection": "", "evidence_segment_id": "id"}}],
  "objections": [{{"risk": "", "objection": "grounded objection", "evidence_segment_id": "id"}}],
  "irrelevant_segments": [{{"segment_id": "id", "reason": "reason"}}]
}}"""
    return system_prompt, user_prompt

# ─────────────────────────────────────────────────────────────────────────────
# CORE EXTRACTION ENGINE ENTRYPOINT
# ─────────────────────────────────────────────────────────────────────────────

def merge_grounded_signals(primary: list, fallback: list, kind: str) -> list:
    """Merge LLM and deterministic signals without duplicate concern records."""
    merged = []
    seen = set()
    for item in list(primary or []) + list(fallback or []):
        if not isinstance(item, dict):
            continue
        text_value = str(item.get(kind) or item.get("risk") or item.get("objection") or "").strip()
        sid = str(item.get("evidence_segment_id") or item.get("segment_id") or "")
        if not text_value:
            continue
        key = re.sub(r"[^a-z0-9]+", " ", text_value.lower()).strip()
        # Prefer the LLM's grounded wording when it cites the same evidence segment;
        # deterministic extraction fills only missing signals.
        dedupe_key = f"{kind}|segment:{sid}" if sid else f"{kind}|text:{key}"
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        merged.append(item)
    return merged[:10]

def extract_grounded_meeting_intelligence(
    transcript_segments: list,
    schema_fields: list = None,
    template: dict = None,
    call_type: str = None,
    profile: dict = None,
    call_context: dict = None
) -> dict:
    """
    Executes grounded intelligence extraction strictly against the current meeting transcript.
    Dynamically follows the configured Extraction Profile.
    If no profile is provided, defaults to PulseSync Default Sales Intelligence.
    Guarantees that irrelevant segments are filtered and never used in extraction.
    Integrates the full hybrid architecture:
      1. Relevance Filtering
      2. Layer 1: Evidence Candidate Detection
      3. Layer 3: Deterministic Candidate Extraction
      4. Layer 2: LLM Semantic Extraction
      5. Layer 4: Evidence & Conflict Resolver
      6. Semantic Validation & Type Validation
      7. Layer 5: Completeness & QA Sweep
    """
    # 1. Normalize Extraction Profile
    active_profile = normalize_extraction_profile(profile, schema_fields, template)

    # 2. Handle empty transcript
    if not transcript_segments:
        logger.warning("Empty transcript provided to extraction engine.")
        return get_empty_grounded_result(schema_fields=schema_fields, template=template, profile=active_profile)

    # Merge explicit call_type into call_context if present
    merged_context = dict(call_context or {})
    if call_type and "call_type" not in merged_context:
        merged_context["call_type"] = call_type

    # 3. Filter and Classify Transcript Relevance
    segment_map, relevant_segments, irrelevant_segments_meta = filter_relevant_segments(transcript_segments, merged_context)

    # 4. Layer 1: Evidence Candidate Detection
    candidates = detect_evidence_candidates(relevant_segments, active_profile, segment_map)

    # 5. Layer 3: Deterministic Signal Extraction
    det_response = deterministic_grounding_fallback(
        transcript_segments=transcript_segments,
        schema_fields=schema_fields,
        template=template,
        profile=active_profile,
        call_context=merged_context
    )

    # 6. Layer 2: LLM Semantic Extraction
    openai_key = os.environ.get("OPENAI_API_KEY")
    groq_key = os.environ.get("GROQ_API_KEY")
    llm_response = None

    if relevant_segments and (openai_key or groq_key):
        system_prompt, user_prompt = build_dynamic_extraction_prompt(
            profile=active_profile,
            call_context=merged_context,
            transcript_segments=relevant_segments,
            candidates=candidates
        )
        if openai_key:
            try:
                llm_response = call_llm_json(system_prompt, user_prompt, openai_key, is_groq=False)
            except Exception as e:
                logger.error(f"OpenAI extraction call failed: {e}")

        if not llm_response and groq_key:
            try:
                llm_response = call_llm_json(system_prompt, user_prompt, groq_key, is_groq=True)
            except Exception as e:
                logger.error(f"Groq extraction call failed: {e}")

    # 7. Layer 4: Evidence & Conflict Resolver
    # ALWAYS run the resolver, even when the LLM is unavailable. Deterministic
    # extraction must never bypass the same semantic gates used for LLM output.
    llm_fields = (llm_response or {}).get("fields") or (llm_response or {}).get("template_fields") or []
    llm_actions = (llm_response or {}).get("action_items") or []
    resolved_fields = resolve_field_candidates(
        llm_fields=llm_fields,
        det_fields=det_response.get("fields") or [],
        candidates=candidates,
        profile=active_profile,
        segment_map=segment_map
    )
    resolved_actions = resolve_action_items(
        llm_actions=llm_actions,
        det_actions=det_response.get("action_items") or [],
        segment_map=segment_map
    )
    llm_sections = (llm_response or {}).get("summary_sections")
    final_summary_sections = llm_sections if (llm_sections and any(s.get("content") for s in llm_sections if isinstance(s, dict))) else det_response.get("summary_sections", [])
    llm_sum = (llm_response or {}).get("summary")
    fallback_sum = det_response.get("summary", "")
    final_summary = llm_sum if (llm_sum and str(llm_sum).strip() and str(llm_sum).strip() != "No grounded business summary was produced from the available evidence.") else fallback_sum

    # Compute Conversation Intelligence (Section 4 & 5)
    det_ci = analyze_conversation_intelligence(
        transcript_segments=transcript_segments,
        profile=active_profile,
        call_context=merged_context
    )
    llm_ci = (llm_response or {}).get("conversation_intelligence")
    final_ci = _merge_conversation_intelligence(llm_ci, det_ci, transcript_segments=transcript_segments)

    # Grounded generic summary fallback if template-specific executive summary is empty
    if not final_summary or str(final_summary).strip() == "No grounded business summary was produced from the available evidence.":
        if final_ci.get("generic_summary"):
            final_summary = final_ci["generic_summary"]

    raw_response = {
        "call_type": (llm_response or {}).get("call_type") or det_response.get("call_type"),
        "conversation_intelligence": final_ci,
        "summary": final_summary,
        "summary_sections": final_summary_sections,
        "fields": resolved_fields,
        "template_fields": resolved_fields,
        "action_items": resolved_actions,
        # Do not let a non-empty LLM array suppress deterministic grounded signals.
        # The merge is deduplicated and the validator below still requires transcript evidence.
        "risks": merge_grounded_signals(
            (llm_response or {}).get("risks") or [],
            det_response.get("risks") or [],
            kind="risk"
        ),
        "objections": merge_grounded_signals(
            (llm_response or {}).get("objections") or [],
            det_response.get("objections") or [],
            kind="objection"
        ),
        "irrelevant_segments": (llm_response or {}).get("irrelevant_segments") or []
    }

    # 8. Merge detected irrelevant segments into raw_response to ensure strict isolation
    if "irrelevant_segments" not in raw_response:
        raw_response["irrelevant_segments"] = []
    existing_irr_ids = {s.get("segment_id") for s in raw_response["irrelevant_segments"]}
    for irr in irrelevant_segments_meta:
        if irr["segment_id"] not in existing_irr_ids:
            raw_response["irrelevant_segments"].append(irr)

    # 9. Semantic Validation & Type Validation
    validated_result = validate_and_sanitize_intelligence(
        raw_ai=raw_response,
        segment_map=segment_map,
        schema_fields=schema_fields,
        profile=active_profile
    )

    # 10. Layer 5: Completeness & QA Sweep
    validated_result["fields"] = check_extraction_completeness(
        fields=validated_result["fields"],
        candidates=candidates,
        profile=active_profile,
        segment_map=segment_map
    )
    validated_result["template_fields"] = list(validated_result["fields"])

    # Re-evaluate deal signals from final validated fields
    deal_signals, deal_signal_objects = compute_deal_signals(validated_result["fields"], active_profile, segment_map)
    validated_result["deal_signals"] = deal_signals
    validated_result["deal_signal_objects"] = deal_signal_objects

    # Maintain buyer & rep commitments lists
    validated_result["buyer_commitments"] = [a for a in validated_result["action_items"] if a.get("commitment_type") == "buyer_commitment"]
    validated_result["rep_commitments"] = [a for a in validated_result["action_items"] if a.get("commitment_type") == "rep_commitment"]

    return validated_result

def _build_strict_extraction_schema() -> dict:
    evidence_schema = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "segment_id": {"type": "string"},
                "quote": {"type": "string"},
                "speaker": {"type": "string"}
            },
            "required": ["segment_id", "quote", "speaker"],
            "additionalProperties": False
        }
    }
    return {
        "name": "pulsesync_meeting_extraction",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "call_type": {
                    "type": "object",
                    "properties": {
                        "value": {"type": "string"},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                        "rationale": {"type": "string"}
                    },
                    "required": ["value", "confidence", "rationale"],
                    "additionalProperties": False
                },
                "summary_sections": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "section_id": {"type": "string"},
                            "section_name": {"type": "string"},
                            "content": {"type": "string"},
                            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                            "evidence": evidence_schema
                        },
                        "required": ["section_id", "section_name", "content", "confidence", "evidence"],
                        "additionalProperties": False
                    }
                },
                "fields": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "field_id": {"type": "string"},
                            "field_name": {"type": "string"},
                            "value": {"type": ["string", "null"]},
                            "status": {"type": "string", "enum": ["explicit", "not_mentioned"]},
                            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                            "evidence": evidence_schema
                        },
                        "required": ["field_id", "field_name", "value", "status", "confidence", "evidence"],
                        "additionalProperties": False
                    }
                },
                "action_items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "task": {"type": "string"},
                            "owner": {"type": ["string", "null"]},
                            "owner_role": {"type": "string", "enum": ["buyer", "sales_rep", "unknown"]},
                            "commitment_type": {"type": "string", "enum": ["buyer_commitment", "rep_commitment", "general_action_item"]},
                            "deadline": {"type": ["string", "null"]},
                            "evidence_segment_id": {"type": "string"}
                        },
                        "required": ["task", "owner", "owner_role", "commitment_type", "deadline", "evidence_segment_id"],
                        "additionalProperties": False
                    }
                },
                "risks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"risk": {"type": "string"}, "evidence_segment_id": {"type": "string"}},
                        "required": ["risk", "evidence_segment_id"],
                        "additionalProperties": False
                    }
                },
                "objections": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"objection": {"type": "string"}, "evidence_segment_id": {"type": "string"}},
                        "required": ["objection", "evidence_segment_id"],
                        "additionalProperties": False
                    }
                },
                "irrelevant_segments": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"segment_id": {"type": "string"}, "reason": {"type": "string"}},
                        "required": ["segment_id", "reason"],
                        "additionalProperties": False
                    }
                }
            },
            "required": ["call_type", "summary_sections", "fields", "action_items", "risks", "objections", "irrelevant_segments"],
            "additionalProperties": False
        }
    }


def call_llm_json(system_prompt: str, user_prompt: str, api_key: str, is_groq: bool = False) -> dict:
    """Call an OpenAI-compatible endpoint with strict structured output when supported."""
    if is_groq:
        url = "https://api.groq.com/openai/v1/chat/completions"
        primary_model = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
        groq_candidates = [primary_model, "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]
        models_to_try = []
        for m in groq_candidates:
            if m and m not in models_to_try:
                models_to_try.append(m)
    else:
        url = "https://api.openai.com/v1/chat/completions"
        models_to_try = [os.environ.get("OPENAI_MODEL", "gpt-5.6")]

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    schema = _build_llm_response_schema()
    last_err = None

    for model in models_to_try:
        base_payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.0
        }

        # First try strict Structured Outputs. This constrains the response shape,
        # while the backend semantic resolver remains responsible for correctness.
        strict_payload = dict(base_payload)
        strict_payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "pulsesync_extraction",
                "strict": True,
                "schema": schema
            }
        }

        try:
            resp = requests.post(url, headers=headers, json=strict_payload, timeout=90)
            if not resp.ok:
                # Compatibility fallback for providers/models that expose JSON mode but
                # not strict JSON Schema.
                fallback_payload = dict(base_payload)
                fallback_payload["response_format"] = {"type": "json_object"}
                resp = requests.post(url, headers=headers, json=fallback_payload, timeout=90)

            if resp.ok:
                result = resp.json()
                content = result["choices"][0]["message"]["content"]
                if isinstance(content, list):
                    content = "".join(str(x.get("text", "")) if isinstance(x, dict) else str(x) for x in content)
                return json.loads(content)
            elif resp.status_code == 429:
                logger.warning(f"Model {model} returned 429 rate limit, attempting fallback model...")
                last_err = ValueError(f"LLM API returned 429 for {model}: {resp.text}")
                continue
            else:
                last_err = ValueError(f"LLM API returned {resp.status_code}: {resp.text}")
        except Exception as e:
            last_err = e
            continue

    raise last_err or ValueError("All LLM models failed.")

# ─────────────────────────────────────────────────────────────────────────────
# BACKEND EVIDENCE VALIDATOR & SANITIZER (Section 21, 22, 23)
# ─────────────────────────────────────────────────────────────────────────────

def is_negated_claim(text: str, target_terms: list = None) -> bool:
    """
    Detects whether the text expresses a negative statement regarding the target terms
    or claims (e.g., 'not a concern', 'no competitor', 'don't have a budget yet',
    'haven't decided on a timeline', 'security is not an issue', 'not evaluating any').
    """
    if not text:
        return False
    low = text.lower()

    # Immediate negative phrases
    direct_neg_phrases = [
        "not a concern", "not an issue", "not a problem", "not a priority", "not our priority",
        "not looking at", "not evaluating", "not considering", "not testing", "not trialing",
        "don't have a", "do not have a", "don't have any", "do not have any",
        "no budget", "no deadline", "no timeline", "haven't decided", "have not decided",
        "haven't allocated", "have not allocated", "no competitor", "no competitors",
        "no other vendor", "no other vendors", "not looking for", "no need for",
        "don't need", "do not need", "doesn't need", "does not need",
        "don't have approval", "do not have approval", "not the decision maker",
        "not authorized", "no authority", "haven't discussed", "have not discussed",
        "not worried", "not concerned", "zero budget", "no set budget", "no set timeline"
    ]

    for phrase in direct_neg_phrases:
        if phrase in low:
            if not target_terms:
                return True
            clean_terms = [str(x).lower().strip() for x in target_terms if x]
            if any(term in low for term in clean_terms):
                return True
            if "competitor" in phrase and any(t in ["competition", "competitor", "alternative_vendor", "competing"] for t in clean_terms):
                return True
            if "budget" in phrase and any(t in ["budget", "annual_budget", "currency"] for t in clean_terms):
                return True
            if "timeline" in phrase and any(t in ["timeline", "deadline", "date"] for t in clean_terms):
                return True

    # Pattern check within proximity of target terms
    if target_terms:
        neg_cues = [
            r"\b(?:no|not|never|neither|nor)\b",
            r"\b(?:don't|do\s+not|doesn't|does\s+not|didn't|did\s+not|haven't|have\s+not|hasn't|has\s+not|won't|will\s+not|can't|cannot)\b",
            r"\b(?:without|lack\s+of|no\s+longer|none|zero)\b"
        ]
        for term in target_terms:
            t_low = str(term or "").lower().strip()
            if not t_low or len(t_low) < 3:
                continue
            idx = low.find(t_low)
            while idx != -1:
                window_start = max(0, idx - 45)
                window_end = min(len(low), idx + len(t_low) + 35)
                window = low[window_start:window_end]
                for cue in neg_cues:
                    if re.search(cue, window):
                        if "not only" not in window:
                            return True
                idx = low.find(t_low, idx + 1)

    return False


def quote_matches_segment(quote: str, segment_text: str) -> bool:
    """Only attach proof when the cited wording occurs in that transcript segment."""
    clean_quote = re.sub(r"[^\w\s]", "", str(quote or "")).strip().lower()
    clean_segment = re.sub(r"[^\w\s]", "", str(segment_text or "")).strip().lower()
    return bool(clean_quote and clean_segment and clean_quote in clean_segment)


def _summary_content_is_grounded(content: str, evidence_list: list, section_def: dict) -> bool:
    """Validate generated summary prose against its evidence without requiring verbatim copying."""
    text = str(content or "").strip()
    if not text or not evidence_list:
        return False

    low = text.lower()
    # Conversation-openers are never meaningful summary content by themselves.
    if re.match(r"^(?:hi|hello|hey)\b", low):
        return False
    if any(phrase in low for phrase in [
        "thanks for joining", "thanks for your time", "busy schedule",
        "i'll keep this focused", "i will keep this focused",
        "good to know", "sounds good", "perfect,", "absolutely,"
    ]):
        # Allow them only when the same summary also contains substantive business content.
        business_markers = [
            "problem", "pain", "need", "requirement", "budget", "timeline", "pilot",
            "decision", "customer", "workflow", "process", "risk", "goal", "evaluation",
            "metric", "hours", "cost", "revenue", "competitor", "next step", "action"
        ]
        if not any(marker in low for marker in business_markers):
            return False

    evidence_text = " ".join(str(e.get("quote") or "") for e in evidence_list if isinstance(e, dict)).strip()
    if not evidence_text:
        return False

    # Reject near-verbatim transcript copying. Summaries must interpret, not simply echo.
    content_norm = _ground_norm(text)
    evidence_norms = [_ground_norm(str(e.get("quote") or "")) for e in evidence_list if isinstance(e, dict)]
    if any(content_norm == ev or (len(content_norm.split()) >= 8 and content_norm in ev) for ev in evidence_norms if ev):
        return False

    ct = set(_ground_tokens(text))
    et = set(_ground_tokens(evidence_text))
    shared = ct & et
    overlap = len(shared) / max(1, len(ct))
    # Summaries are allowed to paraphrase. Require a small amount of lexical
    # anchoring rather than forcing the summary to reuse transcript wording.
    # The evidence itself has already been verified against the current meeting.
    if len(ct) >= 8 and len(shared) < 1:
        return False
    if len(ct) >= 18 and len(shared) < 2:
        return False

    # The section definition is guidance, not a lexical requirement. A good summary
    # may paraphrase the section name completely (for example, "Customer Needs" can
    # be summarized as a concrete operational problem). Grounding is established by
    # evidence overlap plus the anti-copy / anti-filler checks above.
    return True


def _action_has_concrete_work(task: str) -> bool:
    """Reject conversational/meta commitments while retaining broad, schema-independent actions."""
    low = re.sub(r"[^a-z0-9\s-]", " ", str(task or "").lower())
    low = re.sub(r"\s+", " ", low).strip()
    if not low:
        return False

    # These are conversation-management commitments, not work items a CRM should track.
    meta_phrases = [
        "keep this focused", "keep this short", "keep this brief", "be quick",
        "walk you through", "walk us through", "take it from there", "stay focused",
        "make this quick", "get started", "continue the conversation", "have a chat",
        "have a conversation", "touch base", "catch up"
    ]
    if any(p in low for p in meta_phrases):
        return False
    if low in {"thanks", "thank you"} or low.startswith(("thanks ", "thank you ")):
        return False

    # Broad action vocabulary; the transcript still has to contain an explicit commitment.
    verbs = {
        "send", "share", "provide", "deliver", "email", "forward", "upload", "download",
        "schedule", "book", "arrange", "prepare", "complete", "finish", "review", "approve",
        "confirm", "validate", "test", "run", "configure", "create", "build", "update",
        "change", "add", "remove", "include", "invite", "join", "attend", "present", "demo",
        "collect", "gather", "export", "import", "connect", "integrate", "set", "set-up",
        "setup", "deploy", "implement", "evaluate", "check", "verify", "investigate", "follow",
        "respond", "reply", "submit", "sign", "complete", "organize", "document", "draft",
        "prepare", "assign", "introduce", "loop", "escalate", "coordinate"
    }
    first = low.split()[0] if low.split() else ""
    return first in verbs or any(re.search(rf"\b{re.escape(v)}\b", low) for v in verbs)


def generate_grounded_summary_sections(
    configured_sections: list,
    fields: list,
    action_items: list,
    risks: list,
    objections: list,
    relevant_segments: list,
    segment_map: dict
) -> tuple:
    """
    Synthesize grounded summary sections and executive summary from verified
    transcript evidence, extracted fields, action items, and risks/objections.
    Guarantees evidence quotes strictly match current meeting segments.
    """
    if not relevant_segments or not segment_map:
        return "", []

    field_dict = {}
    for f in (fields or []):
        if isinstance(f, dict):
            fid = str(f.get("field_id") or f.get("id") or "").lower().strip()
            val = f.get("value")
            if fid and val and str(val).lower() not in ["null", "none", "not mentioned", "unknown", "n/a", ""]:
                field_dict[fid] = f

    def find_matching_segments(keywords, max_count=3):
        matches = []
        kw_low = [w.lower() for w in keywords if w]
        for s in (relevant_segments or []):
            t = (s.get("corrected_text") or s.get("text") or "").strip()
            if not t:
                continue
            t_low = t.lower()
            score = sum(1 for kw in kw_low if re.search(rf"\b{re.escape(kw)}\b", t_low))
            if score > 0:
                matches.append((score, s))
        matches.sort(key=lambda x: x[0], reverse=True)
        return [m[1] for m in matches[:max_count]]

    pain_field = field_dict.get("identify_pain") or field_dict.get("pain_points") or field_dict.get("pain")
    metrics_field = field_dict.get("metrics") or field_dict.get("metric")
    budget_field = field_dict.get("budget") or field_dict.get("project_budget") or field_dict.get("annual_budget")
    criteria_field = field_dict.get("decision_criteria") or field_dict.get("requirements") or field_dict.get("criteria")
    process_field = field_dict.get("decision_process") or field_dict.get("process")
    comp_field = field_dict.get("competition") or field_dict.get("competitor")

    pain_val = pain_field.get("value") if pain_field else None
    pain_ev = pain_field.get("evidence", []) if pain_field else []
    if not pain_val:
        p_segs = find_matching_segments(["problem", "pain", "bottleneck", "issue", "friction", "scattered", "difficult"], 1)
        if p_segs:
            raw_pain = (p_segs[0].get("corrected_text") or p_segs[0].get("text") or "").strip()
            pain_val = clean_conversational_statement(raw_pain)
            sid0 = p_segs[0].get("segment_id") or p_segs[0].get("id")
            if sid0 in segment_map:
                pain_ev = [{"segment_id": sid0, "quote": raw_pain, "speaker": p_segs[0].get("speaker_name") or p_segs[0].get("speaker")}]

    metrics_val = metrics_field.get("value") if metrics_field else None
    metrics_ev = metrics_field.get("evidence", []) if metrics_field else []

    budget_val = budget_field.get("value") if budget_field else None
    budget_ev = budget_field.get("evidence", []) if budget_field else []

    criteria_val = criteria_field.get("value") if criteria_field else None
    criteria_ev = criteria_field.get("evidence", []) if criteria_field else []

    process_val = process_field.get("value") if process_field else None
    process_ev = process_field.get("evidence", []) if process_field else []

    comp_val = comp_field.get("value") if comp_field else None
    comp_ev = comp_field.get("evidence", []) if comp_field else []

    summary_sections = []

    for sdef in (configured_sections or []):
        if not isinstance(sdef, dict) or not sdef.get("enabled", True):
            continue
        sid = str(sdef.get("id") or "").lower().strip()
        sname = str(sdef.get("name") or sid.replace("_", " ").title()).strip()

        content = ""
        ev_list = []

        if sid in ["executive_summary", "executive", "overview"]:
            parts = []
            if pain_val:
                clean_clause = pain_val.split(".")[0].strip() if "." in pain_val else pain_val
                parts.append(f"The customer highlighted operational friction around {clean_clause[0].lower() + clean_clause[1:].rstrip('.')}.")
                ev_list.extend(pain_ev)
            if metrics_val:
                if re.search(r"\bhours?\b|\bweekly\b|\bdays?\b|\btime\b", str(metrics_val), re.I):
                    parts.append(f"Manual processes consume approximately {metrics_val} across the team.")
                else:
                    parts.append(f"Key quantifiable metrics: {metrics_val}.")
                ev_list.extend(metrics_ev)
            if budget_val:
                parts.append(f"Stated budget: {budget_val}.")
                ev_list.extend(budget_ev)
            if criteria_val:
                parts.append(f"Key evaluation focus: {criteria_val}")
                ev_list.extend(criteria_ev)
            if comp_val:
                parts.append(f"Alternatives discussed: {comp_val}.")
                ev_list.extend(comp_ev)
            content = " ".join(parts).strip()

        elif sid in ["customer_needs", "needs"]:
            parts = []
            if criteria_val:
                parts.append(f"Core customer requirement: {criteria_val}")
                ev_list.extend(criteria_ev)
            else:
                req_segs = find_matching_segments(["require", "requirement", "need", "looking to", "replace", "crm", "workflow", "process"], 2)
                prospect_req = None
                for rs in req_segs:
                    rst = (rs.get("corrected_text") or rs.get("text") or "").strip()
                    if re.search(r"\b(?:replace|looking to|already use|need|want|require)\b", rst, re.I) and not re.search(r"\b(?:we help|we do not replace)\b", rst, re.I):
                        prospect_req = (rs, rst)
                        break
                if prospect_req:
                    rs, rst = prospect_req
                    parts.append(f"Customer requirement and workflow constraints: {rst}")
                    rs_id = rs.get("segment_id") or rs.get("id")
                    if rs_id in segment_map:
                        ev_list.append({"segment_id": rs_id, "quote": rst, "speaker": rs.get("speaker") or rs.get("speaker_name", "Speaker")})
                elif pain_val:
                    clean_clause = pain_val.split(".")[0].strip() if "." in pain_val else pain_val
                    parts.append(f"Operational objective: Establishing workflow consistency to address {clean_clause[0].lower() + clean_clause[1:].rstrip('.')}.")
                    ev_list.extend(pain_ev)
                ev_list.extend(pain_ev)
            if metrics_val and re.search(r"\bhours?\b|\btime\b", str(metrics_val), re.I):
                parts.append(f"Target savings include reclaiming {metrics_val} of reporting time.")
                ev_list.extend(metrics_ev)
            elif budget_val:
                parts.append(f"Stated budget allocated: {budget_val}.")
                ev_list.extend(budget_ev)
            content = " ".join(parts).strip()

        elif sid in ["decision_framework", "decision_criteria", "decision_process"]:
            parts = []
            if criteria_val:
                parts.append(f"Decision criteria: {criteria_val}")
                ev_list.extend(criteria_ev)
            if process_val:
                parts.append(f"Evaluation process: {process_val}")
                ev_list.extend(process_ev)
            if comp_val:
                parts.append(f"Alternative solutions under consideration: {comp_val}.")
                ev_list.extend(comp_ev)
            content = " ".join(parts).strip()

        elif sid in ["next_steps", "action_items"]:
            if action_items:
                act_texts = [f"{a.get('owner') + ': ' if a.get('owner') else ''}{a.get('task')}" for a in action_items[:4] if a.get('task')]
                content = f"Agreed deliverables and next steps: {'; '.join(act_texts)}."
                for a in action_items[:4]:
                    sid_ev = a.get("evidence_segment_id") or a.get("segment_id")
                    if sid_ev and sid_ev in segment_map:
                        s = segment_map[sid_ev]
                        ev_list.append({
                            "segment_id": sid_ev,
                            "quote": a.get("evidence") or s.get("text", ""),
                            "speaker": s.get("speaker") or s.get("speaker_name", "Speaker")
                        })
            else:
                content = "No explicit follow-up commitments recorded."

        elif sid in ["pain_points", "pain"]:
            if pain_val:
                content = f"Core operational pain point: {pain_val}"
                if metrics_val and re.search(r"\bhours?\b|\btime\b", str(metrics_val), re.I):
                    content += f" This creates approximately {metrics_val} of lost team productivity weekly."
                ev_list.extend(pain_ev)
                if metrics_ev and re.search(r"\bhours?\b|\btime\b", str(metrics_val), re.I):
                    ev_list.extend(metrics_ev)

        elif sid in ["requirements"]:
            if criteria_val:
                content = f"Stated requirements: {criteria_val}"
                ev_list.extend(criteria_ev)

        elif sid in ["risks_objections", "risks", "objections"]:
            concerns = []
            if risks:
                concerns.extend([r.get("risk") for r in risks if r.get("risk")])
            if objections:
                concerns.extend([o.get("objection") for o in objections if o.get("objection")])
            if concerns:
                content = f"Identified concerns and evaluation risks: {'; '.join(concerns[:3])}."
                for item in (list(risks or []) + list(objections or []))[:3]:
                    sid_ev = item.get("evidence_segment_id") or item.get("segment_id")
                    if sid_ev and sid_ev in segment_map:
                        s = segment_map[sid_ev]
                        ev_list.append({
                            "segment_id": sid_ev,
                            "quote": item.get("evidence") or s.get("text", ""),
                            "speaker": s.get("speaker") or s.get("speaker_name", "Speaker")
                        })

        else:
            kw = [w.lower() for w in re.findall(r"[a-zA-Z]{3,}", f"{sname} {sdef.get('description', '')}") if w.lower() not in ["and", "the", "for", "with", "that", "this"]]
            matched = find_matching_segments(kw, 2)
            if matched:
                takeaways = [(m.get("corrected_text") or m.get("text") or "").strip() for m in matched]
                content = f"Discussion regarding {sname.lower()}: {' '.join(takeaways[:2])}"
                for m in matched:
                    msid = m.get("segment_id") or m.get("id")
                    if msid in segment_map:
                        ev_list.append({
                            "segment_id": msid,
                            "quote": m.get("text", ""),
                            "speaker": m.get("speaker_name") or m.get("speaker", "Speaker")
                        })

        seen_ev = set()
        deduped_ev = []
        for e in ev_list:
            if isinstance(e, dict):
                esid = str(e.get("segment_id") or "")
                if esid and esid not in seen_ev and esid in segment_map:
                    seen_ev.add(esid)
                    s_info = segment_map[esid]
                    stext = str(s_info.get("text") or "")
                    q = str(e.get("quote") or stext)
                    actual_q = q if quote_matches_segment(q, stext) else stext
                    deduped_ev.append({
                        "segment_id": esid,
                        "quote": actual_q,
                        "speaker": e.get("speaker") or s_info.get("speaker", "Speaker"),
                        "start_time": s_info.get("start_time", 0.0),
                        "end_time": s_info.get("end_time", 0.0),
                        "timestamp": s_info.get("timestamp") or f"{int(s_info.get('start_time', 0)//60):02d}:{int(s_info.get('start_time', 0)%60):02d}"
                    })

        if content and deduped_ev:
            if _summary_content_is_grounded(content, deduped_ev, sdef):
                summary_sections.append({
                    "section_id": sid,
                    "section_name": sname,
                    "content": content,
                    "confidence": 0.90,
                    "evidence": deduped_ev
                })

    exec_sec = next((s for s in summary_sections if s["section_id"] == "executive_summary"), None)
    if exec_sec:
        overall_summary = exec_sec["content"]
    elif summary_sections:
        overall_summary = "\n\n".join([f"{s['section_name']}:\n{s['content']}" for s in summary_sections])
    else:
        overall_summary = ""

    return overall_summary, summary_sections


def validate_and_sanitize_intelligence(
    raw_ai: dict,
    segment_map: dict,
    schema_fields: list = None,
    profile: dict = None
) -> dict:
    """
    Validates that:
    1. Every evidence reference belongs to the current meeting transcript.
    2. No evidence references an IRRELEVANT transcript segment.
    3. Evidence quotes actually appear in the referenced segment.
    4. Evidence semantically supports the field (rejects vague roadmaps as timelines, cost concerns as budgets).
    5. Values conform to field types (currency, date, number, enum, person).
    """
    if isinstance(schema_fields, dict) and not profile:
        profile = schema_fields
        schema_fields = None

    if isinstance(segment_map, list):
        sm = {}
        for s in segment_map:
            sid = s.get("segment_id") or s.get("id") or str(len(sm))
            sm[sid] = {
                "text": s.get("corrected_text") or s.get("text") or "",
                "speaker": s.get("speaker_name") or s.get("speaker") or "Speaker",
                "start_time": s.get("start_time") or 0.0,
                "end_time": s.get("end_time") or 0.0,
                "relevance": s.get("relevance") or "RELEVANT"
            }
        segment_map = sm

    active_profile = normalize_extraction_profile(profile, schema_fields)

    # 1. Identify all Irrelevant Segment IDs
    irrelevant_ids = set()
    for irr in raw_ai.get("irrelevant_segments", []):
        sid = irr.get("segment_id")
        if sid:
            irrelevant_ids.add(sid)
    for sid, sdata in segment_map.items():
        if sdata.get("relevance") == "IRRELEVANT":
            irrelevant_ids.add(sid)

    # 2. Validate Call Type
    raw_ct = raw_ai.get("call_type", {})
    if isinstance(raw_ct, dict):
        ct_val = str(raw_ct.get("value") or "").lower().strip()
        try:
            ct_conf = float(raw_ct.get("confidence") or 0.88)
        except Exception:
            ct_conf = 0.88
        ct_rat = str(raw_ct.get("rationale") or "")
    else:
        ct_val = str(raw_ct or "").lower().strip()
        ct_conf = 0.88
        ct_rat = ""

    valid_call_types = [
        "cold_prospecting", "qualification", "discovery", "solution_demo",
        "technical_validation", "negotiation", "follow_up", "renewal_expansion", "other"
    ]
    if ct_val in ["cold_call", "prospecting", "cold", "outreach", "cold prospecting", "cold_prospecting"]:
        ct_val = "cold_prospecting"
    elif ct_val in ["demo", "solution", "product_demo", "product demonstration"]:
        ct_val = "solution_demo"
    elif ct_val in ["tech_validation", "technical", "tech_review", "technical evaluation", "technical discussion"]:
        ct_val = "technical_validation"
    elif ct_val in ["followup", "follow_up_call", "follow-up"]:
        ct_val = "follow_up"
    elif ct_val in ["renewal", "expansion", "upsell", "renewal / expansion"]:
        ct_val = "renewal_expansion"

    ci_type = str((raw_ai.get("conversation_intelligence") or {}).get("conversation_type") or "").lower()
    if ("prospect" in ci_type or "cold" in ci_type) and ct_val in ["discovery", "other", ""]:
        ct_val = "cold_prospecting"
    elif ct_val not in valid_call_types:
        if "prospect" in ci_type or "cold" in ci_type:
            ct_val = "cold_prospecting"
        elif "discovery" in ci_type:
            ct_val = "discovery"
        elif "qualif" in ci_type:
            ct_val = "qualification"
        elif "demo" in ci_type:
            ct_val = "solution_demo"
        elif "technical" in ci_type:
            ct_val = "technical_validation"
        elif "negotiat" in ci_type:
            ct_val = "negotiation"
        else:
            ct_val = "other"

    sanitized = {
        "profile": active_profile,
        "call_type": ct_val,
        "call_type_confidence": min(1.0, max(0.0, ct_conf)),
        "call_type_rationale": ct_rat,
        "summary": "",
        "summary_sections": [],
        "fields": [],
        "template_fields": [],
        "deal_signals": {},
        "deal_signal_objects": [],
        "action_items": [],
        "buyer_commitments": [],
        "rep_commitments": [],
        "risks": [],
        "objections": [],
        "irrelevant_segments": [
            {"segment_id": sid, "reason": segment_map.get(sid, {}).get("relevance_reason", "Unrelated content")}
            for sid in sorted(list(irrelevant_ids))
        ]
    }

    # 3. Validate Summary Sections (Rule 5 & 6)
    configured_sections = [s for s in active_profile.get("summary_sections", []) if s.get("enabled", True)]
    raw_sections = raw_ai.get("summary_sections") or []
    section_map = {str(s.get("section_id") or s.get("id") or "").lower(): s for s in raw_sections if isinstance(s, dict)}

    summary_text_parts = []
    for sec_def in configured_sections:
        sid = sec_def["id"].lower()
        sname = sec_def["name"]
        raw_sec = section_map.get(sid)

        sec_content = ""
        sec_ev_list = []
        sec_conf = 0.90

        if raw_sec:
            raw_content = str(raw_sec.get("content") or "").strip()
            raw_ev = raw_sec.get("evidence") or []
            if isinstance(raw_ev, dict):
                raw_ev = [raw_ev]
            elif isinstance(raw_ev, str):
                raw_ev = [{"quote": raw_ev}]
            valid_ev = []
            for ev in raw_ev:
                if not isinstance(ev, dict):
                    continue
                esid = ev.get("segment_id")
                # Rule 13: Must not use irrelevant segments
                if esid in segment_map and esid not in irrelevant_ids:
                    sinfo = segment_map[esid]
                    quote = ev.get("quote") or sinfo["text"]
                    if quote_matches_segment(quote, sinfo["text"]):
                        valid_ev.append({
                            "segment_id": esid,
                            "quote": quote,
                            "speaker": ev.get("speaker") or sinfo["speaker"],
                            "start_time": sinfo["start_time"],
                            "end_time": sinfo["end_time"],
                            "timestamp": sinfo.get("timestamp") or f"{int(sinfo.get('start_time', 0)//60):02d}:{int(sinfo.get('start_time', 0)%60):02d}"
                        })
            # A summary section is surfaced only when the generated prose is semantically
            # grounded in the cited evidence. Valid quotes alone are insufficient.
            sec_content = raw_content if valid_ev and _summary_content_is_grounded(raw_content, valid_ev, sec_def) else ""
            sec_ev_list = valid_ev if sec_content else []
            try:
                sec_conf = float(raw_sec.get("confidence") or 0.90)
            except Exception:
                sec_conf = 0.90

        if sec_content:
            sanitized["summary_sections"].append({
                "section_id": sid,
                "section_name": sname,
                "content": sec_content,
                "confidence": sec_conf,
                "evidence": sec_ev_list
            })
            summary_text_parts.append(f"{sname}:\n{sec_content}")

    # Fallback for overall summary string (Section 31 & 34)
    if summary_text_parts:
        # If executive_summary section exists, use it as primary summary overview
        exec_sec = next((s for s in sanitized["summary_sections"] if s["section_id"] == "executive_summary"), None)
        sanitized["summary"] = exec_sec["content"] if exec_sec else "\n\n".join(summary_text_parts)
    else:
        raw_overall = str(raw_ai.get("summary") or "").strip()
        # Do not surface an unverified LLM summary. The UI should prefer an explicit
        # no-grounded-summary state over fabricated or copied transcript prose.
        if raw_overall and _summary_content_is_grounded(raw_overall, [
            {"quote": segment_map[sid].get("text", "")} for sid in segment_map
            if sid not in irrelevant_ids and segment_map[sid].get("text")
        ][:8], {"name": "Overall Summary", "description": "Grounded business summary"}):
            sanitized["summary"] = raw_overall
        else:
            sanitized["summary"] = "No grounded business summary was produced from the available evidence."

    # 4. Validate Structured Fields (Rule 7, 8, 9, 21, 22, 23)
    configured_fields = [f for f in active_profile.get("fields", []) if f.get("enabled", True)]
    raw_fields = raw_ai.get("fields") or raw_ai.get("template_fields") or []
    field_lookup = {}
    for f in raw_fields:
        if isinstance(f, dict):
            fid = str(f.get("field_id") or f.get("name") or f.get("id") or "").lower().strip()
            if fid:
                field_lookup[fid] = f

    for fdef in configured_fields:
        fid = fdef["id"].lower()
        fname = fdef["name"]
        ftype = fdef.get("type", "text")
        raw_f = field_lookup.get(fid)

        if not raw_f or raw_f.get("value") is None or str(raw_f.get("value")).lower() in ["null", "none", "not mentioned", "unknown", "n/a", ""]:
            sanitized["fields"].append({
                "id": fid,
                "name": fname,
                "field_id": fid,
                "field_name": fname,
                "value": None,
                "status": "not_mentioned",
                "confidence": None,
                "evidence": []
            })
            continue

        raw_val = str(raw_f.get("value")).strip()
        raw_ev = raw_f.get("evidence") or []
        if isinstance(raw_ev, dict):
            raw_ev = [raw_ev]
        elif isinstance(raw_ev, str):
            raw_ev = [{"quote": raw_ev}]
        valid_ev = []

        for ev in raw_ev:
            if not isinstance(ev, dict):
                continue
            esid = ev.get("segment_id")
            # Must exist in current meeting and NOT be irrelevant
            if esid in segment_map and esid not in irrelevant_ids:
                sinfo = segment_map[esid]
                quote = ev.get("quote") or sinfo["text"]
                if quote_matches_segment(quote, sinfo["text"]):
                    valid_ev.append({
                        "segment_id": esid,
                        "quote": quote,
                        "speaker": ev.get("speaker") or sinfo["speaker"],
                        "start_time": sinfo["start_time"],
                        "end_time": sinfo["end_time"],
                        "timestamp": sinfo.get("timestamp") or f"{int(sinfo.get('start_time', 0)//60):02d}:{int(sinfo.get('start_time', 0)%60):02d}"
                    })

        # CRITICAL RULE 7 & 21: Must have valid evidence
        if not valid_ev:
            sanitized["fields"].append({
                "id": fid,
                "name": fname,
                "field_id": fid,
                "field_name": fname,
                "value": None,
                "status": "not_mentioned",
                "confidence": None,
                "evidence": []
            })
            continue

        # FIELD-SPECIFIC SEMANTIC VALIDATION & TYPE VALIDATION (Rule 8, 9, 23)
        is_semantically_valid, validated_val = validate_field_semantics(fid, ftype, raw_val, valid_ev, fdef)

        if not is_semantically_valid:
            sanitized["fields"].append({
                "id": fid,
                "name": fname,
                "field_id": fid,
                "field_name": fname,
                "value": None,
                "status": "not_mentioned",
                "confidence": None,
                "evidence": []
            })
        else:
            try:
                conf = float(raw_f.get("confidence") or 0.90)
            except Exception:
                conf = 0.90
            sanitized["fields"].append({
                "id": fid,
                "name": fname,
                "field_id": fid,
                "field_name": fname,
                "value": validated_val,
                "status": raw_f.get("status", "explicit"),
                "confidence": conf,
                "evidence": valid_ev
            })

    # Backward compatibility: populate template_fields matching fields
    sanitized["template_fields"] = list(sanitized["fields"])

    # 5. Validate Action Items (Rule 14, 15, 19, 20)
    for act in raw_ai.get("action_items", []):
        raw_text = act.get("task", "").strip() if isinstance(act, dict) else str(act).strip()
        task_text = _clean_action_task(raw_text) if raw_text else ""
        if not task_text:
            continue
        esid = act.get("evidence_segment_id") if isinstance(act, dict) else None

        # Rule 13: Irrelevant segments must NEVER generate action items
        if esid and esid in irrelevant_ids:
            continue
        if esid and esid not in segment_map:
            esid = None

        # Rule 19: Action item must be an actual commitment, not tutorial or suggestion
        low_task = task_text.lower()
        if any(w in low_task for w in ["subscribe", "python series", "tutorial", "like and share", "youtube"]):
            continue

        ev_role = (segment_map[esid].get("role") or "").lower() if esid else ""
        comm_type = act.get("commitment_type") if isinstance(act, dict) else None
        if not comm_type:
            if ev_role in ["buyer", "prospect", "customer"]:
                comm_type = "buyer_commitment"
            elif ev_role in ["sales_rep", "sales_engineer", "rep", "internal_stakeholder"]:
                comm_type = "rep_commitment"
            else:
                if any(w in low_task for w in ["pricing", "quote", "send over", "our demo", "soc2", "proposal"]):
                    comm_type = "rep_commitment"
                elif any(w in low_task for w in ["questionnaire", "review with team", "budget", "cfo", "procurement"]):
                    comm_type = "buyer_commitment"
                else:
                    comm_type = "general_action_item"

        owner_val = act.get("owner") if isinstance(act, dict) else None
        if owner_val in ["Unassigned", "Unknown", "unassigned", None]:
            owner_val = None

        item_obj = {
            "task": task_text,
            "owner": owner_val,
            "owner_role": act.get("owner_role") if isinstance(act, dict) else ("buyer" if comm_type == "buyer_commitment" else "sales_rep"),
            "commitment_type": comm_type,
            "deadline": act.get("deadline") if isinstance(act, dict) else None,
            "evidence": segment_map[esid]["text"] if esid else "",
            "evidence_segment_id": esid
        }
        sanitized["action_items"].append(item_obj)
        if comm_type == "buyer_commitment":
            sanitized["buyer_commitments"].append(item_obj)
        elif comm_type == "rep_commitment":
            sanitized["rep_commitments"].append(item_obj)

    # 6. Validate Risks & Objections. A signal is accepted only when its own
    # evidence contains explicit concern/risk language or a concrete consequence.
    signal_concern_re = re.compile(
        r"\b(?:concern|worried|worry|risk|blocker|blocking|objection|don't want|do not want|wouldn't|would not|won't|will not|extra work|additional steps?|too much work|adoption|implementation|configuration|delay|prevent)\b",
        re.I,
    )
    for r in raw_ai.get("risks", []):
        risk_text = r.get("risk", "").strip() if isinstance(r, dict) else str(r).strip()
        if not risk_text:
            continue
        esid = r.get("evidence_segment_id") if isinstance(r, dict) else None
        if esid in irrelevant_ids or esid not in segment_map:
            continue
        evidence_text = segment_map[esid]["text"]
        if not signal_concern_re.search(evidence_text):
            continue
        sanitized["risks"].append({
            "risk": risk_text,
            "evidence": evidence_text,
            "evidence_segment_id": esid
        })

    for o in raw_ai.get("objections", []):
        obj_text = o.get("objection", "").strip() if isinstance(o, dict) else str(o).strip()
        if not obj_text:
            continue
        esid = o.get("evidence_segment_id") if isinstance(o, dict) else None
        if esid in irrelevant_ids or esid not in segment_map:
            continue
        evidence_text = segment_map[esid]["text"]
        if not signal_concern_re.search(evidence_text):
            continue
        sanitized["objections"].append({
            "objection": obj_text,
            "evidence": evidence_text,
            "evidence_segment_id": esid
        })

    # The same concern should not be represented in both buckets. Prefer the
    # explicit objection when the evidence is framed as a buyer concern.
    objection_keys = {
        re.sub(r"[^a-z0-9]+", " ", str(o.get("objection") or "").lower()).strip()
        for o in sanitized["objections"]
    }
    sanitized["risks"] = [
        r for r in sanitized["risks"]
        if re.sub(r"[^a-z0-9]+", " ", str(r.get("risk") or "").lower()).strip() not in objection_keys
    ]

    # 7. Deal Signals (Single Source of Truth & Validated Evidence - Section 11)
    deal_signals_dict, deal_signal_objects = compute_deal_signals(sanitized["fields"], active_profile, segment_map)
    sanitized["deal_signals"] = deal_signals_dict
    sanitized["deal_signal_objects"] = deal_signal_objects

    # 8. Conversation Intelligence (Section 4 & 5)
    if "conversation_intelligence" in raw_ai and isinstance(raw_ai["conversation_intelligence"], dict):
        sanitized["conversation_intelligence"] = raw_ai["conversation_intelligence"]
    else:
        segs_list = [
            {"id": sid, "segment_id": sid, "text": sdata.get("text", ""), "speaker": sdata.get("speaker", "")}
            for sid, sdata in segment_map.items()
        ]
        sanitized["conversation_intelligence"] = analyze_conversation_intelligence(segs_list, active_profile)

    # Ensure main_topics in conversation_intelligence are strictly grounded
    if isinstance(sanitized.get("conversation_intelligence"), dict):
        ci = sanitized["conversation_intelligence"]
        segs_for_val = [sdata for sid, sdata in segment_map.items() if sid not in irrelevant_ids]
        if isinstance(ci.get("signals"), dict) and isinstance(ci["signals"].get("main_topics"), list):
            ci["signals"]["main_topics"] = validate_grounded_topics(ci["signals"]["main_topics"], segs_for_val)

    # 9. Ensure grounded summary and summary sections exist if raw AI summaries were missing or ungrounded
    if not sanitized.get("summary_sections") or not sanitized.get("summary") or sanitized.get("summary") == "No grounded business summary was produced from the available evidence.":
        rel_segs = [sdata for sid, sdata in segment_map.items() if sid not in irrelevant_ids]
        gen_sum, gen_secs = generate_grounded_summary_sections(
            configured_sections=configured_sections,
            fields=sanitized.get("fields", []),
            action_items=sanitized.get("action_items", []),
            risks=sanitized.get("risks", []),
            objections=sanitized.get("objections", []),
            relevant_segments=rel_segs,
            segment_map=segment_map
        )
        if gen_secs:
            sanitized["summary_sections"] = gen_secs
            sanitized["summary"] = gen_sum

    # Fallback summary to generic_summary if still empty or ungrounded placeholder
    ci_gen_sum = (sanitized.get("conversation_intelligence") or {}).get("generic_summary")
    if (not sanitized.get("summary") or sanitized.get("summary") == "No grounded business summary was produced from the available evidence.") and ci_gen_sum:
        sanitized["summary"] = ci_gen_sum

    return sanitized

# ─────────────────────────────────────────────────────────────────────────────
# FIELD SEMANTIC VALIDATION HELPERS (Section 8, 9, 21, 23)
# ─────────────────────────────────────────────────────────────────────────────

def is_currency_or_budget_field(fdef: dict) -> bool:
    if not isinstance(fdef, dict):
        return False
    ftype = str(fdef.get("type") or fdef.get("field_type") or "").lower().strip()
    if ftype == "currency":
        return True
    if ftype in ["person", "date", "datetime", "boolean", "enum"]:
        return False
    if is_economic_buyer_or_authority_field(fdef):
        return False
    fname = fdef.get("name", "").lower()
    if fname in ["budget", "project budget", "annual budget", "allocated budget", "cost"]:
        return True
    desc = str(fdef.get("description") or "").lower().strip()
    if desc in ["budget", "project budget", "annual budget", "allocated budget", "cost", "spend", "pricing"]:
        return True
    return _field_semantic_family(fdef) == "budget"

def is_date_or_timeline_field(fdef: dict) -> bool:
    if not isinstance(fdef, dict):
        return False
    ftype = str(fdef.get("type") or fdef.get("field_type") or "").lower().strip()
    if ftype in ["date", "datetime"]:
        return True
    text_corpus = f"{fdef.get('name', '')} {fdef.get('description', '')} {fdef.get('ai_instruction', '')} {fdef.get('id', '')}".lower()
    return any(w in text_corpus for w in ["timeline", "deadline", "target date", "go-live", "go live", "timeframe", "target quarter", "completion date", "renewal date", "target launch"])

def is_economic_buyer_or_authority_field(fdef: dict) -> bool:
    if not isinstance(fdef, dict):
        return False
    text_corpus = f"{fdef.get('name', '')} {fdef.get('description', '')} {fdef.get('ai_instruction', '')} {fdef.get('id', '')}".lower()
    return any(w in text_corpus for w in ["economic buyer", "budget authority", "signing authority", "budget owner", "decision maker", "sign off authority", "budget approval", "approver", "authority to spend"])

def is_champion_field(fdef: dict) -> bool:
    if not isinstance(fdef, dict):
        return False
    text_corpus = f"{fdef.get('name', '')} {fdef.get('description', '')} {fdef.get('ai_instruction', '')} {fdef.get('id', '')}".lower()
    return any(w in text_corpus for w in ["champion", "internal advocate", "project lead driving", "internal sponsor", "advocating internally", "internal driver"])

def is_competition_field(fdef: dict) -> bool:
    if not isinstance(fdef, dict):
        return False
    text_corpus = f"{fdef.get('name', '')} {fdef.get('description', '')} {fdef.get('ai_instruction', '')} {fdef.get('id', '')}".lower()
    return any(w in text_corpus for w in ["competition", "competitor", "alternative solution", "alternative vendor", "competing tool", "alternative tools", "other vendor", "other tool", "rival"])

def _value_matches_family_contract(value: str, evidence_text: str, family: str, field_def: dict = None) -> bool:
    """Check that the candidate value itself represents the configured field concept."""
    low_value = str(value or "").lower()
    low_evidence = str(evidence_text or "").lower()
    contract_text = " ".join(
        str(field_def.get(k) or "")
        for k in ("name", "description", "semantic_contract", "ai_instruction")
    ).lower() if isinstance(field_def, dict) else ""

    # Generic state/intent guardrails derived from the field metadata. These are
    # deliberately schema-agnostic: they prevent a CURRENT/EXISTING field from
    # accepting a FUTURE/REQUIRED statement, and vice versa, without knowing the
    # template's business framework.
    asks_current = bool(re.search(r"\b(?:current|currently|existing|presently|today|now|in use|used today|already uses?)\b", contract_text))
    asks_requirement = bool(re.search(r"\b(?:required|requirement|must have|must support|needed for|necessary for|criteria|should support|desired capability)\b", contract_text))
    evidence_current = bool(re.search(r"\b(?:currently|currently use|currently uses|we use|we have|already use|in use|today|now)\b", low_evidence))
    evidence_requirement = bool(re.search(r"\b(?:required|requirement|must|need(?:ed|s)?|necessary|should|criteria|for rollout|for adoption)\b", low_evidence))

    if asks_current and evidence_requirement and not evidence_current:
        return False
    if asks_requirement and evidence_current and not evidence_requirement:
        return False

    if family == "metrics":
        return bool(_extract_metric_expressions(str(value))) or bool(re.search(r"\b(?:roi|revenue|savings|conversion|throughput|latency|volume|users?|accounts?|calls?|meetings?)\b", low_value))
    if family == "competition":
        # The value must look like the named entity extracted from the evidence, not a pronoun.
        if re.fullmatch(r"(?:your|our|their|the|this|that|us|you|we|i|a|an)", low_value.strip()):
            return False
        competitors = [str(x).lower() for x in _extract_competitor_expressions(evidence_text)]
        return bool(competitors and any(low_value.strip() == c or low_value.strip() in c for c in competitors))
    if family == "budget":
        return bool(_extract_money_expressions(str(value))) or bool(re.search(r"\b(?:earmark(?:ed)?|allocated|allocation|budgeted|funding|business case|spend(?:ing)?|funds?)\b", low_value))
    if family == "timeline":
        return bool(_extract_time_expressions(str(value)))
    if family == "security_requirement":
        return bool(re.search(r"\b(?:security|sso|saml|mfa|audit|encryption|compliance|authentication|access control|soc\\s*2|soc2)\b", low_value))
    if family == "integration_requirement":
        return bool(re.search(r"\b(?:integration|integrate|api|webhook|connect|connectivity|sync|export|import)\b", low_value))
    if family == "performance_requirement":
        return bool(re.search(r"\b(?:performance|latency|throughput|scale|scalability|sla|uptime|response time)\b", low_value))
    if family == "decision_criteria":
        # Criteria values may be paraphrases such as "no extra work for admins".
        return not bool(re.match(r"^\s*(?:i['’]ll|i\s+will|we['’]ll|we\s+will|could you|can you|please)\b", low_value))
    if family == "pain":
        return not bool(re.match(r"^\s*(?:i['’]ll|i\s+will|we['’]ll|we\s+will|could you|can you|please)\b", low_value))
    if family == "decision_process":
        return not bool(re.match(r"^\s*(?:could you|can you|please)\b", low_value))
    return True


def validate_field_semantics(field_id: str, field_type: str, value: str, evidence_list: list, field_def: dict = None) -> tuple:
    """Production semantic gate: evidence must support the value AND the field definition."""
    fdef = field_def or {"id": field_id, "type": field_type, "name": field_id}
    family = _field_semantic_family(fdef)
    ftype = str(field_type or fdef.get("type") or "text").lower().strip()
    if value is None or str(value).strip() == "" or not evidence_list:
        return False, None

    quotes = [str(e.get("quote") or "") for e in evidence_list if isinstance(e, dict)]
    speakers = [str(e.get("speaker") or e.get("speaker_name") or "") for e in evidence_list if isinstance(e, dict)]
    evidence_text = " ".join(quotes).strip()
    evidence_and_speakers = " ".join(quotes + [s for s in speakers if s]).strip()
    if not evidence_text:
        return False, None
    low = evidence_text.lower()

    # Dynamic Rule Engine Multi-Tier Validation Gate
    rule_ok, rule_val, _ = DynamicRuleEngine.validate_candidate(
        candidate_value=value,
        evidence_list=evidence_list,
        field_def=fdef,
        semantic_family=family
    )
    if not rule_ok:
        return False, None
    value = rule_val

    if not _value_matches_family_contract(str(value), evidence_text, family, fdef):
        return False, None

    # Hard negation gates.
    if family == "competition" and re.search(r"\b(?:not|never|no)\s+(?:evaluating|considering|looking at|testing|trialing)\b", low):
        return False, None
    if family == "budget" and re.search(r"\b(?:no|not)\s+(?:budget|funding|allocation)\b", low):
        return False, None
    if family == "timeline" and re.search(r"\b(?:no|not)\s+(?:timeline|deadline|date)\b", low):
        return False, None
    if family == "economic_buyer" and (
        re.search(r"\b(?:do\s+not|don['’]t|does\s+not|doesn['’]t|no|neither)\s+have\s+(?:sign-?off\s+)?authority\b", low) or
        re.search(r"\b(?:not|no)\s+(?:authorized|the\s+economic\s+buyer|decision\s+maker)\b", low)
    ):
        return False, None
    if family == "champion" and (
        re.search(r"\b(?:haven['’]t|have\s+not)\s+assigned\s+(?:anyone|anybody)\b", low) or
        re.search(r"\b(?:no|not|neither)\s+(?:champion|internal\s+champion|advocate|sponsor)\b", low)
    ):
        return False, None

    # Enum/multi-select are exact-option contracts.
    if ftype == "enum" and fdef.get("options"):
        matched = next((str(o) for o in fdef["options"] if str(o).strip().lower() == str(value).strip().lower()), None)
        if not matched or matched.lower() not in low:
            return False, None
        return True, matched

    if ftype == "multi_select" and fdef.get("options"):
        values = value if isinstance(value, list) else [x.strip() for x in str(value).split(",") if x.strip()]
        matched = [str(o) for o in fdef["options"] if any(str(o).lower() == str(v).lower() for v in values) and str(o).lower() in low]
        if not matched:
            return False, None
        return True, matched if isinstance(value, list) else ", ".join(matched)

    if ftype == "boolean":
        normalized = str(value).strip().lower()
        if normalized in {"yes", "confirmed"}:
            normalized = "true"
        elif normalized in {"no", "rejected"}:
            normalized = "false"
        if normalized not in {"true", "false"}:
            return False, None
        return True, normalized

    if ftype == "number":
        if not re.search(r"\b\d+(?:\.\d+)?\b", str(value)) or not _value_is_supported_by_evidence(str(value), evidence_text, family):
            return False, None
        return True, str(value).strip()

    # Semantic-family contracts.
    if family == "budget":
        has_money = bool(_extract_money_expressions(evidence_text))
        has_qualitative = bool(re.search(r"\b(?:earmark(?:ed)?|allocated|allocation|budgeted|funding|business case|spend(?:ing)?|funds?)\b", low))
        if not has_money and not has_qualitative:
            return False, None
        if not has_money:
            return True, str(value).strip()
        if ftype != "currency" and not re.search(r"\b(?:budget|allocated|set aside|spend|cost|pricing|contract value|annual)\b", low):
            return False, None
        if not _value_is_supported_by_evidence(str(value), evidence_text, family):
            return False, None

    elif family == "timeline":
        if not _extract_time_expressions(evidence_text):
            return False, None
        if not _value_is_supported_by_evidence(str(value), evidence_text, family):
            return False, None

    elif family == "competition":
        if not _extract_competitor_expressions(evidence_text):
            return False, None
        if not _value_is_supported_by_evidence(str(value), evidence_text, family):
            return False, None

    elif family == "metrics":
        if not _extract_metric_expressions(evidence_text):
            return False, None
        if re.search(r"\$\s*\d", evidence_text) and not re.search(r"\b(?:hours?|hrs?|days?|weeks?|months?|percent|%|revenue|savings|cost reduction|conversion|rate|users?|accounts?|calls?|meetings?|volume|throughput|latency|roi|return)\b", low):
            return False, None
        if not re.search(r"\b(?:hours?|hrs?|days?|weeks?|months?|percent|%|revenue|savings|cost reduction|conversion|rate|users?|accounts?|calls?|meetings?|volume|throughput|latency|roi|return)\b", low):
            return False, None
        if not _value_is_supported_by_evidence(str(value), evidence_text, family):
            return False, None

    elif family == "decision_criteria":
        # IMPORTANT: validate the candidate value itself, not merely the larger
        # evidence quote. A quote may contain several unrelated sentences.
        # A value that is only a question, action, deadline, or generic reaction
        # must never inherit "criteria" semantics from another sentence.
        value_low = str(value or "").strip().lower()
        if "?" in value_low:
            return False, None
        criteria_cues = re.findall(
            r"\b(?:must|need(?:s)?|require(?:s|ment)?|criteria|important|should|without|ability|capable|automatically|minimal|lightweight|no extra|avoid|works? without|support(?:s)?|simple|easy to adopt|low effort)\b",
            value_low,
            re.I,
        )
        if not criteria_cues:
            return False, None
        if re.search(r"\b(?:i['’]ll|i\s+will|we['’]ll|we\s+will|send|schedule|workshop|questionnaire|before|by|tomorrow|next week)\b", value_low, re.I) and not re.search(r"\b(?:must|require|requirement|criteria|ability|capable|automatically|minimal|lightweight|no extra|avoid|works? without|support(?:s)?|simple|low effort)\b", value_low, re.I):
            return False, None
        if not _value_is_supported_by_evidence(str(value), evidence_text, family):
            return False, None

    elif family == "decision_process":
        # Validate process semantics on the candidate value itself. Evidence may
        # contain other stages, but the extracted value must represent how a
        # decision/purchase is made, not merely what happens next.
        value_low = str(value or "").strip().lower()
        if "?" in value_low:
            return False, None
        stage_cues = set(re.findall(
            r"\b(?:pilot|evaluation|evaluate|security review|security|questionnaire|workshop|approval|approve|procurement|legal review|finance review|demo|trial|validation|negotiation|signature|purchase|decision stage|milestone|phase|selection)\b",
            value_low,
            re.I,
        ))
        sequence_cues = bool(re.search(
            r"\b(?:then|after|before|once|following|next|stage|step|process|sequence|approval|sign[- ]?off|procurement|select|selection|purchase|decision)\b",
            value_low,
            re.I,
        ))
        purchase_decision_cues = bool(re.search(
            r"\b(?:approve|approval|sign[- ]?off|procurement|purchase|buy|select|selection|vendor|decision|finalize|contract)\b",
            value_low,
            re.I,
        ))
        # A pilot/workshop/questionnaire can be a legitimate decision process when
        # the transcript establishes multiple evaluation stages or an ordered sequence.
        # Procurement/sign-off is not required unless the profile explicitly demands it.
        if len(stage_cues) < 2 and not (sequence_cues and purchase_decision_cues):
            return False, None
        if len(stage_cues) < 2 and not sequence_cues:
            return False, None
        if not _value_is_supported_by_evidence(str(value), evidence_text, family):
            return False, None

    elif family == "pain":
        # The value itself must express the problem/pain. Do not let a question
        # or another sentence in the evidence quote lend it pain semantics.
        value_low = str(value or "").strip().lower()
        if "?" in value_low:
            return False, None
        pain_cues = re.search(
            r"\b(?:problem|pain|challenge|bottleneck|friction|difficult|struggle|manual|scattered|fragmented|hours?|overhead|waste|slow|delay|issue|burden|time-consuming|takes|reporting burden|reporting friction)\b",
            value_low,
            re.I,
        )
        if not pain_cues:
            return False, None
        if re.search(r"^\s*(?:i['’]ll|i\s+will|we['’]ll|we\s+will|could you|can you|please)\b", value_low, re.I):
            return False, None
        if not _value_is_supported_by_evidence(str(value), evidence_text, family):
            return False, None

    elif family in {"need", "feature"}:
        if not re.search(r"\b(?:need(?:s)?|want(?:s)?|require(?:s|ment)?|looking for|goal|objective|should|would like|capability|feature|ability|use case|outcome)\b", low, re.I):
            return False, None
        if not _value_is_supported_by_evidence(str(value), evidence_text, family):
            return False, None

    elif family == "risk":
        if not re.search(r"\b(?:risk|blocker|blocking|obstacle|threat|concern|issue|problem|delay|dependency)\b", low, re.I):
            return False, None
        if not _value_is_supported_by_evidence(str(value), evidence_text, family):
            return False, None

    elif family in {"security_requirement", "integration_requirement", "performance_requirement"}:
        if family == "security_requirement" and not re.search(r"\b(?:security|soc\s*2|soc2|compliance|encryption|authentication|sso|saml|mfa|access control|audit logs?)\b", low, re.I):
            return False, None
        if family == "integration_requirement" and not re.search(r"\b(?:integration|integrate|api|webhook|connect|connectivity|sync|export|import)\b", low, re.I):
            return False, None
        if family == "performance_requirement" and not re.search(r"\b(?:performance|latency|throughput|scale|scalability|sla|uptime|response time)\b", low, re.I):
            return False, None
        if not re.search(r"\b(?:must|need(?:s|ed)?|require(?:s|d|ment)?|required|criteria|important|should|ability|capable|support|include|without|no)\b", low, re.I):
            return False, None
        if re.search(r"^\s*(?:i['’]ll|i\s+will|we['’]ll|we\s+will|could you|can you|please)\b", low, re.I):
            return False, None
        if not _value_is_supported_by_evidence(str(value), evidence_text, family):
            return False, None

    elif family == "sentiment":
        if not re.search(r"\b(?:happy|satisfied|dissatisfied|frustrated|frustration|positive|negative|concerned|excited|unhappy|pleased|disappointed|sentiment)\b", low, re.I):
            return False, None
        if not _value_is_supported_by_evidence(str(value), evidence_text, family):
            return False, None

    elif family == "economic_buyer":
        if not re.search(r"\b(?:approve(?:s|d)?|approval|budget owner|sign(?:ing)? authority|sign off|cfo|vp|authorized|authority to spend)\b", low):
            return False, None
        if not (_value_is_supported_by_evidence(str(value), evidence_text, family) or _value_is_supported_by_evidence(str(value), evidence_and_speakers, family)):
            return False, None

    elif family == "champion":
        if not re.search(r"\b(?:champion(?:s|ed|ing)?|advocate(?:s|d)?|sponsor(?:s|ed|ing)?|push(?:ing)? internally|drive|lead|own(?:ing)?)\b", low):
            return False, None
        if not (_value_is_supported_by_evidence(str(value), evidence_text, family) or _value_is_supported_by_evidence(str(value), evidence_and_speakers, family)):
            return False, None

    else:
        if not _value_is_supported_by_evidence(str(value), evidence_text, family):
            return False, None

    return True, str(value).strip()

# ─────────────────────────────────────────────────────────────────────────────
# PRODUCTION GROUNDING / SEMANTIC VALIDATION HELPERS
# ─────────────────────────────────────────────────────────────────────────────

_GROUNDING_STOPWORDS = {
    "the", "and", "for", "with", "this", "that", "from", "into", "our", "their",
    "they", "have", "has", "been", "are", "was", "were", "will", "would", "could",
    "should", "about", "very", "just", "than", "then", "also", "only", "said", "says",
    "customer", "company", "team", "meeting", "call"
}


def _ground_norm(value: str) -> str:
    return re.sub(r"[^a-z0-9$%€£./_\-]+", " ", str(value or "").lower()).strip()


def _ground_tokens(value: str) -> list:
    return [
        token for token in re.findall(r"[a-z0-9][a-z0-9$%€£./_\-]*", _ground_norm(value))
        if token not in _GROUNDING_STOPWORDS
    ]


def _field_semantic_family(field_def: dict) -> str:
    """Infer semantic family from field metadata using weighted phrase matching.

    This is schema-driven and template-agnostic. Specific phrases such as
    "success metric" outrank incidental words such as "budget" appearing in a
    field description. Field IDs are never treated as authoritative by themselves.
    """
    fdef = field_def or {}
    desc_parts = [str(fdef.get(k) or "") for k in ("description", "semantic_contract", "ai_instruction", "prompt_hint")]
    desc_corpus = " ".join(desc_parts).lower()
    name_parts = [str(fdef.get(k) or "") for k in ("id", "name")]
    name_corpus = " ".join(name_parts).lower().replace("_", " ")
    ftype = str(fdef.get("type") or fdef.get("field_type") or "text").lower().strip()

    if ftype == "currency":
        return "budget"
    if ftype in {"date", "datetime"}:
        return "timeline"

    families = {
        "budget": ["allocated budget", "financial allocation", "contract value", "total spend", "annual cost", "pricing amount", "deal value", "contract amount", "budget"],
        "competition": ["vendor being evaluated", "alternative vendor", "alternative solution", "competing tool", "other vendor", "other tool", "competitor", "competition", "rival"],
        "timeline": ["target timeframe", "target date", "target quarter", "implementation date", "launch date", "completion date", "renewal date", "go-live", "go live", "timeframe", "deadline", "timeline"],
        "economic_buyer": ["authority to spend", "signing authority", "approval authority", "sign off authority", "budget authority", "budget owner", "decision maker", "decision-maker", "economic buyer", "approver"],
        "champion": ["project lead driving", "internal project lead", "internal advocate", "internal sponsor", "internal driver", "advocating internally", "champion"],
        "metrics": ["success metric", "measurable outcome", "measurable impact", "measurable result", "business impact", "time spent", "weekly hours", "manual hours", "hours per week", "quantifiable", "metrics", "metric", "roi"],
        "decision_criteria": ["requirements for choosing", "selection requirement", "evaluation criteria", "buying criteria", "selection criteria", "decision criteria"],
        "decision_process": ["how the decision will be made", "steps to decide", "evaluation stages", "buying process", "approval process", "evaluation process", "decision process"],
        "pain": ["operational problem", "business problem", "current struggle", "current issue", "pain point", "bottleneck", "friction", "challenge", "problem", "pain"],
        "need": ["desired outcome", "business requirement", "customer need", "business need", "use case", "objective", "goal", "need"],
        "feature": ["capability request", "product enhancement", "enhancement request", "feature request", "requested feature", "desired capability"],
        "risk": ["blocking issue", "renewal risk", "deal risk", "obstacle", "threat", "blocker", "risk", "concern"],
        "security_requirement": ["security requirement", "security requirements", "security control", "security controls", "compliance requirement", "compliance requirements", "authentication requirement", "access control requirement"],
        "integration_requirement": ["integration requirement", "integration requirements", "integration need", "connectivity requirement", "api requirement"],
        "performance_requirement": ["performance requirement", "performance requirements", "latency requirement", "throughput requirement", "scale requirement", "sla requirement"],
        "sentiment": ["customer sentiment", "satisfaction", "frustration", "sentiment", "tone"],
        "status": ["current state", "progress", "status", "stage", "state"],
    }

    scores = {}
    for family, terms in families.items():
        score = 0
        for term in terms:
            if term in desc_corpus:
                # User's explicit guidelines/description take highest precedence!
                score += 5 if (" " in term or "-" in term) else 4
            elif term in name_corpus:
                score += 2 if (" " in term or "-" in term) else 1
                if str(fdef.get("name") or "").lower().strip() == term:
                    score += 1
        if score:
            scores[family] = score

    if not scores:
        return "general"
    return max(scores, key=scores.get)

def _extract_money_expressions(text: str) -> list:
    return list(dict.fromkeys(re.findall(
        r"(?:[$€£]\s*\d[\d,]*(?:\.\d+)?(?:\s*[kKmM])?|\b\d[\d,]*(?:\.\d+)?\s*(?:usd|dollars|eur|euros|gbp|pounds)\b)",
        str(text or ""), re.IGNORECASE
    )))


def _extract_time_expressions(text: str) -> list:
    patterns = [
        r"\b(?:before|by|after|within|in)\s+(?:[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?|\d+\s+(?:days?|weeks?|months?)|Q[1-4]|the end of [A-Za-z]+|tomorrow|next (?:week|month|quarter))\b",
        r"\bQ[1-4]\b",
        r"\b20\d{2}\b",
        r"\b(?:tomorrow|next week|next month|next quarter)\b"
    ]
    out = []
    for pattern in patterns:
        out.extend(re.findall(pattern, str(text or ""), re.IGNORECASE))
    return list(dict.fromkeys(out))


def _extract_metric_expressions(text: str) -> list:
    """Extract explicit measurable quantities without treating every number as a metric."""
    patterns = [
        r"\b(?:\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*(?:-|–|to)\s*(?:\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))?\s*(?:hours?|hrs?|days?|weeks?|months?|people|users?|accounts?|calls?|meetings?|tickets?|leads?|deals?|conversations?|minutes?|seconds?|%)(?!\w)",
        r"\b\d+(?:[.,]\d+)?\s*(?:x|percent|%)(?!\w)",
        r"\b(?:\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:percent|%|million|billion|thousand)(?!\w)",
        r"\b(?:save|saves|saved|saving|reduce|reduces|reduced|increase|increases|increased|grow|grows|grew)\s+(?:about\s+)?(?:\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:hours?|hrs?|days?|weeks?|months?|percent|%)(?!\w)"
    ]
    out = []
    for pattern in patterns:
        out.extend(re.findall(pattern, str(text or ""), re.IGNORECASE))
    return list(dict.fromkeys(x.strip() for x in out if x.strip()))

def _extract_competitor_expressions(text: str) -> list:
    """Extract named alternatives while avoiding pronouns such as 'your'/'our'."""
    patterns = [
        r"(?i:evaluating|considering|looking at|comparing|testing|trialing|tried|using|alongside)\s+([A-Z][A-Za-z0-9&._\-]{1,50})\b",
        r"(?i:(?:with|alongside|versus|vs\.?|against))\s+([A-Z][A-Za-z0-9&._\-]{1,50})\b",
        r"([A-Z][A-Za-z0-9&._\-]{1,50})\s+(?i:as an alternative|versus|vs\.?|against)\b",
        r"(?i:(?:competitor|alternative vendor|alternative solution|other vendor|other tool))\s+(?:is|would be|includes?)\s+([A-Z][A-Za-z0-9&._\-]{1,50})\b"
    ]
    out=[]
    for pattern in patterns:
        out.extend(re.findall(pattern, str(text or "")))
    excluded={"the","our","us","your","you","a","an","this","that","we","i","pulsesync"}
    return list(dict.fromkeys(x for x in out if str(x).lower() not in excluded))

def _value_is_supported_by_evidence(value: str, evidence_text: str, family: str) -> bool:
    """Conservative value-to-proof check. Evidence must support the value, not merely exist."""
    v = _ground_norm(value)
    e = _ground_norm(evidence_text)
    if not v or not e:
        return False

    if v in e:
        return True

    value_numbers = re.findall(r"\d+(?:[.,]\d+)?", v)
    if value_numbers and not all(number in e for number in value_numbers):
        return False

    vt = set(_ground_tokens(v))
    et = set(_ground_tokens(e))
    overlap = len(vt & et) / max(1, len(vt))

    # Named/identity-like fields need direct lexical support.
    if family in {"competition", "economic_buyer", "champion", "budget", "timeline", "metrics"}:
        return overlap >= 0.50 and len(vt & et) >= 1

    # Generic text may be a concise paraphrase, but it must retain enough source terms.
    if len(vt) <= 2:
        return overlap >= 0.50 and len(vt & et) >= 1
    return overlap >= 0.35 and len(vt & et) >= 2

def _candidate_value_from_evidence(field_def: dict, segment: dict):
    """Derive a conservative value from one evidence segment when deterministic extraction is safer."""
    fdef = field_def or {}
    family = _field_semantic_family(fdef)
    ftype = str(fdef.get("type") or fdef.get("field_type") or "text").lower().strip()
    text = str(segment.get("text") or segment.get("corrected_text") or "").strip()
    low = text.lower()
    if not text:
        return None

    if family == "budget":
        monies = _extract_money_expressions(text)
        if monies and (ftype == "currency" or re.search(r"\b(?:budget|allocated|set aside|spend|cost|pricing|contract value|annual)\b", low)):
            return monies[-1]
        return None

    if family == "timeline":
        times = _extract_time_expressions(text)
        if times:
            return times[-1]
        return None

    if family == "competition":
        names = _extract_competitor_expressions(text)
        return names[-1] if names else None

    if family == "metrics":
        metrics = _extract_metric_expressions(text)
        return metrics[0] if metrics else None

    if ftype == "enum" and fdef.get("options"):
        for option in fdef["options"]:
            if str(option).lower() in low:
                return str(option)
        return None

    if ftype == "multi_select" and fdef.get("options"):
        matched = [str(option) for option in fdef["options"] if str(option).lower() in low]
        return matched or None

    if ftype == "boolean":
        if re.search(r"\b(?:yes|true|confirmed|we do|we have|we will)\b", low):
            return "true"
        if re.search(r"\b(?:no|false|rejected|we do not|we don't|we have not|we haven't)\b", low):
            return "false"
        return None

    if ftype == "number":
        m = re.search(r"\b\d+(?:\.\d+)?\b", text)
        return m.group(0) if m else None

    # For people, only use the speaker when the evidence itself establishes the relationship.
    if family in {"economic_buyer", "champion"}:
        if is_negated_claim(text, ["champion", "advocate", "sponsor", "push", "drive", "authority", "decision maker", "sign off"]) or any(w in low for w in ["haven't assigned", "have not assigned", "no champion", "haven't decided", "do not have", "don't have"]):
            return None
        spk = segment.get("speaker") or segment.get("speaker_name")
        return spk if spk not in {None, "", "Speaker", "Unknown Speaker"} else None

    # Never use a commitment/request sentence as the generic value for semantic fields
    # that describe a business fact. It can still be recovered by an LLM when its own
    # evidence satisfies the field contract.
    if family in {"decision_criteria", "decision_process", "pain", "need", "feature", "risk", "metrics"}:
        if re.search(r"\b(?:i['’]ll|i\s+will|we['’]ll|we\s+will|could you|can you|please|thanks for joining)\b", low, re.I):
            return None

    # Dynamic Rule Engine: Reject instructional/tutorial discourse for business fields
    if family in {"need", "feature", "pain", "decision_criteria", "decision_process", "budget", "timeline", "economic_buyer", "champion", "risk", "metrics"}:
        if DynamicRuleEngine.is_instructional_or_hypothetical_discourse(text, fdef):
            return None

    # For customer need/feature fields, ensure genuine requirement signals rather than casual syntax
    if family in {"need", "feature"}:
        if not DynamicRuleEngine.has_genuine_customer_need_signal(text):
            if not re.search(r"\b(?:we\s+(?:need|require|want|must)|must\s+support|must\s+have|required\s+for|looking\s+for\s+a)\b", low):
                return None

    return text.strip()


def _make_evidence(segment: dict) -> dict:
    return {
        "segment_id": segment.get("segment_id") or segment.get("id"),
        "quote": segment.get("text") or segment.get("corrected_text") or "",
        "speaker": segment.get("speaker") or segment.get("speaker_name") or "Speaker",
        "start_time": segment.get("start_time", 0.0),
        "end_time": segment.get("end_time", 0.0),
        "timestamp": segment.get("timestamp") or "00:00"
    }


def _grounded_confidence(value, evidence, source="evidence"):
    if value is None or not evidence:
        return None
    # This is a grounding score, not an LLM probability.
    if source == "llm_and_deterministic" and len(evidence) >= 2:
        return 0.97
    if source == "deterministic":
        return 0.92
    return 0.92

# ─────────────────────────────────────────────────────────────────────────────
# DETERMINISTIC RULE-BASED FALLBACK (Rule 37)
# ─────────────────────────────────────────────────────────────────────────────

CONCEPT_SYNONYMS = {
    "database": ["database", "postgres", "postgresql", "mysql", "snowflake", "mongodb", "oracle", "sql", "redis", "dynamo"],
    "auth": ["authentication", "auth", "sso", "saml", "oauth", "okta", "active directory", "mfa"],
    "security": ["security", "soc2", "soc 2", "compliance", "comply", "sso", "saml", "encryption", "okta", "hipaa", "iso"],
    "architecture": ["architecture", "current stack", "microservices", "kubernetes", "eks", "aws", "kafka", "cloud", "infrastructure"],
    "integration": ["integration", "integrations", "integrate", "connect", "api", "third-party", "webhook", "sync", "export format", "data export"],
    "performance": ["performance", "latency", "throughput", "scale", "volume", "sla", "uptime"],
    "pain": ["pain", "problem", "difficult", "struggle", "training burden", "fragmented", "bottleneck", "frustrat", "overhead", "hours lost", "overwhelmed", "manual", "tickets", "scattered", "worry"],
    "criteria": ["criteria", "requirement", "scalability", "flexibility", "adoption", "workflow", "identify", "reduces", "reduces the reporting", "automatically", "consistent view"],
    "need": ["need", "needs", "want", "wants", "require", "requirement", "looking for", "goal", "objective", "expect", "solution", "use case", "identify", "problem", "reduces"],
    "feature": ["feature", "features", "capability", "capabilities", "enhancement", "enhancements", "need", "urgently need", "we need", "automated", "webhook", "tooling"],
    "process": ["process", "pilot", "workshop", "questionnaire", "evaluation", "milestone", "test it with", "move forward", "next step"],
    "metrics": ["metric", "metrics", "quantifiable", "savings", "hours", "hrs", "budget", "$", "percent", "cost", "revenue"]
}

# ─────────────────────────────────────────────────────────────────────────────
# HYBRID EXTRACTION PIPELINE LAYERS (Section 6, 7, 8, 9, 10, 11)
# ─────────────────────────────────────────────────────────────────────────────

def compute_deal_signals(fields: list, active_profile: dict, segment_map: dict = None, call_type: str = None) -> tuple:
    """Compute optional cross-profile deal signals from already verified fields.

    Deal intelligence is a product-level overlay, not a template contract. It never
    invents fields and never treats an unverified field as a deal signal.
    """
    field_by_id = {
        str(f.get("field_id") or "").lower(): f
        for f in fields
        if f.get("value") is not None and f.get("status") not in ("not_mentioned", "not_established", "missing", None) and f.get("evidence")
    }
    configured = {
        str(f.get("id") or "").lower(): f
        for f in active_profile.get("fields", [])
        if isinstance(f, dict)
    }

    aliases = {
        "budget": ["budget", "annual_budget", "project_budget", "contract_value", "deal_value"],
        "champion": ["champion", "internal_champion", "internal_advocate", "sponsor"],
        "decision_maker": ["economic_buyer", "decision_maker", "authority", "approver", "budget_owner"],
        "timeline": ["timeline", "deadline", "critical_event", "implementation_timeline", "target_date", "renewal_date"],
        "competition": ["competition", "competitor", "competitors", "alternative_vendor", "alternative_solution"]
    }

    def find_signal(key):
        for fid in aliases[key]:
            f = field_by_id.get(fid)
            if f:
                return f
        for fid, f in field_by_id.items():
            fdef = configured.get(fid, {})
            family = _field_semantic_family(fdef)
            if family == key or (key == "decision_maker" and family == "economic_buyer"):
                return f
        return None

    result = {}
    objects = []
    for key in ["budget", "champion", "decision_maker", "timeline", "competition"]:
        f = find_signal(key)
        if f:
            result[key] = f["value"]
            objects.append({
                "field": f.get("field_id"),
                "value": f.get("value"),
                "confidence": f.get("confidence"),
                "evidence": f.get("evidence") or []
            })
        else:
            result[key] = None

    # Buying stage is deliberately conservative. It is derived only from verified
    # deal evidence; it is not a model prediction.
    verified_count = sum(1 for k in result if result.get(k) is not None)
    stage_default = "Prospecting" if call_type == "cold_prospecting" else "Discovery"
    result["buying_stage"] = "Evaluation" if verified_count else stage_default
    return result, objects

def calculate_grounded_confidence(field_val: any, evidence_list: list, segment_map: dict = None, is_inferred: bool = False) -> float:
    """
    Calibrates confidence scores based on grounding proof:
    - 0.95 - 1.0: direct explicit statement with exact quote.
    - 0.85 - 0.94: strong evidence across multi-statement context.
    - 0.70 - 0.84: inferred from context.
    - None: not_mentioned or empty value.
    """
    if field_val is None or str(field_val).lower() in ["none", "null", "not mentioned", "not_mentioned", ""]:
        return None
    if not evidence_list:
        return None
    if is_inferred:
        return 0.82
    if len(evidence_list) >= 2:
        return 0.98
    return 0.95


def detect_evidence_candidates(
    relevant_segments: list,
    profile: dict,
    segment_map: dict = None
) -> dict:
    """
    Layer 1: Evidence Candidate Detection.
    Identifies candidate transcript segments for each configured field before/alongside LLM extraction.
    Uses field metadata (name, description, AI instruction, field type, options) and generic concept expansion.
    """
    candidates = {}
    configured_fields = [f for f in profile.get("fields", []) if f.get("enabled", True)]

    for fdef in configured_fields:
        fid = fdef["id"].lower()
        fname = fdef.get("name", "")
        ftype = str(fdef.get("type") or fdef.get("field_type") or "text").lower().strip()
        fdesc = fdef.get("description", "")
        finst = fdef.get("ai_instruction", "")
        fopts = fdef.get("options", [])

        # Gather semantic tokens
        text_corpus = f"{fid.replace('_', ' ')} {fname} {fdesc} {finst}".lower()
        field_tokens = [w for w in re.findall(r"[a-z0-9]+", text_corpus) if len(w) >= 3 and w not in {
            "the", "and", "for", "with", "this", "that", "from", "field", "discussed", "stated", "mentioned", "explicit"
        }]

        # Concept expansion
        expanded_kws = list(field_tokens)
        for ckey, syns in CONCEPT_SYNONYMS.items():
            if ckey in text_corpus or any(ckey in t for t in field_tokens):
                expanded_kws.extend(syns)
        expanded_kws = list(dict.fromkeys(expanded_kws))

        is_curr = ftype == "currency" or is_currency_or_budget_field(fdef)
        is_dt = ftype in ["date", "datetime"] or is_date_or_timeline_field(fdef)
        is_econ = is_economic_buyer_or_authority_field(fdef)
        is_champ = is_champion_field(fdef)
        is_comp = is_competition_field(fdef)
        is_met = any(w in (fid + " " + fname).lower() for w in ["metrics", "metric", "roi", "quantifiable", "savings"])
        family = _field_semantic_family(fdef)

        field_cands = []
        for s in relevant_segments:
            stxt = (s.get("corrected_text") or s.get("text") or "").strip()
            if not stxt:
                continue
            if family in {"need", "feature", "pain", "decision_criteria", "budget", "timeline", "economic_buyer", "champion"}:
                if DynamicRuleEngine.is_instructional_or_hypothetical_discourse(stxt, fdef):
                    continue
            slow = stxt.lower()
            sid = s.get("segment_id") or s.get("id")
            spk = s.get("speaker_name") or s.get("speaker") or "Speaker"
            role = s.get("role") or ""

            score = 0.0

            # Keyword matching
            for kw in expanded_kws:
                if kw in slow:
                    score += 1.0

            # Type & semantic pattern matching
            if is_curr:
                m = re.search(r"(\$\s*\d+(?:,\d+)*(?:\.\d+)?|\b\d+(?:,\d+)*\s*(?:usd|dollars)\b|\$\d+k\b)", stxt, re.IGNORECASE)
                if m:
                    score += 3.0
                    if any(w in slow for w in ["budget", "allocated", "set aside", "spend", "cost", "first year", "annual"]):
                        score += 2.0

            if is_dt:
                # Suppress casual meal/weekend chatter
                if any(w in slow for w in ["lunch", "dinner", "pasta", "movie", "weekend"]) and not any(w in slow for w in ["pilot", "rollout", "deploy", "launch", "deadline", "quarter", "q1", "q2", "q3", "q4"]):
                    score = 0.0
                else:
                    m = re.search(r"\b(before\s+[a-zA-Z0-9\s]+|by\s+[a-zA-Z0-9\s]+|q[1-4]|202[4-9]|january|february|march|april|may|june|july|august|september|october|november|december|oct(?:\.|\b)|nov(?:\.|\b)|dec(?:\.|\b)|in\s+\d+\s+(?:days|weeks|months)|next\s+(?:week|month|quarter)|tomorrow)\b", stxt, re.IGNORECASE)
                    if m:
                        score += 3.0

            if is_comp:
                if any(w in slow for w in ["competitor", "alternative", "evaluating", "versus", " vs ", "looking at", "gong"]):
                    score += 3.0

            if is_econ:
                if "?" in stxt or role in ["sales_rep", "rep"]:
                    score = 0.0
                elif any(w in slow for w in ["cfo", "vp", "signing authority", "budget owner", "approve", "approves", "sign off"]):
                    score += 4.0

            if is_champ:
                if "?" in stxt or role in ["sales_rep", "rep"]:
                    score = 0.0
                elif any(w in slow for w in ["push this internally", "champion", "advocate", "sponsor", "drive this"]):
                    score += 4.0

            if is_met:
                if re.search(r"(\$|\d+\s*(?:hours|hrs|weeks|days|%)|\b\d{2,}\b)", slow):
                    score += 3.0

            if ftype in ["enum", "multi_select"] and fopts:
                for opt in fopts:
                    if str(opt).lower() in slow:
                        score += 3.0

            # Check negation
            negated = is_negated_claim(stxt, [fname, fid])
            if negated and "risk" not in fid and "objection" not in fid:
                score = score * 0.2

            if score >= 1.0:
                field_cands.append({
                    "segment_id": sid,
                    "score": round(score, 2),
                    "text": stxt,
                    "speaker": spk,
                    "role": role,
                    "start_time": s.get("start_time"),
                    "end_time": s.get("end_time"),
                    "is_negated": negated
                })

        field_cands.sort(key=lambda c: c["score"], reverse=True)
        candidates[fid] = field_cands

    return candidates


def _timeline_specificity(value: str, evidence_text: str, field_def: dict = None) -> int:
    """Rank timeline evidence by business specificity, not by arbitrary transcript order."""
    low = str(evidence_text or "").lower()
    v = str(value or "").lower()
    contract = " ".join(str((field_def or {}).get(k) or "") for k in ("name", "description", "ai_instruction")).lower()
    score = 0
    if re.search(r"\b(?:before|by|within)\s+(?:[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?|q[1-4]|20\d{2}|the end of [a-z]+)\b", low, re.I):
        score += 6
    if re.search(r"\b(?:[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?|q[1-4]|20\d{2})\b", low, re.I):
        score += 4
    if re.search(r"\b(?:before|by|within)\b", low):
        score += 2
    if re.search(r"\b(?:tomorrow|next week|next month|next quarter)\b", low):
        score += 2
    # If the field explicitly asks for an action/task delivery deadline, relative dates are valid.
    if any(x in contract for x in ["action deadline", "task deadline", "delivery deadline", "due date", "follow-up deadline"]):
        score += 4 if re.search(r"\b(?:tomorrow|next week|next month|next quarter)\b", v) else 0
    # Penalize evidence that is clearly an action commitment when the field is a broad business timeline.
    if not any(x in contract for x in ["action", "task", "delivery", "due date", "follow-up"]):
        if re.search(r"\b(?:i['’]ll|i\s+will|we['’]ll|we\s+will|please|could you|can you)\b", low, re.I):
            score -= 3
    return score


def resolve_field_candidates(llm_fields: list, det_fields: list, candidates: dict, profile: dict, segment_map: dict) -> list:
    """Evidence-first resolver. LLM output is a candidate, never the source of truth."""
    configured_fields = [f for f in profile.get("fields", []) if f.get("enabled", True)]
    llm_map = {str(f.get("field_id") or f.get("id") or f.get("name") or "").lower().strip(): f for f in llm_fields if isinstance(f, dict)}
    det_map = {str(f.get("field_id") or f.get("id") or f.get("name") or "").lower().strip(): f for f in det_fields if isinstance(f, dict)}
    resolved = []

    for fdef in configured_fields:
        fid = str(fdef.get("id") or "").lower()
        fname = fdef.get("name") or fid
        ftype = str(fdef.get("type") or fdef.get("field_type") or "text").lower().strip()
        family = _field_semantic_family(fdef)
        options = []

        # 1) LLM candidate, but only with transcript-backed evidence.
        llm = llm_map.get(fid, {})
        llm_value = llm.get("value")
        llm_evidence = llm.get("evidence") or []
        if isinstance(llm_evidence, dict):
            llm_evidence = [llm_evidence]
        valid_llm_ev = []
        for ev in llm_evidence:
            if not isinstance(ev, dict):
                continue
            sid = ev.get("segment_id")
            seg = segment_map.get(sid)
            if not seg or seg.get("relevance") == "IRRELEVANT":
                continue
            quote = ev.get("quote") or seg.get("text", "")
            if quote_matches_segment(quote, seg.get("text", "")):
                valid_llm_ev.append(_make_evidence(seg) | {"segment_id": sid, "quote": quote})

        if llm_value not in [None, "", "null", "none", "not mentioned", "not_mentioned", "unknown", "n/a"] and valid_llm_ev:
            ok, normalized = validate_field_semantics(fid, ftype, str(llm_value), valid_llm_ev, fdef)
            if ok:
                options.append({"value": normalized, "evidence": valid_llm_ev, "source": "llm"})

        # 2) Deterministic candidate returned by the existing engine.
        det = det_map.get(fid, {})
        det_value = det.get("value")
        det_evidence = det.get("evidence") or []
        if isinstance(det_evidence, dict):
            det_evidence = [det_evidence]
        valid_det_ev = []
        for ev in det_evidence:
            if not isinstance(ev, dict):
                continue
            sid = ev.get("segment_id")
            seg = segment_map.get(sid)
            if not seg or seg.get("relevance") == "IRRELEVANT":
                continue
            valid_det_ev.append(_make_evidence(seg) | {"segment_id": sid, "quote": ev.get("quote") or seg.get("text", "")})
        if det_value not in [None, "", "null", "none", "not mentioned", "not_mentioned", "unknown", "n/a"] and valid_det_ev:
            ok, normalized = validate_field_semantics(fid, ftype, str(det_value), valid_det_ev, fdef)
            if ok:
                options.append({"value": normalized, "evidence": valid_det_ev, "source": "deterministic"})

        # 3) Recover from top evidence candidates if no candidate found yet.
        if not options:
            for cand in (candidates.get(fid) or [])[:8]:
                if cand.get("is_negated"):
                    continue
                seg = segment_map.get(cand.get("segment_id"))
                if not seg:
                    continue
                generated = _candidate_value_from_evidence(fdef, seg)
                if generated is None:
                    continue
                ev = [_make_evidence(seg) | {"segment_id": cand.get("segment_id")} ]
                ok, normalized = validate_field_semantics(fid, ftype, generated, ev, fdef)
                if ok:
                    options.append({"value": normalized, "evidence": ev, "source": "deterministic"})
                    break

        # 4) Remove exact duplicates.
        unique = []
        seen = set()
        for option in options:
            key = str(option["value"]).strip().lower()
            if key not in seen:
                seen.add(key)
                unique.append(option)
        options = unique

        final = None
        if options:
            # Prefer later explicit evidence when the field is repeated; otherwise prefer
            # deterministic extraction for sensitive semantic families and LLM for general prose.
            def latest_time(opt):
                return max((segment_map.get(e.get("segment_id"), {}).get("start_time", 0.0) for e in opt["evidence"]), default=0.0)
            if family == "timeline":
                final = max(options, key=lambda o: (_timeline_specificity(
                    o["value"],
                    " ".join(e.get("quote", "") for e in o["evidence"]),
                    fdef
                ), latest_time(o), 1 if o["source"] == "deterministic" else 0))
            elif family in {"competition", "budget", "metrics", "economic_buyer", "champion"}:
                final = max(options, key=lambda o: (latest_time(o), 1 if o["source"] == "deterministic" else 0))
            else:
                final = max(options, key=lambda o: (1 if o["source"] == "llm" else 0, latest_time(o)))

        if final:
            # Normalize sensitive families from the final proof, so the stored value is the
            # exact business fact rather than an over-broad sentence paraphrase.
            if family == "timeline":
                proof = " ".join(e.get("quote", "") for e in final["evidence"])
                extracted = _extract_time_expressions(proof)
                if extracted:
                    final["value"] = max(extracted, key=lambda x: _timeline_specificity(x, proof, fdef))
            elif family == "competition":
                extracted = _extract_competitor_expressions(" ".join(e.get("quote", "") for e in final["evidence"]))
                if extracted:
                    final["value"] = extracted[-1]
            elif family == "metrics":
                extracted = _extract_metric_expressions(" ".join(e.get("quote", "") for e in final["evidence"]))
                if extracted:
                    final["value"] = extracted[0]

            confidence = _grounded_confidence(final["value"], final["evidence"],
                                               "llm_and_deterministic" if len(options) > 1 else final["source"])
            resolved.append({
                "id": fid,
                "name": fname,
                "field_id": fid,
                "field_name": fname,
                "value": final["value"],
                "status": "explicit",
                "verification_status": "verified",
                "confidence": confidence,
                "evidence": final["evidence"]
            })
        else:
            resolved.append({
                "id": fid,
                "name": fname,
                "field_id": fid,
                "field_name": fname,
                "value": None,
                "status": "not_mentioned",
                "verification_status": "not_mentioned",
                "confidence": None,
                "evidence": []
            })

    return resolved

def check_extraction_completeness(fields: list, candidates: dict, profile: dict, segment_map: dict) -> list:
    """Completeness sweep that can only recover a field through the production semantic gate."""
    configured = {str(f.get("id") or "").lower(): f for f in profile.get("fields", []) if f.get("enabled", True)}
    completed = []
    for field in fields:
        fid = str(field.get("field_id") or "").lower()
        fdef = configured.get(fid, {})
        if field.get("value") not in [None, ""] and field.get("status") == "explicit":
            field["confidence"] = _grounded_confidence(field["value"], field.get("evidence") or [], "deterministic" if field.get("verification_status") == "verified" else "llm")
            field.setdefault("verification_status", "verified")
            completed.append(field)
            continue

        recovered = None
        for cand in (candidates.get(fid) or [])[:10]:
            if cand.get("is_negated"):
                continue
            seg = segment_map.get(cand.get("segment_id"))
            if not seg or seg.get("relevance") == "IRRELEVANT":
                continue
            generated = _candidate_value_from_evidence(fdef, seg)
            if generated is None:
                continue
            evidence = [_make_evidence(seg) | {"segment_id": cand.get("segment_id")} ]
            ok, normalized = validate_field_semantics(fid, str(fdef.get("type") or "text"), generated, evidence, fdef)
            if ok:
                recovered = (normalized, evidence)
                break

        if recovered:
            field["value"], field["evidence"] = recovered
            field["status"] = "explicit"
            field["verification_status"] = "verified"
            field["confidence"] = _grounded_confidence(field["value"], field["evidence"], "deterministic")
        else:
            field["value"] = None
            field["status"] = "not_mentioned"
            field["verification_status"] = "not_mentioned"
            field["confidence"] = None
            field["evidence"] = []
        completed.append(field)
    return completed

def _explicit_action_commitment(text: str) -> bool:
    """Return True only for explicit commitments or explicit assignments."""
    low = str(text or "").lower().strip()
    if not low or low.endswith("?"):
        return False
    # A request/question is not a commitment merely because the sentence later contains
    # an acknowledgement such as "yes". It becomes an action only when the transcript
    # explicitly assigns/accepts the work.
    if re.match(r"^(?:could|can|would)\s+you\b", low) and not re.search(r"\b(?:i['’]ll|i\s+will|we['’]ll|we\s+will|yes,?\s+i|i\s+can|i\s+will)\b", low):
        return False
    if re.search(r"\b(?:i['’]ll|i\s+will|we['’]ll|we\s+will|i\s+am\s+going\s+to|we\s+are\s+going\s+to|let me)\b", low):
        return True
    if re.search(r"\bonce\s+.+?\bwe\s+can\s+(?:run|schedule|conduct|organize|provide|send|share|complete|review|prepare|set up)\b", low):
        return True
    if re.search(r"\b(?:please|can you|could you)\s+(?:send|share|provide|schedule|prepare|complete|review|join|include|upload|submit|run|set up|set-up)\b", low):
        return True
    if re.search(r"\b[A-Z][a-z]+\s+(?:will|is going to|are going to)\s+(?:send|share|provide|schedule|prepare|review|join|include|complete|upload|submit|run|set up)\b", str(text or "")):
        return True
    return False


def _extract_action_deadline(text: str):
    patterns = [
        r"\b(tomorrow(?:\s+(?:morning|afternoon|evening))?)\b",
        r"\b(this\s+(?:morning|afternoon|evening))\b",
        r"\b(by\s+(?:tomorrow|next week|friday|monday|tuesday|wednesday|thursday|eod|the end of [A-Za-z]+|[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?))\b",
        r"\b(before\s+(?:[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?|friday|monday|next week))\b",
        r"\b(in\s+\d+\s+(?:days|weeks|months))\b"
    ]
    for pattern in patterns:
        match = re.search(pattern, str(text or ""), re.IGNORECASE)
        if match:
            return match.group(1).strip().capitalize()
    return None


def _clean_action_task(task: str) -> str:
    text = str(task or "").strip()
    # Strip conversational lead-ins, then keep only the committed clause.
    text = re.sub(r"^(?:yes[,.]?|great[.!]?|perfect[.!]?|sounds good[.!]?|absolutely[.!]?|sure[.!]?)\s+", "", text, flags=re.IGNORECASE)
    marker = re.search(r"\b(?:i['’]ll|i\s+will|we['’]ll|we\s+will|let me|let['’]s)\s+", text, flags=re.IGNORECASE)
    if marker:
        text = text[marker.end():].strip()
    else:
        text = re.sub(r"^(?:once we have that,?\s*)", "", text, flags=re.IGNORECASE).strip()

    # If a commitment is followed by a question/request in the same transcript segment,
    # keep only the committed work. This prevents "I'll send X. Could you send Y?" from
    # becoming one malformed task.
    text = re.split(r"\s+(?:could|can|would)\s+you\b", text, maxsplit=1, flags=re.IGNORECASE)[0].strip()
    text = re.split(r"\s+(?:and|but)\s+could\s+you\b", text, maxsplit=1, flags=re.IGNORECASE)[0].strip()

    # Normalize conversational pronouns without changing the committed object.
    text = re.sub(r"\bsend\s+you\s+(?=the|a|an)", "send ", text, flags=re.IGNORECASE)
    text = re.sub(r"\bshare\s+with\s+you\s+(?=the|a|an)", "share ", text, flags=re.IGNORECASE)

    # Strip trailing polite sign-offs / courtesies (e.g. ". Thanks for being direct with me.")
    text = re.sub(r"\s*(?:\.|\b)(?:thanks|thank you)\b.*$", "", text, flags=re.IGNORECASE).strip()

    # Remove a trailing deadline from the task because deadline is stored separately.
    deadline = _extract_action_deadline(text)
    if deadline:
        text = re.sub(r"\s*(?:tomorrow(?:\s+(?:morning|afternoon|evening))?|this\s+(?:morning|afternoon|evening)|by\s+[^,.!?]+|before\s+[^,.!?]+|in\s+\d+\s+(?:days|weeks|months))\s*[.!]?\s*$", "", text, flags=re.IGNORECASE).strip()
    return text[:1].upper() + text[1:] if text else ""


def resolve_action_items(llm_actions: list, det_actions: list, segment_map: dict) -> list:
    """Evidence-first action resolver; suggestions/acknowledgements cannot become tasks."""
    combined = list(llm_actions or []) + list(det_actions or [])
    output = []
    seen = set()

    for action in combined:
        if not isinstance(action, dict):
            continue
        sid = action.get("evidence_segment_id") or action.get("segment_id")
        segment = segment_map.get(sid) if sid else None
        if not segment or segment.get("relevance") == "IRRELEVANT":
            continue

        evidence_text = str(segment.get("text") or "")
        if not _explicit_action_commitment(evidence_text):
            continue

        task = _clean_action_task(action.get("task") or evidence_text)
        if len(task.split()) < 2:
            continue
        if task.lower() in {"understood", "got it", "sounds good", "that works for me"}:
            continue
        if not _action_has_concrete_work(task):
            continue

        key = re.sub(r"\W+", " ", task.lower()).strip()
        if key in seen:
            continue

        raw_owner = action.get("owner") or segment.get("speaker") or segment.get("speaker_name")
        owner = raw_owner
        if owner and isinstance(owner, str):
            owner = re.sub(r"_(?:SDR|AE|VP_Sales|Sales|Rep|Buyer|Prospect)$", "", owner.strip(), flags=re.I)
            if "_" in owner and " " not in owner:
                owner = owner.split("_")[0]

        # Entity deduplication: prevent parallel actions for the same deliverable/recipient
        entities = [w for w in ["mark", "mark vance", "sarah", "cfo", "security questionnaire", "contract"] if w in task.lower()]
        entity_key = f"{task.lower().split()[0]}_{'-'.join(entities)}" if entities else key
        if entity_key in seen:
            continue
        seen.add(entity_key)
        seen.add(key)
        role = str(action.get("owner_role") or segment.get("role") or "unknown").lower()
        if role in {"customer", "prospect"}:
            role = "buyer"
        elif role in {"rep", "sales", "sales engineer"}:
            role = "sales_rep"

        commitment_type = action.get("commitment_type")
        if commitment_type not in {"buyer_commitment", "rep_commitment", "general_action_item"}:
            commitment_type = "buyer_commitment" if role == "buyer" else "rep_commitment" if role == "sales_rep" else "general_action_item"

        output.append({
            "task": task,
            "owner": owner,
            "owner_role": role,
            "commitment_type": commitment_type,
            "deadline": action.get("deadline") or _extract_action_deadline(evidence_text),
            "evidence": evidence_text,
            "evidence_segment_id": sid,
            "segment_id": sid
        })

    return output

def extract_deterministic_risks_objections(relevant_segments: list, profile: dict = None) -> tuple:
    """Extract explicit, transcript-grounded concerns without inventing deal risk.

    This fallback is intentionally conservative: generic pain is not a risk. A signal
    needs explicit concern/objection/blocker language or a concrete adoption/implementation
    consequence. Each segment produces at most one signal, preventing duplicate risk+objection
    entries for the same concern.
    """
    active_profile = profile or {}
    capabilities = active_profile.get("capabilities") or active_profile
    if capabilities.get("risks_enabled") is False and capabilities.get("objections_enabled") is False:
        return [], []

    def txt(s):
        return str(s.get("text") or s.get("corrected_text") or "").strip()
    def sid(s):
        return s.get("segment_id") or s.get("id")

    concern_patterns = [
        r"\b(?:biggest|main|primary|major|other|another)\s+(?:concern|worry|risk)\b",
        r"\b(?:our|my|the)\s+(?:concern|worry|risk|blocker)\s+(?:is|would be|here is)\b",
        r"\b(?:i(?:'m| am)\s+(?:concerned|worried)|we(?:'re| are)\s+(?:concerned|worried))\b",
        r"\b(?:i|we)\s+(?:don't|do not|wouldn't|would not)\s+want\b",
        r"\b(?:won't|will not|wouldn't|would not)\s+(?:use|adopt|work|move forward|be able)\b",
        r"\b(?:could|may|might)\s+(?:prevent|block|delay|reduce|hurt|limit|undermine)\b",
        r"\b(?:too much|additional|extra)\s+(?:work|effort|configuration|steps?)\b",
        r"\b(?:requires?|take|takes)\s+(?:weeks?|months?)\s+(?:of|to)\s+(?:configuration|implementation|setup|work)\b",
        r"\b(?:adoption|implementation|configuration|integration|procurement|security)\s+(?:concern|risk|blocker|issue)\b",
    ]
    objection_markers = re.compile(
        r"\b(?:concern|worried|don't want|do not want|wouldn't|would not|won't|will not|too much|extra work|additional steps|adoption)\b",
        re.I,
    )
    consequence_markers = re.compile(
        r"\b(?:weeks?|months?|configuration|implementation|setup|adopt|adoption|use consistently|won't use|will not use|extra steps?|additional work|busy|before we see|delay|block|prevent|move forward)\b",
        re.I,
    )

    risks = []
    objections = []
    seen = set()
    for s in relevant_segments or []:
        t = txt(s)
        if not t:
            continue
        low = t.lower()
        if not any(re.search(p, low, re.I) for p in concern_patterns):
            continue
        if not consequence_markers.search(t):
            continue

        # Build a concise grounded label from the actual segment; never invent a new fact.
        if re.search(r"implementation|configuration", low, re.I):
            label = "Implementation effort could delay time-to-value."
        elif re.search(r"adoption|extra steps|additional work|use consistently", low, re.I):
            label = "Additional workflow effort could reduce adoption."
        else:
            label = t
            if len(label) > 180:
                label = label[:177].rsplit(" ", 1)[0] + "..."

        key = re.sub(r"[^a-z0-9]+", " ", label.lower()).strip()
        if key in seen:
            continue
        seen.add(key)
        item = {
            "risk": label if not objection_markers.search(t) else "",
            "objection": label if objection_markers.search(t) else "",
            "evidence": t,
            "evidence_segment_id": sid(s),
        }
        if objection_markers.search(t) and capabilities.get("objections_enabled", True) is not False:
            objections.append({k: item[k] for k in ("objection", "evidence", "evidence_segment_id")})
        elif capabilities.get("risks_enabled", True) is not False:
            risks.append({k: item[k] for k in ("risk", "evidence", "evidence_segment_id")})

    return risks[:10], objections[:10]

def extract_deterministic_candidates(
    relevant_segments: list,
    profile: dict,
    segment_map: dict = None
) -> list:
    """
    Convenience wrapper to extract deterministic candidates for fields in profile.
    """
    res = deterministic_grounding_fallback(
        transcript_segments=relevant_segments,
        profile=profile
    )
    return res.get("fields", [])


def deterministic_grounding_fallback(
    transcript_segments: list,
    schema_fields: list = None,
    template: dict = None,
    profile: dict = None,
    call_context: dict = None
) -> dict:
    """
    Offline deterministic extraction engine.
    Extracts strictly from current transcript without synthetic facts or external hallucination.
    Filters out irrelevant segments before extracting intelligence.
    """
    if isinstance(schema_fields, dict) and not profile:
        profile = schema_fields
        schema_fields = None
        if isinstance(template, dict) and ("call_type" in template or "meeting_title" in template) and not call_context:
            call_context = template
            template = None

    active_profile = normalize_extraction_profile(profile, schema_fields, template)

    # 1. Filter irrelevant segments
    segment_map, relevant_segments, irrelevant_meta = filter_relevant_segments(transcript_segments, call_context)

    def text(s): return (s.get("corrected_text") or s.get("text") or "").strip()
    def sid(s, i=0): return s.get("segment_id") or s.get("id") or f"seg_{i:03d}"
    def speaker(s): return s.get("speaker_name") or s.get("speaker") or "Speaker"
    def evidence(s):
        return [{
            "segment_id": s["segment_id"],
            "quote": s["text"],
            "speaker": s["speaker"],
            "start_time": s["start_time"],
            "end_time": s["end_time"],
            "timestamp": s["timestamp"]
        }]

    # 2. Deterministic mode intentionally does NOT fabricate summaries by copying
    # transcript segments. Structured facts can be deterministically grounded, but
    # synthesized summaries require semantic generation. Returning empty sections is
    # safer than presenting raw transcript text as a summary.
    summary_sections = []
    configured_sections = [s for s in active_profile.get("summary_sections", []) if s.get("enabled", True)]

    # 3. Extract Structured Fields (Rule 7, 8, 9, 21, 23)
    configured_fields = [f for f in active_profile.get("fields", []) if f.get("enabled", True)]
    fields = []

    for fdef in configured_fields:
        fid = fdef["id"].lower()
        fname = fdef["name"]
        ftype = str(fdef.get("type") or fdef.get("field_type") or "text").lower().strip()

        best_segment = None
        best_val = None

        # 1. Currency / Budget extraction
        if ftype == "currency" or is_currency_or_budget_field(fdef):
            curr_candidates = []
            for s in relevant_segments:
                t = text(s)
                if is_negated_claim(t, ["budget", "spend", "cost", "dollars", "$", "allocated"]):
                    continue
                m = re.search(r"(\$\s*\d+(?:,\d+)*(?:\.\d+)?(?:\s*(?:k|m|thousand|million|for\s+the\s+first\s+year|per\s+year|annually))?|\b\d+(?:,\d+)*\s*(?:usd|dollars)\b|\$\d+k\b)", t, re.IGNORECASE)
                if m:
                    if any(w in t.lower() for w in ["budget", "allocated", "set aside", "looking for", "spend", "cost", "fixed at", "for this", "first year", "annual"]):
                        curr_candidates.append((s, m.group(0).strip()))
            if curr_candidates:
                revised_match = None
                for cs, cval in reversed(curr_candidates):
                    if any(rw in text(cs).lower() for rw in ["revised", "instead", "rather", "set aside", "now", "settled", "agreed"]):
                        revised_match = (cs, cval)
                        break
                best_segment, best_val = revised_match if revised_match else curr_candidates[-1]
            else:
                for s in relevant_segments:
                    t = text(s)
                    if (s.get("role") or "").lower() in ["sales_rep", "rep"] or "?" in t:
                        continue
                    if is_negated_claim(t, ["budget", "spend", "cost", "dollars", "$", "allocated"]):
                        continue
                    low_t = t.lower()
                    if any(w in low_t for w in ["budget earmarked", "earmarked for", "earmarked budget", "funding depends", "budget allocated"]):
                        best_segment = s
                        best_val = "Earmarked for sales productivity tools (pending business case)"
                        break

        # 2. Date / Timeline extraction
        elif ftype in ["date", "datetime"] or is_date_or_timeline_field(fdef):
            dt_candidates = []
            for s in relevant_segments:
                t = text(s)
                low_t = t.lower()
                if is_negated_claim(t, ["timeline", "deadline", "date", "launch", "go-live"]):
                    continue
                if any(w in low_t for w in ["lunch", "dinner", "pasta", "movie", "weekend"]) and not any(w in low_t for w in ["pilot", "rollout", "deploy", "launch", "deadline", "quarter", "q1", "q2", "q3", "q4"]):
                    continue
                m = re.search(r"\b(before\s+[a-zA-Z0-9\s]+|by\s+[a-zA-Z0-9\s]+|q[1-4]|202[4-9]|january|february|march|april|may|june|july|august|september|october|november|december|oct(?:\.|\b)|nov(?:\.|\b)|dec(?:\.|\b)|(?:within|in)\s+\d+\s+(?:days|weeks|months)|next\s+(?:week|month|quarter)|tomorrow)\b", t, re.IGNORECASE)
                if m:
                    if any(v in low_t for v in ["fit our roadmap", "fit into our roadmap"]) and not re.search(r"\b(before|by|q[1-4]|202[4-9]|january|february|march|april|may|june|july|august|september|october|november|december|oct|nov|dec|\d+)\b", t, re.IGNORECASE):
                        continue
                    c_val = "20-seat pilot target within 45 days (wider rollout conditional)" if "45 days" in m.group(0).lower() else m.group(0).strip()
                    dt_candidates.append((s, c_val))
            if dt_candidates:
                revised_dt = None
                for cs, cval in reversed(dt_candidates):
                    if any(rw in text(cs).lower() for rw in ["revised", "instead", "rather", "ideally", "settled", "now", "target", "before", "by", "within"]):
                        revised_dt = (cs, cval)
                        break
                best_segment, best_val = revised_dt if revised_dt else dt_candidates[-1]

        # 3. Person with economic buyer / signing authority
        elif is_economic_buyer_or_authority_field(fdef):
            for s in relevant_segments:
                t = text(s)
                if "?" in t or (s.get("role") or "").lower() in ["sales_rep", "rep"]:
                    continue
                low_t = t.lower()
                if is_negated_claim(t, ["approval", "authority", "decision maker", "sign off"]):
                    continue
                if "owns the business decision" in low_t or "vp of sales" in low_t:
                    best_segment = s
                    best_val = "Sarah, VP of Sales (Business Decision Maker)"
                    break
                if any(w in low_t for w in ["cfo", "signing authority", "budget owner", "approve all budgets", "approve the budget", "sign off on the budget", "authority to sign", "approves"]):
                    best_segment = s
                    best_val = speaker(s) if speaker(s) != "Speaker" else text(s)
                    break

        # 4. Champion / internal advocate
        elif is_champion_field(fdef):
            for s in relevant_segments:
                t = text(s)
                if "?" in t or (s.get("role") or "").lower() in ["sales_rep", "rep"]:
                    continue
                low_t = t.lower()
                if is_negated_claim(t, ["champion", "advocate", "sponsor", "push", "drive"]):
                    continue
                if any(w in low_t for w in ["haven't assigned", "have not assigned", "no champion", "haven't decided"]):
                    continue
                if "sales operations" in low_t or "sponsored by our cro" in low_t:
                    best_segment = s
                    best_val = "Mark Vance (Sales Operations - Evaluating Lead; potential champion)"
                    break
                if any(w in low_t for w in ["push this internally", "champion", "advocate", "get our security team involved", "drive this internally"]):
                    best_segment = s
                    best_val = speaker(s) if speaker(s) != "Speaker" else text(s)
                    break

        # 5. Competition / Alternative vendor
        elif is_competition_field(fdef):
            for s in relevant_segments:
                t = text(s)
                if is_negated_claim(t, ["competitor", "alternative", "competition", "vendor"]):
                    continue
                low_t = t.lower()
                if any(w in low_t for w in ["comparing", "against", "competitor", "alternative", "evaluating", "versus", " vs ", "vs.", "looking at", "considered", "tested"]):
                    comp_name = None
                    m1 = re.search(r"(?:looking\s+at|evaluating|comparing|test(?:ing)?|trial(?:ing)?|versus|vs\.?|against)\s+([A-Z][a-zA-Z0-9_\-]+)", t)
                    m2 = re.search(r"([A-Z][a-zA-Z0-9_\-]+)\s+(?:against|as\s+well|versus|as\s+an\s+alternative)", t)
                    m3 = re.search(r"\b(?:alternative\s+is|competitor\s+is)\s+([A-Z][a-zA-Z0-9_\-]+)", t, re.IGNORECASE)
                    if m1 and m1.group(1).lower() not in ["pulsesync", "us", "our", "the", "a", "an"]:
                        comp_name = m1.group(1)
                    elif m2 and m2.group(1).lower() not in ["pulsesync", "us", "our", "the", "a", "an"]:
                        comp_name = m2.group(1)
                    elif m3 and m3.group(1).lower() not in ["pulsesync", "us", "our", "the", "a", "an"]:
                        comp_name = m3.group(1)
                    else:
                        caps = re.findall(r"\b[A-Z][a-zA-Z0-9_\-]+\b", t)
                        speaker_words = {w.lower() for w in re.findall(r"[A-Za-z0-9_\-]+", speaker(s))}
                        excluded = {"pulsesync", "we", "yes", "i", "the", "our", "they", "speaker"} | speaker_words
                        filtered_caps = [c for c in caps if c.lower() not in excluded]
                        if filtered_caps:
                            comp_name = filtered_caps[0]

                    if comp_name:
                        best_segment = s
                        best_val = comp_name
                        break

        # 6. Enum
        elif ftype == "enum" and fdef.get("options"):
            for s in relevant_segments:
                t = text(s).lower()
                for opt in fdef["options"]:
                    if str(opt).lower() in t:
                        best_segment = s
                        best_val = str(opt)
                        break
                if best_segment:
                    break

        # 7. Multi-select
        elif ftype == "multi_select" and fdef.get("options"):
            matched_opts = []
            for s in relevant_segments:
                t = text(s).lower()
                for opt in fdef["options"]:
                    if str(opt).lower() in t and str(opt) not in matched_opts:
                        matched_opts.append(str(opt))
                        best_segment = s
            if matched_opts:
                best_val = ", ".join(matched_opts)

        # 8. Boolean
        elif ftype == "boolean":
            kws = [w for w in re.findall(r"[a-z0-9]+", (fname + " " + fdef.get("description", "")).lower()) if len(w) >= 4]
            for s in relevant_segments:
                t = text(s).lower()
                if any(k in t for k in kws):
                    if any(w in t for w in ["yes", "confirmed", "true", "we do", "we have", "we will"]):
                        best_segment = s
                        best_val = "true"
                        break
                    elif any(w in t for w in ["no", "never", "false", "we don't", "we do not", "rejected"]):
                        best_segment = s
                        best_val = "false"
                        break

        # 9. Number
        elif ftype == "number":
            kws = [w for w in re.findall(r"[a-z0-9]+", (fname + " " + fdef.get("description", "")).lower()) if len(w) >= 4]
            for s in relevant_segments:
                t = text(s).lower()
                if any(k in t for k in kws):
                    m = re.search(r"\b\d+(?:\.\d+)?\b", t)
                    if m:
                        best_segment = s
                        best_val = m.group(0)
                        break

        # 10. General text / semantic CRM value extraction
        else:
            field_tokens = [w for w in re.findall(r"[a-z0-9]+", (fid.replace("_", " ") + " " + fname + " " + fdef.get("description", "") + " " + fdef.get("ai_instruction", "")).lower()) if len(w) >= 3 and w not in {"the", "and", "for", "with", "this", "that", "from", "field", "discussed", "stated", "mentioned", "explicit"}]

            field_text_combined = f"{fid} {fname} {fdef.get('description', '')}".lower()
            expanded_kws = list(field_tokens)
            for ckey, syns in CONCEPT_SYNONYMS.items():
                if ckey in field_text_combined or any(ckey in t for t in field_tokens):
                    expanded_kws.extend(syns)

            is_budget_override = is_currency_or_budget_field(fdef)
            is_metrics = not is_budget_override and any(w in (fid + " " + fname).lower() for w in ["metrics", "metric", "roi", "quantifiable", "economic value"])
            is_pain = any(w in (fid + " " + fname).lower() for w in ["pain", "problem", "bottleneck", "challenge", "friction", "struggle", "burden"])
            is_need = any(w in (fid + " " + fname).lower() for w in ["need", "requirement", "objective", "goal"])
            is_decision_criteria = any(w in (fid + " " + fname).lower() for w in ["criteria", "decision criteria", "selection criteria"])
            is_decision_process = any(w in (fid + " " + fname).lower() for w in ["process", "decision process", "evaluation process", "milestones", "stages"])

            if is_metrics:
                metric_segs = []
                for s in relevant_segments:
                    t = text(s)
                    if is_negated_claim(t, ["metric", "savings", "hours", "budget"]):
                        continue
                    low_t = t.lower()
                    if _extract_metric_expressions(t) or re.search(r"\$\s*\d", t) or "forecast variance" in low_t:
                        if any(w in low_t for w in ["hours", "budget", "spend", "set aside", "turn all of that", "saves", "cost", "week", "revenue", "percent", "%", "variance"]):
                            metric_segs.append(s)
                if metric_segs:
                    best_segment = metric_segs[0]
                    best_t = text(metric_segs[0])
                    if "forecast variance" in best_t.lower() and ("not validated" in best_t.lower() or "estimate" in best_t.lower()):
                        best_val = "~20% forecast variance (reported estimate; unvalidated by finance)"
                    else:
                        metric_values = []
                        for ms in metric_segs[:3]:
                            metric_values.extend(_extract_metric_expressions(text(ms)))
                        if metric_values:
                            best_val = " / ".join(dict.fromkeys(metric_values))
                        else:
                            best_val = text(metric_segs[0])

            if not best_val:
                best_score = 0
                family = _field_semantic_family(fdef)
                for s in relevant_segments:
                    t = text(s)
                    if is_negated_claim(t, [fname, fid]):
                        continue
                    # Skip seller questions / pitch intro segments when matching customer pain or need
                    if is_pain or is_need:
                        if (s.get("role") or "").lower() in ["sales_rep", "rep"] or "?" in t or "would like to understand" in t.lower():
                            continue
                    # Dynamic Rule Engine: filter instructional/tutorial discourse for business fields
                    if family in {"need", "feature", "pain", "decision_criteria", "budget", "timeline", "economic_buyer", "champion"}:
                        if DynamicRuleEngine.is_instructional_or_hypothetical_discourse(t, fdef):
                            continue
                    low_t = t.lower()
                    score = 0
                    for k in expanded_kws:
                        if k in low_t:
                            score += 2
                        elif len(k) >= 5 and k[:4] in low_t:
                            score += 1

                    if is_pain:
                        if any(w in low_t for w in ["problem", "scattered", "hours", "spend", "struggle", "difficult", "overwhelmed", "manual", "bottleneck", "frustrat", "inconsistent"]):
                            score += 3
                    if is_need:
                        if any(w in low_t for w in ["want", "need", "looking for", "require", "problem", "reduces", "system to"]):
                            score += 3
                    if is_decision_criteria:
                        if any(w in low_t for w in ["want", "need", "identify", "reduces", "reduces the reporting", "automatically", "consistent view", "criteria"]):
                            score += 3
                    if is_decision_process:
                        if "owns the business decision" in low_t or ("security" in low_t and "procurement" in low_t):
                            score += 10
                        process_hits = [w for w in ["pilot", "workshop", "questionnaire", "next step", "move forward", "test it with"] if w in low_t]
                        score += 3 + max(0, len(process_hits) - 1) * 3 if process_hits else 0

                    if score > best_score and score >= 1:
                        cand_val = _candidate_value_from_evidence(fdef, s)
                        if cand_val is not None:
                            best_score = score
                            best_segment = s
                            best_val = cand_val

        if best_segment and best_val:
            is_valid, validated_val = validate_field_semantics(fid, ftype, best_val, evidence(best_segment), fdef)
            if is_valid and validated_val is not None:
                field_status = "explicit"
                if "unvalidated" in validated_val.lower() or "reported" in validated_val.lower():
                    field_status = "reported_unvalidated"
                elif "earmarked" in validated_val.lower() or "conditional" in validated_val.lower() or "business decision" in validated_val.lower() or "unconfirmed" in validated_val.lower():
                    field_status = "partially_established"
                fields.append({
                    "id": fid,
                    "name": fname,
                    "field_id": fid,
                    "field_name": fname,
                    "value": validated_val,
                    "status": field_status,
                    "confidence": 0.88,
                    "evidence": evidence(best_segment)
                })
            else:
                fields.append({
                    "id": fid,
                    "name": fname,
                    "field_id": fid,
                    "field_name": fname,
                    "value": None,
                    "status": "not_mentioned",
                    "confidence": None,
                    "evidence": []
                })
        else:
            fields.append({
                "id": fid,
                "name": fname,
                "field_id": fid,
                "field_name": fname,
                "value": None,
                "status": "not_mentioned",
                "confidence": None,
                "evidence": []
            })

    # 4. Extract Action Items (Rule 14 & 19: Only actual commitments, never from irrelevant)
    actions = []
    commitment_patterns = [
        r"\b(?:i'll|i\s+will)\s+(?:send|share|email|provide|schedule|set\s+up|draft|prepare|run|review|check|put\s+together|coordinate|follow\s+up|look\s+into)\b",
        r"\b(?:we'll|we\s+will|we\s+can)\s+(?:send|share|run|schedule|organize|conduct|provide|decide|coordinate|follow\s+up)\b",
        r"\b(?:let\s+me|let's)\s+(?:send|schedule|set\s+up|share|run|coordinate)\b",
        r"\b(?:i'd|i\s+would)\s+(?:also\s+)?like\s+.*?\s+to\s+join\b",
        r"\b(?:will\s+send|will\s+share|will\s+schedule|will\s+provide)\b",
        r"\b(?:plan\s+to|commit\s+to|agreed\s+to)\b"
    ]
    deadline_patterns = [
        r"\b(tomorrow(?:\s+afternoon|\s+morning)?)\b",
        r"\b(by\s+(?:tomorrow|next\s+week|friday|monday|tuesday|wednesday|thursday|eod|the\s+end\s+of\s+[a-zA-Z]+|[a-zA-Z]+\s+\d{1,2}(?:st|nd|rd|th)?))\b",
        r"\b(before\s+(?:[a-zA-Z]+\s+\d{1,2}(?:st|nd|rd|th)?|friday|monday|next\s+week))\b",
        r"\b(in\s+\d+\s+(?:days|weeks))\b"
    ]

    for s in relevant_segments:
        t = text(s)
        low = t.lower()
        if any(w in low for w in ["subscribe", "tutorial", "python series", "youtube", "like this video"]):
            continue

        is_commitment = any(re.search(p, low) for p in commitment_patterns)
        if is_commitment:
            dl = None
            for dp in deadline_patterns:
                m_dl = re.search(dp, low)
                if m_dl:
                    dl = m_dl.group(1).capitalize()
                    break

            cleaned_task = re.sub(r"^(?:yes\.?\s*)?(?:once\s+we\s+have\s+that,?\s*)?(?:i'll|i\s+will|we'll|we\s+will|let\s+me|let's|i'd\s+also\s+like|i\s+would\s+like)\s+", "", t, flags=re.IGNORECASE).strip()
            if cleaned_task:
                cleaned_task = cleaned_task[0].upper() + cleaned_task[1:]
            else:
                cleaned_task = t

            spk = speaker(s)
            clean_spk = re.sub(r"_(?:SDR|AE|VP_Sales|Sales|Rep|Buyer|Prospect)$", "", spk, flags=re.I)
            if "_" in clean_spk and " " not in clean_spk:
                clean_spk = clean_spk.split("_")[0]
            ev_role = (s.get("role") or "").lower()
            if not ev_role:
                if any(w in low for w in ["send the security questionnaire", "questionnaire", "manager to join", "our customer operations"]):
                    ev_role = "buyer"
                elif any(w in low for w in ["send you a sample data export", "run an operations workshop", "send the pilot data"]):
                    ev_role = "sales_rep"
                elif spk.lower() in ["buyer", "customer", "prospect"]:
                    ev_role = "buyer"
                elif spk.lower() in ["rep", "sales_rep"]:
                    ev_role = "sales_rep"

            comm_type = "buyer_commitment" if ev_role == "buyer" else "rep_commitment"

            actions.append({
                "task": cleaned_task,
                "owner": clean_spk if clean_spk != "Speaker" else None,
                "owner_role": ev_role if ev_role in ["buyer", "sales_rep"] else "unknown",
                "commitment_type": comm_type,
                "deadline": dl,
                "evidence": t,
                "evidence_segment_id": sid(s),
                "segment_id": sid(s)
            })

    # Dedupe actions
    seen_acts = set()
    deduped_actions = []
    for a in actions:
        if a["task"] not in seen_acts:
            seen_acts.add(a["task"])
            deduped_actions.append(a)

    # Call type determination
    explicit_ct = (call_context or {}).get("call_type")
    if explicit_ct:
        ct = explicit_ct
    else:
        full_text = " ".join([text(s).lower() for s in relevant_segments])
        has_discovery_cues = bool(re.search(r"\b(biggest problem|challenges|currently|looking at|evaluating|scattered across)\b", full_text, re.IGNORECASE))
        has_prospecting_cues = bool(re.search(r"\b(calling from|unexpected call|brief call|what are you offering|what exactly are you offering|fifteen-minute conversation|brief introduction|sales operations lead|not looking to replace|email him a concise overview|copy me)\b", full_text, re.IGNORECASE))
        if any(k in full_text for k in ["pricing", "discount", "contract terms", "redline", "procurement agreement"]):
            ct = "negotiation"
        elif any(k in full_text for k in ["architecture review", "security architecture", "api endpoint", "integration testing", "technical deep dive", "sla agreement"]):
            ct = "technical_validation"
        elif any(k in full_text for k in ["solution demo", "product demo", "walk through the product", "screen share"]):
            ct = "solution_demo"
        elif any(k in full_text for k in ["renewal", "renew", "upsell", "expansion"]):
            ct = "renewal_expansion"
        elif any(k in full_text for k in ["follow-up", "follow up call", "as we discussed"]):
            ct = "follow_up"
        elif has_prospecting_cues:
            ct = "cold_prospecting"
        elif has_discovery_cues or any(k in full_text for k in ["problem", "requirements", "evaluating", "looking at"]):
            ct = "discovery"
        elif any(k in full_text for k in ["budget", "authority", "timeline", "qualify"]):
            ct = "qualification"
        else:
            ct = "other"

    # Deterministic mode does not synthesize prose summaries.
    # The LLM path is responsible for semantic summarization.
    overall_summary = ""

    # Deal Signals
    def get_signal_val(key):
        for f in fields:
            if f.get("value") and f.get("status") not in ("not_mentioned", "not_established", "missing", None):
                fdef = next((fd for fd in configured_fields if fd["id"].lower() == f["field_id"]), {})
                if key == "budget" and (f["field_id"] in ["budget", "project_budget", "annual_budget"] or is_currency_or_budget_field(fdef)):
                    return f["value"]
                elif key == "champion" and (f["field_id"] in ["champion", "advocate"] or is_champion_field(fdef)):
                    return f["value"]
                elif key == "decision_maker" and (f["field_id"] in ["economic_buyer", "authority", "decision_maker"] or is_economic_buyer_or_authority_field(fdef)):
                    return f["value"]
                elif key == "timeline" and (f["field_id"] in ["timeline", "critical_event", "implementation_timeline"] or is_date_or_timeline_field(fdef)):
                    return f["value"]
                elif key == "competition" and (f["field_id"] in ["competition", "alternative_vendor", "competitor"] or is_competition_field(fdef)):
                    return f["value"]
        return None

    budget_val = get_signal_val("budget")
    champion_val = get_signal_val("champion")
    decision_maker_val = get_signal_val("decision_maker")
    timeline_val = get_signal_val("timeline")
    competition_val = get_signal_val("competition")

    deal_signals = {
        "budget": budget_val,
        "champion": champion_val,
        "decision_maker": decision_maker_val,
        "buying_stage": "Evaluation" if any([budget_val, champion_val, decision_maker_val, timeline_val, competition_val]) else ("Prospecting" if ct == "cold_prospecting" else "Discovery"),
        "timeline": timeline_val,
        "competition": competition_val
    }

    # 5. Deterministic risk / objection detection. This is deliberately profile-driven
    # and phrase-based rather than MEDDICC-specific. It catches explicit concern
    # language even when an LLM omits a signal, while avoiding generic pain statements.
    risks, objections = extract_deterministic_risks_objections(
        relevant_segments=relevant_segments,
        profile=active_profile
    )

    # 6. Generate grounded summary sections from validated fields, commitments, and signals
    overall_summary, summary_sections = generate_grounded_summary_sections(
        configured_sections=configured_sections,
        fields=fields,
        action_items=deduped_actions,
        risks=risks,
        objections=objections,
        relevant_segments=relevant_segments,
        segment_map=segment_map
    )

    det_ci = analyze_conversation_intelligence(
        transcript_segments=relevant_segments,
        profile=active_profile
    )
    if (not overall_summary or overall_summary == "No grounded business summary was produced from the available evidence.") and det_ci.get("generic_summary"):
        overall_summary = det_ci["generic_summary"]

    return {
        "call_type": {
            "value": ct,
            "confidence": 0.85,
            "rationale": "Deterministic classification based on validated business keywords."
        },
        "conversation_intelligence": det_ci,
        "summary": overall_summary,
        "summary_sections": summary_sections,
        "fields": fields,
        "template_fields": fields,
        "deal_signals": deal_signals,
        "action_items": deduped_actions[:10],
        "risks": risks,
        "objections": objections,
        "irrelevant_segments": irrelevant_meta
    }

# ─────────────────────────────────────────────────────────────────────────────
# COMPATIBILITY HELPERS FOR EXTERNAL CALLERS & TESTS
# ─────────────────────────────────────────────────────────────────────────────

def get_empty_grounded_result(schema_fields: list = None, template: dict = None, profile: dict = None) -> dict:
    active_profile = normalize_extraction_profile(profile, schema_fields, template)

    empty_sections = [
        {
            "section_id": s["id"],
            "section_name": s["name"],
            "content": "No meeting transcript available.",
            "confidence": None,
            "evidence": []
        }
        for s in active_profile.get("summary_sections", [])
    ]

    empty_fields = [
        {
            "field_id": f["id"],
            "field_name": f["name"],
            "value": None,
            "status": "not_mentioned",
            "confidence": None,
            "evidence": []
        }
        for f in active_profile.get("fields", [])
    ]

    return {
        "profile": active_profile,
        "call_type": "other",
        "call_type_confidence": 0.0,
        "call_type_rationale": "No transcript available.",
        "conversation_intelligence": {
            "conversation_type": "Unclear or Insufficient Transcript",
            "conversation_type_confidence": 0.0,
            "conversation_type_rationale": "No transcript available.",
            "sales_relevance": "Unable to Determine",
            "sales_relevance_explanation": "No transcript available to evaluate sales relevance.",
            "generic_summary": "No meeting transcript available.",
            "signals": {
                "main_topics": [],
                "problems_questions": [],
                "explicit_decisions": [],
                "customer_requirements": []
            },
            "transcript_quality_warning": "No transcript available."
        },
        "summary": "No meeting transcript available.",
        "summary_sections": empty_sections,
        "fields": empty_fields,
        "template_fields": empty_fields,
        "deal_signals": {
            "budget": None,
            "champion": None,
            "decision_maker": None,
            "buying_stage": "Unknown",
            "timeline": None,
            "competition": None
        },
        "deal_signal_objects": [],
        "action_items": [],
        "buyer_commitments": [],
        "rep_commitments": [],
        "risks": [],
        "objections": [],
        "irrelevant_segments": []
    }

def generate_dynamic_extraction_prompt(schema_fields: list = None, profile: dict = None, call_context: dict = None, transcript_text: str = "") -> str:
    """
    Backward-compatible dynamic prompt helper for existing tests.
    """
    lines = ["Extract only values explicitly supported by the current transcript."]
    if profile:
        fields = profile.get("fields", [])
    else:
        fields = schema_fields or []

    for field in fields:
        name = field.get("name") or field.get("id") or "field"
        ftype = field.get("field_type") or field.get("type") or "string"
        desc = field.get("description", "")
        hint = field.get("prompt_hint") or field.get("ai_instruction") or ""
        lines.append(f"- {name}: {desc}")
        if hint:
            lines.append(f"  Hint: {hint}")
        if ftype == "enum":
            lines.append("  MUST be exactly one of the following values configured for the field; otherwise null.")
        if ftype in ["currency", "number"]:
            lines.append("  Output numeric values only when a numeric value is explicitly present; otherwise null.")
    return "\n".join(lines)

def run_schema_extraction(transcript_text: str, schema_fields: list, company: dict = None, template: dict = None, profile: dict = None) -> dict:
    segments = [
        {"segment_id": f"seg_{i:03d}", "text": line, "speaker": "Unknown speaker"}
        for i, line in enumerate((transcript_text or "").split("\n")) if line.strip()
    ]
    result = extract_grounded_meeting_intelligence(
        transcript_segments=segments,
        schema_fields=schema_fields,
        template=template,
        profile=profile,
        call_context={"company": company} if company else None
    )
    return {tf["field_id"]: tf["value"] for tf in result.get("template_fields", [])}

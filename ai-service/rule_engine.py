"""
PulseSync AI — Dynamic Schema-Driven Rule Engine
=================================================
A lightweight, deterministic, schema-driven rule engine that works alongside
the LLM-based extraction system to:
1. Eliminate false-positive extractions across arbitrary user schemas.
2. Prevent irrelevant transcript content (such as instructional programming tutorials,
   casual chatter, and hypothetical examples) from mapping to business fields.
3. Enforce strict evidence-based grounding and data type conformance.
4. Preserve domain flexibility: technical schemas can legitimately extract technical entities,
   while business/sales schemas strictly reject instructional/tutorial discourse.
"""

import re
import logging
from typing import Any, Dict, List, Optional, Tuple, Set

logger = logging.getLogger("pulsesync-ai-service.rule_engine")


# ─────────────────────────────────────────────────────────────────────────────
# 1. DISCOURSE & MODALITY PATTERNS
# ─────────────────────────────────────────────────────────────────────────────

# Patterns indicative of instructional, tutorial, or pedagogical programming discourse.
# e.g. "if you want X, you have to mention/use/import Y", "that's how basically you use a package"
INSTRUCTIONAL_TUTORIAL_PATTERNS = [
    # Conditional tutorial instructions ("if you want X so/then you have to mention/use/import/type/say Y")
    re.compile(
        r"\b(?:so\s+)?if\s+you\s+(?:want|need|wish)\s+(?:to\s+)?(?:[a-zA-Z0-9_.*\- ]+?)\s*(?:,\s*|\s+so\s+|\s+then\s+)(?:you\s+(?:have\s+to|should|can|must|simply|just)\s+)?(?:mention|import|type|write|run|click|use|add|install|create|put|say|call)\b",
        re.IGNORECASE
    ),
    # "if you want all the files, you can simply say star"
    re.compile(
        r"\bif\s+you\s+(?:want|need)\s+(?:all\s+the\s+files|to\s+import|to\s+go\s+inside|others\s+and\s+tools|to\s+use)\b",
        re.IGNORECASE
    ),
    # Pedagogical explanations of syntax or code structure
    re.compile(
        r"\bthat['’]?s\s+how\s+(?:basically\s+)?you\s+(?:use|create|import|define|structure|set\s*up|implement)\s+(?:a\s+)?(?:package|folder|class|syntax|notebook|data\s*frame|library|connector|structure)\b",
        re.IGNORECASE
    ),
    re.compile(
        r"\b(?:so\s+)?that['’]?s\s+how\s+basically\s+you\s+use\b",
        re.IGNORECASE
    ),
    # Hypothetical tutorial setup ("let's say if I create a new file", "let's say we have other folder")
    re.compile(
        r"\blet['’]?s\s+say\s+(?:if\s+)?(?:i|we)\s+(?:have|create|make|name|move|say|import|run)\s+(?:a\s+)?(?:folder|file|class|package|notebook|calc|new\s+file)\b",
        re.IGNORECASE
    ),
    # Pedagogical quiz/rhetorical questions to students
    re.compile(
        r"\b(?:now\s+)?my\s+question\s+to\s+you\s+is\b",
        re.IGNORECASE
    ),
    re.compile(
        r"\bdon['’]?t\s+you\s+think\s+(?:[a-zA-Z0-9_]+\s+is\s+also\s+a\s+class|string\s+is\s+also\s+a\s+class)\b",
        re.IGNORECASE
    ),
    # Code syntax mechanics explanation
    re.compile(
        r"\b(?:this\s+class|system\s+class)\s+belongs\s+to\s+(?:our\s+)?package\b",
        re.IGNORECASE
    ),
    re.compile(
        r"\b(?:by\s+default\s+every\s+java\s+file|java\.lang\s+by\s+default|in\s+folder\s+structure\s+we\s+use\s+slash)\b",
        re.IGNORECASE
    ),
    # UI tour / presentation narration
    re.compile(
        r"\bi['’]?m\s+just\s+giving\s+you\s+a\s+quick\s+overview\s+of\s+the\s+ui\b",
        re.IGNORECASE
    ),
    re.compile(
        r"\bnow\s+we\s+will\s+look\s+at\s+(?:data\s*frame\s+basics|the\s+basics)\b",
        re.IGNORECASE
    ),
    re.compile(
        r"\bwelcome\s+back\s+to\s+(?:the|my)\s+channel\b",
        re.IGNORECASE
    ),
    re.compile(
        r"\blike\s+and\s+subscribe\b",
        re.IGNORECASE
    )
]

# Genuine customer requirement & business pain cues
GENUINE_CUSTOMER_NEED_PATTERNS = [
    re.compile(r"\bwe\s+(?:urgently\s+)?(?:need|require|are\s+looking\s+for|must\s+have|have\s+to\s+have)\b", re.I),
    re.compile(r"\bour\s+(?:team|company|organization|department)\s+(?:needs|requires|is\s+looking\s+for|wants|struggles\s+with)\b", re.I),
    re.compile(r"\bour\s+(?:primary|main|biggest|core|key)\s+(?:need|requirement|goal|objective|challenge|problem|priority)\b", re.I),
    re.compile(r"\bi(?:'d| would)?\s+want\s+(?:the\s+system|the\s+platform|the\s+tool|the\s+solution|it)\s+to\b", re.I),
    re.compile(r"\blooking\s+for\s+a\s+(?:tool|solution|platform|system|software|vendor|partner)\b", re.I),
    re.compile(r"\bneeded\s+for\s+(?:rollout|adoption|our\s+workflow|compliance|security)\b", re.I),
    re.compile(r"\bwe\s+(?:really\s+)?want\s+to\s+(?:automate|reduce|eliminate|streamline|integrate|solve)\b", re.I),
    re.compile(r"\bcustomer\s+calls\s+ends?\s+up\s+scattered\b", re.I),
    re.compile(r"\bspends?\s+(?:several|\d+)\s+hours\b", re.I),
    re.compile(r"\bthe\s+biggest\s+problem\s+is\b", re.I),
    re.compile(r"\boverwhelmed\s+(?:handling|with)\b", re.I)
]


# ─────────────────────────────────────────────────────────────────────────────
# 2. DYNAMIC RULE ENGINE CLASS
# ─────────────────────────────────────────────────────────────────────────────

class DynamicRuleEngine:
    """
    Schema-driven, multi-tier rule engine for validating extraction candidates.
    Works dynamically for any configured schema without hardcoding framework names.
    """

    @classmethod
    def is_programming_or_syntax_field(cls, field_def: Dict[str, Any]) -> bool:
        """
        Dynamically detects if the field definition itself asks for programming language,
        syntax, code, imports, or tutorial mechanics.
        """
        if not isinstance(field_def, dict):
            return False
        corpus = " ".join([
            str(field_def.get("id") or ""),
            str(field_def.get("name") or ""),
            str(field_def.get("description") or ""),
            str(field_def.get("semantic_contract") or ""),
            str(field_def.get("ai_instruction") or "")
        ]).lower().replace("_", " ")

        code_terms = [
            "programming language", "source code", "syntax", "code snippet",
            "import syntax", "package structure", "class name", "method",
            "function", "pyspark", "spark dataframe", "pandas", "java package",
            "tutorial topic", "code example"
        ]
        return any(term in corpus for term in code_terms)

    @classmethod
    def is_instructional_or_hypothetical_discourse(cls, text: str, field_def: Optional[Dict[str, Any]] = None) -> bool:
        """
        Detects whether an excerpt is an instructional tutorial, programming guide,
        hypothetical code demonstration, or educational meta-discourse.
        If field_def specifically asks for code/syntax, tutorial discourse is permitted.
        """
        if not text:
            return False
        
        # If the field explicitly asks for code or syntax, do not filter out programming discourse
        if field_def and cls.is_programming_or_syntax_field(field_def):
            return False

        clean_text = str(text).strip()
        for pattern in INSTRUCTIONAL_TUTORIAL_PATTERNS:
            if pattern.search(clean_text):
                return True
        return False

    @classmethod
    def has_genuine_customer_need_signal(cls, text: str) -> bool:
        """
        Checks if the text contains genuine customer requirement / business pain signals,
        as opposed to incidental use of words like 'want' or 'need' in tutorial grammar.
        """
        if not text:
            return False
        for pattern in GENUINE_CUSTOMER_NEED_PATTERNS:
            if pattern.search(text):
                return True
        return False

    @classmethod
    def validate_schema_type(
        cls,
        value: Any,
        field_type: str,
        options: Optional[List[str]] = None,
        evidence_text: str = ""
    ) -> Tuple[bool, Any, Optional[str]]:
        """
        Tier 1: Deterministic Schema Rules.
        Validates value conformance against the schema-defined data type.
        """
        if value is None or str(value).strip() == "":
            return False, None, "Value is empty"

        ftype = (field_type or "text").lower().strip()
        sval = str(value).strip()
        ev_low = (evidence_text or "").lower()

        # 1. Currency
        if ftype == "currency":
            # Must contain monetary symbol, currency unit, or standard k/m monetary amount
            m = re.findall(r"(?:[$€£]\s*\d[\d,]*(?:\.\d+)?(?:\s*[kKmM])?|\b\d[\d,]*(?:\.\d+)?\s*(?:usd|dollars|eur|euros|gbp|pounds)\b)", sval, re.I)
            if not m:
                # Check if evidence has it
                ev_m = re.findall(r"(?:[$€£]\s*\d[\d,]*(?:\.\d+)?(?:\s*[kKmM])?|\b\d[\d,]*(?:\.\d+)?\s*(?:usd|dollars|eur|euros|gbp|pounds)\b)", evidence_text, re.I)
                if ev_m:
                    return True, ev_m[-1], None
                return False, None, "Currency field lacks monetary expression"
            return True, m[-1], None

        # 2. Number
        if ftype == "number":
            num_match = re.search(r"[-+]?\d+(?:\.\d+)?", sval)
            if not num_match:
                return False, None, "Number field lacks numeric value"
            return True, num_match.group(0), None

        # 3. Boolean
        if ftype == "boolean":
            norm = sval.lower()
            if norm in {"true", "yes", "confirmed", "1"}:
                return True, "true", None
            if norm in {"false", "no", "rejected", "0"}:
                return True, "false", None
            return False, None, "Boolean field must resolve to true or false"

        # 4. Enum
        if ftype == "enum" and options:
            matched = next((opt for opt in options if str(opt).strip().lower() == sval.lower()), None)
            if not matched:
                return False, None, f"Value '{sval}' does not match configured options: {options}"
            if ev_low and matched.lower() not in ev_low:
                return False, None, f"Enum option '{matched}' not grounded in evidence quote"
            return True, matched, None

        # 5. Multi-select
        if ftype == "multi_select" and options:
            items = value if isinstance(value, list) else [x.strip() for x in sval.split(",") if x.strip()]
            matched = [opt for opt in options if any(str(opt).lower() == item.lower() for item in items)]
            if not matched:
                return False, None, f"None of the values match configured options: {options}"
            if ev_low:
                matched_grounded = [opt for opt in matched if opt.lower() in ev_low]
                if not matched_grounded:
                    return False, None, "Multi-select options not grounded in evidence quote"
                matched = matched_grounded
            return True, matched if isinstance(value, list) else ", ".join(matched), None

        # 6. Date / Datetime
        if ftype in {"date", "datetime"}:
            date_match = re.search(r"\b(before\s+[a-zA-Z0-9\s]+|by\s+[a-zA-Z0-9\s]+|q[1-4]|202[4-9]|january|february|march|april|may|june|july|august|september|october|november|december|in\s+\d+\s+(?:days|weeks|months)|next\s+(?:week|month|quarter)|tomorrow)\b", sval, re.I)
            if not date_match and evidence_text:
                date_match = re.search(r"\b(before\s+[a-zA-Z0-9\s]+|by\s+[a-zA-Z0-9\s]+|q[1-4]|202[4-9]|january|february|march|april|may|june|july|august|september|october|november|december|in\s+\d+\s+(?:days|weeks|months)|next\s+(?:week|month|quarter)|tomorrow)\b", evidence_text, re.I)
                if date_match:
                    return True, date_match.group(0), None
            if not date_match:
                return False, None, "Date field lacks recognizable temporal expression"
            return True, date_match.group(0), None

        # 7. Text
        return True, sval, None

    @classmethod
    def validate_candidate(
        cls,
        candidate_value: Any,
        evidence_list: List[Dict[str, Any]],
        field_def: Dict[str, Any],
        semantic_family: str = "general",
        conversation_context: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, Any, Optional[str]]:
        """
        Main validation entry point for the Dynamic Rule Engine.
        Executes:
        - Tier 1: Type & Grounding validation.
        - Tier 1.5: Discourse & Modality filtering (rejecting tutorial/syntax guides for business fields).
        - Tier 2: Semantic Contract & Polarity validation.
        """
        fdef = field_def or {}
        ftype = str(fdef.get("type") or fdef.get("field_type") or "text").lower().strip()

        # Check evidence presence
        if not evidence_list or not isinstance(evidence_list, list):
            return False, None, "Evidence list is empty"

        quotes = [str(e.get("quote") or "") for e in evidence_list if isinstance(e, dict)]
        evidence_text = " ".join(quotes).strip()
        if not evidence_text:
            return False, None, "Evidence text is empty"

        # Tier 1: Type validation
        type_ok, normalized_val, err_msg = cls.validate_schema_type(
            candidate_value,
            ftype,
            options=fdef.get("options"),
            evidence_text=evidence_text
        )
        if not type_ok:
            return False, None, err_msg

        # Tier 1.5: Discourse & Modality filtering
        # Check if the evidence is instructional/tutorial language while the field expects business concepts
        is_instructional = cls.is_instructional_or_hypothetical_discourse(evidence_text, fdef)
        if is_instructional:
            # If the field is a business field (need, pain, criteria, budget, timeline, authority, etc.), reject!
            if semantic_family in {"need", "feature", "pain", "decision_criteria", "decision_process", "budget", "timeline", "economic_buyer", "champion", "risk", "metrics"}:
                return False, None, "Rejected: Evidence is instructional/tutorial discourse, not a business statement"

        # Tier 2: Semantic Family Contract Validation
        val_str = str(normalized_val).strip()
        val_low = val_str.lower()
        ev_low = evidence_text.lower()

        # Hard Negation check
        negated_patterns = {
            "budget": r"\b(?:no|not|neither)\s+(?:budget|funding|allocation|spend)\b",
            "timeline": r"\b(?:no|not|neither)\s+(?:timeline|deadline|date|schedule)\b",
            "competition": r"\b(?:not|never|no)\s+(?:evaluating|considering|looking at|testing|trialing)\b",
            "economic_buyer": r"\b(?:do\s+not|don['’]t|does\s+not|doesn['’]t|no|neither)\s+have\s+(?:sign-?off\s+)?authority\b",
            "champion": r"\b(?:haven['’]t|have\s+not)\s+assigned\s+(?:anyone|anybody)\b|\b(?:no|not)\s+(?:champion|internal\s+advocate)\b"
        }
        if semantic_family in negated_patterns:
            if re.search(negated_patterns[semantic_family], ev_low):
                return False, None, f"Rejected: Negated claim for {semantic_family}"

        # Need & Feature contract
        if semantic_family in {"need", "feature"}:
            # A need statement must represent an actual requirement or desired outcome
            # Reject rep commitment phrases or conversational fillers
            if re.search(r"^\s*(?:i['’]ll|i\s+will|we['’]ll|we\s+will|could you|can you|please|thanks for joining)\b", val_low):
                return False, None, "Rejected: Rep action or politeness is not a customer need"

            # Check for genuine need signals vs. syntax tutorial instructions
            has_explicit_need_keywords = bool(re.search(
                r"\b(?:need(?:s|ed)?|require(?:s|d|ment)?|looking\s+for|goal|objective|should\s+support|must\s+support|must\s+have|use\s+case|desired\s+capability|we\s+want|team\s+wants|i['’]d\s+want\s+the\s+system\s+to|sub-second\s+latency|bidirectional)\b",
                ev_low
            ))
            if not has_explicit_need_keywords:
                return False, None, "Rejected: Evidence lacks clear requirement/need semantics"

            # If evidence contains conditional tutorial language ("if you want X so you have to mention Y"),
            # ensure it's not a programming instruction
            if re.search(r"\bif\s+you\s+want\b", ev_low) and not cls.has_genuine_customer_need_signal(ev_low):
                if re.search(r"\b(?:mention|import|dot\s*star|package|folder\s+structure|calc|tools\.star)\b", ev_low):
                    return False, None, "Rejected: Tutorial syntax explanation is not a customer need"

        # Pain points contract
        elif semantic_family == "pain":
            if "?" in val_low:
                return False, None, "Rejected: Questions do not state customer pain"
            if re.search(r"^\s*(?:i['’]ll|i\s+will|we['’]ll|we\s+will|could you|can you|please)\b", val_low):
                return False, None, "Rejected: Rep commitment is not customer pain"
            pain_keywords = bool(re.search(
                r"\b(?:problem|pain|challenge|bottleneck|friction|difficult|struggle|manual|scattered|fragmented|hours?|overhead|waste|slow|delay|issue|burden|overwhelmed)\b",
                val_low
            ))
            if not pain_keywords:
                return False, None, "Rejected: Candidate value lacks customer pain/problem cues"

        # Decision Criteria contract
        elif semantic_family == "decision_criteria":
            if "?" in val_low:
                return False, None, "Rejected: Questions do not state criteria"
            criteria_keywords = bool(re.search(
                r"\b(?:must|need(?:s)?|require(?:s|ment)?|criteria|important|should|without|ability|capable|automatically|minimal|lightweight|no extra|avoid|works? without|support(?:s)?|simple|easy to adopt|low effort|consistent view)\b",
                val_low
            ))
            if not criteria_keywords:
                return False, None, "Rejected: Candidate value lacks decision criteria cues"

        # Decision Process contract
        elif semantic_family == "decision_process":
            if "?" in val_low:
                return False, None, "Rejected: Questions do not state decision process"
            stage_cues = set(re.findall(
                r"\b(?:pilot|evaluation|evaluate|security review|security|questionnaire|workshop|approval|approve|procurement|legal review|finance review|demo|trial|validation|negotiation|signature|purchase|decision stage|milestone|phase|selection)\b",
                val_low
            ))
            sequence_cues = bool(re.search(
                r"\b(?:then|after|before|once|following|next|stage|step|process|sequence|approval|sign[- ]?off|procurement|select|selection|purchase|decision)\b",
                val_low
            ))
            if len(stage_cues) < 2 and not sequence_cues:
                return False, None, "Rejected: Insufficient decision process stages or sequence"

        return True, normalized_val, None

    @classmethod
    def extract_candidate_value(
        cls,
        field_def: Dict[str, Any],
        segment: Dict[str, Any],
        semantic_family: str = "general"
    ) -> Optional[str]:
        """
        Dynamically extracts a clean, substantive candidate value from a transcript segment.
        Rejects instructional/tutorial sentences from becoming candidate values for business fields.
        """
        if not isinstance(segment, dict):
            return None
        text = (segment.get("corrected_text") or segment.get("text") or "").strip()
        if not text:
            return None
        low = text.lower()
        fdef = field_def or {}
        ftype = str(fdef.get("type") or fdef.get("field_type") or "text").lower().strip()

        # Reject tutorial/instructional discourse for business fields immediately
        if semantic_family in {"need", "feature", "pain", "decision_criteria", "decision_process", "budget", "timeline", "economic_buyer", "champion", "risk", "metrics"}:
            if cls.is_instructional_or_hypothetical_discourse(text, fdef):
                return None

        # Currency
        if semantic_family == "budget" or ftype == "currency":
            amounts = re.findall(r"(?:[$€£]\s*\d[\d,]*(?:\.\d+)?(?:\s*[kKmM])?|\b\d[\d,]*(?:\.\d+)?\s*(?:usd|dollars|eur|euros|gbp|pounds)\b)", text, re.I)
            return amounts[-1] if amounts else None

        # Date / Timeline
        if semantic_family == "timeline" or ftype in {"date", "datetime"}:
            times = re.findall(r"\b(before\s+[a-zA-Z0-9\s]+|by\s+[a-zA-Z0-9\s]+|q[1-4]|202[4-9]|january|february|march|april|may|june|july|august|september|october|november|december|in\s+\d+\s+(?:days|weeks|months)|next\s+(?:week|month|quarter)|tomorrow)\b", text, re.I)
            if times:
                return times[-1]
            return None

        # Number
        if ftype == "number":
            m = re.search(r"[-+]?\d+(?:\.\d+)?", text)
            return m.group(0) if m else None

        # Boolean
        if ftype == "boolean":
            if re.search(r"\b(?:yes|true|confirmed|we do|we have|we will)\b", low):
                return "true"
            if re.search(r"\b(?:no|false|rejected|we do not|we don't|we have not|we haven't)\b", low):
                return "false"
            return None

        # Enum
        if ftype == "enum" and fdef.get("options"):
            for opt in fdef["options"]:
                if str(opt).lower() in low:
                    return str(opt)
            return None

        # Multi-select
        if ftype == "multi_select" and fdef.get("options"):
            matched = [str(opt) for opt in fdef["options"] if str(opt).lower() in low]
            return matched or None

        # For economic buyer / champion, return speaker if grounded
        if semantic_family in {"economic_buyer", "champion"}:
            if any(w in low for w in ["haven't assigned", "have not assigned", "no champion", "haven't decided", "do not have", "don't have"]):
                return None
            spk = segment.get("speaker") or segment.get("speaker_name")
            return spk if spk not in {None, "", "Speaker", "Unknown Speaker"} else None

        # For need, feature, pain:
        if semantic_family in {"need", "feature"}:
            if not cls.has_genuine_customer_need_signal(text):
                # If it doesn't have genuine customer need signals, do not fall back to text.strip()
                # unless it contains explicit requirement keywords without tutorial grammar
                if not re.search(r"\b(?:we\s+need|must\s+support|must\s+have|required\s+for|looking\s+for\s+a)\b", low):
                    return None

        # Reject conversational politeness or rep action commitments
        if semantic_family in {"decision_criteria", "decision_process", "pain", "need", "feature", "risk", "metrics"}:
            if re.search(r"\b(?:i['’]ll|i\s+will|we['’]ll|we\s+will|could you|can you|please|thanks for joining)\b", low):
                return None

        return text.strip()

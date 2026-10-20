import logging
import json

class DiarizationLogger:
    """
    Captures detailed step-by-step diarization decisions and alignment actions
    for analytical auditing and quality evaluation.
    """
    def __init__(self, meeting_id: str):
        self.meeting_id = meeting_id
        self.heuristic_decisions = []
        self.llm_refinements = []
        self.post_process_actions = []
        self.qa_metrics = {}

    def log_heuristic_decision(self, segment_idx: int, text: str, assigned_speaker: str, confidence: float, reason: str):
        self.heuristic_decisions.append({
            "segment_idx": segment_idx,
            "text": text[:40] + "..." if len(text) > 40 else text,
            "speaker": assigned_speaker,
            "confidence": confidence,
            "reason": reason
        })

    def log_llm_refinement(self, segment_idx: int, before_speaker: str, after_speaker: str, text: str):
        self.llm_refinements.append({
            "segment_idx": segment_idx,
            "before": before_speaker,
            "after": after_speaker,
            "text": text[:40] + "..." if len(text) > 40 else text,
            "changed": before_speaker != after_speaker
        })

    def log_post_processing(self, action: str, segment_idx: int, details: str):
        self.post_process_actions.append({
            "action": action,
            "segment_idx": segment_idx,
            "details": details
        })

    def set_qa_metrics(self, metrics: dict):
        self.qa_metrics = metrics

    def generate_debug_report(self) -> str:
        """
        Formats the captured decision history into a highly readable 
        plain text report for debugging.
        """
        report = []
        report.append("=" * 80)
        report.append(f"DIARIZATION DEBUG REPORT FOR MEETING: {self.meeting_id}")
        report.append("=" * 80)
        
        # 1. QA Metrics Summary
        report.append("\n[1] DIARIZATION QA QUALITY METRICS:")
        if self.qa_metrics:
            for k, v in self.qa_metrics.items():
                report.append(f"  - {k.replace('_', ' ').title()}: {v}")
        else:
            report.append("  No QA metrics available.")

        # 2. Heuristic Pre-segmentation Decisions
        report.append("\n[2] HEURISTIC PRE-SEGMENTATION DECISION TRAIL:")
        if self.heuristic_decisions:
            report.append(f"  {'Idx':<5} | {'Assigned Speaker':<18} | {'Conf':<6} | {'Reason / Cues':<30} | {'Text Preview'}")
            report.append("  " + "-" * 88)
            for d in self.heuristic_decisions[:20]: # Cap first 20 for brief readability
                report.append(f"  {d['segment_idx']:<5} | {d['speaker']:<18} | {d['confidence']:<6.2f} | {d['reason']:<30} | \"{d['text']}\"")
            if len(self.heuristic_decisions) > 20:
                report.append(f"  ... and {len(self.heuristic_decisions) - 20} more segments ...")
        else:
            report.append("  No heuristic decisions logged.")

        # 3. LLM Refinements
        report.append("\n[3] LLM DIARIZATION REFINEMENT COMPARISONS:")
        changes = [r for r in self.llm_refinements if r["changed"]]
        if self.llm_refinements:
            report.append(f"  Total Segments Evaluated: {len(self.llm_refinements)}")
            report.append(f"  LLM Speaker Changes Triggered: {len(changes)}")
            if changes:
                report.append(f"  {'Idx':<5} | {'Heuristic Prior':<18} | {'LLM Refined Post':<18} | {'Text Preview'}")
                report.append("  " + "-" * 70)
                for c in changes[:15]:
                    report.append(f"  {c['segment_idx']:<5} | {c['before']:<18} | {c['after']:<18} | \"{c['text']}\"")
                if len(changes) > 15:
                    report.append(f"  ... and {len(changes) - 15} more corrections ...")
            else:
                report.append("  No speaker adjustments made by the LLM (100% agreement).")
        else:
            report.append("  No LLM refinements logged.")

        # 4. Post-processing Actions
        report.append("\n[4] POST-PROCESSING SMOOTHING AND ANCHORING:")
        if self.post_process_actions:
            for p in self.post_process_actions:
                report.append(f"  - [{p['action']}] Segment {p['segment_idx']}: {p['details']}")
        else:
            report.append("  No post-processing adjustments required.")

        report.append("\n" + "=" * 80)
        return "\n".join(report)

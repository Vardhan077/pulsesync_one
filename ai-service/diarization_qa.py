import numpy as np
import logging

logger = logging.getLogger("pulsesync-ai-service.diarization_qa")

def compute_distribution_entropy(participation_percentages: list) -> float:
    """
    Computes Shannon entropy of the speaker participation distribution.
    A low entropy indicates one speaker heavily dominates, while high entropy
    suggests even participation.
    """
    if not participation_percentages:
        return 0.0
    
    probs = [p / 100.0 for p in participation_percentages if p > 0]
    if not probs:
        return 0.0
        
    return float(-sum(p * np.log2(p) for p in probs))

def calculate_qa_metrics(segments: list, analytics: list, duration: float) -> dict:
    """
    Analyzes final diarized segments and conversation analytics to compute 
    advanced transcript and diarization quality metrics.
    """
    if not segments:
        return {
            "speaker_count": 0,
            "avg_speaker_confidence": 0.0,
            "low_confidence_segments": 0,
            "speaker_flip_rate": 0.0,
            "participation_entropy": 0.0,
            "diarization_grade": "N/A"
        }

    total_segments = len(segments)
    
    # 1. Speaker Confidence Metrics
    confidences = [seg.get("speaker_confidence", 0.80) for seg in segments]
    avg_confidence = float(np.mean(confidences))
    low_conf_count = sum(1 for c in confidences if c < 0.60)
    low_conf_percentage = round((low_conf_count / total_segments) * 100, 2) if total_segments > 0 else 0.0

    # 2. Speaker Flip Rate (Changes per minute)
    speaker_changes = 0
    for i in range(1, len(segments)):
        if segments[i]["speaker"] != segments[i-1]["speaker"]:
            speaker_changes += 1
            
    duration_minutes = max(0.1, duration / 60.0)
    flip_rate = round(speaker_changes / duration_minutes, 2)

    # 3. Participation Distribution Entropy
    participations = [a.get("participation", 0.0) for a in analytics]
    entropy = round(compute_distribution_entropy(participations), 3)

    # 4. Determine Overall Diarization Quality Grade
    # Deductions start from 100
    score = 100.0
    
    # Penalty for low average confidence
    if avg_confidence < 0.85:
        score -= (0.85 - avg_confidence) * 150
        
    # Penalty for high percentage of low-confidence segments
    score -= (low_conf_count / total_segments) * 50
    
    # Penalty for extremely high flip rates (indicates rapid flipping or jittery diarization)
    if flip_rate > 15.0:
        score -= min(30, (flip_rate - 15.0) * 2)

    # Convert score to letter grade
    if score >= 90:
        grade = "A"
    elif score >= 80:
        grade = "B"
    elif score >= 70:
        grade = "C"
    elif score >= 55:
        grade = "D"
    else:
        grade = "F"

    qa_metrics = {
        "speaker_count": len(analytics),
        "avg_speaker_confidence": round(avg_confidence, 2),
        "low_confidence_segments": low_conf_count,
        "low_confidence_percentage": low_conf_percentage,
        "speaker_flip_rate": flip_rate,
        "participation_entropy": entropy,
        "diarization_grade": grade,
        "raw_quality_score": round(max(0.0, min(100.0, score)), 2)
    }

    logger.info(f"Diarization QA complete. Score: {qa_metrics['raw_quality_score']} Grade: {grade}")
    return qa_metrics

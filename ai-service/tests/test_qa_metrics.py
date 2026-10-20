import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from diarization_qa import compute_distribution_entropy, calculate_qa_metrics

def test_distribution_entropy():
    # Empty
    assert compute_distribution_entropy([]) == 0.0
    
    # 100% single speaker participation -> entropy should be 0
    assert compute_distribution_entropy([100.0]) == 0.0
    
    # Perfect 50/50 split -> log2(2) = 1.0
    assert compute_distribution_entropy([50.0, 50.0]) == 1.0

def test_calculate_qa_metrics_grade():
    segments = [
        {"speaker": "Speaker 1", "start": 0.0, "end": 2.0, "speaker_confidence": 0.95},
        {"speaker": "Speaker 1", "start": 2.1, "end": 4.0, "speaker_confidence": 0.92},
        {"speaker": "Speaker 2", "start": 5.0, "end": 8.0, "speaker_confidence": 0.94}
    ]
    analytics = [
        {"speaker": "Speaker 1", "participation": 66.6},
        {"speaker": "Speaker 2", "participation": 33.3}
    ]
    
    metrics = calculate_qa_metrics(segments, analytics, duration=10.0)
    assert metrics["speaker_count"] == 2
    assert metrics["avg_speaker_confidence"] == 0.94
    assert metrics["low_confidence_segments"] == 0
    assert metrics["diarization_grade"] == "A"
    
    # Case with many low-confidence segments
    segments_low = [
        {"speaker": "Speaker 1", "start": 0.0, "end": 2.0, "speaker_confidence": 0.45},
        {"speaker": "Speaker 1", "start": 2.1, "end": 4.0, "speaker_confidence": 0.50},
        {"speaker": "Speaker 2", "start": 5.0, "end": 8.0, "speaker_confidence": 0.52}
    ]
    metrics_low = calculate_qa_metrics(segments_low, analytics, duration=10.0)
    assert metrics_low["diarization_grade"] in {"D", "F"}

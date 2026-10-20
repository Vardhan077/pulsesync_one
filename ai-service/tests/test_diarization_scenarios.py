import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
import numpy as np
from pipeline import WordProxy

# Lightweight test helper to simulate the core word-level overlap aligner, reconstruction, and merge logic in pipeline.py
def simulate_alignment_and_merge(words: list, diarized_turns: list, merge_threshold: float = 0.40) -> list:
    # 1. Word-level overlap alignment
    aligned_words = []
    for w in words:
      word_start = w.start
      word_end = w.end
      word_dur = max(0.01, word_end - word_start)
      
      assigned_speaker = "Unknown Speaker"
      max_overlap = 0.0
      
      for turn in diarized_turns:
        overlap_start = max(word_start, turn["start"])
        overlap_end = min(word_end, turn["end"])
        overlap = max(0.0, overlap_end - overlap_start)
        
        if overlap > max_overlap:
          max_overlap = overlap
          assigned_speaker = turn["speaker"]
          
      overlap_ratio = max_overlap / word_dur
      
      if max_overlap == 0.0 or overlap_ratio < 0.20:
        assigned_speaker = "Unknown Speaker"
        confidence = 0.0
      else:
        confidence = round(float(w.confidence * overlap_ratio), 3)
        
      aligned_words.append({
        "word": w.text,
        "start": word_start,
        "end": word_end,
        "speaker": assigned_speaker,
        "confidence": confidence
      })

    # 2. Reconstruction
    reconstructed_segments = []
    if aligned_words:
      current_speaker = aligned_words[0]["speaker"]
      current_start = aligned_words[0]["start"]
      current_end = aligned_words[0]["end"]
      current_words = [aligned_words[0]["word"]]
      current_confidences = [aligned_words[0]["confidence"]]
      
      for w in aligned_words[1:]:
        gap = w["start"] - current_end
        if w["speaker"] == current_speaker and (current_speaker == "Unknown Speaker" or gap < merge_threshold):
          current_words.append(w["word"])
          current_confidences.append(w["confidence"])
          current_end = w["end"]
        else:
          text = " ".join(current_words).strip()
          avg_conf = round(float(np.mean(current_confidences)), 3)
          reconstructed_segments.append({
            "speaker": current_speaker,
            "start": round(current_start, 2),
            "end": round(current_end, 2),
            "text": text,
            "confidence": avg_conf
          })
          
          current_speaker = w["speaker"]
          current_start = w["start"]
          current_end = w["end"]
          current_words = [w["word"]]
          current_confidences = [w["confidence"]]
          
      text = " ".join(current_words).strip()
      avg_conf = round(float(np.mean(current_confidences)), 3)
      reconstructed_segments.append({
        "speaker": current_speaker,
        "start": round(current_start, 2),
        "end": round(current_end, 2),
        "text": text,
        "confidence": avg_conf
      })

    # 3. Merge
    merged_segments = []
    if reconstructed_segments:
      current_seg = reconstructed_segments[0]
      
      for next_seg in reconstructed_segments[1:]:
        gap = next_seg["start"] - current_seg["end"]
        if (next_seg["speaker"] == current_seg["speaker"] and 
            current_seg["speaker"] != "Unknown Speaker" and 
            gap < merge_threshold):
          current_seg["text"] += " " + next_seg["text"]
          current_seg["end"] = next_seg["end"]
          current_seg["confidence"] = round((current_seg["confidence"] + next_seg["confidence"]) / 2.0, 3)
        else:
          merged_segments.append(current_seg)
          current_seg = next_seg
          
      merged_segments.append(current_seg)
      
    return merged_segments

def test_scenario_word_overlap_matching():
    # Words stream
    words = [
        WordProxy("Hello", 0.0, 0.4, 0.98),
        WordProxy("world", 0.5, 0.9, 0.99),
        WordProxy("Nicole", 2.0, 2.5, 0.95),
        WordProxy("here", 2.6, 3.0, 0.97)
    ]
    
    # Pyannote turns
    turns = [
        {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_00"},
        {"start": 2.0, "end": 3.2, "speaker": "SPEAKER_01"}
    ]
    
    merged = simulate_alignment_and_merge(words, turns)
    assert len(merged) == 2
    assert merged[0]["speaker"] == "SPEAKER_00"
    assert merged[0]["text"] == "Hello world"
    assert merged[1]["speaker"] == "SPEAKER_01"
    assert merged[1]["text"] == "Nicole here"

def test_scenario_unknown_speaker_mapping():
    # Words spoken with no overlapping speaker window
    words = [
        WordProxy("Silent", 5.0, 5.5, 0.90),
        WordProxy("noise", 5.6, 6.0, 0.92)
    ]
    turns = [
        {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_00"}
    ]
    
    merged = simulate_alignment_and_merge(words, turns)
    assert len(merged) == 1
    assert merged[0]["speaker"] == "Unknown Speaker"
    assert merged[0]["confidence"] == 0.0

def test_scenario_aggressive_gap_merging():
    # Gaps < 0.4 should be merged, gaps >= 0.4 preserved
    words = [
        WordProxy("First", 0.0, 0.5, 0.95),
        WordProxy("part", 0.6, 1.0, 0.96),  # Gap is 0.1s (< 0.4s) -> merge
        
        WordProxy("Second", 1.5, 2.0, 0.95), # Gap is 0.5s (>= 0.4s) -> do not merge!
        WordProxy("part", 2.1, 2.5, 0.96)   # Gap is 0.1s -> merge
    ]
    turns = [
        {"start": 0.0, "end": 3.0, "speaker": "SPEAKER_00"}
    ]
    
    merged = simulate_alignment_and_merge(words, turns, merge_threshold=0.40)
    assert len(merged) == 2
    assert merged[0]["text"] == "First part"
    assert merged[1]["text"] == "Second part"


def test_unknown_speaker_fallback_never_merges_entire_call():
    from pipeline import _build_unresolved_turns

    words = [
        WordProxy("hello", 0.0, 0.4, 0.95),
        WordProxy("there", 0.5, 0.9, 0.95),
        WordProxy("second", 4.0, 4.4, 0.95),
        WordProxy("turn", 4.5, 4.9, 0.95),
        WordProxy("third", 30.0, 30.4, 0.95),
    ]

    turns = _build_unresolved_turns(words, max_turn_seconds=18.0, pause_seconds=0.8)
    assert len(turns) == 3
    assert turns[0]["speaker"] == "Unknown Speaker"
    assert turns[0]["end"] < 1.0
    assert turns[1]["start"] >= 4.0
    assert turns[2]["start"] >= 30.0


def test_exclusive_empty_falls_back_to_regular_pyannote_annotation():
    from pipeline import _extract_best_pyannote_annotation

    class FakeAnnotation:
        def itertracks(self, yield_label=True):
            yield type("Turn", (), {"start": 0.0, "end": 1.0})(), None, "SPEAKER_00"
            yield type("Turn", (), {"start": 1.2, "end": 2.0})(), None, "SPEAKER_01"

    class FakeOutput:
        exclusive_speaker_diarization = FakeAnnotationEmpty = type("Empty", (), {"itertracks": lambda self, yield_label=True: iter(())})()
        speaker_diarization = FakeAnnotation()

    turns, mode = _extract_best_pyannote_annotation(FakeOutput())
    assert mode == "speaker_diarization"
    assert len(turns) == 2
    assert {t["speaker"] for t in turns} == {"SPEAKER_00", "SPEAKER_01"}


def test_case_1_two_speakers_alternating_turns():
    """Case 1: Two speakers alternating produce multiple speaker turns."""
    from pipeline import align_words_to_turns, reconstruct_speaker_turns

    words = [
        # Speaker 1 -> 10 seconds
        WordProxy("Intro", 0.0, 1.0, 0.98),
        WordProxy("from", 1.2, 2.0, 0.98),
        WordProxy("speaker", 2.2, 5.0, 0.98),
        WordProxy("one", 5.2, 9.8, 0.98),
        # Speaker 2 -> 12 seconds
        WordProxy("Response", 10.2, 12.0, 0.98),
        WordProxy("from", 12.2, 16.0, 0.98),
        WordProxy("speaker", 16.2, 20.0, 0.98),
        WordProxy("two", 20.2, 21.8, 0.98),
        # Speaker 1 -> 8 seconds
        WordProxy("Back", 22.2, 24.0, 0.98),
        WordProxy("to", 24.2, 27.0, 0.98),
        WordProxy("one", 27.2, 29.8, 0.98),
        # Speaker 2 -> 20 seconds
        WordProxy("Closing", 30.2, 35.0, 0.98),
        WordProxy("remarks", 35.2, 42.0, 0.98),
        WordProxy("from", 42.2, 48.0, 0.98),
        WordProxy("two", 48.2, 49.8, 0.98),
    ]

    turns = [
        {"start": 0.0, "end": 10.0, "speaker": "SPEAKER_00"},
        {"start": 10.0, "end": 22.0, "speaker": "SPEAKER_01"},
        {"start": 22.0, "end": 30.0, "speaker": "SPEAKER_00"},
        {"start": 30.0, "end": 50.0, "speaker": "SPEAKER_01"},
    ]

    aligned = align_words_to_turns(words, turns)
    reconstructed = reconstruct_speaker_turns(aligned)

    assert len(reconstructed) == 4
    assert reconstructed[0]["speaker"] == "SPEAKER_00"
    assert reconstructed[1]["speaker"] == "SPEAKER_01"
    assert reconstructed[2]["speaker"] == "SPEAKER_00"
    assert reconstructed[3]["speaker"] == "SPEAKER_01"


def test_case_2_long_silence_splits_turns():
    """Case 2: Long silence does not merge two turns of the same speaker."""
    from pipeline import align_words_to_turns, reconstruct_speaker_turns

    words = [
        WordProxy("First", 0.0, 1.0, 0.98),
        WordProxy("part", 1.1, 2.0, 0.98),
        # 4 second silence gap
        WordProxy("Second", 6.0, 7.0, 0.98),
        WordProxy("part", 7.1, 8.0, 0.98),
    ]

    turns = [
        {"start": 0.0, "end": 2.2, "speaker": "SPEAKER_00"},
        {"start": 5.8, "end": 8.2, "speaker": "SPEAKER_00"},
    ]

    aligned = align_words_to_turns(words, turns)
    reconstructed = reconstruct_speaker_turns(aligned, max_known_gap=0.65)

    assert len(reconstructed) == 2
    assert reconstructed[0]["text"] == "First part"
    assert reconstructed[1]["text"] == "Second part"
    assert reconstructed[0]["end"] <= 2.5
    assert reconstructed[1]["start"] >= 5.8


def test_case_3_unknown_speaker_bounded():
    """Case 3: Unknown segments remain bounded across pauses."""
    from pipeline import align_words_to_turns, reconstruct_speaker_turns

    words = [
        WordProxy("first", 0.0, 8.0, 0.90),
        # 6-second silence
        WordProxy("second", 14.0, 27.0, 0.90),
    ]

    turns = []  # No acoustic turns detected

    aligned = align_words_to_turns(words, turns)
    reconstructed = reconstruct_speaker_turns(aligned, max_unknown_gap=0.80)

    assert len(reconstructed) == 2
    assert reconstructed[0]["speaker"] == "Unknown Speaker"
    assert reconstructed[0]["end"] == 8.0
    assert reconstructed[1]["speaker"] == "Unknown Speaker"
    assert reconstructed[1]["start"] == 14.0


def test_case_4_expected_speakers_parameter_propagation():
    """Case 4: expected_speakers=2 passes num_speakers=2."""
    from pipeline import _diarization_speaker_kwargs

    kwargs = _diarization_speaker_kwargs(expected_speakers=2)
    assert kwargs == {"num_speakers": 2}


def test_case_5_expected_speakers_none_unconstrained():
    """Case 5: expected_speakers=None does not fabricate a speaker count."""
    from pipeline import _diarization_speaker_kwargs

    # Clear env vars if set
    old_num = os.environ.pop("DIARIZATION_NUM_SPEAKERS", None)
    old_min = os.environ.pop("DIARIZATION_MIN_SPEAKERS", None)
    old_max = os.environ.pop("DIARIZATION_MAX_SPEAKERS", None)
    try:
        kwargs = _diarization_speaker_kwargs(expected_speakers=None)
        assert "num_speakers" not in kwargs
    finally:
        if old_num: os.environ["DIARIZATION_NUM_SPEAKERS"] = old_num
        if old_min: os.environ["DIARIZATION_MIN_SPEAKERS"] = old_min
        if old_max: os.environ["DIARIZATION_MAX_SPEAKERS"] = old_max


def test_case_6_empty_diarization_produces_unresolved_segments():
    """Case 6: Empty diarization never returns one monolithic 4-minute segment."""
    from pipeline import _build_unresolved_turns

    words = [
        WordProxy("hello", 0.0, 2.0, 0.95),
        WordProxy("world", 5.0, 7.0, 0.95),
        WordProxy("welcome", 15.0, 18.0, 0.95),
    ]

    fallback = _build_unresolved_turns(words, max_turn_seconds=10.0, pause_seconds=0.8)
    assert len(fallback) == 3
    for s in fallback:
        assert s["speaker"] == "Unknown Speaker"
        assert s["attribution_source"] == "unresolved"


def test_case_7_windows_audio_loading_in_memory_dict(tmp_path):
    """Case 7: Verify audio can be decoded to in-memory waveform dict without TorchCodec."""
    import soundfile as sf
    import torch
    from pipeline import load_audio_waveform_for_pyannote

    wav_path = str(tmp_path / "test.wav")
    sr = 16000
    data = np.zeros((sr * 2, 2), dtype=np.float32)  # 2s stereo
    sf.write(wav_path, data, sr)

    res = load_audio_waveform_for_pyannote(wav_path)
    assert isinstance(res, dict)
    assert "waveform" in res
    assert "sample_rate" in res
    assert isinstance(res["waveform"], torch.Tensor)
    assert res["waveform"].shape == (2, sr * 2)
    assert res["sample_rate"] == sr


def test_case_8_diarization_diagnostics_metrics():
    """Case 8: Diagnostic metrics report speaker count, turn count, and quality status."""
    from pipeline import calculate_diarization_diagnostics

    segments = [
        {"speaker": "Speaker 1", "start": 0.0, "end": 10.0, "text": "Hello world here"},
        {"speaker": "Speaker 2", "start": 10.5, "end": 20.0, "text": "Great to meet you"},
    ]
    diag = calculate_diarization_diagnostics(
        segments=segments,
        detected_speakers=["Speaker 1", "Speaker 2"],
        diarized_turns=[{"start": 0.0, "end": 10.0}, {"start": 10.5, "end": 20.0}],
        total_duration=20.0,
        words_count=7,
    )
    assert diag["speaker_count"] == 2
    assert diag["speaker_turn_count"] == 2
    assert diag["quality_status"] == "ok"
    assert diag["unknown_word_ratio"] == 0.0


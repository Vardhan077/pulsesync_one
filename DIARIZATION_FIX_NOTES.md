# PulseSync Diarization Hardening — October 2026

## What changed

1. **Premium diarization path**
   - If `PYANNOTEAI_API_KEY` is configured, PulseSync uses pyannoteAI `precision-3` with exclusive diarization and turn-level confidence.
   - Local Community-1 remains the fallback.

2. **Original audio preserved for diarization**
   - The source recording is passed to Pyannote directly.
   - The mono 16 kHz FFmpeg copy is used for STT only.
   - This avoids unnecessarily destroying channel information before diarization.

3. **Exclusive annotation fallback fixed**
   - If Community-1's exclusive output is empty but the regular speaker diarization is valid, the regular annotation is used.

4. **Catastrophic empty-diarization failure fixed**
   - An empty diarization result is no longer silently converted into a single `Unknown Speaker` turn.
   - The system now marks the result as unresolved and creates pause-based editable transcript turns rather than presenting a false diarized result.

5. **Unknown-speaker merge bug fixed**
   - Previously, `Unknown Speaker` turns were merged regardless of pause length. This could collapse an entire meeting into one 4-minute utterance.
   - Unknown turns now have a bounded merge gap.

6. **Trusted participant-count constraints**
   - Meeting-bot processing passes the real non-bot participant count when available.
   - Speaker count is not guessed for ordinary uploaded audio.

7. **Speaker alignment hardened**
   - Word-to-speaker assignment uses overlap plus midpoint tie-breaking.
   - Minimum overlap is configurable.
   - Speaker confidence includes diarization confidence when available.

8. **No synthetic speaker identities or embeddings**
   - Speaker labels remain `Speaker 1`, `Speaker 2`, etc. until a trusted platform identity or manual mapping is available.

## Highest-accuracy configuration

```env
PYANNOTEAI_API_KEY=<your-key>
PYANNOTEAI_ENABLED=true
PYANNOTEAI_MODEL=precision-3
PYANNOTEAI_POLL_SECONDS=3
```

For local-only diarization:

```env
HF_TOKEN=<your-huggingface-token>
PYANNOTE_MODEL=pyannote/speaker-diarization-community-1
```

Only configure `DIARIZATION_NUM_SPEAKERS`, `DIARIZATION_MIN_SPEAKERS`, or `DIARIZATION_MAX_SPEAKERS` when the participant count is actually known.

## Verification

- AI-service tests: 21/21 passing.
- Python syntax compilation: passing.
- Node backend syntax check: passing.

The actual 4:19 customer recording still needs to be processed in the user's environment to measure real DER/speaker confusion because the screenshot alone does not contain the source audio.

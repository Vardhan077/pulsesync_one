

## Local-only diarization policy
- PulseSync uses only `pyannote/speaker-diarization-community-1` locally.
- No `pyannoteai-sdk`, Precision-2, Precision-3, or pyannoteAI API calls are required.
- `HF_TOKEN` is required to download/use Community-1.
- `PYANNOTE_MODEL` may point to a local/offline Community-1 copy.
- Speaker-count constraints are applied only when trusted metadata or explicit configuration provides them.
- Empty/degenerate diarization is a hard failure; the system never converts a failed diarization run into a fake single speaker.

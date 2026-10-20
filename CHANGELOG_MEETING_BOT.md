# Meeting Bot Revision

## Added
- Google Meet / Zoom meeting-bot capture model.
- Capture source metadata: extension, meeting_bot, upload.
- Provider metadata and meeting URL fields.
- Consent state and bot lifecycle state.
- Meeting-bot job creation/listing/audio-ingestion API.
- Robust audio upload size/type handling.

## UI
- Capture screen now presents exactly two online-meeting capture modes:
  1. Browser Extension — botless capture.
  2. Meeting Bot — Google Meet / Zoom participant capture.
- Removed telephony-oriented language and controls from the Capture workspace.

## Processing
Both capture modes use the same downstream pipeline after audio ingestion:

`Capture → Transcript → Diarization → Extraction → Evidence Review → Customer Intelligence → CRM Sync`

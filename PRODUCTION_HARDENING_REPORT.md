# PulseSync Production Hardening Report

## Scope
This pass focused on the highest-risk product paths in the supplied PulseSync archive:

1. Speaker identity and diarization
2. Dynamic extraction / playbook output
3. Analytics authenticity
4. Runtime and dependency failure modes
5. Evidence grounding and irrelevant-transcript isolation

## Speaker attribution architecture

PulseSync now follows this priority order:

1. Manual mapping
2. Platform-native participant identity
3. Platform transcript identity / metadata
4. Acoustic diarization
5. Unknown / unresolved speaker

An LLM is no longer allowed to decide who spoke based on conversational semantics. That was a major source of speaker switching and incorrect CRM attribution.

### Meeting platforms

- Zoom RTMS participant IDs/user names are preserved when supplied by the platform.
- Google Meet caption participant names are preserved when the browser capture can read them.
- Microsoft Teams provider attribution remains platform-first when Graph/Calling events or attributed transcripts are available.
- If a platform does not expose usable participant identity, PulseSync leaves the acoustic speaker label for review instead of fabricating a person's name.

### Uploaded / extension audio

When `HF_TOKEN` and the diarization stack are configured, PulseSync uses pyannote Community-1 with exclusive speaker diarization and aligns Whisper timestamps to those acoustic speaker turns.

The previous transcript-only LLM diarization path has been removed.

### Removed unsafe behavior

- Random 512-dimensional speaker embeddings are no longer generated.
- Unknown speaker identity is not converted into a real person's name.
- Speaker labels use first-appearance ordering for deterministic `Speaker 1`, `Speaker 2`, etc.

## Extraction architecture

The extraction pipeline now:

1. Resolves the active user-configured profile.
2. Classifies transcript relevance before LLM extraction.
3. Sends only relevant/uncertain business conversation to the LLM.
4. Keeps irrelevant segments as audit metadata but never as evidence.
5. Requires evidence for populated fields.
6. Preserves configured field order and scope.
7. Returns null / not-mentioned rather than inventing missing values.
8. Uses deterministic grounding only when the LLM is unavailable.
9. Handles an entirely irrelevant transcript without invoking the LLM.

## Analytics

The Analytics page no longer contains fictional pipeline numbers, fictional accounts, synthetic percentages, or fixed quarter KPIs.

It now reads from `/api/analytics/overview`, which calculates:

- processed meetings
- linked accounts
- conversation duration
- action items
- risks
- objections
- call-type mix
- recent meetings
- objection themes
- speaker activity

When there is no data, the UI displays an explicit empty state instead of fake metrics.

## Runtime hardening

- Browser automation now lazy-loads `puppeteer-core`, so unrelated backend modules/tests do not crash merely because browser dependencies are unavailable.
- Transcript speaker IDs are nullable so unresolved speakers cannot cause database insertion failures.
- Transcript attribution provenance and confidence are persisted.
- Dashboard API URLs are environment-configurable.
- pyannote dependency configuration was updated for the Community-1 generation.

## Verification

### Passing

- Python AI tests: **19/19**
- Meeting bot lifecycle suite: **9/9**
- Platform attribution suite: exercises Google Meet CSRC, Zoom RTMS, Teams active-speaker mapping, priority attribution, dual transcript reconciliation, and worker persistence.
- Grounding regression suite: **14/14**
- Node syntax checks passed for the modified backend modules.
- Python compilation checks passed for modified AI modules.

### Environment limitation

The supplied archive did not contain installed dashboard dependencies, and package installation for the dashboard timed out in the audit environment. Therefore a full Vite production build could not be executed inside this environment. The source was still reviewed for hardcoded analytics and API configuration, and the hardcoded Analytics implementation was replaced.

The production deployment should run `npm ci && npm run build` in the dashboard directory as part of CI before release.

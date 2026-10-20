# PulseSync AI — Hardened development revision

PulseSync AI is a conversation-intelligence workspace built around a Chrome Manifest V3 capture extension, Node.js/Express API, FastAPI AI service, PostgreSQL/pgvector, and a React/Vite dashboard.

> **Deployment boundary:** this revision includes important security and data-integrity hardening, but it is not certified for multi-tenant enterprise production. See `SECURITY_AND_SETUP.md` and `ENTERPRISE_READINESS_REPORT.md` for remaining release gates. The shared API token is a self-hosted access gate, not user identity, SSO, RBAC, or workspace isolation.

## Repository layout

- `backend/` — Node.js API, PostgreSQL bootstrap, integration/sync services, meeting bot worker, upload/audio serving.
- `ai-service/` — FastAPI audio processing, diarization, grounded extraction, enrichment, deal Q&A.
- `pulsesync_react/pulsesync-dashboard/` — React/Vite dashboard.
- `extension/` — Chrome MV3 tab-audio extension with explicit consent and final-chunk persistence acknowledgements.
- `backend/schema.sql` — initial PostgreSQL schema for the local Docker setup.
- `docker-compose.yml` — local PostgreSQL + pgvector service.

## Local setup

Prerequisites: Node.js **22.12+** (Node 22 LTS recommended), Python 3.11/3.12, and Docker Desktop with Docker Compose.

1. Copy `.env.example` to `.env`. Replace the PostgreSQL password, `AI_SERVICE_TOKEN`, `ENCRYPTION_SECRET`, and `MEDIA_SIGNING_SECRET` with your own unique random values (at least 32 characters). Set `DATABASE_URL` to use the same database password. Configure `PULSESYNC_API_TOKEN` for a token-protected local setup; it may be blank only for isolated development.
2. Copy `ai-service/.env.example` to `ai-service/.env`. Set `AI_SERVICE_TOKEN` to the exact same value as root `.env`; verify `UPLOADS_DIR` resolves to the backend uploads directory.
3. Start the database: `docker compose up -d postgres`. The schema is automatically applied only when Docker creates the database volume the first time. Existing volumes need a reviewed migration; do not delete a volume to fix migrations because that destroys stored data.
4. Install Node dependencies: `npm ci`. Install AI-service dependencies inside a virtual environment with `python -m pip install -r ai-service/requirements.txt`.
5. Start the backend in terminal 1: `npm run dev:server`.
6. Start the AI service in terminal 2: `cd ai-service` then `python -m uvicorn main:app --host 127.0.0.1 --port 8000`.
7. Install dashboard dependencies in terminal 3: `npm ci --prefix ./pulsesync_react/pulsesync-dashboard`; start it with `npm run dev:dashboard` from the repository root.
8. Load `extension/` as an unpacked extension in Chrome. Set the API URL and, when configured, paste the same `PULSESYNC_API_TOKEN`. Consent is unchecked on every new capture and must be confirmed for that recording.

The PostgreSQL setup uses `pgvector/pgvector:pg16` and binds port 5432 to localhost. Do not publish the database port to the internet.

## Verification commands

From repository root:

```bash
npm test
```

The test command checks UI/extension file structure and JavaScript syntax, runs backend JS unit/E2E tests, and runs the AI-service tests plus grounding regression tests. The API E2E test intentionally uses an isolated temporary JSON store and a dedicated test token; it does not write to your configured PostgreSQL database.

For dashboard production build and lint:

```bash
npm ci --prefix ./pulsesync_react/pulsesync-dashboard
npm run build --prefix ./pulsesync_react/pulsesync-dashboard
npm run lint --prefix ./pulsesync_react/pulsesync-dashboard
```

## Important behavior and limitations

- AI service failures no longer produce fabricated customer answers, quotes, stakeholder names or deal facts. Unsupported answers return an explicit unavailable/review-needed state.
- CRM sync uses one execution route; a meeting must not be marked synced through the removed legacy handler that bypassed provider writes.
- PostgreSQL errors abort startup unless local JSON fallback is explicitly enabled with `ALLOW_JSON_FALLBACK=true` outside production. JSON mode is only for local testing/demo use and is not concurrency-safe.
- Uploaded audio must carry `consent_status=granted` and pass signature/header, size and non-empty validation. The default upload limit is 250 MiB, configurable with `MAX_AUDIO_UPLOAD_BYTES`.
- Uploaded audio is not included in the source ZIP. Recordings are served using authenticated URL issuance and short-lived signed media URLs.
- Browser capture waits for the MediaRecorder `stop` event and serialized IndexedDB chunk-write acknowledgements before upload. Long recordings still assemble chunks in memory before upload; stress-test memory and browser quota constraints before broad deployment.
- Legacy speaker tables are preserved as `speakers_legacy_backup` and `speaker_embeddings_legacy_backup` rather than dropped. A reviewed data conversion is still required before those old records become active in the new model.
- Real OAuth/provider sync, real meeting-platform capture, multi-replica processing, and diarization quality need live integration validation.

## Data grounding rules

- Do not manufacture CRM facts, evidence or customer quotes.
- Missing information remains unknown/not identified and evidence must refer to the current meeting transcript.
- Company association is explicit; do not infer it from the audio filename.
- Review extracted values before CRM sync.

See `HARDENING_CHANGELOG.md` for code changes and `ENTERPRISE_READINESS_REPORT.md` for verification results and remaining blockers.

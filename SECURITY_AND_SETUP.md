# PulseSync: secure local setup and remaining production gates

## Start the database

1. Install Docker Desktop and copy `.env.example` to `.env`.
2. Change `POSTGRES_PASSWORD`, `AI_SERVICE_TOKEN`, `ENCRYPTION_SECRET`, and `MEDIA_SIGNING_SECRET` to unique random values of at least 32 characters. Keep `AI_SERVICE_TOKEN` identical in the root `.env` and `ai-service/.env`. Set `DATABASE_URL` to use the same PostgreSQL password.
3. Start PostgreSQL/pgvector with `docker compose up -d postgres`. The schema file is loaded when the named volume is first created. For an existing volume, apply reviewed migrations manually; the init script does not rerun automatically.
4. Install backend dependencies with `npm ci`. Install AI-service dependencies in a virtual environment using `python -m pip install -r ai-service/requirements.txt`.
5. Run the backend with `npm run dev:server`, the AI service with `cd ai-service && uvicorn main:app --host 127.0.0.1 --port 8000`, and the dashboard with `npm run dev:dashboard`.

## Token behavior

In development, the API token is optional unless `PULSESYNC_API_TOKEN` is configured. In production, startup requires strong values for `PULSESYNC_API_TOKEN`, `AI_SERVICE_TOKEN`, `ENCRYPTION_SECRET`, and `MEDIA_SIGNING_SECRET`. Use four unique random values of at least 32 characters; do not reuse the sample strings from `.env.example`. Enter the configured API token into the dashboard prompt and extension popup. The API token is a shared bearer token for a single self-hosted installation: **it is not user identity, SSO, role-based access control, or true workspace isolation**. Do not expose this build publicly or use it for multiple customer tenants until per-user authentication and tenant-scoped data access are implemented and tested.

## Recording consent and media

Recording upload and meeting-bot scheduling require an explicit consent confirmation. The extension prompts before capture. Audio files are not shipped in this source archive; they are stored in `backend/uploads/`, which is git-ignored. Playback uses short-lived signed URLs and range requests. Establish a retention and deletion policy before using real customer recordings.

## JSON fallback

JSON persistence is only available when `ALLOW_JSON_FALLBACK=true` in non-production mode. It is not safe for concurrent or enterprise use. Keep it disabled and use PostgreSQL/pgvector for any persistent environment.

## Important outstanding work

This hardening pass does not certify the product as enterprise-ready. Before external customers: implement per-user identity/roles and enforce workspace ownership in every query; replace in-memory OAuth state with shared durable session state for multi-replica deployments; add a durable processing queue; finish safe migration conversion for the preserved `speakers_legacy_backup` tables; validate database migration from real previous schema versions; test real CRM API writes/idempotency; and complete production dashboard build and real-provider audio/consent/long-recording tests.

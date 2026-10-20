# Hardening changelog

## Hardened revision

### Data integrity and AI grounding
- Removed a legacy meeting-sync route that could mark a meeting synced before an actual provider write.
- Removed fixed sales facts and unsupported quotes from AI/chat error fallbacks. AI outages now return explicit unavailable/review-needed responses instead of invented evidence.
- Prevented active PostgreSQL mode from falling back to unrelated JSON audio records.
- Made JSON fallback opt-in for non-production only; database connection failure no longer silently changes the persistence backend.
- Added the pgvector extension to runtime bootstrap and made speaker-table migration non-destructive by preserving old data in backup tables.

### Security and privacy
- Added shared API bearer-token protection for API routes and AI-service token validation.
- Removed the hard-coded encryption key fallback and required strong production secrets, including the media URL signing secret.
- Added HubSpot OAuth state validation and configurable callback/dashboard URLs.
- Removed public static access to uploads and added short-lived HMAC-signed media URLs with path guards.
- Enforced AI audio-path containment under the configured uploads directory.
- Changed capture/upload consent to explicit confirmation and added recorder finalization/IndexedDB persistence acknowledgements.
- Added audio upload size configuration and reject-invalid-signature behavior.
- Added `.gitignore` protection and removed captured recordings/fallback state from the release archive.

### Delivery and checks
- Added local Docker Compose setup for PostgreSQL with pgvector.
- Added `.env.example` guidance and security/readiness documentation.
- Added credential cryptography regression checks, API token assertions in the API E2E harness, and UI/extension structure checks.
- Fixed asynchronous attribution test reporting so the result summary waits for every test.

This change list does not claim complete per-user/tenant authorization, durable processing jobs, automated migration conversion, or live provider validation; these remain release gates documented in `SECURITY_AND_SETUP.md` and `ENTERPRISE_READINESS_REPORT.md`.

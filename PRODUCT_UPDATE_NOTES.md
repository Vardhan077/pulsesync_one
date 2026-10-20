# PulseSync Product Update — Research-driven UI pass

This update incorporates the supplied product research into the existing prototype without pretending that unimplemented infrastructure is live.

## Added
- **Analytics** workspace for an individual sales rep: open pipeline, coverage, attention queue, stakeholder coverage, conversation effectiveness, commitment follow-through, objection themes and verification rate.
- **Capture** workspace that clearly models the dual-channel strategy: existing browser extension plus a planned Google Meet / Zoom meeting-bot path, with both converging on the same review and CRM-sync workflow.
- Navigation entries for Analytics and Capture.
- Updated dashboard typography to Roboto and retained the restrained enterprise visual language.

## Existing areas retained
The existing Customer Intelligence, Review Center, Playbooks, Integrations, transcript verification and CRM sync flows remain intact. The Customer area already contains substantial account/deal intelligence and is the correct surface for buyer requirements, stakeholders, risks, commitments, evidence and meeting history.

## Important implementation boundary
The new meeting-bot screen is a product/configuration surface, not a fake telephony implementation. A production call bot still requires a SIP/VoIP or meeting-bot provider, consent/compliance design, credentials, webhooks, media ingestion and backend persistence.

## Verification performed
- Python AI-service modules compile with `py_compile`.
- Node backend parses with `node --check`.
- The repository's `scripts/verify-ui.js` is stale and references `extension/dashboard.js`, which does not exist in the supplied project.
- A clean Vite dependency install could not complete in the execution environment before timeout, so a full production frontend build could not be truthfully certified here. No claim of a successful Vite build is made.

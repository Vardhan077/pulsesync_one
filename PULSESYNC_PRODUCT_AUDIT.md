# PulseSync AI — Product & Engineering Audit

## Executive assessment

The supplied project is **not yet production-ready as an enterprise conversation-intelligence product**, but it is materially beyond a demo. It already contains a credible processing workflow, grounded extraction, dynamic extraction profiles, evidence validation, customer memory surfaces, CRM sync infrastructure, meeting-bot capture, and a React dashboard.

The biggest remaining risks are product coherence, schema governance, integration depth, workflow polish, and verification/build confidence—not lack of AI features.

## Verified strengths in the supplied codebase

- React/Vite dashboard with Home, Reviews, Customers, Analytics, Capture, Playbooks, AI Extraction, Integrations and Settings surfaces.
- Node/Express backend with meeting workflow, extraction profiles, company/customer intelligence, search, CRM sync and meeting-bot APIs.
- FastAPI AI service with transcript relevance filtering, grounded extraction, field-specific semantic validation and evidence-linked outputs.
- PostgreSQL schema includes workspaces, extraction profiles, integrations, destination field metadata, mappings, CRM records, sync runs and sync items.
- Meeting-bot provider abstractions exist for Google Meet, Microsoft Teams and Zoom, plus browser/extension capture.
- HubSpot has a concrete CRM adapter; Salesforce/Pipedrive are represented in configuration/schema but do not have equivalent concrete adapters in the supplied integration directory.

## Key gaps found

### 1. Extraction schema

The original implementation is dynamic, but its field contract was still relatively shallow: name, type, description, evidence requirement, enabled state and options. That is enough for a configurable demo but not enough for a governed enterprise extraction system.

The updated schema metadata now supports:

- field type: text, number, boolean, date, datetime, currency, enum, multi-select, person, company, URL, array, object
- AI extraction instruction
- evidence requirement
- required-for-review semantics
- validation metadata
- default value metadata
- CRM destination mapping metadata

The important distinction is that **required-for-review does not mean “the AI must invent a value.”** Missing information remains null and becomes a review concern.

### 2. AI grounding

The existing engine already validates evidence against current transcript segments and rejects unsupported values. The updated prompt now explicitly passes field-level instructions, validation metadata, review requirements and CRM mapping context to the model.

### 3. CRM workflow

The database model is stronger than the visible product surface: it already models mappings, sync runs and field-level sync items. The product should expose this as a clear flow:

`Extract → Evidence → Review → Map → Preview → Sync → Audit`

Hightouch's current sync model reinforces this pattern: destination selection, record matching, field mapping, scheduling and run/debug history are explicit workflow stages rather than a single “Sync” button.

### 4. Customer intelligence

The supplied product already has company timelines, memories, risks and customer surfaces. This should remain a persistent account intelligence layer instead of making every call an isolated artifact.

### 5. UI/UX

The dashboard has a useful enterprise direction—restrained color, compact navigation, evidence-aware review and a dedicated extraction area—but the main Dashboard component is very large and carries too much state and workflow responsibility. This makes future UX changes risky and makes the product feel more like a sophisticated prototype than a mature application shell.

The next architectural UI step should be to split the meeting workspace into independently testable surfaces/hooks: meeting header, transcript workspace, intelligence panel, extraction review, verification queue and sync workflow.

## Market findings

Modern conversation-intelligence products consistently position transcription as the data-capture layer, not the product endpoint.

- Gong emphasizes conversation analysis, deal/pipeline context, coaching, risk signals and CRM automation.
- Clari Copilot connects conversations to pipeline/forecasting and captures buyer signals, objections, contacts and next steps.
- Avoma combines meeting notes, custom categories/methodologies, searchable history and CRM field synchronization.
- HubSpot Conversation Intelligence connects calls to the CRM and focuses on coaching, objections and team performance.
- Salesforce Einstein Conversation Insights provides editable call summaries, next steps, customer feedback and configurable generative insights.
- Otter's current Salesforce connector connects meeting intelligence to account/deal context, coaching and pain-point analysis.
- Attio demonstrates the importance of first-class custom attributes and enriched communication intelligence at the record level.
- Hightouch demonstrates the operational pattern for schema-driven field mapping, record matching, destination configuration and run-level debugging.

## Recommended product architecture

```text
Capture
  ↓
Transcript + Speaker Attribution
  ↓
Conversation Understanding
  ├─ Summary
  ├─ Key Moments
  ├─ Actions
  ├─ Risks / Objections
  └─ Customer Intelligence
  ↓
Workspace Schema / Playbook
  ↓
Field Extraction
  ↓
Evidence + Confidence + Validation
  ↓
Human Verification
  ↓
CRM Mapping / Record Matching
  ↓
Sync Preview
  ↓
Sync + Audit Log
  ↓
Persistent Account Intelligence
```

## Scope recommendation

### MVP / Must have

1. Reliable capture + transcription + speaker attribution review.
2. Call detail workspace with transcript, summary, actions, risks, key moments and evidence.
3. Configurable extraction schema.
4. Evidence + confidence + human verification.
5. One production-grade CRM integration (HubSpot is already the strongest current candidate in this codebase).
6. Sync preview, approval and field-level audit history.
7. Calls/accounts search and history.
8. Clear processing, empty, error and success states.

### V1 / Should have

1. Salesforce and additional CRM adapters.
2. Manager coaching and scorecards.
3. Deal-level risk and buying-signal views.
4. Cross-call account intelligence.
5. More powerful schema validation and field transformations.
6. Workspace roles/permissions and governance controls.
7. Stronger analytics across reps, accounts and methodologies.

### Future

1. Real-time in-call guidance/battlecards.
2. Forecasting and predictive deal scoring.
3. Broad omnichannel capture beyond meetings.
4. Advanced AI agents that take workflow actions.
5. Enterprise governance/compliance expansion.

## Verification performed

- `node --check backend/server.js`: passed.
- Python AI-service tests + grounding regression tests: **30 passed**.
- Dashboard production build could not be completed in the audit container because dashboard dependency installation timed out. The source changes were inspected directly, but the final Vite bundle should be built in a normal development environment before deployment.

## Important implementation boundary

The supplied project contains integration abstractions and a concrete HubSpot adapter. It should not advertise Salesforce/Pipedrive as fully operational merely because those providers appear in configuration/schema. They should remain visibly “planned/not connected” until a real adapter and end-to-end test exist.

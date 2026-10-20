import crypto from 'crypto';
import { HubSpotAdapter } from './HubSpotAdapter.js';
import { encryptToken, decryptToken } from './crypto.js';

export class SyncEngine {
  constructor(pool, useFallbackDb, readFallbackDb, writeFallbackDb, logger) {
    this.pool = pool;
    this.useFallbackDb = useFallbackDb;
    this.readFallbackDb = readFallbackDb;
    this.writeFallbackDb = writeFallbackDb;
    this.logger = logger || console;

    // Register active CRM adapters
    this.adapters = {
      hubspot: new HubSpotAdapter()
    };
  }

  _buildHubSpotUrl(type, id, portalId = '247215704') {
    if (!id) return null;
    const pId = portalId || '247215704';
    const typeMap = {
      contact: '0-1',
      company: '0-2',
      deal: '0-3',
      task: '0-27'
    };
    return `https://app.hubspot.com/contacts/${pId}/record/${typeMap[type] || '0-3'}/${id}`;
  }

  getAdapter(provider = 'hubspot') {
    const adapter = this.adapters[provider.toLowerCase()];
    if (!adapter) {
      throw new Error(`Unsupported CRM provider: "${provider}". Only HubSpot is currently enabled.`);
    }
    return adapter;
  }

  /**
   * Retrieves and decrypts active access token, refreshing if expired
   */
  async resolveAccessToken(integrationId) {
    let creds = null;
    let integration = null;

    if (!this.useFallbackDb) {
      const intRes = await this.pool.query('SELECT * FROM integrations WHERE id = $1', [integrationId]);
      if (intRes.rows.length === 0) throw new Error('Integration not found');
      integration = intRes.rows[0];

      const credRes = await this.pool.query('SELECT * FROM integration_credentials WHERE integration_id = $1', [integrationId]);
      if (credRes.rows.length === 0) throw new Error('Credentials not found for integration');
      creds = credRes.rows[0];
    } else {
      const data = this.readFallbackDb();
      integration = (data.integrations || []).find(i => i.id === integrationId);
      if (!integration) throw new Error('Integration not found');
      creds = (data.integration_credentials || []).find(c => c.integration_id === integrationId);
      if (!creds) throw new Error('Credentials not found for integration');
    }

    const adapter = this.getAdapter(integration.provider);
    const accessToken = decryptToken(creds.encrypted_access_token, creds.iv, creds.auth_tag);
    const refreshToken = creds.encrypted_refresh_token ? decryptToken(creds.encrypted_refresh_token, creds.iv, creds.auth_tag) : null;

    // Check expiration
    const isExpired = creds.expires_at && new Date(creds.expires_at).getTime() <= (Date.now() + 60000);

    if (isExpired && refreshToken) {
      this.logger.info({ integrationId }, 'Access token expired. Refreshing token with CRM...');
      try {
        const refreshed = await adapter.refreshToken(refreshToken);
        const encAccess = encryptToken(refreshed.accessToken);
        const encRefresh = encryptToken(refreshed.refreshToken || refreshToken);
        const expiresAt = new Date(Date.now() + (refreshed.expiresIn * 1000)).toISOString();

        if (!this.useFallbackDb) {
          await this.pool.query(
            `UPDATE integration_credentials SET
               encrypted_access_token = $1,
               encrypted_refresh_token = $2,
               expires_at = $3,
               iv = $4,
               auth_tag = $5,
               updated_at = NOW()
             WHERE integration_id = $6`,
            [encAccess.encryptedData, encRefresh.encryptedData, expiresAt, encAccess.iv, encAccess.authTag, integrationId]
          );
        } else {
          const data = this.readFallbackDb();
          const dbCred = (data.integration_credentials || []).find(c => c.integration_id === integrationId);
          if (dbCred) {
            dbCred.encrypted_access_token = encAccess.encryptedData;
            dbCred.encrypted_refresh_token = encRefresh.encryptedData;
            dbCred.expires_at = expiresAt;
            dbCred.iv = encAccess.iv;
            dbCred.auth_tag = encAccess.authTag;
            this.writeFallbackDb(data);
          }
        }

        return { accessToken: refreshed.accessToken, provider: integration.provider, integration, portalId: integration.auth_metadata?.portal_id || '' };
      } catch (refreshErr) {
        this.logger.error({ refreshErr }, 'Failed to refresh token');
        throw new Error('Authentication expired. Please reconnect CRM.');
      }
    }

    return { accessToken, provider: integration.provider, integration, portalId: integration.auth_metadata?.portal_id || '' };
  }

  /**
   * Retrieves default and custom field mappings for workspace and integration
   */
  async getFieldMappings(workspaceId, integrationId) {
    let customMappings = [];
    if (!this.useFallbackDb) {
      const res = await this.pool.query(
        'SELECT * FROM field_mappings WHERE integration_id = $1 AND is_enabled = TRUE',
        [integrationId]
      );
      customMappings = res.rows;
    } else {
      const data = this.readFallbackDb();
      customMappings = (data.field_mappings || []).filter(m => m.integration_id === integrationId && m.is_enabled);
    }

    // Default baseline field mappings for HubSpot
    const defaultMappings = [
      { playbook_field_name: 'metrics', destination_object: 'deal', destination_field_name: 'amount' },
      { playbook_field_name: 'budget', destination_object: 'deal', destination_field_name: 'amount' },
      { playbook_field_name: 'economic_buyer', destination_object: 'deal', destination_field_name: 'pulsesync_economic_buyer' },
      { playbook_field_name: 'economic buyer', destination_object: 'deal', destination_field_name: 'pulsesync_economic_buyer' },
      { playbook_field_name: 'decision_maker', destination_object: 'deal', destination_field_name: 'pulsesync_decision_maker' },
      { playbook_field_name: 'decision maker', destination_object: 'deal', destination_field_name: 'pulsesync_decision_maker' },
      { playbook_field_name: 'decision_criteria', destination_object: 'deal', destination_field_name: 'pulsesync_decision_criteria' },
      { playbook_field_name: 'decision criteria', destination_object: 'deal', destination_field_name: 'pulsesync_decision_criteria' },
      { playbook_field_name: 'decision_process', destination_object: 'deal', destination_field_name: 'pulsesync_decision_process' },
      { playbook_field_name: 'decision process', destination_object: 'deal', destination_field_name: 'pulsesync_decision_process' },
      { playbook_field_name: 'identify_pain', destination_object: 'deal', destination_field_name: 'pulsesync_pain_points' },
      { playbook_field_name: 'identify pain', destination_object: 'deal', destination_field_name: 'pulsesync_pain_points' },
      { playbook_field_name: 'need', destination_object: 'deal', destination_field_name: 'pulsesync_pain_points' },
      { playbook_field_name: 'pain', destination_object: 'deal', destination_field_name: 'pulsesync_pain_points' },
      { playbook_field_name: 'pain_points', destination_object: 'deal', destination_field_name: 'pulsesync_pain_points' },
      { playbook_field_name: 'situation', destination_object: 'deal', destination_field_name: 'pulsesync_decision_criteria' },
      { playbook_field_name: 'impact', destination_object: 'deal', destination_field_name: 'pulsesync_pain_points' },
      { playbook_field_name: 'goals', destination_object: 'deal', destination_field_name: 'pulsesync_decision_criteria' },
      { playbook_field_name: 'champion', destination_object: 'deal', destination_field_name: 'pulsesync_champion' },
      { playbook_field_name: 'competition', destination_object: 'deal', destination_field_name: 'pulsesync_competitors' },
      { playbook_field_name: 'timeline', destination_object: 'deal', destination_field_name: 'closedate' },
      { playbook_field_name: 'deal_stage', destination_object: 'deal', destination_field_name: 'dealstage' },
      { playbook_field_name: 'industry', destination_object: 'company', destination_field_name: 'industry' },
      { playbook_field_name: 'company_name', destination_object: 'company', destination_field_name: 'name' },
      { playbook_field_name: 'website', destination_object: 'company', destination_field_name: 'domain' }
    ];

    const mappingMap = new Map();
    defaultMappings.forEach(m => mappingMap.set(m.playbook_field_name.toLowerCase(), m));
    customMappings.forEach(m => mappingMap.set(m.playbook_field_name.toLowerCase(), m));

    return mappingMap;
  }

  /**
   * Prepares a detailed preview of changes before human approval
   */
  async prepareSync(meetingId, integrationId, options = {}) {
    const { accessToken, provider, integration, portalId } = await this.resolveAccessToken(integrationId);
    const adapter = this.getAdapter(provider);

    // 1. Fetch meeting, company, speakers, extractions
    let meeting = null;
    let company = null;
    let speakers = [];
    let extractions = {};
    let dealIntelligence = {};
    let summary = {};

    if (!this.useFallbackDb) {
      const mRes = await this.pool.query('SELECT * FROM meetings WHERE id = $1', [meetingId]);
      if (mRes.rows.length === 0) throw new Error('Meeting not found');
      meeting = mRes.rows[0];

      if (meeting.company_id) {
        const cRes = await this.pool.query('SELECT * FROM companies WHERE id = $1', [meeting.company_id]);
        if (cRes.rows.length > 0) company = cRes.rows[0];
      }

      const spkRes = await this.pool.query('SELECT * FROM speakers WHERE meeting_id = $1', [meetingId]);
      speakers = spkRes.rows;

      const extRes = await this.pool.query('SELECT extracted_data FROM call_extractions WHERE meeting_id = $1', [meetingId]);
      if (extRes.rows.length > 0) {
        const raw = extRes.rows[0].extracted_data;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        extractions = parsed?.extractions || parsed?.extracted_data || parsed || {};
      }

      const sumRes = await this.pool.query('SELECT * FROM meeting_summaries WHERE meeting_id = $1', [meetingId]);
      if (sumRes.rows.length > 0) summary = sumRes.rows[0];
    } else {
      const data = this.readFallbackDb();
      meeting = (data.meetings || []).find(m => m.id === meetingId);
      if (!meeting) throw new Error('Meeting not found');

      company = (data.companies || []).find(c => c.id === meeting.company_id) || {};
      speakers = (data.speakers || []).filter(s => s.meeting_id === meetingId);
      const ext = (data.call_extractions || []).find(e => e.meeting_id === meetingId);
      if (ext) {
        const raw = typeof ext.extracted_data === 'string' ? JSON.parse(ext.extracted_data) : ext.extracted_data;
        extractions = raw?.extractions || raw?.extracted_data || raw || {};
      }
      summary = (data.summaries || []).find(s => s.meeting_id === meetingId) || {};
    }

    const targetPortalId = portalId || integration?.auth_metadata?.portal_id || '247215704';

    // 2. Resolve or search CRM records (Company, Contact, Deal)
    const companyDomain = company?.website ? company.website.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0] : '';
    const companyName = company?.name || meeting.title.split(' ')[0] || 'Acme';

    let matchedCompany = null;
    if (meeting.crm_company_id) {
      matchedCompany = { id: meeting.crm_company_id, name: companyName, url: this._buildHubSpotUrl('company', meeting.crm_company_id, targetPortalId) };
    } else if (companyDomain || companyName) {
      const companies = await adapter.searchCompany(accessToken, { domain: companyDomain, name: companyName });
      matchedCompany = Array.isArray(companies) && companies.length > 0 ? companies[0] : null;
    }

    // Match all participants/speakers
    const participants = [];
    let matchedContactsCount = 0;
    let unmatchedContactsCount = 0;

    for (const spk of speakers) {
      const spkName = spk.name || 'Participant';
      let foundContact = null;
      try {
        if (spk.crm_contact_id) {
          foundContact = { id: spk.crm_contact_id, name: spkName, email: spk.email || '', url: this._buildHubSpotUrl('contact', spk.crm_contact_id, targetPortalId) };
        } else if (spk.email || (spkName && !spkName.toLowerCase().startsWith('speaker'))) {
          const contacts = await adapter.searchContact(accessToken, { email: spk.email, name: spkName });
          if (Array.isArray(contacts) && contacts.length > 0) foundContact = contacts[0];
        }
      } catch (e) {
        // search error ignored
      }

      if (foundContact) {
        matchedContactsCount++;
        participants.push({
          speakerId: spk.speaker_id || spk.id,
          name: spkName,
          email: spk.email || foundContact.email || '',
          role: spk.role || 'Participant',
          status: 'MATCHED',
          crmContactId: foundContact.id,
          crmContactUrl: this._buildHubSpotUrl('contact', foundContact.id, targetPortalId)
        });
      } else {
        unmatchedContactsCount++;
        participants.push({
          speakerId: spk.speaker_id || spk.id,
          name: spkName,
          email: spk.email || '',
          role: spk.role || 'Participant',
          status: 'UNMATCHED',
          canCreate: true
        });
      }
    }

    // Match deal
    const dealName = `${companyName} - Enterprise Expansion`;
    let matchedDeal = null;
    if (meeting.crm_deal_id) {
      matchedDeal = { id: meeting.crm_deal_id, name: dealName, url: this._buildHubSpotUrl('deal', meeting.crm_deal_id, targetPortalId) };
    } else {
      const deals = await adapter.searchDeal(accessToken, { name: dealName, companyId: matchedCompany?.id });
      matchedDeal = Array.isArray(deals) && deals.length > 0 ? deals[0] : null;
    }

    // 3. Compute Field Diffs
    const mappings = await this.getFieldMappings('00000000-0000-0000-0000-000000000001', integrationId);

    // Merge PulseSync intelligence properties dynamically from the verified single source of truth
    const combinedProps = {};

    // A. Add template extractions (strictly only fields present in this meeting's playbook)
    for (const [key, val] of Object.entries(extractions)) {
      if (val !== null && val !== undefined && String(val).toLowerCase() !== 'null' && String(val).toLowerCase() !== 'not mentioned' && String(val).trim() !== '') {
        combinedProps[key] = String(val);
      }
    }

    // B. Add deal signals if present
    if (dealIntelligence && typeof dealIntelligence === 'object') {
      for (const [k, v] of Object.entries(dealIntelligence)) {
        if (v !== null && v !== undefined && String(v).toLowerCase() !== 'null' && String(v).toLowerCase() !== 'not mentioned' && String(v).trim() !== '') {
          if (!combinedProps[k]) {
            combinedProps[k] = String(v);
          }
        }
      }
    }

    // C. Add verified company metadata if present
    if (companyName && companyName !== 'Acme' && companyName !== 'Untitled') {
      combinedProps.company_name = companyName;
    }
    if (companyDomain) {
      combinedProps.website = `https://${companyDomain}`;
    }
    if (company?.industry && company.industry !== 'Unknown') {
      combinedProps.industry = company.industry;
    }

    const fieldDiffs = [];
    const warnings = [];

    for (const [propName, propValue] of Object.entries(combinedProps)) {
      if (!propValue) continue;

      const mapping = mappings.get(propName.toLowerCase());
      if (!mapping) {
        fieldDiffs.push({
          pulseSyncField: propName,
          destinationObject: 'deal',
          destinationField: 'unmapped',
          previousValue: null,
          newValue: propValue,
          status: 'UNMAPPED'
        });
        continue;
      }

      let prevVal = null;
      if (mapping.destination_object === 'company' && matchedCompany) {
        prevVal = matchedCompany.properties ? matchedCompany.properties[mapping.destination_field_name] : null;
      } else if (mapping.destination_object === 'deal' && matchedDeal) {
        prevVal = matchedDeal.properties ? matchedDeal.properties[mapping.destination_field_name] : null;
      }

      let changeStatus = 'CREATE';
      if (prevVal) {
        if (String(prevVal).trim().toLowerCase() === String(propValue).trim().toLowerCase()) {
          changeStatus = 'UNCHANGED';
        } else {
          changeStatus = 'UPDATE';
          warnings.push(`Overwriting existing ${mapping.destination_object} field "${mapping.destination_field_name}" (${prevVal} → ${propValue})`);
        }
      }

      fieldDiffs.push({
        pulseSyncField: propName,
        destinationObject: mapping.destination_object,
        destinationField: mapping.destination_field_name,
        previousValue: prevVal,
        newValue: propValue,
        status: changeStatus
      });
    }

    // Action Items / Tasks Preview
    const rawActions = summary.action_items || meeting.action_items || [];
    const tasksPreview = rawActions.map((act, idx) => ({
      id: `task-${idx}`,
      task: typeof act === 'string' ? act : act.task,
      owner: typeof act === 'string' ? 'Unassigned' : (act.owner || 'Unassigned'),
      evidence: typeof act === 'string' ? '' : (act.evidence || ''),
      status: 'READY'
    }));

    return {
      destination: {
        id: integration.id,
        name: integration.name,
        provider: integration.provider,
        accountName: integration.auth_metadata?.account_name || 'HubSpot Workspace'
      },
      resolvedRecords: {
        company: matchedCompany ? { id: matchedCompany.id, name: matchedCompany.name, isNew: false, url: matchedCompany.url } : { name: companyName, isNew: true },
        deal: matchedDeal ? { id: matchedDeal.id, name: matchedDeal.name, amount: matchedDeal.amount, isNew: false, url: matchedDeal.url } : { name: dealName, amount: combinedProps.budget, isNew: true }
      },
      contactsSummary: {
        total: speakers.length,
        matched: matchedContactsCount,
        unmatched: unmatchedContactsCount,
        participants
      },
      tasksSummary: {
        total: tasksPreview.length,
        items: tasksPreview
      },
      fieldDiffs,
      warnings,
      readyToSync: true
    };
  }

  /**
   * Executes approved sync to CRM with idempotency, audit trail, and state locking
   */
  async executeSync(meetingId, integrationId, payload = {}) {
    const idempotencyKey =
      payload.idempotencyKey || `sync_${meetingId}_${integrationId}`;

    const targetPortalId = '247215704';

    // 1. Check existing sync state before CRM writes (PostgreSQL or Fallback DB)
    if (!this.useFallbackDb) {
      const existingSuccess = await this.pool.query(
        `SELECT sr.*, m.crm_company_id, m.crm_deal_id, m.workflow_state
         FROM sync_runs sr
         LEFT JOIN meetings m ON m.id = sr.meeting_id
         WHERE (sr.idempotency_key = $1 OR (sr.meeting_id = $2 AND sr.integration_id = $3))
           AND sr.status = 'succeeded'
         ORDER BY sr.completed_at DESC NULLS LAST
         LIMIT 1`,
        [idempotencyKey, meetingId, integrationId]
      );

      if (existingSuccess.rows.length > 0) {
        const existing = existingSuccess.rows[0];
        const records = existing.destination_record_ids || {};
        const companyId = records.companyId || existing.crm_company_id || null;
        const dealId = records.dealId || existing.crm_deal_id || null;

        const itemsRes = await this.pool.query(
          `SELECT destination_object, destination_field, previous_value, new_value, status
           FROM sync_items WHERE sync_run_id = $1`,
          [existing.id]
        );
        const items = itemsRes.rows;
        const fieldsUpdatedCount = items.length;

        this.logger.info(
          { meetingId, integrationId, syncRunId: existing.id },
          'Returning existing successful CRM sync; skipping duplicate writes.'
        );

        if (existing.workflow_state !== 'synced') {
          await this.pool.query(
            `UPDATE meetings SET status = 'synced', workflow_state = 'synced', crm_company_id = COALESCE(crm_company_id, $1), crm_deal_id = COALESCE(crm_deal_id, $2), updated_at = NOW() WHERE id = $3`,
            [companyId, dealId, meetingId]
          );
        }

        return {
          success: true,
          alreadySynced: true,
          syncRunId: existing.id,
          status: 'succeeded',
          completedAt: existing.completed_at || existing.created_at,
          fieldsUpdatedCount,
          summary: {
            fieldsUpdatedCount,
            contactsProcessedCount: records.contactId ? 1 : (records.contactsCount || 0),
            tasksCreatedCount: Array.isArray(records.taskIds) ? records.taskIds.length : (records.tasksCount || 0),
            noteCreated: Boolean(records.noteId)
          },
          updatedRecords: {
            company: {
              id: companyId,
              url: this._buildHubSpotUrl('company', companyId, targetPortalId)
            },
            deal: {
              id: dealId,
              url: this._buildHubSpotUrl('deal', dealId, targetPortalId)
            },
            contact: {
              id: records.contactId || null,
              url: this._buildHubSpotUrl('contact', records.contactId, targetPortalId)
            },
            contactsCount: records.contactId ? 1 : (records.contactsCount || 0),
            tasksCount: Array.isArray(records.taskIds) ? records.taskIds.length : (records.tasksCount || 0),
            taskIds: records.taskIds || [],
            noteId: records.noteId || null
          },
          hubspotUrl: this._buildHubSpotUrl('deal', dealId, targetPortalId) || this._buildHubSpotUrl('company', companyId, targetPortalId),
          items
        };
      }
    } else {
      const data = this.readFallbackDb();
      if (!data.sync_runs) data.sync_runs = [];
      if (!data.sync_items) data.sync_items = [];

      const existingSuccess = data.sync_runs.find(r =>
        (r.idempotency_key === idempotencyKey || (r.meeting_id === meetingId && r.integration_id === integrationId)) &&
        r.status === 'succeeded'
      );

      if (existingSuccess) {
        const records = existingSuccess.destination_record_ids || {};
        const items = data.sync_items.filter(i => i.sync_run_id === existingSuccess.id);
        const fieldsUpdatedCount = items.length;

        const m = (data.meetings || []).find(m => m.id === meetingId);
        if (m && m.workflow_state !== 'synced') {
          m.status = 'synced';
          m.workflow_state = 'synced';
          m.crm_company_id = m.crm_company_id || records.companyId;
          m.crm_deal_id = m.crm_deal_id || records.dealId;
          this.writeFallbackDb(data);
        }

        this.logger.info(
          { meetingId, integrationId, syncRunId: existingSuccess.id },
          'Returning existing successful CRM sync from fallback DB; skipping duplicate writes.'
        );

        return {
          success: true,
          alreadySynced: true,
          syncRunId: existingSuccess.id,
          status: 'succeeded',
          completedAt: existingSuccess.completed_at || existingSuccess.created_at,
          fieldsUpdatedCount,
          summary: {
            fieldsUpdatedCount,
            contactsProcessedCount: records.contactId ? 1 : (records.contactsCount || 0),
            tasksCreatedCount: Array.isArray(records.taskIds) ? records.taskIds.length : (records.tasksCount || 0),
            noteCreated: Boolean(records.noteId)
          },
          updatedRecords: {
            company: {
              id: records.companyId || null,
              url: this._buildHubSpotUrl('company', records.companyId, targetPortalId)
            },
            deal: {
              id: records.dealId || null,
              url: this._buildHubSpotUrl('deal', records.dealId, targetPortalId)
            },
            contact: {
              id: records.contactId || null,
              url: this._buildHubSpotUrl('contact', records.contactId, targetPortalId)
            },
            contactsCount: records.contactId ? 1 : (records.contactsCount || 0),
            tasksCount: Array.isArray(records.taskIds) ? records.taskIds.length : (records.tasksCount || 0),
            taskIds: records.taskIds || [],
            noteId: records.noteId || null
          },
          hubspotUrl: this._buildHubSpotUrl('deal', records.dealId, targetPortalId) || this._buildHubSpotUrl('company', records.companyId, targetPortalId),
          items
        };
      }
    }

    // 2. Concurrency-Safe Atomic Database Reservation
    let syncRunId = crypto.randomUUID();
    let existingPartialRecords = {};

    if (!this.useFallbackDb) {
      const insertRes = await this.pool.query(
        `INSERT INTO sync_runs (id, workspace_id, meeting_id, integration_id, provider, status, destination_record_ids, idempotency_key, created_at)
         VALUES ($1, '00000000-0000-0000-0000-000000000001', $2, $3, 'hubspot', 'in_progress', '{}', $4, NOW())
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id, status, created_at, destination_record_ids`,
        [syncRunId, meetingId, integrationId, idempotencyKey]
      );

      if (insertRes.rows.length === 0) {
        // Idempotency conflict: inspect existing record
        const existingRes = await this.pool.query(
          `SELECT id, status, created_at, completed_at, destination_record_ids, error_message
           FROM sync_runs WHERE idempotency_key = $1`,
          [idempotencyKey]
        );

        if (existingRes.rows.length > 0) {
          const existing = existingRes.rows[0];

          if (existing.status === 'succeeded') {
            const records = existing.destination_record_ids || {};
            const itemsRes = await this.pool.query(
              `SELECT destination_object, destination_field, previous_value, new_value, status
               FROM sync_items WHERE sync_run_id = $1`,
              [existing.id]
            );
            const items = itemsRes.rows;
            const fieldsUpdatedCount = items.length;

            return {
              success: true,
              alreadySynced: true,
              syncRunId: existing.id,
              status: 'succeeded',
              completedAt: existing.completed_at || existing.created_at,
              fieldsUpdatedCount,
              summary: {
                fieldsUpdatedCount,
                contactsProcessedCount: records.contactId ? 1 : 0,
                tasksCreatedCount: Array.isArray(records.taskIds) ? records.taskIds.length : 0,
                noteCreated: Boolean(records.noteId)
              },
              updatedRecords: {
                company: { id: records.companyId, url: this._buildHubSpotUrl('company', records.companyId, targetPortalId) },
                deal: { id: records.dealId, url: this._buildHubSpotUrl('deal', records.dealId, targetPortalId) },
                contact: { id: records.contactId, url: this._buildHubSpotUrl('contact', records.contactId, targetPortalId) },
                contactsCount: records.contactId ? 1 : 0,
                tasksCount: Array.isArray(records.taskIds) ? records.taskIds.length : 0,
                taskIds: records.taskIds || [],
                noteId: records.noteId || null
              },
              hubspotUrl: this._buildHubSpotUrl('deal', records.dealId, targetPortalId) || this._buildHubSpotUrl('company', records.companyId, targetPortalId),
              items
            };
          }

          if (existing.status === 'in_progress') {
            const ageMs = Date.now() - new Date(existing.created_at).getTime();
            if (ageMs < 300000) {
              const error = new Error('This CRM sync is already in progress. Please wait before retrying.');
              error.code = 'SYNC_ALREADY_IN_PROGRESS';
              error.statusCode = 409;
              throw error;
            }
            this.logger.warn({ syncRunId: existing.id, ageMs }, 'Detected stale in-progress sync run; reclaiming reservation.');
          }

          // Existing is failed or stale in-progress -> Take over existing reservation
          syncRunId = existing.id;
          existingPartialRecords = existing.destination_record_ids || {};
          await this.pool.query(
            `UPDATE sync_runs SET status = 'in_progress', created_at = NOW(), error_message = NULL WHERE id = $1`,
            [syncRunId]
          );
        }
      }
    } else {
      const data = this.readFallbackDb();
      const existing = data.sync_runs.find(r => r.idempotency_key === idempotencyKey);
      if (existing) {
        if (existing.status === 'in_progress') {
          const ageMs = Date.now() - new Date(existing.created_at).getTime();
          if (ageMs < 300000) {
            const error = new Error('This CRM sync is already in progress. Please wait before retrying.');
            error.code = 'SYNC_ALREADY_IN_PROGRESS';
            error.statusCode = 409;
            throw error;
          }
        }
        syncRunId = existing.id;
        existing.status = 'in_progress';
        existing.created_at = new Date().toISOString();
        existing.error_message = null;
        existingPartialRecords = existing.destination_record_ids || {};
      } else {
        data.sync_runs.push({
          id: syncRunId,
          workspace_id: '00000000-0000-0000-0000-000000000001',
          meeting_id: meetingId,
          integration_id: integrationId,
          provider: 'hubspot',
          status: 'in_progress',
          destination_record_ids: {},
          idempotency_key: idempotencyKey,
          created_at: new Date().toISOString()
        });
      }
      this.writeFallbackDb(data);
    }

    // 3. Resolve CRM Credentials and Context
    const { accessToken, provider, integration, portalId } =
      await this.resolveAccessToken(integrationId);

    const adapter = this.getAdapter(provider);
    const resolvedPortalId = portalId || integration?.auth_metadata?.portal_id || targetPortalId;

    this.logger.info(
      { meetingId, integrationId, syncRunId, idempotencyKey },
      'Executing CRM sync transaction under confirmed reservation...'
    );

    // 4. Prepare Context & Reconcile Existing Records
    const prep = await this.prepareSync(meetingId, integrationId);
    let meeting = null;
    let summary = null;
    let company = null;
    let speakers = [];

    if (!this.useFallbackDb) {
      const mRes = await this.pool.query('SELECT * FROM meetings WHERE id = $1', [meetingId]);
      if (mRes.rows.length > 0) meeting = mRes.rows[0];
      const sumRes = await this.pool.query('SELECT * FROM meeting_summaries WHERE meeting_id = $1', [meetingId]);
      if (sumRes.rows.length > 0) summary = sumRes.rows[0];
      if (meeting?.company_id) {
        const cRes = await this.pool.query('SELECT * FROM companies WHERE id = $1', [meeting.company_id]);
        if (cRes.rows.length > 0) company = cRes.rows[0];
      }
      const spkRes = await this.pool.query('SELECT * FROM speakers WHERE meeting_id = $1', [meetingId]);
      speakers = spkRes.rows;
    } else {
      const data = this.readFallbackDb();
      meeting = (data.meetings || []).find(m => m.id === meetingId) || {};
      summary = (data.summaries || []).find(s => s.meeting_id === meetingId) || {};
      company = (data.companies || []).find(c => c.id === meeting.company_id) || {};
      speakers = (data.speakers || []).filter(s => s.meeting_id === meetingId);
    }

    const normalize = str => String(str || '').toLowerCase().replace(/[\s_-]+/g, '');

    // Strict validation: Only sync user-approved fields
    const approvedDiffs = (payload.approvedFields && Array.isArray(payload.approvedFields))
      ? prep.fieldDiffs.filter(d => payload.approvedFields.some(af =>
        normalize(af) === normalize(d.pulseSyncField) ||
        normalize(af) === normalize(d.destinationField)
      ))
      : prep.fieldDiffs.filter(d => d.status !== 'SKIPPED' && d.status !== 'UNMAPPED');

    // Reconcile IDs: reuse existing HubSpot IDs from previous partial runs or meeting table
    let companyId = meeting.crm_company_id || existingPartialRecords.companyId || prep.resolvedRecords?.company?.id || null;
    let dealId = meeting.crm_deal_id || existingPartialRecords.dealId || prep.resolvedRecords?.deal?.id || null;
    const syncedContactIds = existingPartialRecords.contactId ? [existingPartialRecords.contactId] : [];
    const syncedTaskIds = Array.isArray(existingPartialRecords.taskIds) ? [...existingPartialRecords.taskIds] : [];
    let noteId = existingPartialRecords.noteId || null;

    // Group properties by object
    const companyProps = {};
    const dealProps = {};

    approvedDiffs.forEach(d => {
      if (d.destinationObject === 'company') {
        if (d.destinationField === 'domain') {
          companyProps.domain = String(d.newValue).replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
        } else if (d.destinationField === 'name') {
          companyProps.name = d.newValue;
        } else if (d.destinationField === 'industry') {
          companyProps.industry = 'COMPUTER_SOFTWARE';
        }
      }
      if (d.destinationObject === 'deal') {
        if (d.destinationField === 'amount') {
          const num = parseFloat(String(d.newValue).replace(/[^0-9.]/g, ''));
          dealProps.amount = isNaN(num) ? 50000 : num;
        } else if (d.destinationField === 'closedate') {
          dealProps.closedate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).getTime();
        } else if (d.destinationField === 'dealstage') {
          dealProps.dealstage = d.newValue || 'appointmentscheduled';
        }
      }
    });

    const meddicSummary = approvedDiffs.map(d => `${d.pulseSyncField}: ${d.newValue}`).join(' | ');
    dealProps.description = `Verified MEDDICC Intelligence: ${meddicSummary}`;

    let hubspotCompanyUrl = '';
    let hubspotDealUrl = '';

    try {
      // 5. Execute Company
      if (companyId) {
        if (Object.keys(companyProps).length > 0) {
          const updated = await adapter.updateCompany(accessToken, companyId, companyProps);
          hubspotCompanyUrl = updated?.url || this._buildHubSpotUrl('company', companyId, resolvedPortalId);
        } else {
          hubspotCompanyUrl = this._buildHubSpotUrl('company', companyId, resolvedPortalId);
        }
      } else {
        const created = await adapter.createCompany(accessToken, {
          name: prep.resolvedRecords?.company?.name || company?.name || meeting.title.split(' ')[0] || 'Acme',
          ...companyProps
        });
        companyId = created.id;
        hubspotCompanyUrl = created?.url || this._buildHubSpotUrl('company', companyId, resolvedPortalId);
      }

      // 6. Execute Contacts
      const participantResolutions = payload.participantResolutions || {};
      for (const part of prep.contactsSummary.participants) {
        if (part.crmContactId) {
          if (!syncedContactIds.includes(part.crmContactId)) syncedContactIds.push(part.crmContactId);
        } else if (participantResolutions[part.speakerId] === 'create' || (!part.name.toLowerCase().startsWith('speaker') && part.name.length > 2)) {
          try {
            const names = part.name.trim().split(' ');
            const firstname = names[0] || '';
            const lastname = names.slice(1).join(' ') || 'Contact';
            const created = await adapter.createContact(accessToken, {
              firstname,
              lastname,
              email: part.email || `${firstname.toLowerCase()}@${companyProps.domain || 'company.com'}`,
              jobtitle: part.role || 'Stakeholder'
            });
            if (created && created.id) {
              if (!syncedContactIds.includes(created.id)) syncedContactIds.push(created.id);
              if (companyId) {
                await adapter.associate(accessToken, 'contacts', created.id, 'companies', companyId).catch(() => { });
              }
            }
          } catch (ctErr) {
            const errMsg = ctErr.hubspotError?.message || ctErr.message || '';
            if (errMsg.includes('Existing ID:')) {
              const match = errMsg.match(/Existing ID:\s*([0-9]+)/);
              if (match && match[1]) {
                const existingId = match[1];
                if (!syncedContactIds.includes(existingId)) syncedContactIds.push(existingId);
                if (companyId) {
                  await adapter.associate(accessToken, 'contacts', existingId, 'companies', companyId).catch(() => { });
                }
              }
            }
            this.logger.warn({ ctErr }, `Contact creation for ${part.name} handled.`);
          }
        }
      }

      // 7. Execute Deal
      if (dealId) {
        if (Object.keys(dealProps).length > 0) {
          const updated = await adapter.updateDeal(accessToken, dealId, dealProps);
          hubspotDealUrl = updated?.url || this._buildHubSpotUrl('deal', dealId, resolvedPortalId);
        } else {
          hubspotDealUrl = this._buildHubSpotUrl('deal', dealId, resolvedPortalId);
        }
      } else {
        const created = await adapter.createDeal(accessToken, {
          dealname: prep.resolvedRecords?.deal?.name || `${prep.resolvedRecords?.company?.name || 'Enterprise'} - Expansion`,
          ...dealProps
        }, { companyId, contactIds: syncedContactIds });
        dealId = created.id;
        hubspotDealUrl = created?.url || this._buildHubSpotUrl('deal', dealId, resolvedPortalId);
      }

      // 8. Execute CRM Tasks (reconciling to avoid duplicate tasks)
      const rawActions = summary?.action_items || meeting.action_items || [];
      if (syncedTaskIds.length === 0) {
        for (const act of rawActions) {
          const taskText = typeof act === 'string' ? act : act.task;
          const taskOwner = typeof act === 'string' ? 'Rep' : (act.owner || 'Rep');
          if (taskText) {
            try {
              const createdTask = await adapter.createTask(accessToken, {
                subject: taskText,
                owner: taskOwner,
                body: `Action item from PulseSync AI meeting: ${meeting.title || 'Sales Call'}`
              }, { companyId, dealId, contactIds: syncedContactIds });
              if (createdTask && createdTask.id) {
                syncedTaskIds.push(createdTask.id);
              }
            } catch (tErr) {
              this.logger.warn({ tErr }, `Task creation failed for "${taskText}"`);
            }
          }
        }
      }

      // 9. Create Meeting Engagement Note (skip if already created in earlier attempt)
      if (!noteId) {
        try {
          const formatFieldName = field => {
            const map = {
              metrics: "Metrics",
              economic_buyer: "Economic Buyer",
              decision_criteria: "Decision Criteria",
              decision_process: "Decision Process",
              identify_pain: "Pain Points",
              champion: "Champion",
              competition: "Competition",
              budget: "Budget",
              timeline: "Timeline"
            };
            return map[field.toLowerCase()] || field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          };

          const risks = summary?.risks || meeting.risks || [];
          const risksHtml = risks.length > 0
            ? risks.map(r => `<li>${typeof r === 'string' ? r : r.risk}</li>`).join('')
            : '<li>No high-priority risks detected.</li>';

          const actionsHtml = rawActions.length > 0
            ? rawActions.map(a => `<li>${typeof a === 'string' ? a : a.task} ${a.owner ? `(Owner: ${a.owner})` : ''}</li>`).join('')
            : '<li>No outstanding action items.</li>';

          const noteHtml = `<h3>PulseSync AI — Meeting Summary</h3>
<p><strong>Meeting:</strong> ${meeting.title || 'Sales Call'}</p>
<p><strong>Date:</strong> ${new Date(meeting.created_at || Date.now()).toLocaleDateString()}</p>
<hr/>
<p><strong>EXECUTIVE SUMMARY</strong><br/>
${summary?.overview || meeting.overview || 'Meeting intelligence compiled and verified from conversation.'}</p>
<br/>
<p><strong>🎯 PLAYBOOK INTELLIGENCE (VERIFIED)</strong></p>
<ul>
${approvedDiffs.map(d => `<li><strong>${formatFieldName(d.pulseSyncField)}:</strong> ${d.newValue}</li>`).join('')}
</ul>
<br/>
<p><strong>⚠️ VERIFIED RISKS</strong></p>
<ul>
${risksHtml}
</ul>
<br/>
<p><strong>📋 NEXT ACTIONS</strong></p>
<ul>
${actionsHtml}
</ul>
<hr/>
<p><small>Source: PulseSync AI Intelligence Layer &bull; <a href="http://localhost:5173" target="_blank">View Call & Evidence in PulseSync</a></small></p>`;

          const createdNote = await adapter.createEngagementNote(accessToken, {
            title: prep.resolvedRecords?.deal?.name || meeting.title || 'PulseSync Meeting',
            body: noteHtml
          }, { companyId, contactIds: syncedContactIds, dealId });
          noteId = createdNote?.id || null;
        } catch (eErr) {
          this.logger.warn({ eErr }, 'Engagement note logging skipped.');
        }
      }

      // 10. Update Reserved sync_runs Record to Succeeded (Single Row Update)
      const destinationRecordIds = { companyId, contactId: syncedContactIds[0] || null, dealId, noteId, taskIds: syncedTaskIds };
      const completedAt = new Date().toISOString();

      if (!this.useFallbackDb) {
        await this.pool.query(
          `UPDATE sync_runs
           SET status = 'succeeded',
               destination_record_ids = $1,
               completed_at = NOW(),
               error_message = NULL
           WHERE id = $2`,
          [JSON.stringify(destinationRecordIds), syncRunId]
        );

        // Delete any previously written items for this sync run ID (in case of retry)
        await this.pool.query('DELETE FROM sync_items WHERE sync_run_id = $1', [syncRunId]);

        for (const diff of approvedDiffs) {
          await this.pool.query(
            `INSERT INTO sync_items (sync_run_id, destination_object, destination_field, previous_value, new_value, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [syncRunId, diff.destinationObject, diff.destinationField, String(diff.previousValue || ''), String(diff.newValue || ''), diff.status.toLowerCase()]
          );
        }

        await this.pool.query(
          `UPDATE meetings SET 
             status = 'synced', 
             workflow_state = 'synced', 
             crm_company_id = $1, 
             crm_deal_id = $2, 
             updated_at = NOW() 
           WHERE id = $3`,
          [companyId, dealId, meetingId]
        );

        await this.pool.query(
          `UPDATE integrations SET last_sync_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [integrationId]
        );
      } else {
        const data = this.readFallbackDb();
        const run = (data.sync_runs || []).find(r => r.id === syncRunId);
        if (run) {
          run.status = 'succeeded';
          run.destination_record_ids = destinationRecordIds;
          run.completed_at = completedAt;
          run.error_message = null;
        }

        data.sync_items = (data.sync_items || []).filter(i => i.sync_run_id !== syncRunId);
        approvedDiffs.forEach(diff => {
          data.sync_items.push({
            id: crypto.randomUUID(),
            sync_run_id: syncRunId,
            destination_object: diff.destinationObject,
            destination_field: diff.destinationField,
            previous_value: String(diff.previousValue || ''),
            new_value: String(diff.newValue || ''),
            status: diff.status.toLowerCase(),
            created_at: completedAt
          });
        });

        const m = (data.meetings || []).find(m => m.id === meetingId);
        if (m) {
          m.status = 'synced';
          m.workflow_state = 'synced';
          m.crm_company_id = companyId;
          m.crm_deal_id = dealId;
          m.updated_at = completedAt;
        }

        const intg = (data.integrations || []).find(i => i.id === integrationId);
        if (intg) {
          intg.last_sync_at = completedAt;
          intg.updated_at = completedAt;
        }

        this.writeFallbackDb(data);
      }

      return {
        success: true,
        alreadySynced: false,
        syncRunId,
        status: 'succeeded',
        completedAt,
        fieldsUpdatedCount: approvedDiffs.length,
        summary: {
          fieldsUpdatedCount: approvedDiffs.length,
          contactsProcessedCount: syncedContactIds.length,
          tasksCreatedCount: syncedTaskIds.length,
          noteCreated: Boolean(noteId)
        },
        updatedRecords: {
          company: { id: companyId, url: hubspotCompanyUrl || this._buildHubSpotUrl('company', companyId, resolvedPortalId) },
          deal: { id: dealId, url: hubspotDealUrl || this._buildHubSpotUrl('deal', dealId, resolvedPortalId) },
          contact: { id: syncedContactIds[0] || null, url: this._buildHubSpotUrl('contact', syncedContactIds[0], resolvedPortalId) },
          contactsCount: syncedContactIds.length,
          tasksCount: syncedTaskIds.length,
          taskIds: syncedTaskIds,
          noteId
        },
        hubspotUrl: hubspotDealUrl || hubspotCompanyUrl || this._buildHubSpotUrl('deal', dealId, resolvedPortalId) || `https://app.hubspot.com/contacts/${resolvedPortalId}/record/0-2/${companyId || ''}`,
        items: approvedDiffs.map(diff => ({
          destinationObject: diff.destinationObject,
          destinationField: diff.destinationField,
          previousValue: diff.previousValue,
          newValue: diff.newValue,
          status: diff.status
        }))
      };
    } catch (syncErr) {
      this.logger.error({ syncErr, meetingId, syncRunId }, 'Sync failure during HubSpot operations; saving partial audit state.');
      const partialRecordIds = { companyId, contactId: syncedContactIds[0] || null, dealId, noteId, taskIds: syncedTaskIds };

      if (!this.useFallbackDb) {
        await this.pool.query(
          `UPDATE sync_runs
           SET status = 'failed',
               destination_record_ids = $1,
               error_message = $2,
               completed_at = NOW()
           WHERE id = $3`,
          [JSON.stringify(partialRecordIds), syncErr.message || 'CRM sync failed', syncRunId]
        );

        await this.pool.query(
          `UPDATE meetings
           SET status = 'failed',
               workflow_state = 'failed',
               crm_company_id = COALESCE(crm_company_id, $1),
               crm_deal_id = COALESCE(crm_deal_id, $2),
               updated_at = NOW()
           WHERE id = $3`,
          [companyId, dealId, meetingId]
        );
      } else {
        const data = this.readFallbackDb();
        const run = (data.sync_runs || []).find(r => r.id === syncRunId);
        if (run) {
          run.status = 'failed';
          run.destination_record_ids = partialRecordIds;
          run.error_message = syncErr.message || 'CRM sync failed';
          run.completed_at = new Date().toISOString();
        }
        const m = (data.meetings || []).find(m => m.id === meetingId);
        if (m) {
          m.status = 'failed';
          m.workflow_state = 'failed';
          m.crm_company_id = m.crm_company_id || companyId;
          m.crm_deal_id = m.crm_deal_id || dealId;
        }
        this.writeFallbackDb(data);
      }

      throw syncErr;
    }
  }
}


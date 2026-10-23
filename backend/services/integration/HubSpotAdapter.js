import { BaseCrmAdapter } from './BaseCrmAdapter.js';

const HUBSPOT_API_BASE = 'https://api.hubapi.com';
const HUBSPOT_OAUTH_BASE = 'https://app.hubspot.com/oauth/authorize';

export class HubSpotAdapter extends BaseCrmAdapter {
  constructor(config = {}) {
    super(config);
    this.clientId = config.clientId || process.env.HUBSPOT_CLIENT_ID || 'pulsesync_hubspot_client_id_placeholder';
    this.clientSecret = config.clientSecret || process.env.HUBSPOT_CLIENT_SECRET || 'pulsesync_hubspot_client_secret_placeholder';
    this.scopes = config.scopes || [
      'crm.objects.companies.read',
      'crm.objects.companies.write',
      'crm.objects.contacts.read',
      'crm.objects.contacts.write',
      'crm.objects.deals.read',
      'crm.objects.deals.write',
      'crm.schemas.companies.read',
      'crm.schemas.contacts.read',
      'crm.schemas.deals.read',
      'sales-email-read'
    ].join(' ');
  }

  getProviderName() {
    return 'hubspot';
  }

  getAuthUrl(state, redirectUri) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: this.scopes,
      state: state
    });
    return `${HUBSPOT_OAUTH_BASE}?${params.toString()}`;
  }

  async _request(endpoint, options = {}, token) {
    const url = endpoint.startsWith('http') ? endpoint : `${HUBSPOT_API_BASE}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };

    let retries = 0;
    const maxRetries = 2;

    while (retries <= maxRetries) {
      try {
        const response = await fetch(url, {
          ...options,
          headers,
          signal: AbortSignal.timeout(20000)
        });

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
          console.warn(`[HubSpotAdapter] Rate limited (429). Retrying after ${retryAfter}s...`);
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          retries++;
          continue;
        }

        if (!response.ok) {
          let errorBody = {};
          try {
            errorBody = await response.json();
          } catch (e) {
            errorBody = { message: response.statusText };
          }
          const err = new Error(errorBody.message || `HubSpot API returned status ${response.status}`);
          err.status = response.status;
          err.hubspotError = errorBody;
          throw err;
        }

        if (response.status === 204) return null;
        return await response.json();
      } catch (err) {
        if (retries >= maxRetries || (err.status && err.status < 500 && err.status !== 429)) {
          throw err;
        }
        retries++;
        await new Promise(r => setTimeout(r, Math.pow(2, retries) * 500));
      }
    }
  }

  async exchangeCode(code, redirectUri) {
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('client_id', this.clientId);
    params.append('client_secret', this.clientSecret);
    params.append('redirect_uri', redirectUri);
    params.append('code', code);

    const response = await fetch(`${HUBSPOT_API_BASE}/oauth/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.message || `OAuth token exchange failed with status ${response.status}`);
    }

    const data = await response.json();
    
    // Fetch account info
    let accountId = 'hubspot_portal';
    let accountName = 'HubSpot Account';
    try {
      const meRes = await this._request('/integrations/v1/me', {}, data.access_token);
      if (meRes && meRes.portalId) {
        accountId = String(meRes.portalId);
        accountName = meRes.accountName || `HubSpot Portal #${meRes.portalId}`;
      }
    } catch (e) {
      console.warn('[HubSpotAdapter] Could not fetch portal info:', e.message);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      accountId,
      accountName,
      tokenScope: data.scope || this.scopes
    };
  }

  async refreshToken(refreshToken) {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', this.clientId);
    params.append('client_secret', this.clientSecret);
    params.append('refresh_token', refreshToken);

    const response = await fetch(`${HUBSPOT_API_BASE}/oauth/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.message || `Failed to refresh HubSpot token: ${response.status}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: data.expires_in
    };
  }

  async testConnection(accessToken) {
    try {
      // 1. Try account-info endpoint (supported by standard tokens and Private Apps)
      try {
        const info = await this._request('/account-info/v3/details', {}, accessToken);
        if (info && info.portalId) {
          return {
            success: true,
            accountId: String(info.portalId),
            accountName: info.accountName || `HubSpot Portal #${info.portalId}`
          };
        }
      } catch (e) {
        // Continue to fallback
      }

      // 2. Try testing CRM schema read access
      try {
        const props = await this._request('/crm/v3/properties/contacts', {}, accessToken);
        if (props && Array.isArray(props.results)) {
          return {
            success: true,
            accountId: 'hubspot_portal',
            accountName: 'HubSpot Active Workspace'
          };
        }
      } catch (e) {
        // Continue to fallback
      }

      // 3. Try integrations/v1/me (OAuth apps)
      const res = await this._request('/integrations/v1/me', {}, accessToken);
      return {
        success: true,
        accountId: res?.portalId ? String(res.portalId) : 'connected_portal',
        accountName: res?.accountName || `HubSpot Portal #${res?.portalId || ''}`
      };
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        return { success: false, error: 'Invalid token or insufficient scopes. Ensure Private App has CRM read/write scopes.' };
      }
      return { success: false, error: err.message || 'Connection test failed' };
    }
  }

  async getProperties(accessToken, objectType) {
    const hsTypeMap = { company: 'companies', contact: 'contacts', deal: 'deals' };
    const endpointType = hsTypeMap[objectType] || objectType;

    const data = await this._request(`/crm/v3/properties/${endpointType}`, {}, accessToken);
    if (!data || !Array.isArray(data.results)) return [];

    return data.results.map(prop => ({
      name: prop.name,
      label: prop.label,
      type: prop.type,
      fieldType: prop.fieldType,
      description: prop.description || '',
      isCustom: !prop.hubspotDefined,
      options: Array.isArray(prop.options) ? prop.options.map(o => o.value) : []
    }));
  }

  _buildUrl(type, id, portalId = '') {
    const pId = portalId || process.env.HUBSPOT_PORTAL_ID || '';
    if (!pId) return null;
    const typeMap = {
      contact: '0-1',
      company: '0-2',
      deal: '0-3',
      task: '0-27'
    };
    return `https://app.hubspot.com/contacts/${pId}/record/${typeMap[type] || '0-3'}/${id}`;
  }

  async searchCompany(accessToken, query = {}) {
    // 1. Try search by domain first if provided
    if (query.domain) {
      try {
        const filters = [{ propertyName: 'domain', operator: 'EQ', value: query.domain.toLowerCase() }];
        const body = {
          filterGroups: [{ filters }],
          properties: ['name', 'domain', 'industry', 'city', 'country', 'phone', 'annualrevenue'],
          limit: 10
        };
        const data = await this._request('/crm/v3/objects/companies/search', {
          method: 'POST',
          body: JSON.stringify(body)
        }, accessToken);
        if (data && Array.isArray(data.results) && data.results.length > 0) {
          return data.results.map(r => ({
            id: r.id,
            name: r.properties.name || query.name || 'Unnamed Company',
            domain: r.properties.domain || '',
            properties: r.properties,
            url: this._buildUrl('company', r.id)
          }));
        }
      } catch (err) {
        console.warn('[HubSpotAdapter] searchCompany by domain error:', err.message);
      }
    }

    // 2. If no domain match or no domain provided, fallback to search by name
    if (query.name && query.name !== 'Acme' && query.name !== 'Untitled') {
      try {
        const filters = [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: query.name }];
        const body = {
          filterGroups: [{ filters }],
          properties: ['name', 'domain', 'industry', 'city', 'country', 'phone', 'annualrevenue'],
          limit: 10
        };
        const data = await this._request('/crm/v3/objects/companies/search', {
          method: 'POST',
          body: JSON.stringify(body)
        }, accessToken);
        if (data && Array.isArray(data.results) && data.results.length > 0) {
          return data.results.map(r => ({
            id: r.id,
            name: r.properties.name || query.name || 'Unnamed Company',
            domain: r.properties.domain || '',
            properties: r.properties,
            url: this._buildUrl('company', r.id)
          }));
        }
      } catch (err) {
        console.warn('[HubSpotAdapter] searchCompany by name error:', err.message);
      }
    }

    return [];
  }

  async createCompany(accessToken, properties = {}) {
    const data = await this._request('/crm/v3/objects/companies', {
      method: 'POST',
      body: JSON.stringify({ properties })
    }, accessToken);

    return {
      id: data.id,
      name: data.properties.name || '',
      domain: data.properties.domain || '',
      properties: data.properties,
      url: this._buildUrl('company', data.id)
    };
  }

  async updateCompany(accessToken, companyId, properties = {}) {
    const data = await this._request(`/crm/v3/objects/companies/${companyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties })
    }, accessToken);

    return {
      id: data.id,
      name: data.properties.name || '',
      domain: data.properties.domain || '',
      properties: data.properties,
      url: this._buildUrl('company', data.id)
    };
  }

  async searchContact(accessToken, query = {}) {
    const filters = [];
    if (query.email) {
      filters.push({ propertyName: 'email', operator: 'EQ', value: query.email.toLowerCase() });
    } else if (query.name) {
      filters.push({ propertyName: 'firstname', operator: 'CONTAINS_TOKEN', value: query.name });
    }

    const body = {
      filterGroups: filters.length > 0 ? [{ filters }] : [],
      properties: ['email', 'firstname', 'lastname', 'jobtitle', 'phone', 'company'],
      limit: 10
    };

    try {
      const data = await this._request('/crm/v3/objects/contacts/search', {
        method: 'POST',
        body: JSON.stringify(body)
      }, accessToken);

      return (data.results || []).map(r => ({
        id: r.id,
        email: r.properties.email || '',
        firstName: r.properties.firstname || '',
        lastName: r.properties.lastname || '',
        jobTitle: r.properties.jobtitle || '',
        properties: r.properties,
        url: this._buildUrl('contact', r.id)
      }));
    } catch (err) {
      console.warn('[HubSpotAdapter] searchContact error:', err.message);
      return [];
    }
  }

  async createContact(accessToken, properties = {}) {
    const data = await this._request('/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({ properties })
    }, accessToken);

    return {
      id: data.id,
      email: data.properties.email || '',
      firstName: data.properties.firstname || '',
      lastName: data.properties.lastname || '',
      properties: data.properties,
      url: this._buildUrl('contact', data.id)
    };
  }

  async updateContact(accessToken, contactId, properties = {}) {
    const data = await this._request(`/crm/v3/objects/contacts/${contactId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties })
    }, accessToken);

    return {
      id: data.id,
      email: data.properties.email || '',
      firstName: data.properties.firstname || '',
      lastName: data.properties.lastname || '',
      properties: data.properties,
      url: this._buildUrl('contact', data.id)
    };
  }

  async searchDeal(accessToken, query = {}) {
    const filters = [];
    if (query.name) {
      filters.push({ propertyName: 'dealname', operator: 'CONTAINS_TOKEN', value: query.name });
    }

    const body = {
      filterGroups: filters.length > 0 ? [{ filters }] : [],
      properties: ['dealname', 'amount', 'dealstage', 'closedate', 'pipeline'],
      limit: 10
    };

    try {
      const data = await this._request('/crm/v3/objects/deals/search', {
        method: 'POST',
        body: JSON.stringify(body)
      }, accessToken);

      return (data.results || []).map(r => ({
        id: r.id,
        name: r.properties.dealname || '',
        amount: r.properties.amount || 0,
        stage: r.properties.dealstage || '',
        properties: r.properties,
        url: this._buildUrl('deal', r.id)
      }));
    } catch (err) {
      console.warn('[HubSpotAdapter] searchDeal error:', err.message);
      return [];
    }
  }

  async createDeal(accessToken, properties = {}, associations = {}) {
    const props = {
      pipeline: properties.pipeline || 'default',
      dealstage: properties.dealstage || 'appointmentscheduled',
      ...properties
    };
    const payload = { properties: props };
    
    // Add associations if provided
    if (associations.companyId || (associations.contactIds && associations.contactIds.length > 0)) {
      payload.associations = [];
      if (associations.companyId) {
        payload.associations.push({
          to: { id: associations.companyId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }] // Deal to Company
        });
      }
      if (associations.contactIds) {
        associations.contactIds.forEach(cId => {
          payload.associations.push({
            to: { id: cId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] // Deal to Contact
          });
        });
      }
    }

    const data = await this._request('/crm/v3/objects/deals', {
      method: 'POST',
      body: JSON.stringify(payload)
    }, accessToken);

    return {
      id: data.id,
      name: data.properties.dealname || '',
      amount: data.properties.amount || 0,
      stage: data.properties.dealstage || '',
      properties: data.properties,
      url: this._buildUrl('deal', data.id)
    };
  }

  async updateDeal(accessToken, dealId, properties = {}) {
    const data = await this._request(`/crm/v3/objects/deals/${dealId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties })
    }, accessToken);

    return {
      id: data.id,
      name: data.properties.dealname || '',
      amount: data.properties.amount || 0,
      stage: data.properties.dealstage || '',
      properties: data.properties,
      url: this._buildUrl('deal', data.id)
    };
  }

  async createEngagementNote(accessToken, meetingData, associations = {}) {
    const noteBody = meetingData.body || `<h3>PulseSync AI — Meeting Intelligence</h3><p>Session: ${meetingData.title}</p>`;
    const notePayload = {
      properties: {
        hs_timestamp: new Date().toISOString(),
        hs_note_body: noteBody
      }
    };

    if (associations.companyId || associations.dealId || (associations.contactIds && associations.contactIds.length > 0)) {
      notePayload.associations = [];
      if (associations.companyId) {
        notePayload.associations.push({
          to: { id: String(associations.companyId) },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 }] // Note to Company
        });
      }
      if (associations.dealId) {
        notePayload.associations.push({
          to: { id: String(associations.dealId) },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }] // Note to Deal
        });
      }
      if (associations.contactIds) {
        associations.contactIds.forEach(cId => {
          notePayload.associations.push({
            to: { id: String(cId) },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] // Note to Contact
          });
        });
      }
    }

    try {
      const data = await this._request('/crm/v3/objects/notes', {
        method: 'POST',
        body: JSON.stringify(notePayload)
      }, accessToken);
      console.log('[HubSpotAdapter] Created Note with associations successfully. Note ID:', data?.id);
      return data;
    } catch (err) {
      console.warn('[HubSpotAdapter] createEngagementNote with associations failed, trying separate creation and link:', err.message);
      try {
        // Fallback: create plain note then link
        const plainData = await this._request('/crm/v3/objects/notes', {
          method: 'POST',
          body: JSON.stringify({
            properties: {
              hs_timestamp: new Date().toISOString(),
              hs_note_body: noteBody
            }
          })
        }, accessToken);

        if (plainData && plainData.id) {
          const noteId = plainData.id;
          if (associations.companyId) {
            await this._request(`/crm/v3/objects/notes/${noteId}/associations/companies/${associations.companyId}/default`, { method: 'PUT' }, accessToken).catch(() => {});
          }
          if (associations.dealId) {
            await this._request(`/crm/v3/objects/notes/${noteId}/associations/deals/${associations.dealId}/default`, { method: 'PUT' }, accessToken).catch(() => {});
          }
          if (associations.contactIds) {
            for (const cId of associations.contactIds) {
              await this._request(`/crm/v3/objects/notes/${noteId}/associations/contacts/${cId}/default`, { method: 'PUT' }, accessToken).catch(() => {});
            }
          }
          console.log('[HubSpotAdapter] Created Plain Note and linked associations successfully. Note ID:', noteId);
          return plainData;
        }
      } catch (fErr) {
        console.error('[HubSpotAdapter] Failed to create engagement note fallback:', fErr.message);
      }
      return null;
    }
  }

  async createTask(accessToken, taskData, associations = {}) {
    const taskPayload = {
      properties: {
        hs_task_subject: taskData.subject || taskData.task || 'Action Item',
        hs_task_body: taskData.body || `Action item from PulseSync AI meeting${taskData.owner ? ` (Owner: ${taskData.owner})` : ''}`,
        hs_task_status: taskData.status || 'NOT_STARTED',
        hs_task_priority: taskData.priority || 'MEDIUM',
        hs_timestamp: new Date().toISOString()
      }
    };

    if (associations.companyId || associations.dealId || (associations.contactIds && associations.contactIds.length > 0)) {
      taskPayload.associations = [];
      if (associations.companyId) {
        taskPayload.associations.push({
          to: { id: String(associations.companyId) },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 192 }] // Task to Company
        });
      }
      if (associations.dealId) {
        taskPayload.associations.push({
          to: { id: String(associations.dealId) },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 216 }] // Task to Deal
        });
      }
      if (associations.contactIds) {
        associations.contactIds.forEach(cId => {
          taskPayload.associations.push({
            to: { id: String(cId) },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 204 }] // Task to Contact
          });
        });
      }
    }

    try {
      const data = await this._request('/crm/v3/objects/tasks', {
        method: 'POST',
        body: JSON.stringify(taskPayload)
      }, accessToken);
      console.log('[HubSpotAdapter] Created Task successfully. Task ID:', data?.id);
      return {
        id: data.id,
        subject: taskData.subject || taskData.task,
        status: data.properties?.hs_task_status || 'NOT_STARTED',
        url: `https://app.hubspot.com/tasks/record/0-27/${data.id}`
      };
    } catch (err) {
      console.warn('[HubSpotAdapter] createTask with associations failed, trying plain creation:', err.message);
      try {
        const plainData = await this._request('/crm/v3/objects/tasks', {
          method: 'POST',
          body: JSON.stringify({
            properties: {
              hs_task_subject: taskData.subject || taskData.task || 'Action Item',
              hs_task_body: taskData.body || `Action item from PulseSync AI meeting${taskData.owner ? ` (Owner: ${taskData.owner})` : ''}`,
              hs_task_status: 'NOT_STARTED',
              hs_timestamp: new Date().toISOString()
            }
          })
        }, accessToken);

        if (plainData && plainData.id) {
          const taskId = plainData.id;
          if (associations.companyId) {
            await this._request(`/crm/v3/objects/tasks/${taskId}/associations/companies/${associations.companyId}/default`, { method: 'PUT' }, accessToken).catch(() => {});
          }
          if (associations.dealId) {
            await this._request(`/crm/v3/objects/tasks/${taskId}/associations/deals/${associations.dealId}/default`, { method: 'PUT' }, accessToken).catch(() => {});
          }
          return {
            id: taskId,
            subject: taskData.subject || taskData.task,
            status: 'NOT_STARTED',
            url: `https://app.hubspot.com/tasks/record/0-27/${taskId}`
          };
        }
      } catch (fErr) {
        console.error('[HubSpotAdapter] Failed to create task fallback:', fErr.message);
      }
      return null;
    }
  }

  async associate(accessToken, fromObjectType, fromId, toObjectType, toId) {
    try {
      await this._request(`/crm/v3/objects/${fromObjectType}/${fromId}/associations/${toObjectType}/${toId}/default`, {
        method: 'PUT'
      }, accessToken);
      return true;
    } catch (err) {
      console.warn(`[HubSpotAdapter] associate failed (${fromObjectType} ${fromId} -> ${toObjectType} ${toId}):`, err.message);
      return false;
    }
  }
}

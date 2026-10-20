/**
 * BaseCrmAdapter
 * Abstract base class defining the contract for all CRM Integration Adapters
 * (HubSpot, Salesforce, Pipedrive, etc.)
 */
export class BaseCrmAdapter {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * @returns {string} e.g. 'hubspot', 'salesforce', 'pipedrive'
   */
  getProviderName() {
    throw new Error('getProviderName() must be implemented by adapter');
  }

  /**
   * Generates OAuth authorization URL
   * @param {string} state - CSRF state token
   * @param {string} redirectUri
   * @returns {string}
   */
  getAuthUrl(state, redirectUri) {
    throw new Error('getAuthUrl() must be implemented by adapter');
  }

  /**
   * Exchanges OAuth authorization code for tokens
   * @param {string} code
   * @param {string} redirectUri
   * @returns {Promise<{ accessToken: string, refreshToken: string, expiresIn: number, accountId: string, accountName: string, tokenScope: string }>}
   */
  async exchangeCode(code, redirectUri) {
    throw new Error('exchangeCode() must be implemented by adapter');
  }

  /**
   * Refreshes expired access token using refresh token
   * @param {string} refreshToken
   * @returns {Promise<{ accessToken: string, refreshToken: string, expiresIn: number }>}
   */
  async refreshToken(refreshToken) {
    throw new Error('refreshToken() must be implemented by adapter');
  }

  /**
   * Tests whether the current credentials are valid against live CRM
   * @param {string} accessToken
   * @returns {Promise<{ success: boolean, accountId?: string, accountName?: string, error?: string }>}
   */
  async testConnection(accessToken) {
    throw new Error('testConnection() must be implemented by adapter');
  }

  /**
   * Retrieves available properties for an object type from CRM
   * @param {string} accessToken
   * @param {'company'|'contact'|'deal'} objectType
   * @returns {Promise<Array<{ name: string, label: string, type: string, isCustom: boolean, options?: Array<string> }>>}
   */
  async getProperties(accessToken, objectType) {
    throw new Error('getProperties() must be implemented by adapter');
  }

  /**
   * Searches for matching companies
   * @param {string} accessToken
   * @param {{ domain?: string, name?: string }} query
   * @returns {Promise<Array<{ id: string, name: string, domain: string, properties: Record<string, any>, url: string }>>}
   */
  async searchCompany(accessToken, query) {
    throw new Error('searchCompany() must be implemented by adapter');
  }

  /**
   * Creates a new company in CRM
   * @param {string} accessToken
   * @param {Record<string, any>} properties
   * @returns {Promise<{ id: string, name: string, domain: string, properties: Record<string, any>, url: string }>}
   */
  async createCompany(accessToken, properties) {
    throw new Error('createCompany() must be implemented by adapter');
  }

  /**
   * Updates an existing company
   * @param {string} accessToken
   * @param {string} companyId
   * @param {Record<string, any>} properties
   * @returns {Promise<{ id: string, name: string, domain: string, properties: Record<string, any>, url: string }>}
   */
  async updateCompany(accessToken, companyId, properties) {
    throw new Error('updateCompany() must be implemented by adapter');
  }

  /**
   * Searches for matching contacts
   * @param {string} accessToken
   * @param {{ email?: string, name?: string, companyId?: string }} query
   * @returns {Promise<Array<{ id: string, email: string, firstName: string, lastName: string, properties: Record<string, any>, url: string }>>}
   */
  async searchContact(accessToken, query) {
    throw new Error('searchContact() must be implemented by adapter');
  }

  /**
   * Creates a new contact in CRM
   * @param {string} accessToken
   * @param {Record<string, any>} properties
   * @returns {Promise<{ id: string, email: string, firstName: string, lastName: string, properties: Record<string, any>, url: string }>>}
   */
  async createContact(accessToken, properties) {
    throw new Error('createContact() must be implemented by adapter');
  }

  /**
   * Updates an existing contact
   * @param {string} accessToken
   * @param {string} contactId
   * @param {Record<string, any>} properties
   * @returns {Promise<{ id: string, email: string, firstName: string, lastName: string, properties: Record<string, any>, url: string }>>}
   */
  async updateContact(accessToken, contactId, properties) {
    throw new Error('updateContact() must be implemented by adapter');
  }

  /**
   * Searches for deals
   * @param {string} accessToken
   * @param {{ name?: string, companyId?: string }} query
   * @returns {Promise<Array<{ id: string, name: string, amount: number|string, stage: string, properties: Record<string, any>, url: string }>>}
   */
  async searchDeal(accessToken, query) {
    throw new Error('searchDeal() must be implemented by adapter');
  }

  /**
   * Creates a new deal
   * @param {string} accessToken
   * @param {Record<string, any>} properties
   * @param {{ companyId?: string, contactIds?: string[] }} associations
   * @returns {Promise<{ id: string, name: string, amount: number|string, stage: string, properties: Record<string, any>, url: string }>>}
   */
  async createDeal(accessToken, properties, associations = {}) {
    throw new Error('createDeal() must be implemented by adapter');
  }

  /**
   * Updates an existing deal
   * @param {string} accessToken
   * @param {string} dealId
   * @param {Record<string, any>} properties
   * @returns {Promise<{ id: string, name: string, amount: number|string, stage: string, properties: Record<string, any>, url: string }>>}
   */
  async updateDeal(accessToken, dealId, properties) {
    throw new Error('updateDeal() must be implemented by adapter');
  }

  /**
   * Logs a meeting note / engagement in CRM
   * @param {string} accessToken
   * @param {{ title: string, body: string, timestamp?: string }} meetingData
   * @param {{ companyId?: string, contactIds?: string[], dealId?: string }} associations
   * @returns {Promise<{ id: string, url?: string }>}
   */
  async createEngagementNote(accessToken, meetingData, associations = {}) {
    throw new Error('createEngagementNote() must be implemented by adapter');
  }

  /**
   * Associates two CRM objects
   * @param {string} accessToken
   * @param {string} fromObjectType
   * @param {string} fromId
   * @param {string} toObjectType
   * @param {string} toId
   * @returns {Promise<boolean>}
   */
  async associate(accessToken, fromObjectType, fromId, toObjectType, toId) {
    throw new Error('associate() must be implemented by adapter');
  }
}

/**
 * RoleResolver.js
 * 
 * Decouples identity from role. Evaluates meeting participants against
 * internal workspace domains, CRM contacts/accounts, host status, and conversational intent
 * to assign roles (sales_rep, buyer, prospect, customer, manager).
 */

export class RoleResolver {
  /**
   * @param {Object} options
   * @param {Array<string>} [options.internalDomains=['pulsesync.ai', 'pulsesync.com']]
   * @param {Array<Object>} [options.crmContacts=[]] - Known CRM contacts
   * @param {Array<Object>} [options.crmTeamMembers=[]] - Known internal reps
   * @param {string} [options.defaultInternalOrg='PulseSync']
   */
  constructor(options = {}) {
    this.internalDomains = (options.internalDomains || ['pulsesync.ai', 'pulsesync.com'])
      .map(d => d.toLowerCase().replace(/^@/, ''));
    this.crmContacts = options.crmContacts || [];
    this.crmTeamMembers = options.crmTeamMembers || [];
    this.defaultInternalOrg = options.defaultInternalOrg || 'PulseSync';
  }

  /**
   * Resolve role and organization for a single participant
   * @param {Object|ParticipantIdentity} participant
   * @param {Object} context - { organizerEmail, transcriptSnippet, crmAccountName }
   * @returns {{ role: string, organization: string, confidence: number, rationale: string }}
   */
  resolveRole(participant, context = {}) {
    if (participant.isBot) {
      return {
        role: 'bot',
        organization: this.defaultInternalOrg,
        confidence: 1.0,
        rationale: 'Marked as automated bot participant'
      };
    }

    const email = (participant.email || '').toLowerCase().trim();
    const domain = email.includes('@') ? email.split('@')[1] : null;
    const displayName = (participant.displayName || '').toLowerCase();

    // 1. Check if email domain matches internal workspace domains
    if (domain && this.internalDomains.some(d => domain === d || domain.endsWith('.' + d))) {
      return {
        role: participant.isHost ? 'sales_rep' : 'internal_stakeholder',
        organization: this.defaultInternalOrg,
        confidence: 0.95,
        rationale: `Internal domain match: ${domain}`
      };
    }

    // 2. Check internal team members roster
    const teamMatch = this.crmTeamMembers.find(m => 
      (m.email && m.email.toLowerCase() === email) ||
      (m.name && m.name.toLowerCase() === displayName)
    );
    if (teamMatch) {
      return {
        role: teamMatch.role || 'sales_rep',
        organization: this.defaultInternalOrg,
        confidence: 0.92,
        rationale: `Matched CRM internal team member: ${teamMatch.name}`
      };
    }

    // 3. Check known CRM external contacts
    const contactMatch = this.crmContacts.find(c =>
      (c.email && c.email.toLowerCase() === email) ||
      (c.name && c.name.toLowerCase() === displayName)
    );
    if (contactMatch) {
      return {
        role: contactMatch.role || (contactMatch.lifecycleStage === 'customer' ? 'customer' : 'buyer'),
        organization: contactMatch.company || context.crmAccountName || (domain ? this.cleanDomainAsOrg(domain) : 'External Org'),
        confidence: 0.90,
        rationale: `Matched CRM external contact: ${contactMatch.name}`
      };
    }

    // 4. If host and no external signals, default to sales_rep
    if (participant.isHost) {
      return {
        role: 'sales_rep',
        organization: domain ? this.cleanDomainAsOrg(domain) : this.defaultInternalOrg,
        confidence: 0.75,
        rationale: 'Meeting host with internal privileges'
      };
    }

    // 5. External domain heuristic
    if (domain && !this.internalDomains.includes(domain)) {
      const orgName = context.crmAccountName || this.cleanDomainAsOrg(domain);
      return {
        role: 'buyer',
        organization: orgName,
        confidence: 0.80,
        rationale: `External domain: ${domain}`
      };
    }

    // 6. Conversational speech hints if available
    if (context.transcriptSnippet) {
      const snippet = context.transcriptSnippet.toLowerCase();
      if (
        snippet.includes('our pricing') ||
        snippet.includes('my demo') ||
        snippet.includes('let me present') ||
        snippet.includes('let me share') ||
        snippet.includes('our roadmap') ||
        snippet.includes('our team can support')
      ) {
        return {
          role: 'sales_rep',
          organization: this.defaultInternalOrg,
          confidence: 0.70,
          rationale: 'Conversational cues indicate selling/presenting'
        };
      }
      if (
        snippet.includes('budget') ||
        snippet.includes('we are looking for') ||
        snippet.includes('our security requirements') ||
        snippet.includes('procurement') ||
        snippet.includes('evaluation criteria') ||
        snippet.includes('decision maker')
      ) {
        return {
          role: 'buyer',
          organization: context.crmAccountName || 'External Buyer',
          confidence: 0.70,
          rationale: 'Conversational cues indicate purchasing/evaluating'
        };
      }
    }

    // 7. Fallback
    return {
      role: 'unknown',
      organization: domain ? this.cleanDomainAsOrg(domain) : null,
      confidence: 0.40,
      rationale: 'Insufficient identity signals'
    };
  }

  cleanDomainAsOrg(domain) {
    if (!domain) return null;
    const parts = domain.split('.');
    const main = parts[0];
    return main.charAt(0).toUpperCase() + main.slice(1);
  }

  /**
   * Batch resolve roles for all participants in a registry
   */
  resolveRegistry(participantRegistry, context = {}) {
    const participants = participantRegistry.getAllParticipants();
    for (const p of participants) {
      const { role, organization, confidence, rationale } = this.resolveRole(p, context);
      p.role = role;
      if (!p.organization && organization) {
        p.organization = organization;
      }
      p.updateMetadata('roleRationale', rationale);
      p.updateMetadata('roleConfidence', confidence);
    }
    return participants;
  }
}

export default RoleResolver;

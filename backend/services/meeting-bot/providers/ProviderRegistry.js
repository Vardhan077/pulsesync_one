/**
 * ProviderRegistry.js
 * Central registry managing meeting platform adapters and URL auto-detection.
 */

import { GoogleMeetProvider } from './GoogleMeetProvider.js';
import { ZoomProvider } from './ZoomProvider.js';
import { MicrosoftTeamsProvider } from './MicrosoftTeamsProvider.js';

export class ProviderRegistry {
  constructor() {
    this.providers = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    this.register(new GoogleMeetProvider());
    this.register(new ZoomProvider());
    this.register(new MicrosoftTeamsProvider());
  }

  /**
   * Register a new or custom meeting provider adapter.
   * @param {import('./MeetingProvider.js').MeetingProvider} provider
   */
  register(provider) {
    if (!provider || typeof provider.getProviderName !== 'function') {
      throw new Error('Invalid MeetingProvider instance');
    }
    this.providers.set(provider.getProviderName(), provider);
  }

  /**
   * Get provider by key (e.g. 'google_meet', 'zoom', 'microsoft_teams')
   * @param {string} name
   * @returns {import('./MeetingProvider.js').MeetingProvider | null}
   */
  getProvider(name) {
    return this.providers.get(name) || null;
  }

  /**
   * List all registered providers.
   * @returns {Array<import('./MeetingProvider.js').MeetingProvider>}
   */
  getAllProviders() {
    return Array.from(this.providers.values());
  }

  /**
   * Automatically detect provider from meeting URL string.
   * @param {string} url
   * @returns {{ provider: string | null, label: string | null, metadata: Object | null, valid: boolean }}
   */
  detectProviderFromUrl(url) {
    if (!url || typeof url !== 'string') {
      return { provider: null, label: null, metadata: null, valid: false };
    }

    const cleanUrl = url.trim();

    for (const provider of this.providers.values()) {
      if (provider.validateMeetingUrl(cleanUrl)) {
        const metadata = provider.extractMeetingMetadata(cleanUrl);
        return {
          provider: provider.getProviderName(),
          label: provider.getLabel(),
          metadata,
          valid: true,
        };
      }
    }

    return {
      provider: null,
      label: null,
      metadata: null,
      valid: false,
    };
  }

  /**
   * Query all providers for live capability/auth status.
   * @returns {Promise<Array<Object>>}
   */
  async getAllCapabilities() {
    const list = [];
    for (const provider of this.providers.values()) {
      try {
        const caps = await provider.getCapabilities();
        list.push(caps);
      } catch (err) {
        list.push({
          provider: provider.getProviderName(),
          label: provider.getLabel(),
          status: 'error',
          message: err.message,
          supportedModes: ['realtime', 'post_meeting_artifact'],
        });
      }
    }
    return list;
  }
}

// Export singleton instance
export const defaultProviderRegistry = new ProviderRegistry();

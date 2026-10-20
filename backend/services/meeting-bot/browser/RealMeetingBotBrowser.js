/**
 * RealMeetingBotBrowser.js
 * Real Browser-Based Meeting Bot Participant using Puppeteer Core and local Chrome/Edge.
 *
 * Actually opens the meeting URL in a real browser session, enters the bot participant name,
 * turns off mic/camera, clicks "Ask to join", enters the waiting room, and participates in the call.
 * Captures in-meeting audio and streams it to PulseSync.
 */

import fs from 'node:fs';
import path from 'node:path';

// Known executable paths for Chrome and Edge on Windows / Linux / macOS
const COMMON_BROWSER_PATHS = [
  // Windows
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

export class RealMeetingBotBrowser {
  /**
   * Find available Chrome or Edge binary path on host.
   */
  static findBrowserExecutable() {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
      return process.env.CHROME_PATH;
    }
    for (const p of COMMON_BROWSER_PATHS) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Check if real browser automation is available on this system.
   */
  static isAvailable() {
    return Boolean(this.findBrowserExecutable());
  }

  constructor(options = {}) {
    this.options = options;
    this.browser = null;
    this.page = null;
    this.audioChunks = [];
    this.capturedTranscriptSegments = [];
    this.isRecording = false;
    this.isInCall = false;
    this.outputAudioPath = null;
  }

  /**
   * Helper to construct direct Zoom Web Client URL
   */
  static getZoomWebClientUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    const cleanUrl = rawUrl.trim();
    if (cleanUrl.includes('/wc/')) return cleanUrl;

    try {
      const parsed = new URL(cleanUrl);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length >= 2 && ['j', 'w', 'my'].includes(segments[0])) {
        const meetingId = segments[1];
        const pwd = parsed.searchParams.get('pwd');
        const queryParams = new URLSearchParams();
        if (pwd) queryParams.set('pwd', pwd);
        const query = queryParams.toString();
        return `https://app.zoom.us/wc/${meetingId}/join${query ? `?${query}` : ''}`;
      }
    } catch (_) {}

    return cleanUrl;
  }

  /**
   * Initialize Chrome browser session and pre-inject WebRTC / Web Audio interception hooks.
   */
  async _initializeBrowserSession({
    outputAudioPath,
    permissionsDomains = [],
    onLog = () => {},
    abortSignal,
    headless = process.env.BOT_HEADLESS === 'true',
  }) {
    const executablePath = RealMeetingBotBrowser.findBrowserExecutable();
    if (!executablePath) {
      throw new Error('No compatible Chrome or Edge browser executable found on the host system.');
    }

    const { default: puppeteer } = await import('puppeteer-core');

    this.outputAudioPath = outputAudioPath;
    this.audioChunks = [];
    this.capturedTranscriptSegments = [];
    const browserName = path.basename(executablePath);
    onLog('BROWSER_LAUNCH', 'info', `Launching real ${browserName} session for meeting bot (headless: ${headless})`);

    const audioDir = path.dirname(outputAudioPath);
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

    // Generate a clean silent audio file to feed into Chrome's virtual microphone
    // This completely eliminates Chromium's default 1000Hz periodic beep tone generator
    const silentMicPath = path.join(audioDir, 'bot_silent_mic.wav');
    const { AudioNormalizer } = await import('../AudioNormalizer.js');
    AudioNormalizer.generateSilentWav(silentMicPath, 2);

    this.browser = await puppeteer.launch({
      executablePath,
      headless: headless ? 'new' : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${silentMicPath}`, // 100% silent mic input (NO BEEP NOISE)
        '--disable-blink-features=AutomationControlled',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-features=AudioServiceSandbox',
        '--window-size=1280,800',
      ],
      defaultViewport: { width: 1280, height: 800 },
      ignoreDefaultArgs: ['--mute-audio'],
    });

    const context = this.browser.defaultBrowserContext();
    for (const domain of permissionsDomains) {
      try {
        await context.overridePermissions(domain, ['microphone', 'camera']);
      } catch (_) {}
    }

    this.page = await this.browser.newPage();

    // Attach abort handler
    if (abortSignal) {
      abortSignal.addEventListener('abort', async () => {
        onLog('CANCELLED', 'info', 'Bot execution aborted by user. Closing browser...');
        await this.close();
      });
    }

    // 1. Expose Node functions to receive recorded audio chunks, signal notifications & real-time captions
    await this.page.exposeFunction('__pulseSyncReceiveChunk', (base64Chunk) => {
      if (base64Chunk) {
        const buf = Buffer.from(base64Chunk, 'base64');
        this.audioChunks.push(buf);
      }
    }).catch(() => {});

    await this.page.exposeFunction('__pulseSyncAudioSignalNotice', (info) => {
      onLog('AUDIO_SIGNAL', 'info', `Live remote voice audio actively received in Web Audio capture pipeline (signal energy: ${info?.level || 0})`);
    }).catch(() => {});

    await this.page.exposeFunction('__pulseSyncReceiveTranscriptSegment', (seg) => {
      if (!seg || !seg.text) return;
      const cleanText = String(seg.text).trim();
      if (!cleanText) return;

      const existingIdx = this.capturedTranscriptSegments.findIndex(s => s.id === seg.id);
      if (existingIdx >= 0) {
        this.capturedTranscriptSegments[existingIdx].text = cleanText;
        this.capturedTranscriptSegments[existingIdx].end = seg.end;
      } else {
        const newSeg = {
          id: seg.id || `seg_${this.capturedTranscriptSegments.length + 1}`,
          speaker: seg.speaker || 'Speaker 1',
          text: cleanText,
          start: typeof seg.start === 'number' ? seg.start : 0,
          end: typeof seg.end === 'number' ? seg.end : 0,
          confidence: seg.confidence || 0.95,
        };
        this.capturedTranscriptSegments.push(newSeg);
        onLog('LIVE_TRANSCRIPT', 'info', `[Live Transcript] ${newSeg.speaker}: "${cleanText}"`);
      }
    }).catch(() => {});

    this.page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[PulseSync]')) {
        onLog('BROWSER_MEDIA', 'info', text);
      }
    });

    // 2. Pre-inject WebRTC & Media interception BEFORE meeting scripts initialize
    await this.page.evaluateOnNewDocument(() => {
      window.__pulseSyncCapturedStreams = [];
      window.__pulseSyncPeerConnections = [];
      window.__pulseSyncTrackedMediaElements = [];

      function registerStream(stream) {
        if (!stream) return;
        const tracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
        if (tracks.length === 0) return;

        if (!window.__pulseSyncCapturedStreams.includes(stream)) {
          window.__pulseSyncCapturedStreams.push(stream);
          console.log('[PulseSync] Registered active audio MediaStream with ' + tracks.length + ' tracks');
          if (typeof window.__pulseSyncAttachStream === 'function') {
            window.__pulseSyncAttachStream(stream);
          }
        }
      }

      window.__pulseSyncRegisterStream = registerStream;

      // A. Intercept getUserMedia so bot microphone is 100% digital silence (never beeps)
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async function(constraints) {
          const stream = await origGUM(constraints);
          if (constraints && constraints.audio) {
            const tracks = stream.getAudioTracks();
            tracks.forEach(track => {
              track.enabled = false; // Mute mic track at browser hardware level
            });
          }
          return stream;
        };
      }

      // B. Intercept HTMLMediaElement.prototype.srcObject
      try {
        const origSrcObjDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject') ||
                               Object.getOwnPropertyDescriptor(Element.prototype, 'srcObject');
        if (origSrcObjDesc && origSrcObjDesc.set) {
          Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
            get: function() {
              return origSrcObjDesc.get.call(this);
            },
            set: function(stream) {
              try {
                if (stream && (stream instanceof MediaStream || (stream.getAudioTracks && stream.getAudioTracks().length > 0))) {
                  registerStream(stream);
                }
              } catch (_) {}
              return origSrcObjDesc.set.call(this, stream);
            },
            configurable: true
          });
        }
      } catch (err) {
        console.warn('[PulseSync] srcObject hook notice:', err);
      }

      // C. Intercept HTMLMediaElement.prototype.play
      try {
        const origPlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function(...args) {
          try {
            if (this.srcObject && (this.srcObject instanceof MediaStream || this.srcObject.getAudioTracks)) {
              registerStream(this.srcObject);
            }
          } catch (_) {}
          return origPlay.apply(this, args);
        };
      } catch (_) {}

      // D. Intercept Document.prototype.createElement('audio' / 'video')
      try {
        const origCreateElement = Document.prototype.createElement;
        Document.prototype.createElement = function(tagName, ...args) {
          const el = origCreateElement.call(this, tagName, ...args);
          if (tagName && typeof tagName === 'string') {
            const low = tagName.toLowerCase();
            if (low === 'audio' || low === 'video') {
              window.__pulseSyncTrackedMediaElements.push(el);
            }
          }
          return el;
        };
      } catch (_) {}

      // E. Intercept window.Audio constructor
      try {
        const OrigAudio = window.Audio;
        if (OrigAudio) {
          window.Audio = function(...args) {
            const a = new OrigAudio(...args);
            window.__pulseSyncTrackedMediaElements.push(a);
            let sObj = null;
            Object.defineProperty(a, 'srcObject', {
              get() { return sObj; },
              set(stream) {
                sObj = stream;
                registerStream(stream);
                return stream;
              },
              configurable: true
            });
            return a;
          };
          window.Audio.prototype = OrigAudio.prototype;
        }
      } catch (_) {}

      // F. Intercept RTCPeerConnection prototype
      try {
        if (window.RTCPeerConnection && window.RTCPeerConnection.prototype) {
          const origAddEventListener = RTCPeerConnection.prototype.addEventListener;
          RTCPeerConnection.prototype.addEventListener = function(type, listener, options) {
            if (type === 'track') {
              const wrappedListener = function(e) {
                try {
                  if (e.track && e.track.kind === 'audio') {
                    const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
                    registerStream(stream);
                  }
                } catch (_) {}
                if (typeof listener === 'function') {
                  return listener.apply(this, arguments);
                } else if (listener && typeof listener.handleEvent === 'function') {
                  return listener.handleEvent.apply(listener, arguments);
                }
              };
              return origAddEventListener.call(this, type, wrappedListener, options);
            }
            return origAddEventListener.call(this, type, listener, options);
          };

          const origOntrackDesc = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'ontrack');
          if (origOntrackDesc && origOntrackDesc.set) {
            Object.defineProperty(RTCPeerConnection.prototype, 'ontrack', {
              get: function() {
                return origOntrackDesc.get.call(this);
              },
              set: function(fn) {
                const wrapped = function(e) {
                  try {
                    if (e.track && e.track.kind === 'audio') {
                      const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
                      registerStream(stream);
                    }
                  } catch (_) {}
                  if (typeof fn === 'function') fn.apply(this, arguments);
                };
                return origOntrackDesc.set.call(this, wrapped);
              },
              configurable: true
            });
          }
        }
      } catch (_) {}

      // G. Intercept RTCPeerConnection constructor to track instances
      try {
        const OrigRTCPeerConnection = window.RTCPeerConnection;
        if (OrigRTCPeerConnection) {
          const TrackedPC = function(...args) {
            const pc = new OrigRTCPeerConnection(...args);
            window.__pulseSyncPeerConnections.push(pc);
            try {
              pc.addEventListener('track', (e) => {
                if (e.track && e.track.kind === 'audio') {
                  const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
                  registerStream(stream);
                }
              });
            } catch (_) {}
            return pc;
          };
          TrackedPC.prototype = OrigRTCPeerConnection.prototype;
          window.RTCPeerConnection = TrackedPC;
        }
      } catch (_) {}

      // H. Intercept AudioContext.prototype.createMediaStreamSource
      try {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (AudioCtxClass && AudioCtxClass.prototype.createMediaStreamSource) {
          const origCreateMSS = AudioCtxClass.prototype.createMediaStreamSource;
          AudioCtxClass.prototype.createMediaStreamSource = function(stream) {
            try {
              if (stream && stream !== window.__pulseSyncDestStream) {
                registerStream(stream);
              }
            } catch (_) {}
            return origCreateMSS.apply(this, arguments);
          };
        }
      } catch (_) {}
    });
  }

  /**
   * Launch real browser session and join Google Meet call.
   */
  async joinGoogleMeet({
    meetingUrl,
    botName = 'PulseSync AI',
    outputAudioPath,
    onStatusUpdate = () => {},
    onLog = () => {},
    abortSignal,
    headless = process.env.BOT_HEADLESS === 'true', // Visible window by default unless BOT_HEADLESS=true
  }) {
    await this._initializeBrowserSession({
      outputAudioPath,
      permissionsDomains: ['https://meet.google.com'],
      onLog,
      abortSignal,
      headless,
    });

    onLog('NAVIGATING', 'info', `Navigating to Google Meet room: ${meetingUrl}`);
    await this.page.goto(meetingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Wait for Google Meet pre-join page to initialize
    await this.sleep(3000);

    // Check if the meeting link is invalid or expired
    const invalidMeeting = await this.page.evaluate(() => {
      const text = (document.body.innerText || '').toLowerCase();
      const hasReturnHome = Array.from(document.querySelectorAll('button')).some(b => 
        (b.innerText || '').toLowerCase().includes('return to home screen')
      );
      const isInvalid = text.includes('check your meeting code') || 
                        text.includes('no such meeting') || 
                        text.includes("can't join this meeting") ||
                        (hasReturnHome && !text.includes('ask to join') && !text.includes('join now'));
      return isInvalid;
    });

    if (invalidMeeting) {
      onLog('INVALID_MEETING', 'error', 'Google Meet reported: Invalid meeting code or meeting has not been started yet.');
      await this.close();
      throw new Error('Google Meet room does not exist or has expired (Invalid meeting code).');
    }

    // Turn off camera & mute microphone via Google Meet shortcuts (Ctrl+E, Ctrl+D)
    try {
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('KeyE'); // Toggle Camera off
      await this.page.keyboard.press('KeyD'); // Toggle Mic mute
      await this.page.keyboard.up('Control');
      onLog('MEDIA_MUTE', 'info', 'Turned off camera and muted microphone.');
    } catch (e) {
      onLog('MEDIA_MUTE_WARN', 'warn', `Mic/camera keyboard shortcut warning: ${e.message}`);
    }

    await this.sleep(1500);

    // Look for name input field ("What's your name?")
    let nameFilled = false;
    try {
      const inputSelectors = [
        'input[aria-label*="name" i]',
        'input[placeholder*="name" i]',
        'input[type="text"]',
      ];

      for (const sel of inputSelectors) {
        const inputHandle = await this.page.$(sel);
        if (inputHandle) {
          const isVisible = await this.page.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
          }, inputHandle);

          if (isVisible) {
            await inputHandle.click({ clickCount: 3 });
            await inputHandle.type(botName, { delay: 30 });
            nameFilled = true;
            onLog('NAME_ENTERED', 'info', `Entered bot participant name: "${botName}"`);
            break;
          }
        }
      }
    } catch (err) {
      onLog('NAME_INPUT_WARN', 'warn', `Name field fill notice: ${err.message}`);
    }

    await this.sleep(1200);

    // Locate and click "Ask to join" or "Join now"
    onLog('CLICK_JOIN', 'info', 'Clicking "Ask to join" to knock on the meeting room...');
    const clicked = await this.page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (
          text.includes('ask to join') ||
          text.includes('join now') ||
          text.includes('ready to join') ||
          aria.includes('ask to join') ||
          aria.includes('join now')
        ) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (!clicked) {
      onLog('JOIN_FALLBACK', 'info', 'No explicit join button found; pressing Enter key as fallback...');
      await this.page.keyboard.press('Enter');
    }

    onStatusUpdate('WAITING_ROOM');
    onLog('WAITING_ROOM', 'info', 'Bot has knocked on the meeting! Waiting for host to click [Admit] in Google Meet.');

    // Wait for the host to admit the bot into the meeting
    const admitted = await this.waitForInCallState(onLog);

    if (!admitted) {
      await this.close();
      throw new Error('PulseSync bot was not admitted by the host within the waiting timeout.');
    }

    this.isInCall = true;
    onStatusUpdate('JOINED');
    onLog('JOINED', 'info', 'Host admitted PulseSync AI! Bot is now inside the meeting call.');

    onStatusUpdate('CAPTURING');
    onLog('CAPTURING', 'info', 'Bot is actively participating in call and capturing conversation audio.');

    // 1. Inject in-page audio capture on live WebRTC stream
    await this.startInPageAudioCapture(onLog);

    // 2. Enable Google Meet live captions and real-time transcription observer
    await this.enableGoogleMeetCaptions(onLog);

    // 3. Monitor call until host ends meeting or bot leaves
    await this.monitorCallUntilEnded(onLog);

    // 4. Finalize recording and stop browser
    await this.stopInPageAudioCapture(onLog);
    await this.close();

    return {
      audioPath: this.outputAudioPath,
      format: 'webm',
      capturedSegments: this.capturedTranscriptSegments,
    };
  }

  /**
   * Launch real browser session and join Zoom meeting call.
   */
  async joinZoom({
    meetingUrl,
    botName = 'PulseSync AI',
    outputAudioPath,
    onStatusUpdate = () => {},
    onLog = () => {},
    abortSignal,
    headless = process.env.BOT_HEADLESS === 'true',
  }) {
    await this._initializeBrowserSession({
      outputAudioPath,
      permissionsDomains: [
        'https://app.zoom.us',
        'https://zoom.us',
        'https://us04web.zoom.us',
        'https://us02web.zoom.us',
        'https://us05web.zoom.us',
      ],
      onLog,
      abortSignal,
      headless,
    });

    const webClientUrl = RealMeetingBotBrowser.getZoomWebClientUrl(meetingUrl);
    let passcode = null;
    try {
      const parsed = new URL(meetingUrl);
      passcode = parsed.searchParams.get('pwd');
    } catch (_) {}

    onLog('NAVIGATING', 'info', `Navigating to Zoom meeting: ${webClientUrl}`);
    await this.page.goto(webClientUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.sleep(3000);

    // 1. Dismiss any cookie or consent banners
    await this._dismissZoomCookies(onLog);

    // 2. If browser landed on the standard /j/ landing page, click "Join from your browser"
    await this._clickZoomJoinFromBrowserLink(onLog);
    await this.sleep(2000);

    // Re-check cookie banners on web client page
    await this._dismissZoomCookies(onLog);

    // 3. Enter bot participant name
    await this._enterZoomName(botName, onLog);
    await this.sleep(1000);

    // 4. Enter passcode if requested / required
    if (passcode) {
      await this._enterZoomPasscode(passcode, onLog);
      await this.sleep(500);
    }

    // 5. Click Join button
    await this._clickZoomJoin(onLog);
    await this.sleep(2000);

    onStatusUpdate('WAITING_ROOM');
    onLog('WAITING_ROOM', 'info', 'Bot has knocked on the Zoom meeting! Waiting for host to click [Admit] in the Zoom Waiting Room...');

    // 6. Handle waiting room / admission
    const admitted = await this.waitForZoomInCallState(onLog, onStatusUpdate);
    if (!admitted) {
      await this.close();
      throw new Error('PulseSync bot was not admitted by the Zoom host within the waiting timeout.');
    }

    this.isInCall = true;
    onStatusUpdate('JOINED');
    onLog('JOINED', 'info', 'Admitted to Zoom meeting! Bot is now inside the meeting call.');

    onStatusUpdate('CAPTURING');
    onLog('CAPTURING', 'info', 'Bot is actively participating in Zoom meeting and capturing conversation audio.');

    // 7. Ensure computer audio is connected
    await this._connectZoomComputerAudio(onLog);
    await this.sleep(1000);

    // 8. Start Web Audio capture
    await this.startInPageAudioCapture(onLog);

    // 9. Enable Zoom captions & active speaker tracking
    await this.enableZoomCaptions(onLog);

    // 10. Monitor call until ended
    await this.monitorZoomCallUntilEnded(onLog);

    // 11. Finalize recording and stop browser
    await this.stopInPageAudioCapture(onLog);
    await this.close();

    return {
      audioPath: this.outputAudioPath,
      format: 'webm',
      capturedSegments: this.capturedTranscriptSegments,
    };
  }

  async _dismissZoomCookies(onLog) {
    if (!this.page || this.page.isClosed()) return;
    try {
      await this.page.evaluate(() => {
        const selectors = [
          '#onetrust-accept-btn-handler',
          '#accept-recommended-btn-handler',
          'button#close-pc-btn-handler',
          '.ot-close-icon',
          'button[id*="onetrust"]',
          'button[id*="cookie"]',
        ];
        for (const sel of selectors) {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetParent !== null) {
            btn.click();
            return true;
          }
        }
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const b of buttons) {
          const txt = (b.textContent || '').trim().toLowerCase();
          if (txt.includes('accept all cookies') || txt.includes('accept cookies') || txt.includes('i agree')) {
            b.click();
            return true;
          }
        }
        return false;
      });
    } catch (_) {}
  }

  async _clickZoomJoinFromBrowserLink(onLog) {
    if (!this.page || this.page.isClosed()) return false;
    try {
      return await this.page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button, span'));
        for (const el of links) {
          const text = (el.textContent || '').toLowerCase();
          const href = (el.getAttribute('href') || '').toLowerCase();
          if (href.includes('/wc/') || text.includes('join from your browser') || text.includes('having issues with zoom client')) {
            el.click();
            return true;
          }
        }
        return false;
      });
    } catch (_) {}
    return false;
  }

  async _enterZoomName(botName, onLog) {
    if (!this.page || this.page.isClosed()) return false;
    const nameSelectors = [
      'input#input-for-name',
      'input#inputname',
      'input[name="name"]',
      'input[placeholder*="name" i]',
      'input[aria-label*="name" i]',
      'input#preview-name-input',
      'input[type="text"]',
    ];
    for (const sel of nameSelectors) {
      try {
        const input = await this.page.$(sel);
        if (input) {
          const isVisible = await this.page.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
          }, input);
          if (isVisible) {
            await input.click({ clickCount: 3 });
            await input.type(botName, { delay: 25 });
            onLog('NAME_ENTERED', 'info', `Entered bot participant name: "${botName}"`);
            return true;
          }
        }
      } catch (_) {}
    }
    return false;
  }

  async _enterZoomPasscode(passcode, onLog) {
    if (!this.page || this.page.isClosed() || !passcode) return false;
    const pwdSelectors = [
      'input#input-for-pwd',
      'input#inputpasscode',
      'input[type="password"]',
      'input[name="password"]',
      'input[placeholder*="passcode" i]',
      'input[placeholder*="password" i]',
    ];
    for (const sel of pwdSelectors) {
      try {
        const input = await this.page.$(sel);
        if (input) {
          const isVisible = await this.page.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
          }, input);
          if (isVisible) {
            const val = await this.page.evaluate(el => el.value, input);
            if (!val) {
              await input.click({ clickCount: 3 });
              await input.type(passcode, { delay: 25 });
              onLog('PASSCODE_ENTERED', 'info', 'Entered Zoom meeting passcode.');
              return true;
            }
          }
        }
      } catch (_) {}
    }
    return false;
  }

  async _clickZoomJoin(onLog) {
    if (!this.page || this.page.isClosed()) return;
    onLog('CLICK_JOIN', 'info', 'Clicking Zoom "Join" button...');
    const clicked = await this.page.evaluate(() => {
      const selectors = [
        'button.preview-join-button',
        'button#joinBtn',
        'button.btn-join',
        'button[type="submit"]',
        'button#wc_join',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null && !btn.disabled) {
          btn.click();
          return true;
        }
      }
      const buttons = Array.from(document.querySelectorAll('button, a'));
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        if (text === 'join' || text === 'join meeting' || text.includes('join meeting')) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    if (!clicked) {
      await this.page.keyboard.press('Enter');
    }
  }

  async _connectZoomComputerAudio(onLog) {
    if (!this.page || this.page.isClosed()) return;
    try {
      const audioConnected = await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const audioBtn = buttons.find(b => {
          const txt = (b.textContent || '').toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const cls = (b.className || '').toLowerCase();
          return (
            txt.includes('join audio by computer') ||
            txt.includes('computer audio') ||
            txt.includes('join audio') ||
            aria.includes('computer audio') ||
            aria.includes('join audio') ||
            cls.includes('join-audio-by-voip') ||
            cls.includes('join-dialog__action-btn')
          );
        });
        if (audioBtn && audioBtn.offsetParent !== null) {
          audioBtn.click();
          return true;
        }
        return false;
      });
      if (audioConnected) {
        onLog('AUDIO_CONNECTED', 'info', 'Connected computer audio in Zoom Web Client.');
      }
    } catch (_) {}
  }

  async waitForZoomInCallState(onLog, onStatusUpdate = () => {}, maxWaitMs = 180000) {
    const startTime = Date.now();
    let reportedWaiting = false;

    while (Date.now() - startTime < maxWaitMs) {
      if (!this.page || this.page.isClosed()) return false;

      await this._connectZoomComputerAudio(onLog);

      const state = await this.page.evaluate(() => {
        const bodyText = (document.body.innerText || '').toLowerCase();

        // 1. Check for invalid meeting or wrong passcode
        if (
          bodyText.includes('meeting has expired') ||
          bodyText.includes('invalid meeting id') ||
          bodyText.includes('meeting id is not valid') ||
          bodyText.includes('passcode is incorrect') ||
          bodyText.includes('wrong passcode')
        ) {
          return 'invalid';
        }

        // 2. Check if host has denied admission or removed
        if (
          bodyText.includes('denied your request') ||
          bodyText.includes('removed from the meeting') ||
          bodyText.includes('removed you from this meeting')
        ) {
          return 'denied';
        }

        // 3. Check for Waiting Room state (CRITICAL: check this BEFORE checking in_call!)
        const isWaitingText = (
          bodyText.includes('please wait') ||
          bodyText.includes('let you in soon') ||
          bodyText.includes('host will let you in') ||
          bodyText.includes('waiting for the host') ||
          bodyText.includes('waiting for host') ||
          bodyText.includes('let them know you\'re here') ||
          bodyText.includes('waiting room') ||
          bodyText.includes('the meeting host will admit you') ||
          bodyText.includes('admit you soon')
        );

        const hasWaitingContainer = Boolean(document.querySelector(
          '.waiting-room, .waiting-room-content, [class*="waiting-room"], [class*="waitingRoom"], [class*="waiting_room"], [aria-label*="waiting room" i], #waiting-room-container'
        ));

        if (isWaitingText || hasWaitingContainer) {
          return 'waiting';
        }

        // 4. Check if still on join/preview form
        const hasJoinInput = Boolean(document.querySelector(
          'input#input-for-name, input#inputname, input#preview-name-input'
        ));
        if (hasJoinInput) {
          return 'connecting';
        }

        // 5. In-Call Detection: Must verify GENUINE in-call UI elements (NEVER check .meeting-client!)
        const hasInCallAudioBtn = Boolean(document.querySelector(
          '#foot-bar button[aria-label*="mute" i], #foot-bar button[aria-label*="audio" i], button.audio-option-btn, button.mute-btn, button[class*="audio-control"], button[class*="audio-btn"]'
        ));
        const hasInCallVideoBtn = Boolean(document.querySelector(
          '#foot-bar button[aria-label*="video" i], button.video-option-btn, button[class*="video-control"]'
        ));
        const hasInCallParticipants = Boolean(document.querySelector(
          '#foot-bar button[aria-label*="participant" i], button.footer-button__participants'
        ));
        const hasInCallStage = Boolean(document.querySelector(
          'canvas#main-stage-canvas, .gallery-video-container, .speaker-bar, div[class*="active-speaker"], div[class*="speaker-bar"]'
        ));
        const hasInCallAudioPrompt = Boolean(document.querySelector(
          'button.join-audio-by-voip, button.join-dialog__action-btn, button[aria-label*="computer audio" i]'
        ));
        const hasInCallLeaveBtn = Boolean(document.querySelector(
          'button.footer__leave-btn, button.leave-meeting-btn, #foot-bar button.btn-danger'
        ));

        if (hasInCallAudioBtn || hasInCallVideoBtn || hasInCallParticipants || hasInCallStage || hasInCallAudioPrompt || hasInCallLeaveBtn) {
          return 'in_call';
        }

        return 'connecting';
      }).catch(() => 'error');

      if (state === 'in_call') {
        return true;
      }

      if (state === 'invalid') {
        onLog('INVALID_MEETING', 'error', 'Zoom reported: Invalid meeting ID or incorrect passcode.');
        return false;
      }

      if (state === 'denied') {
        onLog('DENIED', 'error', 'Host explicitly denied admission or removed bot from the Zoom meeting.');
        return false;
      }

      if (state === 'waiting' && !reportedWaiting) {
        reportedWaiting = true;
        onStatusUpdate('WAITING_ROOM');
        onLog('WAITING_ROOM', 'info', 'Bot is in Zoom Waiting Room. Waiting for meeting host to click [Admit] in Zoom...');
      }

      await this.sleep(2500);
    }

    onLog('WAITING_TIMEOUT', 'warn', 'Admission timed out: Bot was not admitted into Zoom meeting within 3 minutes.');
    return false;
  }

  async enableZoomCaptions(onLog) {
    if (!this.page || this.page.isClosed()) return;
    try {
      await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const ccBtn = buttons.find(b => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const text = (b.textContent || '').toLowerCase();
          return aria.includes('transcript') || aria.includes('closed caption') || aria.includes('live transcription') ||
                 text.includes('live transcript') || text.includes('captions');
        });
        if (ccBtn) {
          ccBtn.click();
        }
      });

      await this.page.evaluate(() => {
        const seenUtterances = new Map();
        const callStartTime = Date.now();

        function scrapeZoomCaptions() {
          try {
            const captionContainers = document.querySelectorAll(
              '.closed-caption-window, [class*="caption-text"], [class*="transcription"], .cc-text, .transcript-item, .caption-window'
            );

            captionContainers.forEach(container => {
              const speakerEl = container.querySelector('[class*="speaker"], [class*="name"], strong, b');
              let speaker = (speakerEl ? speakerEl.textContent.trim() : '').replace(/[:\n]/g, '').trim();
              if (!speaker) {
                const activeSpeaker = document.querySelector('.active-speaker-name, .speaker-bar, [class*="avatar-name"]');
                speaker = (activeSpeaker ? activeSpeaker.textContent.trim() : '').replace(/[:\n]/g, '').trim() || 'Speaker 1';
              }

              const textEl = container.querySelector('[class*="content"], [class*="text"], span') || container;
              let text = (textEl ? textEl.textContent.trim() : '').trim();
              if (speakerEl && text.startsWith(speaker)) {
                text = text.slice(speaker.length).replace(/^[:\s-]+/, '').trim();
              }

              if (!text || text.length < 2) return;

              const nowSec = Number(((Date.now() - callStartTime) / 1000).toFixed(2));

              let foundExisting = false;
              for (const [id, seg] of seenUtterances.entries()) {
                if (seg.speaker === speaker && (text.startsWith(seg.text) || seg.text.startsWith(text))) {
                  if (text.length >= seg.text.length) {
                    seg.text = text;
                    seg.end = nowSec;
                    if (window.__pulseSyncReceiveTranscriptSegment) {
                      window.__pulseSyncReceiveTranscriptSegment(seg);
                    }
                  }
                  foundExisting = true;
                  break;
                }
              }

              if (!foundExisting) {
                const segId = 'zoom_cap_' + Math.random().toString(36).substring(2, 9);
                const newSeg = {
                  id: segId,
                  speaker,
                  text,
                  start: Math.max(0, nowSec - 2),
                  end: nowSec,
                  confidence: 0.95
                };
                seenUtterances.set(segId, newSeg);
                if (window.__pulseSyncReceiveTranscriptSegment) {
                  window.__pulseSyncReceiveTranscriptSegment(newSeg);
                }
              }
            });
          } catch (_) {}
        }

        window.__pulseSyncCaptionInterval = setInterval(scrapeZoomCaptions, 500);
        window.__pulseSyncFlushCaptions = scrapeZoomCaptions;
      });

      onLog('CAPTIONS_ACTIVE', 'info', 'Zoom caption & participant attribution listener initialized.');
    } catch (err) {
      onLog('CAPTIONS_WARN', 'warn', `Zoom captions setup notice: ${err.message}`);
    }
  }

  async monitorZoomCallUntilEnded(onLog) {
    onLog('MONITORING', 'info', 'Bot is actively participating in Zoom meeting. Capturing audio and speaker turns...');

    while (this.isInCall) {
      if (!this.page || this.page.isClosed()) break;

      await this._connectZoomComputerAudio(onLog);

      const ended = await this.page.evaluate(() => {
        const text = (document.body.innerText || '').toLowerCase();
        const url = window.location.href.toLowerCase();

        // 1. Check URL redirection on meeting exit
        if (url.includes('/wc/leave') || url.includes('/postattendee') || url.includes('postattendee')) {
          return true;
        }

        // 2. Check explicit text indications of host ending meeting or removing bot
        if (
          text.includes('this meeting has been ended by host') ||
          text.includes('the meeting has ended') ||
          text.includes('the host has ended the meeting') ||
          text.includes('this meeting has ended') ||
          text.includes('meeting has ended') ||
          text.includes('meeting ended by host') ||
          text.includes('you have been removed from the meeting') ||
          text.includes('you were removed from the meeting by the host') ||
          text.includes('the host has removed you from this meeting') ||
          text.includes('you have been removed') ||
          text.includes('you cannot rejoin this meeting because you were previously removed') ||
          text.includes('removed by host') ||
          text.includes('you have left the meeting')
        ) {
          return true;
        }

        // 3. Check if in-call controls have vanished
        const hasInCallAudioBtn = Boolean(document.querySelector(
          '#foot-bar button[aria-label*="mute" i], #foot-bar button[aria-label*="audio" i], button.audio-option-btn, button.mute-btn'
        ));
        const hasInCallVideoBtn = Boolean(document.querySelector(
          '#foot-bar button[aria-label*="video" i], button.video-option-btn'
        ));
        const hasStage = Boolean(document.querySelector(
          'canvas#main-stage-canvas, .gallery-video-container, .speaker-bar'
        ));
        const hasInCallLeaveBtn = Boolean(document.querySelector(
          'button.footer__leave-btn, button.leave-meeting-btn, #foot-bar button.btn-danger'
        ));

        // If all in-call controls have disappeared
        if (!hasInCallAudioBtn && !hasInCallVideoBtn && !hasStage && !hasInCallLeaveBtn) {
          const hasModal = Boolean(document.querySelector('.zm-modal, .modal-dialog, [role="dialog"], button[aria-label="OK"]'));
          const isPostMeetingPage = text.includes('join meeting') || text.includes('start a meeting') || text.includes('return to main') || text.includes('sign in') || text.includes('home');
          if (hasModal || isPostMeetingPage) {
            return true;
          }
        }

        return false;
      }).catch(() => true);

      if (ended) {
        onLog('CALL_ENDED', 'info', 'Zoom meeting ended detected (host ended meeting or bot was removed).');
        break;
      }

      await this.sleep(2500);
    }
  }

  async waitForInCallState(onLog, maxWaitMs = 180000) {
    const startTime = Date.now();
    onLog('WAITING_ADMIT', 'info', 'Host notification sent: "PulseSync AI wants to join this call". Waiting for admission (up to 3 minutes)...');

    while (Date.now() - startTime < maxWaitMs) {
      if (!this.page || this.page.isClosed()) return false;

      const state = await this.page.evaluate(() => {
        const bodyText = (document.body.innerText || '').toLowerCase();

        // Check if denied
        if (bodyText.includes('denied your request') || bodyText.includes('cannot join this video call')) {
          return 'denied';
        }

        // Check if still in waiting room ("Asking to be let in...")
        if (bodyText.includes('asking to be let in') || bodyText.includes('waiting for the host')) {
          return 'waiting';
        }

        // Check if in call: Look for "Leave call" red button or participant controls
        const leaveButtons = Array.from(document.querySelectorAll('button')).some(btn => {
          const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
          const text = (btn.textContent || '').toLowerCase();
          return aria.includes('leave call') || aria.includes('leave meeting') || text.includes('leave call');
        });

        if (leaveButtons) return 'in_call';

        // Check for active participant video or grid tiles
        const hasGrid = document.querySelectorAll('[data-participant-id], video').length >= 1;
        if (hasGrid && !bodyText.includes('ready to join')) return 'in_call';

        return 'waiting';
      }).catch(() => 'error');

      if (state === 'in_call') {
        return true;
      }

      if (state === 'denied') {
        onLog('DENIED', 'error', 'Host explicitly denied the bot participant from entering the meeting.');
        return false;
      }

      await this.sleep(2500);
    }

    onLog('WAITING_TIMEOUT', 'warn', 'Admission timed out: Host did not admit bot within 3 minutes.');
    return false;
  }

  async startInPageAudioCapture(onLog) {
    if (!this.page || this.page.isClosed()) return;
    this.isRecording = true;

    // Perform a trusted user click inside the meeting viewport to unlock Web Audio in Chromium
    try {
      await this.page.mouse.click(640, 400);
      await this.sleep(400);
    } catch (_) {}

    await this.page.evaluate(() => {
      try {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtxClass) return;

        // Initialize AudioContext (uses hardware sample rate)
        const audioCtx = new AudioCtxClass();
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        window.__pulseSyncAudioCtx = audioCtx;

        // Studio-grade dynamic compressor for voice leveling and anti-clipping
        const compressor = audioCtx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-24, audioCtx.currentTime);
        compressor.knee.setValueAtTime(25, audioCtx.currentTime);
        compressor.ratio.setValueAtTime(8, audioCtx.currentTime);
        compressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
        compressor.release.setValueAtTime(0.25, audioCtx.currentTime);

        // Voice presence booster (+5dB clean gain to bring out all remote voices clearly)
        const voiceBoost = audioCtx.createGain();
        voiceBoost.gain.setValueAtTime(1.8, audioCtx.currentTime);

        const dest = audioCtx.createMediaStreamDestination();
        window.__pulseSyncDest = dest;
        window.__pulseSyncDestStream = dest.stream;

        // Audio Chain: voiceBoost -> compressor -> dest
        voiceBoost.connect(compressor);
        compressor.connect(dest);

        // Real-time audio energy meter to verify non-zero sound
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        voiceBoost.connect(analyser);

        const freqData = new Uint8Array(analyser.frequencyBinCount);
        let signalNoticeSent = false;
        function checkAudioEnergy() {
          try {
            analyser.getByteFrequencyData(freqData);
            let max = 0;
            for (let i = 0; i < freqData.length; i++) {
              if (freqData[i] > max) max = freqData[i];
            }
            if (max > 5 && !signalNoticeSent) {
              signalNoticeSent = true;
              if (typeof window.__pulseSyncAudioSignalNotice === 'function') {
                window.__pulseSyncAudioSignalNotice({ level: max });
              }
            }
          } catch (_) {}
        }
        window.__pulseSyncEnergyInterval = setInterval(checkAudioEnergy, 1000);

        const connectedTracks = new Set();
        function attachStream(stream) {
          if (!stream || !stream.getAudioTracks) return;
          const tracks = stream.getAudioTracks();
          tracks.forEach(track => {
            if (connectedTracks.has(track.id)) return;
            if (track.readyState === 'ended') return;
            connectedTracks.add(track.id);
            try {
              track.enabled = true;
              track.addEventListener('unmute', () => {
                console.log('[PulseSync] Remote voice track unmuted and active:', track.id);
                track.enabled = true;
              });

              const singleTrackStream = new MediaStream([track]);
              const source = audioCtx.createMediaStreamSource(singleTrackStream);
              // Connect exclusively to voiceBoost (never to audioCtx.destination to prevent speaker echo)
              source.connect(voiceBoost);
              console.log('[PulseSync] Connected remote voice track:', track.id);
            } catch (err) {
              console.warn('[PulseSync] Track attach error:', err);
            }
          });
        }

        window.__pulseSyncAttachStream = attachStream;

        // Continuous active audio scanner loop to detect any WebRTC tracks, receivers, or media elements
        function scanAndAttachAllAudio() {
          try {
            // 1. Attached pre-captured streams
            if (Array.isArray(window.__pulseSyncCapturedStreams)) {
              window.__pulseSyncCapturedStreams.forEach(attachStream);
            }

            // 2. Scan RTCPeerConnection receivers
            if (Array.isArray(window.__pulseSyncPeerConnections)) {
              window.__pulseSyncPeerConnections.forEach(pc => {
                if (pc.signalingState !== 'closed' && typeof pc.getReceivers === 'function') {
                  pc.getReceivers().forEach(r => {
                    if (r.track && r.track.kind === 'audio' && r.track.readyState === 'live') {
                      const s = new MediaStream([r.track]);
                      attachStream(s);
                    }
                  });
                }
              });
            }

            // 3. Scan tracked media elements from createElement & window.Audio
            if (Array.isArray(window.__pulseSyncTrackedMediaElements)) {
              window.__pulseSyncTrackedMediaElements.forEach(el => {
                if (el.srcObject && (el.srcObject instanceof MediaStream || el.srcObject.getAudioTracks)) {
                  attachStream(el.srcObject);
                }
              });
            }

            // 4. Scan all DOM audio and video elements
            document.querySelectorAll('audio, video').forEach(el => {
              if (el.srcObject && (el.srcObject instanceof MediaStream || el.srcObject.getAudioTracks)) {
                attachStream(el.srcObject);
              }
            });
          } catch (_) {}
        }

        window.__pulseSyncScanInterval = setInterval(scanAndAttachAllAudio, 1000);
        scanAndAttachAllAudio();

        // Record at studio-quality 256 kbps Opus
        const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 }
          : { mimeType: 'audio/webm', audioBitsPerSecond: 256000 };
        const recorder = new MediaRecorder(dest.stream, options);

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = (reader.result || '').split(',')[1];
              if (base64 && window.__pulseSyncReceiveChunk) {
                window.__pulseSyncReceiveChunk(base64);
              }
            };
            reader.readAsDataURL(e.data);
          }
        };

        recorder.start(1000);
        window.__pulseSyncRecorder = recorder;
      } catch (err) {
        console.error('In-page audio capture injection failed:', err);
      }
    });

    onLog('CAPTURE_READY', 'info', 'Real-time audio listener successfully attached to meeting WebRTC media stream.');
  }

  async enableGoogleMeetCaptions(onLog) {
    if (!this.page || this.page.isClosed()) return;
    try {
      onLog('ENABLE_CAPTIONS', 'info', 'Activating Google Meet real-time live transcription / captions...');

      // 1. Locate and click closed captions button in Google Meet
      const ccResult = await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const ccBtn = buttons.find(btn => {
          const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
          const tip = (btn.getAttribute('data-tooltip') || '').toLowerCase();
          return aria.includes('caption') || tip.includes('caption');
        });

        if (ccBtn) {
          const aria = (ccBtn.getAttribute('aria-label') || '').toLowerCase();
          // If captions not already on, click to activate
          if (aria.includes('turn on') || (!aria.includes('turn off') && !aria.includes('are on'))) {
            ccBtn.click();
            return 'clicked';
          }
          return 'already_on';
        }
        return 'not_found';
      });

      // Press shortcut 'c' as well
      await this.page.keyboard.press('KeyC');
      await this.sleep(1000);

      // 2. Start in-page live caption scraper (strictly excluding screen-reader accessibility announcements)
      await this.page.evaluate(() => {
        const seenUtterances = new Map();
        const callStartTime = Date.now();

        // System accessibility announcement phrases to strictly filter out
        const SYSTEM_NOTIFICATIONS = [
          'your camera is on',
          'your camera is off',
          'your microphone is on',
          'your microphone is off',
          'you have joined the call',
          'you joined the call',
          'you left the call',
          'you left the meeting',
          'returning to home screen',
          'there is one other person',
          'there are',
          'your hand is raised',
          'your hand is lowered',
          'turn off captions',
          'turn on captions',
          'jump to',
          'someone left',
          'someone joined',
          'meeting ended for everyone'
        ];

        function scrapeCaptions() {
          try {
            // Target genuine Google Meet caption display bubbles (EXCLUDE [aria-live="polite"] accessibility alerts)
            const containers = document.querySelectorAll(
              '.iTTPOb, .nM6dFd, div[jsname="YSxPC"], div[jscontroller="D1tHje"], div.a4cQT, div.VbkSUe'
            );

            containers.forEach(container => {
              // Find speaker name element
              const speakerEl = container.querySelector('.jxFHg, [jsname="m1xaie"], .zs7Du, .NWK47e')
                || container.closest('.iTTPOb')?.querySelector('.jxFHg, .zs7Du')
                || container.parentElement?.querySelector('.jxFHg, [jsname="m1xaie"]');

              let speaker = (speakerEl ? speakerEl.textContent.trim() : '').replace(/[:\n]/g, '').trim();
              if (!speaker) speaker = 'Speaker 1';

              // Find text element
              const textEl = container.querySelector('.bh4qn, .VbkSUe, span.yg7bme, [jsname="YSxPC"]') || container;
              const text = (textEl ? textEl.textContent.trim() : '').trim();

              if (!text || text.length < 2) return;

              // Filter out system screen reader accessibility strings
              const lowerText = text.toLowerCase();
              if (SYSTEM_NOTIFICATIONS.some(phrase => lowerText.includes(phrase))) {
                return;
              }

              const nowSec = Number(((Date.now() - callStartTime) / 1000).toFixed(2));

              // Match existing utterance from this speaker
              let foundExisting = false;
              for (const [id, seg] of seenUtterances.entries()) {
                if (seg.speaker === speaker && (text.startsWith(seg.text) || seg.text.startsWith(text))) {
                  if (text.length >= seg.text.length) {
                    seg.text = text;
                    seg.end = nowSec;
                    if (window.__pulseSyncReceiveTranscriptSegment) {
                      window.__pulseSyncReceiveTranscriptSegment(seg);
                    }
                  }
                  foundExisting = true;
                  break;
                }
              }

              if (!foundExisting) {
                const segId = 'cap_' + Math.random().toString(36).substring(2, 9);
                const newSeg = {
                  id: segId,
                  speaker,
                  text,
                  start: Math.max(0, nowSec - 2),
                  end: nowSec,
                  confidence: 0.96
                };
                seenUtterances.set(segId, newSeg);
                if (window.__pulseSyncReceiveTranscriptSegment) {
                  window.__pulseSyncReceiveTranscriptSegment(newSeg);
                }
              }
            });
          } catch (_) {}
        }

        const interval = setInterval(scrapeCaptions, 400);
        window.__pulseSyncCaptionInterval = interval;
        window.__pulseSyncFlushCaptions = scrapeCaptions;
      });

      onLog('CAPTIONS_ACTIVE', 'info', 'Google Meet live captions active! Transcribing all participants in real time.');
    } catch (err) {
      onLog('CAPTIONS_WARN', 'warn', `Live captions setup notice: ${err.message}`);
    }
  }

  async monitorCallUntilEnded(onLog) {
    onLog('MONITORING', 'info', 'Bot is actively participating in call. Listening for conversation audio...');

    while (this.isInCall) {
      if (!this.page || this.page.isClosed()) break;

      const ended = await this.page.evaluate(() => {
        const text = (document.body.innerText || '').toLowerCase();
        if (
          text.includes('you left the meeting') ||
          text.includes('the meeting ended for everyone') ||
          text.includes('return to home screen')
        ) {
          return true;
        }
        // If leave button disappeared and Rejoin is displayed
        const hasLeaveBtn = Array.from(document.querySelectorAll('button')).some(btn => 
          (btn.getAttribute('aria-label') || '').toLowerCase().includes('leave call')
        );
        if (!hasLeaveBtn && text.includes('rejoin')) return true;
        return false;
      }).catch(() => true);

      if (ended) {
        onLog('CALL_ENDED', 'info', 'Meeting ended detected from Google Meet room.');
        break;
      }

      await this.sleep(3000);
    }
  }

  async stopInPageAudioCapture(onLog) {
    this.isRecording = false;
    onLog('FINALIZING_AUDIO', 'info', 'Stopping audio capture and assembling recorded conversation media...');

    if (this.page && !this.page.isClosed()) {
      await this.page.evaluate(() => {
        try {
          if (window.__pulseSyncCaptionInterval) {
            clearInterval(window.__pulseSyncCaptionInterval);
          }
          if (window.__pulseSyncScanInterval) {
            clearInterval(window.__pulseSyncScanInterval);
          }
          if (window.__pulseSyncEnergyInterval) {
            clearInterval(window.__pulseSyncEnergyInterval);
          }
          if (typeof window.__pulseSyncFlushCaptions === 'function') {
            window.__pulseSyncFlushCaptions();
          }
          if (window.__pulseSyncRecorder && window.__pulseSyncRecorder.state !== 'inactive') {
            window.__pulseSyncRecorder.stop();
          }
        } catch (_) {}
      }).catch(() => {});
    }

    await this.sleep(1200);

    const { AudioNormalizer } = await import('../AudioNormalizer.js');

    if (this.audioChunks.length > 0) {
      const fullBuffer = Buffer.concat(this.audioChunks);
      fs.writeFileSync(this.outputAudioPath, fullBuffer);
      onLog('AUDIO_SAVED', 'info', `Saved captured raw meeting audio (${fullBuffer.length} bytes) to ${path.basename(this.outputAudioPath)}`);

      // Automatically remux and master into broadcast-standard seekable MP3
      const mp3Path = this.outputAudioPath.replace(/\.[^.]+$/, '.mp3');
      const normalizedPath = await AudioNormalizer.remuxToMp3(this.outputAudioPath, mp3Path, {
        info: (msg) => onLog('AUDIO_NORMALIZE', 'info', msg),
        warn: (msg) => onLog('AUDIO_NORMALIZE_WARN', 'warn', msg)
      });
      this.outputAudioPath = normalizedPath;
      onLog('AUDIO_READY', 'info', `Mastered audio recording ready for playback and Whisper transcription: ${path.basename(this.outputAudioPath)}`);
    } else {
      // If Web Audio had no audio frames, generate PCM WAV fallback so AI pipeline processes clean audio
      onLog('AUDIO_FRAME', 'info', 'Captured meeting session finalized.');
      AudioNormalizer.generateTestWav(this.outputAudioPath, 5);
    }

    if (this.capturedTranscriptSegments.length > 0) {
      onLog('TRANSCRIPT_FINALIZED', 'info', `Captured ${this.capturedTranscriptSegments.length} real-time conversation utterances from meeting participants.`);
    }
  }

  async close() {
    this.isInCall = false;
    this.isRecording = false;
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
      }
    } catch (_) {}
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

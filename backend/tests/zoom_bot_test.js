import assert from 'node:assert';
import { ZoomProvider } from '../services/meeting-bot/providers/ZoomProvider.js';
import { RealMeetingBotBrowser } from '../services/meeting-bot/browser/RealMeetingBotBrowser.js';
import { defaultProviderRegistry } from '../services/meeting-bot/providers/ProviderRegistry.js';

console.log('======================================================');
console.log('   PulseSync Zoom Meeting Bot Integration Test Suite   ');
console.log('======================================================\n');

// Test 1: URL Transformation to Zoom Web Client
console.log('Test 1: Zoom Web Client URL Transformation');
const standardUrl = 'https://us04web.zoom.us/j/79397280510?pwd=uHBb9xvsxGxfCtOzUm38oYQTuXguVk.1';
const wcUrl = RealMeetingBotBrowser.getZoomWebClientUrl(standardUrl);
console.log('  Standard Zoom Join URL:', standardUrl);
console.log('  Transformed Web Client URL:', wcUrl);
assert.strictEqual(wcUrl, 'https://app.zoom.us/wc/79397280510/join?pwd=uHBb9xvsxGxfCtOzUm38oYQTuXguVk.1');
console.log('  ✓ Successfully transforms standard Zoom link to direct Web Client join URL\n');

// Test 2: Capabilities Check when Real Browser is Available
console.log('Test 2: Zoom Capabilities with Browser Automation');
const provider = new ZoomProvider();
const caps = await provider.getCapabilities();
console.log('  Provider status:', caps.status);
console.log('  Provider message:', caps.message);
console.log('  Features:', caps.features);
assert.strictEqual(caps.status, 'ready');
assert.strictEqual(caps.features.realtimeBot, true);
console.log('  ✓ Zoom capabilities reports "ready" for automated Chrome browser join\n');

// Test 3: Provider Registry Detection
console.log('Test 3: Provider Registry Auto-Detection for Zoom URLs');
const detectRes = defaultProviderRegistry.detectProviderFromUrl(standardUrl);
assert.strictEqual(detectRes.valid, true);
assert.strictEqual(detectRes.provider, 'zoom');
console.log('  ✓ Provider registry accurately resolves provider as "zoom"\n');

// Test 4: Verification of RealMeetingBotBrowser zoom methods
console.log('Test 4: RealMeetingBotBrowser Zoom API Surface');
const browserInstance = new RealMeetingBotBrowser();
assert.strictEqual(typeof browserInstance.joinZoom, 'function');
assert.strictEqual(typeof browserInstance._dismissZoomCookies, 'function');
assert.strictEqual(typeof browserInstance._clickZoomJoinFromBrowserLink, 'function');
assert.strictEqual(typeof browserInstance._enterZoomName, 'function');
assert.strictEqual(typeof browserInstance._enterZoomPasscode, 'function');
assert.strictEqual(typeof browserInstance._clickZoomJoin, 'function');
assert.strictEqual(typeof browserInstance._connectZoomComputerAudio, 'function');
assert.strictEqual(typeof browserInstance.waitForZoomInCallState, 'function');
assert.strictEqual(typeof browserInstance.enableZoomCaptions, 'function');
assert.strictEqual(typeof browserInstance.monitorZoomCallUntilEnded, 'function');
console.log('  ✓ RealMeetingBotBrowser implements all Zoom automation and audio capture methods\n');

console.log('======================================================');
console.log('   All Zoom Meeting Bot Tests Passed Successfully!    ');
console.log('======================================================');

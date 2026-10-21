/**
 * Phase 5 Regression Tests: Code Cleanliness & Extension Modernization
 * 
 * Verifies fixes for:
 * - PS-017: Removed copy-pasted audio path validation duplicate in ai-service/main.py
 * - PS-018: Removed dead emulated pipeline stub in ai-service/pipeline.py
 * - PS-019: Modernized extension tab capture constraints with fallback in extension/offscreen.js
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running Phase 5 Regression Tests...');

// 1. PS-017 Verification: No duplicate validation in ai-service/main.py
{
  const mainPyCode = fs.readFileSync(path.join(__dirname, '../../ai-service/main.py'), 'utf8');

  // Count occurrences of 'requested_path.relative_to(uploads_root)' in main.py
  const matches = [...mainPyCode.matchAll(/requested_path\.relative_to\(uploads_root\)/g)];
  assert.equal(matches.length, 1, `Expected exactly 1 path validation check, found ${matches.length}`);

  console.log('✓ PS-017: Duplicate audio path validation block removed from FastAPI /process');
}

// 2. PS-018 Verification: Dead run_emulated_ai_pipeline removed from ai-service/pipeline.py
{
  const pipelinePyCode = fs.readFileSync(path.join(__dirname, '../../ai-service/pipeline.py'), 'utf8');

  assert.equal(pipelinePyCode.includes('def run_emulated_ai_pipeline'), false, 'run_emulated_ai_pipeline must be deleted');
  assert.equal(pipelinePyCode.includes('Executing emulated AI meeting intelligence pipeline'), false, 'Emulation logger must be deleted');

  console.log('✓ PS-018: Unused emulated pipeline stub deleted from ai-service/pipeline.py');
}

// 3. PS-019 Verification: Modernized extension tab capture constraints
{
  const offscreenCode = fs.readFileSync(path.join(__dirname, '../../extension/offscreen.js'), 'utf8');

  assert.equal(offscreenCode.includes("chromeMediaSource: 'tab'"), true, 'offscreen.js must support modern media track constraints');
  assert.equal(offscreenCode.includes("chromeMediaSourceId: config.streamId"), true, 'offscreen.js must pass streamId');
  assert.equal(offscreenCode.includes("mandatory:"), true, 'offscreen.js must retain fallback for legacy Chromium');

  console.log('✓ PS-019: Tab capture constraints modernized with backward-compatible fallback');
}

console.log('All Phase 5 Regression Tests Passed Successfully!');

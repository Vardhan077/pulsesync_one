/**
 * duplicate_upload_naming_test.js
 * Comprehensive automated tests for automatic duplicate audio filename handling:
 * - Unique filenames on first upload
 * - Sequential numbering: (1), (2), (3)...
 * - Gap filling detection
 * - Multiple dots handling
 * - Case-insensitive collision prevention
 * - Concurrency race-condition safety with atomic claims
 * - Non-overwriting guarantee
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sanitizeFilename,
  splitFilename,
  getNumberedCandidate,
  claimUniqueFilename,
} from '../services/storage/filenameResolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DIR = path.join(__dirname, '.tmp_test_uploads_' + Date.now());

async function runTests() {
  console.log('\n======================================================');
  console.log('   PulseSync Duplicate Filename Handling Test Suite   ');
  console.log('======================================================\n');

  fs.mkdirSync(TEST_DIR, { recursive: true });

  const createTempSource = (content = 'test audio bytes') => {
    const tempFile = path.join(TEST_DIR, `.tmp_src_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.tmp`);
    fs.writeFileSync(tempFile, content);
    return tempFile;
  };

  try {
    // 1. Test filename parsing & extension preservation with multiple dots
    console.log('• Testing: Split filename with single and multiple dots...');
    assert.deepStrictEqual(splitFilename('audio.mp3'), { stem: 'audio', ext: '.mp3' });
    assert.deepStrictEqual(splitFilename('North.Daniel.test.mp3'), { stem: 'North.Daniel.test', ext: '.mp3' });
    assert.deepStrictEqual(splitFilename('customer.meeting.record.wav'), { stem: 'customer.meeting.record', ext: '.wav' });
    assert.deepStrictEqual(splitFilename('no_ext'), { stem: 'no_ext', ext: '' });
    console.log('  \x1b[32mPASSED\x1b[0m');

    // 2. Test candidate name generation
    console.log('• Testing: Candidate numbering progression...');
    assert.strictEqual(getNumberedCandidate('North_Daniel_test.mp3', 0), 'North_Daniel_test.mp3');
    assert.strictEqual(getNumberedCandidate('North_Daniel_test.mp3', 1), 'North_Daniel_test(1).mp3');
    assert.strictEqual(getNumberedCandidate('North_Daniel_test.mp3', 2), 'North_Daniel_test(2).mp3');
    assert.strictEqual(getNumberedCandidate('North_Daniel_test.mp3', 3), 'North_Daniel_test(3).mp3');
    assert.strictEqual(getNumberedCandidate('North.Daniel.test.mp3', 1), 'North.Daniel.test(1).mp3');
    assert.strictEqual(getNumberedCandidate('customer_call(1).wav', 1), 'customer_call(2).wav');
    console.log('  \x1b[32mPASSED\x1b[0m');

    // 3. Test first upload retains original filename
    console.log('• Testing: First upload preserves original filename...');
    const src1 = createTempSource('audio 1');
    const res1 = await claimUniqueFilename({
      tempFilePath: src1,
      targetDir: TEST_DIR,
      originalFilename: 'North_Daniel_test.mp3',
    });
    assert.strictEqual(res1.filename, 'North_Daniel_test.mp3');
    assert.ok(fs.existsSync(res1.filePath));
    assert.strictEqual(fs.readFileSync(res1.filePath, 'utf8'), 'audio 1');
    console.log('  \x1b[32mPASSED\x1b[0m (Preserved North_Daniel_test.mp3)');

    // 4. Test second upload receives (1)
    console.log('• Testing: Second upload of identical filename receives (1)...');
    const src2 = createTempSource('audio 2');
    const res2 = await claimUniqueFilename({
      tempFilePath: src2,
      targetDir: TEST_DIR,
      originalFilename: 'North_Daniel_test.mp3',
    });
    assert.strictEqual(res2.filename, 'North_Daniel_test(1).mp3');
    assert.ok(fs.existsSync(res2.filePath));
    assert.strictEqual(fs.readFileSync(res2.filePath, 'utf8'), 'audio 2');
    // Ensure first file was not overwritten
    assert.strictEqual(fs.readFileSync(res1.filePath, 'utf8'), 'audio 1');
    console.log('  \x1b[32mPASSED\x1b[0m (Generated North_Daniel_test(1).mp3 without overwriting)');

    // 5. Test third upload receives (2)
    console.log('• Testing: Third upload receives (2)...');
    const src3 = createTempSource('audio 3');
    const res3 = await claimUniqueFilename({
      tempFilePath: src3,
      targetDir: TEST_DIR,
      originalFilename: 'North_Daniel_test.mp3',
    });
    assert.strictEqual(res3.filename, 'North_Daniel_test(2).mp3');
    assert.strictEqual(fs.readFileSync(res3.filePath, 'utf8'), 'audio 3');
    console.log('  \x1b[32mPASSED\x1b[0m (Generated North_Daniel_test(2).mp3)');

    // 6. Test fourth upload receives (3)
    console.log('• Testing: Fourth upload receives (3)...');
    const src4 = createTempSource('audio 4');
    const res4 = await claimUniqueFilename({
      tempFilePath: src4,
      targetDir: TEST_DIR,
      originalFilename: 'North_Daniel_test.mp3',
    });
    assert.strictEqual(res4.filename, 'North_Daniel_test(3).mp3');
    assert.strictEqual(fs.readFileSync(res4.filePath, 'utf8'), 'audio 4');
    console.log('  \x1b[32mPASSED\x1b[0m (Generated North_Daniel_test(3).mp3)');

    // 7. Test gap filling: if original and (2) exist, but (1) does not, chooses (1)
    console.log('• Testing: Gap filling selects next available slot (1)...');
    // Create gap by removing (1)
    fs.unlinkSync(res2.filePath);
    assert.ok(!fs.existsSync(path.join(TEST_DIR, 'North_Daniel_test(1).mp3')));
    assert.ok(fs.existsSync(path.join(TEST_DIR, 'North_Daniel_test(2).mp3')));

    const srcGap = createTempSource('audio gap fill');
    const resGap = await claimUniqueFilename({
      tempFilePath: srcGap,
      targetDir: TEST_DIR,
      originalFilename: 'North_Daniel_test.mp3',
    });
    assert.strictEqual(resGap.filename, 'North_Daniel_test(1).mp3');
    assert.strictEqual(fs.readFileSync(resGap.filePath, 'utf8'), 'audio gap fill');
    console.log('  \x1b[32mPASSED\x1b[0m (Correctly filled gap at North_Daniel_test(1).mp3)');

    // 8. Test multiple dots handling
    console.log('• Testing: Multiple dots: North.Daniel.test.mp3...');
    const srcDot1 = createTempSource('dot 1');
    const resDot1 = await claimUniqueFilename({
      tempFilePath: srcDot1,
      targetDir: TEST_DIR,
      originalFilename: 'North.Daniel.test.mp3',
    });
    assert.strictEqual(resDot1.filename, 'North.Daniel.test.mp3');

    const srcDot2 = createTempSource('dot 2');
    const resDot2 = await claimUniqueFilename({
      tempFilePath: srcDot2,
      targetDir: TEST_DIR,
      originalFilename: 'North.Daniel.test.mp3',
    });
    assert.strictEqual(resDot2.filename, 'North.Daniel.test(1).mp3');
    assert.ok(!resDot2.filename.includes('mp3(1)'), 'Numeric suffix must appear before extension');
    console.log('  \x1b[32mPASSED\x1b[0m (Generated North.Daniel.test(1).mp3)');

    // 9. Test case-insensitive collision detection
    console.log('• Testing: Case-insensitive conflict detection...');
    const srcCase = createTempSource('case test');
    const resCase = await claimUniqueFilename({
      tempFilePath: srcCase,
      targetDir: TEST_DIR,
      originalFilename: 'north_daniel_test.mp3', // Lowercase of existing 'North_Daniel_test.mp3'
    });
    // Should NOT overwrite 'North_Daniel_test.mp3', should find next unique candidate
    assert.notStrictEqual(resCase.filename.toLowerCase(), 'north_daniel_test.mp3');
    assert.strictEqual(fs.readFileSync(path.join(TEST_DIR, 'North_Daniel_test.mp3'), 'utf8'), 'audio 1');
    console.log(`  \x1b[32mPASSED\x1b[0m (Resolved to ${resCase.filename} without collision)`);

    // 10. Test DB known-conflict check
    console.log('• Testing: Database audio_url record conflict detection...');
    const srcDb = createTempSource('db conflict test');
    const resDb = await claimUniqueFilename({
      tempFilePath: srcDb,
      targetDir: TEST_DIR,
      originalFilename: 'remote_call.m4a',
      knownConflicts: ['/media/remote_call.m4a'],
    });
    assert.strictEqual(resDb.filename, 'remote_call(1).m4a');
    console.log('  \x1b[32mPASSED\x1b[0m (Detected DB record and produced remote_call(1).m4a)');

    // 11. Test concurrency / race condition: 10 parallel uploads of identical filename
    console.log('• Testing: Concurrency race condition with 10 simultaneous uploads...');
    const parallelCount = 10;
    const parallelSources = Array.from({ length: parallelCount }, (_, i) => 
      createTempSource(`parallel data ${i}`)
    );

    const parallelResults = await Promise.all(
      parallelSources.map((tempSrc) =>
        claimUniqueFilename({
          tempFilePath: tempSrc,
          targetDir: TEST_DIR,
          originalFilename: 'concurrent_session.wav',
        })
      )
    );

    const filenames = parallelResults.map(r => r.filename);
    const uniqueFilenames = new Set(filenames);
    assert.strictEqual(uniqueFilenames.size, parallelCount, 'All 10 parallel uploads must have distinct filenames');

    // Verify all 10 files exist and have intact data
    for (const r of parallelResults) {
      assert.ok(fs.existsSync(r.filePath));
      const content = fs.readFileSync(r.filePath, 'utf8');
      assert.ok(content.startsWith('parallel data'));
    }
    console.log(`  \x1b[32mPASSED\x1b[0m (All 10 parallel uploads claimed unique files: ${filenames.slice(0, 3).join(', ')}...)`);

    // 12. Test failure handling when temp source file is missing
    console.log('• Testing: Missing source file throws clean descriptive error...');
    await assert.rejects(
      async () => {
        await claimUniqueFilename({
          tempFilePath: path.join(TEST_DIR, 'nonexistent_source.tmp'),
          targetDir: TEST_DIR,
          originalFilename: 'test.mp3',
        });
      },
      /Temp upload file not found/
    );
    console.log('  \x1b[32mPASSED\x1b[0m');

    // 13. Test variety of supported audio extensions (.flac, .webm, .ogg)
    console.log('• Testing: Multi-format extensions (.webm, .ogg, .flac)...');
    for (const ext of ['.webm', '.ogg', '.flac']) {
      const srcExt1 = createTempSource(`audio ${ext} 1`);
      const srcExt2 = createTempSource(`audio ${ext} 2`);
      const r1 = await claimUniqueFilename({ tempFilePath: srcExt1, targetDir: TEST_DIR, originalFilename: `sample${ext}` });
      const r2 = await claimUniqueFilename({ tempFilePath: srcExt2, targetDir: TEST_DIR, originalFilename: `sample${ext}` });
      assert.strictEqual(r1.filename, `sample${ext}`);
      assert.strictEqual(r2.filename, `sample(1)${ext}`);
    }
    console.log('  \x1b[32mPASSED\x1b[0m');

    console.log('\n------------------------------------------------------');
    console.log('   All Duplicate Filename Handling Tests PASSED!      ');
    console.log('------------------------------------------------------\n');
  } finally {
    // Cleanup test directory
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

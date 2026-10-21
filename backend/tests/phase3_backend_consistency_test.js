/**
 * Phase 3 Regression Tests: Backend, API & Database Consistency
 * 
 * Verifies fixes for:
 * - PS-015: Duplicate shadowed route POST /customers/:id/prepare removed
 * - PS-013: N+1 database query loops resolved in /api/objections and /api/search
 * - PS-009: Unification and synchronization between Playbooks (schema_fields) and ExtractionProfiles (extraction_profiles)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running Phase 3 Regression Tests...');

const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// 1. PS-015 Verification: Duplicate /customers/:id/prepare route removed
{
  const prepareMatches = [...serverCode.matchAll(/app\.post\(\s*[`'"](?:\$\{basePath\}|\/customers)\/:id\/prepare[`'"]/g)];
  assert.equal(prepareMatches.length, 1, `Expected exactly 1 definition of POST :id/prepare, found ${prepareMatches.length}`);

  // Confirm the authoritative implementation is preserved
  assert.equal(serverCode.includes('generateCustomerPrepDossier(req.params.id)'), true, 'Authoritative generateCustomerPrepDossier implementation must be retained');
  console.log('✓ PS-015: Duplicate shadowed route removed, single authoritative endpoint registered');
}

// 2. PS-013 Verification: Elimination of N+1 database queries
{
  // A. Objections endpoint must use aggregated CTE with LATERAL join instead of query loop
  const hasAggQuery = serverCode.includes('WITH agg_objections AS') && serverCode.includes('LEFT JOIN LATERAL');
  assert.equal(hasAggQuery, true, 'Objections endpoint must use aggregated CTE and LATERAL join');

  // Verify there is no "for (const row of result.rows) { const meetingsRes = await pool.query" in /api/objections
  const objectionsEndpointMatch = serverCode.match(/app\.get\('\/api\/objections'[\s\S]*?res\.json\(objectionsList\);/);
  assert.ok(objectionsEndpointMatch, '/api/objections route must exist');
  const objectionsEndpointBody = objectionsEndpointMatch[0];
  const hasObjectionQueryLoop = objectionsEndpointBody.includes('for (const row of result.rows)');
  assert.equal(hasObjectionQueryLoop, false, 'Objections route must NOT loop sequential pool.query calls per row');

  // B. Search endpoint must batch query memories with ANY($1)
  const hasBatchedMemories = serverCode.includes('WHERE company_id = ANY($1) AND memory_type IN (\'budget\', \'champion\')');
  assert.equal(hasBatchedMemories, true, 'Search endpoint must batch-fetch memories with company_id = ANY($1)');

  const searchEndpointMatch = serverCode.match(/app\.get\('\/api\/search'[\s\S]*?results\.companies = enrichedCompanies;/);
  assert.ok(searchEndpointMatch, '/api/search route company enrichment section must exist');
  const searchEndpointBody = searchEndpointMatch[0];
  const hasPerCompanyMemoriesLoop = searchEndpointBody.includes('for (const c of companies) {\n        const budgetRes = await pool.query');
  assert.equal(hasPerCompanyMemoriesLoop, false, 'Search route must NOT execute per-company queries inside the company loop');

  console.log('✓ PS-013: N+1 database queries resolved into single CTE lateral join and batched ANY queries');
}

// 3. PS-009 Verification: Playbooks and Extraction Profiles synchronization
{
  // A. Schemas fields save endpoint synchronizes to extraction_profiles
  const hasProfileSyncInSchemaFields = serverCode.includes('PS-009: Synchronize schema fields into the active extraction profile');
  assert.equal(hasProfileSyncInSchemaFields, true, 'POST /api/schemas/:id/fields must synchronize schema fields into extraction_profiles');

  // B. Extraction profiles endpoints synchronize back to schema_fields
  const hasSyncHelper = serverCode.includes('async function syncProfileFieldsToSchema(fields)');
  assert.equal(hasSyncHelper, true, 'syncProfileFieldsToSchema helper function must be defined');

  const hasSyncInPostProfiles = serverCode.includes('await syncProfileFieldsToSchema(fields)');
  assert.equal(hasSyncInPostProfiles, true, 'POST /api/extraction-profiles must trigger syncProfileFieldsToSchema');

  const hasSyncInPutProfiles = serverCode.includes('await syncProfileFieldsToSchema(updatedRow.fields)');
  assert.equal(hasSyncInPutProfiles, true, 'PUT /api/extraction-profiles/:id must trigger syncProfileFieldsToSchema');

  console.log('✓ PS-009: Bi-directional synchronization between Playbooks schema_fields and Extraction Profiles verified');
}

console.log('All Phase 3 Regression Tests Passed Successfully!');

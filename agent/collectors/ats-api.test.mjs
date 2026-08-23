import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  collectAtsApi,
  normalizeAshbyListing,
  normalizeGreenhouseListing,
  normalizeLeverListing,
} from './ats-api.mjs';

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url);
const CAPTURED_AT = '2026-08-23T12:00:00.000Z';

async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURE_DIR), 'utf8'));
}

test('normalizes public Greenhouse metadata, including an external ID and compensation', async () => {
  const job = await fixture('greenhouse.json');
  assert.deepEqual(normalizeGreenhouseListing(job, { company: 'Acme', capturedAt: CAPTURED_AT }), {
    title: 'Senior Platform Engineer', url: 'https://boards.greenhouse.io/acme/jobs/1234567', company: 'Acme',
    location: 'Chicago, IL', externalId: '1234567', compensation: { min: 150000, max: 185000, currency: 'USD' },
    source: 'greenhouse-api', capturedAt: CAPTURED_AT,
  });
});

test('normalizes public Ashby metadata, including annualized compensation', async () => {
  const job = await fixture('ashby.json');
  assert.deepEqual(normalizeAshbyListing(job, { company: 'Acme', capturedAt: CAPTURED_AT }), {
    title: 'Staff Data Engineer', url: 'https://jobs.ashbyhq.com/acme/3a4a913a-dc28-4d2e-859b-9f9cb5acb2ed', company: 'Acme',
    location: 'New York, NY · Remote (US)', externalId: '3a4a913a-dc28-4d2e-859b-9f9cb5acb2ed',
    compensation: { min: 166400, max: 197600, currency: 'USD' }, source: 'ashby-api', capturedAt: CAPTURED_AT,
  });
});

test('normalizes public Lever metadata and preserves unavailable compensation as null', async () => {
  const job = await fixture('lever.json');
  assert.deepEqual(normalizeLeverListing(job, { company: 'Acme', capturedAt: CAPTURED_AT }), {
    title: 'Product Manager', url: 'https://jobs.lever.co/acme/4f8771de-7bbc-4ae6-9ba4-1ad3ee95ec7f', company: 'Acme',
    location: 'Austin, TX; Remote - US', externalId: '4f8771de-7bbc-4ae6-9ba4-1ad3ee95ec7f', compensation: null,
    source: 'lever-api', capturedAt: CAPTURED_AT,
  });
});

for (const [providerId, url] of [
  ['greenhouse', 'https://boards.greenhouse.io/acme/jobs/immutable-id'],
  ['ashby', 'https://jobs.ashbyhq.com/acme/immutable-id'],
  ['lever', 'https://jobs.lever.co/acme/immutable-id'],
]) test(`wraps the established ${providerId} provider contract and omits job-description text`, async () => {
  const ctx = { fetchJson: async () => ({}) };
  const providers = {
    [providerId]: {
      async fetch(entry, receivedCtx) {
        assert.equal(entry.name, 'Acme');
        assert.equal(receivedCtx, ctx);
        return [{ title: 'Engineer', url, company: 'Acme', location: 'Remote', description: 'never retained' }];
      },
    },
  };
  const records = await collectAtsApi(providerId, { name: 'Acme' }, ctx, { capturedAt: CAPTURED_AT, providers });
  assert.deepEqual(records, [{
    title: 'Engineer', url, company: 'Acme', location: 'Remote', externalId: 'immutable-id',
    compensation: null, source: `${providerId}-api`, capturedAt: CAPTURED_AT,
  }]);
  assert.equal('description' in records[0], false);
});

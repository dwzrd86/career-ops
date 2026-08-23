// Public ATS collection facade.
//
// This module deliberately wraps the scanner's existing Greenhouse, Ashby and
// Lever providers. It does not scrape HTML, navigate an application flow, or
// retain job-description text. Its output is the small metadata record that
// later collection stages can safely persist and deduplicate.

import greenhouse from '../../providers/greenhouse.mjs';
import ashby, { parseCompensation as parseAshbyCompensation } from '../../providers/ashby.mjs';
import lever from '../../providers/lever.mjs';

const PROVIDERS = Object.freeze({ greenhouse, ashby, lever });

export const ATS_PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));

function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function identifier(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function captureTime(value) {
  const parsed = new Date(value ?? Date.now());
  if (Number.isNaN(parsed.valueOf())) throw new TypeError('capturedAt must be a valid date');
  return parsed.toISOString();
}

function normalizeCompensation(value) {
  if (!value || typeof value !== 'object') return null;
  const min = Number(value.min);
  const max = Number(value.max);
  const hasMin = Number.isFinite(min) && min >= 0;
  const hasMax = Number.isFinite(max) && max >= 0;
  if (!hasMin && !hasMax) return null;
  return {
    min: hasMin ? min : max,
    max: hasMax ? max : min,
    currency: string(value.currency).toUpperCase(),
  };
}

function greenhouseCompensation(job) {
  const ranges = Array.isArray(job?.pay_input_ranges) ? job.pay_input_ranges : [];
  const range = ranges.find((candidate) => candidate && typeof candidate === 'object');
  if (!range) return null;
  // Greenhouse reports cents. Its schema calls the currency `currency_type`.
  return normalizeCompensation({
    min: Number(range.min_cents) / 100,
    max: Number(range.max_cents) / 100,
    currency: range.currency_type,
  });
}

function leverLocation(categories) {
  const values = [categories?.location, ...(Array.isArray(categories?.allLocations) ? categories.allLocations : [])]
    .map(string)
    .filter(Boolean);
  return [...new Set(values.map((value) => value.toLowerCase()))]
    .map((value) => values.find((candidate) => candidate.toLowerCase() === value))
    .join('; ');
}

function record({ title, url, company, location, externalId, compensation, source, capturedAt }) {
  return Object.freeze({
    title: string(title),
    url: string(url),
    company: string(company),
    location: string(location),
    externalId: identifier(externalId),
    compensation: normalizeCompensation(compensation),
    source,
    capturedAt: captureTime(capturedAt),
  });
}

/** Normalize a Greenhouse public board listing without retaining its body. */
export function normalizeGreenhouseListing(job, { company, capturedAt } = {}) {
  return record({
    title: job?.title,
    url: job?.absolute_url,
    company: company ?? job?.company_name,
    location: job?.location?.name,
    externalId: job?.id,
    compensation: greenhouseCompensation(job),
    source: 'greenhouse-api',
    capturedAt,
  });
}

/** Normalize an Ashby public posting-api listing without retaining its body. */
export function normalizeAshbyListing(job, { company, capturedAt } = {}) {
  const locations = [job?.location, ...(Array.isArray(job?.secondaryLocations) ? job.secondaryLocations.map((item) => item?.location) : [])]
    .map(string)
    .filter(Boolean);
  return record({
    title: job?.title,
    url: job?.jobUrl,
    company: company ?? job?.companyName,
    location: [...new Set(locations)].join(' · '),
    externalId: job?.id,
    compensation: parseAshbyCompensation(job),
    source: 'ashby-api',
    capturedAt,
  });
}

/** Normalize a Lever public postings listing without retaining its body. */
export function normalizeLeverListing(job, { company, capturedAt } = {}) {
  return record({
    title: job?.text,
    url: job?.hostedUrl,
    company: company ?? job?.company,
    location: leverLocation(job?.categories),
    externalId: job?.id,
    compensation: null,
    source: 'lever-api',
    capturedAt,
  });
}

function inferExternalId(providerId, url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (providerId === 'greenhouse') return parts.at(-1) || '';
    // Ashby and Lever hosted URLs end in their immutable posting identifiers.
    return parts.at(-1) || '';
  } catch {
    return '';
  }
}

function normalizeFetchedJob(providerId, job, capturedAt) {
  return record({
    title: job?.title,
    url: job?.url,
    company: job?.company,
    location: job?.location,
    externalId: job?.externalId ?? inferExternalId(providerId, job?.url),
    compensation: job?.salary,
    source: `${providerId}-api`,
    capturedAt,
  });
}

/**
 * Collect public ATS listings using the scanner's existing provider contract.
 * `providers` is injectable only for deterministic tests; production callers
 * should use the default map. The provider context is the existing safe HTTP
 * context from `providers/_http.mjs` and no browser capability is accepted.
 */
export async function collectAtsApi(providerId, entry, ctx, { capturedAt = new Date(), providers = PROVIDERS } = {}) {
  if (!ATS_PROVIDER_IDS.includes(providerId)) {
    throw new RangeError(`Unsupported ATS provider: ${providerId}`);
  }
  if (!entry || !string(entry.name)) throw new TypeError('A collector entry requires a company name');
  if (!ctx || typeof ctx.fetchJson !== 'function') throw new TypeError('A collector requires an HTTP fetchJson context');
  const provider = providers[providerId];
  if (!provider || typeof provider.fetch !== 'function') throw new TypeError(`Provider ${providerId} is unavailable`);

  const timestamp = captureTime(capturedAt);
  const jobs = await provider.fetch(entry, ctx);
  if (!Array.isArray(jobs)) throw new TypeError(`${providerId} provider returned a non-array result`);
  return jobs.map((job) => normalizeFetchedJob(providerId, job, timestamp));
}

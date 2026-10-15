"use node";
import { internalAction } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { ATS_SOURCES, evaluateCandidate, isRelevantTitle, parseFeed } from "./atsSources";

const MAX_FEED_JOBS = 15;

async function stableId(provider: string, value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${provider}\0${value}`));
  return `${provider}-${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
}

async function readFeed(source: (typeof ATS_SOURCES)[number]) {
  const response = await fetch(source.url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error("FEED_UNAVAILABLE");
  return parseFeed(source, await response.json());
}

export const runForOwner = internalAction({
  args: { runId: v.id("discoveryScanRuns") },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const profile: Doc<"targetProfiles"> | null = await ctx.runMutation(internal.autoDiscovery.claimRun, { runId });
    if (!profile) return null;
    const sources = ATS_SOURCES.filter((source) => profile.sources.includes(source.provider));
    const feeds = await Promise.allSettled(sources.map(async (source) => ({ source, jobs: await readFeed(source) })));
    const counts = { feedsSucceeded: 0, feedsFailed: 0, discovered: 0, reviewable: 0, rejected: 0 };
    try {
      for (const feed of feeds) {
        if (feed.status === "rejected") { counts.feedsFailed++; continue; }
        counts.feedsSucceeded++;
        const items = [];
        for (const candidate of feed.value.jobs) {
          if (!isRelevantTitle(profile, candidate.title)) continue;
          const decision = evaluateCandidate(profile, candidate);
          if (decision.outcome === "rejected") { counts.rejected++; continue; }
          if (items.length >= MAX_FEED_JOBS) continue;
          items.push({
            localJobId: await stableId(candidate.provider, candidate.externalId),
            company: candidate.company,
            title: candidate.title,
            location: candidate.location,
            url: candidate.url,
            source: { label: candidate.sourceLabel, provider: candidate.provider },
            postedAt: candidate.postedAt,
            decision: { ...decision, outcome: decision.outcome },
          });
        }
        counts.reviewable += items.length;
        if (items.length) counts.discovered += await ctx.runMutation(internal.autoDiscovery.ingestBatch, { runId, profileVersion: profile.profileVersion, jobs: items });
      }
      await ctx.runMutation(internal.autoDiscovery.finishRun, {
        runId, ...counts, status: counts.feedsFailed === 0 ? "succeeded" : counts.feedsSucceeded === 0 ? "failed" : "partial",
        ...(counts.feedsFailed ? { errorCode: "FEED_PARTIAL" } : {}),
      });
    } catch {
      await ctx.runMutation(internal.autoDiscovery.finishRun, { runId, ...counts, status: "failed", errorCode: "SCAN_FAILED" });
    }
    return null;
  },
});

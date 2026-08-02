import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { diagnosticEvent, safeRoute } from "./errorReporting";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("privacy-safe error reporting", () => {
  test("keeps only diagnostic metadata and removes URL query data", () => {
    const sensitiveValues = {
      applicationAnswer: "My private application answer",
      authToken: "token-very-secret",
      emailBody: "Interview material attached",
      jobNote: "Do not contact my manager",
      password: "correct-horse-battery-staple",
      resumeFile: "candidate-resume.pdf",
    };
    const event = diagnosticEvent({
      deploymentVersion: "release-2026.08.01",
      errorCategory: "operationFailed",
      operationType: "job.create",
      route: `https://app.example.test/pipeline?notes=${encodeURIComponent(sensitiveValues.jobNote)}&token=${sensitiveValues.authToken}`,
    });

    expect(event).toEqual({
      deploymentVersion: "release-2026.08.01",
      errorCategory: "operationFailed",
      operationType: "job.create",
      route: "/pipeline",
    });
    const storedText = JSON.stringify(event);
    for (const value of Object.values(sensitiveValues)) {
      expect(storedText).not.toContain(value);
    }
    expect(Object.keys(event)).toEqual(["deploymentVersion", "errorCategory", "operationType", "route"]);
  });

  test("rejects unsafe labels and strips query and fragment data from relative routes", () => {
    expect(safeRoute("/settings?email=person@example.test#reset-code")).toBe("/settings");
    expect(diagnosticEvent({
      deploymentVersion: "release?token=secret",
      errorCategory: "unexpected",
      operationType: "job.create?notes=private",
      route: "not a valid route",
    })).toEqual({
      deploymentVersion: "unversioned",
      errorCategory: "unexpected",
      operationType: "unknown",
      route: "/not%20a%20valid%20route",
    });
  });

  test("persists only the redacted client report shape", async () => {
    const t = convexTest(schema, modules);
    await t.mutation((api as any).errorReporting.reportClient, {
      deploymentVersion: "release-2026.08.01",
      errorCategory: "validationFailed",
      operationType: "job.create",
      route: "https://app.example.test/pipeline?resume=candidate.pdf&password=nope",
    });

    await t.run(async (ctx) => {
      const reports = await ctx.db.query("errorReports").collect();
      expect(reports).toHaveLength(1);
      expect(reports[0]).toEqual(expect.objectContaining({
        deploymentVersion: "release-2026.08.01",
        errorCategory: "validationFailed",
        operationType: "job.create",
        route: "/pipeline",
        occurredAt: expect.any(Number),
      }));
      expect(JSON.stringify(reports[0])).not.toContain("candidate.pdf");
      expect(JSON.stringify(reports[0])).not.toContain("password=nope");
    });
  });
});

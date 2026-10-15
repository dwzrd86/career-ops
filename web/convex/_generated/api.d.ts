/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as abuse from "../abuse.js";
import type * as account from "../account.js";
import type * as atsSources from "../atsSources.js";
import type * as auth from "../auth.js";
import type * as autoDiscovery from "../autoDiscovery.js";
import type * as autoDiscoveryWorker from "../autoDiscoveryWorker.js";
import type * as crons from "../crons.js";
import type * as discovery from "../discovery.js";
import type * as enrollment from "../enrollment.js";
import type * as enrollmentCore from "../enrollmentCore.js";
import type * as errorReporting from "../errorReporting.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as privacy from "../privacy.js";
import type * as resumeBundles from "../resumeBundles.js";
import type * as targetProfile from "../targetProfile.js";
import type * as targetProfileModel from "../targetProfileModel.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  abuse: typeof abuse;
  account: typeof account;
  atsSources: typeof atsSources;
  auth: typeof auth;
  autoDiscovery: typeof autoDiscovery;
  autoDiscoveryWorker: typeof autoDiscoveryWorker;
  crons: typeof crons;
  discovery: typeof discovery;
  enrollment: typeof enrollment;
  enrollmentCore: typeof enrollmentCore;
  errorReporting: typeof errorReporting;
  http: typeof http;
  jobs: typeof jobs;
  privacy: typeof privacy;
  resumeBundles: typeof resumeBundles;
  targetProfile: typeof targetProfile;
  targetProfileModel: typeof targetProfileModel;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};

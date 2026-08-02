import { useMutation } from "convex/react";
import { useCallback, useEffect } from "react";
import { functions } from "./convex";

type ClientErrorCategory = "authenticationFailed" | "operationFailed" | "unexpected" | "validationFailed";

function currentRoute() {
  // Do not send query parameters to the reporting mutation in the first place.
  return window.location.pathname;
}

/**
 * Report only fixed diagnostic metadata. The error object and submitted values
 * are deliberately not accepted, preventing form data or tokens from entering
 * telemetry as a future call-site convenience.
 */
export function useSafeErrorReporter() {
  const reportClient = useMutation(functions.reportClientError);

  return useCallback((operationType: string, errorCategory: ClientErrorCategory) => {
    void reportClient({
      deploymentVersion: import.meta.env.VITE_APP_DEPLOYMENT_VERSION || "unversioned",
      errorCategory,
      operationType,
      route: currentRoute(),
    }).catch(() => undefined);
  }, [reportClient]);
}

export function useUnhandledErrorReporting() {
  const report = useSafeErrorReporter();

  useEffect(() => {
    const reportUnhandled = () => report("client.unhandled", "unexpected");
    window.addEventListener("error", reportUnhandled);
    window.addEventListener("unhandledrejection", reportUnhandled);
    return () => {
      window.removeEventListener("error", reportUnhandled);
      window.removeEventListener("unhandledrejection", reportUnhandled);
    };
  }, [report]);
}

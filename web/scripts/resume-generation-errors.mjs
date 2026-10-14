// Only these fixed messages may cross from the local agent into the browser.
const messages = {
  authentication: "OpenCode could not authenticate with Z.AI Coding Plan. Reconnect that provider with opencode auth login, then retry.",
  quota: "Z.AI Coding Plan rejected the request because of quota or rate limits. Check your plan usage and retry when capacity returns.",
  timeout: "GLM did not finish within three minutes. Check the provider connection and retry; no partial draft was saved.",
  incomplete: "OpenCode exited without a completed resume. Check your Coding Plan model and connection, then retry; no partial draft was saved.",
  unavailable: "Could not start OpenCode. Install it and connect Z.AI Coding Plan with opencode auth login.",
  failed: "GLM generation failed. Check OpenCode Coding Plan sign-in and quota, then retry.",
};

export class ResumeGenerationError extends Error {
  constructor(code) {
    super(messages[code] ?? messages.failed);
    this.code = Object.hasOwn(messages, code) ? code : "failed";
  }
}

export function providerFailure(error) {
  // Read structured HTTP status only; never return provider messages or logs.
  const status = error?.data?.statusCode ?? error?.statusCode;
  if (status === 401 || status === 403) return new ResumeGenerationError("authentication");
  if (status === 429) return new ResumeGenerationError("quota");
  return new ResumeGenerationError("failed");
}

export function generationFailureResponse(error) {
  const safe = new ResumeGenerationError(error instanceof ResumeGenerationError ? error.code : "failed");
  return { error: `${safe.message} Your editor is unchanged.`, code: safe.code };
}

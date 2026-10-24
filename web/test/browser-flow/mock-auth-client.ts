import {
  resetBrowserFlowPassword,
  setBrowserFlowAuthentication,
  setBrowserFlowPendingAccount,
  signInBrowserFlow,
  verifyBrowserFlowAccount,
} from "./browser-state";

declare global {
  interface Window { __authFailure?: { method: string; code: string } }
}

// One-shot errors drive the real AccessScreen's recovery states in both builds.
function failOnce(method: string) {
  if (window.__authFailure?.method !== method) return;
  const { code } = window.__authFailure;
  delete window.__authFailure;
  throw { code, message: "Private provider diagnostic must never reach the UI" };
}

const success = { data: null, error: null };

export const authClient = {
  changePassword: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
    signInBrowserFlow("security-flow@example.test", currentPassword);
    resetBrowserFlowPassword(newPassword);
    return success;
  },
  requestPasswordReset: async (_params: { email: string; redirectTo: string }) => { failOnce("requestPasswordReset"); return success; },
  resetPassword: async ({ newPassword }: { newPassword: string; token: string }) => {
    failOnce("resetPassword");
    resetBrowserFlowPassword(newPassword);
    return success;
  },
  sendVerificationEmail: async (_params: { email: string; callbackURL: string }) => {
    failOnce("sendVerificationEmail");
    verifyBrowserFlowAccount();
    return success;
  },
  signIn: {
    email: async ({ email, password }: { email: string; password: string }) => {
      failOnce("signIn");
      signInBrowserFlow(email, password);
      return success;
    },
  },
  signOut: async () => {
    setBrowserFlowAuthentication(false);
    return success;
  },
  signUp: {
    email: async ({ botProtectionToken, email, inviteToken, password }: { botProtectionToken: string; email: string; inviteToken: string; password: string }) => {
      failOnce("signUp");
      if (!botProtectionToken || !inviteToken) throw new Error("signup failed");
      setBrowserFlowPendingAccount(email, password);
      return success;
    },
  },
};

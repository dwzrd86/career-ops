import {
  resetBrowserFlowPassword,
  setBrowserFlowAuthentication,
  setBrowserFlowPendingAccount,
  signInBrowserFlow,
  verifyBrowserFlowAccount,
} from "./browser-state";

const success = { data: null, error: null };

export const authClient = {
  changePassword: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
    signInBrowserFlow("security-flow@example.test", currentPassword);
    resetBrowserFlowPassword(newPassword);
    return success;
  },
  requestPasswordReset: async (_params: { email: string; redirectTo: string }) => success,
  resetPassword: async ({ newPassword }: { newPassword: string; token: string }) => {
    resetBrowserFlowPassword(newPassword);
    return success;
  },
  sendVerificationEmail: async (_params: { email: string; callbackURL: string }) => {
    verifyBrowserFlowAccount();
    return success;
  },
  signIn: {
    email: async ({ email, password }: { email: string; password: string }) => {
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
      if (!botProtectionToken || !inviteToken) throw new Error("signup failed");
      setBrowserFlowPendingAccount(email, password);
      return success;
    },
  },
};

import {
  setBrowserFlowAuthentication,
  setBrowserFlowPendingAccount,
  signInBrowserFlow,
  verifyBrowserFlowAccount,
} from "./browser-state";

export function useAuthActions() {
  return {
    async signIn(_provider: string, params: Record<string, string>) {
      if (params.flow === "signUp") {
        if (!params.botProtectionToken || !params.inviteToken) throw new Error("signup failed");
        setBrowserFlowPendingAccount(params.email, params.password);
        return { signingIn: false };
      }
      if (params.flow === "email-verification") {
        verifyBrowserFlowAccount(params.code);
        return { signingIn: true };
      }
      if (params.flow === "signIn") {
        signInBrowserFlow(params.email, params.password);
        return { signingIn: true };
      }
      throw new Error("unsupported browser-flow authentication action");
    },
    async signOut() {
      setBrowserFlowAuthentication(false);
    },
  };
}

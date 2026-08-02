import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider, type AuthClient } from "@convex-dev/better-auth/react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { authClient } from "./auth-client";
import "./styles.css";

const deploymentUrl = import.meta.env.VITE_CONVEX_URL;

createRoot(document.getElementById("root")!).render(
  deploymentUrl ? (
    <ConvexBetterAuthProvider authClient={authClient as unknown as AuthClient} client={new ConvexReactClient(deploymentUrl, { expectAuth: true })}>
      <App />
    </ConvexBetterAuthProvider>
  ) : (
    <main className="setup-screen">
      <section>
        <p className="eyebrow">Career Ops</p>
        <h1>Connect a Convex deployment to start the dashboard.</h1>
        <p>
          Add <code>VITE_CONVEX_URL</code> to <code>web/.env.local</code> for local
          development. Netlify receives this value automatically during the Convex build step.
        </p>
      </section>
    </main>
  ),
);

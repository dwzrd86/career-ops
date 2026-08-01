import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const deploymentUrl = import.meta.env.VITE_CONVEX_URL;

createRoot(document.getElementById("root")!).render(
  deploymentUrl ? (
    <ConvexAuthProvider client={new ConvexReactClient(deploymentUrl)}>
      <App />
    </ConvexAuthProvider>
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

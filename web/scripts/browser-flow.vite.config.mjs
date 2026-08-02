import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, "..");
const flowDirectory = resolve(webDirectory, "test/browser-flow");

export default defineConfig({
  root: flowDirectory,
  define: {
    "import.meta.env.VITE_TURNSTILE_SITE_KEY": JSON.stringify("1x00000000000000000000AA"),
  },
  plugins: [
    {
      name: "isolated-browser-flow-mocks",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "convex/react") return resolve(flowDirectory, "mock-convex-react.ts");
        if (source === "@convex-dev/auth/react") return resolve(flowDirectory, "mock-auth-react.tsx");
        if (source === "./convex" && importer && importer.includes("/src/")) {
          return resolve(flowDirectory, "mock-convex.ts");
        }
        return null;
      },
    },
    react(),
  ],
});

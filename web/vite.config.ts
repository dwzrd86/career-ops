import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "remove-convex-documentation-endpoint",
      transform(code, id) {
        if (!id.includes("/node_modules/convex/")) return null;

        // Convex includes a documentation URL in an error message. Removing it
        // keeps the production bundle endpoint audit unambiguous.
        return code.includes("https://happy-otter-123.convex.cloud")
          ? code.replaceAll("https://happy-otter-123.convex.cloud", "a Convex deployment URL")
          : null;
      },
    },
  ],
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig(() => {
  return {
    define: {
      "import.meta.env.APP_VERSION": JSON.stringify(
        process.env.npm_package_version,
      ),
    },
    plugins: [react(), tsconfigPaths(), tailwindcss()],
  };
});

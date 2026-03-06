import path from "node:path";
import { builtinModules } from "node:module";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const externalPackages = [
  "@modelcontextprotocol/sdk",
  "express",
  "markdown-it",
  "minisearch",
  "nanoid",
  "zod",
];

const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: path.resolve(__dirname, "./tsconfig.json"),
      exclude: ["playground/*"],
    }),
  ],
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "VitePressMCPPlugin",
      fileName: (format: string) => (format == "es" ? `vitepress-plugin-mcp.${format}.mjs` : `vitepress-plugin-mcp.${format}.js`),
    },
    rollupOptions: {
      external: (id) => {
        if (builtins.has(id)) return true;
        return externalPackages.some((pkg) => id === pkg || id.startsWith(`${pkg}/`));
      },
      output: {
        globals: {
          "node:util": "node_util",
          "node:fs": "node_fs",
          "node:path": "node_path",
          "node:zlib": "node_zlib",
          "node:http": "node_http",
          "node:events": "node_events",
          "node:net": "node_net",
          "node:crypto": "node_crypto",
          express: "express",
          "@modelcontextprotocol/sdk/server/mcp.js": "mcp_sdk_mcp",
          "@modelcontextprotocol/sdk/server/streamableHttp.js": "mcp_sdk_streamableHttp",
          "@modelcontextprotocol/sdk/server/sse.js": "mcp_sdk_sse",
          "@modelcontextprotocol/sdk/types.js": "mcp_sdk_types",
          "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js": "mcp_sdk_inMemoryEventStore",
          nanoid: "nanoid",
          minisearch: "MiniSearch",
          zod: "zod",
          "markdown-it": "markdownit",
        },
      },
    },
  },
});

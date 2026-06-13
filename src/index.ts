import { Plugin, UserConfig } from "vite";
import { UserConfig as VPUserConfig } from "vitepress";
import { styleText } from "node:util";
import { mainRender } from "./modules/render";
import { runServer, restartServer } from "./modules/server";

export type MCPPluginOptions = {
  port: number;
  specPath?: string; // OpenAPI specification path
  serverName?: string; // MCP server name for discovery
  serverVersion?: string; // MCP server version for discovery
  toolSearchName?: string; // Name of the search tool
  toolSearchDescription?: string; // Description of the search tool
};

let serverBootFlg = false;

function MCPPlugin(inlineOptions?: Partial<MCPPluginOptions>): Plugin {
  return {
    name: "vitepress-plugin-mcp",
    enforce: "post",
    config: (config: UserConfig): VPUserConfig => {
      console.log("MCPPlugin is running...");
      const vitepressConfig = (config as any).vitepress;
      let vpUserThemeConfig = vitepressConfig.userConfig.themeConfig;

      if (!vpUserThemeConfig) vpUserThemeConfig = {};
      if (!vpUserThemeConfig.search) vpUserThemeConfig.search = {};
      if (!vpUserThemeConfig.search.options) {
        console.error(styleText("bgRed", "Vitepress search.options are not defined. Please set 'themeConfig.search.options' on VitePress config."));
        serverBootFlg = false;
        return config;
      }

      return vpUserThemeConfig as VPUserConfig;
    },
    configResolved(config) {
      const vitepressConfig = (config as any).vitepress;
      let vpUserThemeConfig = vitepressConfig.userConfig.themeConfig;

      let originalRender = async (src: any, env: any, md: any) => {
        const html = await md.render(src, env);
        return html;
      };

      if (vpUserThemeConfig.search.options._render) {
        originalRender = vpUserThemeConfig.search.options._render;
      }

      const buildMode = config.command === "build";
      vpUserThemeConfig.search.options._render = async (src: any, env: any, md: any) => {
        await mainRender(src, env, md, buildMode, inlineOptions?.specPath);
        return await originalRender(src, env, md);
      };

      if(buildMode){
        console.log("MCPPlugin: Build mode detected. Skipping server start.");
        return; //NOTE: Skip server start on build command
      }

      serverBootFlg = true;

      setTimeout(async () => {
        if (!serverBootFlg) {
          console.error("search-index.json is not found.");
          return;
        }

        const { port, specPath, ...serverOpts } = inlineOptions ?? {};
        runServer(port, false, serverOpts);
      }, 1500);
    },
    configurePreviewServer(server) {
      console.log("preview server:",server);
      serverBootFlg = true;
      
    },
    async watchChange(id:string,change:any) {
      if (serverBootFlg) {
        await restartServer();
      }
    },
  } satisfies Plugin;
}

export {
  MCPPlugin,
  runServer,
  restartServer,
}

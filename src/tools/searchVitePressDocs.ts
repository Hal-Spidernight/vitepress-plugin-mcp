import { z } from "zod";
import { searchByMiniSearch } from "../modules/search/miniSearch";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function toolSearchVitePressDocs(mcp: McpServer, buildMode = false, toolSearchName?: string, toolSearchDescription?: string) {
  mcp.tool(
    toolSearchName || "search_vitepress_docs",
    toolSearchDescription || "Search VitePress Documents For This Product. Extract up to five keywords each English and native language, and define all of them as single words. e.g. Vitepress, API, Specification,Extensions etc.",
    { keywords: z.array(z.string()) },
    async ({ keywords }) => {
      console.log("START: search-docs");
      // console.log("START: search-docs", keywords);
      const results = [];
      for await (const keyword of keywords) {
        const searchResults = await searchByMiniSearch(keyword, buildMode);
        console.log("searchResults:", searchResults);
        const result = searchResults.map((item) => {
          return { title: item.title, relativePath: item.relativePath, content: item.content, excerpt: item.excerpt };
        });
        results.push(result);
      }
      const mcpResponse = results.map((item) => ({
        type: "text" as const,
        text: JSON.stringify(item),
      }));
      console.log("mcpResponse", mcpResponse);
      console.log("END: search-docs");
      return { content: mcpResponse };
    }
  );
}

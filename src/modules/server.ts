import express from "express";
import { randomUUID } from "node:crypto";
import { Server } from "node:http";
import { styleText } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import { toolSearchVitePressDocs } from "../tools/searchVitePressDocs";
import { promptBasic } from "../prompts/basic";

// Map to store transports by session ID
const transports = {
  streamable: {} as Record<string, StreamableHTTPServerTransport>,
  sse: {} as Record<string, SSEServerTransport>,
};

export interface MCPServerOptions {
  /** Server metadata shown in GET /mcp discovery response */
  serverName: string;
  serverVersion: string;
  /** Search tool configuration */
  toolSearchName: string;
  toolSearchDescription: string;
}

let serverOptions: MCPServerOptions = {
  serverName: "VitePress-server",
  serverVersion: "1.0.0",
  toolSearchName: "search_vitepress_docs",
  toolSearchDescription:
    "Search VitePress Documents For This Product. Extract up to five keywords each English and native language, and define all of them as single words. e.g. Vitepress, API, Specification,Extensions etc.",
};

let mcpServer = new McpServer({
  name: serverOptions.serverName,
  version: serverOptions.serverVersion,
});

let app = express();

let appServer: Server;

export function runServer(port = 3000, buildMode = false, options: Partial<MCPServerOptions> = {}) {
  serverOptions = Object.assign(serverOptions, options);

  console.log(
    styleText(
      "blue",
      `

  Starting MCP server...`
    )
  );
  app.init();
  app.use(express.json());

  mcpServer = new McpServer({
    name: serverOptions.serverName,
    version: serverOptions.serverVersion,
  });

  toolSearchVitePressDocs(mcpServer, buildMode, serverOptions.toolSearchName, serverOptions.toolSearchDescription);
  promptBasic(mcpServer);

  // GET /mcp: SSE streaming (with session ID) or server discovery (without session ID)
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && transports.streamable[sessionId]) {
      // Valid session: delegate to transport for SSE streaming
      await callStreamableServer(req, res);
    } else {
      // No session: return server metadata JSON (discovery / health check)
      res.json({
        server: {
          name: serverOptions.serverName,
          version: serverOptions.serverVersion,
          transport: "http",
        },
        capabilities: {
          tools: serverOptions.toolSearchName
            ? { name: serverOptions.toolSearchName, description: serverOptions.toolSearchDescription }
            : {},
        },
      });
    }
  });

  // NOTE:Handle POST requests for client-to-server communication
  app.post("/mcp", async (req, res) => {
    console.log("POST request received at /mcp");
    await callStreamableServer(req, res);
  });

  // Handle DELETE requests for session termination (StreamableHTTP)
  app.delete("/mcp", async (req, res) => {
    console.log("DELETE request received at /mcp");
    await callStreamableServer(req, res);
  });

  // Handle GET requests for server-to-client notifications via SSE
  app.get("/mcp/__sse", handleSSESessionRequest);

  // Handle DELETE requests for session termination
  app.delete("/mcp/__sse", handleSSESessionRequest);

  // Legacy message endpoint for older clients
  app.post("/messages", async (req, res) => {
    console.log("Legacy messages endpoint called");
    const sessionId = req.query.sessionId as string;
    const transport = transports.sse[sessionId];
    if (transport) {
      await transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).send("No transport found for sessionId");
    }
  });

  let errorMessage = null;

  appServer = app.listen(port, (error) => {
    errorMessage = error?.message;
    if ((errorMessage ?? "").includes("address already in use")) {
      console.error("Error starting server:", error?.message);
      console.warn("Port", port, "is already in use. Retrying with next port...");
      runServer(port + 1, buildMode, serverOptions);
      return;
    }
    console.log(styleText("whiteBright", `VitePress Plugin MCP`));
    console.log(styleText("green", `  Stremable Server is running on http://localhost:${port}/mcp`));
    console.log(styleText("green", `  SSE Server is running on http://localhost:${port}/mcp/__sse`));
  });
}

/**
 * Handle incoming requests to the MCP server.
 * @param req
 * @param res
 * @returns
 */
const callStreamableServer = async (req: express.Request, res: express.Response) => {
  try {
    // Check for existing session ID
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.streamable[sessionId]) {
      // Reuse existing transport
      transport = transports.streamable[sessionId];
    } else if (!sessionId && req.body && isInitializeRequest(req.body)) {
      console.log("Initializing new transport");
      transport = await initializeStreamableTransport();

      await initializeMCPServer(transport, res);
    } else {
      // Invalid request
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      res.send();
      return;
    }

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
};

/**
 * Reusable handler for GET and DELETE requests for SSE sessions.
 * @param req
 * @param res
 * @returns
 */
const handleSSESessionRequest = async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // console.log("Session ID:", sessionId);
  let transport = transports.sse[sessionId ?? ""];
  if (!sessionId || !transports.sse[sessionId]) {
    // console.warn("Invalid or missing session ID. Creating new SSE transport.");
    transport = await initializeSSETransport(res);
  }
  await initializeMCPServer(transport, res);
};

/**
 * Initialize the SSE transport for a new session.
 * @private
 * @param res
 * @returns
 */
const initializeSSETransport = async (res: express.Response) => {
  // New initialization request
  const transport = new SSEServerTransport("/messages", res);
  res.setHeader("mcp-session-id", transport.sessionId);
  // console.log("Creating new SSE transport for session ID:", transport.sessionId);
  transports.sse[transport.sessionId] = transport;

  res.on("close", () => {
    console.log("SSE connection closed for session ID:", transport.sessionId);
    delete transports.sse[transport.sessionId];
  });
  return transport;
};

/**
 * Initialize the transport for the MCP server.
 * @private
 * @returns
 */
const initializeStreamableTransport = async () => {
  let transport: StreamableHTTPServerTransport;
  // New initialization request
  const eventStore = new InMemoryEventStore();
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    eventStore, // Enable resumability
    onsessioninitialized: (sessionId) => {
      // Store the transport by session ID
      transports.streamable[sessionId] = transport;
    },
  });

  // Clean up transport when closed
  transport.onclose = () => {
    if (transport.sessionId) {
      delete transports.streamable[transport.sessionId];
    }
  };

  return transport;
};

/**
 * Initialize the MCP server with a transport.
 * @private
 * @param transport
 */
const initializeMCPServer = async (transport: StreamableHTTPServerTransport | SSEServerTransport, res: express.Response) => {
  try {
    // Close any existing transport before connecting a new one
    // (MCP SDK only allows one active connection per server)
    try {
      await mcpServer.close();
    } catch {
      // Server may not be connected yet; that's fine
    }
    // Connect to the MCP server
    await mcpServer.connect(transport);
  } catch (error) {
    console.error("Error initializing MCP server:", error);
    res.status(500).json({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Internal Server Error",
      },
      id: null,
    });
    throw error;
  }
};

async function initializeServers() {
  try {
    // すべてのトランスポートを閉じる
    for (const sessionId in transports.streamable) {
      const transport = transports.streamable[sessionId];
      if (transport) {
        await transport.close();
        console.log(`Transport closed for session ID: ${sessionId}`);
      }
    }
    for (const sessionId in transports.sse) {
      const transport = transports.sse[sessionId];
      if (transport) {
        await transport.close();
        console.log(`Transport closed for session ID: ${sessionId}`);
      }
    }
  } catch (error) {
    console.error(`Error closing transport:`, error);
  }
  await mcpServer.close();

  appServer?.close();
  app = express();
  app.init();
}

export async function stopServer() {
  console.log("Shutting down server...");
  initializeServers();

  console.log("Server shutdown complete");
  process.exit(0);
}

export async function restartServer() {
  console.log(styleText("cyanBright", "Restart MCP Server..."));
  initializeServers();
}

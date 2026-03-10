import { randomUUID } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import config from '../config.js';
import createMcpServer from '../server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequest, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { requestContext } from '../context.js';

/**
 * Extract the Brave API key from incoming request headers.
 *
 * Supports two header formats:
 *   - BRAVE_API_KEY: <key>   (custom header, used by Astralform templates)
 *   - Authorization: Bearer <key>
 *
 * Returns empty string if no key found (falls back to global config).
 */
const extractApiKey = (req: Request): string => {
  const headerKey = req.headers['brave_api_key'] as string | undefined;
  if (headerKey) return headerKey;

  const auth = req.headers['authorization'] as string | undefined;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);

  return '';
};

const runInContext = (braveApiKey: string, fn: () => Promise<void>): Promise<void> => {
  if (braveApiKey) {
    return requestContext.run({ braveApiKey }, fn);
  }
  return fn();
};

const withRequestContext = (req: Request, fn: () => Promise<void>): Promise<void> => {
  return runInContext(extractApiKey(req), fn);
};

const yieldGenericServerError = (res: Response) => {
  res.status(500).json({
    id: null,
    jsonrpc: '2.0',
    error: { code: -32603, message: 'Internal server error' },
  });
};

// --- Streamable HTTP transport ---

const transports = new Map<string, StreamableHTTPServerTransport>();

const isListToolsRequest = (value: unknown): value is ListToolsRequest =>
  ListToolsRequestSchema.safeParse(value).success;

const getTransport = async (request: Request): Promise<StreamableHTTPServerTransport> => {
  // Check for an existing session
  const sessionId = request.headers['mcp-session-id'] as string;

  if (sessionId && transports.has(sessionId)) {
    return transports.get(sessionId)!;
  }

  // We have a special case where we'll permit ListToolsRequest w/o a session ID
  if (!sessionId && isListToolsRequest(request.body)) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
    return transport;
  }

  let transport: StreamableHTTPServerTransport;

  if (config.stateless) {
    // Some contexts (e.g. AgentCore) may prefer or require a stateless transport
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
  } else {
    // Otherwise, start a new transport/session
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        transports.set(sessionId, transport);
      },
    });
  }

  const mcpServer = createMcpServer();
  await mcpServer.connect(transport);
  return transport;
};

// --- SSE transport ---

const sseTransports = new Map<string, SSEServerTransport>();
const sseApiKeys = new Map<string, string>();

const createApp = () => {
  const app = express();

  app.use(express.json());

  // --- Streamable HTTP endpoint (original) ---
  app.all('/mcp', async (req: Request, res: Response) => {
    await withRequestContext(req, async () => {
      try {
        const transport = await getTransport(req);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error(error);
        if (!res.headersSent) {
          yieldGenericServerError(res);
        }
      }
    });
  });

  // --- SSE endpoints (for langchain-mcp-adapters compatibility) ---

  // GET /sse — client connects here for the SSE event stream
  app.get('/sse', async (req: Request, res: Response) => {
    const braveApiKey = extractApiKey(req);
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;

    sseTransports.set(sessionId, transport);
    if (braveApiKey) {
      sseApiKeys.set(sessionId, braveApiKey);
    }

    const mcpServer = createMcpServer();

    res.on('close', () => {
      sseTransports.delete(sessionId);
      sseApiKeys.delete(sessionId);
      mcpServer.close().catch(() => {});
    });

    await runInContext(braveApiKey, async () => {
      await mcpServer.connect(transport);
    });
  });

  // POST /messages — client sends tool calls here
  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const transport = sseTransports.get(sessionId);

    if (!transport) {
      res.status(400).json({ error: 'Unknown session' });
      return;
    }

    const braveApiKey = extractApiKey(req) || sseApiKeys.get(sessionId) || '';

    await runInContext(braveApiKey, async () => {
      await transport.handlePostMessage(req, res, req.body);
    });
  });

  app.all('/ping', (req: Request, res: Response) => {
    res.status(200).json({ message: 'pong' });
  });

  return app;
};

const start = () => {
  if (!config.ready) {
    console.error('Invalid configuration');
    process.exit(1);
  }

  const app = createApp();

  app.listen(config.port, config.host, () => {
    console.log(`Server is running on http://${config.host}:${config.port}`);
    console.log(`  Streamable HTTP: /mcp`);
    console.log(`  SSE:             /sse + /messages`);
  });
};

export default { start, createApp };

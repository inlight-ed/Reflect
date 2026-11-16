/**
 * Minimal MCP client for remote servers (Streamable HTTP, with SSE fallback).
 * Used for RedStat (Kaspi market data) and for any server the seller connects.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { assertPublicUrl, pinnedFetch } from "./net";

export class McpError extends Error {
  constructor(public code: "UNSAFE_URL" | "UNAUTHORIZED" | "UNAVAILABLE" | "TOOL_FAILED" | "NO_SUCH_TOOL") {
    super(code);
  }
}

const TIMEOUT_MS = 25_000;

function headers(key: string | null | undefined): Record<string, string> {
  if (!key) return {};
  return /^(bearer|basic)\s/i.test(key) ? { Authorization: key } : { Authorization: `Bearer ${key}` };
}

async function withClient<T>(rawUrl: string, key: string | null | undefined, fn: (client: Client) => Promise<T>): Promise<T> {
  let url: URL;
  try {
    url = await assertPublicUrl(rawUrl);
  } catch {
    throw new McpError("UNSAFE_URL");
  }
  // pinnedFetch re-checks every resolved address at connect time and refuses redirects.
  const requestInit = { headers: headers(key), redirect: "error" as const };
  const attempt = async (transport: StreamableHTTPClientTransport | SSEClientTransport) => {
    const client = new Client({ name: "reflect", version: "0.14.0" });
    await client.connect(transport, { timeout: TIMEOUT_MS });
    try {
      return await fn(client);
    } finally {
      await client.close().catch(() => undefined);
    }
  };
  try {
    return await attempt(new StreamableHTTPClientTransport(url, { requestInit, fetch: pinnedFetch }));
  } catch (first) {
    if (first instanceof McpError) throw first;
    const message = first instanceof Error ? first.message : String(first);
    if (/401|403|unauthori/i.test(message)) throw new McpError("UNAUTHORIZED");
    try {
      return await attempt(new SSEClientTransport(url, { requestInit, fetch: pinnedFetch }));
    } catch (second) {
      if (second instanceof McpError) throw second;
      const secondMessage = second instanceof Error ? second.message : String(second);
      throw new McpError(/401|403|unauthori/i.test(secondMessage) ? "UNAUTHORIZED" : "UNAVAILABLE");
    }
  }
}

export async function listMcpTools(url: string, key: string | null | undefined) {
  return withClient(url, key, async (client) => {
    const result = await client.listTools(undefined, { timeout: TIMEOUT_MS });
    return result.tools.map((tool) => ({ name: tool.name, description: (tool.description ?? "").slice(0, 300) }));
  });
}

/** Calls a tool and returns its text content parsed as JSON when possible. */
export async function callMcpTool(url: string, key: string | null | undefined, name: string, args: Record<string, unknown>): Promise<unknown> {
  return withClient(url, key, async (client) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: TIMEOUT_MS });
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.filter((block): block is { type: "text"; text: string } => block?.type === "text").map((block) => block.text).join("");
    if (result.isError) throw new McpError(/unknown tool|not found/i.test(text) ? "NO_SUCH_TOOL" : "TOOL_FAILED");
    if (result.structuredContent) return result.structuredContent;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  });
}

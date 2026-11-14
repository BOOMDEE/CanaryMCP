import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { authenticate, getContext, listContext, toPublicContext, touchDevice } from "./db.js";
import { createBearerToken, constantTimeSecretMatch, sha256Base64Url } from "./security.js";
import { isContextCategory, validLabel, validateContextInput } from "./validation.js";
import { CONTEXT_CATEGORIES, type ContextCategory, type Env } from "./types.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, private",
  "x-content-type-options": "nosniff",
};
const MAX_PAIR_BODY = 4 * 1024;
const MAX_CONTEXT_BODY = 40 * 1024;
const RETENTION_DAYS = 7;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function methodNotAllowed(allow: string): Response {
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: { ...JSON_HEADERS, allow },
  });
}

async function readJsonBounded(request: Request, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new RangeError("body_too_large");
  if (!request.body) throw new SyntaxError("missing_body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new RangeError("body_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function pairDevice(request: Request, env: Env): Promise<Response> {
  if (!env.PAIRING_SECRET) return json({ error: "pairing_not_configured" }, 503);
  let input: unknown;
  try {
    input = await readJsonBounded(request, MAX_PAIR_BODY);
  } catch (error) {
    return json({ error: error instanceof RangeError ? "body_too_large" : "invalid_json" }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "invalid_request" }, 400);
  const body = input as Record<string, unknown>;
  if (typeof body.pairingSecret !== "string" || body.pairingSecret.length > 512) {
    return json({ error: "invalid_credentials" }, 401);
  }
  const secretMatches = await constantTimeSecretMatch(body.pairingSecret, env.PAIRING_SECRET);
  if (!secretMatches) return json({ error: "invalid_credentials" }, 401);
  const label = validLabel(body.label);
  if (!label) return json({ error: "invalid_label" }, 400);

  const deviceId = crypto.randomUUID();
  const deviceToken = createBearerToken();
  const mcpToken = createBearerToken();
  const [writeTokenHash, readTokenHash] = await Promise.all([
    sha256Base64Url(deviceToken),
    sha256Base64Url(mcpToken),
  ]);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO devices (id, label, write_token_hash, read_token_hash, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
  ).bind(deviceId, label, writeTokenHash, readTokenHash, now).run();
  return json({ deviceId, deviceToken, mcpToken, mcpUrl: "/mcp", expiresInDays: RETENTION_DAYS }, 201);
}

async function writeContext(request: Request, env: Env, deviceId: string): Promise<Response> {
  let input: unknown;
  try {
    input = await readJsonBounded(request, MAX_CONTEXT_BODY);
  } catch (error) {
    return json({ error: error instanceof RangeError ? "body_too_large" : "invalid_json" }, 400);
  }
  const validated = validateContextInput(input);
  if (!validated) return json({ error: "invalid_context" }, 400);
  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60_000).toISOString();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO context_latest (device_id, category, payload_json, captured_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(device_id, category) DO UPDATE SET
       payload_json = excluded.payload_json,
       captured_at = excluded.captured_at,
       expires_at = excluded.expires_at`,
  ).bind(deviceId, validated.category, JSON.stringify(validated.payload), validated.capturedAt, expiresAt).run();
  await touchDevice(env, deviceId);
  return json({ ok: true, category: validated.category, capturedAt: validated.capturedAt, expiresAt: expiresAt, storedAt: now }, 202);
}

async function handleMcp(request: Request, env: Env, device: { id: string; label: string }) {
  const server = new McpServer({ name: "CanaryMCP", version: "0.1.0" });
  server.tool(
    "read_device_context",
    "Read the latest context categories that this paired device owner explicitly enabled and manually synced. Each category contains at most one latest snapshot and expires after seven days. Never infer missing categories.",
    { category: z.enum(CONTEXT_CATEGORIES).optional() },
    async ({ category }: { category?: ContextCategory }) => {
      const records = category
        ? [await getContext(env, device.id, category)].filter((record) => record !== null)
        : await listContext(env, device.id);
      const snapshots = records.map(toPublicContext);
      return {
        content: [{ type: "text", text: JSON.stringify({ device: device.label, snapshots }) }],
        structuredContent: { device: device.label, snapshots },
      };
    },
  );
  server.tool(
    "get_device_status",
    "Return the paired device label and which context categories currently have a non-expired snapshot. Does not return the context values.",
    async () => {
      const records = await listContext(env, device.id);
      const status = {
        device: device.label,
        availableCategories: records.map((record) => record.category),
        expiresAt: Object.fromEntries(records.map((record) => [record.category, record.expires_at])),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(status) }],
        structuredContent: status,
      };
    },
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

async function fetchHandler(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
      return json({ ok: true, service: "canary-mcp" });
    } catch {
      return json({ error: "database_unavailable" }, 503);
    }
  }
  if (url.pathname === "/v1/pair") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    return pairDevice(request, env);
  }
  if (url.pathname === "/mcp") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const device = await authenticate(request, env, "read");
    if (!device) return json({ error: "unauthorized" }, 401);
    await touchDevice(env, device.id);
    return handleMcp(request, env, device);
  }
  if (url.pathname === "/v1/context" || url.pathname.startsWith("/v1/context/")) {
    if (!["GET", "POST", "DELETE"].includes(request.method)) return methodNotAllowed("GET, POST, DELETE");
    const scope = request.method === "GET" ? "read" : "write";
    const device = await authenticate(request, env, scope);
    if (!device) return json({ error: "unauthorized" }, 401);
    await touchDevice(env, device.id);
    if (url.pathname === "/v1/context" && request.method === "POST") {
      return writeContext(request, env, device.id);
    }
    if (url.pathname === "/v1/context" && request.method === "GET") {
      const records = await listContext(env, device.id);
      return json({ snapshots: records.map(toPublicContext) });
    }
    if (url.pathname === "/v1/context" && request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM context_latest WHERE device_id = ?1").bind(device.id).run();
      return json({ ok: true, deleted: true });
    }
    const categoryName = url.pathname.slice("/v1/context/".length);
    if (request.method === "DELETE" && isContextCategory(categoryName)) {
      await env.DB.prepare("DELETE FROM context_latest WHERE device_id = ?1 AND category = ?2")
        .bind(device.id, categoryName).run();
      return json({ ok: true, deleted: categoryName });
    }
    return methodNotAllowed("GET, POST, DELETE");
  }
  if (url.pathname === "/v1/device") {
    if (request.method !== "DELETE") return methodNotAllowed("DELETE");
    const device = await authenticate(request, env, "write");
    if (!device) return json({ error: "unauthorized" }, 401);
    await env.DB.prepare("DELETE FROM context_latest WHERE device_id = ?1").bind(device.id).run();
    await env.DB.prepare("DELETE FROM devices WHERE id = ?1").bind(device.id).run();
    return json({ ok: true, revoked: true });
  }
  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await fetchHandler(request, env);
    } catch {
      return json({ error: "internal_error" }, 500);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil(
      env.DB.prepare("DELETE FROM context_latest WHERE expires_at <= ?1")
        .bind(new Date().toISOString()).run(),
    );
  },
};

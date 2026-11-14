import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { authenticate, getContext, getWebhook, listContext, listWebhookDeliveries, toPublicContext, touchDevice } from "./db.js";
import { createBearerToken, constantTimeSecretMatch, decryptWebhookConfig, encryptWebhookConfig, sha256Base64Url, signWebhookBody } from "./security.js";
import { isContextCategory, validLabel, validateContextInput, validateWebhookConfiguration, validateWebhookMessage } from "./validation.js";
import { CONTEXT_CATEGORIES, type ContextCategory, type Env } from "./types.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, private",
  "x-content-type-options": "nosniff",
};
const MAX_PAIR_BODY = 4 * 1024;
const MAX_CONTEXT_BODY = 40 * 1024;
const MAX_WEBHOOK_CONFIG_BODY = 8 * 1024;
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
  if (!env.PAIRING_SECRET || env.PAIRING_SECRET.length < 32) return json({ error: "pairing_not_configured" }, 503);
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

async function configureWebhook(request: Request, env: Env, deviceId: string): Promise<Response> {
  if (!env.WEBHOOK_ENCRYPTION_KEY) return json({ error: "webhook_not_configured" }, 503);
  let input: unknown;
  try {
    input = await readJsonBounded(request, MAX_WEBHOOK_CONFIG_BODY);
  } catch (error) {
    return json({ error: error instanceof RangeError ? "body_too_large" : "invalid_json" }, 400);
  }
  const config = validateWebhookConfiguration(input);
  if (!config) return json({ error: "invalid_webhook_config" }, 400);
  const encrypted = await encryptWebhookConfig(JSON.stringify(config), env.WEBHOOK_ENCRYPTION_KEY, deviceId);
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO device_webhooks (device_id, encrypted_config, enabled, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(device_id) DO UPDATE SET
       encrypted_config = excluded.encrypted_config,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
  ).bind(deviceId, encrypted, config.enabled ? 1 : 0, updatedAt).run();
  return json({ ok: true, configured: true, enabled: config.enabled, updatedAt }, 200);
}

async function webhookStatus(env: Env, deviceId: string): Promise<Response> {
  const row = await getWebhook(env, deviceId);
  return json({
    configured: row !== null,
    enabled: row?.enabled === 1,
    updatedAt: row?.updated_at ?? null,
  });
}

async function deleteWebhook(env: Env, deviceId: string): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM device_webhooks WHERE device_id = ?1").bind(deviceId),
    env.DB.prepare("DELETE FROM webhook_deliveries WHERE device_id = ?1").bind(deviceId),
    env.DB.prepare("DELETE FROM webhook_rate_limits WHERE device_id = ?1").bind(deviceId),
  ]);
  return json({ ok: true, deleted: true });
}

async function reserveWebhookLimit(env: Env, deviceId: string): Promise<boolean> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const minuteStart = Math.floor(nowSeconds / 60) * 60;
  const hourStart = Math.floor(nowSeconds / 3600) * 3600;
  const reserved = await env.DB.prepare(
    `WITH current_counts AS (
       SELECT
         COALESCE((SELECT request_count FROM webhook_rate_limits WHERE device_id = ?1 AND window_seconds = 60 AND bucket_start = ?2), 0) AS minute_count,
         COALESCE((SELECT request_count FROM webhook_rate_limits WHERE device_id = ?1 AND window_seconds = 3600 AND bucket_start = ?3), 0) AS hour_count
     ), allowed AS (
       SELECT minute_count < 5 AND hour_count < 20 AS can_send FROM current_counts
     )
     INSERT INTO webhook_rate_limits (device_id, window_seconds, bucket_start, request_count)
     SELECT ?1, 60, ?2, 1 FROM allowed WHERE can_send
     UNION ALL
     SELECT ?1, 3600, ?3, 1 FROM allowed WHERE can_send
     ON CONFLICT(device_id, window_seconds, bucket_start) DO UPDATE SET
       request_count = request_count + 1
     WHERE request_count < CASE window_seconds WHEN 60 THEN 5 ELSE 20 END
     RETURNING window_seconds, request_count`,
  ).bind(deviceId, minuteStart, hourStart).all<{ window_seconds: number; request_count: number }>();
  return reserved.results.length === 2;
}

function webhookToolResult(text: string, structuredContent: Record<string, unknown>, isError = false) {
  return { content: [{ type: "text" as const, text }], structuredContent, isError };
}

async function sendConfiguredWebhook(
  env: Env,
  device: { id: string; label: string },
  messageInput: unknown,
) {
  const message = validateWebhookMessage(messageInput);
  if (!message) return webhookToolResult("Invalid message: provide only a short title and plain-text message.", { delivered: false }, true);
  const row = await getWebhook(env, device.id);
  if (!row || row.enabled !== 1) {
    return webhookToolResult("Webhook sending is not enabled by the paired device owner.", { delivered: false, enabled: false }, true);
  }
  if (!env.WEBHOOK_ENCRYPTION_KEY) {
    return webhookToolResult("Webhook delivery is unavailable because server encryption is not configured.", { delivered: false }, true);
  }
  let config: ReturnType<typeof validateWebhookConfiguration>;
  try {
    config = validateWebhookConfiguration(JSON.parse(await decryptWebhookConfig(row.encrypted_config, env.WEBHOOK_ENCRYPTION_KEY, device.id)));
  } catch {
    config = null;
  }
  if (!config?.enabled) {
    return webhookToolResult("Webhook configuration is unavailable; update it in the paired Android app.", { delivered: false }, true);
  }
  if (!(await reserveWebhookLimit(env, device.id))) {
    return webhookToolResult("Webhook rate limit reached (maximum 5 per minute and 20 per hour per device).", { delivered: false, rateLimited: true }, true);
  }

  const deliveryId = crypto.randomUUID();
  const sentAt = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO webhook_deliveries (id, device_id, created_at, status_code, success) VALUES (?1, ?2, ?3, 0, 0)",
  ).bind(deliveryId, device.id, sentAt).run();

  const body = JSON.stringify({
    event: "canarymcp.message",
    deliveryId,
    sentAt,
    message,
  });
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-canarymcp-event": "message",
  });
  if (config.signingSecret) headers.set("x-canarymcp-signature", await signWebhookBody(body, config.signingSecret));

  let statusCode = 0;
  let delivered = false;
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    statusCode = response.status;
    delivered = statusCode >= 200 && statusCode < 300;
    try { await response.body?.cancel(); } catch { /* discard upstream response bodies */ }
  } catch {
    statusCode = 0;
    delivered = false;
  }
  await env.DB.prepare(
    "UPDATE webhook_deliveries SET status_code = ?1, success = ?2 WHERE id = ?3 AND device_id = ?4",
  ).bind(statusCode, delivered ? 1 : 0, deliveryId, device.id).run();
  const result = { deliveryId, delivered, httpStatus: statusCode || null, sentAt };
  const text = delivered
    ? `Webhook delivered (HTTP ${statusCode}).`
    : statusCode === 0
      ? "Webhook delivery failed or timed out; the destination URL and response body were not exposed."
      : `Webhook destination returned HTTP ${statusCode}; redirects are not followed.`;
  return webhookToolResult(text, result, !delivered);
}

async function handleMcp(request: Request, env: Env, device: { id: string; label: string }) {
  const server = new McpServer({ name: "CanaryMCP", version: "0.2.1" });
  server.tool(
    "read_device_context",
    "Read one context category that this paired device owner explicitly enabled and manually synced. Each category contains at most one latest snapshot and expires after seven days. Choose only the category needed; never infer missing categories.",
    { category: z.enum(CONTEXT_CATEGORIES) },
    async ({ category }: { category: ContextCategory }) => {
      const record = await getContext(env, device.id, category);
      const snapshot = record ? toPublicContext(record) : null;
      const snapshots = snapshot ? [snapshot] : [];
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
      const records = (await listContext(env, device.id)).filter((record) => toPublicContext(record) !== null);
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
  server.registerTool(
    "get_webhook_status",
    { description: "Return only whether the paired device owner configured and enabled a webhook. Never returns its URL or signing secret." },
    async () => {
      const row = await getWebhook(env, device.id);
      const status = { configured: row !== null, enabled: row?.enabled === 1, updatedAt: row?.updated_at ?? null };
      return { content: [{ type: "text", text: JSON.stringify(status) }], structuredContent: status };
    },
  );
  server.registerTool(
    "send_webhook_message",
    {
      title: "Send a user-approved webhook message",
      description: "Send a short plain-text title and message to the single HTTPS webhook destination explicitly configured and enabled in the paired Android app. Call only when the user has explicitly asked you to send this message. Never call proactively, never choose or accept a destination URL, and never include device context, credentials, or unrelated personal data.",
      inputSchema: z.object({
        title: z.string().trim().min(1).max(120).refine((value) => new TextEncoder().encode(value).byteLength <= 240 && !/[\u0000-\u001f\u007f]/u.test(value)),
        message: z.string().trim().min(1).max(1600).refine((value) => new TextEncoder().encode(value).byteLength <= 3000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ title, message }: { title: string; message: string }) => sendConfiguredWebhook(env, device, { title, message }),
  );
  server.registerTool(
    "get_webhook_delivery_history",
    { description: "Return the latest ten webhook delivery timestamps and HTTP outcomes for this paired device. Message bodies and destination details are never stored or returned." },
    async () => {
      const records = await listWebhookDeliveries(env, device.id);
      const deliveries = records.map((record) => ({
        id: record.id,
        sentAt: record.created_at,
        delivered: record.success === 1,
        httpStatus: record.status_code || null,
      }));
      return { content: [{ type: "text", text: JSON.stringify({ deliveries }) }], structuredContent: { deliveries } };
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
  if (url.pathname === "/v1/webhook") {
    if (!["GET", "PUT", "DELETE"].includes(request.method)) return methodNotAllowed("GET, PUT, DELETE");
    const scope = request.method === "GET" ? "read" : "write";
    const device = await authenticate(request, env, scope);
    if (!device) return json({ error: "unauthorized" }, 401);
    await touchDevice(env, device.id);
    if (request.method === "GET") return webhookStatus(env, device.id);
    if (request.method === "PUT") return configureWebhook(request, env, device.id);
    return deleteWebhook(env, device.id);
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
      const snapshots = records.flatMap((record) => {
        const snapshot = toPublicContext(record);
        return snapshot ? [snapshot] : [];
      });
      return json({ snapshots });
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
      Promise.all([
        env.DB.prepare("DELETE FROM context_latest WHERE expires_at <= ?1")
          .bind(new Date().toISOString()).run(),
        env.DB.prepare("DELETE FROM webhook_deliveries WHERE created_at <= ?1")
          .bind(new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString()).run(),
        env.DB.prepare("DELETE FROM webhook_rate_limits WHERE bucket_start <= ?1")
          .bind(Math.floor(Date.now() / 1000) - 24 * 60 * 60).run(),
      ]),
    );
  },
};

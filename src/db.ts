import type { ContextRecord, DeviceRecord, Env, WebhookRecord } from "./types.js";
import { sha256Base64Url } from "./security.js";
import { validateContextInput } from "./validation.js";

export async function authenticate(request: Request, env: Env, scope: "read" | "write"): Promise<DeviceRecord | null> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+([A-Za-z0-9_-]{32,128})$/u);
  if (!match) return null;
  const tokenHash = await sha256Base64Url(match[1]!);
  const tokenColumn = scope === "read" ? "read_token_hash" : "write_token_hash";
  return env.DB.prepare(
    `SELECT id, label, created_at, last_seen_at FROM devices WHERE ${tokenColumn} = ?1`,
  ).bind(tokenHash).first<DeviceRecord>();
}

export async function listContext(env: Env, deviceId: string): Promise<ContextRecord[]> {
  const result = await env.DB.prepare(
    "SELECT category, payload_json, captured_at, expires_at FROM context_latest WHERE device_id = ?1 AND expires_at > ?2 ORDER BY category",
  ).bind(deviceId, new Date().toISOString()).all<ContextRecord>();
  return result.results;
}

export async function getContext(
  env: Env,
  deviceId: string,
  category: ContextRecord["category"],
): Promise<ContextRecord | null> {
  return env.DB.prepare(
    "SELECT category, payload_json, captured_at, expires_at FROM context_latest WHERE device_id = ?1 AND category = ?2 AND expires_at > ?3",
  ).bind(deviceId, category, new Date().toISOString()).first<ContextRecord>();
}

export async function touchDevice(env: Env, deviceId: string): Promise<void> {
  await env.DB.prepare("UPDATE devices SET last_seen_at = ?1 WHERE id = ?2")
    .bind(new Date().toISOString(), deviceId).run();
}

export async function getWebhook(env: Env, deviceId: string): Promise<WebhookRecord | null> {
  return env.DB.prepare(
    "SELECT encrypted_config, enabled, updated_at FROM device_webhooks WHERE device_id = ?1",
  ).bind(deviceId).first<WebhookRecord>();
}

export async function listWebhookDeliveries(env: Env, deviceId: string): Promise<Array<{
  id: string;
  created_at: string;
  status_code: number;
  success: number;
}>> {
  const result = await env.DB.prepare(
    "SELECT id, created_at, status_code, success FROM webhook_deliveries WHERE device_id = ?1 ORDER BY created_at DESC LIMIT 10",
  ).bind(deviceId).all();
  return result.results as Array<{ id: string; created_at: string; status_code: number; success: number }>;
}

export function toPublicContext(record: ContextRecord): {
  category: string;
  capturedAt: string;
  expiresAt: string;
  payload: Record<string, unknown>;
} | null {
  let payload: unknown;
  try {
    payload = JSON.parse(record.payload_json);
  } catch {
    return null;
  }
  const validated = validateContextInput({
    category: record.category,
    capturedAt: record.captured_at,
    payload,
  });
  if (!validated) return null;
  return {
    category: record.category,
    capturedAt: record.captured_at,
    expiresAt: record.expires_at,
    payload: validated.payload,
  };
}

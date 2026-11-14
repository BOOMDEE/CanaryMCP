import { CONTEXT_CATEGORIES, type ContextCategory } from "./types.js";

export const MAX_PAYLOAD_BYTES = 32 * 1024;
export const MAX_WEBHOOK_CONFIG_BYTES = 8 * 1024;
const MAX_CAPTURE_AGE_MS = 7 * 24 * 60 * 60_000;

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function validAccessibilityNode(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as Record<string, unknown>;
  if (!hasOnlyKeys(node, ["className", "clickable", "enabled", "bounds", "text", "description"])) return false;
  if (!(node.className === null || isBoundedString(node.className, 100))) return false;
  if (typeof node.clickable !== "boolean" || typeof node.enabled !== "boolean") return false;
  if (!node.bounds || typeof node.bounds !== "object" || Array.isArray(node.bounds)) return false;
  const bounds = node.bounds as Record<string, unknown>;
  if (!hasOnlyKeys(bounds, ["left", "top", "right", "bottom"])) return false;
  if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every((coordinate) =>
    Number.isInteger(coordinate) && Number(coordinate) >= -1_000_000 && Number(coordinate) <= 1_000_000,
  )) return false;
  if (node.text !== undefined && !isBoundedString(node.text, 160)) return false;
  if (node.description !== undefined && !isBoundedString(node.description, 160)) return false;
  return true;
}

function validCategoryPayload(category: ContextCategory, payload: Record<string, unknown>): boolean {
  if (category === "device") {
    return hasOnlyKeys(payload, ["manufacturer", "model", "androidVersion", "sdkInt", "appVersion", "locale", "timeZone", "capturedAt"]) &&
      typeof payload.manufacturer === "string" && payload.manufacturer.length <= 100 &&
      typeof payload.model === "string" && payload.model.length <= 100 &&
      typeof payload.androidVersion === "string" && payload.androidVersion.length <= 30 &&
      Number.isInteger(payload.sdkInt) && Number(payload.sdkInt) >= 26 && Number(payload.sdkInt) <= 100 &&
      typeof payload.appVersion === "string" && payload.appVersion.length <= 40 &&
      typeof payload.locale === "string" && payload.locale.length <= 40 &&
      typeof payload.timeZone === "string" && payload.timeZone.length <= 100 &&
      typeof payload.capturedAt === "string" && Number.isFinite(Date.parse(payload.capturedAt));
  }
  if (category === "network") {
    return hasOnlyKeys(payload, ["transport", "internetAvailable", "validated", "metered", "capturedAt"]) &&
      ["wifi", "cellular", "ethernet", "none", "other"].includes(String(payload.transport)) &&
      typeof payload.internetAvailable === "boolean" &&
      typeof payload.validated === "boolean" &&
      typeof payload.metered === "boolean" &&
      typeof payload.capturedAt === "string" && Number.isFinite(Date.parse(payload.capturedAt));
  }
  if (category === "storage") {
    const totalBytes = payload.totalBytes;
    const availableBytes = payload.availableBytes;
    return hasOnlyKeys(payload, ["totalBytes", "availableBytes", "lowStorage", "capturedAt"]) &&
      Number.isSafeInteger(totalBytes) && Number(totalBytes) > 0 &&
      Number.isSafeInteger(availableBytes) && Number(availableBytes) >= 0 && Number(availableBytes) <= Number(totalBytes) &&
      typeof payload.lowStorage === "boolean" &&
      typeof payload.capturedAt === "string" && Number.isFinite(Date.parse(payload.capturedAt));
  }
  if (category === "battery") {
    const percent = payload.percent;
    return hasOnlyKeys(payload, ["percent", "charging", "status", "capturedAt"]) &&
      (percent === null || (Number.isInteger(percent) && Number(percent) >= 0 && Number(percent) <= 100)) &&
      typeof payload.charging === "boolean" &&
      ["charging", "discharging", "full", "not_charging", "unknown"].includes(String(payload.status)) &&
      isTimestamp(payload.capturedAt);
  }
  if (category === "location") {
    return hasOnlyKeys(payload, ["latitude", "longitude", "accuracyMeters", "precision", "provider", "sourceTimestamp", "capturedAt"]) &&
      typeof payload.latitude === "number" && Number.isFinite(payload.latitude) && payload.latitude >= -90 && payload.latitude <= 90 &&
      typeof payload.longitude === "number" && Number.isFinite(payload.longitude) && payload.longitude >= -180 && payload.longitude <= 180 &&
      typeof payload.accuracyMeters === "number" && Number.isFinite(payload.accuracyMeters) && payload.accuracyMeters >= 0 && payload.accuracyMeters <= 1_000_000 &&
      ["precise", "approximate"].includes(String(payload.precision)) &&
      isBoundedString(payload.provider, 50) && isTimestamp(payload.sourceTimestamp) && isTimestamp(payload.capturedAt);
  }
  if (category === "usage") {
    return hasOnlyKeys(payload, ["windowHours", "apps", "capturedAt"]) && payload.windowHours === 24 &&
      Array.isArray(payload.apps) && payload.apps.length <= 15 && payload.apps.every((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
        const app = entry as Record<string, unknown>;
        return hasOnlyKeys(app, ["packageName", "foregroundMs", "lastUsedAt"]) &&
          isBoundedString(app.packageName, 255) &&
          Number.isSafeInteger(app.foregroundMs) && Number(app.foregroundMs) >= 0 &&
          isTimestamp(app.lastUsedAt);
      }) && isTimestamp(payload.capturedAt);
  }
  if (category === "accessibility") {
    return hasOnlyKeys(payload, ["packageName", "capturedAt", "nodes", "truncated"]) &&
      isBoundedString(payload.packageName, 200) && isTimestamp(payload.capturedAt) &&
      Array.isArray(payload.nodes) && payload.nodes.length <= 100 && payload.nodes.every(validAccessibilityNode) &&
      typeof payload.truncated === "boolean";
  }
  return false;
}

export function isContextCategory(value: unknown): value is ContextCategory {
  return typeof value === "string" && (CONTEXT_CATEGORIES as readonly string[]).includes(value);
}

export function validateContextInput(value: unknown): {
  category: ContextCategory;
  capturedAt: string;
  payload: Record<string, unknown>;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!hasOnlyKeys(input, ["category", "capturedAt", "payload"])) return null;
  if (!isContextCategory(input.category)) return null;
  if (typeof input.capturedAt !== "string") return null;
  const timestamp = Date.parse(input.capturedAt);
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 5 * 60_000 || Date.now() - timestamp > MAX_CAPTURE_AGE_MS) return null;
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) return null;
  if (!validCategoryPayload(input.category, input.payload as Record<string, unknown>)) return null;
  const serialized = JSON.stringify(input.payload);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD_BYTES) return null;
  return {
    category: input.category,
    capturedAt: new Date(timestamp).toISOString(),
    payload: input.payload as Record<string, unknown>,
  };
}

export function validateWebhookConfiguration(value: unknown): {
  url: string;
  signingSecret: string;
  enabled: boolean;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!hasOnlyKeys(input, ["url", "signingSecret", "enabled"])) return null;
  if (typeof input.url !== "string" || input.url.length > 2048 || input.url !== input.url.trim()) return null;
  if (typeof input.enabled !== "boolean") return null;
  const signingSecret = input.signingSecret ?? "";
  if (typeof signingSecret !== "string" || signingSecret.length > 512 || (signingSecret.length > 0 && signingSecret.length < 32) || /[\u0000-\u001f\u007f]/u.test(signingSecret)) return null;
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  const validDnsName = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(hostname);
  const blockedSuffixes = [".localhost", ".local", ".internal", ".test", ".invalid", ".example", ".onion"];
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.port !== "" && parsed.port !== "443") ||
    parsed.hash !== "" ||
    !validDnsName ||
    blockedSuffixes.some((suffix) => hostname.endsWith(suffix)) ||
    hostname === "home.arpa"
  ) return null;
  return { url: parsed.toString(), signingSecret, enabled: input.enabled };
}

export function validateWebhookMessage(value: unknown): { title: string; message: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!hasOnlyKeys(input, ["title", "message"]) || typeof input.title !== "string" || typeof input.message !== "string") return null;
  const title = input.title.trim();
  const message = input.message.trim();
  if (title.length === 0 || title.length > 120 || message.length === 0 || message.length > 1600) return null;
  if (/[\u0000-\u001f\u007f]/u.test(title) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(message)) return null;
  const encoder = new TextEncoder();
  if (encoder.encode(title).byteLength > 240 || encoder.encode(message).byteLength > 3000) return null;
  return { title, message };
}

export function validLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 80);
  return normalized.length > 0 ? normalized : null;
}

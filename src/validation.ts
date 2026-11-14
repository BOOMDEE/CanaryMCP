import { CONTEXT_CATEGORIES, type ContextCategory } from "./types.js";

export const MAX_PAYLOAD_BYTES = 32 * 1024;

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
  if (!isContextCategory(input.category)) return null;
  if (typeof input.capturedAt !== "string") return null;
  const timestamp = Date.parse(input.capturedAt);
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 5 * 60_000) return null;
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) return null;
  const serialized = JSON.stringify(input.payload);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD_BYTES) return null;
  return {
    category: input.category,
    capturedAt: new Date(timestamp).toISOString(),
    payload: input.payload as Record<string, unknown>,
  };
}

export function validLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 80);
  return normalized.length > 0 ? normalized : null;
}

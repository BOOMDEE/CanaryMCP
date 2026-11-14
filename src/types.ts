export const CONTEXT_CATEGORIES = [
  "location",
  "battery",
  "usage",
  "accessibility",
] as const;

export type ContextCategory = (typeof CONTEXT_CATEGORIES)[number];

export interface Env {
  DB: D1Database;
  PAIRING_SECRET: string;
}

export interface DeviceRecord {
  id: string;
  label: string;
  created_at: string;
  last_seen_at: string;
}

export interface ContextRecord {
  category: ContextCategory;
  payload_json: string;
  captured_at: string;
  expires_at: string;
}

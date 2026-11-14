import { describe, expect, it } from "vitest";
import { toPublicContext } from "./db.js";
import type { ContextRecord } from "./types.js";

function record(payload: unknown, capturedAt = new Date().toISOString()): ContextRecord {
  return {
    category: "battery",
    payload_json: JSON.stringify(payload),
    captured_at: capturedAt,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe("public context serialization", () => {
  it("returns a valid, schema-checked snapshot", () => {
    const capturedAt = new Date().toISOString();
    expect(toPublicContext(record({
      percent: 80,
      charging: true,
      status: "charging",
      capturedAt,
    }))).toEqual({
      category: "battery",
      capturedAt: expect.any(String),
      expiresAt: expect.any(String),
      payload: { percent: 80, charging: true, status: "charging", capturedAt },
    });
  });

  it("fails closed for legacy extra fields, stale payloads, and malformed JSON", () => {
    const capturedAt = new Date().toISOString();
    expect(toPublicContext(record({
      percent: 80,
      charging: true,
      status: "charging",
      capturedAt,
      privateIdentifier: "must-not-leak",
    }))).toBeNull();

    const stale = new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString();
    expect(toPublicContext(record({
      percent: 80,
      charging: true,
      status: "charging",
      capturedAt: stale,
    }, stale))).toBeNull();
    expect(toPublicContext({ ...record({}), payload_json: "{" })).toBeNull();
  });
});

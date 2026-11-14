import { describe, expect, it } from "vitest";
import { constantTimeSecretMatch, createBearerToken, sha256Base64Url } from "./security.js";
import { validLabel, validateContextInput } from "./validation.js";

describe("context validation", () => {
  it("accepts only the supported categories and bounded object payloads", () => {
    expect(validateContextInput({
      category: "battery",
      capturedAt: new Date().toISOString(),
      payload: { percent: 50, charging: false },
    })?.category).toBe("battery");
    expect(validateContextInput({ category: "contacts", capturedAt: new Date().toISOString(), payload: {} })).toBeNull();
    expect(validateContextInput({ category: "location", capturedAt: new Date().toISOString(), payload: [] })).toBeNull();
  });

  it("rejects invalid, future and oversized inputs", () => {
    expect(validateContextInput({ category: "usage", capturedAt: "not a date", payload: {} })).toBeNull();
    expect(validateContextInput({ category: "usage", capturedAt: new Date(Date.now() + 10 * 60_000).toISOString(), payload: {} })).toBeNull();
    expect(validateContextInput({ category: "usage", capturedAt: new Date().toISOString(), payload: { value: "x".repeat(33_000) } })).toBeNull();
  });

  it("normalizes labels and rejects blank names", () => {
    expect(validLabel("  My phone\n")).toBe("My phone");
    expect(validLabel(" \n ")).toBeNull();
  });
});

describe("bearer token helpers", () => {
  it("creates high-entropy URL-safe tokens and hashes them", async () => {
    const first = createBearerToken();
    const second = createBearerToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second).not.toBe(first);
    expect(await sha256Base64Url(first)).not.toBe(first);
  });

  it("compares pairing secrets without exposing the stored value", async () => {
    expect(await constantTimeSecretMatch("same-secret", "same-secret")).toBe(true);
    expect(await constantTimeSecretMatch("wrong-secret", "same-secret")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { constantTimeSecretMatch, createBearerToken, decryptWebhookConfig, encryptWebhookConfig, sha256Base64Url, signWebhookBody } from "./security.js";
import { validLabel, validateContextInput, validateWebhookConfiguration, validateWebhookMessage } from "./validation.js";

describe("context validation", () => {
  it("accepts the supported bounded categories and rejects unknown categories", () => {
    const capturedAt = new Date().toISOString();
    const validExistingCategories = [
      { category: "battery", payload: { percent: 80, charging: true, status: "charging", capturedAt } },
      { category: "location", payload: { latitude: 30.25, longitude: 120.16, accuracyMeters: 100, precision: "approximate", provider: "approximate", sourceTimestamp: capturedAt, capturedAt } },
      { category: "usage", payload: { windowHours: 24, apps: [{ packageName: "com.example.app", foregroundMs: 42_000, lastUsedAt: capturedAt }], capturedAt } },
      { category: "accessibility", payload: { packageName: "com.example.app", capturedAt, nodes: [{ className: "android.widget.TextView", clickable: false, enabled: true, bounds: { left: 0, top: 0, right: 100, bottom: 50 }, text: "Hello" }], truncated: false } },
    ];
    for (const item of validExistingCategories) {
      expect(validateContextInput({ ...item, capturedAt })?.category).toBe(item.category);
    }
    const validNewCategories = [
      { category: "device", payload: { manufacturer: "Example", model: "Phone", androidVersion: "16", sdkInt: 35, appVersion: "0.2.0", locale: "zh-CN", timeZone: "Asia/Shanghai", capturedAt } },
      { category: "network", payload: { transport: "wifi", internetAvailable: true, validated: true, metered: false, capturedAt } },
      { category: "storage", payload: { totalBytes: 1_000_000, availableBytes: 500_000, lowStorage: false, capturedAt } },
    ];
    for (const item of validNewCategories) {
      expect(validateContextInput({ ...item, capturedAt })?.category).toBe(item.category);
    }
    expect(validateContextInput({ category: "contacts", capturedAt: new Date().toISOString(), payload: {} })).toBeNull();
    expect(validateContextInput({ category: "location", capturedAt: new Date().toISOString(), payload: [] })).toBeNull();
  });

  it("rejects invalid, future and oversized inputs", () => {
    expect(validateContextInput({ category: "usage", capturedAt: "not a date", payload: {} })).toBeNull();
    expect(validateContextInput({ category: "usage", capturedAt: new Date(Date.now() + 10 * 60_000).toISOString(), payload: {} })).toBeNull();
    expect(validateContextInput({ category: "usage", capturedAt: new Date().toISOString(), payload: { value: "x".repeat(33_000) } })).toBeNull();
    expect(validateContextInput({ category: "device", capturedAt: new Date().toISOString(), payload: { model: "x", privateId: "not allowed" } })).toBeNull();
    expect(validateContextInput({ category: "network", capturedAt: new Date().toISOString(), payload: { transport: "wifi", internetAvailable: true, validated: true, metered: false, capturedAt: new Date().toISOString(), ssid: "private" } })).toBeNull();
    expect(validateContextInput({ category: "storage", capturedAt: new Date().toISOString(), payload: { totalBytes: 100, availableBytes: 101, lowStorage: false, capturedAt: new Date().toISOString() } })).toBeNull();
    expect(validateContextInput({ category: "battery", capturedAt: new Date().toISOString(), payload: { percent: 80, charging: true, status: "charging", capturedAt: new Date().toISOString(), serialNumber: "private" } })).toBeNull();
    expect(validateContextInput({ category: "usage", capturedAt: new Date().toISOString(), payload: { windowHours: 24, apps: Array(16).fill({ packageName: "com.example.app", foregroundMs: 1, lastUsedAt: new Date().toISOString() }), capturedAt: new Date().toISOString() } })).toBeNull();
    expect(validateContextInput({ category: "accessibility", capturedAt: new Date().toISOString(), payload: { packageName: "com.example.app", capturedAt: new Date().toISOString(), nodes: [{ className: "TextView", clickable: false, enabled: true, bounds: { left: 0, top: 0, right: 1, bottom: 1 }, text: "ok", extra: "not allowed" }], truncated: false } })).toBeNull();
    expect(validateContextInput({ category: "battery", capturedAt: new Date().toISOString(), payload: { percent: 80, charging: true, status: "charging", capturedAt: new Date().toISOString() }, customMetadata: true })).toBeNull();
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

describe("webhook destination validation", () => {
  it("accepts HTTPS webhook URLs and optional signing secrets", () => {
    expect(validateWebhookConfiguration({
      url: "https://hooks.example.net/services/abc?token=private",
      signingSecret: "s".repeat(32),
      enabled: true,
    })).toEqual({
      url: "https://hooks.example.net/services/abc?token=private",
      signingSecret: "s".repeat(32),
      enabled: true,
    });
  });

  it.each([
    "http://hooks.example.net/endpoint",
    "https://localhost/endpoint",
    "https://127.0.0.1/endpoint",
    "https://[::1]/endpoint",
    "https://service.internal/endpoint",
    "https://hooks.example.net:8443/endpoint",
    "https://user:password@hooks.example.net/endpoint",
    "https://hooks.example.net/endpoint#fragment",
  ])("rejects unsafe destination %s", (url) => {
    expect(validateWebhookConfiguration({ url, signingSecret: "", enabled: true })).toBeNull();
  });

  it("rejects missing opt-in, invalid secret values, and oversized URLs", () => {
    expect(validateWebhookConfiguration({ url: "https://hooks.example.net/x", signingSecret: "", enabled: "yes" })).toBeNull();
    expect(validateWebhookConfiguration({ url: "https://hooks.example.net/x", signingSecret: "bad\nsecret", enabled: false })).toBeNull();
    expect(validateWebhookConfiguration({ url: "https://hooks.example.net/x", signingSecret: "short", enabled: false })).toBeNull();
    expect(validateWebhookConfiguration({ url: `https://hooks.example.net/${"x".repeat(2100)}`, signingSecret: "", enabled: true })).toBeNull();
  });
});

describe("webhook message validation", () => {
  it("accepts bounded plain text but rejects extra fields and control characters", () => {
    expect(validateWebhookMessage({ title: "  Hello  ", message: "Line one\nLine two" })).toEqual({ title: "Hello", message: "Line one\nLine two" });
    expect(validateWebhookMessage({ title: "Hello", message: "Body", context: { battery: 80 } })).toBeNull();
    expect(validateWebhookMessage({ title: "Hello\nInjected", message: "Body" })).toBeNull();
    expect(validateWebhookMessage({ title: "Hello", message: "x".repeat(1601) })).toBeNull();
  });
});

describe("webhook cryptography helpers", () => {
  it("encrypts webhook configuration and signs an exact payload", async () => {
    const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const config = JSON.stringify({ url: "https://hooks.example.net/secret", signingSecret: "private" });
    const ciphertext = await encryptWebhookConfig(config, key, "device-a");
    expect(ciphertext).not.toContain("hooks.example.net");
    expect(await decryptWebhookConfig(ciphertext, key, "device-a")).toBe(config);
    await expect(decryptWebhookConfig(ciphertext, key, "device-b")).rejects.toThrow();
    await expect(decryptWebhookConfig(ciphertext, "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "device-a")).rejects.toThrow();
    expect(await signWebhookBody("payload", "secret")).toMatch(/^sha256=[a-f0-9]{64}$/u);
  });
});

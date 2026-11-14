const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function webhookCryptoKey(keyText: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = fromBase64Url(keyText);
  if (raw.length !== 32) throw new Error("invalid_webhook_encryption_key");
  const stableBuffer = Uint8Array.from(raw).buffer as ArrayBuffer;
  return crypto.subtle.importKey("raw", stableBuffer, { name: "AES-GCM" }, false, usage);
}

export function createBearerToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64Url(bytes);
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
}

export async function constantTimeSecretMatch(input: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(input)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}

export async function encryptWebhookConfig(value: string, keyText: string, deviceId: string): Promise<string> {
  const key = await webhookCryptoKey(keyText, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = encoder.encode(`canarymcp:webhook:v1:${deviceId}`);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, encoder.encode(value));
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return `v1.${toBase64Url(combined)}`;
}

export async function decryptWebhookConfig(value: string, keyText: string, deviceId: string): Promise<string> {
  if (!value.startsWith("v1.")) throw new Error("unsupported_webhook_ciphertext_version");
  const combined = fromBase64Url(value.slice(3));
  if (combined.length < 29) throw new Error("invalid_webhook_ciphertext");
  const key = await webhookCryptoKey(keyText, ["decrypt"]);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const additionalData = encoder.encode(`canarymcp:webhook:v1:${deviceId}`);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

export async function signWebhookBody(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return `sha256=${[...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

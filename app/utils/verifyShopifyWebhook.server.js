import crypto from "crypto";

/**
 * Shopify Webhook HMAC検証
 * header: X-Shopify-Hmac-Sha256 = base64(hmac_sha256(raw_body, api_secret))
 */
export function verifyShopifyWebhookHmac({ rawBody, hmacHeader, secret }) {
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!hmacHeader) return { ok: false, reason: "missing_hmac_header" };

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmacHeader, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "length_mismatch" };

  const ok = crypto.timingSafeEqual(a, b);
  return ok ? { ok: true } : { ok: false, reason: "invalid_hmac" };
}

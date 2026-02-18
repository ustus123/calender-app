// app/utils/verifyShopifyWebhook.server.js

import crypto from "crypto";

/**
 * Shopify Webhook HMAC検証（Shopify.dev Step 5 準拠）
 * header: X-Shopify-Hmac-Sha256 = base64(HMAC_SHA256(raw_body_bytes, api_secret))
 *
 * rawBody: Buffer（生のbytes）
 * hmacHeader: base64文字列
 * secret: API secret
 */
export function verifyShopifyWebhookHmac({ rawBody, hmacHeader, secret }) {
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!hmacHeader) return { ok: false, reason: "missing_hmac_header" };
  if (!rawBody) return { ok: false, reason: "missing_raw_body" };

  // ✅ rawBody は bytes（Buffer）前提
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);

  // ✅ bytesでHMAC（.update(rawBody, "utf8") はしない）
  const calculated = crypto
    .createHmac("sha256", secret)
    .update(raw)
    .digest("base64");

  // ✅ Shopify.dev の例：base64をBuffer化して timingSafeEqual
  try {
    const ok = crypto.timingSafeEqual(
      Buffer.from(calculated, "base64"),
      Buffer.from(hmacHeader, "base64"),
    );
    return ok ? { ok: true } : { ok: false, reason: "invalid_hmac" };
  } catch {
    // base64として不正など
    return { ok: false, reason: "invalid_hmac" };
  }
}

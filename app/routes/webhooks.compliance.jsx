// app/routes/webhooks.compliance.jsx
import crypto from "crypto";

function json(body, { status = 200, headers } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(headers || {}),
    },
  });
}

/**
 * Shopify Webhook HMAC 検証（bytesベース）
 * header: X-Shopify-Hmac-Sha256 = base64(HMAC_SHA256(raw_body, api_secret))
 */
function verifyShopifyWebhookHmac(rawBodyBuffer, hmacHeader, secret) {
  if (!secret || !hmacHeader) return false;

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBodyBuffer)
    .digest("base64");

  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmacHeader, "utf8");
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

export async function action({ request }) {
  // Shopify は raw body で署名するので、必ず arrayBuffer() で「生のbytes」を取る
  const rawBodyBuffer = Buffer.from(await request.arrayBuffer());

  const hmacHeader =
    request.headers.get("X-Shopify-Hmac-Sha256") ||
    request.headers.get("X-Shopify-Hmac-SHA256") ||
    "";

  // ここは「アプリの API secret（client secret）」です
  const secret = process.env.SHOPIFY_API_SECRET || "";

  const ok = verifyShopifyWebhookHmac(rawBodyBuffer, hmacHeader, secret);

  // ✅ Shopify要件：HMAC が無効なら 401 を返す
  if (!ok) return json({ ok: false, reason: "invalid_hmac" }, { status: 401 });

  // compliance webhook は受領できれば 200 でOK（データが無いなら何もしなくてよい）
  // ※ShopifyはPOSTで呼びます
  const topic =
    request.headers.get("X-Shopify-Topic") ||
    request.headers.get("x-shopify-topic") ||
    "";

  return json({ ok: true, topic }, { status: 200 });
}

/**
 * Shopifyのチェック/人のアクセスで GET が来ても 200 を返すと誤判定の元になるので、
 * 401 を返して「署名が必要」を明確にしておく（安全側）
 */
export async function loader() {
  return json({ ok: false, reason: "hmac_required" }, { status: 401 });
}

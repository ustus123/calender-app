// webhooks.app.scopes_update.jsx

import db from "../db.server";
import { verifyShopifyWebhookHmac } from "../utils/verifyShopifyWebhook.server";

function parseJson(rawBodyBuffer) {
  try {
    return JSON.parse(rawBodyBuffer.toString("utf8"));
  } catch {
    return null;
  }
}

export const action = async ({ request }) => {
  // ✅ raw bytes を取得
  const rawBody = Buffer.from(await request.arrayBuffer());

  // ✅ HMAC header（Fetch Headers は大小文字非依存）
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256") || "";

  // ✅ API secret
  const secret = process.env.SHOPIFY_API_SECRET || "";

  // ✅ Step 5：HMAC 検証
  const v = verifyShopifyWebhookHmac({ rawBody, hmacHeader, secret });
  if (!v.ok) return new Response("Unauthorized", { status: 401 });

  // ✅ payload
  const payload = parseJson(rawBody) || {};
  const topic = request.headers.get("x-shopify-topic") || "APP_SCOPES_UPDATE";
  const shop = request.headers.get("x-shopify-shop-domain") || "";

  console.log(`Received ${topic} webhook for ${shop || "(unknown shop)"}`);

  const current = payload?.current;

  // sessionが取れないため、shop単位で offline session を更新（あなたのDB設計次第で調整）
  // 元コードは session.id 更新でしたが、ここでは "shop" で更新する形に寄せます。
  if (shop && current != null) {
    await db.session.updateMany({
      where: { shop, isOnline: false },
      data: { scope: String(current) },
    });
  }

  return new Response("ok", { status: 200 });
};

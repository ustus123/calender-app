import { json } from "@remix-run/node";
import { verifyShopifyWebhookHmac } from "../utils/verifyShopifyWebhook.server.js";

export const action = async ({ request }) => {
  // Shopifyは raw body で署名するので text() で取得
  const rawBody = await request.text();

  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
  const secret = process.env.SHOPIFY_API_SECRET;

  const v = verifyShopifyWebhookHmac({ rawBody, hmacHeader, secret });
  if (!v.ok) {
    return json({ ok: false, reason: v.reason }, { status: 401 });
  }

  const topic =
    request.headers.get("X-Shopify-Topic") ||
    request.headers.get("x-shopify-topic") ||
    "";

  // 必要なら payload を使う（今回は最小実装）
  // const payload = JSON.parse(rawBody);

  switch (topic) {
    case "customers/data_request":
      // アプリが顧客の個人データを保持していないなら 200 でOK
      return json({ ok: true }, { status: 200 });

    case "customers/redact":
      // 顧客データ削除：保持してないなら 200 でOK
      return json({ ok: true }, { status: 200 });

    case "shop/redact":
      // ストアデータ削除：shop単位の設定等をDB保存してるならここで削除
      return json({ ok: true }, { status: 200 });

    default:
      // 想定外でも200返す（再送ループ回避）
      return json({ ok: true, ignored: true, topic }, { status: 200 });
  }
};

// webhooks.app.uninstalled.jsx

import db from "../db.server";
import { verifyShopifyWebhookHmac } from "../utils/verifyShopifyWebhook.server";

export const action = async ({ request }) => {
  const rawBody = Buffer.from(await request.arrayBuffer());
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256") || "";
  const secret = process.env.SHOPIFY_API_SECRET || "";

  const v = verifyShopifyWebhookHmac({ rawBody, hmacHeader, secret });
  if (!v.ok) return new Response("Unauthorized", { status: 401 });

  const topic = request.headers.get("x-shopify-topic") || "APP_UNINSTALLED";
  const shop = request.headers.get("x-shopify-shop-domain") || "";

  console.log(`Received ${topic} webhook for ${shop || "(unknown shop)"}`);

  // uninstall は shop が取れないと消せないので、取れなければ 200 で終了
  if (shop) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response("ok", { status: 200 });
};

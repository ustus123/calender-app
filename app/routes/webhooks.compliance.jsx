// app/routes/webhooks.compliance.jsx

import { verifyShopifyWebhookHmac } from "../utils/verifyShopifyWebhook.server";

function json(body, { status = 200, headers } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(headers || {}),
    },
  });
}

export async function action({ request }) {
  const rawBody = Buffer.from(await request.arrayBuffer());
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256") || "";
  const secret = process.env.SHOPIFY_API_SECRET || "";

  const v = verifyShopifyWebhookHmac({ rawBody, hmacHeader, secret });
  if (!v.ok) return json({ ok: false, reason: "invalid_hmac" }, { status: 401 });

  const topic = request.headers.get("x-shopify-topic") || "";
  return json({ ok: true, topic }, { status: 200 });
}

export async function loader() {
  // GET は署名がないので 401（安全側）
  return json({ ok: false, reason: "hmac_required" }, { status: 401 });
}

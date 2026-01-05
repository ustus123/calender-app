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

function verifyHmac(rawBody, hmacHeader, secret) {
  if (!secret || !hmacHeader) return false;

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmacHeader, "utf8");
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

export async function action({ request }) {
  const rawBody = await request.text();

  const hmacHeader =
    request.headers.get("X-Shopify-Hmac-Sha256") ||
    request.headers.get("X-Shopify-Hmac-SHA256") ||
    "";

  const secret = process.env.SHOPIFY_API_SECRET || "";
  const ok = verifyHmac(rawBody, hmacHeader, secret);

  // 無効な署名は401で拒否（Shopify要件）
  if (!ok) return json({ ok: false }, { status: 401 });

  const topic =
    request.headers.get("X-Shopify-Topic") ||
    request.headers.get("x-shopify-topic") ||
    "";

  // 最小実装：保持データが無いなら200でOK
  return json({ ok: true, topic }, { status: 200 });
}

// 任意：GETで叩かれても405にならないようにする（確認用）
export async function loader() {
  return json({ ok: true }, { status: 200 });
}

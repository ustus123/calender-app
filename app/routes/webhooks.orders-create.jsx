import { authenticate } from "../shopify.server";
import { getOrCreateDeliverySettings } from "../models/deliverySettings.server";
import prisma from "../db.server";

/** JSON安全 */
function safeJsonArray(str) {
  try {
    const v = JSON.parse(str || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function safeStr(v) {
  return String(v ?? "").trim();
}
function parseHHmm(hhmm) {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
}
function formatDateYYYYMMDD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function weekdayToIndex(name) {
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[name] ?? null;
}
function isHoliday(dateObj, holidayNames) {
  const dayIdx = dateObj.getDay();
  const holidayIdxs = holidayNames.map(weekdayToIndex).filter((v) => v !== null);
  return holidayIdxs.includes(dayIdx);
}
function buildDisabledSet({ startDate, endDate, holidays, blackoutDates }) {
  const disabled = new Set(blackoutDates);
  const d = new Date(startDate);
  while (d <= endDate) {
    const ymd = formatDateYYYYMMDD(d);
    if (isHoliday(d, holidays)) disabled.add(ymd);
    d.setDate(d.getDate() + 1);
  }
  return disabled;
}

/** offline token取得 */
async function getOfflineAccessToken(shop) {
  const offlineSession = await prisma.session.findFirst({
    where: { shop, isOnline: false },
    orderBy: { expires: "desc" },
  });
  if (!offlineSession?.accessToken) {
    throw new Error("Offline access token not found for shop: " + shop);
  }
  return offlineSession.accessToken;
}

/** GraphQL呼び出し */
async function shopifyGraphql({ shop, query, variables }) {
  const token = await getOfflineAccessToken(shop);
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2025-10";
  const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(
      "GraphQL HTTP error: " + JSON.stringify({ status: resp.status, json }),
    );
  }
  return json;
}

/** タグ付け */
async function addOrderTags({ shop, orderId, tags }) {
  const mutation = `
    mutation AddTags($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        node { id }
        userErrors { field message }
      }
    }
  `;
  const orderGid = `gid://shopify/Order/${orderId}`;
  const json = await shopifyGraphql({
    shop,
    query: mutation,
    variables: { id: orderGid, tags },
  });

  const userErrors = json?.data?.tagsAdd?.userErrors || [];
  if (userErrors.length) {
    throw new Error("tagsAdd userErrors: " + JSON.stringify(userErrors));
  }
  return true;
}

/** 注文メモ追記 */
async function appendOrderNote({ shop, orderId, lineToAppend }) {
  const orderGid = `gid://shopify/Order/${orderId}`;

  const q = `
    query GetOrderNote($id: ID!) {
      order(id: $id) { id note }
    }
  `;
  const qJson = await shopifyGraphql({
    shop,
    query: q,
    variables: { id: orderGid },
  });
  const currentNote = String(qJson?.data?.order?.note || "");

  if (currentNote.includes(lineToAppend)) return true;

  const nextNote = currentNote ? `${currentNote}\n${lineToAppend}` : lineToAppend;

  const m = `
    mutation UpdateOrderNote($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id note }
        userErrors { field message }
      }
    }
  `;
  const mJson = await shopifyGraphql({
    shop,
    query: m,
    variables: { input: { id: orderGid, note: nextNote } },
  });

  const userErrors = mJson?.data?.orderUpdate?.userErrors || [];
  if (userErrors.length) {
    throw new Error("orderUpdate userErrors: " + JSON.stringify(userErrors));
  }
  return true;
}

/** note_attributes から名前指定で取る */
function getNoteAttr(payload, name) {
  const noteAttributes = Array.isArray(payload?.note_attributes)
    ? payload.note_attributes
    : [];
  return String(noteAttributes.find((x) => x?.name === name)?.value ?? "");
}

/** ✅ 注文メタフィールド保存（日付・時間・置き配・理由） */
async function setOrderMetafields({
  shop,
  orderId,
  namespace,
  dateKey,
  timeKey,
  placementKey,
  invalidReasonKey = "delivery_invalid_reason",
  deliveryDate,
  deliveryTime,
  deliveryPlacement,
  invalidReason, // null or string
}) {
  const mutation = `
    mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key type value }
        userErrors { field message code }
      }
    }
  `;

  const ownerId = `gid://shopify/Order/${orderId}`;

  // 空欄でも保存したいので "" を入れる（Flow等で条件分岐しやすい）
  const metafields = [
    {
      namespace,
      key: dateKey,
      type: "single_line_text_field",
      ownerId,
      value: String(deliveryDate || ""),
    },
    {
      namespace,
      key: timeKey,
      type: "single_line_text_field",
      ownerId,
      value: String(deliveryTime || ""),
    },
    {
      namespace,
      key: placementKey,
      type: "single_line_text_field",
      ownerId,
      value: String(deliveryPlacement || ""),
    },
    {
      namespace,
      key: invalidReasonKey,
      type: "single_line_text_field",
      ownerId,
      value: String(invalidReason || ""),
    },
  ];

  const json = await shopifyGraphql({
    shop,
    query: mutation,
    variables: { metafields },
  });

  const errs = json?.data?.metafieldsSet?.userErrors || [];
  if (errs.length) throw new Error("metafieldsSet userErrors: " + JSON.stringify(errs));
  return true;
}

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log("[WEBHOOK RECEIVED]", { topic, shop, orderId: payload?.id });
  if (topic !== "ORDERS_CREATE") return new Response("ok", { status: 200 });

  const settings = await getOrCreateDeliverySettings(shop);

  // ✅ 属性名（DBに合わせる）
  const attrDateName = safeStr(settings.attrDateName || "delivery_date");
  const attrTimeName = safeStr(settings.attrTimeName || "delivery_time");
  const attrPlacementName = safeStr(settings.attrPlacementName || "delivery_placement");

  // ✅ メタフィールド保存（DB）
  const saveToOrderMetafields = Boolean(settings.saveToOrderMetafields);
  const metafieldNamespace = safeStr(settings.metafieldNamespace || "custom");
  const metafieldDateKey = safeStr(settings.metafieldDateKey || "delivery_date");
  const metafieldTimeKey = safeStr(settings.metafieldTimeKey || "delivery_time");
  const metafieldPlacementKey = safeStr(settings.metafieldPlacementKey || "delivery_placement");
  const metafieldInvalidReasonKey = "delivery_invalid_reason";

  // ✅ 候補（DB） ※現仕様では「範囲外のみ」判定に使う
  const holidays = safeJsonArray(settings.holidaysJson);
  const blackoutDates = safeJsonArray(settings.blackoutJson);

  // ✅ 配送希望（note_attributes から attr名で拾う）
  const deliveryDate = safeStr(getNoteAttr(payload, attrDateName));
  const deliveryTime = safeStr(getNoteAttr(payload, attrTimeName));
  const deliveryPlacement = safeStr(getNoteAttr(payload, attrPlacementName));

  // ---- エラー条件：選択可能範囲外だけ ----
  // ※ 日付が空・形式不正・休日/不可日は「エラーにしない」
  let invalidReason = null;

  if (deliveryDate) {
    const leadTimeDays = Number(settings.leadTimeDays || 1);
    const rangeDays = Number(settings.rangeDays || 30);
    const cutoffTime = safeStr(settings.cutoffTime || ""); // ""なら考慮しない

    const now = new Date();
    let min = new Date(now);
    min.setHours(0, 0, 0, 0);

    // cutoffTime が設定されているときだけ考慮
    if (cutoffTime) {
      const { h: cutH, m: cutM } = parseHHmm(cutoffTime);
      const cutoff = new Date(now);
      cutoff.setHours(cutH, cutM, 0, 0);
      if (now > cutoff) min.setDate(min.getDate() + 1);
    }

    min.setDate(min.getDate() + leadTimeDays);

    const max = new Date(min);
    max.setDate(max.getDate() + rangeDays);

    const minStr = formatDateYYYYMMDD(min);
    const maxStr = formatDateYYYYMMDD(max);

    // ★この条件だけでエラー
    if (deliveryDate < minStr || deliveryDate > maxStr) {
      invalidReason = "out_of_range";
    } else {
      // 休日/不可日はエラーにしない要件なので、ここではチェックのみ（未使用）
      // const disabled = buildDisabledSet({ startDate: min, endDate: max, holidays, blackoutDates });
      // if (disabled.has(deliveryDate)) invalidReason = "disabled_date";
      void holidays;
      void blackoutDates;
    }
  }

  // ✅ メタフィールド保存（必要なら）
  if (saveToOrderMetafields) {
    try {
      await setOrderMetafields({
        shop,
        orderId: payload.id,
        namespace: metafieldNamespace,
        dateKey: metafieldDateKey,
        timeKey: metafieldTimeKey,
        placementKey: metafieldPlacementKey,
        invalidReasonKey: metafieldInvalidReasonKey,
        deliveryDate,
        deliveryTime,
        deliveryPlacement,
        invalidReason, // out_of_range のときだけ入る
      });
      console.log("[metafieldsSet] saved", {
        orderId: payload.id,
        deliveryDate,
        deliveryTime,
        deliveryPlacement,
        invalidReason: invalidReason || "",
      });
    } catch (e) {
      console.error("[metafieldsSet] error", e);
    }
  }

  // ---- エラー時だけ：メモ & タグ（固定文言）----
  if (invalidReason === "out_of_range") {
    console.warn(`[ORDERS_CREATE] ${shop} delivery date out of range`, {
      deliveryDate,
      orderId: payload?.id,
    });

    const tags = ["delivery_invalid_date"];
    const noteLine = "不正な指定日です";

    try {
      await addOrderTags({ shop, orderId: payload.id, tags });
      console.log("[tagsAdd] added", { orderId: payload.id, tags });
    } catch (e) {
      console.error("[tagsAdd] error", e);
    }

    try {
      await appendOrderNote({ shop, orderId: payload.id, lineToAppend: noteLine });
      console.log("[orderNote] appended", { orderId: payload.id, noteLine });
    } catch (e) {
      console.error("[orderNote] error", e);
    }
  }

  // OK時は静かに終了（メモもタグも付けない）
  return new Response("ok", { status: 200 });
};

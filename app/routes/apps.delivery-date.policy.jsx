// app/routes/apps.delivery-date.policy.jsx
// @ts-nocheck
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  getOrCreateDeliverySettings,
  safeJsonArray,
  safeJsonObject,
} from "../models/deliverySettings.server";

/** JSON(no-store) */
function jsonNoStore(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}

/** offline admin token */
async function getOfflineAccessToken(shop) {
  const offline = await prisma.session.findFirst({
    where: { shop, isOnline: false },
    orderBy: { expires: "desc" },
  });
  return offline?.accessToken || null;
}

/**
 * ============
 * Fast cache
 * ============
 */
const TAGS_CACHE_TTL_MS = 8_000; // 8秒
const tagsCache = new Map(); // key -> { exp:number, tags:string[] }

function cacheKeyForTags(shop, productIds) {
  const ids = (productIds || [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  return `${shop}::${ids.join(",")}`;
}
function getCachedTags(key) {
  const hit = tagsCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    tagsCache.delete(key);
    return null;
  }
  return hit.tags;
}
function setCachedTags(key, tags) {
  tagsCache.set(key, {
    exp: Date.now() + TAGS_CACHE_TTL_MS,
    tags: Array.isArray(tags) ? tags : [],
  });
}

/** Admin GraphQL: product tags by numeric product IDs */
async function fetchProductTagsByIds({ shop, accessToken, productIds }) {
  const ids = (productIds || [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);

  const out = new Set();
  if (!ids.length) return out;

  const chunk = (arr, size) => {
    const res = [];
    for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
    return res;
  };

  const query = `
    query ProductsTags($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          tags
        }
      }
    }
  `;

  const chunks = chunk(ids, 100);
  for (const part of chunks) {
    const gids = part.map((id) => `gid://shopify/Product/${id}`);

    const res = await fetch(
      `https://${shop}/admin/api/2026-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables: { ids: gids } }),
      },
    );

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Admin GraphQL failed: ${res.status} ${t}`);
    }

    const json = await res.json();
    const nodes = json?.data?.nodes || [];
    for (const n of nodes) {
      const tags = n?.tags;
      if (Array.isArray(tags)) {
        for (const tag of tags) {
          if (typeof tag === "string" && tag.trim()) out.add(tag.trim());
        }
      }
    }
  }

  return out;
}

function uniqStrings(arr) {
  const out = [];
  const set = new Set();
  for (const v of arr || []) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (set.has(s)) continue;
    set.add(s);
    out.push(s);
  }
  return out;
}

/** merge override: 「存在するキーだけ」上書き */
function applyOverride(base, ov) {
  const next = { ...base, show: { ...base.show }, required: { ...base.required } };

  if (typeof ov.leadTimeDays === "number") next.leadTimeDays = ov.leadTimeDays;
  if (typeof ov.rangeDays === "number") next.rangeDays = ov.rangeDays;

  if (typeof ov.showDate === "boolean") next.show.date = ov.showDate;
  if (typeof ov.showTime === "boolean") next.show.time = ov.showTime;
  if (typeof ov.showPlacement === "boolean") next.show.placement = ov.showPlacement;

  if (typeof ov.requireDate === "boolean") next.required.date = ov.requireDate;
  if (typeof ov.requireTime === "boolean") next.required.time = ov.requireTime;

  // ✅ 置き配は必須にしない（常にfalse固定）
  next.required.placement = false;

  if (typeof ov.noticeText === "string") next.noticeText = ov.noticeText;

  if (Array.isArray(ov.timeSlots)) next.timeSlots = uniqStrings(ov.timeSlots);

  // delivery.js は無視してもOK（管理/デバッグ用）
  if (typeof ov.carrierPreset === "string") next.carrierPreset = ov.carrierPreset;

  return next;
}

function normalizeBaseSettings(row) {
  const timeSlots = safeJsonArray(row?.timeSlotsJson);
  const holidays = safeJsonArray(row?.holidaysJson);
  const blackout = safeJsonArray(row?.blackoutJson);
  const calendarUi = safeJsonObject(row?.calendarUiJson);

  const base = {
    leadTimeDays: Number(row?.leadTimeDays ?? 1),
    rangeDays: Number(row?.rangeDays ?? 30),
    cutoffTime: typeof row?.cutoffTime === "string" ? row.cutoffTime : "",

    timeSlots: Array.isArray(timeSlots) ? timeSlots : [],
    noticeText: typeof row?.noticeText === "string" ? row.noticeText : "",

    show: {
      date: typeof row?.showDate === "boolean" ? row.showDate : true,
      time: typeof row?.showTime === "boolean" ? row.showTime : true,
      placement: typeof row?.showPlacement === "boolean" ? row.showPlacement : false,
    },
    required: {
      date: typeof row?.requireDate === "boolean" ? row.requireDate : true,
      time: typeof row?.requireTime === "boolean" ? row.requireTime : false,
      placement: false, // ✅ 固定
    },
    attrNames: {
      date:
        typeof row?.attrDateName === "string" && row.attrDateName
          ? row.attrDateName
          : "delivery_date",
      time:
        typeof row?.attrTimeName === "string" && row.attrTimeName
          ? row.attrTimeName
          : "delivery_time",
      placement:
        typeof row?.attrPlacementName === "string" && row.attrPlacementName
          ? row.attrPlacementName
          : "delivery_placement",
    },

    holidays,
    blackout,

    calendarUi: calendarUi && Object.keys(calendarUi).length ? calendarUi : undefined,
  };

  base.timeSlots = uniqStrings(base.timeSlots);

  // show OFF なら required OFF に寄せる
  base.required.date = base.show.date ? !!base.required.date : false;
  base.required.time = base.show.time ? !!base.required.time : false;
  base.required.placement = false;

  return base;
}

/**
 * App Proxy: /apps/delivery-date/policy
 * Query:
 *  - shop=xxx.myshopify.com
 *  - product_ids=123,456
 */
export const loader = async ({ request }) => {
  // ✅ App Proxy 認証（shop の取り方ブレ対策）
  let shop = null;
  try {
    const auth = await authenticate.public.appProxy(request);
    shop = auth?.session?.shop || auth?.shop || null;
  } catch (_) {}

  const url = new URL(request.url);
  const shopQ = url.searchParams.get("shop");
  if (!shop && shopQ) shop = shopQ;

  if (!shop) return jsonNoStore({ ok: false, error: "missing shop" }, 400);

  const settingsRow = await getOrCreateDeliverySettings(shop);
  const base = normalizeBaseSettings(settingsRow);

  // ✅ deny / override は壊れてても落とさない
  const denyTags = uniqStrings(
    safeJsonArray(settingsRow?.denyProductTagsJson)
      .map((s) => String(s || "").trim())
      .filter(Boolean),
  );

  const tagOverrides = safeJsonArray(settingsRow?.tagOverridesJson)
    .filter((x) => x && typeof x === "object" && !Array.isArray(x))
    .map((x) => ({
      tag: String(x.tag || "").trim(),
      override:
        x.override && typeof x.override === "object" && !Array.isArray(x.override)
          ? x.override
          : {},
    }))
    .filter((x) => x.tag);

  // cart product ids
  const productIdsCsv = url.searchParams.get("product_ids") || "";
  const productIds = productIdsCsv
    .split(",")
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  // ---- fetch tags (cached) ----
  let productTagsSet = new Set();

  try {
    if (productIds.length) {
      const key = cacheKeyForTags(shop, productIds);
      const cached = getCachedTags(key);
      if (cached) {
        productTagsSet = new Set(cached);
      } else {
        const token = await getOfflineAccessToken(shop);
        if (token) {
          const tagsSet = await fetchProductTagsByIds({
            shop,
            accessToken: token,
            productIds,
          });
          const tagsArr = Array.from(tagsSet);
          setCachedTags(key, tagsArr);
          productTagsSet = new Set(tagsArr);
        }
      }
    }
  } catch (e) {
    console.warn(
      "[policy] fetchProductTagsByIds failed -> continue without tag policy",
      e,
    );
    productTagsSet = new Set();
  }

  // 1) deny 優先：1つでも deny タグがあれば disabled
  const isDenied = denyTags.some((t) => productTagsSet.has(t));
  if (isDenied) {
    return jsonNoStore({
      ok: true,
      settings: {
        ...base,
        policy: { disabled: true, reason: "deny_tag" },
        required: { ...base.required, placement: false },
      },
    });
  }

  // 2) override 適用（✅上にあるルールを優先＝先勝ち）
  // 最初に一致したルールで確定し、以降は上書きしない
  let effective = { ...base, policy: { disabled: false } };

  for (const rule of tagOverrides) {
    if (!rule?.tag) continue;
    if (!productTagsSet.has(rule.tag)) continue;

    effective = applyOverride(effective, rule.override || {});
    // ✅ 先勝ち：ここで確定
    break;
  }

  // show OFF なら required OFF（安全策）
  effective.required.date = effective.show.date ? !!effective.required.date : false;
  effective.required.time = effective.show.time ? !!effective.required.time : false;
  effective.required.placement = false;

  return jsonNoStore({ ok: true, settings: effective });
};

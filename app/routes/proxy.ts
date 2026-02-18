// app/routes/proxy.ts
// App Proxy: /apps/delivery-date  ->  /proxy
// @ts-nocheck

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getOrCreateDeliverySettings, safeJsonArray, safeJsonObject } from "../models/deliverySettings.server";

function jsonNoStore(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}

function uniqStrings(arr: any[]) {
  const out: string[] = [];
  const set = new Set<string>();
  for (const v of arr || []) {
    const s = String(v || "").trim();
    if (!s || set.has(s)) continue;
    set.add(s);
    out.push(s);
  }
  return out;
}

async function getOfflineAccessToken(shop: string) {
  const offline = await prisma.session.findFirst({
    where: { shop, isOnline: false },
    orderBy: { expires: "desc" },
  });
  return offline?.accessToken || null;
}

const TAGS_CACHE_TTL_MS = 8_000;
const tagsCache = new Map<string, { exp: number; tags: string[] }>();

function cacheKeyForTags(shop: string, productIds: number[]) {
  const ids = (productIds || [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  return `${shop}::${ids.join(",")}`;
}
function getCachedTags(key: string) {
  const hit = tagsCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    tagsCache.delete(key);
    return null;
  }
  return hit.tags;
}
function setCachedTags(key: string, tags: string[]) {
  tagsCache.set(key, { exp: Date.now() + TAGS_CACHE_TTL_MS, tags: Array.isArray(tags) ? tags : [] });
}

async function fetchProductTagsByIds({ shop, accessToken, productIds }: any) {
  const ids = (productIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const out = new Set<string>();
  if (!ids.length) return out;

  const chunk = (arr: number[], size: number) => {
    const res: number[][] = [];
    for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
    return res;
  };

  const query = `
    query ProductsTags($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product { id tags }
      }
    }
  `;

  for (const part of chunk(ids, 100)) {
    const gids = part.map((id) => `gid://shopify/Product/${id}`);
    const res = await fetch(`https://${shop}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query, variables: { ids: gids } }),
    });

    if (!res.ok) throw new Error(`Admin GraphQL failed: ${res.status} ${await res.text().catch(() => "")}`);

    const j = await res.json();
    const nodes = j?.data?.nodes || [];
    for (const n of nodes) {
      const tags = n?.tags;
      if (Array.isArray(tags)) for (const t of tags) if (typeof t === "string" && t.trim()) out.add(t.trim());
    }
  }

  return out;
}

function applyOverride(base: any, ov: any) {
  const next = { ...base, show: { ...base.show }, required: { ...base.required } };

  if (typeof ov.leadTimeDays === "number") next.leadTimeDays = ov.leadTimeDays;
  if (typeof ov.rangeDays === "number") next.rangeDays = ov.rangeDays;

  if (typeof ov.showDate === "boolean") next.show.date = ov.showDate;
  if (typeof ov.showTime === "boolean") next.show.time = ov.showTime;
  if (typeof ov.showPlacement === "boolean") next.show.placement = ov.showPlacement;

  if (typeof ov.requireDate === "boolean") next.required.date = ov.requireDate;
  if (typeof ov.requireTime === "boolean") next.required.time = ov.requireTime;

  next.required.placement = false;

  if (typeof ov.noticeText === "string") next.noticeText = ov.noticeText;
  if (Array.isArray(ov.timeSlots)) next.timeSlots = uniqStrings(ov.timeSlots);

  if (typeof ov.carrierPreset === "string") next.carrierPreset = ov.carrierPreset;

  return next;
}

function normalizeBaseSettings(row: any) {
  const timeSlots = uniqStrings(safeJsonArray(row?.timeSlotsJson));
  const holidays = safeJsonArray(row?.holidaysJson);
  const blackout = safeJsonArray(row?.blackoutJson);

  const calendarUiFromAdmin = safeJsonObject(row?.calendarUiJson);
  const calendarUi = {
    mode: calendarUiFromAdmin.mode === "inline" ? "inline" : "popup",
    startWeek: calendarUiFromAdmin.startWeek === "mon" ? "mon" : "sun",
    colors: {
      disabledBg: String(calendarUiFromAdmin?.colors?.disabledBg ?? "#f1f2f3"),
      blackoutBg: String(calendarUiFromAdmin?.colors?.blackoutBg ?? "#fff2cc"),
      disabledText: String(calendarUiFromAdmin?.colors?.disabledText ?? "#8c9196"),
      accent: String(calendarUiFromAdmin?.colors?.accent ?? "#005bd3"),
      selectedBg: String(calendarUiFromAdmin?.colors?.selectedBg ?? "#005bd3"),
      selectedText: String(calendarUiFromAdmin?.colors?.selectedText ?? "#ffffff"),
      todayRing: String(calendarUiFromAdmin?.colors?.todayRing ?? "#00a47c"),
    },
  };

  const base: any = {
    leadTimeDays: Number(row?.leadTimeDays ?? 1),
    rangeDays: Number(row?.rangeDays ?? 30),
    cutoffTime: typeof row?.cutoffTime === "string" ? row.cutoffTime : "",
    timeSlots,
    noticeText: typeof row?.noticeText === "string" ? row.noticeText : "",
    show: {
      date: typeof row?.showDate === "boolean" ? row.showDate : true,
      time: typeof row?.showTime === "boolean" ? row.showTime : true,
      placement: typeof row?.showPlacement === "boolean" ? row.showPlacement : false,
    },
    required: {
      date: typeof row?.requireDate === "boolean" ? row.requireDate : true,
      time: typeof row?.requireTime === "boolean" ? row.requireTime : false,
      placement: false,
    },
    attrNames: {
      date: row?.attrDateName || "delivery_date",
      time: row?.attrTimeName || "delivery_time",
      placement: row?.attrPlacementName || "delivery_placement",
    },
    holidays,
    blackout,
    calendarUi,
  };

  base.required.date = base.show.date ? !!base.required.date : false;
  base.required.time = base.show.time ? !!base.required.time : false;
  base.required.placement = false;

  return base;
}

export const loader = async ({ request }: any) => {
  try {
    // 1) shop を確実に取る（署名OKなら appProxy から、ダメでも shop param から）
    let shop: string | null = null;
    try {
      const auth = await authenticate.public.appProxy(request);
      shop = auth?.session?.shop || auth?.shop || null;
    } catch {}

    const url = new URL(request.url);
    if (!shop) shop = url.searchParams.get("shop");

    if (!shop) return jsonNoStore({ ok: false, error: "missing shop" }, 400);

    // 2) 設定取得
    const row = await getOrCreateDeliverySettings(shop);
    const base = normalizeBaseSettings(row);

    const denyTags = uniqStrings(safeJsonArray(row?.denyProductTagsJson));
    const tagOverrides = safeJsonArray(row?.tagOverridesJson)
      .filter((x: any) => x && typeof x === "object" && !Array.isArray(x))
      .map((x: any) => ({
        tag: String(x.tag || "").trim(),
        override: x.override && typeof x.override === "object" && !Array.isArray(x.override) ? x.override : {},
      }))
      .filter((x: any) => x.tag);

    // 3) カート内 product_ids からタグ収集
    const productIdsCsv = url.searchParams.get("product_ids") || "";
    const productIds = productIdsCsv
      .split(",")
      .map((s) => Number(String(s).trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

    let productTagsSet = new Set<string>();

    try {
      if (productIds.length) {
        const key = cacheKeyForTags(shop, productIds);
        const cached = getCachedTags(key);
        if (cached) {
          productTagsSet = new Set(cached);
        } else {
          const token = await getOfflineAccessToken(shop);
          if (token) {
            const tagsSet = await fetchProductTagsByIds({ shop, accessToken: token, productIds });
            const tagsArr = Array.from(tagsSet);
            setCachedTags(key, tagsArr);
            productTagsSet = new Set(tagsArr);
          }
        }
      }
    } catch (e) {
      console.warn("[proxy] fetchProductTagsByIds failed -> continue without tag policy", e);
      productTagsSet = new Set();
    }

    // 4) deny → disabled
    const isDenied = denyTags.some((t) => productTagsSet.has(t));
    if (isDenied) {
      return jsonNoStore(
        {
          ok: true,
          settings: {
            ...base,
            policy: { disabled: true, reason: "deny_tag" },
            required: { ...base.required, placement: false },
          },
        },
        200,
      );
    }

    // 5) override（上から最初に一致した1件）
    let effective = { ...base, policy: { disabled: false } };
    for (const rule of tagOverrides) {
      if (!productTagsSet.has(rule.tag)) continue;
      effective = applyOverride(effective, rule.override || {});
      break;
    }

    effective.required.date = effective.show.date ? !!effective.required.date : false;
    effective.required.time = effective.show.time ? !!effective.required.time : false;
    effective.required.placement = false;

    return jsonNoStore({ ok: true, settings: effective }, 200);
  } catch (e: any) {
    // ★ ここが超重要：例外でも必ずJSON
    console.error("[proxy] fatal", e);
    return jsonNoStore({ ok: false, error: "internal", message: String(e?.message || e) }, 500);
  }
};

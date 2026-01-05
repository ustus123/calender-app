import { getOrCreateDeliverySettings } from "../models/deliverySettings.server";

function formatDateYYYYMMDD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseHHmm(hhmm) {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
}

function safeJsonArray(str) {
  try {
    const v = JSON.parse(str || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
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

function isValidYYYYMMDD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const action = async ({ request }) => {
  // ★開発用：shop をクエリで受け取る（あとでApp Proxyに置換）
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop"); // 例: testtest-takashi.myshopify.com

  if (!shop) {
    return jsonResponse(
      { ok: false, reason: "missing_shop", message: "shop パラメータが必要です" },
      400
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, reason: "invalid_json", message: "JSONが不正です" }, 400);
  }

  const deliveryDate = String(body.delivery_date || "");
  const deliveryTime = String(body.delivery_time || "");

  if (!isValidYYYYMMDD(deliveryDate)) {
    return jsonResponse({ ok: false, reason: "invalid_date_format", message: "日付形式が不正です" }, 400);
  }

  const settings = await getOrCreateDeliverySettings(shop);

  const leadTimeDays = Number(settings.leadTimeDays || 1);
  const rangeDays = Number(settings.rangeDays || 30);
  const cutoffTime = String(settings.cutoffTime || "15:00");

  const holidays = safeJsonArray(settings.holidaysJson);
  const blackoutDates = safeJsonArray(settings.blackoutJson);
  const timeSlots = safeJsonArray(settings.timeSlotsJson);

  // 時間帯が必須ならここでチェック（任意にしたいなら条件を変える）
  if (deliveryTime && !timeSlots.includes(deliveryTime)) {
    return jsonResponse({ ok: false, reason: "invalid_time_slot", message: "時間帯が不正です" }, 400);
  }

  // min/max
  const now = new Date();
  const { h: cutH, m: cutM } = parseHHmm(cutoffTime);
  const cutoff = new Date(now);
  cutoff.setHours(cutH, cutM, 0, 0);

  let min = new Date(now);
  min.setHours(0, 0, 0, 0);
  if (now > cutoff) min.setDate(min.getDate() + 1);
  min.setDate(min.getDate() + leadTimeDays);

  const max = new Date(min);
  max.setDate(max.getDate() + rangeDays);

  const minStr = formatDateYYYYMMDD(min);
  const maxStr = formatDateYYYYMMDD(max);

  if (deliveryDate < minStr || deliveryDate > maxStr) {
    return jsonResponse(
      { ok: false, reason: "out_of_range", message: `選択可能期間外です（${minStr}〜${maxStr}）`, minDate: minStr, maxDate: maxStr },
      400
    );
  }

  const disabled = buildDisabledSet({ startDate: min, endDate: max, holidays, blackoutDates });
  if (disabled.has(deliveryDate)) {
    return jsonResponse({ ok: false, reason: "disabled_date", message: "選択不可日です" }, 400);
  }

  return jsonResponse({ ok: true, message: "OK" });
};

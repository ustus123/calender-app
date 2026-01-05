import { authenticate } from "../shopify.server";
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

function weekdayToIndex(name) {
  // JS: 0=Sun ... 6=Sat
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[name] ?? null;
}

function safeJsonArray(str) {
  try {
    const v = JSON.parse(str || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function isHoliday(dateObj, holidayNames) {
  const dayIdx = dateObj.getDay();
  const holidayIdxs = holidayNames
    .map(weekdayToIndex)
    .filter((v) => v !== null);
  return holidayIdxs.includes(dayIdx);
}

function buildDisabledDates({ startDate, endDate, holidays, blackoutDates }) {
  // startDate/endDateは Date。endDate含む
  const disabled = new Set(blackoutDates);

  // 期間内の休日を disabled に追加
  const d = new Date(startDate);
  while (d <= endDate) {
    const ymd = formatDateYYYYMMDD(d);
    if (isHoliday(d, holidays)) disabled.add(ymd);
    d.setDate(d.getDate() + 1);
  }

  return Array.from(disabled).sort();
}

export const loader = async ({ request }) => {
  // 管理画面から叩く想定。admin認証でOK。
  const { session } = await authenticate.admin(request);

  const settings = await getOrCreateDeliverySettings(session.shop);

  const leadTimeDays = Number(settings.leadTimeDays || 1);
  const rangeDays = Number(settings.rangeDays || 30);
  const cutoffTime = String(settings.cutoffTime || "15:00");

  const holidays = safeJsonArray(settings.holidaysJson);       // ["Sun","Sat"] など
  const blackoutDates = safeJsonArray(settings.blackoutJson);  // ["2025-12-31"] など
  const timeSlots = safeJsonArray(settings.timeSlotsJson);     // ["08:00-12:00", ...]

  // --- minDate の計算 ---
  // 今日が締め時間を過ぎていたら +1 日してから leadTime を足す
  const now = new Date();
  const { h: cutH, m: cutM } = parseHHmm(cutoffTime);
  const cutoff = new Date(now);
  cutoff.setHours(cutH, cutM, 0, 0);

  let min = new Date(now);
  min.setHours(0, 0, 0, 0);

  // 締め時間後なら、翌日扱い
  if (now > cutoff) {
    min.setDate(min.getDate() + 1);
  }
  // リードタイム分加算
  min.setDate(min.getDate() + leadTimeDays);

  // --- maxDate ---
  const max = new Date(min);
  max.setDate(max.getDate() + rangeDays);

  // --- disabledDates ---
  const disabledDates = buildDisabledDates({
    startDate: min,
    endDate: max,
    holidays,
    blackoutDates,
  });

  return new Response(
    JSON.stringify({
      minDate: formatDateYYYYMMDD(min),
      maxDate: formatDateYYYYMMDD(max),
      disabledDates,
      timeSlots,
      cutoffTime,
      leadTimeDays,
      rangeDays,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
};

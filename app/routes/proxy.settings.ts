// app/routes/proxy.settings.ts
// 
import type { LoaderFunctionArgs } from "react-router";
import crypto from "node:crypto";
import prisma from "../db.server";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(init?.headers || {}),
    },
  });
}

/** Shopify App Proxy signature verification */
function verifyAppProxySignature(url: URL, secret: string) {
  try {
    const sig = url.searchParams.get("signature");
    if (!sig) return false;

    const params: [string, string][] = [];
    url.searchParams.forEach((value, key) => {
      if (key === "signature") return;
      params.push([key, value]);
    });

    params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const message = params.map(([k, v]) => `${k}=${v}`).join("");

    const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");

    const a = Buffer.from(digest, "utf8"); // 64 bytes (hex文字列)
    const b = Buffer.from(sig, "utf8");

    // ✅ 長さが違うと timingSafeEqual が例外になるので先に弾く
    if (a.length !== b.length) return false;

    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    console.warn("[proxy.settings] signature verify error", e);
    return false;
  }
}


function safeJsonArray(jsonStr: string | null | undefined): string[] {
  try {
    const v = JSON.parse(jsonStr || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function safeJsonObject(jsonStr: string | null | undefined): Record<string, any> {
  try {
    const v = JSON.parse(jsonStr || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function formatYmd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function addDays(date: Date, days: number) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}
const WEEKDAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function normalizeHolidayList(arr: string[]) {
  const out = { weekdays: new Set<string>(), dates: new Set<string>() };
  (Array.isArray(arr) ? arr : []).forEach((x) => {
    if (typeof x !== "string") return;
    const s = x.trim();
    if (!s) return;
    if (WEEKDAY_KEYS.includes(s as any)) out.weekdays.add(s);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) out.dates.add(s);
  });
  return out;
}

function normalizeBlackoutList(arr: string[]) {
  const set = new Set<string>();
  (Array.isArray(arr) ? arr : []).forEach((x) => {
    if (typeof x !== "string") return;
    const s = x.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) set.add(s);
  });
  return set;
}

function isValidCutoffHHMM(s: string) {
  if (!s) return false;
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(s).trim());
}

function isStoreHoliday(dateObj: Date, holidays: ReturnType<typeof normalizeHolidayList>) {
  const ymd = formatYmd(dateObj);
  if (holidays.dates.has(ymd)) return true;
  const wk = WEEKDAY_KEYS[dateObj.getDay()];
  if (holidays.weekdays.has(wk)) return true;
  return false;
}

function computeMinMaxWithBusinessLeadtime(opts: {
  leadTimeDays: number;
  rangeDays: number;
  cutoffTime: string;
  holidays: ReturnType<typeof normalizeHolidayList>;
  blackout: Set<string>;
}) {
  const now = new Date();
  let base = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (isValidCutoffHHMM(opts.cutoffTime)) {
    const [hh, mm] = opts.cutoffTime.trim().split(":").map(Number);
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
    if (now.getTime() > cutoff.getTime()) base = addDays(base, 1);
  }

  const lt = Math.max(0, Number(opts.leadTimeDays) || 0);
  const rd = Math.max(1, Number(opts.rangeDays) || 1);

  // base が休日なら翌営業日に寄せる（blackoutは出荷休日扱いしない）
  let cursor = new Date(base.getTime());
  while (isStoreHoliday(cursor, opts.holidays)) cursor = addDays(cursor, 1);

  // leadTimeDays 分、営業日で進める
  let advanced = 0;
  while (advanced < lt) {
    cursor = addDays(cursor, 1);
    while (isStoreHoliday(cursor, opts.holidays)) cursor = addDays(cursor, 1);
    advanced++;
  }

  // minDate は blackout を踏まないようにだけ調整（holidayは選択不可にしない仕様）
  let minDate = new Date(cursor.getTime());
  while (opts.blackout.has(formatYmd(minDate))) {
    minDate = addDays(minDate, 1);
  }

  const maxDate = addDays(minDate, rd - 1);
  return { minDate, maxDate };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);

    // App Proxy の shop を取得（無いときは 400で返す）
    const shop = url.searchParams.get("shop");
    if (!shop) {
      return json({ error: "missing shop" }, { status: 400 });
    }

    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) {
      return json({ error: "missing SHOPIFY_API_SECRET" }, { status: 500 });
    }

    // 署名検証（devで署名が無い/違う場合に落ちて500にならないよう 401で返す）
    if (!verifyAppProxySignature(url, secret)) {
      return json({ error: "invalid signature" }, { status: 401 });
    }

    const row = await prisma.deliverySettings.findUnique({ where: { shop } });
    // 無い場合でも最低限返す（themeが落ちないように）
    const settings = row ?? {
      leadTimeDays: 1,
      rangeDays: 30,
      cutoffTime: "",
      timeSlotsJson: "[]",
      holidaysJson: "[]",
      blackoutJson: "[]",
      showDate: true,
      showTime: true,
      showPlacement: true,
      requireDate: true,
      requireTime: false,
      placementRequired: false,
      noticeText: "",
      attrDateName: "delivery_date",
      attrTimeName: "delivery_time",
      attrPlacementName: "delivery_placement",
      calendarUiMode: "popup",
      calendarStartWeek: "sun",
      calendarUiJson: "{}",
      calDisabledBg: "#f1f2f3",
      calBlackoutBg: "#fff2cc",
      calDisabledText: "#8c9196",
      calAccent: "#005bd3",
      calSelectedBg: "#005bd3",
      calSelectedText: "#ffffff",
    } as any;

    const holidaysArr = safeJsonArray(settings.holidaysJson);
    const blackoutArr = safeJsonArray(settings.blackoutJson);
    const timeSlots = safeJsonArray(settings.timeSlotsJson);

    const holidays = normalizeHolidayList(holidaysArr);
    const blackout = normalizeBlackoutList(blackoutArr);

    const { minDate, maxDate } = computeMinMaxWithBusinessLeadtime({
      leadTimeDays: Number(settings.leadTimeDays ?? 1),
      rangeDays: Number(settings.rangeDays ?? 30),
      cutoffTime: String(settings.cutoffTime ?? ""),
      holidays,
      blackout,
    });

    // calendarUiJson は「追加設定」用（今後拡張しても壊れない）
    const extraUi = safeJsonObject(settings.calendarUiJson);

    return json({
      // ✅ 既存
      leadTimeDays: Number(settings.leadTimeDays ?? 1),
      rangeDays: Number(settings.rangeDays ?? 30),
      cutoffTime: String(settings.cutoffTime ?? ""),
      holidays: holidaysArr,
      blackout: blackoutArr,

      calendarUi: {
        mode: settings.calendarUiMode === "inline" ? "inline" : "popup",
        startWeek: settings.calendarStartWeek === "mon" ? "mon" : "sun",
        colors: {
          disabledBg: String(settings.calDisabledBg ?? ""),
          blackoutBg: String(settings.calBlackoutBg ?? ""),
          disabledText: String(settings.calDisabledText ?? ""),
          accent: String(settings.calAccent ?? ""),
          selectedBg: String(settings.calSelectedBg ?? ""),
          selectedText: String(settings.calSelectedText ?? ""),
          // todayRing は DB に無ければ extraUi 側から拾えるようにしておく
          todayRing: typeof extraUi?.colors?.todayRing === "string" ? extraUi.colors.todayRing : undefined,
        },
        ...extraUi,
      },

      computed: {
        minDate: formatYmd(minDate),
        maxDate: formatYmd(maxDate),
      },

      // ✅ 追加：theme側が期待してるキー（これが無いと反映されない）
      noticeText: String(settings.noticeText ?? ""),
      timeSlots,

      show: {
        date: !!settings.showDate,
        time: !!settings.showTime,
        placement: !!settings.showPlacement,
      },
      required: {
        date: !!settings.requireDate,
        time: !!settings.requireTime,
        placement: !!settings.placementRequired,
      },
      attrNames: {
        date: String(settings.attrDateName ?? "delivery_date"),
        time: String(settings.attrTimeName ?? "delivery_time"),
        placement: String(settings.attrPlacementName ?? "delivery_placement"),
      },
    });
  } catch (e: any) {
    console.error("[proxy.settings] error", e);
    return json({ error: "internal", message: String(e?.message || e) }, { status: 500 });
  }
};

export default function ProxyDeliverySettings() {
  return null;
}

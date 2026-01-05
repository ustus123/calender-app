// app/routes/app.delivery.calendar.jsx
import { useMemo, useState } from "react";
import { useLoaderData, useSubmit, useActionData } from "react-router";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Checkbox,
  Banner,
  InlineStack,
  Text,
  Divider,
  Select,
  Button,
  Box,
  BlockStack,
  List,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import {
  getOrCreateDeliverySettings,
  updateDeliverySettings,
  safeJsonArray,
  safeJsonStringify,
} from "../models/deliverySettings.server";

/* ---------- helpers ---------- */
function splitLinesToArray(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function arrayToLines(arr) {
  return (arr || []).join("\n");
}
function normalizeYmdList(lines) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  return splitLinesToArray(lines).filter((s) => re.test(s));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
function formatYmd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}
function monthStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function monthEnd(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

const WEEKDAYS = [
  { label: "日(Sun)", value: "Sun" },
  { label: "月(Mon)", value: "Mon" },
  { label: "火(Tue)", value: "Tue" },
  { label: "水(Wed)", value: "Wed" },
  { label: "木(Thu)", value: "Thu" },
  { label: "金(Fri)", value: "Fri" },
  { label: "土(Sat)", value: "Sat" },
];

const WEEKDAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ---------- loader ---------- */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getOrCreateDeliverySettings(session.shop);

  const holidays = safeJsonArray(settings.holidaysJson);
  const blackout = safeJsonArray(settings.blackoutJson);

  const weekdaySet = new Set(WEEKDAYS.map((w) => w.value));
  const holidayWeekdays = holidays.filter((x) => weekdaySet.has(x));
  const holidayDates = holidays.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));

  const calendarUi = (() => {
    try {
      return JSON.parse(settings.calendarUiJson || "{}");
    } catch {
      return {};
    }
  })();

  return {
    shop: session.shop,
    settings: {
      ...settings,
      holidayWeekdays,
      holidayDates,
      blackout,
      calendarUi,
    },
  };
};

/* ---------- action ---------- */
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  const holidayWeekdays = WEEKDAYS.map((w) => w.value).filter(
    (v) => form.get(`holidayWeekday_${v}`) === "on",
  );

  const holidayDates = normalizeYmdList(String(form.get("holidayDatesLines") || ""));
  const blackout = normalizeYmdList(String(form.get("blackoutLines") || ""));

  const calendarUi = {
    mode: String(form.get("cal_mode") || "popup"),
    startWeek: String(form.get("cal_startWeek") || "sun"),
    colors: {
      disabledBg: String(form.get("cal_disabledBg") || "#f1f2f3"),
      blackoutBg: String(form.get("cal_blackoutBg") || "#fff2cc"),
      selectedBg: String(form.get("cal_selectedBg") || "#005bd3"),
      selectedText: String(form.get("cal_selectedText") || "#ffffff"),
      todayRing: String(form.get("cal_todayRing") || "#00a47c"),
    },
  };

  await updateDeliverySettings(session.shop, {
    holidaysJson: safeJsonStringify(Array.from(new Set([...holidayWeekdays, ...holidayDates]))),
    blackoutJson: safeJsonStringify(Array.from(new Set(blackout))),
    calendarUiJson: JSON.stringify(calendarUi),
  });

  return { ok: true, message: "保存しました" };
};

/* ---------- preview calendar (admin) ---------- */
function isHoliday(dateObj, weekdaySet, holidayDateSet) {
  const wk = WEEKDAY_KEYS[dateObj.getDay()];
  if (weekdaySet.has(wk)) return true;
  const ymd = formatYmd(dateObj);
  return holidayDateSet.has(ymd);
}

function buildPreviewCells({ viewMonth, startWeek, weekdaySet, holidayDateSet, blackoutSet }) {
  const ms = monthStart(viewMonth);
  const me = monthEnd(viewMonth);

  const monthFirstDow = ms.getDay(); // 0..6 Sun..Sat
  const offset = startWeek === "mon" ? (monthFirstDow === 0 ? 6 : monthFirstDow - 1) : monthFirstDow;

  const start = addDays(ms, -offset);

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const ymd = formatYmd(d);
    const inMonth = d.getMonth() === ms.getMonth();

    const holiday = isHoliday(d, weekdaySet, holidayDateSet);
    const blackout = blackoutSet.has(ymd);

    const kind = blackout ? "blackout" : "normal";
    const today = ymd === formatYmd(new Date());

    cells.push({
      key: ymd,
      ymd,
      day: d.getDate(),
      inMonth,
      holiday,
      kind,
      today,
    });
  }
  return { title: `${ms.getFullYear()}年 ${ms.getMonth() + 1}月`, cells };
}

export default function DeliveryCalendarRoute() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();

  // --- holidays/blackout state ---
  const [weekdayState, setWeekdayState] = useState(() => {
    const s = new Set(settings.holidayWeekdays || []);
    const obj = {};
    WEEKDAYS.forEach((w) => (obj[w.value] = s.has(w.value)));
    return obj;
  });

  const [holidayDatesLines, setHolidayDatesLines] = useState(arrayToLines(settings.holidayDates || []));
  const [blackoutLines, setBlackoutLines] = useState(arrayToLines(settings.blackout || []));

  // --- UI state ---
  const cal = settings.calendarUi || {};
  const colors = cal.colors || {};

  const [calMode, setCalMode] = useState(cal.mode || "popup");
  const [startWeek, setStartWeek] = useState(cal.startWeek || "sun");

  const [disabledBg, setDisabledBg] = useState(colors.disabledBg || "#f1f2f3");
  const [blackoutBg, setBlackoutBg] = useState(colors.blackoutBg || "#fff2cc");
  const [selectedBg, setSelectedBg] = useState(colors.selectedBg || "#005bd3");
  const [selectedText, setSelectedText] = useState(colors.selectedText || "#ffffff");
  const [todayRing, setTodayRing] = useState(colors.todayRing || "#00a47c");

  // --- preview controls ---
  const [previewMonth, setPreviewMonth] = useState(() => monthStart(new Date()));
  const [previewSelected, setPreviewSelected] = useState("");

  const selectedWeekdaysText = useMemo(() => {
    const selected = WEEKDAYS.filter((w) => weekdayState[w.value]).map((w) => w.value);
    return selected.length ? selected.join(", ") : "なし";
  }, [weekdayState]);

  const onSave = () => {
    const fd = new FormData();

    WEEKDAYS.forEach((w) => {
      if (weekdayState[w.value]) fd.set(`holidayWeekday_${w.value}`, "on");
    });

    fd.set("holidayDatesLines", holidayDatesLines);
    fd.set("blackoutLines", blackoutLines);

    fd.set("cal_mode", calMode);
    fd.set("cal_startWeek", startWeek);

    fd.set("cal_disabledBg", disabledBg);
    fd.set("cal_blackoutBg", blackoutBg);
    fd.set("cal_selectedBg", selectedBg);
    fd.set("cal_selectedText", selectedText);
    fd.set("cal_todayRing", todayRing);

    submit(fd, { method: "post" });
  };

  const quickSet = (mode) => {
    if (mode === "none") {
      const obj = {};
      WEEKDAYS.forEach((w) => (obj[w.value] = false));
      setWeekdayState(obj);
      return;
    }
    if (mode === "sun") {
      const obj = {};
      WEEKDAYS.forEach((w) => (obj[w.value] = w.value === "Sun"));
      setWeekdayState(obj);
      return;
    }
    if (mode === "sat_sun") {
      const obj = {};
      WEEKDAYS.forEach((w) => (obj[w.value] = w.value === "Sat" || w.value === "Sun"));
      setWeekdayState(obj);
      return;
    }
  };

  // --- preview data ---
  const weekdaySet = useMemo(() => {
    const s = new Set();
    WEEKDAYS.forEach((w) => {
      if (weekdayState[w.value]) s.add(w.value);
    });
    return s;
  }, [weekdayState]);

  const holidayDateSet = useMemo(() => new Set(normalizeYmdList(holidayDatesLines)), [holidayDatesLines]);
  const blackoutSet = useMemo(() => new Set(normalizeYmdList(blackoutLines)), [blackoutLines]);

  const preview = useMemo(() => {
    return buildPreviewCells({
      viewMonth: previewMonth,
      startWeek,
      weekdaySet,
      holidayDateSet,
      blackoutSet,
    });
  }, [previewMonth, startWeek, weekdaySet, holidayDateSet, blackoutSet]);

  const dowLabels = useMemo(() => {
    return startWeek === "mon"
      ? ["月", "火", "水", "木", "金", "土", "日"]
      : ["日", "月", "火", "水", "木", "金", "土"];
  }, [startWeek]);

  return (
    <Page
      title="カレンダー"
      subtitle="休日・お届け不可日、表示形式・配色を設定します"
      primaryAction={{ content: "保存", onAction: onSave }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionData?.message ? (
              <Banner
                status={actionData.ok ? "success" : "critical"}
                title={actionData.ok ? "保存しました" : "入力内容を確認してください"}
              >
                <p>{actionData.message}</p>
              </Banner>
            ) : null}

            {/* 休日 / 不可日 */}
            <Card sectioned>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  休日設定（出荷不可日）
                </Text>

                <Banner status="info" title="休日の考え方">
                  <List type="bullet">
                    <List.Item>休日は「お届け不可日」ではありません（選択不可にする設定ではありません）。</List.Item>
                    <List.Item>最短お届け日などの「営業日計算」に影響します。</List.Item>
                  </List>
                </Banner>

                <InlineStack gap="300" wrap>
                  <Button onClick={() => quickSet("none")}>休日なし</Button>
                  <Button onClick={() => quickSet("sun")}>日曜休み</Button>
                  <Button onClick={() => quickSet("sat_sun")}>土日休み</Button>
                </InlineStack>

                <Text as="p" tone="subdued">
                  現在：{selectedWeekdaysText}
                </Text>

                <Divider />

                <Text variant="headingMd" as="h3">
                  曜日指定
                </Text>

                <InlineStack gap="400" wrap>
                  {WEEKDAYS.map((w) => (
                    <Checkbox
                      key={w.value}
                      label={w.label}
                      checked={!!weekdayState[w.value]}
                      onChange={(checked) =>
                        setWeekdayState((prev) => ({ ...prev, [w.value]: checked }))
                      }
                    />
                  ))}
                </InlineStack>

                <Divider />

                <TextField
                  label="追加の休日（YYYY-MM-DD を1行1つ）"
                  value={holidayDatesLines}
                  onChange={setHolidayDatesLines}
                  multiline={5}
                  autoComplete="off"
                  helpText="曜日指定と合わせて休日扱い（出荷不可日）になります"
                />

                <Divider />

                <Text variant="headingMd" as="h2">
                  お届け不可日の設定
                </Text>

                <Text as="p" tone="subdued">
                  カート画面の日付指定で、選択できないようにしたい日がある場合に設定します。
                </Text>

                <TextField
                  label="お届け不可日（YYYY-MM-DD を1行1つ）"
                  value={blackoutLines}
                  onChange={setBlackoutLines}
                  multiline={6}
                  autoComplete="off"
                />
              </BlockStack>
            </Card>

            {/* UI設定 */}
            <Card sectioned>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  カレンダーUI設定
                </Text>

                <InlineStack gap="400" wrap>
                  <div style={{ minWidth: 240 }}>
                    <Select
                      label="表示形式"
                      options={[
                        { label: "ポップアップ", value: "popup" },
                        { label: "インライン", value: "inline" },
                      ]}
                      value={calMode}
                      onChange={setCalMode}
                    />
                  </div>

                  <div style={{ minWidth: 240 }}>
                    <Select
                      label="週の開始"
                      options={[
                        { label: "日曜始まり", value: "sun" },
                        { label: "月曜始まり", value: "mon" },
                      ]}
                      value={startWeek}
                      onChange={setStartWeek}
                    />
                  </div>
                </InlineStack>

                <Divider />

                <Text variant="headingMd" as="h2">
                  配色（プレビュー反映）
                </Text>

                <InlineStack gap="400" wrap>
                  <div style={{ minWidth: 240 }}>
                    <TextField label="無効/範囲外 背景色" type="color" value={disabledBg} onChange={setDisabledBg} />
                  </div>
                  <div style={{ minWidth: 240 }}>
                    <TextField label="お届け不可日 背景色" type="color" value={blackoutBg} onChange={setBlackoutBg} />
                  </div>
                  <div style={{ minWidth: 240 }}>
                    <TextField label="選択日 背景色" type="color" value={selectedBg} onChange={setSelectedBg} />
                  </div>
                  <div style={{ minWidth: 240 }}>
                    <TextField label="選択日 文字色" type="color" value={selectedText} onChange={setSelectedText} />
                  </div>
                  <div style={{ minWidth: 240 }}>
                    <TextField label="本日の枠色" type="color" value={todayRing} onChange={setTodayRing} />
                  </div>
                </InlineStack>

                <Text as="p" tone="subdued">
                  ※ 休日は「営業日計算」に影響する設定のため、背景色は付けません（プレビューでは下線で目印のみ）。
                </Text>
              </BlockStack>
            </Card>

            {/* プレビュー */}
            <Card sectioned>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">
                      プレビュー
                    </Text>
                    <Text as="p" tone="subdued">
                      {preview.title}（クリックで「選択状態」の見た目も確認できます）
                    </Text>
                  </BlockStack>

                  <InlineStack gap="200">
                    <Button
                      onClick={() => setPreviewMonth(new Date(previewMonth.getFullYear(), previewMonth.getMonth() - 1, 1))}
                    >
                      前月
                    </Button>
                    <Button
                      onClick={() => setPreviewMonth(new Date(previewMonth.getFullYear(), previewMonth.getMonth() + 1, 1))}
                    >
                      次月
                    </Button>
                  </InlineStack>
                </InlineStack>

                <Box
                  padding="400"
                  borderWidth="025"
                  borderColor="border"
                  borderRadius="200"
                  background="bg-surface"
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, 1fr)",
                      gap: 6,
                      marginBottom: 8,
                    }}
                  >
                    {dowLabels.map((t) => (
                      <div
                        key={t}
                        style={{ textAlign: "center", fontSize: 12, color: "#6d7175" }}
                      >
                        {t}
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
                    {preview.cells.map((c) => {
                      const isSelected = previewSelected === c.ymd;

                      let bg = "#ffffff";
                      let color = "#202223";
                      let opacity = c.inMonth ? 1 : 0.45;

                      if (c.kind === "blackout") bg = blackoutBg;
                      if (!c.inMonth) {
                        bg = disabledBg;
                        color = "#6d7175";
                      }

                      if (isSelected) {
                        bg = selectedBg;
                        color = selectedText;
                        opacity = 1;
                      }

                      const todayRingShadow =
                        c.today && !isSelected ? `0 0 0 2px ${todayRing} inset` : "none";
                      const holidayMark = c.holiday && c.inMonth ? "underline" : "none";

                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => setPreviewSelected(c.ymd)}
                          style={{
                            width: "100%",
                            aspectRatio: "1 / 1",
                            borderRadius: 10,
                            border: "1px solid rgba(0,0,0,0.08)",
                            background: bg,
                            color,
                            opacity,
                            cursor: "pointer",
                            fontSize: 13,
                            boxShadow: todayRingShadow,
                            textDecoration: holidayMark,
                            textUnderlineOffset: 3,
                          }}
                          title={
                            c.kind === "blackout"
                              ? "お届け不可日"
                              : c.holiday
                                ? "休日（出荷不可日：選択不可ではない）"
                                : c.ymd
                          }
                        >
                          {c.day}
                        </button>
                      );
                    })}
                  </div>

                  <Box paddingBlockStart="300">
                    <InlineStack gap="400" wrap>
                      <InlineStack gap="200" blockAlign="center">
                        <span style={{ width: 12, height: 12, display: "inline-block", background: blackoutBg, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 3 }} />
                        <Text as="span" tone="subdued">お届け不可日</Text>
                      </InlineStack>

                      <InlineStack gap="200" blockAlign="center">
                        <span style={{ width: 12, height: 12, display: "inline-block", background: selectedBg, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 3 }} />
                        <Text as="span" tone="subdued">選択</Text>
                      </InlineStack>

                      <InlineStack gap="200" blockAlign="center">
                        <span style={{ width: 12, height: 12, display: "inline-block", background: disabledBg, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 3 }} />
                        <Text as="span" tone="subdued">無効/範囲外（プレビュー用）</Text>
                      </InlineStack>

                      <InlineStack gap="200" blockAlign="center">
                        <span style={{ width: 12, height: 12, display: "inline-block", border: `2px solid ${todayRing}`, borderRadius: 3 }} />
                        <Text as="span" tone="subdued">今日（枠）</Text>
                      </InlineStack>

                      <Text as="span" tone="subdued">休日は背景色なし（下線）</Text>
                    </InlineStack>
                  </Box>
                </Box>

                <Text as="p" tone="subdued">
                  選択中：{previewSelected || "なし"}
                </Text>
              </BlockStack>
            </Card>

            {/* 下部保存ボタン + 余白 */}
            <Box paddingBlockStart="200" paddingBlockEnd="800">
              <InlineStack align="end" gap="300">
                <Button variant="primary" onClick={onSave}>
                  保存
                </Button>
              </InlineStack>
            </Box>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

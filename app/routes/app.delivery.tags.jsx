// app/routes/app.delivery.tags.jsx
// @ts-nocheck
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
  Badge,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import {
  getOrCreateDeliverySettings,
  updateDeliverySettings,
  safeJsonArray,
  safeJsonStringify,
} from "../models/deliverySettings.server";

/* ================= helpers ================= */

function splitLinesToArray(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function arrayToLines(arr) {
  return (arr || []).join("\n");
}
function normalizeTimeSlots(lines) {
  // 文言は絶対に変更しない前提：
  // - HH:mm-HH:mm も許可
  // - 「午前」「午後」「午前中」など文言も許可
  // - 全角チルダ/波ダッシュ/ハイフン揺れも許可（値は変更しない＝そのまま保存）
  const arr = splitLinesToArray(lines);

  const allowedText = new Set(["午前", "午後", "午前中"]);

  const reRange = /^\d{1,2}:\d{2}\s*[-ー–—〜～]\s*\d{1,2}:\d{2}$/;

  const out = [];
  const seen = new Set();

  for (const s of arr) {
    // 既定の文言はそのまま許可（変更しない）
    const ok = allowedText.has(s) || reRange.test(s);

    if (!ok) continue; // 許可されない行だけ落とす（文言は改変しない）
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
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
function toIntOrUndef(v) {
  if (v === "" || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}
function toBool(v) {
  return v === true || v === "true";
}

// ✅ UI専用の安定ID（key用）
function makeUiId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `r_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/* ================= const ================= */

const CARRIER_OPTIONS = [
  { label: "ヤマト運輸", value: "yamato" },
  { label: "佐川急便", value: "sagawa" },
  { label: "日本郵便（ゆうパック）", value: "yuupack" },
  { label: "福山通運", value: "fukuyama" },
  { label: "西濃運輸", value: "seino" },
  { label: "日本通運", value: "nittsu" },
  { label: "カスタム", value: "custom" },
];

const PRESET_TIME_SLOTS = {
  yamato: [
    "08:00-12:00",
    "12:00-14:00",
    "14:00-16:00",
    "16:00-18:00",
    "18:00-20:00",
    "19:00-21:00"
  ],
  sagawa: [
    "08:00-12:00",
    "12:00-14:00",
    "14:00-16:00",
    "16:00-18:00",
    "18:00-20:00",
    "19:00-21:00"
  ],
  yuupack: [
    "午前中",
    "12:00-14:00",
    "14:00-16:00",
    "16:00-18:00",
    "18:00-20:00",
    "19:00-21:00"
  ],
  fukuyama: [
    "10:00-12:00",
    "12:00-14:00",
    "14:00-16:00",
    "16:00-18:00",
    "18:00～20:00"
  ],
  seino: [
    "午前",
    "午後"
  ],
  nittsu: [
    "午前中",
    "午後"
  ],
};

/* ================= shape (loader -> UI state) ================= */

function ensureOverrideShape(rule) {
  const r = rule && typeof rule === "object" && !Array.isArray(rule) ? rule : {};
  const tag = typeof r.tag === "string" ? r.tag : "";
  const ov = r.override && typeof r.override === "object" && !Array.isArray(r.override) ? r.override : {};

  const carrierPresetRaw = typeof ov.carrierPreset === "string" ? ov.carrierPreset : "yamato";
  const carrierPreset = CARRIER_OPTIONS.some((o) => o.value === carrierPresetRaw) ? carrierPresetRaw : "yamato";
  const timeSlots = Array.isArray(ov.timeSlots) ? ov.timeSlots : [];

  return {
    __uiId: typeof r.__uiId === "string" && r.__uiId ? r.__uiId : makeUiId(),

    tag,
    override: {
      leadTimeDays: ov.leadTimeDays ?? undefined,
      rangeDays: ov.rangeDays ?? undefined,

      showDate: toBool(ov.showDate),
      requireDate: toBool(ov.requireDate),

      showTime: toBool(ov.showTime),
      requireTime: toBool(ov.requireTime),

      showPlacement: toBool(ov.showPlacement),

      carrierPreset,
      timeSlots,

      customTimeSlotsLines: carrierPreset === "custom" ? arrayToLines(timeSlots) : "",
    },
  };
}

function emptyRule() {
  return {
    __uiId: makeUiId(),
    tag: "",
    override: {
      leadTimeDays: undefined,
      rangeDays: undefined,

      showDate: false,
      requireDate: false,

      showTime: false,
      requireTime: false,

      showPlacement: false,

      carrierPreset: "yamato",
      timeSlots: [],
      customTimeSlotsLines: "",
    },
  };
}

/**
 * 保存前正規化（action）
 */
function normalizeTagOverrides(rawJsonStr) {
  let arr;
  try {
    arr = JSON.parse(String(rawJsonStr || "[]"));
  } catch {
    throw new Error("override ルールのデータが壊れています（保存をやり直してください）");
  }
  if (!Array.isArray(arr)) throw new Error("override ルールの形式が不正です（配列である必要があります）");

  const seen = new Set();
  const out = [];

  for (const item of arr) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    const tag = String(item.tag || "").trim();
    if (!tag) throw new Error("override ルールに空のタグがあります");
    if (seen.has(tag)) throw new Error(`override ルールのタグが重複しています: ${tag}`);
    seen.add(tag);

    const ov = item.override && typeof item.override === "object" && !Array.isArray(item.override) ? item.override : {};

    const leadTimeDays = toIntOrUndef(ov.leadTimeDays);
    const rangeDays = toIntOrUndef(ov.rangeDays);

    const carrierPreset = String(ov.carrierPreset || "yamato").trim();
    if (!CARRIER_OPTIONS.some((o) => o.value === carrierPreset)) {
      throw new Error(`配送業者が不正です（tag: ${tag}）`);
    }

    const customSlots = normalizeTimeSlots(String(ov.customTimeSlotsLines || ""));
    const slotsToSave =
      carrierPreset === "custom"
        ? customSlots
        : (PRESET_TIME_SLOTS[carrierPreset] || PRESET_TIME_SLOTS.yamato || []);

    out.push({
      tag,
      override: {
        ...(leadTimeDays !== undefined ? { leadTimeDays } : {}),
        ...(rangeDays !== undefined ? { rangeDays } : {}),

        showDate: !!ov.showDate,
        requireDate: !!ov.requireDate,

        showTime: !!ov.showTime,
        requireTime: !!ov.requireTime,

        showPlacement: !!ov.showPlacement,

        carrierPreset,
        timeSlots: uniqStrings(slotsToSave),
      },
    });
  }

  return out;
}

/* ================= loader / action ================= */

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const row = await getOrCreateDeliverySettings(session.shop);

  const denyTags = safeJsonArray(row?.denyProductTagsJson);
  const overridesRaw = safeJsonArray(row?.tagOverridesJson);

  return {
    shop: session.shop,
    settings: {
      denyTags: Array.isArray(denyTags) ? denyTags : [],
      tagOverrides: Array.isArray(overridesRaw) ? overridesRaw.map(ensureOverrideShape) : [],
    },
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  const denyTagsLines = String(form.get("denyTagsLines") || "");
  const denyTags = uniqStrings(splitLinesToArray(denyTagsLines));

  const tagOverridesJson = String(form.get("tagOverridesJson") || "[]");

  try {
    const normalizedOverrides = normalizeTagOverrides(tagOverridesJson);

    await updateDeliverySettings(session.shop, {
      denyProductTagsJson: safeJsonStringify(denyTags),
      tagOverridesJson: safeJsonStringify(normalizedOverrides),
    });

    return { ok: true, message: "保存しました" };
  } catch (e) {
    return { ok: false, message: e?.message || "保存に失敗しました" };
  }
};

/* ================= UI ================= */

export default function DeliveryTagsRoute() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();

  const [denyTagsLines, setDenyTagsLines] = useState(arrayToLines(settings.denyTags || []));
  const [tagOverrides, setTagOverrides] = useState(() => {
    const arr = Array.isArray(settings.tagOverrides) ? settings.tagOverrides : [];
    return arr.map(ensureOverrideShape);
  });

  const presetPreview = useMemo(() => {
    return (carrierPreset) => {
      if (carrierPreset === "custom") return "";
      return (PRESET_TIME_SLOTS[carrierPreset] || []).join("\n");
    };
  }, []);

  const moveRule = (from, to) => {
    setTagOverrides((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (to < 0 || to >= list.length) return list;
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const addRule = () => setTagOverrides((prev) => [...(Array.isArray(prev) ? prev : []), emptyRule()]);
  const removeRule = (idx) => setTagOverrides((prev) => (prev || []).filter((_, i) => i !== idx));

  const setTagAt = (idx, value) => {
    setTagOverrides((prev) => (prev || []).map((r, i) => (i === idx ? { ...r, tag: value } : r)));
  };

  const updateOverride = (idx, patch) => {
    setTagOverrides((prev) =>
      (prev || []).map((r, i) => (i === idx ? { ...r, override: { ...(r.override || {}), ...patch } } : r)),
    );
  };

  const onSave = () => {
    const fd = new FormData();
    fd.set("denyTagsLines", denyTagsLines);

    const cleaned = (tagOverrides || []).map((r) => {
      const tag = String(r?.tag || "");
      const ov = r?.override || {};
      return {
        tag,
        override: {
          leadTimeDays: ov.leadTimeDays,
          rangeDays: ov.rangeDays,

          showDate: !!ov.showDate,
          requireDate: !!ov.requireDate,

          showTime: !!ov.showTime,
          requireTime: !!ov.requireTime,

          showPlacement: !!ov.showPlacement,

          carrierPreset: String(ov.carrierPreset || "yamato"),
          customTimeSlotsLines: String(ov.customTimeSlotsLines || ""),
        },
      };
    });

    fd.set("tagOverridesJson", JSON.stringify(cleaned));
    submit(fd, { method: "post" });
  };

  return (
    <Page
      title="タグ条件設定"
      subtitle="商品タグに応じて「日時指定の無効化」や「条件の上書き」ができます"
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

            {/* ===== deny ===== */}
            <Card sectioned>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="headingMd" as="h2">
                      日時指定を無効化するタグ（deny）
                    </Text>
                    <Badge status="critical">最優先</Badge>
                  </InlineStack>
                </InlineStack>

                <Banner status="info" title="動作">
                  <List type="bullet">
                    <List.Item>カート内に対象タグの商品が1つでも含まれると、日時指定は表示されません。</List.Item>
                    <List.Item>deny は override より優先されます。</List.Item>
                  </List>
                </Banner>

                <TextField
                  label="deny タグ（1行1つ）"
                  value={denyTagsLines}
                  onChange={setDenyTagsLines}
                  multiline={6}
                  autoComplete="off"
                  placeholder={`no_delivery_datetime\nfrozen\nlarge_item`}
                  helpText="タグ名はそのまま入力（記号不要）"
                />

                <button type="button" style={{ display: "none" }} />
              </BlockStack>
            </Card>

            {/* ===== override ===== */}
            <Card sectioned>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="headingMd" as="h2">
                      タグ別の上書きルール（override）
                    </Text>
                  </InlineStack>

                  <Button onClick={addRule}>ルールを追加</Button>
                </InlineStack>

                <Text as="p" tone="subdued">
                  上から順に評価され、<strong>上にあるルールほど優先度が高い</strong>です。↑↓で並び替えできます。※並び替え後は保存してください
                </Text>

                {tagOverrides.length === 0 ? (
                  <Banner status="info" title="override ルールは未設定です">
                    <p>「ルールを追加」から、タグ別の上書き設定を作成できます。</p>
                  </Banner>
                ) : null}

                <BlockStack gap="400">
                  {tagOverrides.map((rule, idx) => {
                    const ov = rule?.override || {};
                    const carrierPreset = String(ov.carrierPreset || "yamato");

                    return (
                      <Card key={rule.__uiId} sectioned>
                        <BlockStack gap="400">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                              <Text variant="headingMd" as="h3">
                                ルール #{idx + 1}
                              </Text>
                              <Badge status="new">優先度 {idx + 1}</Badge>
                            </InlineStack>

                            <InlineStack gap="200" wrap={false}>
                              <Button size="slim" disabled={idx === 0} onClick={() => moveRule(idx, idx - 1)}>
                                ↑
                              </Button>
                              <Button
                                size="slim"
                                disabled={idx === tagOverrides.length - 1}
                                onClick={() => moveRule(idx, idx + 1)}
                              >
                                ↓
                              </Button>
                              <Button tone="critical" onClick={() => removeRule(idx)}>
                                削除
                              </Button>
                            </InlineStack>
                          </InlineStack>

                          <Divider />

                          <TextField
                            label="対象タグ（必須）"
                            value={String(rule?.tag || "")}
                            onChange={(value) => setTagAt(idx, value)}
                            autoComplete="off"
                            placeholder="made_to_order"
                            helpText="タグ名はそのまま入力（記号不要）"
                          />

                          <InlineStack gap="400" wrap>
                            <TextField
                              label="最短お届け日数"
                              type="number"
                              value={ov.leadTimeDays === undefined || ov.leadTimeDays === null ? "" : String(ov.leadTimeDays)}
                              onChange={(v) => updateOverride(idx, { leadTimeDays: v === "" ? undefined : Number(v) })}
                              autoComplete="off"
                            />
                            <TextField
                              label="お届け可能期間（日）"
                              type="number"
                              value={ov.rangeDays === undefined || ov.rangeDays === null ? "" : String(ov.rangeDays)}
                              onChange={(v) => updateOverride(idx, { rangeDays: v === "" ? undefined : Number(v) })}
                              autoComplete="off"
                            />
                          </InlineStack>

                          <Divider />

                          <Text variant="headingMd" as="h3">
                            配送業者 / 配送可能時間
                          </Text>

                          <Select
                            label="配送業者"
                            options={CARRIER_OPTIONS}
                            value={carrierPreset}
                            onChange={(v) => {
                              updateOverride(idx, {
                                carrierPreset: v,
                                customTimeSlotsLines: v === "custom" ? String(ov.customTimeSlotsLines || "") : "",
                              });
                            }}
                          />

                          {carrierPreset === "custom" ? (
                            <TextField
                              label="配送可能時間（カスタム：1行1つ / 例 08:00-12:00）"
                              value={String(ov.customTimeSlotsLines || "")}
                              onChange={(v) => updateOverride(idx, { customTimeSlotsLines: v })}
                              multiline={6}
                              autoComplete="off"
                              helpText=""
                            />
                          ) : (
                            <TextField
                              label="配送可能時間（規定値・編集不可）"
                              value={presetPreview(carrierPreset)}
                              onChange={() => {}}
                              multiline={6}
                              autoComplete="off"
                              disabled
                            />
                          )}

                          <Divider />

                          <Text variant="headingMd" as="h3">
                            表示 / 必須（ON / OFF）
                          </Text>

                          <InlineStack gap="600" wrap>
                            <Checkbox
                              label="配送日を表示"
                              checked={!!ov.showDate}
                              onChange={(v) => updateOverride(idx, { showDate: v })}
                            />
                            <Checkbox
                              label="配送時間を表示"
                              checked={!!ov.showTime}
                              onChange={(v) => updateOverride(idx, { showTime: v })}
                            />
                            <Checkbox
                              label="置き配（自由入力）を表示"
                              checked={!!ov.showPlacement}
                              onChange={(v) => updateOverride(idx, { showPlacement: v })}
                            />
                          </InlineStack>

                          <InlineStack gap="600" wrap>
                            <Checkbox
                              label="配送日を必須"
                              checked={!!ov.requireDate}
                              onChange={(v) => updateOverride(idx, { requireDate: v })}
                              disabled={!ov.showDate}
                            />
                            <Checkbox
                              label="配送時間を必須"
                              checked={!!ov.requireTime}
                              onChange={(v) => updateOverride(idx, { requireTime: v })}
                              disabled={!ov.showTime}
                            />
                          </InlineStack>

                          <button type="button" style={{ display: "none" }} />
                        </BlockStack>
                      </Card>
                    );
                  })}
                </BlockStack>

                <button type="button" style={{ display: "none" }} />
              </BlockStack>
            </Card>

            {/* ===== bottom action ===== */}
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

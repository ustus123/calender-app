// app/routes/app.delivery.basic.jsx
import { useEffect, useMemo, useState } from "react";
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

/** helpers */
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
  const re = /^\d{2}:\d{2}-\d{2}:\d{2}$/;
  return splitLinesToArray(lines).filter((s) => re.test(s));
}
function isValidHHMM(s) {
  return typeof s === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(s.trim());
}
function isValidMetafieldKey(s) {
  return typeof s === "string" && /^[a-z0-9_]+$/.test(s.trim());
}

const CARRIER_OPTIONS = [
  { label: "ヤマト運輸", value: "yamato" },
  { label: "佐川急便", value: "sagawa" },
  { label: "日本郵便（ゆうパック）", value: "yuupack" },
  { label: "福山通運", value: "fukuyama" },
  { label: "西濃運輸（カンガルーミニ便）", value: "seino_mini" },
  { label: "西濃運輸（カンガルー通販便）", value: "seino_tsuhan" },
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
    "19:00-21:00",
  ],
  sagawa: [
    "08:00-12:00",
    "12:00-14:00",
    "14:00-16:00",
    "16:00-18:00",
    "18:00-20:00",
    "19:00-21:00",
  ],
  yuupack: ["午前中", "12:00-14:00", "14:00-16:00", "16:00-18:00", "18:00-20:00", "19:00-21:00"],
  fukuyama: ["指定なし"],
  seino_mini: ["指定なし"],
  seino_tsuhan: ["指定なし"],
  nittsu: ["指定なし"],
};

const CUTOFF_OPTIONS = [
  { label: "設定しない", value: "" },
  { label: "09:00", value: "09:00" },
  { label: "10:00", value: "10:00" },
  { label: "11:00", value: "11:00" },
  { label: "12:00", value: "12:00" },
  { label: "13:00", value: "13:00" },
  { label: "14:00", value: "14:00" },
  { label: "15:00", value: "15:00" },
  { label: "16:00", value: "16:00" },
  { label: "17:00", value: "17:00" },
  { label: "18:00", value: "18:00" },
];

const CUTOFF_MODE_OPTIONS = [
  { label: "設定しない", value: "none" },
  { label: "選択する", value: "select" },
  { label: "手入力（HH:mm）", value: "manual" },
];

function inferCutoffMode(cutoffTime) {
  const v = String(cutoffTime || "").trim();
  if (!v) return "none";
  const inOptions = CUTOFF_OPTIONS.some((o) => o.value === v);
  return inOptions ? "select" : "manual";
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getOrCreateDeliverySettings(session.shop);

  return {
    shop: session.shop,
    settings: {
      ...settings,
      timeSlots: safeJsonArray(settings.timeSlotsJson),
    },
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  const leadTimeDays = Number(form.get("leadTimeDays") || 1);
  const rangeDays = Number(form.get("rangeDays") || 30);

  const carrierPreset = String(form.get("carrierPreset") || "yamato").trim();

  const cutoffMode = String(form.get("cutoffMode") || "none");
  const cutoffSelect = String(form.get("cutoffSelect") || "").trim();
  const cutoffManual = String(form.get("cutoffManual") || "").trim();

  let cutoffTimeFinal = "";
  if (cutoffMode === "select") cutoffTimeFinal = cutoffSelect || "";
  if (cutoffMode === "manual") cutoffTimeFinal = cutoffManual || "";
  if (cutoffMode === "none") cutoffTimeFinal = "";

  const noticeText = String(form.get("noticeText") || "");

  const customTimeSlots = normalizeTimeSlots(String(form.get("customTimeSlotsLines") || ""));

  const showPlacement = form.get("showPlacement") === "on";
  const showDate = form.get("showDate") === "on";
  const showTime = form.get("showTime") === "on";

  const requireDate = form.get("requireDate") === "on";
  const requireTime = form.get("requireTime") === "on";

  const attrDateName = String(form.get("attrDateName") || "delivery_date").trim();
  const attrTimeName = String(form.get("attrTimeName") || "delivery_time").trim();
  const attrPlacementName = String(form.get("attrPlacementName") || "delivery_placement").trim();

  const saveToOrderMetafields = form.get("saveToOrderMetafields") === "on";
  const metafieldNamespace = String(form.get("metafieldNamespace") || "custom").trim();
  const metafieldDateKey = String(form.get("metafieldDateKey") || "delivery_date").trim();
  const metafieldTimeKey = String(form.get("metafieldTimeKey") || "delivery_time").trim();
  const metafieldPlacementKey = String(form.get("metafieldPlacementKey") || "delivery_placement").trim();

  const errors = [];
  if (!Number.isFinite(leadTimeDays) || leadTimeDays < 0) errors.push("最短お届け日数は0以上にしてください");
  if (!Number.isFinite(rangeDays) || rangeDays < 1) errors.push("お届け可能期間は1以上にしてください");
  if (!CARRIER_OPTIONS.some((o) => o.value === carrierPreset)) errors.push("配送業者が不正です");

  if (cutoffTimeFinal && !isValidHHMM(cutoffTimeFinal)) errors.push("締め時間は HH:mm（例 15:00）か未設定にしてください");

  if (!attrDateName) errors.push("配送日 属性名が空です");
  if (!attrTimeName) errors.push("配送時間 属性名が空です");
  if (!attrPlacementName) errors.push("置き配 属性名が空です");

  if (saveToOrderMetafields) {
    if (!metafieldNamespace) errors.push("メタフィールド namespace が空です");
    if (!metafieldDateKey) errors.push("メタフィールド（日付）key が空です");
    if (!metafieldTimeKey) errors.push("メタフィールド（時間）key が空です");
    if (!metafieldPlacementKey) errors.push("メタフィールド（置き配）key が空です");

    if (metafieldNamespace && !isValidMetafieldKey(metafieldNamespace)) {
      errors.push("namespace は半角英小文字/数字/アンダースコアのみ（例: custom）");
    }
    if (metafieldDateKey && !isValidMetafieldKey(metafieldDateKey)) {
      errors.push("日付 key は半角英小文字/数字/アンダースコアのみ（例: delivery_date）");
    }
    if (metafieldTimeKey && !isValidMetafieldKey(metafieldTimeKey)) {
      errors.push("時間 key は半角英小文字/数字/アンダースコアのみ（例: delivery_time）");
    }
    if (metafieldPlacementKey && !isValidMetafieldKey(metafieldPlacementKey)) {
      errors.push("置き配 key は半角英小文字/数字/アンダースコアのみ（例: delivery_placement）");
    }
  }

  const requireDateFinal = showDate ? requireDate : false;
  const requireTimeFinal = showTime ? requireTime : false;

  if (errors.length) return { ok: false, message: errors.join(" / ") };

  const slotsToSave =
    carrierPreset === "custom"
      ? customTimeSlots
      : (PRESET_TIME_SLOTS[carrierPreset] || PRESET_TIME_SLOTS.yamato || []);

  await updateDeliverySettings(session.shop, {
    leadTimeDays,
    rangeDays,
    cutoffTime: cutoffTimeFinal,

    carrierPreset,
    timeSlotsJson: safeJsonStringify(slotsToSave),

    showDate,
    showTime,
    showPlacement,

    requireDate: requireDateFinal,
    requireTime: requireTimeFinal,

    noticeText,

    attrDateName,
    attrTimeName,
    attrPlacementName,

    saveToOrderMetafields,
    metafieldNamespace,
    metafieldDateKey,
    metafieldTimeKey,
    metafieldPlacementKey,
  });

  return { ok: true, message: "保存しました" };
};

export default function DeliveryBasicRoute() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();

  const [leadTimeDays, setLeadTimeDays] = useState(String(settings.leadTimeDays ?? 1));
  const [rangeDays, setRangeDays] = useState(String(settings.rangeDays ?? 30));

  const [carrierPreset, setCarrierPreset] = useState(String(settings.carrierPreset ?? "yamato"));
  const [customTimeSlotsLines, setCustomTimeSlotsLines] = useState(arrayToLines(settings.timeSlots || []));

  const initialCutoff = String(settings.cutoffTime ?? "");
  const [cutoffMode, setCutoffMode] = useState(inferCutoffMode(initialCutoff));
  const [cutoffSelect, setCutoffSelect] = useState(
    CUTOFF_OPTIONS.some((o) => o.value === initialCutoff) ? initialCutoff : "15:00",
  );
  const [cutoffManual, setCutoffManual] = useState(
    !CUTOFF_OPTIONS.some((o) => o.value === initialCutoff) ? initialCutoff : "",
  );

  const [showDate, setShowDate] = useState(Boolean(settings.showDate ?? true));
  const [showTime, setShowTime] = useState(Boolean(settings.showTime ?? true));
  const [showPlacement, setShowPlacement] = useState(Boolean(settings.showPlacement ?? false));

  const [requireDate, setRequireDate] = useState(Boolean(settings.requireDate ?? true));
  const [requireTime, setRequireTime] = useState(Boolean(settings.requireTime ?? false));

  const [noticeText, setNoticeText] = useState(String(settings.noticeText || ""));

  const [attrDateName, setAttrDateName] = useState(String(settings.attrDateName || "delivery_date"));
  const [attrTimeName, setAttrTimeName] = useState(String(settings.attrTimeName || "delivery_time"));
  const [attrPlacementName, setAttrPlacementName] = useState(String(settings.attrPlacementName || "delivery_placement"));

  const [saveToOrderMetafields, setSaveToOrderMetafields] = useState(Boolean(settings.saveToOrderMetafields ?? false));
  const [metafieldNamespace, setMetafieldNamespace] = useState(String(settings.metafieldNamespace || "custom"));
  const [metafieldDateKey, setMetafieldDateKey] = useState(String(settings.metafieldDateKey || "delivery_date"));
  const [metafieldTimeKey, setMetafieldTimeKey] = useState(String(settings.metafieldTimeKey || "delivery_time"));
  const [metafieldPlacementKey, setMetafieldPlacementKey] = useState(String(settings.metafieldPlacementKey || "delivery_placement"));

  useEffect(() => {
    if (!showDate && requireDate) setRequireDate(false);
  }, [showDate, requireDate]);
  useEffect(() => {
    if (!showTime && requireTime) setRequireTime(false);
  }, [showTime, requireTime]);

  useEffect(() => {
    if (cutoffMode === "none") setCutoffManual("");
  }, [cutoffMode]);

  const presetPreview = useMemo(() => {
    if (carrierPreset === "custom") return "";
    return (PRESET_TIME_SLOTS[carrierPreset] || []).join("\n");
  }, [carrierPreset]);

  const onSave = () => {
    const fd = new FormData();

    fd.set("leadTimeDays", leadTimeDays);
    fd.set("rangeDays", rangeDays);

    fd.set("carrierPreset", carrierPreset);
    fd.set("customTimeSlotsLines", customTimeSlotsLines);

    fd.set("cutoffMode", cutoffMode);
    fd.set("cutoffSelect", cutoffSelect);
    fd.set("cutoffManual", cutoffManual);

    if (showDate) fd.set("showDate", "on");
    if (showTime) fd.set("showTime", "on");
    if (showPlacement) fd.set("showPlacement", "on");

    if (requireDate) fd.set("requireDate", "on");
    if (requireTime) fd.set("requireTime", "on");

    fd.set("noticeText", noticeText);

    fd.set("attrDateName", attrDateName);
    fd.set("attrTimeName", attrTimeName);
    fd.set("attrPlacementName", attrPlacementName);

    if (saveToOrderMetafields) fd.set("saveToOrderMetafields", "on");
    fd.set("metafieldNamespace", metafieldNamespace);
    fd.set("metafieldDateKey", metafieldDateKey);
    fd.set("metafieldTimeKey", metafieldTimeKey);
    fd.set("metafieldPlacementKey", metafieldPlacementKey);

    submit(fd, { method: "post" });
  };

  return (
    <Page
      title="基本設定"
      subtitle="配送日時指定の基本ルールを設定します"
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

            {/* 受付条件 */}
            <Card sectioned>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  受付条件
                </Text>

                <InlineStack gap="400" wrap>
                  <TextField
                    label="最短お届け日数"
                    type="number"
                    value={leadTimeDays}
                    onChange={setLeadTimeDays}
                    autoComplete="off"
                    helpText="例：1 なら、最短で明日以降が選択可能になります"
                  />
                  <TextField
                    label="お届け可能期間（日）"
                    type="number"
                    value={rangeDays}
                    onChange={setRangeDays}
                    autoComplete="off"
                    helpText="例：30 なら、最短日から30日先まで選択できます"
                  />
                </InlineStack>
              </BlockStack>
            </Card>

            {/* 配送時間帯 */}
            <Card sectioned>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  配送業者・時間帯
                </Text>

                <Select
                  label="配送業者"
                  options={CARRIER_OPTIONS}
                  value={carrierPreset}
                  onChange={setCarrierPreset}
                />

                {carrierPreset === "custom" ? (
                  <TextField
                    label="配送可能時間（カスタム：1行1つ / 例 08:00-12:00）"
                    value={customTimeSlotsLines}
                    onChange={setCustomTimeSlotsLines}
                    multiline={6}
                    autoComplete="off"
                    helpText="HH:mm-HH:mm 形式の行だけ保存されます"
                  />
                ) : (
                  <TextField
                    label="配送可能時間（規定値・編集不可）"
                    value={presetPreview}
                    onChange={() => {}}
                    multiline={6}
                    autoComplete="off"
                    disabled
                  />
                )}
              </BlockStack>
            </Card>

            {/* 表示 / 必須 */}
            <Card sectioned>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  表示 / 必須
                </Text>

                <BlockStack gap="200">
                  <Text as="p" tone="subdued">
                    表示をOFFにした項目は、必須にできません（矛盾防止のため自動でOFFになります）。
                  </Text>

                  <InlineStack gap="600" wrap>
                    <Checkbox label="配送日を表示" checked={showDate} onChange={setShowDate} />
                    <Checkbox label="配送時間を表示" checked={showTime} onChange={setShowTime} />
                    <Checkbox label="置き配（自由入力）を表示" checked={showPlacement} onChange={setShowPlacement} />
                  </InlineStack>

                  <InlineStack gap="600" wrap>
                    <Checkbox label="配送日を必須" checked={requireDate} onChange={setRequireDate} disabled={!showDate} />
                    <Checkbox label="配送時間を必須" checked={requireTime} onChange={setRequireTime} disabled={!showTime} />
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>

            {/* 締め時間 */}
            <Card sectioned>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  注文締め時間（任意）
                </Text>

                <Select
                  label="設定方法"
                  options={CUTOFF_MODE_OPTIONS}
                  value={cutoffMode}
                  onChange={setCutoffMode}
                />

                {cutoffMode === "select" ? (
                  <Select
                    label="締め時間（選択）"
                    options={CUTOFF_OPTIONS.filter((o) => o.value !== "")}
                    value={cutoffSelect || "15:00"}
                    onChange={setCutoffSelect}
                    helpText="締め時間を過ぎてカートにアクセスした場合、最短お届け日を+1日します"
                  />
                ) : null}

                {cutoffMode === "manual" ? (
                  <TextField
                    label="締め時間（手入力 / HH:mm）"
                    value={cutoffManual}
                    onChange={setCutoffManual}
                    placeholder="15:00"
                    autoComplete="off"
                    helpText="締め時間を過ぎてカートにアクセスした場合、最短お届け日を+1日します"
                  />
                ) : null}

                {cutoffMode === "none" ? (
                  <Banner status="info">
                    締め時間は未設定です（最短お届け日の繰り下げは行いません）。
                  </Banner>
                ) : null}
              </BlockStack>
            </Card>

            {/* 注意文 */}
            <Card sectioned>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  カート注意文言（任意）
                </Text>
                <TextField
                  label="注意文言"
                  value={noticeText}
                  onChange={setNoticeText}
                  multiline={4}
                  autoComplete="off"
                  helpText="設定するとカレンダーの下に表示されます"
                />
              </BlockStack>
            </Card>

            {/* 取り込み設定 */}
            <Card sectioned>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  取り込み設定（カート属性名）
                </Text>

                <InlineStack gap="400" wrap>
                  <TextField label="配送日 属性名" value={attrDateName} onChange={setAttrDateName} autoComplete="off" />
                  <TextField label="配送時間 属性名" value={attrTimeName} onChange={setAttrTimeName} autoComplete="off" />
                  <TextField label="置き配 属性名" value={attrPlacementName} onChange={setAttrPlacementName} autoComplete="off" />
                </InlineStack>

                <Banner status="info" title="外部連携のポイント">
                  <List type="bullet">
                    <List.Item>
                      外部の受注管理システムが読み取る項目名に合わせたい場合は、ここで属性名を変更してください。
                    </List.Item>
                    <List.Item>
                      ご利用方法ページの「メール表示」「外部連携」のコピー用コードは、この設定に合わせて自動生成されます。
                    </List.Item>
                  </List>
                </Banner>
              </BlockStack>
            </Card>

            {/* メタフィールド */}
            <Card sectioned>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  注文メタフィールド保存（任意）
                </Text>

                <Checkbox
                  label="注文メタフィールドにも保存する（Webhook）"
                  checked={saveToOrderMetafields}
                  onChange={setSaveToOrderMetafields}
                />

                <Text as="p" tone="subdued">
                  ONにすると、注文作成時（ORDERS_CREATE）に「配送希望日・配送希望時間・置き配」を
                  Orderメタフィールドへ保存します。Shopify Flowや独自連携で使いたい場合に有効です。
                </Text>

                {saveToOrderMetafields ? (
                  <BlockStack gap="300">
                    <InlineStack gap="400" wrap>
                      <TextField
                        label="namespace（半角英小文字/数字/_）"
                        value={metafieldNamespace}
                        onChange={setMetafieldNamespace}
                        autoComplete="off"
                        helpText="例: custom"
                      />
                      <TextField
                        label="日付 key（半角英小文字/数字/_）"
                        value={metafieldDateKey}
                        onChange={setMetafieldDateKey}
                        autoComplete="off"
                        helpText="例: delivery_date"
                      />
                    </InlineStack>

                    <InlineStack gap="400" wrap>
                      <TextField
                        label="時間 key（半角英小文字/数字/_）"
                        value={metafieldTimeKey}
                        onChange={setMetafieldTimeKey}
                        autoComplete="off"
                        helpText="例: delivery_time"
                      />
                      <TextField
                        label="置き配 key（半角英小文字/数字/_）"
                        value={metafieldPlacementKey}
                        onChange={setMetafieldPlacementKey}
                        autoComplete="off"
                        helpText="例: delivery_placement"
                      />
                    </InlineStack>

                    <Banner status="info" title="保存先の例">
                      <p>
                        {metafieldNamespace || "custom"}.{metafieldDateKey || "delivery_date"} /{" "}
                        {metafieldNamespace || "custom"}.{metafieldTimeKey || "delivery_time"} /{" "}
                        {metafieldNamespace || "custom"}.{metafieldPlacementKey || "delivery_placement"}
                      </p>
                    </Banner>
                  </BlockStack>
                ) : null}
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

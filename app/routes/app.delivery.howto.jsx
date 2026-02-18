// app/routes/app.delivery.howto.jsx
import { useCallback, useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import {
  Card,
  Text,
  Divider,
  Banner,
  List,
  InlineStack,
  BlockStack,
  Button,
  Collapsible,
  Box,
  Badge,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { getOrCreateDeliverySettings } from "../models/deliverySettings.server";

/** ================= helpers ================= */

function safeKey(v, fallback) {
  const s = String(v ?? "").trim();
  return s || fallback;
}

function buildEmailLiquid({ dateKey, timeKey, placementKey }) {
  return `{% if order.note_attributes %}
  <p><strong>■ 配送希望日時</strong></p>
  <ul>
    {% for attr in order.note_attributes %}
      {% if attr.name == '${dateKey}' and attr.value != blank %}
        <li>配送希望日：{{ attr.value }}</li>
      {% endif %}
      {% if attr.name == '${timeKey}' and attr.value != blank %}
        <li>配送希望時間：{{ attr.value }}</li>
      {% endif %}
      {% if attr.name == '${placementKey}' and attr.value != blank %}
        <li>置き配：{{ attr.value }}</li>
      {% endif %}
    {% endfor %}
  </ul>
{% endif %}`;
}

async function copyToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function getStoreHandleFromShopDomain(shopDomain) {
  const s = String(shopDomain || "").trim();
  if (!s) return null;
  return s.split(".myshopify.com")[0] || null;
}

/**
 * ✅ ただページへ飛ばすだけ（自動追加しない）
 */
function buildCartEditorLink(shopDomain) {
  if (!shopDomain) return null;
  return `https://${shopDomain}/admin/themes/current/editor?template=cart`;
}

/**
 * ✅ Checkout & accounts editor へのリンク（ページ別）
 * - profileId が分かる場合： /profiles/<id>?page=...
 * - 分からない場合： /settings/checkout/editor?page=...
 *
 * page: "checkout" | "order-status"（あなたのURLに合わせた値）
 */
function buildCheckoutEditorLink({ shopDomain, page, profileId }) {
  const store = getStoreHandleFromShopDomain(shopDomain);
  if (!store) return null;

  const safePage = page === "order-status" ? "order-status" : page === "thank-you" ? "thank-you" : "checkout";

  if (profileId && String(profileId).trim()) {
    return `https://admin.shopify.com/store/${store}/settings/checkout/editor/profiles/${String(
      profileId,
    ).trim()}?page=${safePage}`;
  }

  return `https://admin.shopify.com/store/${store}/settings/checkout/editor?page=${safePage}`;
}

/** ================= UI parts ================= */

function Section({ title, badge, children }) {
  return (
    <Card sectioned>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Text variant="headingMd" as="h3">
              {title}
            </Text>
            {badge ? <Badge status="info">{badge}</Badge> : null}
          </InlineStack>
        </InlineStack>

        {children}
      </BlockStack>
    </Card>
  );
}

function Step({ title, desc, bullets, tips, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <Box>
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="100">
          <Text variant="headingSm" as="h4">
            {title}
          </Text>
          {desc ? (
            <Text as="p" tone="subdued">
              {desc}
            </Text>
          ) : null}
        </BlockStack>

        <Button onClick={toggle} disclosure>
          {open ? "閉じる" : "開く"}
        </Button>
      </InlineStack>

      <Collapsible open={open}>
        <Box paddingBlockStart="300">
          <BlockStack gap="300">
            {bullets?.length ? (
              <List type="bullet">
                {bullets.map((b, i) => (
                  <List.Item key={i}>{b}</List.Item>
                ))}
              </List>
            ) : null}

            {tips?.length ? (
              <Banner status="info" title="ポイント">
                <List type="bullet">
                  {tips.map((t, i) => (
                    <List.Item key={i}>{t}</List.Item>
                  ))}
                </List>
              </Banner>
            ) : null}
          </BlockStack>
        </Box>
      </Collapsible>
    </Box>
  );
}

function FAQ({ q, a, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <Box>
      <InlineStack align="space-between" blockAlign="center">
        <Text variant="bodyMd" as="p">
          <strong>Q.</strong> {q}
        </Text>
        <Button onClick={toggle} disclosure>
          {open ? "閉じる" : "開く"}
        </Button>
      </InlineStack>

      <Collapsible open={open}>
        <Box paddingBlockStart="200">
          <Text as="p">
            <strong>A.</strong> {a}
          </Text>
        </Box>
      </Collapsible>
      <Divider />
    </Box>
  );
}

/** ================= loader ================= */

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getOrCreateDeliverySettings(session.shop);

  const attrDateName = safeKey(settings.attrDateName, "delivery_date");
  const attrTimeName = safeKey(settings.attrTimeName, "delivery_time");
  const attrPlacementName = safeKey(
    settings.attrPlacementName,
    "delivery_placement",
  );

  const emailLiquid = buildEmailLiquid({
    dateKey: attrDateName,
    timeKey: attrTimeName,
    placementKey: attrPlacementName,
  });

  // ✅ ページへ飛ばすだけのリンク
  const cartEditorLink = buildCartEditorLink(session.shop);

  // ✅ あなたの例: profiles/1791819870
  // ここは環境変数で上書きできるようにしておく（未設定でも動く）
  const checkoutProfileId = process.env.CHECKOUT_PROFILE_ID || "";

  const thankYouEditorLink = buildCheckoutEditorLink({
    shopDomain: session.shop,
    page: "thank-you",
    profileId: checkoutProfileId,
  });

  const orderStatusEditorLink = buildCheckoutEditorLink({
    shopDomain: session.shop,
    page: "order-status",
    profileId: checkoutProfileId,
  });

  return {
    attrDateName,
    attrTimeName,
    attrPlacementName,
    emailLiquid,
    cartEditorLink,
    thankYouEditorLink,
    orderStatusEditorLink,
  };
};

/** ================= page ================= */

export default function DeliveryHowtoRoute() {
  const {
    attrDateName,
    attrTimeName,
    attrPlacementName,
    emailLiquid,
    cartEditorLink,
    thankYouEditorLink,
    orderStatusEditorLink,
  } = useLoaderData();

  const currentKeysLabel = useMemo(
    () => `現在の属性名：${attrDateName} / ${attrTimeName} / ${attrPlacementName}`,
    [attrDateName, attrTimeName, attrPlacementName],
  );

  const [copyStatus, setCopyStatus] = useState(null); // "ok" | "ng" | null

  const onCopy = useCallback(async () => {
    setCopyStatus(null);
    const ok = await copyToClipboard(emailLiquid);
    setCopyStatus(ok ? "ok" : "ng");
    window.setTimeout(() => setCopyStatus(null), 2500);
  }, [emailLiquid]);

  return (
    <BlockStack gap="400">
      {/* ヘッダー */}
      <Card sectioned>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="headingLg" as="h2">
              ご利用方法
            </Text>
            <Badge status="success">管理画面ガイド</Badge>
          </InlineStack>

          <Text as="p">
            本アプリは、カート画面でお客様に「配送希望日」「配送時間」を指定してもらうためのアプリです。
            管理画面でルールを設定すると、ストアの配送運用に合わせて自動的に表示・制御されます。
          </Text>

          {/* ✅ 設置導線（ページへ飛ぶだけ） */}
          <Banner status="info" title="設置方法">
            <BlockStack gap="300">
              <Text as="p">以下のボタンから、設置先の編集画面を開けます。</Text>

              <Divider />

              {/* カート */}
              <BlockStack gap="200">
                <Text as="p">
                  <strong>■ カート（テーマ）に設置</strong>
                  <br />
                  テーマエディタ（カートテンプレート）を開きます。
                  追加画面内の「アプリ」から本アプリのブロックを追加し、保存（Save）してください。
                  必要に応じて「小計（Subtotal）付近」へドラッグして配置してください。
                </Text>

                <InlineStack align="end">
                  <Button
                    url={cartEditorLink || undefined}
                    external
                    variant="primary"
                    disabled={!cartEditorLink}
                  >
                    カートテンプレートを開く
                  </Button>
                </InlineStack>
              </BlockStack>

              <Divider />

              {/* サンクス */}
              <BlockStack gap="200">
                <Text as="p">
                  <strong>■ サンクスページに設置</strong>
                  <br />
                  サンクスページの編集画面を開き、追加画面内の「アプリ」から本アプリのブロックを追加し、保存（Save）してください。
                </Text>

                <InlineStack align="end">
                  <Button
                    url={thankYouEditorLink || undefined}
                    external
                    disabled={!thankYouEditorLink}
                  >
                    サンクスページの編集画面を開く
                  </Button>
                </InlineStack>
              </BlockStack>

              <Divider />

              {/* 注文状況 */}
              <BlockStack gap="200">
                <Text as="p">
                  <strong>■ 注文状況ページに設置</strong>
                  <br />
                  お客様アカウントの編集画面を開き、上のメニューから「注文状況」をクリック。追加画面内の「アプリ」から本アプリのブロックを追加し、保存（Save）してください。
                </Text>

                <InlineStack align="end">
                  <Button
                    url={orderStatusEditorLink || undefined}
                    external
                    disabled={!orderStatusEditorLink}
                  >
                    お客様アカウントの編集画面を開く
                  </Button>
                </InlineStack>
              </BlockStack>

              {!cartEditorLink || !thankYouEditorLink || !orderStatusEditorLink ? (
                <Text as="p" tone="subdued">
                  ※ リンクを生成できませんでした。ショップドメインの取得に失敗している可能性があります。
                </Text>
              ) : null}
            </BlockStack>
          </Banner>
        </BlockStack>
      </Card>

      {/* 設定の流れ */}
      <Section title="設定の流れ" badge="初期設定">
        <BlockStack gap="400">
          <Step
            title="STEP 1：基本設定を入力する"
            desc="受付条件・時間帯・表示/必須など、全商品の基本ルールを決めます。"
            defaultOpen
            bullets={[
              "最短お届け日数：注文日から何日後以降を選択可能にするか",
              "お届け可能期間：何日先まで選択できるようにするか",
              "配送業者・配送可能時間帯：お客様が選べる時間帯を設定",
              "表示／必須：配送日・配送時間・置き配の表示と必須を設定",
              "（任意）注文締め時間：締め時間を過ぎた場合に最短日を+1日する",
              "（任意）注文メタフィールド保存：Shopify Flowや独自連携で利用したい場合に、注文メタフィールドにも保存できます（必須ではありません）",
            ]}
            tips={[
              "配送時間帯をカスタムにする場合は、運用している表記に合わせて統一するとトラブルが減ります。",
              "表示OFFの項目は必須にできません（矛盾防止のため自動でOFFになります）。",
            ]}
          />

          <Divider />

          <Step
            title="STEP 2：カレンダー設定を調整する"
            desc="休日・お届け不可日、表示形式や色など、カレンダーの挙動を整えます。"
            bullets={[
              "休日：営業日計算に使う曜日（例：土日を休日にする等）",
              "お届け不可日：特定の日付を選べない日にする（例：年末年始など）",
              "表示形式：ポップアップ／インラインを選択",
              "配色：選択日・無効日などの色をカスタマイズ",
            ]}
            tips={[
              "「休日」と「お届け不可日」は用途が違います。休日は計算、不可日は選択禁止です。",
              "年末年始や棚卸などは「お届け不可日」に入れておくと運用が安全です。",
            ]}
          />

          <Divider />

          <Step
            title="STEP 3：タグ条件を設定する（必要な場合）"
            desc="商品タグによって「日時指定を無効」「条件を上書き」できます。"
            bullets={[
              "日時指定を無効化：指定タグが付いた商品がカートに1つでもあれば日時指定を表示しない",
              "タグ別上書き：特定タグの商品だけ、最短日数・期間・時間帯などを上書き",
              "上書きルールは配列順で評価され、上にあるルールほど優先されます",
            ]}
            tips={[
              "冷凍・受注生産・大型商品など、配送条件が異なる商品にタグ運用が向いています。",
              "優先度（並び順）を運用ルールとして決めておくと保守が楽になります。",
            ]}
          />
        </BlockStack>
      </Section>

      {/* カート側 */}
      <Section title="カート画面での動作" badge="お客様側">
        <BlockStack gap="300">
          <List type="bullet">
            <List.Item>お客様が選択した配送希望は、カート情報として保存されます。</List.Item>
            <List.Item>カート内容が変わると、ルール（タグ条件など）が再評価されます。</List.Item>
            <List.Item>日時指定が無効な場合、入力欄は表示されません。</List.Item>
          </List>

          <Banner status="warning" title="注意">
            <List type="bullet">
              <List.Item>テーマやカスタマイズ状況によって表示位置が変わる場合があります。</List.Item>
              <List.Item>チェックアウト画面ではなく、カート画面で動作します。</List.Item>
            </List>
          </Banner>
        </BlockStack>
      </Section>

      {/* メール */}
      <Section title="購入時メールへの表示（注文確認メールなど）" badge="メール">
        <BlockStack gap="300">
          <Text as="p">
            配送希望日時は、注文の「追加詳細（カート属性）」として保存されます。
            Shopifyの注文確認メール・発送通知メールなどに追記することで、
            お客様へ送信されるメール本文にも表示できます。
          </Text>

          <Banner status="info" title="手順">
            <List type="bullet">
              <List.Item>Shopify管理画面 → 設定 → 通知 を開きます。</List.Item>
              <List.Item>「注文の確認」など、表示したいメールを選びます。</List.Item>
              <List.Item>メール本文（HTML / Liquid）に、下のコードを貼り付けて保存します。</List.Item>
              <List.Item>テスト送信で表示を確認してください。</List.Item>
            </List>
          </Banner>

          <Banner status="success" title="コピー用コードは自動生成です">
            <Text as="p">
              {currentKeysLabel}
              <br />
              「取り込み設定（カート属性名）」の設定内容に合わせて、このページのコピー用コードは自動的に更新されます。
              （通知メールのテンプレート自体はShopify側で手動貼り付けが必要です）
            </Text>
          </Banner>

          {copyStatus === "ok" ? (
            <Banner status="success" title="コピーしました">
              <Text as="p">このまま Shopify の通知テンプレートに貼り付けてください。</Text>
            </Banner>
          ) : null}

          {copyStatus === "ng" ? (
            <Banner status="critical" title="コピーに失敗しました">
              <Text as="p">下のコードを選択して手動でコピーしてください。</Text>
            </Banner>
          ) : null}

          <InlineStack align="end">
            <Button variant="primary" onClick={onCopy}>
              コードをコピー
            </Button>
          </InlineStack>

          <Box
            padding="400"
            background="bg-surface-secondary"
            borderWidth="025"
            borderColor="border"
            borderRadius="200"
          >
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{emailLiquid}</pre>
          </Box>

          <List type="bullet">
            <List.Item>配送日時を指定していない注文では表示されません。</List.Item>
            <List.Item>複数商品がある場合でも、カート全体の希望日時として1回表示されます。</List.Item>
            <List.Item>注文メタフィールドの設定は不要です（メール表示は追加詳細を参照します）。</List.Item>
          </List>
        </BlockStack>
      </Section>

      {/* FAQ */}
      <Section title="よくある質問" badge="FAQ">
        <BlockStack gap="300">
          <FAQ
            q="設定したのにカートに表示されません"
            a="「表示／必須」で配送日・配送時間がONになっているか確認してください。あわせて、タグ条件で無効化されていないかも確認してください。"
            defaultOpen
          />
          <FAQ
            q="最短お届け日が想定より1日遅れます"
            a="「注文締め時間」を設定している場合、締め時間を過ぎると最短日が+1日されます。締め時間設定と現在時刻を確認してください。"
          />
          <FAQ
            q="外部の受注管理システムと連携できますか？"
            a={`はい。本アプリで取得した配送希望日時は、注文の「追加詳細（カート属性）」として保存されます。

外部の受注管理システムをご利用の場合は、「取り込み設定（カート属性名）」を連携先システムが読み取る項目名に合わせて設定してください。`}
          />
          <FAQ
            q="休日とお届け不可日の違いは？"
            a="休日は営業日計算に使う曜日です。お届け不可日は特定の日付を選択できない日にする設定です。用途が異なるので、運用に合わせて両方設定してください。"
          />
        </BlockStack>
      </Section>

      {/* サポート */}
      <Card sectioned>
        <BlockStack gap="200">
          <Text variant="headingMd" as="h3">
            サポート
          </Text>
          <Text as="p">
            不具合・ご要望・ご不明点は「お問い合わせ」メニューからお問い合わせください。
          </Text>
        </BlockStack>
      </Card>

      <Box paddingBlockEnd="800" />
    </BlockStack>
  );
}

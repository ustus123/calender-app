import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => {
  render(<DeliveryInfo />, document.body);
};

function getAttr(key) {
  const list = shopify?.attributes?.value ?? shopify?.attributes?.current ?? [];
  if (!Array.isArray(list)) return null;

  const hit = list.find((a) => a?.key === key);
  return hit?.value ?? null;
}

function DeliveryInfo() {
  const deliveryDate = getAttr("delivery_date");
  const deliveryTime = getAttr("delivery_time");
  const deliveryPlacement = getAttr("delivery_placement");

  return (
    // ✅ まずは banner は維持
    <s-banner tone="info">
      <s-stack direction="block" gap="base">
        {/* ✅ emphasis を使わない（型エラー回避） */}
        <s-heading>配送希望日時</s-heading>

        <s-text>配送希望日：{deliveryDate ?? "未指定"}</s-text>
        <s-text>配送希望時間：{deliveryTime ?? "未指定"}</s-text>
        <s-text>置き配：{deliveryPlacement ?? "未指定"}</s-text>
      </s-stack>
    </s-banner>
  );
}
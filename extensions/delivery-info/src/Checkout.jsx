import "@shopify/ui-extensions/preact";
import { render } from "preact";

// ✅ Cart / Checkout Attributes を読む（Thank you / Checkout で利用可能）
import { useAttributeValues } from "@shopify/ui-extensions/checkout/preact";

export default function extension() {
  render(<Extension />, document.body);
}

function Extension() {
  // TODO: Theme App Extension 側で保存している「属性キー名」に合わせてください
  // 例: /cart/update.js で attributes["delivery_date"]=...
  const [deliveryDate, deliveryTime, deliveryPlacement] = useAttributeValues([
    "delivery_date",
    "delivery_time",
    "delivery_placement",
  ]);

  return (
    <s-banner heading="配送希望日時">
      <s-stack gap="base">
        <s-text>配送希望日：{deliveryDate ?? "未指定"}</s-text>
        <s-text>配送希望時間：{deliveryTime ?? "未指定"}</s-text>
        <s-text>置き配：{deliveryPlacement ?? "未指定"}</s-text>
      </s-stack>
    </s-banner>
  );
}

import "@shopify/ui-extensions/preact";
import { render } from "preact";

// ✅ Cart / Checkout Attributes を読む（Thank you / Checkout で利用可能）
import { useAttributeValues } from "@shopify/ui-extensions/checkout/preact";

export default function extension() {
  render(<Extension />, document.body);
}

function Extension() {
  const [deliveryDate, deliveryTime, deliveryPlacement] = useAttributeValues([
    "delivery_date",
    "delivery_time",
    "delivery_placement",
  ]);

  return (
    <s-box padding="base" border="base" borderRadius="large">
        <s-stack gap="base">
          <s-text><s-text type="strong">配送希望日：</s-text>{deliveryDate ?? "未指定"}</s-text>
          <s-text><s-text type="strong">配送希望時間：</s-text>{deliveryTime ?? "未指定"}</s-text>
          <s-text><s-text type="strong">置き配：</s-text>{deliveryPlacement ?? "未指定"}</s-text>
        </s-stack>
    </s-box>
  );
}

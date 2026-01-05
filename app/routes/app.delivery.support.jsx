// app/routes/app.delivery.support.jsx
// @ts-nocheck
import { useMemo } from "react";
import { useLoaderData } from "react-router";
import {
  Card,
  Text,
  Button,
  InlineStack,
  Banner,
  Link,
  BlockStack,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";

/** JSONレスポンス */
function json(data, init) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  });
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  return json({
    shop: session.shop,
    supportEmail: process.env.SUPPORT_EMAIL || "",
  });
}

export default function DeliverySupportRoute() {
  const { shop, supportEmail } = useLoaderData();

  const mailto = useMemo(() => {
    if (!supportEmail) return "";
    const subject = encodeURIComponent(
      `【くいっく配送日時指定】お問い合わせ（${shop}）`,
    );
    return `mailto:${supportEmail}?subject=${subject}`;
  }, [supportEmail, shop]);

  return (
    <Card sectioned>
      <BlockStack gap="400">
        {/* 見出し */}
        <Text variant="headingMd" as="h2">
          お問い合わせ
        </Text>

        {/* 説明文 */}
        <Text as="p">
          アプリに関するご質問・不具合のご報告は、
          以下のサポート窓口までメールでご連絡ください。
        </Text>

        {supportEmail ? (
          <BlockStack gap="300">
            {/* サポート情報 */}
            <Banner status="info">
              <Text as="p">
                サポート窓口：
                <Link url={mailto} external>
                  {supportEmail}
                </Link>
              </Text>
            </Banner>

            {/* CTA */}
            <InlineStack>
              <Button variant="primary" url={mailto} external>
                メールでお問い合わせ
              </Button>
            </InlineStack>
          </BlockStack>
        ) : (
          <Banner status="warning">
            <Text as="p">
              サポート窓口が未設定です。
              環境変数 <code>SUPPORT_EMAIL</code> を設定してください。
            </Text>
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}

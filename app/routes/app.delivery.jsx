import { Outlet, useLocation } from "react-router";
import { Page, Layout, Card, Button, InlineStack } from "@shopify/polaris";

const ITEMS = [
  { label: "基本設定", to: "/app/delivery/basic" },
  { label: "カレンダー", to: "/app/delivery/calendar" },
  { label: "タグ条件設定", to: "/app/delivery/tags" },
  { label: "お問い合わせ", to: "/app/delivery/support" },
  { label: "ご利用方法", to: "/app/delivery/howto" },
];

export default function DeliveryLayoutRoute() {
  const location = useLocation();
  const search = location.search || ""; // ✅ ?host=... を保持

  return (
    <Page title="くいっく配送日時指定">
      <Layout>
        <Layout.Section>
          <Card>
            <InlineStack align="start" gap="200">
              <InlineStack gap="200">
                {ITEMS.map((it) => {
                  const active = location.pathname === it.to;
                  const url = `${it.to}${search}`; // ✅ ここが肝

                  return (
                    <Button
                      key={it.to}
                      variant={active ? "primary" : "secondary"}
                      url={url}
                    >
                      {it.label}
                    </Button>
                  );
                })}
              </InlineStack>
            </InlineStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Outlet />
        </Layout.Section>
      </Layout>
    </Page>
  );
}

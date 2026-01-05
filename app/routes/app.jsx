import "@shopify/polaris/build/esm/styles.css";

import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import ja from "@shopify/polaris/locales/ja.json";

import { authenticate, registerWebhooks } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const res = await registerWebhooks({ session });
    console.log("[loader] registerWebhooks result", res);
  } catch (e) {
    console.error("[loader] registerWebhooks error", e);
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={ja}>
        <ui-nav-menu>
          {/* ✅ 1個目は必須・rel="home" 必須。リンクとしては表示されない */}
          <a href="/app/delivery" rel="home">
            くいっく配送日時指定
          </a>

          <a href="/app/delivery/basic">基本設定</a>
          <a href="/app/delivery/calendar">カレンダー</a>
          <a href="/app/delivery/tags">タグ条件設定</a>
          <a href="/app/delivery/support">お問い合わせ</a>
          <a href="/app/delivery/howto">ご利用方法</a>
        </ui-nav-menu>

        <Outlet />
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

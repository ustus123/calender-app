// app/routes/proxy.ts
// 

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: { request: Request }) => {
  const { session } = await authenticate.public.appProxy(request);

  return new Response(
    JSON.stringify({
      ok: true,
      shop: session?.shop ?? null,
      message: "App Proxy reached /proxy",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
};

import { redirect } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  await authenticate.admin(request);

  // OAuth後は必ず index に戻す
  return redirect(`/app?shop=${shop}&host=${url.searchParams.get("host")}`);
};

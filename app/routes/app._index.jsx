import { redirect } from "react-router";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  return redirect(`/app/delivery/basic${url.search || ""}`);
};

export default function DeliveryIndexRedirect() {
  return null;
}

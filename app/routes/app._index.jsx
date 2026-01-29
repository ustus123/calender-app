import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

export const loader = async () => {
  // OAuth直後にまず /app を表示して、埋め込み文脈やセッションを安定させる
  return null;
};

export default function DeliveryIndexRedirect() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // クライアント側で遷移（App Bridge初期化後に動くので安定）
    navigate(`/app/delivery/basic${location.search || ""}`, { replace: true });
  }, [navigate, location.search]);

  return (
    <div style={{ padding: 24 }}>
      Loading…
    </div>
  );
}

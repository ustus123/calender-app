// @ts-nocheck
(() => {
  const SELECTOR = ".delivery-selector";
  const SAVE_DEBOUNCE_MS = 300;

  // ==========================
  // Loading UI (仮状態=読み込み中)
  // ==========================
  function ensureLoadingEl(root) {
    if (!root) return null;

    let el = root.querySelector("[data-delivery-loading]");
    if (!el) {
      el = document.createElement("div");
      el.setAttribute("data-delivery-loading", "1");
      el.hidden = true;

      // 最小限のインライン装飾（CSSを入れなくても見える）
      el.style.margin = "8px 0";
      el.style.padding = "8px 12px";
      el.style.fontSize = "13px";
      el.style.color = "#6d7175";
      el.style.background = "#f6f6f7";
      el.style.borderRadius = "6px";
      el.textContent = "配送日時を判定中です…";

      // noticeの直後が自然。なければ先頭へ
      const notice = root.querySelector("[data-notice]");
      if (notice && notice.insertAdjacentElement) notice.insertAdjacentElement("afterend", el);
      else root.insertAdjacentElement("afterbegin", el);

      // 追加CSS（1回だけ）
      if (!document.getElementById("delivery-loading-css")) {
        const style = document.createElement("style");
        style.id = "delivery-loading-css";
        style.textContent = `
${SELECTOR}.is-loading { pointer-events: none; opacity: .65; }
`;
        document.head.appendChild(style);
      }
    }
    return el;
  }

  function setDeliveryLoading(root, loading) {
    if (!root) return;
    const el = ensureLoadingEl(root);
    if (el) el.hidden = !loading;
    root.classList.toggle("is-loading", !!loading);
  }

  function setAllRootsLoading(loading) {
    document.querySelectorAll(SELECTOR).forEach((r) => setDeliveryLoading(r, loading));
  }

  // ==========================
  // shop domain / policy url (App Proxy JSON)
  // ==========================
  function getShopDomain() {
    if (window.Shopify && typeof window.Shopify.shop === "string" && window.Shopify.shop) {
      return String(window.Shopify.shop).trim();
    }

    const meta = document.querySelector('meta[property="og:url"]');
    const og = (meta && meta.getAttribute("content")) || "";
    const m = og.match(/^https:\/\/([^/]+)\//);
    if (m && m[1]) return m[1];

    if (location.hostname && location.hostname.endsWith(".myshopify.com")) return location.hostname;
    return null;
  }

  const shop = getShopDomain();

  // ✅ Theme から叩くのは「App Proxy(JSON)」だけ！
  // 例: app/routes/apps.delivery-date.policy.jsx → /apps/delivery-date/policy
  const POLICY_URL = shop
    ? `/apps/delivery-date/policy?shop=${encodeURIComponent(shop)}`
    : "/apps/delivery-date/policy";

  let settingsPromise = null;

  // ==========================
  // date helpers
  // ==========================
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function formatYmd(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
  }

  function monthStart(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function ymdToDate(ymd) {
    return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? new Date(`${ymd}T00:00:00`) : null;
  }

  const WEEKDAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function normalizeHolidayList(arr) {
    const out = { weekdays: new Set(), dates: new Set() };
    (Array.isArray(arr) ? arr : []).forEach((x) => {
      if (typeof x !== "string") return;
      const s = x.trim();
      if (!s) return;
      if (WEEKDAY_KEYS.includes(s)) out.weekdays.add(s);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) out.dates.add(s);
    });
    return out;
  }

  function normalizeBlackoutList(arr) {
    const set = new Set();
    (Array.isArray(arr) ? arr : []).forEach((x) => {
      if (typeof x !== "string") return;
      const s = x.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) set.add(s);
    });
    return set;
  }

  function isValidCutoffHHMM(s) {
    if (!s || s === "NONE") return false;
    return typeof s === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(s.trim());
  }

  function isStoreHoliday(dateObj, holidays) {
    if (!holidays) return false;
    const ymd = formatYmd(dateObj);
    if (holidays.dates && holidays.dates.has(ymd)) return true;

    const wk = WEEKDAY_KEYS[dateObj.getDay()];
    if (holidays.weekdays && holidays.weekdays.has(wk)) return true;

    return false;
  }

  function isBlackoutYmd(ymd, blackoutSet) {
    return !!(blackoutSet && blackoutSet.has(ymd));
  }

  function computeMinMaxWithBusinessLeadtime({ leadTimeDays, rangeDays, cutoffTime, holidays, blackout }) {
    const now = new Date();
    let base = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (isValidCutoffHHMM(cutoffTime)) {
      const [hh, mm] = cutoffTime.trim().split(":").map(Number);
      const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
      if (now.getTime() > cutoff.getTime()) base = addDays(base, 1);
    }

    const lt = Math.max(0, Number(leadTimeDays) || 0);
    const rd = Math.max(1, Number(rangeDays) || 1);

    let cursor = new Date(base.getTime());
    while (isStoreHoliday(cursor, holidays)) cursor = addDays(cursor, 1);

    let advanced = 0;
    while (advanced < lt) {
      cursor = addDays(cursor, 1);
      while (isStoreHoliday(cursor, holidays)) cursor = addDays(cursor, 1);
      advanced++;
    }

    let minDate = new Date(cursor.getTime());
    while (isBlackoutYmd(formatYmd(minDate), blackout)) {
      minDate = addDays(minDate, 1);
    }

    const maxDate = addDays(minDate, rd - 1);
    return { minDate, maxDate };
  }

  // ==========================
  // cart api
  // ==========================
  async function cartUpdateAttributes(attrs) {
    const body = new URLSearchParams();
    Object.entries(attrs || {}).forEach(([k, v]) => {
      body.set(`attributes[${k}]`, v ?? "");
    });

    const res = await fetch("/cart/update.js", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json",
      },
      credentials: "same-origin",
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`cart/update.js failed: ${res.status} ${text}`);
    }

    return res.json();
  }

  async function cartGet() {
    const res = await fetch("/cart.js", {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    return res.json();
  }

  // ==========================
  // cart signature (変化検知)
  // ==========================
  function cartSignature(cart) {
    const items = (cart && cart.items) || [];
    const parts = items
      .map((it) => `${Number(it?.product_id) || 0}:${Number(it?.quantity) || 0}`)
      .filter((s) => !s.startsWith("0:"))
      .sort(); // 順序ブレ対策
    return parts.join("|");
  }
  let lastCartSig = null;

  // ==========================
  // attribute migration
  // ==========================
  async function migrateCartAttributes({ oldKeys, newKeys }) {
    if (!oldKeys || !newKeys) return;

    const cart = await cartGet();
    const attrs = (cart && cart.attributes) || {};

    const patch = {};
    let changed = false;

    const handleOne = (kind) => {
      const oldK = oldKeys[kind];
      const newK = newKeys[kind];
      if (!oldK || !newK) return;
      if (oldK === newK) return;

      const oldVal = String(attrs[oldK] ?? "");
      const newVal = String(attrs[newK] ?? "");

      if (oldVal && !newVal) {
        patch[newK] = oldVal;
        changed = true;
      }
      if (oldVal) {
        patch[oldK] = "";
        changed = true;
      }
    };

    handleOne("date");
    handleOne("time");
    handleOne("placement");

    if (changed) {
      try {
        await cartUpdateAttributes(patch);
      } catch (e) {
        console.warn("[delivery-date] migrateCartAttributes failed", e);
      }
    }
  }

  // ==========================
  // form discover helpers
  // ==========================
  function findCartForms() {
    const forms = new Set();
    document.querySelectorAll('form[action^="/cart"]').forEach((f) => forms.add(f));
    document.querySelectorAll("form").forEach((f) => {
      if (f.querySelector('[name="checkout"], button[type="submit"][name="checkout"], button[name="checkout"]')) {
        forms.add(f);
      }
    });
    return Array.from(forms);
  }

  function findProductForms() {
    const forms = new Set();
    document.querySelectorAll('form[action^="/cart/add"]').forEach((f) => forms.add(f));
    document.querySelectorAll("form").forEach((f) => {
      if (
        f.querySelector('button[type="submit"][name="add"], button[name="add"], input[type="submit"][name="add"]') ||
        f.querySelector('button[type="submit"][name="add-to-cart"], button[name="add-to-cart"]') ||
        f.querySelector('button[type="submit"][name="Add"], button[name="Add"]')
      ) {
        forms.add(f);
      }
    });
    return Array.from(forms);
  }

  function show(el) {
    if (el) el.hidden = false;
  }
  function hide(el) {
    if (el) el.hidden = true;
  }
  function setText(el, text) {
    if (el) el.textContent = text || "";
  }

  // ==========================
  // policy fetch (App Proxy)
  // ==========================
  async function getCartProductIdsCsv() {
    const cart = await cartGet();
    const items = (cart && cart.items) || [];
    const ids = items
      .map((it) => Number(it && it.product_id))
      .filter((n) => Number.isFinite(n) && n > 0);
    return Array.from(new Set(ids)).join(",");
  }

  async function loadRemoteSettingsOnce() {
    if (!settingsPromise) {
      settingsPromise = (async () => {
        try {
          const productIdsCsv = await getCartProductIdsCsv();

          const url = new URL(POLICY_URL, location.origin);
          if (productIdsCsv) url.searchParams.set("product_ids", productIdsCsv);

          console.log("[delivery] POLICY_URL =", url.toString());

          const res = await fetch(url.toString(), {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          });

          const ct = res.headers.get("content-type") || "";
          const text = await res.text();

          console.log("[delivery] policy status =", res.status);
          console.log("[delivery] policy content-type =", ct);
          console.log("[delivery] policy head =", text.slice(0, 120));

          if (!res.ok) throw new Error(`policy fetch failed: ${res.status}`);
          if (!ct.includes("application/json")) throw new Error(`Non-JSON response (content-type=${ct})`);

          return JSON.parse(text);
        } catch (e) {
          console.warn("[delivery] policy fetch failed, fallback to theme settings", e);
          return null;
        }
      })();
    }
    return settingsPromise;
  }

  function safeParseJsonArray(s) {
    if (typeof s !== "string") return null;
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }

  function unwrapSettingsPayload(payload) {
    if (!payload || typeof payload !== "object") return null;
    if (payload.settings && typeof payload.settings === "object") return payload.settings;
    if (payload.data && typeof payload.data === "object") return payload.data;
    if (payload.result && typeof payload.result === "object") return payload.result;
    return payload;
  }

  function pickBool(v, fallback) {
    return typeof v === "boolean" ? v : fallback;
  }

  function normalizeRemoteSettings(payload) {
    const remote = unwrapSettingsPayload(payload);
    if (!remote) return null;

    const required = remote.required || {};
    const showFlags = remote.show || {};
    const attrNames = remote.attrNames || {};

    const calendarUi = remote.calendarUi || {};
    const colors = calendarUi && calendarUi.colors ? calendarUi.colors : {};

    let timeSlots = null;
    if (Array.isArray(remote.timeSlots)) timeSlots = remote.timeSlots;
    else if (typeof remote.timeSlots === "string") timeSlots = safeParseJsonArray(remote.timeSlots);
    else if (typeof remote.timeSlotsJson === "string") timeSlots = safeParseJsonArray(remote.timeSlotsJson);

    const policy = remote.policy && typeof remote.policy === "object" ? remote.policy : null;

    return {
      timeSlots: Array.isArray(timeSlots) ? timeSlots : [],

      show: {
        date: typeof showFlags.date === "boolean" ? showFlags.date : undefined,
        time: typeof showFlags.time === "boolean" ? showFlags.time : undefined,
        placement: typeof showFlags.placement === "boolean" ? showFlags.placement : undefined,
      },

      required: {
        date: typeof required.date === "boolean" ? required.date : undefined,
        time: typeof required.time === "boolean" ? required.time : undefined,
        placement: typeof required.placement === "boolean" ? required.placement : undefined,
      },

      attrNames: {
        date: typeof attrNames.date === "string" && attrNames.date ? attrNames.date : null,
        time: typeof attrNames.time === "string" && attrNames.time ? attrNames.time : null,
        placement: typeof attrNames.placement === "string" && attrNames.placement ? attrNames.placement : null,
      },

      noticeText: typeof remote.noticeText === "string" ? remote.noticeText : "",

      leadTimeDays: Number(remote.leadTimeDays ?? NaN),
      rangeDays: Number(remote.rangeDays ?? NaN),
      cutoffTime: typeof remote.cutoffTime === "string" ? remote.cutoffTime : "",

      holidays: normalizeHolidayList(Array.isArray(remote.holidays) ? remote.holidays : []),
      blackout: normalizeBlackoutList(Array.isArray(remote.blackout) ? remote.blackout : []),

      calendarUi: {
        mode: calendarUi.mode === "inline" ? "inline" : calendarUi.mode === "popup" ? "popup" : undefined,
        startWeek: calendarUi.startWeek === "mon" ? "mon" : calendarUi.startWeek === "sun" ? "sun" : undefined,
        colors: {
          disabledBg: typeof colors.disabledBg === "string" ? colors.disabledBg : null,
          blackoutBg: typeof colors.blackoutBg === "string" ? colors.blackoutBg : null,
          disabledText: typeof colors.disabledText === "string" ? colors.disabledText : null,
          accent: typeof colors.accent === "string" ? colors.accent : null,
          selectedBg: typeof colors.selectedBg === "string" ? colors.selectedBg : null,
          selectedText: typeof colors.selectedText === "string" ? colors.selectedText : null,
          todayRing: typeof colors.todayRing === "string" ? colors.todayRing : null,
        },
      },

      policy,
    };
  }

  // ==========================
  // UI helpers
  // ==========================
  function resetSelectOptions(selectEl, values) {
    if (!selectEl) return;

    const arr = Array.isArray(values) ? values.filter(Boolean) : [];
    if (arr.length === 0) return;

    const prevValue = selectEl.value;

    while (selectEl.options.length > 1) selectEl.remove(1);

    arr.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      selectEl.appendChild(opt);
    });

    if (prevValue && arr.includes(prevValue)) {
      selectEl.value = prevValue;
    }
  }

  function applyCalendarCssVars(root, colors) {
    if (!colors) return;

    const targets = [];
    if (root) targets.push(root);
    targets.push(document.documentElement);

    const setIf = (el, name, val) => {
      if (typeof val === "string" && val.trim()) el.style.setProperty(name, val.trim());
    };

    targets.forEach((el) => {
      setIf(el, "--cal-disabled-bg", colors.disabledBg);
      setIf(el, "--cal-blackout-bg", colors.blackoutBg);
      setIf(el, "--cal-disabled-text", colors.disabledText);
      setIf(el, "--cal-accent", colors.accent);
      setIf(el, "--cal-selected-bg", colors.selectedBg);
      setIf(el, "--cal-selected-text", colors.selectedText);
      setIf(el, "--cal-today-ring", colors.todayRing);
    });
  }

  function isBadCalendarContainer(el) {
    if (!el) return false;

    const tag = (el.tagName || "").toLowerCase();
    if (tag === "html" || tag === "body" || tag === "main" || tag === "form") return true;

    if (el.querySelector && el.querySelector('form[action^="/cart"], form[action^="/checkout"], [name="checkout"]')) {
      return true;
    }

    return false;
  }

  function ensureCalMount(container) {
    let mount = container.querySelector("[data-cal-mount]");
    if (!mount) {
      mount = document.createElement("div");
      mount.setAttribute("data-cal-mount", "true");
      container.appendChild(mount);
    }
    return mount;
  }

  function injectInlineBelowCssOnce() {
    if (document.getElementById("delivery-calendar-final-css")) return;

    const style = document.createElement("style");
    style.id = "delivery-calendar-final-css";
    style.textContent = `
.delivery-cal-root { isolation:isolate; }
.delivery-cal-root .cal-day{
  transition: background-color .15s ease, color .15s ease, opacity .15s ease;
  opacity: 1 !important;
  filter: none !important;
}
.delivery-cal-root .cal-day[data-out="true"]{
  opacity: .35 !important;
  color: #6d7175 !important;
  background: transparent !important;
}
.delivery-cal-root .cal-day[data-disabledType="blackout"],
.delivery-cal-root .cal-day[data-disabledtype="blackout"]{
  opacity: .75 !important;
  background: var(--cal-blackout-bg, #fff2cc) !important;
  color: #202223 !important;
}
.delivery-cal-root .cal-day[data-selected="true"]{
  background: var(--cal-selected-bg, #111827) !important;
  color: var(--cal-selected-text, #ffffff) !important;
  opacity: 1 !important;
}
.delivery-cal-root .cal-day[data-today="true"]{
  box-shadow: 0 0 0 2px var(--cal-today-ring, #00a47c) inset !important;
}
.delivery-cal-root .cal-day[disabled]{
  cursor: not-allowed !important;
}
.delivery-cal-root{
  opacity: 1 !important;
  filter: none !important;
}
`;
    document.head.appendChild(style);
  }

  function ensureInlineCalendarPlacement(root, calInline, dateRow) {
    if (!root || !calInline) return;

    if (dateRow && dateRow.insertAdjacentElement) {
      const next = dateRow.nextElementSibling;
      if (next !== calInline) dateRow.insertAdjacentElement("afterend", calInline);
    } else {
      if (!calInline.parentElement) root.appendChild(calInline);
    }
  }

  function renderCalendar(container, state) {
    const { viewMonth, selectedYmd, minYmd, maxYmd, blackout, startWeek } = state;

    if (isBadCalendarContainer(container)) {
      console.warn("[delivery-date] invalid calendar container. skip render:", container);
      return { prev: null, next: null, grid: null };
    }

    const mount = ensureCalMount(container);

    const ms = monthStart(viewMonth);
    const title = `${ms.getFullYear()}年 ${ms.getMonth() + 1}月`;

    const minD = ymdToDate(minYmd);
    const maxD = ymdToDate(maxYmd);
    const selectedDate = selectedYmd ? ymdToDate(selectedYmd) : null;

    const head = document.createElement("div");
    head.className = "cal-header";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "cal-btn";
    prev.textContent = "←";

    const next = document.createElement("button");
    next.type = "button";
    next.className = "cal-btn";
    next.textContent = "→";

    const ttl = document.createElement("div");
    ttl.className = "cal-title";
    ttl.textContent = title;

    head.appendChild(prev);
    head.appendChild(ttl);
    head.appendChild(next);

    const dow = document.createElement("div");
    dow.className = "cal-grid";

    const dows =
      startWeek === "mon"
        ? ["月", "火", "水", "木", "金", "土", "日"]
        : ["日", "月", "火", "水", "木", "金", "土"];

    dows.forEach((t) => {
      const el = document.createElement("div");
      el.className = "cal-dow";
      el.textContent = t;
      dow.appendChild(el);
    });

    const grid = document.createElement("div");
    grid.className = "cal-grid";

    const start = new Date(ms.getTime());
    const monthFirstDow = start.getDay();
    const offset = startWeek === "mon" ? (monthFirstDow === 0 ? 6 : monthFirstDow - 1) : monthFirstDow;
    start.setDate(start.getDate() - offset);

    const todayYmd = formatYmd(new Date());

    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const ymd = formatYmd(d);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-day";
      btn.textContent = String(d.getDate());
      btn.dataset.ymd = ymd;

      const inThisMonth = d.getMonth() === ms.getMonth();
      btn.dataset.out = inThisMonth ? "false" : "true";
      if (ymd === todayYmd) btn.dataset.today = "true";

      let disabledType = null;
      if (minD && ymd < minYmd) disabledType = "range";
      if (maxD && ymd > maxYmd) disabledType = "range";
      if (!disabledType && blackout && blackout.has(ymd)) disabledType = "blackout";

      if (disabledType) {
        btn.disabled = true;
        btn.dataset.disabled = "true";
        btn.dataset.disabledType = disabledType;
        btn.title = disabledType === "blackout" ? "お届け不可日" : "選択範囲外";
      }

      if (selectedDate && formatYmd(selectedDate) === ymd) btn.dataset.selected = "true";
      grid.appendChild(btn);
    }

    const legend = document.createElement("div");
    legend.className = "cal-legend";

    mount.innerHTML = "";
    mount.appendChild(head);
    mount.appendChild(dow);
    mount.appendChild(grid);
    mount.appendChild(legend);

    container.classList.add("delivery-cal-root");
    return { prev, next, grid };
  }

  // ==========================
  // cart empty: clear delivery attributes
  // ==========================
  function uniqueStrings(arr) {
    return Array.from(new Set((arr || []).filter(Boolean).map((s) => String(s))));
  }

  async function clearDeliveryAttributesIfCartEmpty(attrKeys) {
    const cart = await cartGet();
    if (!cart) return;

    if (Number(cart.item_count || 0) !== 0) return;

    const keys = uniqueStrings(attrKeys);
    if (keys.length === 0) return;

    const attrs = cart.attributes || {};
    const hasAny = keys.some((k) => String(attrs[k] ?? "").trim() !== "");
    if (!hasAny) return;

    const patch = {};
    keys.forEach((k) => (patch[k] = ""));
    await cartUpdateAttributes(patch);
  }

  async function runCartEmptyCleanup() {
    if (window.__deliveryEmptyClearing) return;
    window.__deliveryEmptyClearing = true;

    try {
      const cart = await cartGet();
      if (!cart) return;

      if (Number(cart.item_count || 0) !== 0) return;

      const roots = document.querySelectorAll(SELECTOR);
      const allKeys = [];
      roots.forEach((r) => {
        const st = r.__deliveryState;
        if (!st || !st.used) return;
        allKeys.push(st.used.attrDate, st.used.attrTime, st.used.attrPlacement);
      });

      await clearDeliveryAttributesIfCartEmpty(allKeys);

      roots.forEach((r) => {
        const st = r.__deliveryState;
        if (!st) return;

        const { dateInput, dateUi, timeSelect, placementInput, calPopover } = st.refs || {};
        if (dateInput) dateInput.value = "";
        if (dateUi) dateUi.value = "";
        if (timeSelect) timeSelect.value = "";
        if (placementInput) placementInput.value = "";

        if (calPopover) {
          calPopover.hidden = true;
          calPopover.style.display = "none";
        }
      });
    } catch (e) {
      console.warn("[delivery-date] cart empty cleanup failed", e);
    } finally {
      window.__deliveryEmptyClearing = false;
    }
  }

  // ==========================
  // policy refresh: cart change -> re-fetch policy -> apply per root
  // 変化がないときは何もしない（安定化）
  // ==========================
  async function refreshSettingsAndApplyToAllRoots({ showLoading = false } = {}) {
    if (window.__deliveryRefreshingPolicy) return;
    window.__deliveryRefreshingPolicy = true;

    let didShowLoading = false;

    try {
      const cart = await cartGet();
      const sig = cartSignature(cart);

      // ✅ 変化なし → 何もしない（読み込み中も出さない）
      if (sig && lastCartSig === sig) return;
      lastCartSig = sig;

      // ✅ 変化ありのときだけ読み込み中
      if (showLoading) {
        setAllRootsLoading(true);
        didShowLoading = true;
      }

      settingsPromise = null;
      const remote = normalizeRemoteSettings(await loadRemoteSettingsOnce());
      if (!remote) return;

      document.querySelectorAll(SELECTOR).forEach((root) => {
        const st = root.__deliveryState;
        if (st && typeof st.applyRemote === "function") {
          st.applyRemote(remote).catch((e) => console.warn("[delivery-date] applyRemote failed", e));
        }
      });
    } catch (e) {
      console.warn("[delivery-date] refreshSettingsAndApplyToAllRoots failed", e);
    } finally {
      window.__deliveryRefreshingPolicy = false;
      // ✅ ここで必ず戻す（ただし自分で出したときだけ）
      if (didShowLoading) setAllRootsLoading(false);
    }
  }

  function hookFetchForCartOpsOnce() {
    if (window.__deliveryFetchHooked) return;
    window.__deliveryFetchHooked = true;

    const origFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const res = await origFetch(...args);

      try {
        const url = String(args?.[0] || "");
        if (url.includes("/cart/clear") || url.includes("/cart/change") || url.includes("/cart/update") || url.includes("/cart/add")) {
          setTimeout(() => {
            runCartEmptyCleanup().catch(() => {});
            // ✅ カート操作時だけ「読み込み中」を許可（ただし変化がないなら何も起きない）
            refreshSettingsAndApplyToAllRoots({ showLoading: true }).catch(() => {});
          }, 250);
        }
      } catch (_) {}

      return res;
    };
  }

  function startCartPollerOnce() {
    if (window.__deliveryCartPollerStarted) return;
    window.__deliveryCartPollerStarted = true;

    setInterval(() => {
      runCartEmptyCleanup().catch(() => {});
      // ✅ ポーリングは“裏で確認”だけ（変化がなければ何もしない＆読み込み中も出さない）
      refreshSettingsAndApplyToAllRoots({ showLoading: false }).catch(() => {});
    }, 5000);
  }

  // ==========================
  // init / re-init
  // ==========================
  function initOne(root) {
    if (!root) return;

    // 読み込み要素を事前生成（後段でガタつかない）
    ensureLoadingEl(root);

    const refs = root.__deliveryRefs;
    const refsAlive =
      refs &&
      refs.dateInput &&
      root.contains(refs.dateInput) &&
      (!refs.timeSelect || root.contains(refs.timeSelect)) &&
      (!refs.placementInput || root.contains(refs.placementInput)) &&
      (!refs.dateUi || root.contains(refs.dateUi));

    if (root.__deliveryInited && refsAlive) return;

    root.__deliveryInited = true;

    try {
      const ds = root.dataset;

      const noticeEl = root.querySelector("[data-notice]");
      const dateRow = root.querySelector("[data-date-row]");
      const timeRow = root.querySelector("[data-time-row]");
      const placementRow = root.querySelector("[data-placement-row]");

      const dateInput = root.querySelector("[data-date]");
      const dateUi = root.querySelector("[data-date-ui]");

      const calPopover = root.querySelector("[data-calendar]");

      let calInline = root.querySelector("[data-calendar-inline]");
      if (!calInline) {
        calInline = document.createElement("div");
        calInline.setAttribute("data-calendar-inline", "1");
        calInline.style.display = "none";
        calInline.style.width = "100%";
      }

      const timeSelect = root.querySelector("[data-time]");
      const placementInput = root.querySelector("[data-placement]");

      root.__deliveryRefs = { dateInput, dateUi, timeSelect, placementInput };

      const errDate = root.querySelector("[data-error-date]");
      const errTime = root.querySelector("[data-error-time]");
      const errPlacement = root.querySelector("[data-error-placement]");
      const errGlobal = root.querySelector("[data-error-global]");

      const fallback = {
        attrDate: ds.attrDate || "delivery_date",
        attrTime: ds.attrTime || "delivery_time",
        attrPlacement: ds.attrPlacement || "delivery_placement",

        showDate: ds.showDate !== "false",
        showTime: ds.showTime !== "false",
        showPlacement: ds.showPlacement !== "false",

        requiredDate: ds.requiredDate === "true",
        requiredTime: ds.requiredTime === "true",
        requiredPlacement: false,

        leadTimeDays: Number(ds.leadTimeDays || 0),
        rangeDays: Number(ds.rangeDays || 0),
        cutoffTime: ds.cutoffTime || "",

        timeSlots: [],
        noticeText: ds.noticeText && ds.noticeText !== "NONE" ? ds.noticeText : "",

        holidays: normalizeHolidayList([]),
        blackout: normalizeBlackoutList([]),

        calendarUi: { mode: "popup", startWeek: "sun", colors: {} },
        policy: null,
      };

      let used = { ...fallback };

      root.__deliveryState = {
        used,
        refs: { dateInput, dateUi, timeSelect, placementInput, calPopover },
        applyRemote: null,
      };

      const clearErrors = () => {
        if (errDate) {
          setText(errDate, "");
          hide(errDate);
        }
        if (errTime) {
          setText(errTime, "");
          hide(errTime);
        }
        if (errPlacement) {
          setText(errPlacement, "");
          hide(errPlacement);
        }
        if (errGlobal) {
          setText(errGlobal, "");
          hide(errGlobal);
        }
      };

      const computeMinMaxYmdFromUsed = () => {
        const { minDate, maxDate } = computeMinMaxWithBusinessLeadtime({
          leadTimeDays: used.leadTimeDays,
          rangeDays: used.rangeDays,
          cutoffTime: used.cutoffTime,
          holidays: used.holidays,
          blackout: used.blackout,
        });
        return { minYmd: formatYmd(minDate), maxYmd: formatYmd(maxDate) };
      };

      const safeToggle = (rowEl, visible) => {
        if (!rowEl) return;
        rowEl.style.display = visible ? "" : "none";
      };

      const applyCalendarModeVisibility = () => {
        const isInline = !!(used.calendarUi && used.calendarUi.mode === "inline");

        if (isInline) {
          injectInlineBelowCssOnce();
          ensureInlineCalendarPlacement(root, calInline, dateRow);

          calInline.hidden = false;
          calInline.style.display = "block";

          if (calPopover) {
            calPopover.hidden = true;
            calPopover.style.display = "none";
          }
        } else {
          calInline.hidden = true;
          calInline.style.display = "none";

          if (calPopover) {
            calPopover.style.display = "";
            calPopover.hidden = true;
          }
        }
      };

      const applyUiFromSettings = () => {
        injectInlineBelowCssOnce();

        safeToggle(dateRow, used.showDate);
        safeToggle(timeRow, used.showTime);
        safeToggle(placementRow, used.showPlacement);

        if (placementRow && placementInput && !used.showPlacement) placementInput.value = "";

        if (timeSelect) {
          resetSelectOptions(timeSelect, used.timeSlots);
          timeSelect.disabled = !used.showTime;
        }

        const { minYmd, maxYmd } = computeMinMaxYmdFromUsed();

        if (dateInput) {
          dateInput.min = minYmd;
          dateInput.max = maxYmd;
        }

        if (noticeEl && used.noticeText) {
          noticeEl.textContent = String(used.noticeText).split("${MIN_DATE}").join(minYmd).split("${MAX_DATE}").join(maxYmd);
        } else if (noticeEl) {
          noticeEl.textContent = "";
        }

        applyCalendarCssVars(root, used.calendarUi && used.calendarUi.colors);
        applyCalendarModeVisibility();

        if (dateUi && dateInput) dateUi.value = dateInput.value || "";
      };

      const validate = () => {
        clearErrors();
        let ok = true;

        const dateEnabled = used.showDate && dateRow && dateRow.style.display !== "none";
        const timeEnabled = used.showTime && timeRow && timeRow.style.display !== "none";
        const placementEnabled = used.showPlacement && placementRow && placementRow.style.display !== "none";

        const dateVal = dateEnabled ? (dateInput && dateInput.value) || "" : "";
        const timeVal = timeEnabled ? (timeSelect && timeSelect.value) || "" : "";
        const placementVal = placementEnabled ? (placementInput && placementInput.value) || "" : "";

        const minYmd = (dateInput && dateInput.min) || "";
        const maxYmd = (dateInput && dateInput.max) || "";

        if (dateEnabled) {
          if (used.requiredDate && !dateVal) {
            ok = false;
            if (errDate) {
              setText(errDate, "配送希望日を選択してください。");
              show(errDate);
            }
          }

          if (dateVal) {
            if (minYmd && maxYmd && (dateVal < minYmd || dateVal > maxYmd)) {
              ok = false;
              if (errDate) {
                setText(errDate, `配送希望日は ${minYmd} 〜 ${maxYmd} の範囲で選択してください。`);
                show(errDate);
              }
            } else if (used.blackout && used.blackout.has(dateVal)) {
              ok = false;
              if (errDate) {
                setText(errDate, "お届け不可日は選択できません。");
                show(errDate);
              }
            }
          }
        }

        if (timeEnabled && used.requiredTime && !timeVal) {
          ok = false;
          if (errTime) {
            setText(errTime, "配送希望時間を選択してください。");
            show(errTime);
          }
        }

        return { ok, dateVal, timeVal, placementVal };
      };

      let saving = false;
      let saveTimer = null;
      let lastQueued = null;

      const flushSaveNow = async () => {
        if (!lastQueued) return;
        const payload = lastQueued;
        lastQueued = null;

        const attrs = {};
        attrs[used.attrDate] = used.showDate ? payload.dateVal || "" : "";
        attrs[used.attrTime] = used.showTime ? payload.timeVal || "" : "";
        attrs[used.attrPlacement] = used.showPlacement ? payload.placementVal || "" : "";

        saving = true;
        try {
          await cartUpdateAttributes(attrs);
        } finally {
          saving = false;
        }
      };

      const queueSave = (payload) => {
        lastQueued = payload;
        if (saveTimer) clearTimeout(saveTimer);

        saveTimer = setTimeout(() => {
          saveTimer = null;
          flushSaveNow().catch((e) => {
            if (errGlobal) {
              setText(errGlobal, "配送指定の保存に失敗しました。ページを再読み込みして再度お試しください。");
              show(errGlobal);
            }
            console.error(e);
          });
        }, SAVE_DEBOUNCE_MS);
      };

      const onAnyChange = () => {
        const v = validate();
        if (!v.ok) return;
        queueSave(v);
      };

      let viewMonth = null;

      const openOrRenderCalendar = (forceOpen) => {
        if (!dateInput) return;

        const isInline = used?.calendarUi?.mode === "inline";
        const target = isInline ? calInline : calPopover;
        if (!target) return;

        if (isInline) {
          ensureInlineCalendarPlacement(root, calInline, dateRow);
          calInline.hidden = false;
          calInline.style.display = "block";
          if (calPopover) {
            calPopover.hidden = true;
            calPopover.style.display = "none";
          }
        } else {
          if (calInline) {
            calInline.hidden = true;
            calInline.style.display = "none";
          }
        }

        const { minYmd, maxYmd } = computeMinMaxYmdFromUsed();
        const selectedYmd = dateInput.value || "";

        const base = selectedYmd ? ymdToDate(selectedYmd) : minYmd ? ymdToDate(minYmd) : new Date();
        if (!viewMonth) viewMonth = monthStart(base || new Date());

        applyCalendarCssVars(root, used?.calendarUi?.colors);

        const ui = renderCalendar(target, {
          viewMonth,
          selectedYmd,
          minYmd,
          maxYmd,
          blackout: used.blackout,
          startWeek: used?.calendarUi?.startWeek,
        });

        if (!ui || !ui.grid || !ui.prev || !ui.next) return;

        ui.prev.onclick = () => {
          viewMonth = monthStart(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1));
          openOrRenderCalendar(true);
        };

        ui.next.onclick = () => {
          viewMonth = monthStart(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1));
          openOrRenderCalendar(true);
        };

        ui.grid.onclick = (ev) => {
          const btn = ev.target.closest(".cal-day");
          if (!btn || btn.disabled) return;

          const ymd = btn.dataset.ymd;
          if (!ymd) return;

          dateInput.value = ymd;
          if (dateUi) dateUi.value = ymd;

          if (!isInline && calPopover) {
            calPopover.hidden = true;
            calPopover.style.display = "none";
          }

          onAnyChange();

          if (isInline) openOrRenderCalendar(false);
        };

        if (!isInline && calPopover) {
          if (forceOpen) {
            calPopover.style.display = "";
            calPopover.hidden = false;
          } else {
            if (calPopover.hidden) calPopover.style.display = "none";
          }
        }
      };

      const attachGuards = () => {
        findCartForms().forEach((form) => {
          if (form.__deliveryGuardAttached) return;
          form.__deliveryGuardAttached = true;

          form.addEventListener(
            "submit",
            async (ev) => {
              const v = validate();
              if (!v.ok) {
                ev.preventDefault();
                ev.stopPropagation();
                if (errGlobal) {
                  setText(errGlobal, "配送日時指定の未入力/不正な項目があります。入力してから購入してください。");
                  show(errGlobal);
                }
                return;
              }

              lastQueued = v;
              if (saveTimer) {
                clearTimeout(saveTimer);
                saveTimer = null;
              }

              if (!saving) {
                try {
                  await flushSaveNow();
                } catch (e) {
                  ev.preventDefault();
                  ev.stopPropagation();
                  if (errGlobal) {
                    setText(errGlobal, "配送指定の保存に失敗しました。ページを再読み込みして再度お試しください。");
                    show(errGlobal);
                  }
                  console.error(e);
                }
              }
            },
            true
          );
        });

        findProductForms().forEach((form) => {
          if (form.__deliveryProductGuardAttached) return;
          form.__deliveryProductGuardAttached = true;

          form.addEventListener(
            "submit",
            async (ev) => {
              const v = validate();
              if (!v.ok) {
                ev.preventDefault();
                ev.stopPropagation();
                if (errGlobal) {
                  setText(errGlobal, "配送日時指定の未入力/不正な項目があります。入力してからカートに追加してください。");
                  show(errGlobal);
                }
                return;
              }

              lastQueued = v;
              if (saveTimer) {
                clearTimeout(saveTimer);
                saveTimer = null;
              }

              if (!saving) {
                try {
                  await flushSaveNow();
                } catch (e) {
                  ev.preventDefault();
                  ev.stopPropagation();
                  if (errGlobal) {
                    setText(errGlobal, "配送指定の保存に失敗しました。ページを再読み込みして再度お試しください。");
                    show(errGlobal);
                  }
                  console.error(e);
                }
              }
            },
            true
          );
        });
      };

      const applyRemote = async (remote) => {
        // ✅ applyRemoteの間も読み込み中（確実に解除するため try/finally）
        setDeliveryLoading(root, true);

        try {
          if (!remote) return;

          const oldKeys = { date: used.attrDate, time: used.attrTime, placement: used.attrPlacement };

          used.attrDate = remote.attrNames.date || used.attrDate;
          used.attrTime = remote.attrNames.time || used.attrTime;
          used.attrPlacement = remote.attrNames.placement || used.attrPlacement;

          await migrateCartAttributes({
            oldKeys,
            newKeys: { date: used.attrDate, time: used.attrTime, placement: used.attrPlacement },
          });

          used.requiredDate = pickBool(remote.required.date, used.requiredDate);
          used.requiredTime = pickBool(remote.required.time, used.requiredTime);
          used.requiredPlacement = false;

          const nextShowDate = pickBool(remote.show.date, used.showDate);
          const nextShowTime = pickBool(remote.show.time, used.showTime);
          const nextShowPlacement = pickBool(remote.show.placement, used.showPlacement);

          used.showDate = nextShowDate || used.requiredDate;
          used.showTime = nextShowTime || used.requiredTime;
          used.showPlacement = nextShowPlacement || used.requiredPlacement;

          if (Array.isArray(remote.timeSlots) && remote.timeSlots.length > 0) used.timeSlots = remote.timeSlots;
          if (typeof remote.noticeText === "string") used.noticeText = remote.noticeText || used.noticeText;
          if (!Number.isNaN(remote.leadTimeDays)) used.leadTimeDays = remote.leadTimeDays;
          if (!Number.isNaN(remote.rangeDays)) used.rangeDays = remote.rangeDays;
          if (typeof remote.cutoffTime === "string") used.cutoffTime = remote.cutoffTime;

          used.holidays = remote.holidays || used.holidays;
          used.blackout = remote.blackout || used.blackout;

          if (remote.calendarUi) {
            used.calendarUi.mode = remote.calendarUi.mode != null ? remote.calendarUi.mode : used.calendarUi.mode;
            used.calendarUi.startWeek =
              remote.calendarUi.startWeek != null ? remote.calendarUi.startWeek : used.calendarUi.startWeek;
            used.calendarUi.colors = remote.calendarUi.colors || used.calendarUi.colors;
          }

          used.policy = remote.policy || null;

          if (remote.policy && remote.policy.disabled) {
            used.showDate = false;
            used.showTime = false;
            used.showPlacement = false;

            used.requiredDate = false;
            used.requiredTime = false;
            used.requiredPlacement = false;

            used.noticeText = "このカート内容では配送日時指定はできません。";

            try {
              const patch = {};
              patch[used.attrDate] = "";
              patch[used.attrTime] = "";
              patch[used.attrPlacement] = "";
              await cartUpdateAttributes(patch);
            } catch (e) {
              console.warn("[delivery-date] clear attrs on policy.disabled failed", e);
            }

            if (dateInput) dateInput.value = "";
            if (dateUi) dateUi.value = "";
            if (timeSelect) timeSelect.value = "";
            if (placementInput) placementInput.value = "";

            if (calPopover) {
              calPopover.hidden = true;
              calPopover.style.display = "none";
            }
          }

          if (root.__deliveryState) root.__deliveryState.used = used;

          applyUiFromSettings();

          const cart = await cartGet();
          const attrs = (cart && cart.attributes) || {};

          if (dateInput && attrs[used.attrDate]) dateInput.value = attrs[used.attrDate];
          if (dateUi && dateInput && dateInput.value) dateUi.value = dateInput.value;
          if (timeSelect && attrs[used.attrTime]) timeSelect.value = attrs[used.attrTime];
          if (placementInput && attrs[used.attrPlacement]) placementInput.value = attrs[used.attrPlacement];

          openOrRenderCalendar(false);
          attachGuards();
          runCartEmptyCleanup().catch(() => {});
        } finally {
          setDeliveryLoading(root, false);
        }
      };

      root.__deliveryState.applyRemote = applyRemote;

      // init
      applyUiFromSettings();
      attachGuards();

      hookFetchForCartOpsOnce();
      startCartPollerOnce();
      runCartEmptyCleanup().catch(() => {});

      if (timeSelect && !timeSelect.__deliveryBound) {
        timeSelect.__deliveryBound = true;
        timeSelect.addEventListener("change", onAnyChange);
      }

      if (placementInput && !placementInput.__deliveryBound) {
        placementInput.__deliveryBound = true;
        placementInput.addEventListener("input", onAnyChange);
        placementInput.addEventListener("change", onAnyChange);
      }

      if (dateUi && !dateUi.__deliveryBound) {
        dateUi.__deliveryBound = true;

        dateUi.addEventListener("click", () => {
          if (used.calendarUi.mode !== "popup") return;
          openOrRenderCalendar(true);
        });

        dateUi.addEventListener("focus", () => {
          if (used.calendarUi.mode !== "popup") return;
          openOrRenderCalendar(true);
        });
      }

      if (!document.__deliveryDocClickBound) {
        document.__deliveryDocClickBound = true;

        document.addEventListener(
          "click",
          (ev) => {
            const t = ev.target;
            const roots = document.querySelectorAll(SELECTOR);

            roots.forEach((r) => {
              const pop = r.querySelector("[data-calendar]");
              const du = r.querySelector("[data-date-ui]");
              if (!pop || pop.hidden) return;
              if (t === du) return;
              if (pop.contains(t)) return;

              pop.hidden = true;
              pop.style.display = "none";
            });
          },
          true
        );
      }

      if (!document.__deliveryKeyBound) {
        document.__deliveryKeyBound = true;

        document.addEventListener("keydown", (ev) => {
          if (ev.key !== "Escape") return;

          document.querySelectorAll("[data-calendar]").forEach((pop) => {
            pop.hidden = true;
            pop.style.display = "none";
          });
        });
      }

      (async () => {
        const cart = await cartGet();
        const attrs = (cart && cart.attributes) || {};

        // 初期シグネチャを記録（ポーリングでの無駄な再適用を抑制）
        const sig = cartSignature(cart);
        if (sig) lastCartSig = sig;

        if (dateInput && attrs[used.attrDate]) dateInput.value = attrs[used.attrDate];
        if (dateUi && dateInput && dateInput.value) dateUi.value = dateInput.value;

        if (timeSelect && attrs[used.attrTime]) timeSelect.value = attrs[used.attrTime];
        if (placementInput && attrs[used.attrPlacement]) placementInput.value = attrs[used.attrPlacement];

        openOrRenderCalendar(false);
      })().catch(() => {});

      (async () => {
        // ✅ 初回は読み込み中を表示
        setDeliveryLoading(root, true);
        try {
          const remote = normalizeRemoteSettings(await loadRemoteSettingsOnce());
          if (!remote) return;
          await applyRemote(remote);
        } finally {
          setDeliveryLoading(root, false);
        }
      })().catch((e) => console.error("[delivery-date] remote apply failed", e));
    } catch (e) {
      console.error("[delivery-date] initOne failed", e);
      setDeliveryLoading(root, false);
    }
  }

  function boot() {
    document.querySelectorAll(SELECTOR).forEach((root) => initOne(root));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  if (!window.__deliveryMutationObserverAttached) {
    window.__deliveryMutationObserverAttached = true;
    const mo = new MutationObserver(() => boot());
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();

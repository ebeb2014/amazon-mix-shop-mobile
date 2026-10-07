const cfg = window.AMS_CONFIG;
const $ = (id) => document.getElementById(id);
const loginView = $("loginView");
const mainView = $("mainView");
let session = null;
let currentAppUser = null;

const VAPID_PUBLIC_KEY =
  "BDv2FI568ZtOlWFTcmZHWyQG2DesQUbei-pKIYf0WzApJsnMV2MM-cf7qK8bzYLr44GdN2hUt6d55CL5NLOeQLM";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalonePWA() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
}

function setPushStatus(message, isError=false) {
  const el = $("pushStatus");
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("error", !!isError);
}

async function savePushSubscription(subscription) {
  if (!currentAppUser?.owner_id || !session?.user?.id) {
    throw new Error("Identitatea Administratorului nu este disponibilă.");
  }

  const json = subscription.toJSON();
  const response = await fetch(
    cfg.supabaseUrl +
      "/rest/v1/ams_push_subscriptions?on_conflict=endpoint",
    {
      method: "POST",
      headers: {
        ...apiHeaders(true),
        "Prefer": "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify({
        owner_id: currentAppUser.owner_id,
        user_id: session.user.id,
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh || "",
        auth_key: json.keys?.auth || "",
        device_label:
          (isIOS() ? "iPhone/iPad" : navigator.platform || "Browser"),
        enabled: true,
        updated_at: new Date().toISOString()
      })
    }
  );

  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    throw new Error(
      payload?.message || payload?.error || "Nu pot salva abonamentul push."
    );
  }
}

async function enablePushNotifications() {
  if (!("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)) {
    setPushStatus(
      "Acest browser nu suportă notificările push pentru aplicație.",
      true
    );
    return;
  }

  if (isIOS() && !isStandalonePWA()) {
    setPushStatus(
      "Pe iPhone: Share → Add to Home Screen, apoi deschide Amazon Mix Shop din iconiță și apasă din nou aici.",
      true
    );
    return;
  }

  const button = $("enableNotificationsBtn");
  button.disabled = true;
  setPushStatus("Activez notificările...");

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("Permisiunea pentru notificări nu a fost acordată.");
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    await savePushSubscription(subscription);
    setPushStatus("✅ Notificările pentru aprobări sunt active.");
    button.textContent = "🔔 Notificări active";
  } catch (error) {
    setPushStatus(error?.message || String(error), true);
  } finally {
    button.disabled = false;
  }
}

async function refreshPushUi() {
  const button = $("enableNotificationsBtn");
  if (!button) return;

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    button.textContent = "🔕 Push indisponibil";
    button.disabled = true;
    return;
  }

  if (isIOS() && !isStandalonePWA()) {
    setPushStatus(
      "Pentru notificări pe iPhone, instalează întâi aplicația pe Home Screen."
    );
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription && Notification.permission === "granted") {
      button.textContent = "🔔 Notificări active";
      setPushStatus("✅ Telefonul este abonat la aprobări.");
    }
  } catch (_) {}
}

function showStatus(message, isError=false) {
  const el = $("loginStatus");
  el.textContent = message || "";
  el.style.color = isError ? "#b91c1c" : "#374151";
}

function apiHeaders(auth=true) {
  const headers = {
    "apikey": cfg.publishableKey,
    "Content-Type": "application/json"
  };
  if (auth && session?.access_token) {
    headers["Authorization"] = "Bearer " + session.access_token;
  }
  return headers;
}

async function jsonFetch(url, options={}) {
  const response = await fetch(url, options);
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok) {
    throw new Error(
      payload?.msg ||
      payload?.message ||
      payload?.error_description ||
      payload?.error ||
      ("Eroare HTTP " + response.status)
    );
  }
  return payload;
}

async function signIn(email, password) {
  return await jsonFetch(
    cfg.supabaseUrl + "/auth/v1/token?grant_type=password",
    {
      method: "POST",
      headers: apiHeaders(false),
      body: JSON.stringify({ email, password })
    }
  );
}

async function restSelect(table, query) {
  return await jsonFetch(
    cfg.supabaseUrl + "/rest/v1/" + table + "?" + query,
    { headers: apiHeaders(true) }
  );
}

async function restUpdate(table, query, values) {
  return await jsonFetch(
    cfg.supabaseUrl + "/rest/v1/" + table + "?" + query,
    {
      method: "PATCH",
      headers: { ...apiHeaders(true), "Prefer": "return=representation" },
      body: JSON.stringify(values)
    }
  );
}

async function restCount(table, extraQuery="") {
  const response = await fetch(
    cfg.supabaseUrl + "/rest/v1/" + table + "?select=id" + (extraQuery ? "&" + extraQuery : ""),
    {
      method: "HEAD",
      headers: {
        ...apiHeaders(true),
        "Prefer": "count=exact"
      }
    }
  );
  if (!response.ok) {
    throw new Error("Nu pot încărca totalul pentru " + table + ".");
  }
  const range = response.headers.get("content-range") || "";
  const total = range.includes("/") ? range.split("/").pop() : "0";
  return Number(total || 0);
}

function setPanel(id) {
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  $(id).classList.add("active");
  const nav = document.querySelector('.nav-btn[data-panel="' + id + '"]');
  if (nav) nav.classList.add("active");
}

function formatDateRO(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("ro-RO", {
    day:"2-digit", month:"2-digit", year:"numeric",
    hour:"2-digit", minute:"2-digit"
  }).format(d);
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function showMainError(error) {
  alert(error?.message || String(error));
}

async function loadIdentity() {
  const userId = session?.user?.id;
  if (!userId) throw new Error("Sesiune invalidă.");

  const rows = await restSelect(
    "ams_app_users",
    "select=user_id,owner_id,username,display_name,role_name,active,is_primary_admin&user_id=eq." +
      encodeURIComponent(userId) + "&limit=1"
  );

  const data = Array.isArray(rows) ? rows[0] : null;
  if (!data) throw new Error("Contul nu este înregistrat în Amazon Mix Shop.");
  if (!data.active) throw new Error("Contul este dezactivat.");

  currentAppUser = data;
  $("userLabel").textContent =
    (data.display_name || data.username) + " • " + (data.role_name || "");
}


function localISODate(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function money(value) {
  return Number(value || 0).toLocaleString("ro-RO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + " lei";
}

async function loadSalesDashboardData() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const start = new Date(today);
  start.setDate(today.getDate() - 6);

  const startISO = localISODate(start);
  const rows = await restSelect(
    "ams_sales",
    "select=id,product_code,sale_price,sale_date,payment_method,client,created_at" +
    "&sale_date=gte." + encodeURIComponent(startISO) +
    "&order=id.desc"
  );

  const byDate = new Map();
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    byDate.set(localISODate(d), { total: 0, count: 0 });
  }

  for (const row of rows || []) {
    const key = String(row.sale_date || "").slice(0, 10);
    if (!byDate.has(key)) continue;
    const bucket = byDate.get(key);
    bucket.total += Number(row.sale_price || 0);
    bucket.count += 1;
  }

  const todayKey = localISODate(today);
  const yesterdayKey = localISODate(yesterday);
  const todayData = byDate.get(todayKey) || { total: 0, count: 0 };
  const yesterdayData = byDate.get(yesterdayKey) || { total: 0, count: 0 };

  $("salesTodayValue").textContent = money(todayData.total);
  $("salesTodayCount").textContent =
    todayData.count + (todayData.count === 1 ? " produs vândut" : " produse vândute");

  $("salesYesterdayValue").textContent = money(yesterdayData.total);
  $("salesYesterdayCount").textContent =
    yesterdayData.count + (yesterdayData.count === 1 ? " produs vândut" : " produse vândute");

  const weekTotal = [...byDate.values()]
    .reduce((sum, item) => sum + item.total, 0);
  $("weekSalesTotal").textContent = money(weekTotal);

  const chart = $("salesWeekChart");
  chart.innerHTML = "";
  const maxValue = Math.max(1, ...[...byDate.values()].map(x => x.total));
  const dayFmt = new Intl.DateTimeFormat("ro-RO", { weekday: "short" });

  for (const [dateKey, item] of byDate.entries()) {
    const d = new Date(dateKey + "T12:00:00");
    const col = document.createElement("div");
    col.className = "chart-col";
    const height = Math.max(8, Math.round((item.total / maxValue) * 100));
    col.innerHTML =
      '<div class="chart-value">' + Math.round(item.total) + '</div>' +
      '<div class="chart-bar-wrap"><div class="chart-bar" style="height:' + height + '%"></div></div>' +
      '<div class="chart-label">' + escapeHtml(dayFmt.format(d).replace(".", "")) + '</div>';
    chart.appendChild(col);
  }

  const recent = (rows || []).slice(0, 6);
  const recentRoot = $("recentSalesList");
  recentRoot.innerHTML = "";

  if (!recent.length) {
    recentRoot.innerHTML = '<div class="empty-state">Nu sunt vânzări în ultimele 7 zile.</div>';
  } else {
    recent.forEach(row => {
      const item = document.createElement("div");
      item.className = "recent-item";
      item.innerHTML =
        '<div class="recent-icon">🧾</div>' +
        '<div class="recent-main">' +
          '<strong>' + escapeHtml(row.product_code || "Produs") + '</strong>' +
          '<span>' + escapeHtml(row.payment_method || "-") + ' • ' +
            formatDateRO(row.created_at || row.sale_date) + '</span>' +
        '</div>' +
        '<div class="recent-amount">' + money(row.sale_price) + '</div>';
      recentRoot.appendChild(item);
    });
  }
}

async function loadDashboard() {
  const now = new Date();
  $("dashboardGreeting").textContent =
    "Bun venit, " +
    (currentAppUser?.display_name || currentAppUser?.username || "Admin");
  $("dashboardDate").textContent =
    new Intl.DateTimeFormat("ro-RO", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(now);

  const [
    stockCount,
    approvalCount
  ] = await Promise.all([
    restCount("ams_products", "status=eq.In%20stoc"),
    restCount("ams_approval_requests", "status=eq.pending")
  ]);

  $("stockCount").textContent =
    Number(stockCount || 0).toLocaleString("ro-RO");
  $("approvalCount").textContent =
    Number(approvalCount || 0).toLocaleString("ro-RO");

  const badge = $("approvalBadge");
  const n = Number(approvalCount || 0);
  badge.textContent = String(n);
  badge.classList.toggle("hidden", n <= 0);

  await loadSalesDashboardData();
}

async function loadStock() {
  const q = $("stockSearch").value.trim();
  const pageSize = 500;
  let offset = 0;
  let data = [];

  while (true) {
    let query =
      "select=product_code,name,ean,lot_code,sale_price,status,updated_at" +
      "&status=eq.In%20stoc&order=updated_at.desc" +
      "&limit=" + pageSize +
      "&offset=" + offset;

    if (q) {
      const safe = q.replace(/[%_,]/g, "");
      const orFilter =
        "(product_code.ilike.*" + safe +
        "*,name.ilike.*" + safe +
        "*,ean.ilike.*" + safe +
        "*,lot_code.ilike.*" + safe + "*)";
      query += "&or=" + encodeURIComponent(orFilter);
    }

    const page = await restSelect("ams_products", query);
    if (!Array.isArray(page) || page.length === 0) break;

    data = data.concat(page);

    if (page.length < pageSize) break;
    offset += page.length;
  }

  const root = $("stockList");
  root.innerHTML = "";

  if (!data.length) {
    root.innerHTML = '<div class="list-item">Nu am găsit produse.</div>';
    return;
  }

  const summary = document.createElement("div");
  summary.className = "list-item";
  summary.innerHTML =
    '<div class="list-title">Produse afișate: ' + data.length + '</div>' +
    '<div class="list-meta">Lista conține tot stocul găsit pentru filtrul curent.</div>';
  root.appendChild(summary);

  const fragment = document.createDocumentFragment();

  data.forEach(row => {
    const el = document.createElement("article");
    el.className = "list-item";
    el.innerHTML =
      '<div class="list-title">' + escapeHtml(row.name || "Produs") + '</div>' +
      '<div class="list-meta">' +
      'Cod: ' + escapeHtml(row.product_code || "-") + '<br>' +
      'EAN: ' + escapeHtml(row.ean || "-") + ' • Lot: ' + escapeHtml(row.lot_code || "-") + '<br>' +
      'Preț: ' + Number(row.sale_price || 0).toFixed(2) + ' lei' +
      '</div>';
    fragment.appendChild(el);
  });

  root.appendChild(fragment);
}

async function loadHistory() {
  const data = await restSelect(
    "ams_sales",
    "select=id,product_code,sale_price,sale_date,payment_method,client,created_at" +
    "&order=id.desc&limit=100"
  );

  const root = $("historyList");
  root.innerHTML = "";

  if (!data?.length) {
    root.innerHTML = '<div class="list-item">Nu există vânzări.</div>';
    return;
  }

  data.forEach(row => {
    const el = document.createElement("article");
    el.className = "list-item";
    el.innerHTML =
      '<div class="list-title">' +
      escapeHtml(row.product_code || "-") + ' • ' +
      Number(row.sale_price || 0).toFixed(2) + ' lei</div>' +
      '<div class="list-meta">' +
      escapeHtml(row.sale_date || "-") + ' • ' +
      escapeHtml(row.payment_method || "-") +
      (row.client ? '<br>Client: ' + escapeHtml(row.client) : '') +
      '</div>';
    root.appendChild(el);
  });
}

async function decideApproval(id, decision) {
  const nextStatus = decision === "approve" ? "approved" : "rejected";

  await restUpdate(
    "ams_approval_requests",
    "id=eq." + encodeURIComponent(id) + "&status=eq.pending",
    {
      status: nextStatus,
      decision_by: session.user.id,
      decided_at: new Date().toISOString()
    }
  );

  await Promise.all([loadApprovals(), loadDashboard()]);
}

async function loadApprovals() {
  const data = await restSelect(
    "ams_approval_requests",
    "select=id,requester_username,permission_code,operation_type,entity_type,entity_id,summary,status,requested_at,expires_at" +
    "&status=eq.pending&order=requested_at.desc&limit=100"
  );

  const root = $("approvalList");
  root.innerHTML = "";

  if (!data?.length) {
    root.innerHTML =
      '<div class="list-item">Nu sunt cereri de aprobare în așteptare.</div>';
    return;
  }

  data.forEach(row => {
    const el = document.createElement("article");
    el.className = "list-item";
    el.innerHTML =
      '<div class="list-title">' +
      escapeHtml(row.operation_type || row.permission_code || "Cerere") +
      '</div>' +
      '<div class="list-meta">' +
      'Utilizator: ' + escapeHtml(row.requester_username || "-") + '<br>' +
      escapeHtml(row.summary || "") +
      (row.entity_id ? '<br>Element: ' + escapeHtml(row.entity_id) : '') +
      '<br>' + formatDateRO(row.requested_at) +
      '</div>' +
      '<div class="approval-actions">' +
      '<button class="approve-btn">Aprobă</button>' +
      '<button class="reject-btn">Respinge</button>' +
      '</div>';

    el.querySelector(".approve-btn").onclick =
      () => decideApproval(row.id, "approve").catch(showMainError);
    el.querySelector(".reject-btn").onclick =
      () => decideApproval(row.id, "reject").catch(showMainError);

    root.appendChild(el);
  });
}

async function enterApp() {
  await loadIdentity();
  loginView.classList.add("hidden");
  mainView.classList.remove("hidden");
  await Promise.all([loadDashboard(), loadApprovals()]);
  await refreshPushUi();

  const params = new URLSearchParams(window.location.search);
  if (params.get("approval")) {
    setPanel("approvalsPanel");
    await loadApprovals();
  }
}

$("togglePasswordBtn").addEventListener("click", () => {
  const input = $("passwordInput");
  input.type = input.type === "password" ? "text" : "password";
});

$("loginBtn").addEventListener("click", async () => {
  const email = $("emailInput").value.trim();
  const password = $("passwordInput").value;

  if (!email || !password) {
    showStatus("Completează emailul și parola.", true);
    return;
  }

  $("loginBtn").disabled = true;
  showStatus("Se conectează...");

  try {
    session = await signIn(email, password);
    localStorage.setItem("ams_mobile_session", JSON.stringify(session));
    await enterApp();
    showStatus("");
  } catch (e) {
    session = null;
    localStorage.removeItem("ams_mobile_session");
    showStatus(e?.message || String(e), true);
  } finally {
    $("loginBtn").disabled = false;
  }
});

$("logoutBtn").addEventListener("click", () => {
  session = null;
  currentAppUser = null;
  localStorage.removeItem("ams_mobile_session");
  mainView.classList.add("hidden");
  loginView.classList.remove("hidden");
  $("passwordInput").value = "";
});

$("refreshDashboardBtn").onclick = () => loadDashboard().catch(showMainError);
$("enableNotificationsBtn").onclick = () => enablePushNotifications();
$("openHistoryFromDashboard").onclick = async () => {
  setPanel("historyPanel");
  await loadHistory().catch(showMainError);
};
$("refreshStockBtn").onclick = () => loadStock().catch(showMainError);
$("refreshApprovalsBtn").onclick = () => loadApprovals().catch(showMainError);
$("refreshHistoryBtn").onclick = () => loadHistory().catch(showMainError);

$("stockSearch").addEventListener("input", () => {
  clearTimeout(window.__stockTimer);
  window.__stockTimer = setTimeout(
    () => loadStock().catch(showMainError),
    350
  );
});

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const panel = btn.dataset.panel;
    setPanel(panel);
    if (panel === "stockPanel") await loadStock().catch(showMainError);
    if (panel === "approvalsPanel") await loadApprovals().catch(showMainError);
    if (panel === "historyPanel") await loadHistory().catch(showMainError);
    if (panel === "dashboardPanel") await loadDashboard().catch(showMainError);
  });
});

try {
  const saved = JSON.parse(localStorage.getItem("ams_mobile_session") || "null");
  if (saved?.access_token && saved?.user?.id) {
    session = saved;
    enterApp().catch(() => {
      session = null;
      localStorage.removeItem("ams_mobile_session");
    });
  }
} catch (_) {}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

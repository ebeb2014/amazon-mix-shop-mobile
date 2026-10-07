const cfg = window.AMS_CONFIG;
const $ = (id) => document.getElementById(id);
const loginView = $("loginView");
const mainView = $("mainView");
let session = null;
let currentAppUser = null;

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
    "select=user_id,username,display_name,role_name,active,is_primary_admin&user_id=eq." +
      encodeURIComponent(userId) + "&limit=1"
  );

  const data = Array.isArray(rows) ? rows[0] : null;
  if (!data) throw new Error("Contul nu este înregistrat în Amazon Mix Shop.");
  if (!data.active) throw new Error("Contul este dezactivat.");

  currentAppUser = data;
  $("userLabel").textContent =
    (data.display_name || data.username) + " • " + (data.role_name || "");
}

async function loadDashboard() {
  const results = await Promise.all([
    restCount("ams_products", "status=eq.In%20stoc"),
    restCount("ams_sales"),
    restCount("ams_approval_requests", "status=eq.pending")
  ]);

  $("stockCount").textContent = results[0];
  $("salesCount").textContent = results[1];
  $("approvalCount").textContent = results[2];

  const badge = $("approvalBadge");
  badge.textContent = String(results[2]);
  badge.classList.toggle("hidden", results[2] <= 0);
}

async function loadStock() {
  const q = $("stockSearch").value.trim();
  let query =
    "select=product_code,name,ean,lot_code,sale_price,status,updated_at" +
    "&status=eq.In%20stoc&order=updated_at.desc&limit=100";

  if (q) {
    const safe = q.replace(/[%_,]/g, "");
    const orFilter =
      "(product_code.ilike.*" + safe +
      "*,name.ilike.*" + safe +
      "*,ean.ilike.*" + safe +
      "*,lot_code.ilike.*" + safe + "*)";
    query += "&or=" + encodeURIComponent(orFilter);
  }

  const data = await restSelect("ams_products", query);
  const root = $("stockList");
  root.innerHTML = "";

  if (!data?.length) {
    root.innerHTML = '<div class="list-item">Nu am găsit produse.</div>';
    return;
  }

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
    root.appendChild(el);
  });
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

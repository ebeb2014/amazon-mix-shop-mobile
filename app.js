const cfg = window.AMS_CONFIG;
const supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const $ = (id) => document.getElementById(id);
const loginView = $("loginView");
const mainView = $("mainView");
let currentAppUser = null;

function showStatus(message, isError=false) {
  const el = $("loginStatus");
  el.textContent = message || "";
  el.style.color = isError ? "#b91c1c" : "#374151";
}

function setPanel(id) {
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  $(id).classList.add("active");
  document.querySelector(`.nav-btn[data-panel="${id}"]`)?.classList.add("active");
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

async function loadIdentity() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sesiune invalidă.");

  const { data, error } = await supabase
    .from("ams_app_users")
    .select("user_id,username,display_name,role_name,active,is_primary_admin")
    .eq("user_id", user.id)
    .single();

  if (error) throw error;
  if (!data?.active) throw new Error("Contul este dezactivat.");
  currentAppUser = data;
  $("userLabel").textContent = `${data.display_name || data.username} • ${data.role_name || ""}`;
}

async function loadDashboard() {
  const [
    { count: stockCount, error: e1 },
    { count: salesCount, error: e2 },
    { count: approvalCount, error: e3 }
  ] = await Promise.all([
    supabase.from("ams_products").select("*", { count:"exact", head:true }).eq("status", "In stoc"),
    supabase.from("ams_sales").select("*", { count:"exact", head:true }),
    supabase.from("ams_approval_requests").select("*", { count:"exact", head:true }).eq("status", "pending")
  ]);

  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;

  $("stockCount").textContent = stockCount ?? 0;
  $("salesCount").textContent = salesCount ?? 0;
  $("approvalCount").textContent = approvalCount ?? 0;

  const badge = $("approvalBadge");
  const n = approvalCount ?? 0;
  badge.textContent = String(n);
  badge.classList.toggle("hidden", n <= 0);
}

async function loadStock() {
  const q = $("stockSearch").value.trim();
  let request = supabase
    .from("ams_products")
    .select("product_code,name,ean,lot_code,sale_price,status")
    .eq("status", "In stoc")
    .order("updated_at", { ascending:false })
    .limit(100);

  if (q) {
    const safe = q.replace(/[%_,]/g, "");
    request = request.or(
      `product_code.ilike.%${safe}%,name.ilike.%${safe}%,ean.ilike.%${safe}%,lot_code.ilike.%${safe}%`
    );
  }

  const { data, error } = await request;
  if (error) throw error;

  const root = $("stockList");
  root.innerHTML = "";
  if (!data?.length) {
    root.innerHTML = `<div class="list-item">Nu am găsit produse.</div>`;
    return;
  }

  data.forEach(row => {
    const el = document.createElement("article");
    el.className = "list-item";
    el.innerHTML = `
      <div class="list-title">${escapeHtml(row.name || "Produs")}</div>
      <div class="list-meta">
        Cod: ${escapeHtml(row.product_code || "-")}<br>
        EAN: ${escapeHtml(row.ean || "-")} • Lot: ${escapeHtml(row.lot_code || "-")}<br>
        Preț: ${Number(row.sale_price || 0).toFixed(2)} lei
      </div>`;
    root.appendChild(el);
  });
}

async function loadHistory() {
  const { data, error } = await supabase
    .from("ams_sales")
    .select("id,product_code,sale_price,sale_date,payment_method,client,created_at")
    .order("id", { ascending:false })
    .limit(100);

  if (error) throw error;

  const root = $("historyList");
  root.innerHTML = "";
  if (!data?.length) {
    root.innerHTML = `<div class="list-item">Nu există vânzări.</div>`;
    return;
  }

  data.forEach(row => {
    const el = document.createElement("article");
    el.className = "list-item";
    el.innerHTML = `
      <div class="list-title">${escapeHtml(row.product_code || "-")} • ${Number(row.sale_price || 0).toFixed(2)} lei</div>
      <div class="list-meta">
        ${escapeHtml(row.sale_date || "-")} • ${escapeHtml(row.payment_method || "-")}
        ${row.client ? `<br>Client: ${escapeHtml(row.client)}` : ""}
      </div>`;
    root.appendChild(el);
  });
}

async function decideApproval(id, decision) {
  const nextStatus = decision === "approve" ? "approved" : "rejected";
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("ams_approval_requests")
    .update({
      status: nextStatus,
      decision_by: user.id,
      decided_at: new Date().toISOString()
    })
    .eq("id", id)
    .eq("status", "pending");

  if (error) throw error;
  await Promise.all([loadApprovals(), loadDashboard()]);
}

async function loadApprovals() {
  const { data, error } = await supabase
    .from("ams_approval_requests")
    .select("id,requester_username,permission_code,operation_type,entity_type,entity_id,summary,status,requested_at,expires_at")
    .eq("status", "pending")
    .order("requested_at", { ascending:false })
    .limit(100);

  if (error) throw error;

  const root = $("approvalList");
  root.innerHTML = "";
  if (!data?.length) {
    root.innerHTML = `<div class="list-item">Nu sunt cereri de aprobare în așteptare.</div>`;
    return;
  }

  data.forEach(row => {
    const el = document.createElement("article");
    el.className = "list-item";
    el.innerHTML = `
      <div class="list-title">${escapeHtml(row.operation_type || row.permission_code || "Cerere")}</div>
      <div class="list-meta">
        Utilizator: ${escapeHtml(row.requester_username || "-")}<br>
        ${escapeHtml(row.summary || "")}
        ${row.entity_id ? `<br>Element: ${escapeHtml(row.entity_id)}` : ""}
        <br>${formatDateRO(row.requested_at)}
      </div>
      <div class="approval-actions">
        <button class="approve-btn">Aprobă</button>
        <button class="reject-btn">Respinge</button>
      </div>`;
    el.querySelector(".approve-btn").onclick = () => decideApproval(row.id, "approve").catch(showMainError);
    el.querySelector(".reject-btn").onclick = () => decideApproval(row.id, "reject").catch(showMainError);
    root.appendChild(el);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function showMainError(error) {
  alert(error?.message || String(error));
}

async function enterApp() {
  await loadIdentity();
  loginView.classList.add("hidden");
  mainView.classList.remove("hidden");
  await Promise.all([loadDashboard(), loadApprovals()]);
}

$("togglePasswordBtn").onclick = () => {
  const input = $("passwordInput");
  input.type = input.type === "password" ? "text" : "password";
};

$("loginBtn").onclick = async () => {
  const email = $("emailInput").value.trim();
  const password = $("passwordInput").value;
  if (!email || !password) {
    showStatus("Completează emailul și parola.", true);
    return;
  }

  $("loginBtn").disabled = true;
  showStatus("Se conectează...");
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await enterApp();
    showStatus("");
  } catch (e) {
    showStatus(e?.message || String(e), true);
  } finally {
    $("loginBtn").disabled = false;
  }
};

$("logoutBtn").onclick = async () => {
  await supabase.auth.signOut();
  currentAppUser = null;
  mainView.classList.add("hidden");
  loginView.classList.remove("hidden");
  $("passwordInput").value = "";
};

$("refreshDashboardBtn").onclick = () => loadDashboard().catch(showMainError);
$("refreshStockBtn").onclick = () => loadStock().catch(showMainError);
$("refreshApprovalsBtn").onclick = () => loadApprovals().catch(showMainError);
$("refreshHistoryBtn").onclick = () => loadHistory().catch(showMainError);
$("stockSearch").addEventListener("input", () => {
  clearTimeout(window.__stockTimer);
  window.__stockTimer = setTimeout(() => loadStock().catch(showMainError), 350);
});

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.onclick = async () => {
    const panel = btn.dataset.panel;
    setPanel(panel);
    if (panel === "stockPanel") await loadStock().catch(showMainError);
    if (panel === "approvalsPanel") await loadApprovals().catch(showMainError);
    if (panel === "historyPanel") await loadHistory().catch(showMainError);
    if (panel === "dashboardPanel") await loadDashboard().catch(showMainError);
  };
});

supabase.auth.getSession().then(async ({ data }) => {
  if (data?.session) {
    try { await enterApp(); } catch (_) { await supabase.auth.signOut(); }
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

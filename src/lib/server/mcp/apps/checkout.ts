import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_APP_MIME_TYPE, buildViewHtml, toolUiMeta, viewResourceMeta } from "./shared";

/**
 * Checkout status view for checkout_cart and complete_ciba_checkout.
 *
 * Over the approval threshold, checkout_cart returns "awaiting_approval"
 * (not an error) and this card shows a spinner while the buyer approves the
 * Auth0 CIBA push on their phone. The card polls the app-only
 * get_checkout_status tool, which only reads state, so it flips to
 * "Order placed" exactly when complete_ciba_checkout has created the order
 * after approval — or to declined / expired, with no order.
 */
export const CHECKOUT_UI_URI = "ui://retailzero/checkout.html";
export const checkoutUiToolMeta = toolUiMeta(CHECKOUT_UI_URI);

const CSS = /* css */ `
  .co { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  .state { display: flex; gap: 14px; align-items: flex-start; }
  .state h2 { margin: 0 0 3px; font-size: 15px; font-weight: 700; }
  .state p { margin: 0; font-size: 13px; line-height: 1.45; color: var(--muted); }
  .state .hint { margin-top: 6px; font-size: 12px; }
  .state .exp { margin-top: 4px; font-size: 12px; font-variant-numeric: tabular-nums; }
  .icon { flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-size: 17px; font-weight: 700; }
  .spin { border: 3px solid var(--border); border-top-color: var(--accent); animation: spin .9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .icon.ok { background: var(--ok); color: #fff; }
  .icon.bad { background: transparent; color: var(--warn); border: 2px solid var(--warn); }
  .sum { border-top: 1px solid var(--border); padding-top: 12px; }
  .sum h3 { margin: 0 0 8px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  .it { display: grid; grid-template-columns: 40px 1fr auto; gap: 10px; align-items: center; padding: 4px 0; font-size: 13px; }
  .it img { width: 40px; height: 40px; border-radius: 6px; object-fit: cover; background: var(--soft); display: block; }
  .it .q { color: var(--muted); font-size: 12px; }
  .tot { display: flex; justify-content: space-between; font-weight: 700; font-size: 14px; padding-top: 8px; margin-top: 4px; border-top: 1px dashed var(--border); }
`;

const BODY = /* html */ `<div id="root" class="empty">Loading checkout…</div>`;

const SCRIPT = /* js */ `
  var root = document.getElementById("root");
  var esc = rz.esc, money = rz.money;
  var co = null;
  var pollTimer = null, tickTimer = null;
  var POLL_MS = 2500;

  // Copy reviewed for tone. Placeholders are filled in by fill().
  var COPY = {
    awaiting: { title: "Approve on your phone", body: "We sent a push notification to your phone. Approve the {total} purchase to place your order.", hint: "The notification reads “{binding_message}”.", expires: "Expires in {time}" },
    confirmed: { title: "Order placed", body: "Order {order_id} · {total}. Thanks for shopping with RetailZero." },
    denied: { title: "Purchase declined", body: "You declined the request on your phone, so no order was placed. Your cart hasn't changed." },
    expired: { title: "Approval timed out", body: "Your approval window closed, so no order was placed and your cart hasn't changed." },
    error: { title: "Something went wrong", body: "We couldn't complete your checkout, so no order was placed." },
    summary: { heading: "Order summary", total: "Total" },
  };
  function fill(t, v) { return t.replace(/\\{(\\w+)\\}/g, function (_, k) { return v[k] != null ? v[k] : ""; }); }

  function remaining() {
    if (!co || !co.expires_at) return "";
    var s = Math.max(0, Math.round((Date.parse(co.expires_at) - Date.now()) / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function stateHtml() {
    var v = { total: money(co.total), binding_message: esc(co.binding_message || ""), order_id: esc(co.order ? co.order.order_id : ""), time: remaining() };
    if (co.status === "awaiting_approval") {
      return '<div class="state"><div class="icon spin" role="status" aria-label="Waiting for approval"></div><div>' +
        '<h2>' + COPY.awaiting.title + '</h2><p>' + fill(COPY.awaiting.body, v) + '</p>' +
        (co.binding_message ? '<p class="hint">' + fill(COPY.awaiting.hint, v) + '</p>' : "") +
        (co.expires_at ? '<p class="exp" id="exp">' + fill(COPY.awaiting.expires, v) + '</p>' : "") +
        '</div></div>';
    }
    var c = COPY[co.status] || COPY.error;
    var ok = co.status === "confirmed";
    return '<div class="state"><div class="icon ' + (ok ? "ok" : "bad") + '">' + (ok ? "✓" : "!") + '</div><div>' +
      '<h2>' + c.title + '</h2><p>' + fill(c.body, v) + '</p></div></div>';
  }

  function summaryHtml() {
    if (!co.items || !co.items.length) return "";
    return '<div class="sum"><h3>' + COPY.summary.heading + '</h3>' +
      co.items.map(function (i) {
        return '<div class="it">' + (i.image_url ? '<img src="' + esc(i.image_url) + '" alt="" />' : '<div></div>') +
          '<div>' + esc(i.name) + ' <span class="q">× ' + i.quantity + '</span></div><div>' + money(i.price * i.quantity) + '</div></div>';
      }).join("") +
      '<div class="tot"><span>' + COPY.summary.total + '</span><span>' + money(co.total) + '</span></div></div>';
  }

  function render() {
    if (!co) return;
    root.className = "card co";
    root.innerHTML = stateHtml() + summaryHtml();
    rz.watchImages(root);
    rz.reportSize();
    schedule();
  }

  function schedule() {
    clearTimeout(pollTimer);
    clearInterval(tickTimer);
    if (!co || co.status !== "awaiting_approval") return;
    tickTimer = setInterval(function () {
      var el = document.getElementById("exp");
      if (el) el.textContent = fill(COPY.awaiting.expires, { time: remaining() });
    }, 1000);
    if (!rz.canCallTools() || !co.auth_req_id) return;
    pollTimer = setTimeout(function () {
      rz.callTool("get_checkout_status", { auth_req_id: co.auth_req_id })
        .then(apply)
        .catch(function () {})
        .then(function () { if (co.status === "awaiting_approval") schedule(); });
    }, POLL_MS);
  }

  // Never step backwards: a settled card stays settled even if an older
  // "awaiting" result arrives later.
  function apply(data) {
    var next = data && data.checkout;
    if (!next) return;
    if (co && co.auth_req_id && next.auth_req_id && co.auth_req_id !== next.auth_req_id) return;
    if (co && co.status !== "awaiting_approval" && next.status === "awaiting_approval") return;
    co = next;
    render();
  }

  rz.onToolResult = apply;
  rz.onReady = function () { render(); };
`;

const HTML = buildViewHtml({ css: CSS, body: BODY, script: SCRIPT, appName: "RetailZero Checkout" });

export function registerCheckoutUi(server: McpServer): void {
  server.registerResource(
    "checkout",
    CHECKOUT_UI_URI,
    {
      title: "RetailZero Checkout",
      description: "Live checkout status, including push-notification approval for larger orders.",
      mimeType: MCP_APP_MIME_TYPE,
    },
    async () => ({
      contents: [{ uri: CHECKOUT_UI_URI, mimeType: MCP_APP_MIME_TYPE, text: HTML, _meta: viewResourceMeta }],
    })
  );
}

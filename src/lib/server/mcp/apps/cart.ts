import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_APP_MIME_TYPE, buildViewHtml, toolUiMeta, viewResourceMeta } from "./shared";

/**
 * Cart view for view_cart.
 *
 * Quantity and remove controls call update_cart_item / remove_from_cart /
 * clear_cart through the host, so every change runs through the same Auth0
 * scope check as a model-initiated call. Checkout is deliberately NOT a
 * direct tool call: the button posts "Check out my cart." into the chat so
 * the model drives checkout_cart and narrates the CIBA approval step.
 *
 * Old cart cards in the transcript would otherwise show a stale snapshot,
 * so the view re-fetches view_cart on load and keeps whichever copy has the
 * newest `updated_at`.
 *
 * Checkout state comes from the server (`cart.checkout`), not from the
 * card, so every cart card agrees. Clicking Check out first calls the
 * app-only request_checkout tool, which marks the checkout as requested
 * server-side; the card the model renders next (via view_cart) therefore
 * opens already locked. The lock holds through the CIBA approval and
 * clears when the order lands. Cards poll view_cart while checkout is in
 * flight so older cards in the transcript catch up too.
 */
export const CART_UI_URI = "ui://retailzero/cart.html";
export const cartUiToolMeta = toolUiMeta(CART_UI_URI);

const CSS = /* css */ `
  .cart { padding: 4px 0; }
  .head { display: flex; justify-content: space-between; align-items: baseline; padding: 12px 16px 8px; }
  .head h2 { margin: 0; font-size: 15px; font-weight: 700; }
  .head .count { font-size: 12px; color: var(--muted); }
  .line { display: grid; grid-template-columns: 64px 1fr auto; gap: 12px; align-items: center; padding: 10px 16px; border-top: 1px solid var(--border); }
  .line img { width: 64px; height: 64px; border-radius: 8px; object-fit: cover; background: var(--soft); display: block; }
  .line .name { font-size: 13.5px; font-weight: 600; line-height: 1.3; }
  .line .unit { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .controls { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
  .step { width: 26px; height: 26px; padding: 0; border-radius: 6px; font-size: 15px; line-height: 1; }
  .qty { min-width: 18px; text-align: center; font-size: 13px; font-weight: 600; }
  .remove { background: none; border: 0; padding: 0 0 0 6px; font: inherit; font-size: 12px; color: var(--muted); cursor: pointer; text-decoration: underline; }
  .remove:disabled { opacity: .5; cursor: default; }
  .lt { font-size: 14px; font-weight: 700; text-align: right; }
  .foot { border-top: 1px solid var(--border); padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 10px; }
  .total { display: flex; justify-content: space-between; font-size: 15px; font-weight: 700; }
  .note { font-size: 12px; color: var(--muted); line-height: 1.4; }
  .actions { display: flex; gap: 8px; align-items: center; }
  .actions .btn.primary { flex: 1; padding: 10px 14px; }
  .busy { opacity: .6; pointer-events: none; }
  .msg { padding: 0 16px 10px; }
  .status { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 10px; font-size: 13px; line-height: 1.4; background: var(--soft); border: 1px solid var(--border); }
  .status strong { display: block; font-size: 13.5px; margin-bottom: 2px; }
  .status.ok { border-color: var(--ok); }
  .status .dot { flex: none; width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--warn); animation: pulse 1.4s ease-in-out infinite; }
  .status.ok .dot { background: var(--ok); animation: none; }
  @keyframes pulse { 50% { opacity: .3; } }
  .locked .step, .locked .remove { display: none; }
`;

const BODY = /* html */ `<div id="root" class="empty">Loading cart…</div>`;

const SCRIPT = /* js */ `
  var root = document.getElementById("root");
  var esc = rz.esc, money = rz.money;
  var cart = null;
  var error = "";
  var loadedAt = Date.now();
  var pollTimer = null;
  var POLL_MS = 3000;

  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    return String(b.updated_at || "") >= String(a.updated_at || "") ? b : a;
  }

  function normalize(data) {
    if (!data) return null;
    var c = data.cart || data;
    if (!Array.isArray(c.items)) return null;
    return {
      items: c.items,
      total: c.total || 0,
      item_count: c.item_count != null ? c.item_count : c.items.reduce(function (s, i) { return s + i.quantity; }, 0),
      updated_at: c.updated_at || "",
      ciba_required_above: data.ciba_required_above != null ? data.ciba_required_above : (cart && cart.ciba_required_above),
      checkout: c.checkout || (cart && cart.checkout) || { status: null, pending: null, last_order: null },
    };
  }

  // All derived from server state:
  // "pending"   - a CIBA approval is outstanding
  // "requested" - the user clicked Check out; the model hasn't run checkout_cart yet
  // "done"      - an order was placed while this card was open (or just before)
  // "idle"      - nothing in flight
  function checkoutState() {
    var co = cart && cart.checkout;
    if (!co) return "idle";
    if (co.status === "awaiting_approval" || co.pending) return "pending";
    if (co.status === "requested") return "requested";
    if (co.last_order && !cart.items.length && Date.parse(co.last_order.created_at) >= loadedAt - 120000) return "done";
    return "idle";
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    var s = checkoutState();
    if (!rz.canCallTools() || (s !== "pending" && s !== "requested")) return;
    pollTimer = setTimeout(function () {
      rz.callTool("view_cart").then(function (data) {
        var c = normalize(data);
        if (c) { cart = c; render(); }
      }).catch(function () {}).then(schedulePoll);
    }, POLL_MS);
  }

  function statusHtml(s) {
    var co = cart.checkout || {};
    if (s === "pending") {
      return '<div class="status"><span class="dot"></span><div><strong>Approve on your phone</strong>' +
        'We sent a push notification to your phone. Approve the ' + money(co.pending.total) + ' purchase to place your order.</div></div>';
    }
    if (s === "requested") {
      return '<div class="status"><span class="dot"></span><div><strong>Checkout in progress</strong>' +
        'The assistant is placing your order. This cart is locked until it finishes.</div></div>';
    }
    if (s === "done" && co.last_order) {
      return '<div class="status ok"><span class="dot"></span><div><strong>Order placed</strong>' +
        esc(co.last_order.order_id) + ' · ' + money(co.last_order.total) + '</div></div>';
    }
    return "";
  }

  function lineHtml(i) {
    var interactive = rz.canCallTools();
    return '<div class="line" data-id="' + esc(i.product_id) + '" data-name="' + esc(i.name) + '" data-qty="' + i.quantity + '">' +
      (i.image_url ? '<img src="' + esc(i.image_url) + '" alt="' + esc(i.name) + '" />' : '<div></div>') +
      '<div><div class="name">' + esc(i.name) + '</div>' +
        '<div class="unit">' + money(i.price) + ' each</div>' +
        (interactive
          ? '<div class="controls">' +
              '<button class="btn ghost step" data-act="dec" aria-label="Decrease quantity">−</button>' +
              '<span class="qty">' + i.quantity + '</span>' +
              '<button class="btn ghost step" data-act="inc" aria-label="Increase quantity">+</button>' +
              '<button class="remove" data-act="remove">Remove</button>' +
            '</div>'
          : '<div class="unit">Qty ' + i.quantity + '</div>') +
      '</div>' +
      '<div class="lt">' + money(i.price * i.quantity) + '</div>' +
    '</div>';
  }

  function render() {
    if (!cart) return;
    var state = checkoutState();
    if (!cart.items.length) {
      root.className = "card" + (state === "done" ? " foot" : " empty");
      root.innerHTML = state === "done" ? statusHtml(state) : "Your cart is empty.";
      rz.reportSize();
      schedulePoll();
      return;
    }
    var limit = cart.ciba_required_above;
    var needsApproval = limit != null && cart.total > limit;
    var locked = state === "pending" || state === "requested";
    root.className = "card cart" + (locked ? " locked" : "");
    root.innerHTML =
      '<div class="head"><h2>Your cart</h2><span class="count">' + cart.item_count + ' item' + (cart.item_count === 1 ? "" : "s") + '</span></div>' +
      cart.items.map(lineHtml).join("") +
      (error ? '<div class="msg">' + esc(error) + '</div>' : "") +
      '<div class="foot">' +
        '<div class="total"><span>Total</span><span>' + money(cart.total) + '</span></div>' +
        (locked
          ? statusHtml(state)
          : (needsApproval
              ? '<div class="note">Orders over ' + money(limit) + ' need your approval. You\\'ll get a push notification to confirm on your phone.</div>'
              : "") +
            '<div class="actions">' +
              (rz.canMessage()
                ? '<button class="btn primary" data-act="checkout">Check out</button>'
                : '<div class="note">Ask the assistant to check out when you\\'re ready.</div>') +
              (rz.canCallTools() ? '<button class="btn ghost" data-act="clear">Clear</button>' : "") +
            '</div>') +
      '</div>';
    rz.watchImages(root);
    rz.reportSize();
    schedulePoll();
  }

  function apply(data) {
    var c = normalize(data);
    if (c) { cart = newer(cart, c); render(); }
  }

  function mutate(tool, args, describe) {
    var st = checkoutState();
    if (st === "pending" || st === "requested") return;
    error = "";
    root.classList.add("busy");
    rz.callTool(tool, args)
      .then(function (data) {
        // Mutation results are always the latest state.
        var c = normalize(data) || { items: [], total: 0, item_count: 0, checkout: cart && cart.checkout };
        c.ciba_required_above = cart && cart.ciba_required_above;
        cart = c;
        rz.updateModelContext(
          "User updated their cart in the RetailZero cart view: " + describe + ". " +
          "Cart now has " + cart.item_count + " item(s), total " + money(cart.total) + "."
        );
      })
      .catch(function (err) { error = (err && err.message) || "Could not update the cart."; })
      .then(function () { root.classList.remove("busy"); render(); });
  }

  root.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    var act = el.getAttribute("data-act");
    var line = el.closest(".line");
    var id = line && line.getAttribute("data-id");
    var name = line && line.getAttribute("data-name");
    var qty = line ? Number(line.getAttribute("data-qty")) : 0;

    if (act === "inc") mutate("update_cart_item", { product_id: id, quantity: qty + 1 }, "set " + name + " to " + (qty + 1));
    else if (act === "dec") {
      if (qty <= 1) mutate("remove_from_cart", { product_id: id }, "removed " + name);
      else mutate("update_cart_item", { product_id: id, quantity: qty - 1 }, "set " + name + " to " + (qty - 1));
    }
    else if (act === "remove") mutate("remove_from_cart", { product_id: id }, "removed " + name);
    else if (act === "clear") mutate("clear_cart", {}, "cleared the cart");
    else if (act === "checkout") {
      if (checkoutState() !== "idle") return;
      el.disabled = true;
      el.textContent = "Starting checkout…";
      // Lock server-side first so the next cart card renders locked, then
      // hand the actual checkout to the model.
      rz.callTool("request_checkout")
        .then(function (data) { var c = normalize(data); if (c) cart = c; render(); })
        .catch(function () {})
        .then(function () { return rz.sendMessage("Check out my cart."); })
        .catch(function () {
          el.disabled = false;
          el.textContent = "Check out";
        });
    }
  });

  rz.onToolResult = apply;
  rz.onReady = function () {
    render();
    if (rz.canCallTools()) rz.callTool("view_cart").then(apply).catch(function () {});
  };
`;

const HTML = buildViewHtml({ css: CSS, body: BODY, script: SCRIPT, appName: "RetailZero Cart" });

export function registerCartUi(server: McpServer): void {
  server.registerResource(
    "cart",
    CART_UI_URI,
    {
      title: "RetailZero Cart",
      description: "Interactive shopping cart with quantity controls and checkout.",
      mimeType: MCP_APP_MIME_TYPE,
    },
    async () => ({
      contents: [{ uri: CART_UI_URI, mimeType: MCP_APP_MIME_TYPE, text: HTML, _meta: viewResourceMeta }],
    })
  );
}

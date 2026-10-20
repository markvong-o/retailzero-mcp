import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * MCP Apps (io.modelcontextprotocol/ui) product card view.
 *
 * Tools that reference PRODUCT_UI_URI in `_meta.ui.resourceUri` get their
 * result rendered by this HTML inside a sandboxed iframe on hosts that
 * support MCP Apps (Claude, ChatGPT, VS Code). Hosts without support ignore
 * the metadata and fall back to the tool's text content.
 */
export const PRODUCT_UI_URI = "ui://retailzero/product-cards.html";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

const BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";

/** Tool `_meta` that links a tool result to the product card view. */
export const productUiToolMeta = {
  ui: { resourceUri: PRODUCT_UI_URI },
  // Legacy flat key, still read by some hosts.
  "ui/resourceUri": PRODUCT_UI_URI,
};

/**
 * The view is self-contained (no bundler, no CDN). It speaks the MCP Apps
 * postMessage JSON-RPC protocol directly: ui/initialize handshake, then
 * renders `structuredContent` from ui/notifications/tool-result.
 *
 * "Add to cart" buttons call the add_to_cart tool through the host
 * (tools/call), so the request travels over the user's authenticated MCP
 * session and goes through the same Auth0 scope check and token exchange
 * as a model-initiated call. The result is then shared with the model via
 * ui/update-model-context so the conversation knows the cart changed.
 */
const PRODUCT_CARDS_HTML = /* html */ `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --bg: transparent; --card: #ffffff; --border: #e6e2dc; --text: #1c1917;
    --muted: #78716c; --accent: #1c1917; --ok: #15803d; --warn: #b45309;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  [data-theme="dark"] {
    --card: #262624; --border: #3a3936; --text: #f5f5f4; --muted: #a8a29e;
    --accent: #f5f5f4; --ok: #4ade80; --warn: #fbbf24;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 4px; background: var(--bg); color: var(--text); }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
  .card img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; display: block; background: #f3efe9; }
  .body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 4px; }
  .cat { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .name { font-size: 14px; font-weight: 600; line-height: 1.3; }
  .row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 2px; }
  .price { font-size: 15px; font-weight: 700; }
  .rating { font-size: 12px; color: var(--muted); }
  .stock { font-size: 11px; font-weight: 600; color: var(--ok); }
  .stock.out { color: var(--warn); }
  .desc { font-size: 12.5px; line-height: 1.45; color: var(--muted); }
  .detail { display: grid; grid-template-columns: minmax(160px, 260px) 1fr; }
  .detail img { height: 100%; aspect-ratio: auto; min-height: 220px; }
  .detail .body { padding: 16px 18px; gap: 6px; }
  .detail .name { font-size: 18px; }
  .detail .desc { font-size: 13.5px; }
  .empty { padding: 16px; font-size: 13px; color: var(--muted); }
  .add { margin-top: 8px; width: 100%; border: 0; border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; background: var(--accent); color: var(--card); transition: opacity .15s; }
  .add:hover:not(:disabled) { opacity: .85; }
  .add:disabled { cursor: default; opacity: .55; }
  .add.done { background: var(--ok); color: #fff; opacity: 1; }
  .add.err { background: transparent; color: var(--warn); border: 1px solid var(--warn); }
  .msg { font-size: 11.5px; color: var(--warn); line-height: 1.35; }
  .detail .add { width: auto; align-self: flex-start; padding: 9px 18px; }
  @media (max-width: 420px) { .detail { grid-template-columns: 1fr; } .detail img { min-height: 0; aspect-ratio: 1/1; } }
</style>
</head>
<body>
<div id="root" class="empty">Loading products…</div>
<script>
(function () {
  var PROTOCOL_VERSION = "2026-01-26";
  var nextId = 1;
  var pending = {};
  var root = document.getElementById("root");
  var canCallTools = false;

  function send(msg) { window.parent.postMessage(msg, "*"); }
  function request(method, params) {
    var id = nextId++;
    send({ jsonrpc: "2.0", id: id, method: method, params: params });
    return new Promise(function (resolve, reject) { pending[id] = { resolve: resolve, reject: reject }; });
  }
  function notify(method, params) { send({ jsonrpc: "2.0", method: method, params: params || {} }); }

  function applyTheme(ctx) {
    if (ctx && ctx.theme) document.documentElement.setAttribute("data-theme", ctx.theme);
  }

  function reportSize() {
    notify("ui/notifications/size-changed", {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) { return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function card(p, detail) {
    return '<div class="card' + (detail ? " detail" : "") + '">' +
      '<img src="' + esc(p.image_url) + '" alt="' + esc(p.name) + '" loading="lazy" />' +
      '<div class="body">' +
        '<div class="cat">' + esc(p.category) + '</div>' +
        '<div class="name">' + esc(p.name) + '</div>' +
        (detail ? '<div class="desc">' + esc(p.description) + '</div>' : "") +
        '<div class="row"><span class="price">' + money(p.price) + '</span>' +
        '<span class="rating">★ ' + esc(p.rating) + ' (' + esc(p.reviews) + ')</span></div>' +
        '<div class="stock' + (p.in_stock ? "" : " out") + '">' + (p.in_stock ? "In stock" : "Out of stock") + '</div>' +
        (canCallTools && p.in_stock
          ? '<button class="add" data-id="' + esc(p.id) + '" data-name="' + esc(p.name) + '">Add to cart</button><div class="msg" hidden></div>'
          : "") +
      '</div></div>';
  }

  function render(data) {
    if (!data) return;
    var products = Array.isArray(data.results) ? data.results : data.id ? [data] : [];
    if (!products.length) {
      root.className = "empty";
      root.textContent = "No products matched.";
    } else if (products.length === 1 && !Array.isArray(data.results)) {
      root.className = "";
      root.innerHTML = card(products[0], true);
    } else {
      root.className = "grid";
      root.innerHTML = products.map(function (p) { return card(p, false); }).join("");
    }
    Array.prototype.forEach.call(root.querySelectorAll("img"), function (img) {
      img.addEventListener("load", reportSize);
      img.addEventListener("error", reportSize);
    });
    reportSize();
  }

  function addToCart(btn) {
    var id = btn.getAttribute("data-id");
    var name = btn.getAttribute("data-name");
    var msg = btn.nextElementSibling;
    btn.disabled = true;
    btn.className = "add";
    btn.textContent = "Adding…";
    msg.hidden = true;

    request("tools/call", { name: "add_to_cart", arguments: { product_id: id, quantity: 1 } })
      .then(function (result) {
        var data = dataFromResult(result) || {};
        if (result && result.isError) throw { message: data.message || "Could not add to cart." };
        btn.className = "add done";
        btn.textContent = "Added ✓";
        var cart = data.cart || {};
        var summary = "User clicked 'Add to cart' in the RetailZero product card: added 1x " + name +
          " (" + id + "). Cart now has " + (cart.item_count != null ? cart.item_count : "?") +
          " item(s), total " + (cart.total != null ? money(cart.total) : "unknown") + ".";
        request("ui/update-model-context", { content: [{ type: "text", text: summary }] }).catch(function () {});
        setTimeout(function () { btn.disabled = false; btn.className = "add"; btn.textContent = "Add another"; }, 2500);
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.className = "add err";
        btn.textContent = "Try again";
        msg.textContent = (err && err.message) || "Could not add to cart.";
        msg.hidden = false;
        reportSize();
      });
  }

  root.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("button.add");
    if (btn && !btn.disabled) addToCart(btn);
  });

  function dataFromResult(result) {
    if (!result) return null;
    if (result.structuredContent) return result.structuredContent;
    var text = (result.content || []).filter(function (c) { return c.type === "text"; })[0];
    try { return text ? JSON.parse(text.text) : null; } catch (e) { return null; }
  }

  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;

    if (msg.id != null && pending[msg.id] && !msg.method) {
      var p = pending[msg.id];
      delete pending[msg.id];
      msg.error ? p.reject(msg.error) : p.resolve(msg.result);
      return;
    }

    if (msg.method === "ui/notifications/tool-result") render(dataFromResult(msg.params));
    else if (msg.method === "ui/notifications/host-context-changed") applyTheme(msg.params);
    else if (msg.method === "ui/resource-teardown" && msg.id != null) send({ jsonrpc: "2.0", id: msg.id, result: {} });
  });

  if (window.ResizeObserver) new ResizeObserver(reportSize).observe(document.body);

  request("ui/initialize", {
    appInfo: { name: "RetailZero Product Cards", version: "1.0.0" },
    appCapabilities: {},
    protocolVersion: PROTOCOL_VERSION,
  }).then(function (result) {
    canCallTools = !!(result && result.hostCapabilities && result.hostCapabilities.serverTools);
    applyTheme(result && result.hostContext);
    notify("ui/notifications/initialized");
  }).catch(function () {});
})();
</script>
</body>
</html>`;

/**
 * Register the product card view as an MCP resource. The CSP allows
 * images from this app's own origin, where /public/products is served.
 */
export function registerProductUi(server: McpServer): void {
  const imageOrigin = new URL(BASE_URL).origin;

  server.registerResource(
    "product-cards",
    PRODUCT_UI_URI,
    {
      title: "RetailZero Product Cards",
      description: "Visual product cards with images for catalog tool results.",
      mimeType: MCP_APP_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: PRODUCT_UI_URI,
          mimeType: MCP_APP_MIME_TYPE,
          text: PRODUCT_CARDS_HTML,
          _meta: {
            ui: {
              csp: { resourceDomains: [imageOrigin], connectDomains: [] },
              prefersBorder: false,
            },
          },
        },
      ],
    })
  );
}

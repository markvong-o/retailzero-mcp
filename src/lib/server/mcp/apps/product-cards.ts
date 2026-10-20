import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_APP_MIME_TYPE, buildViewHtml, toolUiMeta, viewResourceMeta } from "./shared";

/**
 * Product card view for search_products and get_product_details.
 *
 * "Add to cart" buttons call add_to_cart through the host (tools/call), so
 * the request travels over the user's authenticated MCP session and goes
 * through the same Auth0 scope check and token exchange as a
 * model-initiated call. A mini cart bar then shows the running total, and
 * "View cart" asks the model to open the cart view.
 */
export const PRODUCT_UI_URI = "ui://retailzero/product-cards.html";
export const productUiToolMeta = toolUiMeta(PRODUCT_UI_URI);

const CSS = /* css */ `
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
  .card { display: flex; flex-direction: column; }
  .card img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; display: block; background: var(--soft); }
  .body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 4px; }
  .cat { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .name { font-size: 14px; font-weight: 600; line-height: 1.3; }
  .row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 2px; }
  .price { font-size: 15px; font-weight: 700; }
  .rating { font-size: 12px; color: var(--muted); }
  .stock { font-size: 11px; font-weight: 600; color: var(--ok); }
  .stock.out { color: var(--warn); }
  .desc { font-size: 12.5px; line-height: 1.45; color: var(--muted); }
  .add { margin-top: 8px; width: 100%; }
  .detail { display: grid; grid-template-columns: minmax(160px, 260px) 1fr; }
  .detail img { height: 100%; aspect-ratio: auto; min-height: 220px; }
  .detail .body { padding: 16px 18px; gap: 6px; }
  .detail .name { font-size: 18px; }
  .detail .desc { font-size: 13.5px; }
  .detail .add { width: auto; align-self: flex-start; padding: 9px 18px; }
  .cartbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; padding: 10px 12px 10px 14px; background: var(--soft); border: 1px solid var(--border); border-radius: 12px; font-size: 13px; }
  .cartbar strong { font-weight: 700; }
  .cartbar .btn { padding: 7px 12px; }
  .peek { margin: -4px 0 12px; padding: 10px 14px; border: 1px solid var(--border); border-radius: 12px; font-size: 12.5px; }
  .peek div { display: flex; justify-content: space-between; padding: 3px 0; }
  @media (max-width: 420px) { .detail { grid-template-columns: 1fr; } .detail img { min-height: 0; aspect-ratio: 1/1; } }
`;

const BODY = /* html */ `
<div id="cartbar" class="cartbar" hidden>
  <span id="cartsum"></span>
  <button id="viewcart" class="btn ghost">View cart</button>
</div>
<div id="peek" class="peek" hidden></div>
<div id="root" class="empty">Loading products…</div>
`;

const SCRIPT = /* js */ `
  var root = document.getElementById("root");
  var bar = document.getElementById("cartbar");
  var sum = document.getElementById("cartsum");
  var peek = document.getElementById("peek");
  var esc = rz.esc, money = rz.money;
  var lastData = null;
  var lastCart = null;

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
        (rz.canCallTools() && p.in_stock
          ? '<button class="btn add" data-id="' + esc(p.id) + '" data-name="' + esc(p.name) + '">Add to cart</button><div class="msg" hidden></div>'
          : "") +
      '</div></div>';
  }

  function render(data) {
    if (!data) return;
    lastData = data;
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
    rz.watchImages(root);
    rz.reportSize();
  }

  function showCart(cart) {
    if (!cart) return;
    lastCart = cart;
    var count = cart.item_count || 0;
    if (!count) { bar.hidden = true; peek.hidden = true; rz.reportSize(); return; }
    sum.innerHTML = "Cart: <strong>" + count + " item" + (count === 1 ? "" : "s") + "</strong> · " + money(cart.total);
    bar.hidden = false;
    if (!peek.hidden) renderPeek();
    rz.reportSize();
  }

  // Fallback when the host can't post chat messages: expand a compact list in place.
  function renderPeek() {
    peek.innerHTML = (lastCart.items || []).map(function (i) {
      return "<div><span>" + i.quantity + "× " + esc(i.name) + "</span><span>" + money(i.price * i.quantity) + "</span></div>";
    }).join("") + '<div><strong>Total</strong><strong>' + money(lastCart.total) + "</strong></div>";
  }

  document.getElementById("viewcart").addEventListener("click", function () {
    if (rz.canMessage()) {
      rz.sendMessage("Show my cart.").catch(function () {});
      return;
    }
    peek.hidden = !peek.hidden;
    if (!peek.hidden) renderPeek();
    rz.reportSize();
  });

  function addToCart(btn) {
    var id = btn.getAttribute("data-id");
    var name = btn.getAttribute("data-name");
    var msg = btn.nextElementSibling;
    btn.disabled = true;
    btn.className = "btn add";
    btn.textContent = "Adding…";
    msg.hidden = true;

    rz.callTool("add_to_cart", { product_id: id, quantity: 1 })
      .then(function (data) {
        btn.className = "btn add done";
        btn.textContent = "Added ✓";
        var cart = data.cart || {};
        showCart(cart);
        rz.updateModelContext(
          "User clicked 'Add to cart' in the RetailZero product card: added 1x " + name + " (" + id + "). " +
          "Cart now has " + (cart.item_count != null ? cart.item_count : "?") + " item(s), total " +
          (cart.total != null ? money(cart.total) : "unknown") + "."
        );
        setTimeout(function () { btn.disabled = false; btn.className = "btn add"; btn.textContent = "Add another"; }, 2500);
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.className = "btn add err";
        btn.textContent = "Try again";
        msg.textContent = (err && err.message) || "Could not add to cart.";
        msg.hidden = false;
        rz.reportSize();
      });
  }

  root.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("button.add");
    if (btn && !btn.disabled) addToCart(btn);
  });

  rz.onToolResult = render;
  rz.onReady = function () {
    if (lastData) render(lastData);
    // Show the bar for a cart that already has items. Silently skipped if
    // the user hasn't granted cart access.
    if (rz.canCallTools()) {
      rz.callTool("view_cart").then(function (data) { showCart(data.cart || data); }).catch(function () {});
    }
  };
`;

const HTML = buildViewHtml({ css: CSS, body: BODY, script: SCRIPT, appName: "RetailZero Product Cards" });

export function registerProductCardsUi(server: McpServer): void {
  server.registerResource(
    "product-cards",
    PRODUCT_UI_URI,
    {
      title: "RetailZero Product Cards",
      description: "Visual product cards with images and add-to-cart for catalog tool results.",
      mimeType: MCP_APP_MIME_TYPE,
    },
    async () => ({
      contents: [{ uri: PRODUCT_UI_URI, mimeType: MCP_APP_MIME_TYPE, text: HTML, _meta: viewResourceMeta }],
    })
  );
}

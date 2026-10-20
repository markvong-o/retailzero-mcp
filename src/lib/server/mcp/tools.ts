import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { PRODUCTS, WISHLISTS, PREFERENCES } from "@/lib/server/products";
import { eventBus } from "@/lib/server/event-bus";
import { exchangeToken } from "@/lib/server/token-exchange";
import {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  type Cart,
} from "@/lib/server/cart";
import { initiateCiba, pollCiba } from "@/lib/server/ciba";
import { DEMO_PERSONA, ensurePersonaSeed, getUserKey, userSuffix } from "@/lib/server/mcp/user-identity";
import { productUiToolMeta, cartUiToolMeta, registerAppViews } from "@/lib/server/mcp/apps";

/**
 * Threshold above which checkout requires CIBA step-up approval from the
 * buyer. Totals at or below this value proceed without interaction.
 */
const CIBA_REQUIRED_ABOVE = 100;

/**
 * In-memory map of pending CIBA checkouts, keyed by auth_req_id. Holds the
 * cart snapshot captured at initiate time so complete_ciba_checkout can
 * finalize the exact same order the user approved on their device, even
 * if the cart was mutated afterward.
 */
interface PendingCibaCheckout {
  user_email: string;
  items: Cart["items"];
  total: number;
  initiated_at: string;
  expires_at: number;
}
const pendingCibaCheckouts = new Map<string, PendingCibaCheckout>();

/** Most recent confirmed order per user, surfaced in the cart view. */
const lastOrderByUser = new Map<string, { order_id: string; total: number; created_at: string }>();

/**
 * When the user clicked Check out in a cart view. The model typically calls
 * view_cart before checkout_cart, so this keeps the freshly rendered cart
 * card locked during that gap. Cleared once checkout_cart runs; otherwise
 * it lapses after CHECKOUT_REQUEST_TTL_MS.
 */
const checkoutRequestedAt = new Map<string, number>();
const CHECKOUT_REQUEST_TTL_MS = 90_000;

type CheckoutStatus = "awaiting_approval" | "requested" | null;

function checkoutStatus(userEmail: string): CheckoutStatus {
  if (findPendingCheckout(userEmail)) return "awaiting_approval";
  const requested = checkoutRequestedAt.get(userEmail);
  if (requested && Date.now() - requested < CHECKOUT_REQUEST_TTL_MS) return "requested";
  checkoutRequestedAt.delete(userEmail);
  return null;
}

/**
 * The user's live (unexpired) pending CIBA checkout, if any. Expired
 * entries are pruned so a timed-out approval unlocks checkout again.
 */
function findPendingCheckout(userEmail: string): { auth_req_id: string; checkout: PendingCibaCheckout } | null {
  for (const [auth_req_id, checkout] of pendingCibaCheckouts) {
    if (checkout.expires_at <= Date.now()) {
      pendingCibaCheckouts.delete(auth_req_id);
      continue;
    }
    if (checkout.user_email === userEmail) return { auth_req_id, checkout };
  }
  return null;
}

// In-memory order store (shared with orders.ts for consistency)
const orders = new Map<
  string,
  {
    order_id: string;
    status: string;
    items: { name: string; price: number; quantity: number }[];
    total: number;
    buyer_email: string;
    created_at: string;
  }
>([
  [
    "ord_prev_001",
    {
      order_id: "ord_prev_001",
      status: "delivered",
      items: [{ name: "Silk Blend Blazer", price: 299.0, quantity: 1 }],
      total: 299.0,
      buyer_email: "alex@example.com",
      created_at: "2026-03-10T09:00:00Z",
    },
  ],
  [
    "ord_prev_002",
    {
      order_id: "ord_prev_002",
      status: "delivered",
      items: [{ name: "Canvas Sneakers", price: 89.0, quantity: 1 }],
      total: 89.0,
      buyer_email: "alex@example.com",
      created_at: "2026-03-02T14:30:00Z",
    },
  ],
  [
    "ord_prev_003",
    {
      order_id: "ord_prev_003",
      status: "delivered",
      items: [{ name: "Linen Shirt Set", price: 145.0, quantity: 1 }],
      total: 145.0,
      buyer_email: "alex@example.com",
      created_at: "2026-02-22T10:15:00Z",
    },
  ],
]);

function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Emit a tool-result log event after a tool completes.
 */
function emitToolResult(
  toolName: string,
  result: unknown,
  summary: string,
  isError: boolean,
  startTime: number
): void {
  eventBus.push({
    type: "tool-result",
    result: isError ? "error" : "success",
    summary: `${toolName}: ${summary}`,
    details: {
      toolName,
      toolResult: result,
      duration: Date.now() - startTime,
    },
  });
}

/**
 * Authorize a tool call via two-step verification:
 *
 * 1. **Tool scope check (local):** Verify the agent's JWT includes the
 *    required tool-level scope (e.g., `tool:get_wishlist`). This is a
 *    fast, no-round-trip check against the token's claims.
 *
 * 2. **OBO token exchange (remote):** Exchange the agent's MCP JWT for
 *    a narrow, short-lived JWT scoped to the Resource API with just the
 *    requested resource scope (e.g., `read:wishlist`). Auth0 enforces
 *    RBAC at the resource level.
 *
 * Returns { denied: string } if either check fails,
 * or { narrowToken: string } on success.
 */
async function authorizeToolCall(
  authInfo: AuthInfo | undefined,
  toolScope: string,
  resourceScope: string,
  toolName: string
): Promise<{ denied: string } | { narrowToken: string }> {
  if (!authInfo) {
    return { denied: "Authentication required." };
  }

  // Step 1: Check tool-level scope from JWT
  if (!authInfo.scopes.includes(toolScope)) {
    return { denied: `Permission denied: missing tool scope '${toolScope}'.` };
  }

  // Step 2: OBO exchange for resource-scoped token
  try {
    const result = await exchangeToken(authInfo.token, resourceScope, toolName);
    return { narrowToken: result.access_token };
  } catch (err) {
    return { denied: `Resource authorization failed: ${(err as Error).message}` };
  }
}

/** The demo persona's past orders, copied to each new user on first sight. */
const PERSONA_ORDERS = Array.from(orders.values()).filter((o) => o.buyer_email === DEMO_PERSONA);
const ordersSeededFor = new Set<string>([DEMO_PERSONA]);

/**
 * Resolve the calling user from the access token (email claim if present,
 * otherwise `sub`) and make sure they have their own copy of the demo
 * persona's wishlist, preferences and past orders. All per-user stores
 * (carts, wishlists, orders) are keyed by this value.
 */
function getUserEmail(authInfo: AuthInfo | undefined): string {
  const userKey = getUserKey(authInfo);
  ensurePersonaSeed(userKey);
  if (!ordersSeededFor.has(userKey)) {
    ordersSeededFor.add(userKey);
    for (const o of PERSONA_ORDERS) {
      const order_id = `${o.order_id}_${userSuffix(userKey)}`;
      orders.set(order_id, { ...o, order_id, buyer_email: userKey, items: o.items.map((i) => ({ ...i })) });
    }
  }
  return userKey;
}

/**
 * Cart payload shared by every cart tool, enriched with product images so
 * the MCP Apps cart view can render line items without a second lookup.
 */
function cartPayload(cart: Cart) {
  const pending = findPendingCheckout(cart.user_email);
  return {
    items: cart.items.map((item) => ({
      ...item,
      image_url: PRODUCTS.find((p) => p.id === item.product_id)?.image_url,
    })),
    total: cart.total,
    item_count: cart.items.reduce((s, i) => s + i.quantity, 0),
    updated_at: cart.updated_at,
    // Lets every cart view (including older ones in the transcript) lock
    // checkout while an approval is outstanding, and confirm once it lands.
    checkout: {
      status: checkoutStatus(cart.user_email),
      pending: pending
        ? {
            total: pending.checkout.total,
            initiated_at: pending.checkout.initiated_at,
            expires_at: new Date(pending.checkout.expires_at).toISOString(),
          }
        : null,
      last_order: lastOrderByUser.get(cart.user_email) ?? null,
    },
  };
}

/**
 * Extract the Auth0 `sub` claim for use as a CIBA login_hint. Required so
 * Auth0 can route the push notification to the correct enrolled device.
 */
function getUserSub(authInfo: AuthInfo | undefined): string | null {
  const sub = authInfo?.extra?.sub as string | undefined;
  return sub && sub !== "anonymous" ? sub : null;
}

/**
 * Register all RetailZero MCP tools on the server instance.
 *
 * Each tool enforces scope-based authorization by checking the scopes
 * attached to the current session. If a required scope is missing, the
 * tool returns a permission denied message rather than throwing, so the
 * LLM can explain the issue to the user.
 *
 * For authorized calls, the tool performs an RFC 8693 token exchange to
 * obtain a narrow, short-lived token scoped to just the operation.
 */
export function registerTools(server: McpServer): void {
  registerAppViews(server);

  // ── search_products ──────────────────────────────────────────────
  server.registerTool(
    "search_products",
    {
      title: "Search Products",
      description:
        "Search the RetailZero catalog by keyword, category, or price range. " +
        "Returns matching products with name, price, rating, and availability.",
      inputSchema: {
        query: z.string().optional().describe("Search keyword (e.g. 'leather bag')"),
        category: z
          .string()
          .optional()
          .describe("Filter by category: accessories, outerwear, bags, watches, footwear, tops"),
        max_price: z.number().optional().describe("Maximum price filter"),
        min_price: z.number().optional().describe("Minimum price filter"),
      },
      _meta: productUiToolMeta,
    },
    async ({ query, category, max_price, min_price }) => {
      const start = Date.now();
      let results = [...PRODUCTS];

      if (query) {
        const q = query.toLowerCase();
        results = results.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q)
        );
      }
      if (category) {
        results = results.filter((p) => p.category === category);
      }
      if (max_price !== undefined) {
        results = results.filter((p) => p.price <= max_price);
      }
      if (min_price !== undefined) {
        results = results.filter((p) => p.price >= min_price);
      }

      const data = {
        results: results.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          category: p.category,
          description: p.description,
          rating: p.rating,
          reviews: p.reviews,
          in_stock: p.in_stock,
          image_url: p.image_url,
        })),
        total: results.length,
      };

      emitToolResult("search_products", data, `${results.length} product(s) found`, false, start);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    }
  );

  // ── get_product_details ──────────────────────────────────────────
  server.registerTool(
    "get_product_details",
    {
      title: "Get Product Details",
      description:
        "Get full details for a specific product by ID, including description, " +
        "price, rating, review count, stock status, and image URL.",
      inputSchema: {
        product_id: z.string().describe("The product ID (e.g. 'bag_heritage_001')"),
      },
      _meta: productUiToolMeta,
    },
    async ({ product_id }) => {
      const start = Date.now();
      const product = PRODUCTS.find((p) => p.id === product_id);
      if (!product) {
        emitToolResult("get_product_details", { error: "not_found" }, `Product '${product_id}' not found`, true, start);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "not_found", message: `Product '${product_id}' not found` }),
            },
          ],
          isError: true,
        };
      }

      emitToolResult("get_product_details", product, `${product.name} -- $${product.price}`, false, start);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(product, null, 2) }],
        structuredContent: { ...product },
      };
    }
  );

  // ── get_wishlist ─────────────────────────────────────────────────
  server.registerTool(
    "get_wishlist",
    {
      title: "Get Wishlist",
      description:
        "Retrieve the authenticated user's saved wishlist items. " +
        "Returns product details for each wishlisted item. " +
        "Requires the read:wishlist scope.",
      inputSchema: {},
    },
    async (_params, { authInfo }) => {
      const start = Date.now();

      // Authorize: tool scope check + OBO exchange
      const auth = await authorizeToolCall(authInfo, "tool:get_wishlist", "read:wishlist", "get_wishlist");
      if ("denied" in auth) {
        emitToolResult("get_wishlist", { error: "permission_denied" }, auth.denied, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: auth.denied }) }], isError: true };
      }

      const userEmail = getUserEmail(authInfo);
      const wishlistIds = WISHLISTS.get(userEmail) || [];
      const items = wishlistIds
        .map((id) => PRODUCTS.find((p) => p.id === id))
        .filter(Boolean);

      const data = {
        user: userEmail,
        items: items.map((p) => ({
          id: p!.id,
          name: p!.name,
          price: p!.price,
          category: p!.category,
        })),
        total: items.length,
      };

      emitToolResult("get_wishlist", data, `${items.length} item(s) in wishlist`, false, start);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ── get_order_history ────────────────────────────────────────────
  server.registerTool(
    "get_order_history",
    {
      title: "Get Order History",
      description:
        "Retrieve the authenticated user's past orders, including status " +
        "and item details. Requires the read:orders scope.",
      inputSchema: {},
    },
    async (_params, { authInfo }) => {
      const start = Date.now();

      // Authorize: tool scope check + OBO exchange
      const auth = await authorizeToolCall(authInfo, "tool:get_order_history", "read:orders", "get_order_history");
      if ("denied" in auth) {
        emitToolResult("get_order_history", { error: "permission_denied" }, auth.denied, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: auth.denied }) }], isError: true };
      }

      const userEmail = getUserEmail(authInfo);
      const userOrders = Array.from(orders.values()).filter(
        (o) => o.buyer_email === userEmail
      );

      const data = {
        user: userEmail,
        orders: userOrders.map((o) => ({
          order_id: o.order_id,
          status: o.status,
          items: o.items,
          total: o.total,
          created_at: o.created_at,
        })),
        total: userOrders.length,
      };

      emitToolResult("get_order_history", data, `${userOrders.length} order(s) found`, false, start);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ── add_to_cart ──────────────────────────────────────────────────
  server.registerTool(
    "add_to_cart",
    {
      title: "Add to Cart",
      description:
        "Add a product (and quantity) to the authenticated user's shopping cart. " +
        "The cart accumulates items across calls and is used by checkout_cart " +
        "to place an order. Requires the write:cart scope.",
      inputSchema: {
        product_id: z.string().describe("The product ID to add (e.g. 'bag_heritage_001')"),
        quantity: z.number().int().positive().default(1).describe("Quantity to add (default: 1)"),
      },
    },
    async ({ product_id, quantity }, { authInfo }) => {
      const start = Date.now();
      const auth = await authorizeToolCall(authInfo, "tool:add_to_cart", "write:cart", "add_to_cart");
      if ("denied" in auth) {
        emitToolResult("add_to_cart", { error: "permission_denied" }, auth.denied, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: auth.denied }) }], isError: true };
      }

      const userEmail = getUserEmail(authInfo);
      const result = addToCart(userEmail, product_id, quantity);

      if ("error" in result) {
        emitToolResult("add_to_cart", result, result.message, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], isError: true };
      }

      const data = {
        user: userEmail,
        cart: cartPayload(result),
        message: `Added ${quantity}x ${product_id} to your cart.`,
      };
      emitToolResult("add_to_cart", data, `Cart now $${result.total.toFixed(2)}`, false, start);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
    }
  );

  // ── view_cart ────────────────────────────────────────────────────
  server.registerTool(
    "view_cart",
    {
      title: "View Cart",
      description:
        "Return the authenticated user's current shopping cart, including line " +
        "items, quantities, and running total. Requires the read:cart scope.",
      inputSchema: {},
      _meta: cartUiToolMeta,
    },
    async (_params, { authInfo }) => {
      const start = Date.now();
      const auth = await authorizeToolCall(authInfo, "tool:view_cart", "read:cart", "view_cart");
      if ("denied" in auth) {
        emitToolResult("view_cart", { error: "permission_denied" }, auth.denied, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: auth.denied }) }], isError: true };
      }

      const userEmail = getUserEmail(authInfo);
      const cart = getCart(userEmail);
      const data = {
        user: userEmail,
        ...cartPayload(cart),
        ciba_required_above: CIBA_REQUIRED_ABOVE,
      };
      emitToolResult("view_cart", data, `${cart.items.length} line item(s), $${cart.total.toFixed(2)}`, false, start);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
    }
  );

  // ── update_cart_item ─────────────────────────────────────────────
  server.registerTool(
    "update_cart_item",
    {
      title: "Update Cart Item",
      description:
        "Change the quantity of a product already in the cart. Set quantity " +
        "to 0 to remove the line entirely. Requires the write:cart scope.",
      inputSchema: {
        product_id: z.string().describe("The product ID whose quantity should change"),
        quantity: z.number().int().min(0).describe("New quantity (0 removes the item)"),
      },
    },
    async ({ product_id, quantity }, { authInfo }) => {
      const start = Date.now();
      const auth = await authorizeToolCall(authInfo, "tool:update_cart_item", "write:cart", "update_cart_item");
      if ("denied" in auth) {
        emitToolResult("update_cart_item", { error: "permission_denied" }, auth.denied, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: auth.denied }) }], isError: true };
      }

      const userEmail = getUserEmail(authInfo);
      const result = updateCartItem(userEmail, product_id, quantity);
      if ("error" in result) {
        emitToolResult("update_cart_item", result, result.message, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], isError: true };
      }

      const data = {
        user: userEmail,
        cart: cartPayload(result),
        message: quantity === 0 ? `Removed ${product_id} from cart.` : `Updated ${product_id} to quantity ${quantity}.`,
      };
      emitToolResult("update_cart_item", data, `Cart now $${result.total.toFixed(2)}`, false, start);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
    }
  );

  // ── remove_from_cart ─────────────────────────────────────────────
  server.registerTool(
    "remove_from_cart",
    {
      title: "Remove from Cart",
      description:
        "Remove a product entirely from the authenticated user's cart. " +
        "Requires the write:cart scope.",
      inputSchema: {
        product_id: z.string().describe("The product ID to remove"),
      },
    },
    async ({ product_id }, { authInfo }) => {
      const start = Date.now();
      const auth = await authorizeToolCall(authInfo, "tool:remove_from_cart", "write:cart", "remove_from_cart");
      if ("denied" in auth) {
        emitToolResult("remove_from_cart", { error: "permission_denied" }, auth.denied, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: auth.denied }) }], isError: true };
      }

      const userEmail = getUserEmail(authInfo);
      const result = removeFromCart(userEmail, product_id);
      if ("error" in result) {
        emitToolResult("remove_from_cart", result, result.message, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], isError: true };
      }

      const data = {
        user: userEmail,
        cart: cartPayload(result),
        message: `Removed ${product_id} from cart.`,
      };
      emitToolResult("remove_from_cart", data, `Cart now $${result.total.toFixed(2)}`, false, start);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
    }
  );

  // ── clear_cart ───────────────────────────────────────────────────
  server.registerTool(
    "clear_cart",
    {
      title: "Clear Cart",
      description:
        "Empty the authenticated user's shopping cart. Requires the write:cart scope.",
      inputSchema: {},
    },
    async (_params, { authInfo }) => {
      const start = Date.now();
      const auth = await authorizeToolCall(authInfo, "tool:clear_cart", "write:cart", "clear_cart");
      if ("denied" in auth) {
        emitToolResult("clear_cart", { error: "permission_denied" }, auth.denied, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: auth.denied }) }], isError: true };
      }

      const userEmail = getUserEmail(authInfo);
      const data = { user: userEmail, cart: cartPayload(clearCart(userEmail)), message: "Cart cleared." };
      emitToolResult("clear_cart", data, "Cart cleared", false, start);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
    }
  );

  // ── request_checkout (cart view only) ────────────────────────────
  server.registerTool(
    "request_checkout",
    {
      title: "Request Checkout (UI)",
      description:
        "Used only by the RetailZero cart view to record that the user clicked " +
        "Check out, so every open cart card locks its button. It does not place " +
        "an order. Assistants should not call this; use checkout_cart instead.",
      inputSchema: {},
      _meta: { ui: { visibility: ["app"] } },
    },
    async (_params, { authInfo }) => {
      const start = Date.now();
      if (!authInfo?.scopes.includes("tool:checkout_cart")) {
        const denied = "Permission denied: missing tool scope 'tool:checkout_cart'.";
        emitToolResult("request_checkout", { error: "permission_denied" }, denied, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: denied }) }], isError: true };
      }

      const userEmail = getUserEmail(authInfo);
      if (!findPendingCheckout(userEmail)) checkoutRequestedAt.set(userEmail, Date.now());
      const data = { user: userEmail, cart: cartPayload(getCart(userEmail)) };
      emitToolResult("request_checkout", data, "Checkout requested from cart view", false, start);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
    }
  );

  // ── checkout_cart ────────────────────────────────────────────────
  server.registerTool(
    "checkout_cart",
    {
      title: "Checkout Cart",
      description:
        "Place an order for every item in the authenticated user's cart. " +
        `If the cart total exceeds $${CIBA_REQUIRED_ABOVE}, this tool triggers ` +
        "an Auth0 CIBA push to the user's enrolled device and returns an " +
        "auth_req_id. The user must approve the push, after which the caller " +
        "invokes complete_ciba_checkout({ auth_req_id }) to finalize the order. " +
        "Requires the execute:purchase scope.",
      inputSchema: {},
    },
    async (_params, { authInfo }) => {
      const start = Date.now();
      const auth = await authorizeToolCall(authInfo, "tool:checkout_cart", "execute:purchase", "checkout_cart");
      if ("denied" in auth) {
        emitToolResult("checkout_cart", { error: "permission_denied" }, auth.denied, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: auth.denied }) }], isError: true };
      }

      const userEmail = getUserEmail(authInfo);
      const cart = getCart(userEmail);
      // The checkout is now in progress: either it finishes here, fails here,
      // or hands off to a pending CIBA approval that keeps carts locked.
      checkoutRequestedAt.delete(userEmail);

      if (cart.items.length === 0) {
        const err = { error: "cart_empty", message: "Cart is empty. Add items before checking out." };
        emitToolResult("checkout_cart", err, "Cart empty", true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(err) }], isError: true };
      }

      // Stock validation
      for (const item of cart.items) {
        const product = PRODUCTS.find((p) => p.id === item.product_id);
        if (!product || !product.in_stock) {
          const err = {
            error: "out_of_stock",
            message: `'${item.name}' is no longer available. Remove it to continue.`,
            product_id: item.product_id,
          };
          emitToolResult("checkout_cart", err, `Out of stock: ${item.name}`, true, start);
          return { content: [{ type: "text" as const, text: JSON.stringify(err) }], isError: true };
        }
      }

      // Under threshold: finalize immediately
      if (cart.total <= CIBA_REQUIRED_ABOVE) {
        const orderId = generateId("ord");
        const order = {
          order_id: orderId,
          status: "confirmed",
          items: cart.items.map((i) => ({ name: i.name, price: i.price, quantity: i.quantity })),
          total: cart.total,
          buyer_email: userEmail,
          created_at: new Date().toISOString(),
        };
        orders.set(orderId, order);
        lastOrderByUser.set(userEmail, { order_id: orderId, total: order.total, created_at: order.created_at });
        clearCart(userEmail);

        const data = {
          order_id: orderId,
          status: "confirmed",
          items: order.items,
          total: order.total,
          ciba_required: false,
          message: `Order ${orderId} confirmed for $${order.total.toFixed(2)}.`,
        };
        emitToolResult("checkout_cart", data, `Order ${orderId} confirmed -- $${order.total.toFixed(2)}`, false, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }

      // Over threshold: reuse an outstanding approval rather than sending a
      // second push (e.g. the user clicked Check out twice).
      const existing = findPendingCheckout(userEmail);
      if (existing) {
        const data = {
          error: "step_up_required",
          message:
            "A checkout for this cart is already waiting for approval on the buyer's " +
            "device. Do not start another one. Tell the user to approve the existing " +
            "push, then call complete_ciba_checkout with the auth_req_id below.",
          auth_req_id: existing.auth_req_id,
          expires_in: Math.max(0, Math.round((existing.checkout.expires_at - Date.now()) / 1000)),
          total: existing.checkout.total,
          ciba_required: true,
          already_pending: true,
        };
        emitToolResult("checkout_cart", data, "CIBA already pending -- reusing auth_req_id", true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], isError: true };
      }

      // Over threshold: initiate CIBA
      const sub = getUserSub(authInfo);
      if (!sub) {
        const err = {
          error: "step_up_unavailable",
          message: "Authenticated user has no sub claim; cannot initiate CIBA approval.",
        };
        emitToolResult("checkout_cart", err, "Missing sub claim", true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(err) }], isError: true };
      }

      try {
        const bindingMessage = `Approve ${cart.total.toFixed(2)} USD purchase at RetailZero`;
        const ciba = await initiateCiba({
          login_hint_sub: sub,
          scope: "execute:purchase",
          binding_message: bindingMessage,
        });

        pendingCibaCheckouts.set(ciba.auth_req_id, {
          user_email: userEmail,
          items: cart.items.map((i) => ({ ...i })),
          total: cart.total,
          initiated_at: new Date().toISOString(),
          expires_at: Date.now() + ciba.expires_in * 1000,
        });

        const data = {
          error: "step_up_required",
          message:
            `This purchase is $${cart.total.toFixed(2)}, which exceeds the $${CIBA_REQUIRED_ABOVE} ` +
            "auto-approval threshold. A push notification was just sent to the " +
            "buyer's enrolled device. Tell the user to approve the push on their " +
            "device, then immediately call complete_ciba_checkout with the " +
            "auth_req_id below -- that tool will block and poll for up to 25s " +
            "until the user approves. Do not wait for the user to reply first.",
          auth_req_id: ciba.auth_req_id,
          expires_in: ciba.expires_in,
          interval: ciba.interval,
          binding_message: bindingMessage,
          total: cart.total,
          ciba_required: true,
        };
        emitToolResult("checkout_cart", data, `CIBA initiated for $${cart.total.toFixed(2)}`, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], isError: true };
      } catch (err) {
        const payload = { error: "ciba_initiate_failed", message: (err as Error).message };
        emitToolResult("checkout_cart", payload, payload.message, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(payload) }], isError: true };
      }
    }
  );

  // ── complete_ciba_checkout ───────────────────────────────────────
  server.registerTool(
    "complete_ciba_checkout",
    {
      title: "Complete CIBA Checkout",
      description:
        "Finalize a high-value checkout after the user has approved the CIBA " +
        "push notification. Pass the auth_req_id returned by checkout_cart. " +
        "If the user has not yet approved, this returns status 'pending' with " +
        "a recommended wait interval; retry after that interval. Requires the " +
        "execute:purchase scope.",
      inputSchema: {
        auth_req_id: z.string().describe("The auth_req_id returned by checkout_cart"),
      },
    },
    async ({ auth_req_id }, { authInfo }) => {
      const start = Date.now();
      const auth = await authorizeToolCall(authInfo, "tool:checkout_cart", "execute:purchase", "complete_ciba_checkout");
      if ("denied" in auth) {
        emitToolResult("complete_ciba_checkout", { error: "permission_denied" }, auth.denied, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: auth.denied }) }], isError: true };
      }

      const pending = pendingCibaCheckouts.get(auth_req_id);
      if (!pending) {
        const err = {
          error: "unknown_auth_req_id",
          message: "No pending CIBA checkout matches that auth_req_id. Start a new checkout with checkout_cart.",
        };
        emitToolResult("complete_ciba_checkout", err, "Unknown auth_req_id", true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(err) }], isError: true };
      }

      const userEmail = getUserEmail(authInfo);
      if (pending.user_email !== userEmail) {
        const err = {
          error: "auth_req_id_owner_mismatch",
          message: "auth_req_id belongs to a different user.",
        };
        emitToolResult("complete_ciba_checkout", err, "Owner mismatch", true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(err) }], isError: true };
      }

      // Poll for up to ~25s so Claude can call this tool once and block until
      // the user either approves on their device or we time out. When we time
      // out still pending, we return status "pending" so Claude can retry.
      const maxWaitMs = 25_000;
      const deadline = Date.now() + maxWaitMs;
      let intervalMs = 2_000;
      let outcome;
      try {
        while (true) {
          outcome = await pollCiba(auth_req_id);
          if (outcome.status !== "pending" && outcome.status !== "slow_down") break;
          if (outcome.status === "slow_down") {
            intervalMs = Math.max(intervalMs, (outcome.recommendedIntervalSeconds || 10) * 1000);
          }
          if (Date.now() + intervalMs >= deadline) break;
          await new Promise((r) => setTimeout(r, intervalMs));
        }
      } catch (err) {
        const payload = { error: "ciba_poll_failed", message: (err as Error).message };
        emitToolResult("complete_ciba_checkout", payload, payload.message, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(payload) }], isError: true };
      }

      if (outcome.status === "pending" || outcome.status === "slow_down") {
        const data = {
          error: "authorization_pending",
          status: outcome.status,
          message: "The user has not approved the push yet. Wait the recommended interval, then call complete_ciba_checkout again with the same auth_req_id.",
          retry_in_seconds: outcome.recommendedIntervalSeconds,
        };
        emitToolResult("complete_ciba_checkout", data, `CIBA ${outcome.status}`, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], isError: true };
      }

      if (outcome.status === "denied" || outcome.status === "expired" || outcome.status === "error") {
        pendingCibaCheckouts.delete(auth_req_id);
        const data = {
          error: outcome.status === "denied" ? "access_denied" : outcome.status,
          message: outcome.reason,
        };
        emitToolResult("complete_ciba_checkout", data, outcome.reason, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(data) }], isError: true };
      }

      // status === "approved" -- finalize the order using the snapshot
      const orderId = generateId("ord");
      const order = {
        order_id: orderId,
        status: "confirmed",
        items: pending.items.map((i) => ({ name: i.name, price: i.price, quantity: i.quantity })),
        total: pending.total,
        buyer_email: userEmail,
        created_at: new Date().toISOString(),
      };
      orders.set(orderId, order);
      lastOrderByUser.set(userEmail, { order_id: orderId, total: order.total, created_at: order.created_at });
      pendingCibaCheckouts.delete(auth_req_id);
      clearCart(userEmail);

      const data = {
        order_id: orderId,
        status: "confirmed",
        items: order.items,
        total: order.total,
        ciba_required: true,
        ciba_approved: true,
        message: `Order ${orderId} confirmed for $${order.total.toFixed(2)} after CIBA approval.`,
      };
      emitToolResult("complete_ciba_checkout", data, `Order ${orderId} confirmed via CIBA`, false, start);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── update_preferences ───────────────────────────────────────────
  server.registerTool(
    "update_preferences",
    {
      title: "Update Preferences",
      description:
        "Add style preferences to the user's profile to improve future " +
        "recommendations. Requires the write:preferences scope.",
      inputSchema: {
        add: z
          .array(z.string())
          .describe("Preference tags to add (e.g. ['leather bags', 'weekend travel'])"),
      },
    },
    async ({ add }, { authInfo }) => {
      const start = Date.now();

      // Authorize: tool scope check + OBO exchange
      const auth = await authorizeToolCall(authInfo, "tool:update_preferences", "write:preferences", "update_preferences");
      if ("denied" in auth) {
        emitToolResult("update_preferences", { error: "permission_denied" }, auth.denied, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: auth.denied }) }], isError: true };
      }

      const userEmail = getUserEmail(authInfo);
      const current = PREFERENCES.get(userEmail) || [];
      const updated = [...new Set([...current, ...add])];
      PREFERENCES.set(userEmail, updated);

      const data = {
        user: userEmail,
        preferences: updated,
        added: add,
        message: `Added ${add.length} preference(s) to your profile.`,
      };
      emitToolResult("update_preferences", data, `${add.length} preference(s) added`, false, start);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ── add_to_wishlist ───────────────────────────────────────────────
  server.registerTool(
    "add_to_wishlist",
    {
      title: "Add to Wishlist",
      description:
        "Add a product to the authenticated user's wishlist. " +
        "Requires the write:wishlist scope.",
      inputSchema: {
        product_id: z.string().describe("The product ID to add (e.g. 'bag_heritage_001')"),
      },
    },
    async ({ product_id }, { authInfo }) => {
      const start = Date.now();

      // Authorize: tool scope check + OBO exchange
      const auth = await authorizeToolCall(authInfo, "tool:add_to_wishlist", "write:wishlist", "add_to_wishlist");
      if ("denied" in auth) {
        emitToolResult("add_to_wishlist", { error: "permission_denied" }, auth.denied, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: auth.denied }) }], isError: true };
      }

      const product = PRODUCTS.find((p) => p.id === product_id);
      if (!product) {
        emitToolResult("add_to_wishlist", { error: "not_found" }, `Product '${product_id}' not found`, true, start);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found", message: `Product '${product_id}' not found` }) }],
          isError: true,
        };
      }

      const userEmail = getUserEmail(authInfo);
      const current = WISHLISTS.get(userEmail) || [];

      if (current.includes(product_id)) {
        const data = {
          user: userEmail,
          product: { id: product.id, name: product.name },
          message: `'${product.name}' is already in your wishlist.`,
          wishlist_count: current.length,
        };
        emitToolResult("add_to_wishlist", data, `Already in wishlist: ${product.name}`, false, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }

      const updated = [...current, product_id];
      WISHLISTS.set(userEmail, updated);

      const data = {
        user: userEmail,
        product: { id: product.id, name: product.name, price: product.price },
        message: `Added '${product.name}' to your wishlist.`,
        wishlist_count: updated.length,
      };
      emitToolResult("add_to_wishlist", data, `Added ${product.name} to wishlist`, false, start);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ── remove_from_wishlist ──────────────────────────────────────────
  server.registerTool(
    "remove_from_wishlist",
    {
      title: "Remove from Wishlist",
      description:
        "Remove a product from the authenticated user's wishlist. " +
        "Requires the write:wishlist scope.",
      inputSchema: {
        product_id: z.string().describe("The product ID to remove"),
      },
    },
    async ({ product_id }, { authInfo }) => {
      const start = Date.now();

      // Authorize: tool scope check + OBO exchange
      const auth = await authorizeToolCall(authInfo, "tool:remove_from_wishlist", "write:wishlist", "remove_from_wishlist");
      if ("denied" in auth) {
        emitToolResult("remove_from_wishlist", { error: "permission_denied" }, auth.denied, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: auth.denied }) }], isError: true };
      }

      const userEmail = getUserEmail(authInfo);
      const current = WISHLISTS.get(userEmail) || [];

      if (!current.includes(product_id)) {
        const err = { error: "not_in_wishlist", message: `Product '${product_id}' is not in your wishlist.` };
        emitToolResult("remove_from_wishlist", err, `Not in wishlist: ${product_id}`, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify(err) }], isError: true };
      }

      const updated = current.filter((id) => id !== product_id);
      WISHLISTS.set(userEmail, updated);

      const product = PRODUCTS.find((p) => p.id === product_id);
      const data = {
        user: userEmail,
        removed: { id: product_id, name: product?.name || product_id },
        message: `Removed '${product?.name || product_id}' from your wishlist.`,
        wishlist_count: updated.length,
      };
      emitToolResult("remove_from_wishlist", data, `Removed ${product?.name || product_id} from wishlist`, false, start);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ── get_recommendations ───────────────────────────────────────────
  server.registerTool(
    "get_recommendations",
    {
      title: "Get Recommendations",
      description:
        "Get personalized product recommendations based on the user's wishlist " +
        "and purchase history. Analyzes preferred categories and suggests products " +
        "the user hasn't already bought or wishlisted. " +
        "Requires read:wishlist and read:orders resource scopes.",
      inputSchema: {
        limit: z.number().int().positive().default(5).describe("Max recommendations to return (default: 5)"),
      },
    },
    async ({ limit }, { authInfo }) => {
      const start = Date.now();

      if (!authInfo) {
        emitToolResult("get_recommendations", { error: "permission_denied" }, "Authentication required.", true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: "Authentication required." }) }], isError: true };
      }

      // Step 1: Check tool-level scope
      if (!authInfo.scopes.includes("tool:get_recommendations")) {
        const msg = "Permission denied: missing tool scope 'tool:get_recommendations'.";
        emitToolResult("get_recommendations", { error: "permission_denied" }, msg, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: msg }) }], isError: true };
      }

      // Step 2: OBO exchange for both resource scopes
      try {
        await exchangeToken(authInfo.token, "read:wishlist", "get_recommendations");
      } catch (err) {
        const msg = `Resource authorization failed (read:wishlist): ${(err as Error).message}`;
        emitToolResult("get_recommendations", { error: "permission_denied" }, msg, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: msg }) }], isError: true };
      }

      try {
        await exchangeToken(authInfo.token, "read:orders", "get_recommendations");
      } catch (err) {
        const msg = `Resource authorization failed (read:orders): ${(err as Error).message}`;
        emitToolResult("get_recommendations", { error: "permission_denied" }, msg, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: msg }) }], isError: true };
      }

      // Both exchanges succeeded -- build recommendations
      const userEmail = getUserEmail(authInfo);

      // Gather categories from wishlist
      const wishlistIds = WISHLISTS.get(userEmail) || [];
      const wishlistCategories = new Set(
        wishlistIds
          .map((id) => PRODUCTS.find((p) => p.id === id)?.category)
          .filter(Boolean) as string[]
      );

      // Gather categories from order history
      const userOrders = Array.from(orders.values()).filter(
        (o) => o.buyer_email === userEmail
      );
      const orderedNames = new Set(userOrders.flatMap((o) => o.items.map((i) => i.name)));
      const orderedCategories = new Set(
        PRODUCTS.filter((p) => orderedNames.has(p.name)).map((p) => p.category)
      );

      // Merge preferred categories
      const preferredCategories = new Set([...wishlistCategories, ...orderedCategories]);

      // Exclude products already wishlisted or purchased
      const excludeIds = new Set(wishlistIds);
      const excludeNames = orderedNames;

      // Score and rank: prefer products in the user's preferred categories
      const candidates = PRODUCTS
        .filter((p) => p.in_stock && !excludeIds.has(p.id) && !excludeNames.has(p.name))
        .map((p) => ({
          ...p,
          score: (preferredCategories.has(p.category) ? 10 : 0) + p.rating,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const data = {
        user: userEmail,
        recommendations: candidates.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          category: p.category,
          rating: p.rating,
          reason: preferredCategories.has(p.category)
            ? `Based on your interest in ${p.category}`
            : "Top rated across catalog",
        })),
        based_on: {
          wishlist_categories: [...wishlistCategories],
          order_categories: [...orderedCategories],
        },
        total: candidates.length,
      };

      emitToolResult("get_recommendations", data, `${candidates.length} recommendation(s)`, false, start);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}

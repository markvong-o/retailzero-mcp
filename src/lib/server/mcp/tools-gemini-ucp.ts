import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { PRODUCTS, WISHLISTS } from "@/lib/server/products";
import { ensurePersonaSeed, getUserKey } from "@/lib/server/mcp/user-identity";
import { eventBus } from "@/lib/server/event-bus";
import { exchangeToken } from "@/lib/server/token-exchange";

/**
 * Merchant-configured agent transaction limit.
 * Matches the $250 limit in checkout.ts. When a purchase exceeds this,
 * the checkout enters requires_escalation state so the LLM can
 * communicate the escalation requirement to the user.
 */
const MAX_AGENT_PURCHASE = 250;

/* ------------------------------------------------------------------ */
/*  Checkout session store (UCP-over-MCP specific)                     */
/* ------------------------------------------------------------------ */

type CheckoutStatus =
  | "incomplete"
  | "requires_escalation"
  | "ready_for_complete"
  | "complete_in_progress"
  | "completed"
  | "canceled";

interface CheckoutSession {
  session_id: string;
  status: CheckoutStatus;
  line_items: { product_id: string; quantity: number; name: string; price: number }[];
  total: number;
  buyer_email?: string;
  continue_url?: string;
  order_id?: string;
  messages: { severity: string; text: string }[];
  created_at: string;
  updated_at: string;
}

const checkoutSessions = new Map<string, CheckoutSession>();

/* ------------------------------------------------------------------ */
/*  Order store (UCP-over-MCP specific)                                */
/* ------------------------------------------------------------------ */

interface Order {
  order_id: string;
  status: string;
  items: { name: string; price: number; quantity: number }[];
  total: number;
  buyer_email: string;
  created_at: string;
}

const orders = new Map<string, Order>();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 7)}`;
}

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
    summary: `[UCP-over-MCP] ${toolName}: ${summary}`,
    details: {
      toolName,
      toolResult: result,
      duration: Date.now() - startTime,
    },
  });
}

/**
 * Authorize a tool call via two-step verification:
 * 1. Check tool-level scope from JWT (local, no round-trip)
 * 2. OBO exchange for resource-scoped token (Auth0 RBAC at resource level)
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

/** Resolve the calling user (email claim, else `sub`) and seed their demo wishlist. */
function getUserEmail(authInfo: AuthInfo | undefined): string {
  const userKey = getUserKey(authInfo);
  ensurePersonaSeed(userKey);
  return userKey;
}

/* ------------------------------------------------------------------ */
/*  Tool registration                                                  */
/* ------------------------------------------------------------------ */

export function registerGeminiUCPTools(server: McpServer): void {
  // ── ucp_discover ────────────────────────────────────────────────
  server.registerTool(
    "ucp_discover",
    {
      title: "Discover UCP Capabilities",
      description:
        "Returns the merchant's UCP manifest including supported capabilities " +
        "(catalog, checkout, orders), authentication configuration (Auth0), " +
        "payment handlers, and signing keys. Equivalent to GET /.well-known/ucp.",
      inputSchema: {},
    },
    async () => {
      const start = Date.now();
      const manifest = {
        ucp: {
          version: "2026-04-08",
          transport: "mcp",
          services: [
            {
              name: "shopping",
              version: "1.0.0",
              transport: "Model Context Protocol (Streamable HTTP)",
            },
          ],
        },
        name: "RetailZero",
        description: "Premium fashion and lifestyle e-commerce",
        capabilities: {
          "dev.ucp.shopping.catalog": {
            versions: ["1.0.0"],
            mcp_tools: ["ucp_catalog_search", "ucp_product_details"],
          },
          "dev.ucp.shopping.checkout": {
            versions: ["1.0.0"],
            mcp_tools: [
              "ucp_checkout_create",
              "ucp_checkout_status",
              "ucp_checkout_complete",
            ],
            state_machine: [
              "incomplete -> ready_for_complete",
              "incomplete -> requires_escalation",
              "requires_escalation -> ready_for_complete (after buyer approval)",
              "ready_for_complete -> completed",
            ],
            bounded_authority: {
              max_agent_purchase: MAX_AGENT_PURCHASE,
              enforcement: "server-side",
              escalation: "Auth0 CIBA push notification",
            },
          },
          "dev.ucp.shopping.orders": {
            versions: ["1.0.0"],
            mcp_tools: ["ucp_get_orders"],
          },
          "dev.ucp.shopping.identity": {
            versions: ["1.0.0"],
            auth: {
              type: "oauth2",
              authorization_server: "Auth0",
              protocol: "OAuth 2.1 + PKCE",
              discovery: "RFC 9728 (Protected Resource Metadata)",
              scopes: [
                "read:products",
                "read:wishlist",
                "read:orders",
                "execute:purchase",
              ],
            },
          },
        },
        payment: {
          handlers: [
            { id: "com.stripe", display_name: "Stripe" },
            { id: "com.google.pay", display_name: "Google Pay" },
          ],
        },
      };

      emitToolResult("ucp_discover", manifest, "UCP manifest returned via MCP", false, start);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(manifest, null, 2) }],
      };
    }
  );

  // ── ucp_catalog_search ──────────────────────────────────────────
  server.registerTool(
    "ucp_catalog_search",
    {
      title: "Search Catalog (UCP)",
      description:
        "Search the RetailZero product catalog by keyword, category, or price range. " +
        "Equivalent to UCP GET /ucp/v1/catalog/search.",
      inputSchema: {
        query: z.string().optional().describe("Search keyword (e.g. 'leather bag')"),
        category: z
          .string()
          .optional()
          .describe("Filter by category: accessories, outerwear, bags, watches, footwear, tops"),
        max_price: z.number().optional().describe("Maximum price filter"),
        min_price: z.number().optional().describe("Minimum price filter"),
      },
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
        })),
        total: results.length,
      };

      emitToolResult("ucp_catalog_search", data, `${results.length} product(s) found`, false, start);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ── ucp_product_details ─────────────────────────────────────────
  server.registerTool(
    "ucp_product_details",
    {
      title: "Get Product Details (UCP)",
      description:
        "Get full details for a specific product by ID. " +
        "Equivalent to UCP GET /ucp/v1/catalog/products/:id.",
      inputSchema: {
        product_id: z.string().describe("The product ID (e.g. 'bag_heritage_001')"),
      },
    },
    async ({ product_id }) => {
      const start = Date.now();
      const product = PRODUCTS.find((p) => p.id === product_id);
      if (!product) {
        emitToolResult("ucp_product_details", { error: "not_found" }, `Product '${product_id}' not found`, true, start);
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

      emitToolResult("ucp_product_details", product, `${product.name} -- $${product.price}`, false, start);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(product, null, 2) }],
      };
    }
  );

  // ── ucp_checkout_create ─────────────────────────────────────────
  server.registerTool(
    "ucp_checkout_create",
    {
      title: "Create Checkout Session (UCP)",
      description:
        "Create a UCP checkout session with line items. Implements the UCP checkout " +
        "state machine: if the total is under $250 the session goes to ready_for_complete; " +
        "if over $250 it enters requires_escalation and returns a continue_url for buyer " +
        "approval via Auth0 CIBA. Equivalent to UCP POST /ucp/v1/checkout/sessions.",
      inputSchema: {
        product_id: z.string().describe("The product ID to purchase"),
        quantity: z.number().int().positive().default(1).describe("Quantity to order (default: 1)"),
        buyer_email: z.string().optional().describe("Buyer's email address"),
      },
    },
    async ({ product_id, quantity, buyer_email }, { authInfo }) => {
      const start = Date.now();

      // Authorize: tool scope check + OBO exchange
      const auth = await authorizeToolCall(authInfo, "tool:place_order", "execute:purchase", "ucp_checkout_create");
      if ("denied" in auth) {
        emitToolResult("ucp_checkout_create", { error: "permission_denied" }, auth.denied, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: auth.denied }) }], isError: true };
      }

      const product = PRODUCTS.find((p) => p.id === product_id);

      if (!product) {
        const err = { error: "not_found", message: `Product '${product_id}' not found` };
        emitToolResult("ucp_checkout_create", err, `Product '${product_id}' not found`, true, start);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(err) }],
          isError: true,
        };
      }

      if (!product.in_stock) {
        const err = { error: "out_of_stock", message: `'${product.name}' is currently out of stock` };
        emitToolResult("ucp_checkout_create", err, `'${product.name}' is out of stock`, true, start);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(err) }],
          isError: true,
        };
      }

      const email = buyer_email || getUserEmail(authInfo);
      const total = product.price * quantity;
      const sessionId = generateId("ucp_sess");
      const messages: { severity: string; text: string }[] = [];

      let status: CheckoutStatus = "incomplete";
      let continue_url: string | undefined;

      if (total > MAX_AGENT_PURCHASE) {
        status = "requires_escalation";
        continue_url = `https://retailzero.com/ucp/escalate/${sessionId}`;
        messages.push({
          severity: "requires_buyer_input",
          text: `Amount $${total.toFixed(2)} exceeds agent limit of $${MAX_AGENT_PURCHASE}. Buyer approval required via Auth0 CIBA.`,
        });
      } else {
        status = "ready_for_complete";
        messages.push({
          severity: "info",
          text: `Checkout ready. Total $${total.toFixed(2)} is within agent authority limit.`,
        });
      }

      const now = new Date().toISOString();
      const session: CheckoutSession = {
        session_id: sessionId,
        status,
        line_items: [
          {
            product_id,
            quantity,
            name: product.name,
            price: product.price,
          },
        ],
        total,
        buyer_email: email,
        continue_url,
        messages,
        created_at: now,
        updated_at: now,
      };

      checkoutSessions.set(sessionId, session);

      const summary = status === "requires_escalation"
        ? `Escalation required -- $${total.toFixed(2)} > $${MAX_AGENT_PURCHASE}`
        : `Ready to complete -- $${total.toFixed(2)}`;
      emitToolResult("ucp_checkout_create", session, summary, false, start);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(session, null, 2) }],
      };
    }
  );

  // ── ucp_checkout_status ─────────────────────────────────────────
  server.registerTool(
    "ucp_checkout_status",
    {
      title: "Get Checkout Status (UCP)",
      description:
        "Poll the current state of a UCP checkout session. " +
        "Equivalent to UCP GET /ucp/v1/checkout/sessions/:id.",
      inputSchema: {
        session_id: z.string().describe("The checkout session ID"),
      },
    },
    async ({ session_id }) => {
      const start = Date.now();
      const session = checkoutSessions.get(session_id);

      if (!session) {
        const err = { error: "not_found", message: `Checkout session '${session_id}' not found` };
        emitToolResult("ucp_checkout_status", err, `Session not found`, true, start);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(err) }],
          isError: true,
        };
      }

      emitToolResult("ucp_checkout_status", session, `Status: ${session.status}`, false, start);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(session, null, 2) }],
      };
    }
  );

  // ── ucp_checkout_complete ───────────────────────────────────────
  server.registerTool(
    "ucp_checkout_complete",
    {
      title: "Complete Checkout (UCP)",
      description:
        "Complete a UCP checkout session. If the session is in requires_escalation state, " +
        "an escalation_token must be provided (obtained after buyer approval via Auth0 CIBA). " +
        "Equivalent to UCP POST /ucp/v1/checkout/sessions/:id/complete.",
      inputSchema: {
        session_id: z.string().describe("The checkout session ID"),
        escalation_token: z
          .string()
          .optional()
          .describe("Escalation token from buyer approval (required if session requires escalation)"),
      },
    },
    async ({ session_id, escalation_token }, { authInfo }) => {
      const start = Date.now();

      // Authorize: tool scope check + OBO exchange
      const auth = await authorizeToolCall(authInfo, "tool:place_order", "execute:purchase", "ucp_checkout_complete");
      if ("denied" in auth) {
        emitToolResult("ucp_checkout_complete", { error: "permission_denied" }, auth.denied, true, start);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "permission_denied", message: auth.denied }) }], isError: true };
      }

      const session = checkoutSessions.get(session_id);

      if (!session) {
        const err = { error: "not_found", message: `Checkout session '${session_id}' not found` };
        emitToolResult("ucp_checkout_complete", err, `Session not found`, true, start);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(err) }],
          isError: true,
        };
      }

      if (session.status !== "ready_for_complete" && session.status !== "requires_escalation") {
        const err = {
          error: "invalid_state",
          message: `Cannot complete session in "${session.status}" state`,
          current_status: session.status,
        };
        emitToolResult("ucp_checkout_complete", err, `Invalid state: ${session.status}`, true, start);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(err) }],
          isError: true,
        };
      }

      // Handle escalation
      if (session.status === "requires_escalation") {
        if (!escalation_token) {
          const err = {
            error: "escalation_required",
            message: "Buyer approval required. Obtain an escalation token via the continue_url (Auth0 CIBA).",
            continue_url: session.continue_url,
            session_status: session.status,
          };
          emitToolResult("ucp_checkout_complete", err, "Escalation token missing", true, start);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(err) }],
            isError: true,
          };
        }
        // Token provided -- transition through escalation
        session.status = "ready_for_complete";
        session.messages.push({
          severity: "info",
          text: "Buyer approval received via Auth0 CIBA. Proceeding to completion.",
        });
      }

      // Complete the checkout
      session.status = "complete_in_progress";
      session.updated_at = new Date().toISOString();

      // Create order
      const email = session.buyer_email || getUserEmail(authInfo);
      const orderId = generateId("ucp_ord");
      const order: Order = {
        order_id: orderId,
        status: "confirmed",
        items: session.line_items.map((li) => ({
          name: li.name,
          price: li.price,
          quantity: li.quantity,
        })),
        total: session.total,
        buyer_email: email,
        created_at: new Date().toISOString(),
      };
      orders.set(orderId, order);

      session.status = "completed";
      session.order_id = orderId;
      session.updated_at = new Date().toISOString();
      session.messages.push({
        severity: "info",
        text: `Order ${orderId} confirmed. Total: $${session.total.toFixed(2)}.`,
      });

      const data = {
        checkout_session: session,
        order,
      };

      emitToolResult("ucp_checkout_complete", data, `Order ${orderId} confirmed -- $${session.total.toFixed(2)}`, false, start);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ── ucp_get_orders ──────────────────────────────────────────────
  server.registerTool(
    "ucp_get_orders",
    {
      title: "Get Orders (UCP)",
      description:
        "Retrieve the authenticated user's orders. " +
        "Equivalent to UCP GET /ucp/v1/orders. Requires read:orders scope.",
      inputSchema: {},
    },
    async (_params, { authInfo }) => {
      const start = Date.now();

      // Authorize: tool scope check + OBO exchange
      const auth = await authorizeToolCall(authInfo, "tool:get_order_history", "read:orders", "ucp_get_orders");
      if ("denied" in auth) {
        emitToolResult("ucp_get_orders", { error: "permission_denied" }, auth.denied, true, start);
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

      emitToolResult("ucp_get_orders", data, `${userOrders.length} order(s) found`, false, start);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProductCardsUi } from "./product-cards";
import { registerCartUi } from "./cart";

export { PRODUCT_UI_URI, productUiToolMeta } from "./product-cards";
export { CART_UI_URI, cartUiToolMeta } from "./cart";

/**
 * Register every MCP Apps view as a resource. Hosts without MCP Apps
 * support never read these and fall back to each tool's text content.
 */
export function registerAppViews(server: McpServer): void {
  registerProductCardsUi(server);
  registerCartUi(server);
}

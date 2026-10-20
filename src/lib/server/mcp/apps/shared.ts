/**
 * Shared pieces for RetailZero's MCP Apps (io.modelcontextprotocol/ui) views.
 *
 * Each view is a self-contained HTML document (no bundler, no CDN) rendered
 * by the host in a sandboxed iframe. Views speak the MCP Apps postMessage
 * JSON-RPC protocol directly via the small bridge below.
 */

export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

const BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";

/** Images are served from this app's own origin (/public/products). */
export const IMAGE_ORIGIN = new URL(BASE_URL).origin;

/** Tool `_meta` that links a tool result to a view. */
export function toolUiMeta(resourceUri: string) {
  return {
    ui: { resourceUri },
    // Legacy flat key, still read by some hosts.
    "ui/resourceUri": resourceUri,
  };
}

/** Resource `_meta` for every view: allow product images, nothing else. */
export const viewResourceMeta = {
  ui: {
    csp: { resourceDomains: [IMAGE_ORIGIN], connectDomains: [] },
    prefersBorder: false,
  },
};

/** Design tokens and shared button/card styles. */
export const BASE_CSS = /* css */ `
  :root {
    --bg: transparent; --card: #ffffff; --border: #e6e2dc; --text: #1c1917;
    --muted: #78716c; --accent: #1c1917; --ok: #15803d; --warn: #b45309;
    --soft: #f5f2ed;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  [data-theme="dark"] {
    --card: #262624; --border: #3a3936; --text: #f5f5f4; --muted: #a8a29e;
    --accent: #f5f5f4; --ok: #4ade80; --warn: #fbbf24; --soft: #30302e;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 4px; background: var(--bg); color: var(--text); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  .empty { padding: 16px; font-size: 13px; color: var(--muted); }
  .btn { border: 0; border-radius: 8px; padding: 8px 12px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; background: var(--accent); color: var(--card); transition: opacity .15s; }
  .btn:hover:not(:disabled) { opacity: .85; }
  .btn:disabled { cursor: default; opacity: .55; }
  .btn.ghost { background: transparent; color: var(--text); border: 1px solid var(--border); }
  .btn.done { background: var(--ok); color: #fff; opacity: 1; }
  .btn.err { background: transparent; color: var(--warn); border: 1px solid var(--warn); }
  .msg { font-size: 11.5px; color: var(--warn); line-height: 1.35; }
`;

/**
 * Client-side bridge, exposed as `window.rz`. Handles the ui/initialize
 * handshake, request/response correlation, sizing, theming, and helpers
 * for calling server tools and posting chat messages through the host.
 *
 * Views set `rz.onToolResult` and `rz.onReady` before the bridge connects.
 */
export const BRIDGE_JS = /* js */ `
(function () {
  var PROTOCOL_VERSION = "2026-01-26";
  var nextId = 1;
  var pending = {};
  var rz = window.rz = {
    caps: {},
    onToolResult: null,
    onReady: null,
  };

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

  rz.request = request;
  rz.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  rz.money = function (n) {
    return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  // Measure the body, not documentElement: documentElement.scrollHeight never
  // drops below the iframe's current height, so cards could grow but not shrink.
  rz.reportSize = function () {
    notify("ui/notifications/size-changed", {
      width: document.documentElement.scrollWidth,
      height: Math.ceil(document.body.getBoundingClientRect().height),
    });
  };
  rz.watchImages = function (el) {
    Array.prototype.forEach.call(el.querySelectorAll("img"), function (img) {
      img.addEventListener("load", rz.reportSize);
      img.addEventListener("error", rz.reportSize);
    });
  };
  rz.dataFromResult = function (result) {
    if (!result) return null;
    if (result.structuredContent) return result.structuredContent;
    var text = (result.content || []).filter(function (c) { return c.type === "text"; })[0];
    try { return text ? JSON.parse(text.text) : null; } catch (e) { return null; }
  };
  rz.canCallTools = function () { return !!rz.caps.serverTools; };
  rz.canMessage = function () { return !!rz.caps.message; };

  /** Call a server tool through the host. Rejects with { message } on tool errors. */
  rz.callTool = function (name, args) {
    return request("tools/call", { name: name, arguments: args || {} }).then(function (result) {
      var data = rz.dataFromResult(result) || {};
      if (result && result.isError) throw { message: data.message || "Something went wrong." };
      return data;
    });
  };
  /** Share what the user did in the view; the host sends it with the next turn. */
  rz.updateModelContext = function (text) {
    return request("ui/update-model-context", { content: [{ type: "text", text: text }] }).catch(function () {});
  };
  /** Post a user message into the chat so the model takes the next step. */
  rz.sendMessage = function (text) {
    return request("ui/message", { role: "user", content: [{ type: "text", text: text }] }).then(function (r) {
      if (r && r.isError) throw { message: "The chat did not accept the message." };
      return r;
    });
  };

  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;

    if (msg.id != null && pending[msg.id] && !msg.method) {
      var p = pending[msg.id];
      delete pending[msg.id];
      msg.error ? p.reject(msg.error) : p.resolve(msg.result);
      return;
    }

    if (msg.method === "ui/notifications/tool-result") {
      if (rz.onToolResult) rz.onToolResult(rz.dataFromResult(msg.params), msg.params);
    } else if (msg.method === "ui/notifications/host-context-changed") {
      applyTheme(msg.params);
    } else if (msg.method === "ui/resource-teardown" && msg.id != null) {
      send({ jsonrpc: "2.0", id: msg.id, result: {} });
    }
  });

  if (window.ResizeObserver) new ResizeObserver(rz.reportSize).observe(document.body);

  rz.connect = function (appName) {
    request("ui/initialize", {
      appInfo: { name: appName, version: "1.0.0" },
      appCapabilities: {},
      protocolVersion: PROTOCOL_VERSION,
    }).then(function (result) {
      rz.caps = (result && result.hostCapabilities) || {};
      applyTheme(result && result.hostContext);
      notify("ui/notifications/initialized");
      if (rz.onReady) rz.onReady();
    }).catch(function () {});
  };
})();
`;

/** Assemble a view document from its title, CSS, body markup and script. */
export function buildViewHtml(opts: { css: string; body: string; script: string; appName: string }): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${BASE_CSS}${opts.css}</style>
</head>
<body>
${opts.body}
<script>${BRIDGE_JS}</script>
<script>
(function () {
${opts.script}
})();
rz.connect(${JSON.stringify(opts.appName)});
</script>
</body>
</html>`;
}

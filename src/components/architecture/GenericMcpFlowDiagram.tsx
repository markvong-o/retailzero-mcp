"use client";

import React, { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "./nodes";
import { edgeTypes } from "./edges";

const COLORS = {
  user: "#1a1a2e",
  client: "#64748b",
  auth0: "#4016A0",
  server: "#6d28d9",
  gray: "#94a3b8",
};

const TOUCHPOINTS = [
  {
    num: 1,
    title: "Unauthenticated Request + Discovery",
    description:
      "The MCP client connects to the MCP server, which returns a 401 along with RFC 9728 Protected Resource Metadata. This tells the client where to find the authorization server (Auth0).",
    auth0: false,
    color: "#64748b",
  },
  {
    num: 2,
    title: "Authorization Server Discovery (RFC 8414)",
    description:
      "The client fetches Auth0's metadata endpoint to discover token, authorization, and JWKS endpoints. This is the standard OAuth discovery mechanism, and works the same regardless of which MCP host is connecting.",
    auth0: false,
    color: "#64748b",
  },
  {
    num: 3,
    title: "OAuth 2.1 + PKCE Authentication",
    description:
      "The client redirects the user to Auth0 Universal Login. The user authenticates and consents to scopes (read:products, execute:purchase, etc.). OAuth 2.1 tightens the rules from 2.0: PKCE is now mandatory (it was optional), the implicit and password grants are removed entirely, and refresh tokens must be sender-constrained or rotated. The result is a smaller, harder-to-misuse spec that codifies what most secure implementations were already doing.",
    auth0: true,
  },
  {
    num: 4,
    title: "Token Issuance",
    description:
      "Auth0 issues a scoped access token (JWT) back to the client via the PKCE code exchange. The token contains granted scopes, bounded authority claims, and user identity.",
    auth0: true,
  },
  {
    num: 5,
    title: "Authenticated MCP Session",
    description:
      "The client sends JSON-RPC requests to the MCP server with the Bearer token attached. Every tool call includes the token for validation, whether the client is Claude, a custom agent, or any other MCP-compatible host.",
    auth0: false,
    color: "#64748b",
  },
  {
    num: 6,
    title: "JWT + Scope Validation (JWKS)",
    description:
      "The MCP server validates the JWT signature against Auth0's JWKS endpoint and enforces scope-based access control on every tool call.",
    auth0: true,
  },
  {
    num: 7,
    title: "On-Behalf-Of Token Exchange",
    description:
      "When a tool call requires access to downstream services (payments, shipping), the MCP server exchanges the user's token with Auth0 for a narrower-scoped token via the OBO grant. This ensures the downstream call carries only the permissions it needs.",
    auth0: true,
  },
  {
    num: 8,
    title: "Bounded Authority ($250 Cap)",
    description:
      "Auth0 Actions embed spending limits into the token claims. The MCP server enforces the $250 cap on autonomous purchases by checking these claims before executing a tool call like place_order — no commerce protocol layer required.",
    auth0: true,
  },
  {
    num: 9,
    title: "CIBA Escalation",
    description:
      "For orders exceeding bounded authority, the MCP server triggers Auth0 CIBA to send a push notification to the buyer's device. The tool call only completes after explicit approval.",
    auth0: true,
  },
];

function useDiagramData() {
  return useMemo(() => {
    const nodes: Node[] = [
      /* ─ Row 1: Main actors (wide spacing) ─ */
      {
        id: "user",
        type: "actor",
        position: { x: 0, y: 0 },
        data: { label: "User", subtitle: "Browser / Mobile", color: COLORS.user },
      },
      {
        id: "mcp-client",
        type: "actor",
        position: { x: 300, y: 0 },
        data: {
          label: "MCP Client",
          subtitle: "Any MCP Host",
          detail: "Claude, Custom Agents, etc.",
          color: COLORS.client,
        },
      },
      {
        id: "mcp-server",
        type: "actor",
        position: { x: 700, y: 0 },
        data: {
          label: "RetailZero",
          subtitle: "MCP Server",
          detail: "Streamable HTTP",
          color: COLORS.server,
        },
      },

      /* ─ Step 1 callout ─ */
      {
        id: "callout-401",
        type: "callout",
        position: { x: 860, y: 8 },
        style: { pointerEvents: "all" },
        data: {
          step: 1,
          line1: "401 + RFC 9728",
          line2: "Resource Metadata",
          color: "#ef4444",
          tooltip: "RFC 9728 (Protected Resource Metadata) lets the MCP server tell unauthenticated clients where to authenticate. The server returns a 401 with a metadata document pointing to Auth0 as the authorization server, so the client knows where to send the user without any prior configuration.",
        },
      },

      /* ─ Auth0 (below-left, side-channel) ─ */
      {
        id: "auth0",
        type: "auth0",
        position: { x: 200, y: 260 },
        data: {
          capabilities: [
            "OAuth 2.1 + PKCE",
            "Universal Login",
            "Consent + Scopes",
            "Token Issuance (JWT)",
            "JWKS Endpoint",
            "OBO Token Exchange",
            "Bounded Authority Claims",
            "CIBA Escalation",
          ],
        },
      },

      /* ─ MCP Tools (below-right, under server) ─ */
      {
        id: "mcp-tools",
        type: "tools",
        position: { x: 680, y: 240 },
        data: {
          title: "MCP Tools",
          items: [
            { name: "search_products", scope: "read:products" },
            { name: "place_order", scope: "execute:purchase" },
            { name: "get_wishlist", scope: "read:wishlist" },
            { name: "get_order_history", scope: "read:orders" },
          ],
          accentColor: COLORS.server,
          scopeColor: COLORS.auth0,
          footerLabel: "Server enforces scopes via JWT claims",
        },
      },

      /* ─ Policy nodes (below MCP Tools, clear of the Auth0<->Tools corridor) ─ */
      {
        id: "bounded-auth",
        type: "policy",
        position: { x: 620, y: 460 },
        style: { pointerEvents: "all" },
        data: {
          step: 8,
          title: "Bounded Authority",
          subtitle: "$250 cap in token claims",
          tooltip: "Auth0 bakes a spending limit directly into the token. The server won't let the client spend more than $250 on your behalf in a single session, no matter what.",
        },
      },
      {
        id: "ciba",
        type: "policy",
        position: { x: 620, y: 545 },
        style: { pointerEvents: "all" },
        data: {
          step: 9,
          title: "CIBA Escalation",
          subtitle: "Push approval for high-value",
          tooltip: "If the client tries to buy something over the $250 limit, you get a push notification on your phone asking you to approve or deny. The purchase is paused until you respond.",
        },
      },
    ];

    const edges: Edge[] = [
      /* User -> MCP Client (unlabeled) */
      {
        id: "e-user-client",
        source: "user",
        sourceHandle: "right",
        target: "mcp-client",
        targetHandle: "left",
        type: "label",
        data: { color: COLORS.gray },
      },

      /* Step 5: MCP Client -> MCP Server (authenticated session) */
      {
        id: "e-client-mcp",
        source: "mcp-client",
        sourceHandle: "right",
        target: "mcp-server",
        targetHandle: "left",
        type: "step",
        data: {
          step: 5,
          label: "JSON-RPC + Bearer Token",
          color: COLORS.client,
          tooltip: "MCP uses JSON-RPC over HTTP: all tool calls go through a single endpoint as structured messages with a method field and params object, rather than separate REST endpoints per resource.",
        },
      },

      /* Step 2: MCP Client -> Auth0 (RFC 8414 discovery) */
      {
        id: "e-client-auth0-discover",
        source: "mcp-client",
        sourceHandle: "bottom-right",
        target: "auth0",
        targetHandle: "top-right",
        type: "step",
        data: {
          step: 2,
          label: "RFC 8414 Discovery",
          color: COLORS.auth0,
          tooltip: "The client looks up Auth0's published configuration to learn where to send login requests and where to exchange codes for tokens. Think of it like checking a directory before making a phone call.",
        },
      },

      /* Step 3: User -> Auth0 (OAuth + PKCE + Consent) */
      {
        id: "e-user-auth0",
        source: "user",
        sourceHandle: "bottom",
        target: "auth0",
        targetHandle: "top-left",
        type: "step",
        data: {
          step: 3,
          label: "OAuth 2.1 + PKCE + Consent",
          color: COLORS.auth0,
          tooltip: "You log in through Auth0's secure login page and approve exactly what the client can do with your RetailZero account (e.g. browse products, place orders). OAuth 2.1 tightens the rules from 2.0: PKCE is now mandatory (it was optional), the implicit and password grants are removed entirely, and refresh tokens must be sender-constrained or rotated. The result is a smaller, harder-to-misuse spec that codifies what most secure implementations were already doing.",
        },
      },

      /* Step 4: Auth0 -> MCP Client (token return) */
      {
        id: "e-auth0-client-token",
        source: "auth0",
        sourceHandle: "left",
        target: "mcp-client",
        targetHandle: "bottom-in",
        type: "step",
        data: {
          step: 4,
          label: "Access Token (JWT)",
          color: COLORS.auth0,
          dashed: true,
          tooltip: "Auth0 hands the client a signed digital pass (a JWT) that says who you are and what actions you approved. The client will attach this pass to every request it makes on your behalf.",
        },
      },

      /* Step 6: MCP Server -> Auth0 (JWKS validation) */
      {
        id: "e-mcp-auth0-jwks",
        source: "mcp-server",
        sourceHandle: "bottom-left",
        target: "auth0",
        targetHandle: "right-top",
        type: "step",
        data: {
          step: 6,
          label: "JWKS Validation",
          color: COLORS.auth0,
          dashed: true,
          tooltip: "Every time the client calls a tool, the MCP server checks the token's signature with Auth0 to make sure it hasn't been tampered with, and verifies the token includes permission for that specific action.",
        },
      },

      /* Step 7: MCP Tools -> Auth0 (OBO token exchange) */
      {
        id: "e-tools-auth0-obo",
        source: "mcp-tools",
        sourceHandle: "left",
        target: "auth0",
        targetHandle: "right-bottom",
        type: "step",
        data: {
          step: 7,
          label: "OBO Token Exchange",
          color: COLORS.auth0,
          dashed: true,
          tooltip: "When the server needs to talk to another service (like a payment processor), it swaps your token for a new, narrower one that only has the permissions that specific service needs. Your broad access never leaks downstream.",
        },
      },

      /* MCP Server -> MCP Tools (straight down) */
      {
        id: "e-mcp-tools",
        source: "mcp-server",
        sourceHandle: "bottom",
        target: "mcp-tools",
        targetHandle: "top",
        type: "label",
        data: { color: COLORS.gray },
      },

      /* Bounded Auth -> MCP Tools */
      {
        id: "e-bounded-tools",
        source: "bounded-auth",
        sourceHandle: "right",
        target: "mcp-tools",
        targetHandle: "bottom-in-left",
        type: "step",
        data: { color: COLORS.auth0, dashed: true },
      },

      /* CIBA -> MCP Tools */
      {
        id: "e-ciba-tools",
        source: "ciba",
        sourceHandle: "right",
        target: "mcp-tools",
        targetHandle: "bottom-in-right",
        type: "step",
        data: { color: COLORS.auth0, dashed: true },
      },
    ];

    return { nodes, edges };
  }, []);
}

export function GenericMcpFlowDiagram() {
  const { nodes, edges } = useDiagramData();

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-foreground/[0.06] bg-white overflow-hidden" style={{ height: 640 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Background gap={20} size={1} color="rgba(0,0,0,0.03)" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>

      {/* Auth0 Security Touchpoints */}
      <div className="rounded-xl border border-foreground/[0.06] bg-white p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4016A0" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-foreground/70">Auth0 Security Touchpoints</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {TOUCHPOINTS.map((tp) => {
            const accent = tp.auth0 ? "#4016A0" : tp.color;
            return (
              <div
                key={tp.num}
                className="flex gap-3 p-3 rounded-lg border"
                style={{
                  backgroundColor: `${accent}08`,
                  borderColor: `${accent}20`,
                }}
              >
                <span
                  className="shrink-0 w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center"
                  style={{
                    backgroundColor: `${accent}20`,
                    color: accent,
                  }}
                >
                  {tp.num}
                </span>
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-foreground/65">{tp.title}</p>
                    {tp.auth0 && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-[#4016A0]/10 text-[#4016A0] border border-[#4016A0]/15">
                        Auth0
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-foreground/40 leading-relaxed mt-0.5">{tp.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

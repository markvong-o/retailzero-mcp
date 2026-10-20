"use client";

import React, { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { InfoTooltip } from "@/components/ui/info-tooltip";

/* Invisible handle style */
const H = "!bg-transparent !border-0 !w-0 !h-0";

/* ─── Actor Node (User, ChatGPT, Gemini, RetailZero) ─── */

type ActorData = {
  label: string;
  subtitle?: string;
  detail?: string;
  color: string;
};

export const ActorNode = memo(function ActorNode({ data }: NodeProps & { data: ActorData }) {
  return (
    <div
      className="rounded-xl px-6 py-4 text-center min-w-[140px] shadow-md"
      style={{ backgroundColor: data.color }}
    >
      {/* Horizontal */}
      <Handle type="target" position={Position.Left} id="left" className={H} />
      <Handle type="source" position={Position.Right} id="right" className={H} />

      {/* Bottom sources (spread) */}
      <Handle type="source" position={Position.Bottom} id="bottom" className={H} />
      <Handle type="source" position={Position.Bottom} id="bottom-left" className={H} style={{ left: "25%" }} />
      <Handle type="source" position={Position.Bottom} id="bottom-right" className={H} style={{ left: "75%" }} />

      {/* Bottom targets (spread) */}
      <Handle type="target" position={Position.Bottom} id="bottom-in" className={H} style={{ left: "35%" }} />
      <Handle type="target" position={Position.Bottom} id="bottom-in-right" className={H} style={{ left: "65%" }} />

      {/* Top */}
      <Handle type="target" position={Position.Top} id="top" className={H} />

      <div className="text-[13px] font-semibold text-white">{data.label}</div>
      {data.subtitle && (
        <div className="text-[10px] text-white/60 mt-0.5">{data.subtitle}</div>
      )}
      {data.detail && (
        <div className="text-[9px] text-white/40 mt-0.5">{data.detail}</div>
      )}
    </div>
  );
});

/* ─── Auth0 Node (larger, with glow) ─── */

type Auth0Data = {
  capabilities: string[];
};

export const Auth0Node = memo(function Auth0Node({ data }: NodeProps & { data: Auth0Data }) {
  return (
    <div
      className="rounded-xl px-7 py-5 text-center min-w-[200px]"
      style={{
        backgroundColor: "#4016A0",
        boxShadow: "0 0 40px rgba(64, 22, 160, 0.2), 0 0 80px rgba(64, 22, 160, 0.08)",
      }}
    >
      {/* Top targets (spread) */}
      <Handle type="target" position={Position.Top} id="top-left" className={H} style={{ left: "30%" }} />
      <Handle type="target" position={Position.Top} id="top-right" className={H} style={{ left: "70%" }} />

      {/* Right targets (spread) */}
      <Handle type="target" position={Position.Right} id="right-top" className={H} style={{ top: "22%" }} />
      <Handle type="target" position={Position.Right} id="right-bottom" className={H} style={{ top: "78%" }} />

      {/* Left source */}
      <Handle type="source" position={Position.Left} id="left" className={H} />

      {/* Bottom source */}
      <Handle type="source" position={Position.Bottom} id="bottom" className={H} />

      <div className="text-[15px] font-bold text-white">Auth0</div>
      <div className="text-[10px] text-white/60 mt-0.5 mb-2">Authorization Server</div>
      <div className="space-y-[2px]">
        {data.capabilities.map((cap) => (
          <div key={cap} className="text-[9px] text-white/40">{cap}</div>
        ))}
      </div>
    </div>
  );
});

/* ─── Tools / Endpoints Node ─── */

type ToolItem = { name: string; scope: string };

type ToolsData = {
  title: string;
  items: ToolItem[];
  accentColor: string;
  footerLabel?: string;
  scopeColor?: string;
};

export const ToolsNode = memo(function ToolsNode({ data }: NodeProps & { data: ToolsData }) {
  return (
    <div
      className="rounded-xl px-5 py-4 min-w-[220px] bg-white"
      style={{ border: `1.5px solid ${data.accentColor}` }}
    >
      <Handle type="target" position={Position.Top} id="top" className={H} />
      <Handle type="source" position={Position.Bottom} id="bottom" className={H} />
      <Handle type="source" position={Position.Left} id="left" className={H} />
      <Handle type="target" position={Position.Bottom} id="bottom-in-left" className={H} style={{ left: "28%" }} />
      <Handle type="target" position={Position.Bottom} id="bottom-in-right" className={H} style={{ left: "72%" }} />
      <div className="text-[11px] font-semibold mb-2" style={{ color: data.accentColor }}>
        {data.title}
      </div>
      <div className="space-y-1">
        {data.items.map((item) => (
          <div key={item.name} className="flex items-center justify-between gap-4">
            <span className="text-[9px] font-mono text-[#1a1a2e]">{item.name}</span>
            <span className="text-[8px] opacity-60" style={{ color: data.scopeColor || data.accentColor }}>
              {item.scope}
            </span>
          </div>
        ))}
      </div>
      {data.footerLabel && (
        <div
          className="mt-2 pt-2 text-[8.5px] font-medium text-center"
          style={{
            color: data.accentColor,
            borderTop: `1px dashed ${data.accentColor}33`,
          }}
        >
          {data.footerLabel}
        </div>
      )}
    </div>
  );
});

/* ─── Commerce Layer Node ─── */

type CommerceData = {
  title: string;
  subtitle: string;
  items: string[];
  color: string;
};

export const CommerceNode = memo(function CommerceNode({ data }: NodeProps & { data: CommerceData }) {
  return (
    <div
      className="rounded-xl px-6 py-4 text-center min-w-[240px]"
      style={{
        backgroundColor: `${data.color}12`,
        border: `1.5px solid ${data.color}`,
      }}
    >
      <Handle type="target" position={Position.Top} id="top" className={H} />
      <Handle type="target" position={Position.Left} id="left" className={H} />
      <Handle type="target" position={Position.Left} id="left-top" className={H} style={{ top: "30%" }} />
      <Handle type="target" position={Position.Left} id="left-bottom" className={H} style={{ top: "70%" }} />
      <div className="text-[11px] font-semibold" style={{ color: data.color }}>
        {data.title}
      </div>
      <div className="text-[9px] text-black/35 mt-0.5 mb-2">{data.subtitle}</div>
      <div className="space-y-[2px]">
        {data.items.map((item) => (
          <div key={item} className="text-[9.5px] text-black/45">{item}</div>
        ))}
      </div>
    </div>
  );
});

/* ─── Policy Badge Node (Bounded Authority, CIBA) ─── */

type PolicyData = {
  step: number;
  title: string;
  subtitle: string;
  tooltip?: React.ReactNode;
};

export const PolicyNode = memo(function PolicyNode({ data }: NodeProps & { data: PolicyData }) {
  return (
    <div
      className="rounded-lg px-4 py-3 min-w-[180px]"
      style={{
        backgroundColor: "rgba(64, 22, 160, 0.05)",
        border: "1px dashed rgba(64, 22, 160, 0.25)",
      }}
    >
      <Handle type="source" position={Position.Right} id="right" className={H} />
      <div className="flex items-center gap-2">
        <span
          className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
          style={{
            backgroundColor: "rgba(64, 22, 160, 0.1)",
            color: "#4016A0",
            border: "1px solid rgba(64, 22, 160, 0.25)",
          }}
        >
          {data.step}
        </span>
        <div>
          <div className="text-[9px] font-semibold" style={{ color: "#4016A0" }}>
            {data.title}
          </div>
          <div className="text-[8.5px]" style={{ color: "rgba(64, 22, 160, 0.55)" }}>
            {data.subtitle}
          </div>
        </div>
        {data.tooltip && <InfoTooltip content={data.tooltip} />}
      </div>
    </div>
  );
});

/* ─── Callout Node (401 badge, discovery badge) ─── */

type CalloutData = {
  step: number;
  line1: string;
  line2: string;
  color: string;
  tooltip?: React.ReactNode;
};

export const CalloutNode = memo(function CalloutNode({ data }: NodeProps & { data: CalloutData }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
        style={{
          backgroundColor: `${data.color}15`,
          color: data.color,
          border: `1px solid ${data.color}40`,
        }}
      >
        {data.step}
      </span>
      <div
        className="rounded-md px-3 py-1.5"
        style={{
          backgroundColor: `${data.color}0A`,
          border: `1px solid ${data.color}`,
        }}
      >
        <div className="text-[8.5px] font-medium" style={{ color: data.color }}>
          {data.line1}
        </div>
        <div className="text-[7.5px] opacity-70" style={{ color: data.color }}>
          {data.line2}
        </div>
      </div>
      {data.tooltip && <InfoTooltip content={data.tooltip} />}
    </div>
  );
});

/* ─── Node type registry ─── */

export const nodeTypes = {
  actor: ActorNode,
  auth0: Auth0Node,
  tools: ToolsNode,
  commerce: CommerceNode,
  policy: PolicyNode,
  callout: CalloutNode,
} as const;

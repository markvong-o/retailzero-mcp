"use client";

import React, { useState } from "react";
import { ChatGPTFlowDiagram } from "./ChatGPTFlowDiagram";
import { GeminiFlowDiagram } from "./GeminiFlowDiagram";
import { GeminiUCPMCPFlowDiagram } from "./GeminiUCPMCPFlowDiagram";
import { GenericMcpFlowDiagram } from "./GenericMcpFlowDiagram";

const TABS = [
  { id: "chatgpt", label: "ChatGPT App (MCP + ACP)", color: "#10a37f" },
  { id: "gemini", label: "Gemini (UCP)", color: "#4285f4" },
  { id: "gemini-ucp-mcp", label: "Gemini (UCP-over-MCP)", color: "#9C27B0" },
  { id: "generic-mcp", label: "Generic MCP Client", color: "#64748b" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ArchitectureView() {
  const [activeTab, setActiveTab] = useState<TabId>("chatgpt");

  return (
    <div className="min-h-full flex flex-col">
      {/* Header */}
      <header className="shrink-0 border-b border-foreground/[0.06] px-8 py-5">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-lg font-semibold text-foreground/80">Architecture</h1>
          <p className="text-xs text-foreground/35 mt-0.5">
            Three integration paths to the same merchant. Auth0 secures all of them.
          </p>
        </div>
      </header>

      {/* Tab switcher */}
      <div className="shrink-0 border-b border-foreground/[0.04] px-8 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-1">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  isActive
                    ? "bg-primary/[0.08] text-primary"
                    : "text-foreground/40 hover:text-foreground/65 hover:bg-foreground/[0.03]"
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: isActive ? tab.color : "rgba(0,0,0,0.15)" }}
                />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Diagram content */}
      <main className="flex-1 overflow-y-auto px-8 py-8">
        <div className="max-w-5xl mx-auto">
          {activeTab === "chatgpt" ? (
            <ChatGPTFlowDiagram />
          ) : activeTab === "gemini" ? (
            <GeminiFlowDiagram />
          ) : activeTab === "gemini-ucp-mcp" ? (
            <GeminiUCPMCPFlowDiagram />
          ) : (
            <GenericMcpFlowDiagram />
          )}
        </div>
      </main>
    </div>
  );
}

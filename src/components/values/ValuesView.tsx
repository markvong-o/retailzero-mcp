"use client";

import React from "react";
import { TrendingDown, Rocket, ShieldCheck, ArrowRight } from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

type Pillar = {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  eyebrow: string;
  headline: string;
  description: string;
  proofPoints: string[];
  accent: string;
};

const PILLARS: Pillar[] = [
  {
    id: "opex",
    icon: TrendingDown,
    eyebrow: "Reduce operational expense",
    headline: "An identity layer your team will not have to rebuild",
    description:
      "Authenticating AI clients, scoping agent permissions, and routing high-risk actions back to humans are problems that consume entire quarters of engineering effort when built from first principles. Auth for MCP delivers them as configurable primitives, so platform teams stop carrying custom identity code as a permanent line item.",
    proofPoints: [
      "Centralized policy enforcement across every agent your business connects",
      "Spec-compliant out of the box, with native support for MCP resource identifiers",
      "Maintenance burden shifted from your team to a managed identity platform",
    ],
    accent: "#4016A0",
  },
  {
    id: "ttm",
    icon: Rocket,
    eyebrow: "Accelerate time to market",
    headline: "Ship new agentic experiences in weeks, not quarters",
    description:
      "Every new AI client your product supports does not need its own integration project. Client ID Metadata Documents, On-Behalf-Of token exchange, and backchannel approval flows are configured once and reused across the entire portfolio of agents, compressing the runway from concept to customer.",
    proofPoints: [
      "Register Claude, ChatGPT, or Gemini in a single dashboard action",
      "Reuse permission scopes and approval flows across every agent",
      "Eliminate weeks of bespoke integration engineering per launch",
    ],
    accent: "#B49BFC",
  },
  {
    id: "confidence",
    icon: ShieldCheck,
    eyebrow: "Ship with confidence",
    headline: "Production-hardened security your CISO will sign off on",
    description:
      "Agentic experiences only reach production when the security layer can be defended in a review. Auth for MCP enforces least privilege at the token layer, keeps humans in the loop for high-value actions, and produces the audit trail your governance teams need before they greenlight a launch.",
    proofPoints: [
      "Least privilege enforced at the token, not in application code",
      "Human-in-the-loop approvals for high-risk actions via CIBA",
      "Audit-ready logs of every authentication and authorization event",
    ],
    accent: "#10a37f",
  },
];

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function ValuesView() {
  return (
    <div className="min-h-full overflow-y-auto">
      {/* Header */}
      <header className="border-b border-foreground/[0.06] px-8 py-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-primary/[0.06] text-primary text-[10px] font-medium mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-glow" />
              Auth for MCP by Auth0
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground tracking-tight leading-tight">
              Secure agentic innovation for the enterprise.
            </h1>
          </div>
          <p className="hidden md:block text-[13px] text-foreground/55 max-w-sm leading-relaxed">
            The identity foundation enterprises need to bring agentic experiences
            to market without rebuilding security for every new AI client.
          </p>
        </div>
      </header>

      {/* Three-column value grid */}
      <main className="px-8 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <article
                  key={pillar.id}
                  className="group relative flex flex-col rounded-2xl border border-foreground/[0.06] bg-white p-7 transition-all hover:border-foreground/[0.12] hover:shadow-lg hover:shadow-black/[0.04]"
                >
                  {/* Accent bar */}
                  <div
                    className="absolute top-0 left-7 right-7 h-px opacity-40"
                    style={{ background: `linear-gradient(to right, transparent, ${pillar.accent}, transparent)` }}
                  />

                  {/* Icon */}
                  <div
                    className="flex items-center justify-center w-11 h-11 rounded-xl mb-5"
                    style={{
                      backgroundColor: `${pillar.accent}10`,
                      color: pillar.accent,
                    }}
                  >
                    <Icon className="w-5 h-5" />
                  </div>

                  {/* Eyebrow */}
                  <div
                    className="text-[10px] font-semibold uppercase tracking-[0.12em] mb-2"
                    style={{ color: pillar.accent }}
                  >
                    {pillar.eyebrow}
                  </div>

                  {/* Headline */}
                  <h2 className="text-lg font-semibold text-foreground/90 leading-snug mb-5">
                    {pillar.headline}
                  </h2>

                  {/* Proof points */}
                  <ul className="mt-auto space-y-2.5 pt-5 border-t border-foreground/[0.05]">
                    {pillar.proofPoints.map((point, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2.5 text-[12.5px] text-foreground/65 leading-snug"
                      >
                        <span
                          className="mt-1.5 w-1 h-1 rounded-full shrink-0"
                          style={{ backgroundColor: pillar.accent }}
                        />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>

          {/* Closing band */}
          <div className="mt-8 rounded-xl border border-foreground/[0.06] bg-gradient-to-br from-primary/[0.04] via-white to-white px-6 py-5 md:px-8">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="max-w-xl">
                <h3 className="text-base font-semibold text-foreground/90 leading-snug">
                  See what production-grade agentic security looks like in practice.
                </h3>
                <p className="text-[12.5px] text-foreground/55 mt-1 leading-relaxed">
                  The RetailZero demo walks through end-user, agent, and platform-team
                  views of the same flow.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/architecture"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium text-foreground/65 hover:text-foreground/85 hover:bg-foreground/[0.03] transition-colors"
                >
                  View architecture
                </Link>
                <Link
                  href="/playground/live"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Try the live playground
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

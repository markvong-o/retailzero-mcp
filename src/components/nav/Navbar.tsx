"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Store } from "lucide-react";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

type NavItem =
  | { kind: "link"; label: string; href: string }
  | { kind: "group"; label: string; children: { label: string; href: string }[] };

const NAV_ITEMS: NavItem[] = [
  { kind: "link", label: "Dashboard", href: "/dashboard" },
  {
    kind: "group",
    label: "Demos",
    children: [
      { label: "ChatGPT App", href: "/demo/chatgpt" },
      { label: "Gemini", href: "/demo/gemini" },
      { label: "Gemini MCP", href: "/demo/gemini-mcp" },
    ],
  },
  { kind: "link", label: "Architecture", href: "/architecture" },
  { kind: "link", label: "Values", href: "/values" },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

// ---------------------------------------------------------------------------
// Auth state hook
// ---------------------------------------------------------------------------

interface AuthUser {
  name?: string;
  email?: string;
  picture?: string;
}

function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (data.isAuthenticated) {
          setUser(data.user);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { user, loading };
}

// ---------------------------------------------------------------------------
// NavDropdown
// ---------------------------------------------------------------------------

function NavDropdown({
  label,
  children,
  pathname,
}: {
  label: string;
  children: { label: string; href: string }[];
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const groupActive = children.some((c) => isActive(pathname, c.href));

  const handleEnter = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    openTimer.current = setTimeout(() => setOpen(true), 75);
  }, []);

  const handleLeave = useCallback(() => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }, []);

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button
        className={`flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
          groupActive
            ? "bg-primary/[0.08] text-primary font-medium"
            : "text-foreground/40 hover:text-foreground/65 hover:bg-foreground/[0.03]"
        }`}
      >
        {label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 min-w-[180px] rounded-lg border border-foreground/[0.08] bg-white shadow-lg shadow-black/[0.06] py-1 z-[60]">
          {children.map(({ label: childLabel, href }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={`block px-3.5 py-2 text-[12px] transition-colors ${
                  active
                    ? "bg-primary/[0.06] text-primary font-medium"
                    : "text-foreground/50 hover:text-foreground/75 hover:bg-foreground/[0.03]"
                }`}
              >
                {childLabel}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navbar
// ---------------------------------------------------------------------------

export function Navbar() {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  if (pathname === "/") return null;

  return (
    <nav className="shrink-0 flex items-center justify-between border-b border-foreground/[0.06] bg-white/80 backdrop-blur-md px-6 h-12 z-50">
      {/* Brand */}
      <Link href="/" className="flex items-center gap-2 font-bold text-xl">
        <Store className="h-6 w-6 text-[#B49BFC]" />
        <span>
          Retail<span className="text-[#B49BFC]">Zero</span>
        </span>
      </Link>

      {/* Links */}
      <div className="flex items-center gap-0.5">
        {NAV_ITEMS.map((item) => {
          if (item.kind === "group") {
            return (
              <NavDropdown
                key={item.label}
                label={item.label}
                children={item.children}
                pathname={pathname}
              />
            );
          }
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`text-[12px] px-3 py-1.5 rounded-md transition-colors ${
                active
                  ? "bg-primary/[0.08] text-primary font-medium"
                  : "text-foreground/40 hover:text-foreground/65 hover:bg-foreground/[0.03]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Auth */}
      <div className="flex items-center gap-2">
        {loading ? (
          <div className="w-16" />
        ) : user ? (
          <>
            <Link
              href="/playground/live"
              className={`text-[12px] px-3 py-1.5 rounded-md transition-colors ${
                isActive(pathname, "/playground/live")
                  ? "bg-primary/[0.08] text-primary font-medium"
                  : "text-foreground/40 hover:text-foreground/65 hover:bg-foreground/[0.03]"
              }`}
            >
              Live Playground
            </Link>
            <Link
              href="/profile"
              className={`flex items-center gap-2 text-[12px] px-3 py-1.5 rounded-md transition-colors ${
                isActive(pathname, "/profile")
                  ? "bg-primary/[0.08] text-primary font-medium"
                  : "text-foreground/40 hover:text-foreground/65 hover:bg-foreground/[0.03]"
              }`}
            >
              {user.picture && (
                <img src={user.picture} alt="" className="w-5 h-5 rounded-full" />
              )}
              {user.name || user.email || "Profile"}
            </Link>
          </>
        ) : (
          <Link
            href="/playground/live"
            className={`text-[12px] px-3 py-1.5 rounded-md transition-colors ${
              isActive(pathname, "/playground/live")
                ? "bg-primary/[0.08] text-primary font-medium"
                : "text-foreground/40 hover:text-foreground/65 hover:bg-foreground/[0.03]"
            }`}
          >
            Live Playground
          </Link>
        )}
      </div>
    </nav>
  );
}

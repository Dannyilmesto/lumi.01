"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-provider";
import { SignOutButton } from "@/app/dashboard/sign-out-button";
export function DashboardNavigation() {
  const path = usePathname();
  const search = useSearchParams();
  const links = [
    {
      label: "Panoramica",
      href: "/dashboard",
      active: path === "/dashboard",
      symbol: "⌂",
      group: "Il tuo spazio",
    },
    {
      label: "Assistente AI",
      href: "/dashboard/assistente",
      active: path === "/dashboard/assistente",
      symbol: "✦",
      group: "Il tuo spazio",
    },
    {
      label: "Profilo",
      href: "/dashboard/profilo",
      active:
        path === "/dashboard/profilo" &&
        (!search.get("tab") || search.get("tab") === "notes"),
      symbol: "◉",
      group: "Il tuo spazio",
    },
    {
      label: "Calendario",
      href: "/dashboard/profilo?tab=calendar",
      active: search.get("tab") === "calendar",
      symbol: "▦",
      group: "Il tuo spazio",
    },
    {
      label: "Prodotti",
      href: "/dashboard/prodotti",
      active: path.startsWith("/dashboard/prodotti"),
      symbol: "◈",
      group: "Gestione",
    },
    {
      label: "Contatti",
      href: "/dashboard/contatti",
      active: path.startsWith("/dashboard/contatti"),
      symbol: "♙",
      group: "Gestione",
    },
    {
      label: "Email",
      href: "/dashboard/email",
      active: path.startsWith("/dashboard/email"),
      symbol: "✉",
      group: "Gestione",
    },
    {
      label: "Preventivi",
      href: "/dashboard/profilo?tab=quotes",
      active:
        search.get("tab") === "quotes" ||
        path.startsWith("/dashboard/preventivi"),
      symbol: "▧",
      group: "Gestione",
    },
    {
      label: "Archivio",
      href: "/dashboard/profilo?tab=archive",
      active: search.get("tab") === "archive",
      symbol: "▣",
      group: "Gestione",
    },
    {
      label: "Bacheche",
      href: "/dashboard/profilo?tab=community",
      active: search.get("tab") === "community",
      symbol: "◎",
      group: "Collaborazione",
    },
    {
      label: "Messaggi",
      href: "/dashboard/profilo?tab=messages",
      active: search.get("tab") === "messages",
      symbol: "↗",
      group: "Collaborazione",
    },
  ];
  return (
    <aside className="manager-navigation">
      <div className="manager-navigation-inner">
        <div className="manager-navigation-brand">
          <BrandLogo href="/dashboard" />
          <div>
            <strong>Lumi</strong>
            <span>Workspace</span>
          </div>
        </div>
        <nav aria-label="Navigazione principale">
          {["Il tuo spazio", "Gestione", "Collaborazione"].map((group) => (
            <div className="manager-navigation-group" key={group}>
              <span>{group}</span>
              {links
                .filter((link) => link.group === group)
                .map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    aria-current={link.active ? "page" : undefined}
                  >
                    <span aria-hidden="true">{link.symbol}</span>
                    {link.label}
                  </Link>
                ))}
            </div>
          ))}
        </nav>
        <div className="manager-navigation-actions">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}

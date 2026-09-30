"use client";

import Link from "next/link";
import { useState } from "react";

const PRIMARY_ITEMS = [
  { label: "Inicio", href: "/", glyph: "⌂" },
  { label: "Tareas", href: "/tasks", glyph: "□" },
  { label: "Notas", href: "/notes", glyph: "▤" },
  { label: "Finanzas", href: "/finances", glyph: "◫" },
] as const;

const SECONDARY_ITEMS = [
  { label: "Conflictos", href: "/conflicts", glyph: "◇" },
  { label: "Cuentas", href: "/accounts", glyph: "◌" },
  { label: "APIs", href: "/apis", glyph: "⌘" },
  { label: "Configuración", href: "/settings", glyph: "⚙" },
] as const;

function NavItem({ label, href, glyph, compact = false }: { label: string; href: string; glyph: string; compact?: boolean }) {
  return (
    <Link className={`nav-item${compact ? " nav-item-compact" : ""}`} href={href} aria-current={href === "/" ? "page" : undefined}>
      <span className="nav-glyph" aria-hidden="true">{glyph}</span>
      <span className="nav-label">{label}</span>
    </Link>
  );
}

export function AppNavigation() {
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <aside className={`desktop-nav${collapsed ? " desktop-nav-collapsed" : ""}`} aria-label="Navegación principal">
        <div className="nav-brand">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span className="nav-label">Pyrite</span>
        </div>
        <div className="nav-section-label nav-label">Espacio de trabajo</div>
        <nav className="nav-list">
          {PRIMARY_ITEMS.map((item) => <NavItem key={item.href} {...item} />)}
        </nav>
        <div className="nav-section-label nav-label">Herramientas</div>
        <nav className="nav-list">
          {SECONDARY_ITEMS.map((item) => <NavItem key={item.href} {...item} />)}
        </nav>
        <button className="nav-collapse" type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expandir navegación" : "Plegar navegación"} aria-expanded={!collapsed}>
          <span aria-hidden="true">{collapsed ? "→" : "←"}</span><span className="nav-label">{collapsed ? "Expandir" : "Plegar menú"}</span>
        </button>
      </aside>

      <nav className="mobile-nav" aria-label="Navegación móvil">
        {PRIMARY_ITEMS.slice(0, 3).map((item) => <NavItem key={item.href} {...item} compact />)}
        <button className={`nav-item nav-item-compact${moreOpen ? " nav-item-active" : ""}`} type="button" onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen} aria-controls="mobile-more-menu">
          <span className="nav-glyph" aria-hidden="true">•••</span><span className="nav-label">Más</span>
        </button>
        {moreOpen && <div id="mobile-more-menu" className="mobile-more-menu">{[PRIMARY_ITEMS[3], ...SECONDARY_ITEMS].map((item) => <NavItem key={item.href} {...item} />)}</div>}
      </nav>
    </>
  );
}

export const navigationItems = [...PRIMARY_ITEMS, ...SECONDARY_ITEMS];

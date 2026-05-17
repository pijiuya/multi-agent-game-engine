import type { ReactNode } from "react";
import { Download, FileText, Gift, Home, Route } from "lucide-react";

type SiteChromeProps = {
  children: ReactNode;
  active: "home" | "docs" | "download" | "sponsor";
};

const navItems = [
  { id: "home", label: "首页", href: "./official.html", icon: Home },
  { id: "docs", label: "文档", href: "./docs.html", icon: FileText },
  { id: "download", label: "下载", href: "./download.html", icon: Download },
  { id: "sponsor", label: "赞助", href: "./sponsor.html", icon: Gift }
] as const;

export function SiteChrome({ children, active }: SiteChromeProps) {
  return (
    <main className="official-shell site-page-shell">
      <div className="official-grid" aria-hidden="true" />
      <header className="official-nav" aria-label="站点导航">
        <a className="brand-mark" href="./official.html" aria-label="Multi-Agent AI Game Engine 首页">
          <span className="brand-icon">
            <Route size={18} strokeWidth={2.2} />
          </span>
          <span>Multi-Agent Engine</span>
        </a>
        <nav className="nav-links" aria-label="页面导航">
          {navItems.map((item) => (
            <a className={active === item.id ? "active" : undefined} href={item.href} key={item.id}>
              <item.icon size={16} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
      </header>
      {children}
    </main>
  );
}

export function PageHero({
  eyebrow,
  title,
  children,
  actions
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="subpage-hero" aria-labelledby="page-title">
      <p className="eyebrow">{eyebrow}</p>
      <h1 id="page-title">{title}</h1>
      <p>{children}</p>
      {actions ? <div className="hero-actions">{actions}</div> : null}
    </section>
  );
}

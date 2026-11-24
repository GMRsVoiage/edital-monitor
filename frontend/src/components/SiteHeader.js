"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";

const PRIMARY_LINKS = [
  { href: "/", label: "Pesquisa" },
  { href: "/grupos", label: "Grupos e Alertas" },
  { href: "/relatorios", label: "Relatórios" },
  { href: "/perfil", label: "Perfil" }
];

export default function SiteHeader() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuth();
  const normalized = pathname === "/" ? "/" : pathname.replace(/\/$/, "");

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="site-brand" href="/">
          <img
            className="brand-mark"
            src="/favicon.svg"
            alt=""
            width={40}
            height={40}
          />
          <span className="brand-text">
            <span className="brand-name">Edital Monitor</span>
            <span className="brand-sub">Boletim Oficial · Telêmaco Borba/PR</span>
          </span>
        </Link>

        <nav className="aero-capsule-nav" aria-label="Navegação principal">
          {PRIMARY_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={normalized === item.href ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}

          {isAuthenticated ? (
            <>
              <span className="nav-user-pill" title={user?.email || ""}>
                {user?.name || "Conta ativa"}
              </span>
              <button
                type="button"
                className="nav-logout-btn"
                onClick={handleLogout}
              >
                Sair
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                aria-current={normalized === "/login" ? "page" : undefined}
              >
                Entrar
              </Link>
              <Link
                href="/cadastro"
                aria-current={normalized === "/cadastro" ? "page" : undefined}
              >
                Cadastrar
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

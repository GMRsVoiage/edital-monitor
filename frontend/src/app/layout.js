import "./globals.css";
import { AuthProvider } from "../components/AuthProvider";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Edital Monitor | Boletim Oficial de Telêmaco Borba/PR",
  description:
    "Pesquise nomes e termos nos Boletins Oficiais de Telêmaco Borba/PR e gerencie palavras-chave, grupos, alertas e relatórios.",
  icons: {
    icon: "/favicon.svg"
  }
};

export const viewport = {
  themeColor: "#0b7aa8"
};

export default function RootLayout({ children }) {
  const runtimeApiUrl = (
    process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787"
  )
    .trim()
    .replace(/\/+$/, "");

  return (
    <html lang="pt-BR">
      <head>
        <meta name="edital-api-url" content={runtimeApiUrl} />
      </head>
      <body className="aero-canvas">
        <a className="skip-link visually-hidden" href="#conteudo-principal">
          Ir para o conteúdo principal
        </a>

        <div className="aero-scene" aria-hidden="true">
          <span className="aero-horizon" />
          <span className="aero-orb aero-orb--tl" />
          <span className="aero-orb aero-orb--br" />
        </div>

        <AuthProvider>
          <SiteHeader />
          <main className="page-container">{children}</main>
          <SiteFooter />
        </AuthProvider>
      </body>
    </html>
  );
}

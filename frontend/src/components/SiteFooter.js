import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-notes">
          <p>
            <strong>Fonte inicial:</strong>{" "}
            <a
              href="https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial"
              target="_blank"
              rel="noopener noreferrer"
            >
              Boletim Oficial da Prefeitura de Telêmaco Borba
            </a>
            .
          </p>
          <p>
            Projeto independente e de código aberto, sem vínculo oficial com a Prefeitura.
          </p>
        </div>

        <div className="footer-links">
          <Link href="/">Pesquisa</Link>
          <Link href="/grupos">Grupos e Alertas</Link>
          <Link href="/relatorios">Relatórios</Link>
          <Link href="/perfil">Perfil</Link>
          <a
            href="https://github.com/GMRsVoiage/edital-monitor"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a
            href="https://gmrsvoiage.com.br"
            target="_blank"
            rel="noopener noreferrer"
          >
            GMRsVoiage
          </a>
        </div>
      </div>
    </footer>
  );
}

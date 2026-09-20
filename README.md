# Edital Monitor

Buscador público, gratuito e open source de Boletins Oficiais, começando por Telêmaco Borba/PR.

O sistema coleta publicações oficiais, extrai o texto dos PDFs página a página e permite pesquisar nomes ou termos. O resultado informa a edição, a data de publicação, a página, um trecho do texto e o link para o documento original.

## Arquitetura

- `site/`: frontend estático para GitHub Pages.
- `worker/`: Cloudflare Worker com API pública e ingestão protegida.
- `database/`: schema Cloudflare D1 + FTS5.
- `collector/`: coletor Python.
- `.github/workflows/`: publicação e coleta agendada.

```text
Prefeitura -> GitHub Actions -> Worker /admin/ingest -> D1/FTS5
GitHub Pages -> Worker /search -> D1/FTS5
```

## Princípios

- sem cadastro para pesquisar;
- infraestrutura capaz de começar em custo zero;
- não depender de PC residencial;
- PDFs não são armazenados permanentemente;
- nenhum segredo no frontend ou no repositório;
- documentos sem texto ficam marcados para OCR futuro.

## Configuração

### D1

```bash
npx wrangler@latest d1 create edital-monitor
cd worker
npm install
npx wrangler d1 execute edital-monitor --remote --file=../database/schema.sql
```

Copie o `database_id` retornado para `worker/wrangler.jsonc`.

### Segredos do Worker

```bash
cd worker
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put RATE_LIMIT_SALT
npm run deploy
```

Depois ajuste `site/config.js` com a URL pública do Worker.

### GitHub Actions Secrets

Configure:

- `EDITAL_API_URL`
- `EDITAL_API_TOKEN`

O segundo deve ter o mesmo valor de `INGEST_TOKEN`.

### GitHub Pages

Em **Settings > Pages**, escolha **GitHub Actions**. O workflow publica apenas `site/`.

## Coleta manual

```bash
pip install -r collector/requirements.txt
EDITAL_API_URL="https://..." EDITAL_API_TOKEN="..." python collector/scraper.py
```

Para buscar páginas antigas da listagem:

```bash
python collector/scraper.py --max-list-pages 5
```

## Segurança

O navegador nunca recebe acesso direto ao D1. A ingestão exige token secreto, consultas usam parâmetros e o limite diário salva apenas um hash temporário derivado de IP + data + segredo, não o IP original.

Leia [SECURITY.md](SECURITY.md) e [docs/architecture.md](docs/architecture.md).

## Fonte inicial

https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial

## Licença

MIT.

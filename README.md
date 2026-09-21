# Edital Monitor

Buscador público, gratuito e open source para pesquisa em Boletins Oficiais.

A fonte inicial do projeto é o **Boletim Oficial de Telêmaco Borba/PR**. O sistema coleta as publicações, extrai o texto dos PDFs página a página, indexa o conteúdo e permite pesquisar nomes ou termos.

## Acessar

- Frontend público: https://editais.gmrsvoiage.com.br
- API: https://api.editais.gmrsvoiage.com.br
- Código-fonte: https://github.com/GMRsVoiage/edital-monitor

## O que o projeto faz

A pesquisa retorna, quando disponível:

- edição do boletim;
- data de publicação;
- página;
- trecho em que o termo foi encontrado;
- link para o PDF oficial.

O frontend é estático, responsivo e segue o **GMRsVoiage AquaWave Visual System**, com estética Frutiger Aero na camada externa e uma área de pesquisa mais limpa e documental.

## Como funciona

```text
Prefeitura / fonte oficial
        |
        v
Coletor Python
        |
        v
Cloudflare Worker /admin/ingest
        |
        v
Cloudflare D1 + FTS5
        |
        v
Cloudflare Worker /search
        |
        v
Frontend público
```

Os PDFs são baixados apenas durante a coleta. O projeto não mantém uma cópia permanente dos documentos oficiais.

## Arquitetura

- `site/` — frontend estático publicado pelo GitHub Pages;
- `worker/` — Cloudflare Worker com API pública e endpoints administrativos protegidos;
- `database/` — schema do Cloudflare D1 e índice FTS5;
- `collector/` — coletor Python responsável por descobrir, baixar e extrair os boletins;
- `.github/workflows/` — deploy, coleta recorrente e backfill histórico;
- `docs/` — documentação técnica complementar.

## Frontend

O frontend é publicado em:

```text
https://editais.gmrsvoiage.com.br
```

A API de produção usada pelo site é:

```text
https://api.editais.gmrsvoiage.com.br
```

A interface pública não contém credenciais administrativas e não acessa o D1 diretamente.

## API

Rotas atualmente implementadas:

| Método | Rota | Uso |
| --- | --- | --- |
| `GET` | `/` | identificação básica da API |
| `GET` | `/health` | health check da API e do banco |
| `GET` | `/stats` | estatísticas do índice |
| `GET` | `/search?q=...` | pesquisa pública |
| `GET` | `/admin/known` | verifica se um documento já foi processado |
| `POST` | `/admin/ingest` | ingestão protegida de documentos |

As rotas `/admin/*` exigem o `INGEST_TOKEN`.

A pesquisa usa FTS5 e atualmente retorna no máximo 50 ocorrências por requisição.

## Coletor

O coletor:

1. percorre a listagem do Boletim Oficial;
2. identifica publicações ainda não processadas;
3. localiza o PDF oficial;
4. baixa o arquivo temporariamente;
5. calcula SHA-256;
6. extrai o texto página a página;
7. envia os dados para `POST /admin/ingest`;
8. descarta o PDF local após o processamento.

Documentos com pouco ou nenhum texto extraível podem ser marcados para OCR futuro.

### Runner self-hosted

A coleta atual utiliza um **GitHub Actions runner self-hosted em Windows**.

Isso é necessário porque a fonte oficial utiliza proteção anti-bot/Cloudflare e requisições originadas de runners hospedados pelo GitHub podem ser bloqueadas. O runner self-hosted permite que a coleta seja executada a partir de uma rede comum, sem alterar o conteúdo público acessado e sem depender de autenticação privada da fonte.

Por isso, neste momento, a automação de coleta depende de uma máquina self-hosted disponível.

## Workflows

### Coleta recorrente

Arquivo:

```text
.github/workflows/collect.yml
```

Atualmente:

- executa em runner self-hosted Windows;
- pode ser iniciado manualmente;
- também possui agendamento automático;
- processa novos documentos em lotes controlados.

### Backfill histórico

Arquivo:

```text
.github/workflows/backfill.yml
```

Serve para percorrer páginas antigas da listagem e preencher o histórico disponível de forma gradual.

O workflow aceita parâmetros como:

- quantidade máxima de páginas da listagem;
- quantidade máxima de documentos por lote;
- intervalo entre documentos;
- intervalo entre páginas da listagem.

## Configuração

### 1. Cloudflare D1

```bash
npx wrangler@latest d1 create edital-monitor
cd worker
npm install
npx wrangler d1 execute edital-monitor --remote --file=../database/schema.sql
```

Depois, configure o `database_id` em:

```text
worker/wrangler.jsonc
```

### 2. Segredos do Worker

```bash
cd worker
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put RATE_LIMIT_SALT
npm run deploy
```

### 3. Variáveis principais

No Worker:

- `INGEST_TOKEN` — autentica a ingestão e rotas administrativas;
- `RATE_LIMIT_SALT` — usado na geração do hash temporário do rate limit;
- `DAILY_SEARCH_LIMIT` — limite diário de pesquisas;
- `ALLOWED_ORIGIN` — origem permitida no CORS.

No ambiente do coletor:

- `EDITAL_API_URL`;
- `EDITAL_API_TOKEN`;
- `BOLETIM_SOURCE_URL`.

O valor de `EDITAL_API_TOKEN` deve corresponder ao `INGEST_TOKEN`.

### 4. GitHub Actions Secrets

Para coleta:

- `EDITAL_API_URL`;
- `EDITAL_API_TOKEN`.

Para deploy manual do Worker, quando utilizado:

- `CLOUDFLARE_API_TOKEN`;
- `CLOUDFLARE_ACCOUNT_ID`.

## Coleta manual

Instale as dependências:

```bash
pip install -r collector/requirements.txt
```

Execute:

```bash
python collector/scraper.py
```

Exemplo de backfill controlado:

```bash
python collector/scraper.py \
  --max-list-pages 5 \
  --max-documents 100 \
  --delay-seconds 2 \
  --list-delay-seconds 1
```

As variáveis `EDITAL_API_URL`, `EDITAL_API_TOKEN` e `BOLETIM_SOURCE_URL` devem estar disponíveis no ambiente.

## Segurança e privacidade

O navegador nunca recebe acesso direto ao D1.

A ingestão exige token secreto e as consultas ao banco utilizam parâmetros.

Para o limite diário de pesquisa, a aplicação utiliza um identificador temporário derivado de:

```text
IP + data + segredo do servidor
```

O IP original não é persistido pelo aplicativo na tabela de controle diário.

O projeto não exige cadastro para pesquisar.

Mais detalhes:

- [SECURITY.md](SECURITY.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/deployment.md](docs/deployment.md)

## Fonte inicial

Boletim Oficial da Prefeitura de Telêmaco Borba/PR:

https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial

O **Edital Monitor é um projeto independente** e não possui vínculo oficial com a Prefeitura de Telêmaco Borba.

## Limitações

- PDFs digitalizados ou compostos apenas por imagens podem não possuir texto extraível;
- tabelas e layouts complexos podem gerar texto imperfeito;
- o mecanismo de busca depende da qualidade do conteúdo extraído;
- resultados devem sempre ser confirmados no documento oficial;
- OCR ainda é uma etapa futura do projeto.

## Contribuição

Consulte [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

MIT. Consulte [LICENSE](LICENSE).

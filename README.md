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

- `frontend/` — aplicação web em Next.js (App Router) que consome exclusivamente a API REST;
- `site/` — frontend estático legado publicado pelo GitHub Pages;
- `worker/` — Cloudflare Worker com API REST pública, autenticação, CRUD e endpoints administrativos;
- `database/` — schema do Cloudflare D1 (`schema.sql`), índice FTS5 e seed local (`seed.dev.sql`);
- `collector/` — coletor Python responsável por descobrir, baixar e extrair os boletins;
- `tests/` — suíte de testes E2E integrando D1 local, Worker e Next.js;
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

### Cabeçalhos comuns
- `Content-Type: application/json` — obrigatório nas requisições `POST`, `PUT` e `PATCH` com corpo JSON.
- `Authorization: Bearer <token>` — obrigatório nas rotas privadas de usuário, grupos, palavras-chave, alertas e relatórios (token obtido em `/auth/register` ou `/auth/login`).
- `Authorization: Bearer <INGEST_TOKEN>` — obrigatório apenas nas rotas administrativas `/admin/*`.

### Rotas preservadas

| Método | Rota | Autenticação | Uso |
| --- | --- | --- | --- |
| `GET` | `/` | Pública | Identificação básica da API |
| `GET` | `/health` | Pública | Health check da API e do banco D1 (`200` ou `503`) |
| `GET` | `/stats` | Pública | Estatísticas do índice (`documents`, `pages`, `latest`) |
| `GET` | `/search?q=...` | Pública | Pesquisa FTS5 nos boletins (3 a 100 caracteres, até 50 ocorrências) |
| `GET` | `/admin/known` | `INGEST_TOKEN` | Verifica se um documento já foi processado (`?source_page_url=...`) |
| `POST` | `/admin/ingest` | `INGEST_TOKEN` | Ingestão protegida de documentos e páginas |

### Rotas de usuários, autenticação, CRUD e relatórios

| Método | Rota | Autenticação | Parâmetros / Uso |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | Pública | Cadastra usuário (`name`, `email`, `password` com hash PBKDF2-SHA256) |
| `POST` | `/auth/login` | Pública | Autentica usuário (`email`, `password`) e retorna token Bearer |
| `GET` | `/users/me` (ou `/auth/me`) | Bearer | Retorna o perfil do usuário autenticado |
| `PUT` / `PATCH` | `/users/me` | Bearer | Atualiza `name`, `email` e/ou `password` do usuário autenticado |
| `GET` | `/groups` | Bearer | Lista grupos de palavras-chave (`?q=...`) |
| `POST` | `/groups` | Bearer | Cria um grupo (`name`, `description`, `color`) |
| `GET` | `/groups/:id` | Bearer | Consulta um grupo específico |
| `PUT` / `PATCH` | `/groups/:id` | Bearer | Atualiza dados de um grupo |
| `DELETE` | `/groups/:id` | Bearer | Exclui um grupo vazio (`409` se houver palavras-chave vinculadas) |
| `GET` | `/keywords` | Bearer | Lista palavras-chave salvas (`?q=`, `group_id`, `priority`, `active`) |
| `POST` | `/keywords` | Bearer | Salva nova palavra-chave (`keyword`, `group_id`, `description`, `priority`, `target_section`, `is_active`) |
| `GET` | `/keywords/:id` | Bearer | Consulta uma palavra-chave salva pelo `id` |
| `PUT` / `PATCH` | `/keywords/:id` | Bearer | Edita/atualiza uma palavra-chave salva e atualiza `updated_at` |
| `DELETE` | `/keywords/:id` | Bearer | Exclui uma palavra-chave salva e seus alertas em cascata |
| `POST` | `/keywords/:id/scan` | Bearer | Varre os boletins indexados no FTS5 para a palavra-chave e gera alertas |
| `GET` | `/alerts` | Bearer | Lista alertas gerados (`?status=`, `keyword_id`, `q=`) |
| `POST` | `/alerts` | Bearer | Cria um alerta manual vinculado a uma palavra-chave |
| `GET` | `/alerts/:id` | Bearer | Consulta um alerta específico |
| `PUT` / `PATCH` | `/alerts/:id` | Bearer | Atualiza `status` (`novo`, `revisado`, `arquivado`) ou `notes` |
| `DELETE` | `/alerts/:id` | Bearer | Remove um alerta pelo `id` |
| `GET` | `/reports` | Bearer | Relatórios consolidados com filtros (`?q=`, `group_id`, `priority`, `active`, `status`, `from`, `to`) |

### Exemplos de requisição e resposta JSON

Cadastro de usuário (`POST /auth/register`):

```json
{
  "name": "Rafael Oliveira",
  "email": "rafael@exemplo.com",
  "password": "SenhaForte123"
}
```

Resposta (`201 Created`):

```json
{
  "user": {
    "id": 1,
    "name": "Rafael Oliveira",
    "email": "rafael@exemplo.com",
    "role": "user"
  },
  "token": "<token-bearer-assinado>"
}
```

Criação de palavra-chave salva (`POST /keywords`):

```json
{
  "keyword": "Pregão Eletrônico",
  "description": "Acompanhar licitações da saúde",
  "priority": "alta",
  "target_section": "licitacoes",
  "is_active": true,
  "group_id": 1
}
```

Resposta (`201 Created`):

```json
{
  "keyword": {
    "id": 1,
    "user_id": 1,
    "group_id": 1,
    "keyword": "Pregão Eletrônico",
    "description": "Acompanhar licitações da saúde",
    "priority": "alta",
    "target_section": "licitacoes",
    "is_active": 1,
    "created_at": "2026-11-24 07:00:00",
    "updated_at": "2026-11-24 07:00:00"
  }
}
```

### Códigos HTTP utilizados

| Código | Significado | Quando a API retorna |
| --- | --- | --- |
| `200` | OK | Leitura (`GET`), atualização (`PUT`/`PATCH`) ou exclusão (`DELETE`) realizada com sucesso |
| `201` | Created | Novo registro criado com sucesso (`POST /auth/register`, `/groups`, `/keywords`, `/alerts`, `/admin/ingest`) |
| `204` | No Content | Resposta de preflight CORS (`OPTIONS`) sem corpo |
| `400` | Bad Request | Dados inválidos, JSON malformado, tamanho fora do intervalo (3–100 caracteres) ou ID malformado |
| `401` | Unauthorized | Token Bearer ausente, inválido/expirado ou credenciais de login incorretas |
| `403` | Forbidden | Tentativa de acessar ou alterar registro pertencente a outro usuário |
| `404` | Not Found | Rota inexistente ou registro (`:id`) não encontrado no banco |
| `409` | Conflict | Registro duplicado (e-mail ou palavra-chave já cadastrada) ou exclusão de grupo com palavras-chave vinculadas |
| `415` | Unsupported Media Type | Requisição de escrita sem `Content-Type: application/json` |
| `429` | Too Many Requests | Limite diário de pesquisas públicas atingido em `/search` |
| `503` | Service Unavailable | Falha de conexão/verificação do banco D1 em `/health` |

### Execução local (D1 + Worker + Next.js)

1. Aplicar schema e seed no D1 local (a partir da pasta `worker/`):

```bash
cd worker
npm install
npx wrangler d1 execute edital-monitor --local --file=../database/schema.sql
npx wrangler d1 execute edital-monitor --local --file=../database/seed.dev.sql
```

2. Subir o Worker localmente (porta `8787`):

```bash
cd worker
npx wrangler dev --local --port 8787
```

3. Subir o frontend em Next.js localmente (porta `3000`, em outro terminal):

```bash
cd frontend
npm install
npm run dev
```

Acesse `http://localhost:3000` (o frontend consome `NEXT_PUBLIC_API_URL`, com fallback para `http://127.0.0.1:8787`).

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
- [Guia de desenvolvimento e validação](docs/DEVELOPMENT.md)
- [Orientações para agentes de IA](AGENTS.md)

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

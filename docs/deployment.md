# Implantação

## D1

```bash
npx wrangler@latest d1 create edital-monitor
cd worker
npm install
npx wrangler d1 execute edital-monitor --remote --file=../database/schema.sql
```

Atualize `worker/wrangler.jsonc` com o ID do banco.

## Segredos

```bash
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put RATE_LIMIT_SALT
npm run deploy
```

Atualize `site/config.js` com a URL do Worker.

## GitHub Actions

Secrets necessários para coleta:

- `EDITAL_API_URL`
- `EDITAL_API_TOKEN`

Para o workflow manual de deploy do Worker:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## GitHub Pages

Em Settings > Pages, selecione GitHub Actions.

## Domínio

Depois que a URL padrão funcionar, configure `editais.gmrsvoiage.com.br` no GitHub Pages e DNS. Só então adicione um `CNAME`.

## Rate limiting de borda

Além do limite diário do Worker, é recomendado configurar no painel Cloudflare uma regra de Rate Limiting para `/search` contra rajadas.

# Política de segurança

Não publique tokens, credenciais ou detalhes exploráveis em issues públicas.

Para vulnerabilidades, use **Report a vulnerability** no GitHub quando disponível ou outro canal privado do mantenedor.

## Modelo de segurança

- D1 não é acessado diretamente pelo navegador.
- A API pública só executa consultas predefinidas e parametrizadas.
- Rotas `/admin/*` exigem `INGEST_TOKEN`.
- Segredos pertencem ao Cloudflare Secrets ou GitHub Actions Secrets.
- `.env` e `.dev.vars` são ignorados pelo Git.
- O banco deve conter somente dados oriundos de documentos públicos.
- O IP original não é persistido pelo aplicativo no controle diário.

Se um segredo vazar, rotacione-o imediatamente no Cloudflare e no GitHub. Apagar apenas o commit não torna o segredo seguro novamente.

# Desenvolvimento e validação — Edital Monitor

Este documento reúne os comandos e verificações que podem ser deduzidos dos arquivos atualmente versionados. Ele **não certifica** que uma execução local ou um deploy foi testado.

## Pré-requisitos

- Node.js e npm para o Cloudflare Worker.
- Python e pip para o coletor.
- Configuração autorizada do Cloudflare para trabalhar com D1 e Worker.
- Variáveis de ambiente documentadas em `README.md`, `.env.example` e `worker/.dev.vars.example`; **não copie valores secretos reais para o repositório**.

## Worker (API)

Na pasta `worker/`:

```sh
npm ci
npm run dev
```

Os scripts versionados em `worker/package.json` são `dev` e `deploy`. Neste estado do repositório, **não há script npm de testes automatizados** definido nesse arquivo. Não reporte `npm test` como aprovado sem acrescentar e executar testes reais.

O comando `npm run deploy` realiza publicação: execute-o somente quando um deploy for solicitado e houver autorização/configuração adequada.

## Coletor Python

Na raiz do repositório:

```sh
python -m pip install -r collector/requirements.txt
python collector/scraper.py --help
```

Verifique os parâmetros efetivamente apresentados pelo script antes de iniciar uma coleta. A execução real pode consumir rede, contatar a fonte oficial e enviar dados à API configurada; não a use como teste inofensivo sem conferir o ambiente, os limites e o destino.

## Frontend

O diretório `site/` contém o frontend estático. Confira seus arquivos e suas URLs de integração antes de alterar configurações do site publicado. Não presuma que o comando de desenvolvimento do Worker publica ou valida o frontend.

## Checklist antes de concluir uma alteração

- [ ] Arquivos e componentes impactados foram identificados.
- [ ] A documentação e o comportamento do código não ficaram contraditórios.
- [ ] Nenhum segredo ou dado privado foi incluído no diff.
- [ ] Se houve mudança na API, as chamadas do frontend/coletor foram revisadas.
- [ ] Se houve mudança no banco, a migração e a compatibilidade de dados foram avaliadas.
- [ ] As verificações realmente executadas foram registradas, com resultado e limitações.
- [ ] Deploy produtivo e ingestão real não foram usados como testes involuntários.

## Próxima melhoria recomendada

Introduzir testes automatizados específicos para validação de entrada e segurança das rotas do Worker, além de testes do coletor com respostas simuladas da fonte oficial. Só depois acrescentar comandos de testes e gates de CI que correspondam a verificações reais.

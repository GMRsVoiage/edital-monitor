# AGENTS.md — Edital Monitor (V1)

Este arquivo orienta colaboradores e agentes de IA que alteram **este repositório**. O Edital Monitor é a V1 pública de Telêmaco Borba/PR; não confunda seu código nem suas decisões com os do projeto independente O Diário Aberto (ODA).

## Ordem de leitura

1. `README.md`: funcionalidades, instalação e limitações documentadas.
2. `docs/architecture.md`: fluxos de ingestão e pesquisa.
3. `docs/deployment.md`: processo de publicação e variáveis de ambiente.
4. `SECURITY.md` e `CONTRIBUTING.md`: segurança e contribuições.
5. Código e workflows **efetivamente presentes** na área que será alterada.

Se a documentação e o código discordarem, verifique o comportamento real e registre a divergência antes de escolher uma alteração. Não trate descrições históricas como confirmação de funcionamento atual.

## Mapa rápido

- `site/`: frontend público.
- `worker/`: API Cloudflare Worker.
- `database/`: schema e índice D1/FTS5.
- `collector/`: coleta Python e extração temporária dos PDFs.
- `.github/workflows/`: publicação, coleta recorrente e backfill.
- `docs/`: arquitetura e deploy.

## Procedimento de trabalho

1. Confirme a branch, o commit atual e os arquivos afetados.
2. Explique o objetivo e identifique os contratos ou integrações impactados.
3. Faça mudanças pequenas e focadas; não misture refatorações não relacionadas.
4. Atualize a documentação afetada **no mesmo conjunto de commits** quando mudar um contrato, um fluxo ou a forma de executar o projeto.
5. Execute as verificações disponíveis e relate com precisão quais testes foram executados e quais dependem de ambiente externo.
6. Ao concluir, registre o que mudou, a validação realizada, limitações e próximas pendências.

Use `docs/DEVELOPMENT.md` para os comandos de desenvolvimento e a checklist de validação. Não invente resultados de testes nem suponha que um deploy ocorreu por causa de um commit.

## Contratos e cuidados

- Preserve a separação entre o frontend público, o Worker e as rotas administrativas.
- Alterações de schema/FTS5 ou de ingestão exigem analisar compatibilidade com dados existentes e idempotência.
- A coleta deve priorizar a fonte oficial e manter os PDFs temporários; não adicionar armazenamento permanente sem decisão explícita.
- Evite introduzir coleta agressiva, tentativas não controladas ou contornos de proteção do portal de origem.
- Não introduza histórico nominal de pesquisas dos visitantes sem decisão explícita e revisão de privacidade.
- Não exponha `INGEST_TOKEN`, `EDITAL_API_TOKEN`, `RATE_LIMIT_SALT`, cookies ou credenciais. Exemplos devem conter apenas placeholders.
- Evite deploy produtivo, mudanças em segredos, alteração de visibilidade, reescrita de histórico ou exclusões destrutivas sem autorização explícita.

## Estado de trabalho

Issues e pull requests descrevem demandas e mudanças; o código versionado é a referência para a implementação efetiva. Para tarefas longas, deixe no PR ou issue um resumo verificável do estado e próximo passo. Não acrescente relatórios extensos a cada tarefa trivial.

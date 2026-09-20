# Edital Monitor

Buscador público e gratuito de Boletins Oficiais, começando por Telêmaco Borba/PR.

A proposta é coletar publicações oficiais, extrair o texto página a página e disponibilizar uma busca simples que retorne a edição, data, página, trecho encontrado e o link para o documento original.

## Arquitetura

- GitHub Pages: frontend estático
- Cloudflare Worker: API pública e endpoints de ingestão protegidos
- Cloudflare D1: banco SQL pesquisável
- GitHub Actions: coleta automática
- Python + pypdf: descoberta e extração dos PDFs

O projeto não armazena os PDFs permanentemente e não exige conta para pesquisar.

> Estado: versão inicial em desenvolvimento.

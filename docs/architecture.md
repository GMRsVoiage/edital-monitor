# Arquitetura

## Ingestão

1. GitHub Actions executa `collector/scraper.py`.
2. O coletor lê a listagem do Boletim Oficial.
3. Abre publicações ainda desconhecidas.
4. Procura PDF em links, iframe, embed, object e no HTML.
5. Baixa o PDF apenas durante a execução.
6. Calcula SHA-256 e extrai texto página a página.
7. Envia tudo para `POST /admin/ingest`.
8. O Worker valida o token e grava no D1.
9. Triggers mantêm FTS5 sincronizado.

PDFs não são persistidos pelo projeto.

## Pesquisa

1. GitHub Pages chama `GET /search?q=...`.
2. O Worker valida o termo.
3. Um hash temporário IP + data + salt controla o limite diário.
4. FTS5 pesquisa o texto.
5. A API retorna no máximo 50 ocorrências com data, página, trecho e URL oficial.

## OCR futuro

Quando há pouco texto extraível, o documento recebe `needs_ocr`. Um processo posterior poderá preencher novamente `pages.text` com OCR ou visão computacional.

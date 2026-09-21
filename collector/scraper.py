from __future__ import annotations

import argparse
import hashlib
import io
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import date
from html import unescape
from urllib.parse import parse_qs, unquote, urldefrag, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from curl_cffi import requests as browser_requests
from pypdf import PdfReader

DEFAULT_SOURCE = "https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial"
DIRECT_PDF_TEMPLATES = (
    "https://telemacoborba.pr.gov.br/images/boletim/Edicao{edition}.pdf",
    "https://telemacoborba.pr.gov.br/images/boletim/Edicao-{edition}.pdf",
)

MONTHS = {
    "janeiro": 1, "fevereiro": 2, "março": 3, "abril": 4,
    "maio": 5, "junho": 6, "julho": 7, "agosto": 8,
    "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12,
}

SOURCE_SESSION = browser_requests.Session(
    impersonate="chrome",
    retry=2,
    headers={
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
    },
)
API_SESSION = requests.Session()
API_SESSION.headers["User-Agent"] = "EditalMonitorCollector/0.1"


@dataclass(frozen=True)
class Edition:
    title: str
    edition: str | None
    published_at: str | None
    source_page_url: str


def get(url: str, timeout: int = 30):
    response = SOURCE_SESSION.get(
        url,
        timeout=timeout,
        allow_redirects=True,
        referer="https://telemacoborba.pr.gov.br/",
    )
    if response.status_code == 403:
        server = response.headers.get("server", "desconhecido")
        content_type = response.headers.get("content-type", "desconhecido")
        body = re.sub(r"\s+", " ", response.text[:300]).strip()
        raise RuntimeError(
            "Fonte recusou o coletor com HTTP 403 "
            f"(server={server}, content-type={content_type}, body={body!r})"
        )
    response.raise_for_status()
    return response


def parse_pt_date(text: str) -> str | None:
    match = re.search(r"(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})", text, re.I)
    if not match:
        return None
    month = MONTHS.get(match.group(2).lower())
    if not month:
        return None
    try:
        return date(int(match.group(3)), month, int(match.group(1))).isoformat()
    except ValueError:
        return None


def editions_from_soup(soup: BeautifulSoup, base_url: str) -> list[Edition]:
    found: dict[str, Edition] = {}

    for link in soup.select("a[href]"):
        title = " ".join(link.stripped_strings).strip()
        match = re.search(r"\bEdi[cç][aã]o\s+(\d+)", title, re.I)
        if not match:
            continue
        href, _ = urldefrag(urljoin(base_url, link["href"]))
        if "boletim-oficial" not in href:
            continue
        container = link.find_parent("tr") or link.parent
        published = parse_pt_date(container.get_text(" ", strip=True)) if container else None
        found[href] = Edition(title, match.group(1), published, href)

    return list(found.values())


def pagination_links(soup: BeautifulSoup, base_url: str) -> list[str]:
    links: list[str] = []
    for link in soup.select("a[href]"):
        label = " ".join(link.stripped_strings).strip()
        folded = label.casefold()
        if not (label.isdigit() or folded in {"próximo", "proximo", "next"}):
            continue

        href, _ = urldefrag(urljoin(base_url, link["href"]))
        if "boletim-oficial" not in href:
            continue
        if href not in links:
            links.append(href)
    return links


def crawl_editions(source_url: str, max_pages: int) -> list[Edition]:
    source_url, _ = urldefrag(source_url)
    queue = [source_url]
    queued = {source_url}
    visited: set[str] = set()
    found: dict[str, Edition] = {}

    while queue and len(visited) < max_pages:
        requested_url = queue.pop(0)
        response = get(requested_url)
        page_url, _ = urldefrag(response.url)
        if page_url in visited:
            continue

        visited.add(page_url)
        soup = BeautifulSoup(response.text, "html.parser")
        page_editions = editions_from_soup(soup, page_url)

        for item in page_editions:
            found[item.source_page_url] = item

        print(
            f"[list] página {len(visited)}/{max_pages}: "
            f"{len(page_editions)} edições, {len(found)} únicas"
        )

        for href in pagination_links(soup, page_url):
            if href not in visited and href not in queued:
                queued.add(href)
                queue.append(href)

    if len(visited) < max_pages and not queue:
        print(
            f"[list] paginação terminou após {len(visited)} página(s); "
            "não há mais links de paginação."
        )

    return list(found.values())


def pdf_candidates(detail_url: str) -> list[str]:
    response = get(detail_url)
    soup = BeautifulSoup(response.text, "html.parser")
    values: list[str] = []

    def add(raw: str) -> None:
        decoded = unescape(raw).replace("\\/", "/")
        candidate = urljoin(response.url, decoded)
        parsed = urlparse(candidate)

        query = parse_qs(parsed.query)
        for key in ("file", "url", "src"):
            for nested in query.get(key, []):
                nested_url = urljoin(response.url, unquote(nested))
                if ".pdf" in nested_url.lower() and nested_url not in values:
                    values.append(nested_url)

        if (".pdf" in candidate.lower() or "boletim" in candidate.lower()) and candidate not in values:
            values.append(candidate)

    for tag_name, attr in [("a", "href"), ("iframe", "src"), ("embed", "src"), ("object", "data")]:
        for tag in soup.select(f"{tag_name}[{attr}]"):
            raw = tag.get(attr)
            if raw:
                add(raw)

    pattern = r"""(?:https?:)?//[^"'<>\s]+\.pdf(?:\?[^"'<>\s]*)?|/[A-Za-z0-9_./%+-]+\.pdf(?:\?[^"'<>\s]*)?"""
    bodies = {
        response.text,
        unescape(response.text),
        unquote(unescape(response.text)),
    }
    for body in bodies:
        for raw in re.findall(pattern, body, re.I):
            add(raw)

    return values


def download_pdf(candidates: list[str], max_bytes: int) -> tuple[str, bytes]:
    last_error: Exception | None = None
    for candidate in candidates:
        try:
            response = get(candidate, 60)
            content = response.content
            if len(content) > max_bytes:
                raise ValueError("PDF acima do limite de tamanho")
            content_type = response.headers.get("content-type", "").lower()
            if content.startswith(b"%PDF") or "application/pdf" in content_type:
                return response.url, content
            raise ValueError(
                f"Resposta não é PDF (content-type={content_type or 'desconhecido'})"
            )
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"Nenhum PDF válido encontrado. Último erro: {last_error}")


def download_edition_pdf(item: Edition, max_bytes: int) -> tuple[str, bytes]:
    direct_error: Exception | None = None
    plain_title = bool(
        item.edition
        and re.fullmatch(r"\s*Edi[cç][aã]o\s+\d+\s*", item.title, re.I)
    )

    if item.edition and item.edition.isdigit() and plain_title:
        direct_candidates = [
            template.format(edition=item.edition)
            for template in DIRECT_PDF_TEMPLATES
        ]
        print(
            "  -> tentando PDF direto: "
            + " | ".join(direct_candidates)
        )
        try:
            return download_pdf(direct_candidates, max_bytes)
        except Exception as exc:
            direct_error = exc
            print(f"  -> PDF direto falhou; tentando página da edição: {exc}")
    elif item.edition:
        print("  -> edição com sufixo/complemento; usando a página oficial como fonte do PDF")

    try:
        candidates = pdf_candidates(item.source_page_url)
        if not candidates:
            raise RuntimeError("Página da edição não revelou candidatos de PDF")
        return download_pdf(candidates, max_bytes)
    except Exception as fallback_error:
        if direct_error:
            raise RuntimeError(
                f"PDF direto falhou ({direct_error}); fallback também falhou "
                f"({fallback_error})"
            ) from fallback_error
        raise


def extract_pages(data: bytes) -> tuple[list[dict], str]:
    reader = PdfReader(io.BytesIO(data))
    pages: list[dict] = []
    chars = 0
    for number, page in enumerate(reader.pages, 1):
        try:
            text = (page.extract_text() or "").replace("\x00", "").strip()
        except Exception:
            text = ""
        chars += len(text)
        pages.append({"page_number": number, "text": text})
    method = "native" if chars >= max(50, len(pages) * 10) else "needs_ocr"
    return pages, method


def headers(token: str) -> dict[str, str]:
    return {
        "authorization": f"Bearer {token}",
        "content-type": "application/json",
        "user-agent": "EditalMonitorCollector/0.1",
    }


def known(api: str, token: str, source_url: str) -> bool:
    response = API_SESSION.get(
        api.rstrip("/") + "/admin/known",
        params={"source_page_url": source_url},
        headers=headers(token),
        timeout=30,
    )
    response.raise_for_status()
    return bool(response.json().get("exists"))


def ingest(api: str, token: str, payload: dict) -> None:
    response = API_SESSION.post(
        api.rstrip("/") + "/admin/ingest",
        json=payload,
        headers=headers(token),
        timeout=120,
    )
    if not response.ok:
        raise RuntimeError(f"Ingestão falhou ({response.status_code}): {response.text[:400]}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-url", default=os.getenv("BOLETIM_SOURCE_URL", DEFAULT_SOURCE))
    parser.add_argument("--max-list-pages", type=int, default=1)
    parser.add_argument("--max-documents", type=int, default=25)
    parser.add_argument("--max-pdf-mb", type=int, default=50)
    parser.add_argument("--delay-seconds", type=float, default=2.0)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    api = os.getenv("EDITAL_API_URL", "").strip()
    token = os.getenv("EDITAL_API_TOKEN", "").strip()
    if not api or not token:
        print("Defina EDITAL_API_URL e EDITAL_API_TOKEN.", file=sys.stderr)
        return 2

    editions = crawl_editions(args.source_url, max(1, args.max_list_pages))
    print(f"[list] total encontrado: {len(editions)} edição(ões)")

    imported = 0
    errors = 0
    already_known = 0
    new_processed = 0
    max_new = max(1, args.max_documents)

    for item in editions:
        print(f"[check] {item.title}")

        try:
            if not args.force and known(api, token, item.source_page_url):
                already_known += 1
                print("  -> já conhecido")
                continue

            if new_processed >= max_new:
                print(
                    f"[limit] limite de {max_new} documento(s) novo(s) atingido; "
                    "encerrarei este lote."
                )
                break

            new_processed += 1

            final_pdf_url, pdf = download_edition_pdf(
                item,
                args.max_pdf_mb * 1024 * 1024,
            )
            digest = hashlib.sha256(pdf).hexdigest()
            pages, method = extract_pages(pdf)

            ingest(api, token, {
                "source_page_url": item.source_page_url,
                "pdf_url": final_pdf_url,
                "edition": item.edition,
                "title": item.title,
                "published_at": item.published_at,
                "sha256": digest,
                "extraction_method": method,
                "pages": pages,
            })
            imported += 1
            print(f"  -> importado: {len(pages)} páginas, {method}")
        except Exception as exc:
            errors += 1
            print(f"  -> erro: {exc}", file=sys.stderr)

        time.sleep(max(0.0, args.delay_seconds))

    print(
        "Concluído. "
        f"encontrados={len(editions)}, "
        f"já_conhecidos={already_known}, "
        f"novos_processados={new_processed}, "
        f"importados={imported}, "
        f"erros={errors}"
    )
    return 1 if errors and not imported else 0


if __name__ == "__main__":
    raise SystemExit(main())

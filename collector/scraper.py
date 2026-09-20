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
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

DEFAULT_SOURCE = "https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial"

MONTHS = {
    "janeiro": 1, "fevereiro": 2, "março": 3, "abril": 4,
    "maio": 5, "junho": 6, "julho": 7, "agosto": 8,
    "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12,
}

SESSION = requests.Session()
SESSION.headers["User-Agent"] = "EditalMonitor/0.1 (https://github.com/GMRsVoiage/edital-monitor)"


@dataclass(frozen=True)
class Edition:
    title: str
    edition: str | None
    published_at: str | None
    source_page_url: str


def get(url: str, timeout: int = 30) -> requests.Response:
    response = SESSION.get(url, timeout=timeout, allow_redirects=True)
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


def listing_pages(source_url: str, max_pages: int) -> list[str]:
    urls = [source_url]
    if max_pages <= 1:
        return urls
    response = get(source_url)
    soup = BeautifulSoup(response.text, "html.parser")
    for link in soup.select("a[href]"):
        label = " ".join(link.stripped_strings).strip()
        href = urljoin(response.url, link["href"])
        if label.isdigit() and href not in urls:
            urls.append(href)
            if len(urls) >= max_pages:
                break
    return urls


def discover_editions(url: str) -> list[Edition]:
    response = get(url)
    soup = BeautifulSoup(response.text, "html.parser")
    found: dict[str, Edition] = {}

    for link in soup.select("a[href]"):
        title = " ".join(link.stripped_strings).strip()
        match = re.search(r"\bEdi[cç][aã]o\s+(\d+)", title, re.I)
        if not match:
            continue
        href = urljoin(response.url, link["href"])
        if "boletim-oficial" not in href:
            continue
        container = link.find_parent("tr") or link.parent
        published = parse_pt_date(container.get_text(" ", strip=True)) if container else None
        found[href] = Edition(title, match.group(1), published, href)

    return list(found.values())


def pdf_candidates(detail_url: str) -> list[str]:
    response = get(detail_url)
    soup = BeautifulSoup(response.text, "html.parser")
    values: list[str] = []

    for tag_name, attr in [("a", "href"), ("iframe", "src"), ("embed", "src"), ("object", "data")]:
        for tag in soup.select(f"{tag_name}[{attr}]"):
            raw = tag.get(attr)
            if raw:
                candidate = urljoin(response.url, raw)
                if ".pdf" in candidate.lower() or "boletim" in candidate.lower():
                    values.append(candidate)

    pattern = r"""(?:https?:)?//[^"'<>\s]+\.pdf(?:\?[^"'<>\s]*)?|/[A-Za-z0-9_./%+-]+\.pdf(?:\?[^"'<>\s]*)?"""
    for raw in re.findall(pattern, response.text, re.I):
        values.append(urljoin(response.url, raw))

    unique: list[str] = []
    for value in values:
        value = value.replace("&amp;", "&")
        if value not in unique:
            unique.append(value)
    return unique


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
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"Nenhum PDF válido encontrado. Último erro: {last_error}")


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
    response = SESSION.get(
        api.rstrip("/") + "/admin/known",
        params={"source_page_url": source_url},
        headers=headers(token),
        timeout=30,
    )
    response.raise_for_status()
    return bool(response.json().get("exists"))


def ingest(api: str, token: str, payload: dict) -> None:
    response = SESSION.post(
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
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    api = os.getenv("EDITAL_API_URL", "").strip()
    token = os.getenv("EDITAL_API_TOKEN", "").strip()
    if not api or not token:
        print("Defina EDITAL_API_URL e EDITAL_API_TOKEN.", file=sys.stderr)
        return 2

    editions: dict[str, Edition] = {}
    for page_url in listing_pages(args.source_url, max(1, args.max_list_pages)):
        for item in discover_editions(page_url):
            editions[item.source_page_url] = item

    imported = errors = 0
    for item in list(editions.values())[: max(1, args.max_documents)]:
        try:
            print(f"[check] {item.title}")
            if not args.force and known(api, token, item.source_page_url):
                print("  -> já conhecido")
                continue

            final_pdf_url, pdf = download_pdf(
                pdf_candidates(item.source_page_url),
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
        time.sleep(0.5)

    print(f"Concluído. importados={imported}, erros={errors}")
    return 1 if errors and not imported else 0


if __name__ == "__main__":
    raise SystemExit(main())

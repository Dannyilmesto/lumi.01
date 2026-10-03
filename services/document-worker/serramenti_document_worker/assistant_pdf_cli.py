from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from base64 import b64encode
from io import BytesIO
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image

from .pdf_parser import parse_pdf

_STOP_WORDS = {
    "alla",
    "alle",
    "allo",
    "anche",
    "avere",
    "che",
    "chi",
    "come",
    "con",
    "cosa",
    "della",
    "delle",
    "dello",
    "dentro",
    "dove",
    "due",
    "gli",
    "ha",
    "hai",
    "hanno",
    "ho",
    "i",
    "il",
    "in",
    "la",
    "le",
    "lo",
    "ma",
    "mi",
    "nel",
    "nella",
    "nelle",
    "nello",
    "non",
    "o",
    "per",
    "piu",
    "puo",
    "quale",
    "quali",
    "quando",
    "quanto",
    "questa",
    "queste",
    "questi",
    "questo",
    "qui",
    "sono",
    "su",
    "sua",
    "sue",
    "sugli",
    "sui",
    "sul",
    "sulla",
    "sulle",
    "sullo",
    "tra",
    "un",
    "una",
    "uno",
    "voi",
    "vuoi",
    "vorrei",
}


def _normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.lower())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def _query_terms(value: str) -> list[str]:
    return [
        term for term in re.findall(r"[a-z0-9]{2,}", _normalize(value)) if term not in _STOP_WORDS
    ]


def _page_content(page: object) -> str:
    text = str(getattr(page, "text", "")).strip()
    tables = getattr(page, "tables", [])
    table_text: list[str] = []
    for table in tables:
        rows = getattr(table, "rows", [])
        for row in rows:
            cells = [str(cell).strip() for cell in row if str(cell).strip()]
            if cells:
                table_text.append(" | ".join(cells))
    if table_text:
        text = "\n".join(part for part in [text, "TABELLE PDF:", *table_text] if part)
    return text[:16_000]


def _select_pages(
    pages: list[object], query: str, preferred_pages: list[int], page_limit: int
) -> list[int]:
    terms = _query_terms(query)
    preferred_rank = {page_number: index for index, page_number in enumerate(preferred_pages)}
    scored: list[tuple[float, int]] = []
    for page in pages:
        page_number = int(page.page_number)
        content = _normalize(_page_content(page))
        score = sum(min(content.count(term), 4) for term in set(terms))
        if page_number in preferred_rank:
            score += max(1, 12 - preferred_rank[page_number])
        if score > 0:
            scored.append((score, page_number))

    if not scored:
        return list(range(1, min(len(pages), page_limit) + 1))

    ranked = sorted(scored, key=lambda item: (-item[0], item[1]))
    selected = [page_number for _, page_number in ranked[:page_limit]]

    # Bring in the beginning of the catalog when a later table is selected without its header.
    if selected and 1 not in selected and len(selected) < page_limit:
        selected.append(1)
    return sorted(set(selected))


def _render_page(document: pdfium.PdfDocument, page_number: int, max_side: int = 1800) -> str:
    page = document[page_number - 1]
    bitmap = None
    image = None
    try:
        width, height = page.get_size()
        scale = min(1.8, max_side / max(width, height))
        bitmap = page.render(scale=scale, rev_byteorder=True)
        image = bitmap.to_pil().convert("RGB")
        image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        output = BytesIO()
        image.save(output, format="JPEG", quality=84, optimize=True)
        return b64encode(output.getvalue()).decode("ascii")
    finally:
        if image is not None:
            image.close()
        if bitmap is not None:
            bitmap.close()
        page.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prepara testo, tabelle e immagini delle pagine pertinenti al dialogo AI."
    )
    parser.add_argument("pdf", type=Path, help="PDF originale del listino.")
    parser.add_argument("request", type=Path, help="JSON con domanda e pagine OCR pertinenti.")
    arguments = parser.parse_args()

    try:
        pdf_bytes = arguments.pdf.read_bytes()
        request = json.loads(arguments.request.read_text(encoding="utf-8"))
        query = str(request.get("query", ""))
        preferred_pages = [
            page
            for page in request.get("preferred_pages", [])
            if isinstance(page, int) and page > 0
        ]
        page_limit = min(max(int(request.get("page_limit", 4)), 1), 6)
        max_side = min(max(int(request.get("image_max_side", 1800)), 512), 1800)
        cached = request.get("prepared_context")
        if isinstance(cached, dict):
            # The caller already parsed/OCRed this exact PDF. Render only the selected pages.
            if cached.get("sha256") != hashlib.sha256(pdf_bytes).hexdigest():
                raise ValueError("L’estrazione salvata non corrisponde al PDF originale.")
            selected = cached["selected_page_numbers"][:page_limit]
            page_data = {
                page["page_number"]: page for page in cached["pages"]
            }
            result = {
                "sha256": cached["sha256"],
                "page_count": cached["page_count"],
                "document_kind": cached["document_kind"],
            }
        else:
            parsed = parse_pdf(pdf_bytes, source_file_name=arguments.pdf.name)
            selected = _select_pages(parsed.pages, query, preferred_pages, page_limit)
            page_data = {
                page.page_number: {
                    "page_number": page.page_number,
                    "text": _page_content(page),
                    "requires_ocr": page.requires_ocr,
                    "warnings": page.warnings,
                }
                for page in parsed.pages
            }
            result = {
                "sha256": parsed.sha256,
                "page_count": parsed.page_count,
                "document_kind": parsed.document_kind,
            }
        document = pdfium.PdfDocument(pdf_bytes)
        try:
            prepared_pages = []
            for page_number in selected:
                page = page_data[page_number]
                prepared_pages.append(
                    {
                        "page_number": page_number,
                        "text": page["text"],
                        "requires_ocr": page["requires_ocr"],
                        "warnings": page["warnings"],
                        "image_base64": _render_page(document, page_number, max_side),
                    }
                )
        finally:
            document.close()

        print(
            json.dumps(
                {
                    **result,
                    "selected_page_numbers": selected,
                    "pages": prepared_pages,
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Contesto PDF non preparato: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

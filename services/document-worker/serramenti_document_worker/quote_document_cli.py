from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from hashlib import sha256
from pathlib import Path

from .ocr import OCRUnavailableError, ocr_pdf_pages
from .pdf_parser import PDFParseError, parse_pdf

MAX_OCR_PAGES = 30


def extract_quote_document(pdf_bytes: bytes, source_file_name: str) -> dict[str, object]:
    """Extract native text, tables, layout boxes and local OCR from a quote PDF."""
    parsed = parse_pdf(pdf_bytes, source_file_name=source_file_name)
    page_warnings: dict[int, list[str]] = {
        page.page_number: list(page.warnings) for page in parsed.pages
    }
    ocr_by_page: dict[int, dict[str, object]] = {}
    targets = [page.page_number for page in parsed.pages if page.requires_ocr]
    warnings: list[str] = list(parsed.warnings)
    skipped = targets[MAX_OCR_PAGES:]
    if skipped:
        warnings.append(
            f"OCR locale limitata a {MAX_OCR_PAGES} pagine; pagine non elaborate: "
            + ", ".join(str(page) for page in skipped)
            + "."
        )

    for start in range(0, min(len(targets), MAX_OCR_PAGES), 30):
        batch_pages = targets[start : start + 30]
        try:
            result = ocr_pdf_pages(
                pdf_bytes,
                page_numbers=batch_pages,
                language="ita+eng",
                dpi=300,
            )
        except OCRUnavailableError as error:
            warnings.append(f"OCR locale non disponibile: {error}")
            break
        except (PDFParseError, ValueError) as error:
            warnings.append(f"OCR non completata: {error}")
            break

        for page in result.pages:
            ocr_by_page[page.page_number] = asdict(page)
            page_warnings.setdefault(page.page_number, []).extend(page.warnings)

    structured_pages: list[dict[str, object]] = []
    for page in parsed.pages:
        page_ocr = ocr_by_page.get(page.page_number)
        ocr_text = page_ocr.get("text", "") if page_ocr else ""
        native_text = page.text
        merged_text = native_text
        if isinstance(ocr_text, str) and ocr_text.strip():
            if native_text.strip():
                merged_text = f"{native_text}\n\n[OCR locale]\n{ocr_text}"
            else:
                merged_text = ocr_text
        structured_pages.append(
            {
                "page_number": page.page_number,
                "text": merged_text[:24_000],
                "native_text": native_text[:16_000],
                "text_character_count": page.text_character_count,
                "image_count": page.image_count,
                "requires_ocr": page.requires_ocr,
                "tables": [asdict(table) for table in page.tables],
                "ocr": page_ocr,
                "warnings": page_warnings.get(page.page_number, []),
            }
        )

    return {
        "schema_version": 1,
        "source_file_name": source_file_name,
        "sha256": sha256(pdf_bytes).hexdigest(),
        "file_size_bytes": len(pdf_bytes),
        "page_count": parsed.page_count,
        "document_kind": parsed.document_kind,
        "metadata": parsed.metadata,
        "pages": structured_pages,
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Estrae testo, tabelle, coordinate e OCR locale da un PDF di preventivo."
    )
    parser.add_argument("pdf", type=Path, help="Percorso del PDF da analizzare.")
    parser.add_argument("--output", "-o", type=Path, help="File JSON; stdout se omesso.")
    arguments = parser.parse_args()

    try:
        pdf_bytes = arguments.pdf.read_bytes()
        result = extract_quote_document(pdf_bytes, arguments.pdf.name)
    except OSError as error:
        print(f"Impossibile leggere il PDF: {error}", file=sys.stderr)
        return 2
    except (PDFParseError, ValueError) as error:
        print(f"Estrazione non completata: {error}", file=sys.stderr)
        return 2

    serialized = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    if arguments.output:
        try:
            arguments.output.write_text(serialized + "\n", encoding="utf-8")
        except OSError as error:
            print(f"Impossibile salvare il JSON: {error}", file=sys.stderr)
            return 2
        print(f"Risultato dell’estrazione salvato in {arguments.output}")
    else:
        print(serialized)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

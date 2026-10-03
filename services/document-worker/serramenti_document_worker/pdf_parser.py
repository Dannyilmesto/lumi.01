from __future__ import annotations

from dataclasses import asdict, dataclass, field
from hashlib import sha256
from io import BytesIO
import re
import unicodedata
from typing import Literal

import pdfplumber

DocumentKind = Literal['text', 'scanned', 'mixed', 'unreadable']
TableDetection = Literal['lines', 'text_alignment']


class PDFParseError(ValueError):
    """Errore leggibile restituito quando un PDF non può essere elaborato."""


@dataclass(frozen=True, slots=True)
class ParserLimits:
    maximum_file_size_bytes: int = 30 * 1024 * 1024
    maximum_pages: int = 500
    minimum_text_characters: int = 40
    maximum_tables_per_page: int = 100
    maximum_rows_per_table: int = 2_000
    maximum_columns_per_table: int = 100
    maximum_cell_characters: int = 20_000


@dataclass(frozen=True, slots=True)
class ExtractedTable:
    table_number: int
    detection_method: TableDetection
    bounding_box: dict[str, float]
    rows: list[list[str]]
    truncated: bool = False


@dataclass(frozen=True, slots=True)
class ExtractedPage:
    page_number: int
    text: str
    text_character_count: int
    image_count: int
    requires_ocr: bool
    tables: list[ExtractedTable] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class PDFParseResult:
    source_file_name: str
    sha256: str
    file_size_bytes: int
    page_count: int
    document_kind: DocumentKind
    metadata: dict[str, str]
    pages: list[ExtractedPage]
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-ready representation of the extraction."""
        return asdict(self)


def _normalize_text(value: str | None) -> str:
    if not value:
        return ''
    normalized = unicodedata.normalize('NFC', value.replace('\r\n', '\n').replace('\r', '\n'))
    return normalized.strip()


def _normalize_cell(value: object, maximum_length: int) -> tuple[str, bool]:
    if value is None:
        return '', False
    normalized = unicodedata.normalize('NFC', ' '.join(str(value).split()))
    if len(normalized) > maximum_length:
        return normalized[:maximum_length], True
    return normalized, False


def _metadata_fields(metadata: dict[str, object] | None) -> dict[str, str]:
    if not metadata:
        return {}

    fields = {
        'title': 'Title',
        'author': 'Author',
        'subject': 'Subject',
        'creator': 'Creator',
        'producer': 'Producer',
        'creation_date': 'CreationDate',
        'modification_date': 'ModDate',
    }
    result: dict[str, str] = {}
    for output_name, pdf_key in fields.items():
        value = metadata.get(pdf_key)
        if isinstance(value, (str, int, float)):
            cleaned = str(value).strip()
            if cleaned:
                result[output_name] = cleaned[:500]
    return result


def _table_rows(table: object, limits: ParserLimits) -> tuple[list[list[str]], bool]:
    raw_rows = table.extract()  # type: ignore[attr-defined]
    if not raw_rows:
        return [], False

    truncated = len(raw_rows) > limits.maximum_rows_per_table
    rows: list[list[str]] = []
    for raw_row in raw_rows[: limits.maximum_rows_per_table]:
        if raw_row is None:
            rows.append([])
            continue
        if len(raw_row) > limits.maximum_columns_per_table:
            truncated = True
        row: list[str] = []
        for cell in raw_row[: limits.maximum_columns_per_table]:
            normalized, cell_truncated = _normalize_cell(cell, limits.maximum_cell_characters)
            row.append(normalized)
            truncated = truncated or cell_truncated
        rows.append(row)

    return rows, truncated


def _table_bbox(table: object) -> dict[str, float]:
    x0, top, x1, bottom = table.bbox  # type: ignore[attr-defined]
    return {
        'x0': round(float(x0), 2),
        'top': round(float(top), 2),
        'x1': round(float(x1), 2),
        'bottom': round(float(bottom), 2),
    }


def _extract_tables(
    page: pdfplumber.page.Page,
    page_number: int,
    limits: ParserLimits,
) -> tuple[list[ExtractedTable], list[str]]:
    warnings: list[str] = []
    candidates: list[tuple[object, TableDetection]] = []

    try:
        candidates = [(table, 'lines') for table in page.find_tables()]
    except Exception:
        warnings.append(
            f'Pagina {page_number}: errore durante il rilevamento delle tabelle con bordi.'
        )

    extracted: list[ExtractedTable] = []
    for table, detection_method in candidates:
        try:
            rows, truncated = _table_rows(table, limits)
            if any(cell for row in rows for cell in row):
                extracted.append(
                    ExtractedTable(
                        table_number=len(extracted) + 1,
                        detection_method=detection_method,
                        bounding_box=_table_bbox(table),
                        rows=rows,
                        truncated=truncated,
                    )
                )
        except Exception:
            warnings.append(
                f'Pagina {page_number}: una tabella non è stata estratta correttamente.'
            )

    if not extracted:
        try:
            aligned_tables = page.find_tables(
                table_settings={
                    'vertical_strategy': 'text',
                    'horizontal_strategy': 'text',
                }
            )
        except Exception:
            aligned_tables = []
            warnings.append(
                f'Pagina {page_number}: errore durante il rilevamento delle tabelle senza bordi.'
            )

        for table in aligned_tables:
            try:
                rows, truncated = _table_rows(table, limits)
                if any(cell for row in rows for cell in row):
                    extracted.append(
                        ExtractedTable(
                            table_number=len(extracted) + 1,
                            detection_method='text_alignment',
                            bounding_box=_table_bbox(table),
                            rows=rows,
                            truncated=truncated,
                        )
                    )
            except Exception:
                warnings.append(
                    f'Pagina {page_number}: una tabella senza bordi non è stata estratta '
                    'correttamente.'
                )

    if len(extracted) > limits.maximum_tables_per_page:
        extracted = extracted[: limits.maximum_tables_per_page]
        warnings.append(
            f'Pagina {page_number}: il numero di tabelle supera il limite di sicurezza; '
            'i risultati successivi non sono stati inclusi.'
        )

    if any(table.truncated for table in extracted):
        warnings.append(
            f'Pagina {page_number}: almeno una tabella è stata limitata per dimensione; '
            'verificare il PDF originale.'
        )

    return extracted, warnings


def parse_pdf(
    pdf_bytes: bytes,
    source_file_name: str = 'documento.pdf',
    limits: ParserLimits = ParserLimits(),
) -> PDFParseResult:
    """Extract text and candidate tables while preserving original page numbers.

    Scanned or low-text pages are marked for OCR and are never guessed or silently
    treated as successfully parsed.
    """
    if not pdf_bytes:
        raise PDFParseError('Il PDF è vuoto.')
    if len(pdf_bytes) > limits.maximum_file_size_bytes:
        raise PDFParseError('Il PDF supera il limite di 30 MB previsto dal parser.')
    if b'%PDF-' not in pdf_bytes[:1024]:
        raise PDFParseError('Il file non ha una firma PDF valida.')

    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            page_count = len(pdf.pages)
            if page_count == 0:
                raise PDFParseError('Il PDF non contiene pagine.')
            if page_count > limits.maximum_pages:
                raise PDFParseError(
                    f'Il PDF contiene {page_count} pagine; il limite attuale è '
                    f'{limits.maximum_pages}.'
                )

            extracted_pages: list[ExtractedPage] = []
            for page in pdf.pages:
                page_number = page.page_number
                warnings: list[str] = []
                try:
                    text = _normalize_text(page.extract_text(layout=False))
                    image_count = len(page.images)
                except Exception:
                    text = ''
                    image_count = 0
                    warnings.append(
                        f'Pagina {page_number}: il testo o le immagini non sono stati letti '
                        'correttamente.'
                    )

                character_count = len(re.sub(r'\s+', '', text))
                requires_ocr = character_count < limits.minimum_text_characters
                if requires_ocr:
                    if image_count:
                        warnings.append(
                            f'Pagina {page_number}: poco testo digitale e immagini presenti; '
                            'la pagina è candidata all’OCR.'
                        )
                    else:
                        warnings.append(
                            f'Pagina {page_number}: poco testo digitale; consigliati OCR o '
                            'controllo manuale.'
                        )

                tables, table_warnings = _extract_tables(page, page_number, limits)
                warnings.extend(table_warnings)
                extracted_pages.append(
                    ExtractedPage(
                        page_number=page_number,
                        text=text,
                        text_character_count=character_count,
                        image_count=image_count,
                        requires_ocr=requires_ocr,
                        tables=tables,
                        warnings=warnings,
                    )
                )

            readable_pages = [
                page.text_character_count >= limits.minimum_text_characters
                for page in extracted_pages
            ]
            if all(readable_pages):
                document_kind: DocumentKind = 'text'
            elif any(readable_pages):
                document_kind = 'mixed'
            elif any(page.image_count for page in extracted_pages):
                document_kind = 'scanned'
            else:
                document_kind = 'unreadable'

            return PDFParseResult(
                source_file_name=source_file_name,
                sha256=sha256(pdf_bytes).hexdigest(),
                file_size_bytes=len(pdf_bytes),
                page_count=page_count,
                document_kind=document_kind,
                metadata=_metadata_fields(pdf.metadata),
                pages=extracted_pages,
                warnings=[],
            )
    except PDFParseError:
        raise
    except Exception as error:
        raise PDFParseError(
            'PDF danneggiato, non leggibile o protetto da password. '
            'Controlla il documento originale.'
        ) from error

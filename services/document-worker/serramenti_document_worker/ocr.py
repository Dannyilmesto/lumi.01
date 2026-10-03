from __future__ import annotations

from dataclasses import asdict, dataclass, field
from hashlib import sha256
from io import BytesIO
import math
import re
import unicodedata
from typing import Literal

import pdfplumber
import pypdfium2 as pdfium
import pytesseract
from pytesseract import Output, TesseractError, TesseractNotFoundError

from .pdf_parser import ParserLimits

OCRPageStatus = Literal['completed', 'needs_review', 'failed']


class OCRUnavailableError(RuntimeError):
    """Tesseract or one of the requested language models is unavailable."""


@dataclass(frozen=True, slots=True)
class OCRWord:
    text: str
    confidence: float
    bounding_box: dict[str, float]


@dataclass(frozen=True, slots=True)
class OCRPageResult:
    page_number: int
    status: OCRPageStatus
    text: str
    average_confidence: float | None
    words: list[OCRWord] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class OCRResult:
    sha256: str
    file_size_bytes: int
    page_count: int
    language: str
    dpi: int
    pages: list[OCRPageResult]

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-ready representation of OCR output."""
        return asdict(self)


def _validate_languages(language: str) -> None:
    if not re.fullmatch(r'[a-zA-Z0-9_+-]+', language):
        raise ValueError('Codice lingua non valido.')

    requested = set(language.lower().split('+'))
    if '' in requested:
        raise ValueError('Elenco delle lingue OCR non valido.')

    try:
        available = {code.lower() for code in pytesseract.get_languages(config='')}
    except TesseractNotFoundError as error:
        raise OCRUnavailableError(
            'Tesseract non è installato o non è nel PATH. Su macOS esegui: '
            'brew install tesseract tesseract-lang'
        ) from error
    except TesseractError as error:
        raise OCRUnavailableError(
            'Non riesco a leggere le lingue installate di Tesseract.'
        ) from error

    missing = sorted(requested - available)
    if missing:
        missing_list = ', '.join(missing)
        raise OCRUnavailableError(
            f'Mancano i modelli linguistici: {missing_list}. '
            'Su macOS installa le lingue aggiuntive con: brew install tesseract-lang'
        )


def _page_text_and_words(
    data: dict[str, list[str | int | float]],
    width_points: float,
    height_points: float,
    rotation: int,
    bitmap_width: int,
    bitmap_height: int,
) -> tuple[str, list[OCRWord], float | None]:
    coordinate_width, coordinate_height = width_points, height_points
    if rotation in (90, 270):
        coordinate_width, coordinate_height = height_points, width_points

    x_scale = coordinate_width / max(bitmap_width, 1)
    y_scale = coordinate_height / max(bitmap_height, 1)
    grouped_lines: dict[tuple[int, int, int], list[str]] = {}
    words: list[OCRWord] = []
    confidences: list[float] = []

    count = len(data.get('text', []))
    for index in range(count):
        text = unicodedata.normalize('NFC', str(data['text'][index])).strip()
        if not text:
            continue

        try:
            confidence = float(data['conf'][index])
        except (KeyError, TypeError, ValueError):
            continue
        if confidence < 0:
            continue

        block = int(data['block_num'][index])
        paragraph = int(data['par_num'][index])
        line = int(data['line_num'][index])
        grouped_lines.setdefault((block, paragraph, line), []).append(text)

        left = int(data['left'][index])
        top = int(data['top'][index])
        width = int(data['width'][index])
        height = int(data['height'][index])
        words.append(
            OCRWord(
                text=text,
                confidence=round(confidence, 2),
                bounding_box={
                    'x0': round(left * x_scale, 2),
                    'top': round(top * y_scale, 2),
                    'x1': round((left + width) * x_scale, 2),
                    'bottom': round((top + height) * y_scale, 2),
                },
            )
        )
        confidences.append(confidence)

    text = '\n'.join(' '.join(tokens) for tokens in grouped_lines.values())
    average_confidence = (
        round(sum(confidences) / len(confidences), 2) if confidences else None
    )
    return text, words, average_confidence


def ocr_pdf_pages(
    pdf_bytes: bytes,
    page_numbers: list[int],
    language: str = 'ita+eng',
    dpi: int = 300,
    limits: ParserLimits = ParserLimits(),
    maximum_pages_per_run: int = 30,
    maximum_pixels_per_page: int = 40_000_000,
    review_confidence_threshold: float = 60.0,
) -> OCRResult:
    """OCR only the requested one-based page numbers and return text plus word boxes.

    Text returned by OCR is a candidate extraction, never a verified product or price.
    Process large documents in batches to keep memory and CPU usage bounded.
    """
    if not pdf_bytes:
        raise ValueError('Il PDF è vuoto.')
    if len(pdf_bytes) > limits.maximum_file_size_bytes:
        raise ValueError('Il PDF supera il limite di 30 MB previsto dal parser.')
    if b'%PDF-' not in pdf_bytes[:1024]:
        raise ValueError('Il file non ha una firma PDF valida.')
    if not 72 <= dpi <= 400:
        raise ValueError('La risoluzione OCR deve essere compresa tra 72 e 400 DPI.')
    if not 0 <= review_confidence_threshold <= 100:
        raise ValueError('La soglia di confidenza deve essere tra 0 e 100.')

    requested_pages = list(dict.fromkeys(page_numbers))
    if not requested_pages:
        raise ValueError('Indica almeno una pagina da sottoporre a OCR.')
    if len(requested_pages) > maximum_pages_per_run:
        raise ValueError(
            f'È possibile elaborare al massimo {maximum_pages_per_run} pagine per esecuzione.'
        )
    if any(not isinstance(number, int) or number < 1 for number in requested_pages):
        raise ValueError('I numeri di pagina devono essere interi positivi (partendo da 1).')

    _validate_languages(language)

    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as text_pdf:
            page_count = len(text_pdf.pages)
        if page_count == 0:
            raise ValueError('Il PDF non contiene pagine.')
        if page_count > limits.maximum_pages:
            raise ValueError(
                f'Il PDF contiene {page_count} pagine; il limite attuale è {limits.maximum_pages}.'
            )
        if any(number > page_count for number in requested_pages):
            raise ValueError(f'Il PDF contiene {page_count} pagine; verifica la selezione.')

        document = pdfium.PdfDocument(pdf_bytes)
    except ValueError:
        raise
    except Exception as error:
        raise ValueError('Il PDF è danneggiato, non leggibile o protetto da password.') from error

    results: list[OCRPageResult] = []
    try:
        for page_number in requested_pages:
            page = None
            bitmap = None
            image = None
            try:
                page = document[page_number - 1]
                width_points, height_points = page.get_size()
                scale = dpi / 72
                estimated_width = math.ceil(width_points * scale)
                estimated_height = math.ceil(height_points * scale)
                if estimated_width * estimated_height > maximum_pixels_per_page:
                    raise ValueError('La pagina è troppo grande alla risoluzione OCR selezionata.')

                bitmap = page.render(scale=scale, grayscale=True, rev_byteorder=True)
                image = bitmap.to_pil()
                data = pytesseract.image_to_data(
                    image,
                    lang=language,
                    config='--oem 3 --psm 6',
                    output_type=Output.DICT,
                )
                text, words, average_confidence = _page_text_and_words(
                    data,
                    width_points,
                    height_points,
                    page.get_rotation(),
                    bitmap.width,
                    bitmap.height,
                )

                warnings: list[str] = []
                if average_confidence is None:
                    status: OCRPageStatus = 'needs_review'
                    warnings.append(f'Pagina {page_number}: OCR senza parole riconosciute.')
                elif average_confidence < review_confidence_threshold:
                    status = 'needs_review'
                    warnings.append(
                        f'Pagina {page_number}: confidenza OCR bassa '
                        f'({average_confidence}%). Verificare il testo sul PDF originale.'
                    )
                else:
                    status = 'completed'

                results.append(
                    OCRPageResult(
                        page_number=page_number,
                        status=status,
                        text=text,
                        average_confidence=average_confidence,
                        words=words,
                        warnings=warnings,
                    )
                )
            except (TesseractNotFoundError, TesseractError) as error:
                raise OCRUnavailableError(
                    'Tesseract non è disponibile o non riesce a elaborare la pagina. '
                    'Su macOS installa Tesseract e le lingue con: '
                    'brew install tesseract tesseract-lang'
                ) from error
            except Exception as error:
                results.append(
                    OCRPageResult(
                        page_number=page_number,
                        status='failed',
                        text='',
                        average_confidence=None,
                        warnings=[f'Pagina {page_number}: OCR non completata ({error}).'],
                    )
                )
            finally:
                if image is not None:
                    image.close()
                if bitmap is not None:
                    bitmap.close()
                if page is not None:
                    page.close()
    finally:
        document.close()

    return OCRResult(
        sha256=sha256(pdf_bytes).hexdigest(),
        file_size_bytes=len(pdf_bytes),
        page_count=page_count,
        language=language,
        dpi=dpi,
        pages=results,
    )

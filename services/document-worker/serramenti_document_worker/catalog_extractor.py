from __future__ import annotations

from dataclasses import asdict, dataclass, field
from hashlib import sha256
from io import BytesIO
import re
from typing import Literal

import pdfplumber

CandidateKind = Literal[
    'base_price',
    'surcharge',
    'discount',
    'percentage_rule',
    'shipping_or_packaging',
    'unclassified_amount',
]

ReviewStatus = Literal['needs_review']

_MONEY_RE = re.compile(
    r'(?P<sign>[+-])?\s*(?P<currency>€\s*)?'
    r'(?P<amount>(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})(?!\d)'
)
_PERCENT_RE = re.compile(r'(?P<sign>[+-])?\s*(?P<amount>\d+(?:,\d+)?)\s*%')
_BROKEN_AMOUNT_RE = re.compile(r'\b\d\s+\d{2,3},\d{2}\b')
_FINISH_CODE_RE = re.compile(r'\bLAM\d{2,5}(?:[A-Z]{1,4})?\b', re.IGNORECASE)
_MODEL_RE = re.compile(
    r'\b(?:CLASSIC|EVOLUTION|GLASSY|BEAUTY|FASHION|MEETING|MIRROR|'
    r'BICOLOR|BILINE|BRILLIANT)\s+\d{1,3}[A-Z]?\b',
    re.IGNORECASE,
)
_DIMENSION_RE = re.compile(r'\b\d{2,3}\s*[x×]\s*\d{2,3}(?:\s*[x×]\s*\d{2,3})?\b')
_PRICE_HEADER_RE = re.compile(r'€|\b(?:COSTO|PREZZO|IMPORTO|TARIFFA)\b', re.IGNORECASE)
_SHIPPING_RE = re.compile(r'TRASPORT|CONSEGNA|IMBALLAGGIO|BANCALE', re.IGNORECASE)
_DISCOUNT_RE = re.compile(r'RIDUZIONE|SCONTO|DETRAZIONE', re.IGNORECASE)
_SURCHARGE_RE = re.compile(
    r'SUPPLEMENTO|MAGGIORAZIONE|TRASFORMAZIONE|ACCESSORI EXTRA|\bEXTRA\b|\bAUMENTO\b',
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class CandidateAmount:
    raw: str
    value: str
    currency: str
    # 1 means explicitly prefixed with +, -1 with -, and 0 means no sign was printed.
    sign: int


@dataclass(frozen=True, slots=True)
class CandidatePercentage:
    raw: str
    value: str
    # 1 means explicitly prefixed with +, -1 with -, and 0 means no sign was printed.
    sign: int


@dataclass(frozen=True, slots=True)
class CatalogCandidate:
    candidate_id: str
    kind: CandidateKind
    review_status: ReviewStatus
    pdf_page_number: int
    printed_page_number: int | None
    section_label: str
    source_excerpt: str
    bounding_box: dict[str, float]
    finish_code_candidates: list[str] = field(default_factory=list)
    model_candidates: list[str] = field(default_factory=list)
    dimension_candidates: list[str] = field(default_factory=list)
    amounts: list[CandidateAmount] = field(default_factory=list)
    percentages: list[CandidatePercentage] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class CatalogExtractionResult:
    schema_version: int
    source_file_name: str
    sha256: str
    file_size_bytes: int
    page_count: int
    candidates: list[CatalogCandidate]
    pages_with_little_text: list[int]
    pages_with_images_and_little_text: list[int]
    pages_ocr_completed: list[int] = field(default_factory=list)
    pages_ocr_needs_review: list[int] = field(default_factory=list)
    pages_ocr_not_processed: list[int] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-ready extraction that preserves evidence and review state."""
        return asdict(self)


def _group_word_lines(
    words: list[dict[str, object]], tolerance: float = 4.5
) -> list[list[dict[str, object]]]:
    ordered = sorted(words, key=lambda word: (float(word['top']), float(word['x0'])))
    lines: list[list[dict[str, object]]] = []

    for word in ordered:
        word_top = float(word['top'])
        last_line = lines[-1] if lines else None
        line_top = (
            sum(float(item['top']) for item in last_line) / len(last_line)
            if last_line
            else 0.0
        )
        if last_line is None or abs(word_top - line_top) > tolerance:
            lines.append([word])
        else:
            last_line.append(word)

    return [sorted(line, key=lambda word: float(word['x0'])) for line in lines]


def _line_text(words: list[dict[str, object]]) -> str:
    return ' '.join(str(word['text']) for word in words).strip()


def _section_label(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines[:8]:
        normalized = re.sub(r'\s+', ' ', line).strip(' -|')
        if not normalized or normalized.upper() in {'LAMINATO', 'INDICE'}:
            continue
        return normalized[:160]
    return ''


def _printed_page_number(
    words: list[dict[str, object]], page_width: float, page_height: float
) -> int | None:
    footer_numbers = [
        int(str(word['text']))
        for word in words
        if str(word['text']).isdigit()
        and float(word['top']) >= page_height - 50
        and (float(word['x0']) <= 35 or float(word['x0']) >= page_width - 35)
    ]
    return footer_numbers[0] if len(footer_numbers) == 1 else None


def _has_local_price_context(
    line_words: list[dict[str, object]],
    price_headers: list[tuple[float, float, float]],
    maximum_vertical_distance: float = 260,
    horizontal_padding: float = 125,
) -> bool:
    line_top = min(float(word['top']) for word in line_words)
    line_x0 = min(float(word['x0']) for word in line_words)
    line_x1 = max(float(word['x1']) for word in line_words)

    for header_top, header_x0, header_x1 in price_headers:
        vertical_distance = line_top - header_top
        if not -8 <= vertical_distance <= maximum_vertical_distance:
            continue
        if line_x1 < header_x0 - horizontal_padding:
            continue
        if line_x0 > header_x1 + horizontal_padding:
            continue
        return True
    return False


def _extract_amounts(line: str, local_price_context: bool) -> list[CandidateAmount]:
    if _BROKEN_AMOUNT_RE.search(line):
        return []

    amounts: list[CandidateAmount] = []
    for match in _MONEY_RE.finditer(line):
        # A sign is a strong local cue for a surcharge or discount. Unsigned
        # amounts need their own € marker or a nearby price-column heading.
        if not match.group('currency') and not match.group('sign') and not local_price_context:
            continue
        raw_amount = match.group('amount')
        normalized = raw_amount.replace('.', '').replace(',', '.')
        sign = -1 if match.group('sign') == '-' else 1 if match.group('sign') == '+' else 0
        if match.group('sign') == '-':
            normalized = f'-{normalized}'
        amounts.append(
            CandidateAmount(
                raw=match.group(0).strip(),
                value=normalized,
                currency='EUR',
                sign=sign,
            )
        )
    return amounts


def _extract_percentages(line: str) -> list[CandidatePercentage]:
    percentages: list[CandidatePercentage] = []
    for match in _PERCENT_RE.finditer(line):
        value = match.group('amount').replace(',', '.')
        sign = -1 if match.group('sign') == '-' else 1 if match.group('sign') == '+' else 0
        if sign < 0:
            value = f'-{value}'
        percentages.append(
            CandidatePercentage(
                raw=match.group(0).strip(),
                value=value,
                sign=sign,
            )
        )
    return percentages


def _candidate_kind(
    line: str,
    section: str,
    amounts: list[CandidateAmount],
    percentages: list[CandidatePercentage],
    model_candidates: list[str],
    finish_codes: list[str],
    local_price_context: bool,
) -> CandidateKind:
    context = f'{section} {line}'
    if _SHIPPING_RE.search(context):
        return 'shipping_or_packaging'
    if percentages:
        return 'percentage_rule'
    if any(amount.sign == -1 for amount in amounts):
        return 'discount'
    if any(amount.sign == 1 for amount in amounts):
        return 'surcharge'
    if _DISCOUNT_RE.search(context):
        return 'discount'
    if _SURCHARGE_RE.search(context):
        return 'surcharge'
    if amounts and (model_candidates or finish_codes or local_price_context):
        return 'base_price'
    return 'unclassified_amount'


def extract_catalog_candidates(
    pdf_bytes: bytes,
    source_file_name: str,
    maximum_file_size_bytes: int = 30 * 1024 * 1024,
    maximum_pages: int = 500,
    minimum_searchable_characters: int = 40,
    maximum_ocr_pages: int = 30,
) -> CatalogExtractionResult:
    """Extract literal price-like candidates from PDF text, preserving page evidence.

    This stage does not activate products or price rules. Every candidate requires human review.
    Low-text pages are passed to local Tesseract OCR when it is installed; OCR results keep
    their confidence warning and never become verified prices.
    """
    if not pdf_bytes:
        raise ValueError('Il PDF è vuoto.')
    if len(pdf_bytes) > maximum_file_size_bytes:
        raise ValueError('Il PDF supera il limite di 30 MB previsto dal parser.')
    if b'%PDF-' not in pdf_bytes[:1024]:
        raise ValueError('Il file non ha una firma PDF valida.')

    document_hash = sha256(pdf_bytes).hexdigest()
    candidates: list[CatalogCandidate] = []
    pages_with_little_text: list[int] = []
    pages_with_images_and_little_text: list[int] = []
    page_contexts: list[dict[str, object]] = []
    extraction_warnings: list[str] = []
    pages_ocr_completed: list[int] = []
    pages_ocr_needs_review: list[int] = []
    ocr_page_limit = max(0, min(maximum_ocr_pages, 30))

    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            page_count = len(pdf.pages)
            if page_count == 0:
                raise ValueError('Il PDF non contiene pagine.')
            if page_count > maximum_pages:
                raise ValueError(
                    f'Il PDF contiene {page_count} pagine; il limite attuale è {maximum_pages}.'
                )

            for page_number, page in enumerate(pdf.pages, 1):
                text = page.extract_text(layout=False) or ''
                searchable_characters = len(re.sub(r'\s+', '', text))
                if searchable_characters < minimum_searchable_characters:
                    pages_with_little_text.append(page_number)
                    if page.images:
                        pages_with_images_and_little_text.append(page_number)

                words = page.extract_words(x_tolerance=2, y_tolerance=3)
                section = _section_label(text)
                printed_page = _printed_page_number(words, page.width, page.height)
                page_contexts.append(
                    {
                        'page_number': page_number,
                        'text': text,
                        'words': words,
                        'section': section,
                        'printed_page': printed_page,
                        'page_width': float(page.width),
                        'page_height': float(page.height),
                    }
                )

        ocr_targets = pages_with_little_text[:ocr_page_limit]
        pages_ocr_not_processed = pages_with_little_text[ocr_page_limit:]
        ocr_words_by_page: dict[int, list[dict[str, object]]] = {}
        ocr_context_by_page: dict[int, str] = {}
        if ocr_targets:
            try:
                from .ocr import OCRUnavailableError, ocr_pdf_pages
            except ImportError:
                extraction_warnings.append(
                    'Librerie OCR non installate; le pagine a basso testo restano da '
                    'controllare nel PDF originale.'
                )
            else:
                try:
                    for batch_start in range(0, len(ocr_targets), 30):
                        batch = ocr_pdf_pages(
                            pdf_bytes,
                            page_numbers=ocr_targets[batch_start : batch_start + 30],
                            language='ita+eng',
                            dpi=300,
                        )
                        for ocr_page in batch.pages:
                            if ocr_page.status == 'failed' or not ocr_page.words:
                                extraction_warnings.extend(ocr_page.warnings)
                                continue
                            ocr_words_by_page[ocr_page.page_number] = [
                                {
                                    'text': word.text,
                                    **word.bounding_box,
                                    'confidence': word.confidence,
                                }
                                for word in ocr_page.words
                            ]
                            ocr_context_by_page[ocr_page.page_number] = (
                                f'OCR locale; confidenza media {ocr_page.average_confidence}%'
                                if ocr_page.average_confidence is not None
                                else 'OCR locale; confidenza non disponibile'
                            )
                            if ocr_page.status == 'completed':
                                pages_ocr_completed.append(ocr_page.page_number)
                            else:
                                pages_ocr_needs_review.append(ocr_page.page_number)
                            extraction_warnings.extend(ocr_page.warnings)
                except OCRUnavailableError as error:
                    extraction_warnings.append(
                        f'OCR non disponibile: {error}. Le pagine a basso testo restano da '
                        'controllare nel PDF originale.'
                    )
                except Exception:
                    extraction_warnings.append(
                        'OCR non completata per un errore tecnico. Le pagine a basso testo '
                        'restano da controllare nel PDF originale.'
                    )

        if pages_ocr_not_processed:
            extraction_warnings.append(
                f'OCR limitata alle prime {ocr_page_limit} pagine a basso testo; '
                f'{len(pages_ocr_not_processed)} pagina/e non elaborate.'
            )

        for page_context in page_contexts:
            page_number = int(page_context['page_number'])
            section = str(page_context['section'])
            printed_page = page_context['printed_page']
            words = ocr_words_by_page.get(page_number) or page_context['words']
            ocr_context = ocr_context_by_page.get(page_number)
            text_lines = _group_word_lines(words)  # type: ignore[arg-type]
            if ocr_context:
                ocr_text = '\n'.join(_line_text(line_words) for line_words in text_lines)
                if not section:
                    section = _section_label(ocr_text)
                if printed_page is None:
                    printed_page = _printed_page_number(
                        words,  # type: ignore[arg-type]
                        float(page_context['page_width']),
                        float(page_context['page_height']),
                    )
            price_headers = [
                (
                    min(float(word['top']) for word in line_words),
                    min(float(word['x0']) for word in line_words),
                    max(float(word['x1']) for word in line_words),
                )
                for line_words in text_lines
                if _PRICE_HEADER_RE.search(_line_text(line_words))
            ]

            for line_number, line_words in enumerate(text_lines, 1):
                line = _line_text(line_words)
                local_price_context = _has_local_price_context(line_words, price_headers)
                amounts = _extract_amounts(line, local_price_context)
                percentages = _extract_percentages(line)
                malformed_amount = bool(_BROKEN_AMOUNT_RE.search(line))
                if not amounts and not percentages and not malformed_amount:
                    continue

                finish_codes = sorted(set(_FINISH_CODE_RE.findall(line.upper())))
                model_candidates = sorted(
                    {match.upper() for match in _MODEL_RE.findall(line)}
                )
                dimensions = sorted(set(_DIMENSION_RE.findall(line)))
                kind = _candidate_kind(
                    line,
                    section,
                    amounts,
                    percentages,
                    model_candidates,
                    finish_codes,
                    local_price_context,
                )

                x0 = min(float(word['x0']) for word in line_words)
                top = min(float(word['top']) for word in line_words)
                x1 = max(float(word['x1']) for word in line_words)
                bottom = max(float(word['bottom']) for word in line_words)
                warnings = [
                    'Candidato letterale: verificare il modello, le intestazioni e le '
                    'condizioni sulla pagina originale prima di usarlo come prezzo.'
                ]
                if malformed_amount:
                    warnings.append(
                        'Il testo del possibile importo appare spezzato; nessun valore è '
                        'stato normalizzato.'
                    )
                if any('€' not in amount.raw for amount in amounts):
                    warnings.append(
                        'Importo senza simbolo € sulla riga; il collegamento deriva da un '
                        'intestazione vicina o dal segno +/− e va controllato.'
                    )
                if len(amounts) > 1:
                    warnings.append(
                        'La riga contiene più importi; verificare la corrispondenza con le '
                        'intestazioni delle colonne.'
                    )
                if not model_candidates and not finish_codes:
                    warnings.append(
                        'Nessun codice o modello esplicito sulla riga; il contesto della '
                        'tabella può determinarne l’ambito.'
                    )
                if ocr_context:
                    warnings.append(ocr_context + '; confrontare la riga con il PDF originale.')
                    confidences = [
                        float(word['confidence'])
                        for word in line_words
                        if isinstance(word.get('confidence'), (int, float))
                    ]
                    if confidences and min(confidences) < 60:
                        warnings.append(
                            'Almeno una parola della riga ha confidenza OCR inferiore al '
                            '60%; verificare manualmente.'
                        )

                source_method = 'ocr' if ocr_context else 'text'
                stable_key = (
                    f'{document_hash}:{source_method}:{page_number}:{line_number}:{line}'
                )
                candidates.append(
                    CatalogCandidate(
                        candidate_id=sha256(stable_key.encode('utf-8')).hexdigest()[:24],
                        kind=kind,
                        review_status='needs_review',
                        pdf_page_number=page_number,
                        printed_page_number=printed_page,  # type: ignore[arg-type]
                        section_label=section,
                        source_excerpt=line[:1_000],
                        bounding_box={
                            'x0': round(x0, 2),
                            'top': round(top, 2),
                            'x1': round(x1, 2),
                            'bottom': round(bottom, 2),
                        },
                        finish_code_candidates=finish_codes,
                        model_candidates=model_candidates,
                        dimension_candidates=dimensions,
                        amounts=amounts,
                        percentages=percentages,
                        warnings=warnings,
                    )
                )
    except ValueError:
        raise
    except Exception as error:
        raise ValueError(
            'Il PDF è danneggiato, non leggibile o protetto da password.'
        ) from error

    warnings = [
        'I record estratti sono proposte da verificare, non prodotti o regole approvati.'
    ]
    if pages_with_little_text:
        warnings.append(
            'Pagine con poco testo digitale; verificare se sono pagine vuote/grafiche o se '
            'richiedono '
            'OCR: '
            + ', '.join(str(page) for page in pages_with_little_text)
        )
    warnings.extend(extraction_warnings)

    return CatalogExtractionResult(
        schema_version=2,
        source_file_name=source_file_name,
        sha256=document_hash,
        file_size_bytes=len(pdf_bytes),
        page_count=page_count,
        candidates=candidates,
        pages_with_little_text=pages_with_little_text,
        pages_with_images_and_little_text=pages_with_images_and_little_text,
        pages_ocr_completed=pages_ocr_completed,
        pages_ocr_needs_review=pages_ocr_needs_review,
        pages_ocr_not_processed=pages_ocr_not_processed,
        warnings=warnings,
    )

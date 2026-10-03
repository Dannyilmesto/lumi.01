from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .ocr import OCRUnavailableError, ocr_pdf_pages
from .pdf_parser import PDFParseError, parse_pdf


def _page_numbers(value: str) -> list[int]:
    try:
        numbers = [int(part.strip()) for part in value.split(',') if part.strip()]
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            'Usa numeri pagina separati da virgole, per esempio 2,5.'
        ) from error
    if not numbers:
        raise argparse.ArgumentTypeError('Indica almeno un numero di pagina.')
    return numbers


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Esegue OCR locale sulle pagine indicate o candidate OCR dal parser PDF.'
    )
    parser.add_argument('pdf', type=Path, help='Percorso del PDF da elaborare.')
    parser.add_argument(
        '--pages',
        type=_page_numbers,
        help=(
            'Numeri di pagina, da 1, separati da virgole. Se omesso usa le pagine candidate OCR.'
        ),
    )
    parser.add_argument(
        '--language',
        default='ita+eng',
        help='Lingue Tesseract, ad esempio ita+eng.',
    )
    parser.add_argument(
        '--dpi',
        type=int,
        default=300,
        help='Risoluzione di rendering (72–400; predefinita 300).',
    )
    parser.add_argument(
        '--output',
        '-o',
        type=Path,
        help='File JSON di destinazione; stdout se omesso.',
    )
    arguments = parser.parse_args()

    try:
        pdf_bytes = arguments.pdf.read_bytes()
        page_numbers = arguments.pages
        if page_numbers is None:
            parsed = parse_pdf(pdf_bytes, source_file_name=arguments.pdf.name)
            page_numbers = [page.page_number for page in parsed.pages if page.requires_ocr]
        if not page_numbers:
            print('Il parser non ha trovato pagine candidate OCR.')
            return 0

        result = ocr_pdf_pages(
            pdf_bytes,
            page_numbers=page_numbers,
            language=arguments.language,
            dpi=arguments.dpi,
        )
    except OSError as error:
        print(f'Impossibile leggere il PDF: {error}', file=sys.stderr)
        return 2
    except (PDFParseError, OCRUnavailableError, ValueError) as error:
        print(f'OCR non completata: {error}', file=sys.stderr)
        return 2

    serialized = json.dumps(result.to_dict(), ensure_ascii=False, indent=2)
    if arguments.output:
        try:
            arguments.output.write_text(serialized + '\n', encoding='utf-8')
        except OSError as error:
            print(f'Impossibile salvare il JSON: {error}', file=sys.stderr)
            return 2
        print(f'Risultato OCR salvato in {arguments.output}')
    else:
        print(serialized)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

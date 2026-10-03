from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .pdf_parser import PDFParseError, parse_pdf


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Estrae testo e tabelle da un PDF di listino senza applicare OCR.'
    )
    parser.add_argument('pdf', type=Path, help='Percorso del PDF da analizzare.')
    parser.add_argument(
        '--output',
        '-o',
        type=Path,
        help='File JSON di destinazione. Se omesso, il risultato viene scritto su stdout.',
    )
    arguments = parser.parse_args()

    try:
        result = parse_pdf(arguments.pdf.read_bytes(), source_file_name=arguments.pdf.name)
    except OSError as error:
        print(f'Impossibile leggere il file: {error}', file=sys.stderr)
        return 2
    except PDFParseError as error:
        print(f'PDF non analizzato: {error}', file=sys.stderr)
        return 2

    serialized = json.dumps(result.to_dict(), ensure_ascii=False, indent=2)
    if arguments.output:
        try:
            arguments.output.write_text(serialized + '\n', encoding='utf-8')
        except OSError as error:
            print(f'Impossibile salvare il JSON: {error}', file=sys.stderr)
            return 2
        print(f'Risultato salvato in {arguments.output}')
    else:
        print(serialized)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

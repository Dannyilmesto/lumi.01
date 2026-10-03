from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .catalog_extractor import extract_catalog_candidates


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Estrae candidati di prezzi e maggiorazioni da un PDF, da verificare.'
    )
    parser.add_argument('pdf', type=Path, help='Percorso del PDF da elaborare.')
    parser.add_argument(
        '--output',
        '-o',
        type=Path,
        help='File JSON di destinazione; stdout se omesso.',
    )
    arguments = parser.parse_args()

    try:
        pdf_bytes = arguments.pdf.read_bytes()
        result = extract_catalog_candidates(pdf_bytes, source_file_name=arguments.pdf.name)
    except OSError as error:
        print(f'Impossibile leggere il PDF: {error}', file=sys.stderr)
        return 2
    except ValueError as error:
        print(f'Estrazione non completata: {error}', file=sys.stderr)
        return 2

    serialized = json.dumps(result.to_dict(), ensure_ascii=False, indent=2)
    if arguments.output:
        try:
            arguments.output.write_text(serialized + '\n', encoding='utf-8')
        except OSError as error:
            print(f'Impossibile salvare il JSON: {error}', file=sys.stderr)
            return 2
        print(f"Candidati estratti: {len(result.candidates)} (tutti da verificare).")
        print(f'Risultato salvato in {arguments.output}')
    else:
        print(serialized)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

# Document worker

Strumenti Python locali per leggere PDF di listini. Il parser conserva il testo separato per pagina,
individua tabelle candidate con le relative coordinate, calcola SHA-256 e segnala le pagine che
probabilmente richiederanno OCR. L'OCR estrae testo e coordinate delle singole parole con un valore
di confidenza. Nessuno dei due strumenti interpreta o approva i prezzi: i risultati sono candidati
da verificare sul PDF originale.

## Installazione

Dalla cartella principale del progetto, installa Tesseract e i modelli italiano/inglese una volta:

```sh
brew install tesseract tesseract-lang
tesseract --list-langs
```

Nell'elenco devono comparire `ita` ed `eng`. Poi installa le librerie Python:

```sh
cd services/document-worker
uv sync
```

## Analizzare un PDF

```sh
uv run python -m serramenti_document_worker.cli /percorso/al/listino.pdf --output /tmp/listino-estratto.json
```

Se ometti `--output`, il JSON viene scritto nel Terminale. Il risultato contiene testo e tabelle per
ogni pagina, un hash SHA-256, i metadati PDF disponibili, la classificazione (`text`, `scanned`,
`mixed` o `unreadable`) e avvisi per pagine con poco testo digitale. La rilevazione segnala le pagine
candidate all'OCR.

## Eseguire l'OCR

Per elaborare automaticamente solo le pagine che il parser ha segnalato come candidate:

```sh
uv run python -m serramenti_document_worker.ocr_cli /percorso/al/listino.pdf \
  --output /tmp/listino-ocr.json
```

Per scegliere le pagine manualmente, usa `--pages` con numeri a partire da 1, separati da virgole:

```sh
uv run python -m serramenti_document_worker.ocr_cli /percorso/al/listino.pdf \
  --pages 2,3 --language ita+eng --output /tmp/listino-ocr.json
```

Ogni esecuzione elabora al massimo 30 pagine. Il JSON riporta il testo, le parole con coordinate in
punti PDF, la confidenza media e lo stato della pagina; risultati a bassa confidenza richiedono
revisione. La risoluzione predefinita è 300 DPI.

## Estrarre i candidati del listino

L'estrazione individua importi, percentuali, codici e misure usando il testo delle righe e le
intestazioni vicine per gli importi senza simbolo euro. Evita di estendere il contesto monetario a
tutta la pagina. Ogni risultato conserva pagina PDF, riquadro della riga e testo originale.
Tutti i risultati restano `needs_review`: l'estrazione non crea prodotti attivi e
non collega importi a colonne quando la tabella è ambigua.

```sh
uv run python -m serramenti_document_worker.catalog_cli /percorso/al/listino.pdf \
  --output /tmp/listino-candidati.json
```

Le pagine con poco testo digitale vengono sottoposte a OCR locale se Tesseract e i modelli ita/eng
sono installati. Ogni analisi elabora al massimo 30 pagine a basso testo e conserva gli avvisi e la
confidenza OCR. Con Tesseract mancante, i candidati testuali restano disponibili e le pagine
interessate vengono segnalate per controllo manuale. Nell'app web carica un listino e premi
**Analizza PDF** nell'archivio: il worker locale salva candidati, coordinate e avvertenze.
Apri **Apri revisione** per confermare la lettura di una riga o escluderla. La conferma non crea né
attiva un prezzo; serve a verificare le righe prima della futura associazione a prodotti e listini.
I listini non ancora revisionati col parser precedente possono essere aggiornati con **Aggiorna
analisi**. Le righe già confermate o escluse vengono protette.

## Assistente preventivi

Da **Dashboard → Preventivi** crea una bozza e detta o scrivi prodotti, quantità, misure e finiture.
L'assistente propone righe provvisorie, chiede i dettagli mancanti e lascia i prezzi vuoti finché
non provengono da un listino verificato. La dettatura usa il riconoscimento vocale del browser;
controlla il testo prima di inviarlo.

## Moduli

- `serramenti_document_worker.pdf_parser`: parser riutilizzabile da un worker o da una futura API.
- `serramenti_document_worker.cli`: interfaccia locale per ispezionare un PDF e il suo JSON.
- `serramenti_document_worker.ocr`: OCR riutilizzabile con confidenza e coordinate per parola.
- `serramenti_document_worker.ocr_cli`: interfaccia locale per l'OCR di pagine selezionate.
- `serramenti_document_worker.catalog_extractor`: candidati strutturati con fonte e riquadri pagina.
- `serramenti_document_worker.catalog_cli`: esportazione locale dei candidati in JSON.

La libreria `pdfplumber` usa `pdfminer.six` per leggere il testo e riconoscere tabelle; l'estrazione
delle tabelle è euristica e il risultato va controllato prima di usarlo come fonte di prezzo.

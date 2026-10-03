# Lumi.01

Monorepo per un'app di preventivazione serramenti con lettura AI dei listini, prezzi tracciabili e calcolo deterministico.

## Requisiti

- Node.js 24 e pnpm 12
- Python 3.12 e uv
- Docker Desktop con Docker Compose

## Avvio locale

```sh
cp apps/web/.env.example apps/web/.env
pnpm install
cd services/document-worker && uv sync && cd ../..
docker compose up -d
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Apri <http://localhost:3001>. L'app include autenticazione, spazio aziendale, archivio e analisi dei
listini PDF e assistente conversazionale AI per i preventivi.
PostgreSQL usa sempre il volume Docker `lumi01_postgres_data`, anche se Compose viene avviato da
un'altra cartella. Non usare `docker compose down -v` o rimuovere quel volume: cancella il database.

## Worker Python

Per installare e usare il parser PDF, consulta [services/document-worker/README.md](services/document-worker/README.md).

## Autenticazione locale

L'ambiente di sviluppo usa Mailpit per ricevere email di verifica senza inviarle a indirizzi reali.
`BETTER_AUTH_SECRET` in `apps/web/.env` è un segreto locale generato per questo checkout. Per un
nuovo ambiente, genera un valore con `pnpm dlx auth@latest secret` e inseriscilo nel file `.env`
locale. Avvia i servizi con `docker compose up -d`; apri poi <http://localhost:8025> per vedere le
email di verifica e recupero password. In produzione andranno configurati un server SMTP e un
segreto dedicato tramite il secret manager del deployment.

## Upload listini PDF

Apri **Dashboard → Apri listini**, inserisci fornitore, nome e versione, quindi carica un PDF fino
a 30 MB. I file sono controllati lato server, identificati con SHA-256 e salvati fuori da PostgreSQL
in `apps/web/.data/uploads` (configurabile con `UPLOADS_DIR`). I record e i file sono accessibili solo
ai membri dell'azienda a cui appartengono. In sviluppo è attivo il provider locale; il codice usa
un'interfaccia di storage sostituibile con un provider compatibile S3 nelle milestone di deployment.

L'archivio conserva il PDF originale e i suoi metadati senza scansionarlo al caricamento. Per avviare
una lettura, apri Lumi dalla chat flottante in basso a destra, scegli il PDF e chiedi ciò che vuoi
sapere. La chat esegue l'estrazione Python e l'interpretazione AI solo dopo la richiesta dell'utente.

## Assistente AI locale con llama.cpp

Chat, azioni, preventivi e interpretazione documenti usano un solo provider server-side
OpenAI-compatible, configurato per impostazione predefinita su
`http://127.0.0.1:8080/v1` e sul modello `SoAIHQ/Qwen3.5-9B-GGUF:Q4_K_M`. L'app non
richiede credenziali di un provider cloud e il browser non contatta direttamente llama.cpp.

Avvia `llama-server` in ascolto soltanto sull'interfaccia loopback. Con una build llama.cpp che
supporta il download Hugging Face, per esempio:

```powershell
llama-server.exe -hf "SoAIHQ/Qwen3.5-9B-GGUF:Q4_K_M" --host 127.0.0.1 --port 8080 -c 8192
```

Verifica il modello e l'API:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/v1/models
```

Per cambiare URL, modello, chiave locale (un segnaposto, non un segreto) o contesto, copia
`apps/web/.env.example` in `apps/web/.env` e imposta `LLM_BASE_URL`, `LLM_MODEL`,
`LLM_API_KEY`, `LLM_CONTEXT_SIZE` e `LLM_ENABLE_THINKING`; riavvia poi `pnpm dev`. Il ragionamento
interno è disabilitato per impostazione predefinita per lasciare spazio alle risposte visibili.
Il provider rifiuta URL non-loopback,
HTTP non locale, credenziali nell'URL e redirect.

La chat mantiene lo streaming. Un context manager stima i token dal testo UTF-8, riserva spazio
per output e immagini e scarta prima i turni storici più vecchi; non tronca la richiesta corrente.
Se il testo richiesto da solo supera la finestra, l'app chiede di restringere la richiesta.
`GET /api/assistant/health` controlla `/v1/models` e la chat mostra lo stato del motore.

La chat flottante è disponibile in tutte le pagine del dashboard e saluta l'utente all'accesso. Puoi
selezionare un listino PDF già caricato o caricare un altro PDF dalla chat: il caricamento conserva
solo il file originale, senza analizzarlo. Quando fai una domanda sul documento, il worker Python
locale estrae testo, tabelle, coordinate e OCR; llama.cpp usa l'estrazione e le immagini delle pagine
pertinenti per rispondere e citare le pagine. La prima lettura viene salvata e riutilizzata nelle
domande successive; chiedi esplicitamente di “ri-analizzare” per rifare la scansione. Il contenuto
viene inviato solo al server llama.cpp locale configurato. La dettatura usa il riconoscimento
vocale del browser, che può avere proprie modalità di elaborazione. L'analisi resta una proposta
da verificare e non attiva prezzi.

Il worker locale va installato con `uv sync` prima dell'avvio dell'app. I PDF corrotti, illeggibili o
protetti vengono rifiutati con un errore leggibile.

## Posta Gmail e Microsoft 365

La pagina **Dashboard → Email** permette a ogni utente autenticato di aggiungere
più account Gmail/Google Workspace e Microsoft 365/Outlook tramite OAuth, oppure
account email generici configurando host, porta, TLS e credenziali IMAP/SMTP.
Gli account generici vengono verificati sui due server prima di essere salvati;
si possono leggere gli ultimi messaggi INBOX e inviare posta. Le credenziali e
i token sono cifrati nel database con AES-256-GCM. `EMAIL_TOKEN_ENCRYPTION_KEY`
è opzionale: se omessa, viene derivata dal segreto `BETTER_AUTH_SECRET`
(mantenerlo stabile è necessario per poter decifrare le credenziali salvate).

Per provare l'interfaccia senza account esterni, premi **Crea account prova**:
viene creata una casella privata `@lumi.test` con messaggi dimostrativi. Dalla
casella demo è possibile inviare solo a un altro account demo dello stesso
utente; nessun messaggio viene recapitato all'esterno.

Per server email generici usa hostname pubblici con TLS; per sicurezza gli
indirizzi IP privati, loopback e link-local sono rifiutati.

Registra applicazioni OAuth nelle console Google Cloud e Microsoft Entra ID e
configura le seguenti redirect URI di tipo Web (usa il dominio HTTPS del
deployment in produzione):

- Google: `http://localhost:3001/api/email/oauth/google/callback`
- Microsoft: `http://localhost:3001/api/email/oauth/microsoft/callback`

Abilita Gmail API e i relativi scope `gmail.readonly` e `gmail.send` nell'app
Google; l'app Microsoft richiede i permessi delegati `User.Read`, `Mail.Read`
e `Mail.Send`. Per app Google in modalità test, aggiungi gli account di prova
come utenti di test. Inserisci le credenziali nel file locale `apps/web/.env`
(mai nel repository) e genera la chiave di cifratura da 32 byte con PowerShell:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Imposta `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET` e
`MICROSOFT_OAUTH_TENANT_ID`, poi riavvia l'app. La chiave opzionale
`EMAIL_TOKEN_ENCRYPTION_KEY`, se configurata esplicitamente, deve essere una
chiave Base64 di 32 byte. Gli utenti possono collegare account OAuth, server
IMAP/SMTP e più caselle demo dalla stessa pagina.

## Gestione ed esportazione preventivi

### Azioni di Lumi nell'app

Nella chat flottante scegli **Modalità → Azioni nell'app**. Lumi usa llama.cpp in locale con
function calling OpenAI-compatible e un registro di funzioni dichiarate con JSON Schema. Può cercare,
creare, aprire, rinominare ed esportare preventivi; gestire appuntamenti, note,
schede cliente, campi personalizzati del profilo e cartelle dell'archivio; oppure
aprire una sezione dell'interfaccia. Le azioni sensibili chiedono una conferma
nella chat. Il server verifica sessione, appartenenza all'azienda e validità dei
dati prima di eseguire la funzione. Per domande generali e PDF usa **Chat e PDF**.
Le note private possono essere collegate a un cliente o a un preventivo cercando
il nome o il titolo nell'editor della nota. I campi personalizzati compaiono nel
profilo utente e sono salvati nel database locale.

Il registro è in `apps/web/src/lib/agent-tools.ts`, l'esecuzione in
`apps/web/src/app/api/assistant/actions/route.ts`. Le nuove funzioni dell'app
vanno aggiunte a entrambi il catalogo JSON Schema e il dispatcher autorizzato.
La dettatura già disponibile nella chat funziona anche in modalità Azioni.

### Archivio file del profilo

Apri **Profilo Utente → Archivio file**. Aggiungi più cartelle alla coda, poi
premi **Importa**. Con il selettore di cartelle del browser vengono conservate
anche le cartelle vuote; il selettore alternativo mantiene i percorsi dei file,
ma i browser che non espongono le cartelle vuote non possono inviarle. Nomi e
struttura sono preservati; la consultazione ordina cartelle e file alfabeticamente.
Ogni file viene inviato e scritto in streaming sul disco, senza un limite di
dimensione applicativo o un filtro per estensione. Servono comunque spazio libero
e un server/proxy che consenta trasferimenti lunghi. I file si trovano in
`apps/web/.data/profile-archive` o nella directory `PROFILE_ARCHIVE_DIR`.

### Confronto nell'editor

Nell'editor del documento premi **Confronta preventivo**, cerca per titolo o
cliente e scegli un documento. Il riferimento compare a destra in sola lettura.
Trascina il divisore o usa le frecce quando è selezionato per cambiare le
larghezze. Sullo schermo stretto le viste sono disposte in verticale.

### Calcolo prodotti nell'editor

La voce **Prodotti** apre il catalogo condiviso dell'azienda. Per ogni prodotto
si può scegliere un prezzo al m², con minimo fatturabile obbligatorio, oppure
un prezzo fisso per pezzo. Nell'editor del preventivo premi **Calcola prodotti**
per aprire il pannello accanto al foglio di lavoro; dimensioni e quantità
mostrano il prezzo unitario, il totale di riga e il totale complessivo. Il
divisore ridimensionabile funziona come nel confronto; su schermi stretti i
pannelli sono disposti in verticale. **Copia riepilogo** copia un testo ordinato
negli appunti senza aggiungere o modificare righe nel preventivo.

Per aggiornare un'installazione esistente dopo queste modifiche, applica le
migrazioni dei campi personalizzati e dei collegamenti delle note, poi rigenera
Prisma Client:

```sh
pnpm db:generate
pnpm --filter @lumi-01/web exec prisma migrate deploy
```

### Editor del documento e PDF

Apri un preventivo e scegli **Editor documento · PDF**. Il modello generico include intestazione,
cliente, voci disponibili, condizioni e firma. Le modifiche al documento non alterano i prezzi o
le righe del gestionale; **Inserisci → Voci del preventivo** importa un nuovo riepilogo aggiornato
nel punto selezionato. Gli importi mancanti vengono indicati come da definire.

Sono disponibili stili, caratteri, dimensioni, colori, evidenziazione, allineamento, elenchi,
rientri, interlinea, collegamenti, tabelle con celle unite, immagini PNG/JPEG/WebP anche da incolla
o trascinamento, interruzioni di pagina, formato A4/Letter, orientamento, margini, intestazione,
piè di pagina e numeri di pagina. Seleziona un'immagine per ridimensionarla o allinearla.

Il salvataggio automatico conserva le ultime 100 versioni. Due finestre non possono sovrascrivere
silenziosamente lo stesso documento; in caso di conflitto è disponibile una copia locale del
testo. I documenti approvati richiedono una conferma esplicita prima di essere modificati.

**Anteprima** ed **Esporta PDF** salvano prima le modifiche e generano il PDF sul server locale.
Il foglio nell'editor è continuo; l'anteprima PDF mostra l'impaginazione finale e i salti pagina.
Non sono inclusi macro Word, importazione DOCX o revisione collaborativa con modifiche tracciate.

Per una nuova installazione:

```sh
pnpm install
pnpm db:generate
pnpm --filter @lumi-01/web exec prisma migrate deploy
pnpm --filter @lumi-01/web exec playwright install chromium
```

Immagini e documenti sono salvati in PostgreSQL e inclusi nel backup del database. L'esportazione
JSON/CSV/XLSX esistente riguarda i dati commerciali; il documento impaginato si esporta in PDF.
Le immagini conservate nella cronologia non vengono cancellate rimuovendole dal testo.

### Archivio e report

Nell’archivio **Preventivi** puoi selezionare una o più bozze e preventivi, spostarli nel cestino o
esportarli in JSON, CSV o Excel (`.xlsx`). L’esportazione include stato, date, anagrafica cliente,
totali, righe, configurazioni e messaggi. Il JSON conserva importi come stringhe decimali per
evitare arrotondamenti dovuti alla conversione in numero.

L’eliminazione è un soft-delete: gli elementi restano nel **Cestino** e si possono ripristinare.
I preventivi approvati richiedono una conferma esplicita. Non esiste ancora un modulo fatture/ordini
collegato ai preventivi; quando verrà aggiunto, l’eliminazione dovrà verificare anche quei legami.

## Letture PDF su richiesta

Le letture precedenti vengono eliminate dalla migrazione `20260929230000_global_assistant_documents`:
si cancellano output OCR, tabelle e interpretazioni salvate, mentre restano i PDF originali, i
preventivi e i prezzi già approvati. I file migrano nell'archivio documenti di Lumi senza dati
estratti; la scansione riparte solo quando l'utente seleziona un PDF e chiede all'assistente di
leggerlo. I nuovi risultati strutturati e il profilo delle regole del mittente vengono memorizzati
per le domande successive.

Esempio ridotto dell’output semantico:

```json
{
  "document_type": "supplier_quote",
  "sender_name": "Fornitore Serramenti Srl",
  "recipient_name": "Lumi Serramenti",
  "document_number": "PREV-2026-104",
  "issue_date": "2026-09-29",
  "valid_until": null,
  "currency": "EUR",
  "items": [
    {
      "code": "POR-80-B",
      "description": "Porta battente laminata bianca",
      "quantity": "2",
      "unit": "pz",
      "unit_price": "245.00",
      "discount_percent": null,
      "tax_rate": "22",
      "line_total": "490.00",
      "page_number": 1,
      "source_excerpt": "POR-80-B Porta battente ... 2 ... 245,00"
    }
  ],
  "totals": {
    "subtotal": "490.00",
    "discount": null,
    "tax": "107.80",
    "total": "597.80"
  },
  "payment_terms": "30 giorni data fattura",
  "shipping_mode": "Consegna al cliente",
  "settings": {
    "currency": "EUR",
    "default_vat_rate": "22",
    "payment_terms": "30 giorni data fattura",
    "shipping_mode": "Consegna al cliente",
    "source_layout": "Tabella codici, descrizione, quantità e prezzo unitario",
    "rules": ["Le righe prezzo seguono l'intestazione della tabella"]
  },
  "ocr_corrections": [],
  "source_pages": [1],
  "confidence": "medium",
  "warnings": ["Verificare quantità e importi sulla pagina originale"]
}
```

Gli importi dell’esempio sono illustrativi. Il modello non deve calcolare totali o colmare dati
mancanti; in caso di scansione incerta deve riportare `null` e aggiungere un avviso.

Dopo una modifica allo schema:

```sh
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm lint
pnpm typecheck
```

## Note

- `.env` contiene solo credenziali locali di sviluppo: non committarlo.
- Il PostgreSQL locale usa credenziali predefinite solo per lo sviluppo; prima del deployment
  andranno sostituite con un secret manager.
- I dati di listino importati dovranno essere verificati prima dell'attivazione.

## Dashboard e Profilo Utente

La dashboard include il profilo, note private e pubbliche, calendario personale,
raccolta e archivio preventivi, bacheche e chat dirette/di gruppo. Il modulo usa
Better Auth e PostgreSQL già presenti nel progetto.

Architettura, schema, API, permessi e flussi sono descritti in
[docs/profile-module.md](docs/profile-module.md).

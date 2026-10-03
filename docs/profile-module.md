# Dashboard e Profilo Utente

## Architettura

Il modulo estende lo stack esistente: Next.js App Router, React, TypeScript,
Better Auth e Prisma/PostgreSQL. Non richiede Firebase, Supabase, nuovi account
esterni o nuove dipendenze npm. Avatar e contenuti sono salvati nel database
locale già configurato, non in mock né nel localStorage.

La dashboard presenta **App Manager Pro** come hub modulare e conserva il marchio
Lumi e gli spazi aziendali. Il registro `dashboard-modules.ts` definisce le schede
del profilo (note, calendario, preventivi, archivio, bacheche, messaggi);
la prima attiva è **Profilo Utente**. I moduli futuri sono segnaposto senza azioni.

## Navigazione e componenti

- `/dashboard`: benvenuto aggiornato dal database, conteggi personali, moduli, aziende.
- `/dashboard/profilo`: `ProfileWorkspace`, `ProfileHeader`, `NoteBoard`.
- `?tab=calendar`: `CalendarView`, calendario mensile e agenda giornaliera.
- `?tab=quotes`: `QuoteVault`, raccolta personale, archivio e accesso all’editor.
- `?tab=community`: `CommunityBoard`, note e preventivi pubblicati.
- `?tab=messages`: `ChatList`, elenco e stanza della conversazione.
- `?tab=messages&with=<userId>`: predispone una conversazione; l’utente deve premere
  **Apri conversazione**. Non invia messaggi automaticamente.

`DashboardNavigation` è disponibile in tutte le pagine del dashboard. L’assistente
AI esistente continua a essere disponibile. L’editor esistente si apre su
`/dashboard/preventivi/<id>/documento` e mantiene immagini, revisioni e PDF.

React gestisce lo stato locale e l’URL identifica la sezione attiva. Le sezioni
visitate restano montate passando tra le schede del profilo per conservare i moduli
aperti. Il cambio pagina completo o il ricaricamento non salva una bozza di nota o
di evento: occorre usare il pulsante Salva. `useProfileResource` espone
`data/loading/error/reload` e scarta risposte obsolete; `profileFetch` gestisce API
JSON e FormData senza cache di dati privati. Ogni mutazione mostra esito o errore.

## Modelli e corrispondenza con lo schema richiesto

| Entità richiesta | Modello persistente | Dettagli                                                                               |
| ---------------- | ------------------- | -------------------------------------------------------------------------------------- |
| users            | User + UserAvatar   | Nome, immagine, avatarPreset, isPresetAvatar; foto WebP in Bytes                       |
| private_notes    | PrivateNote         | userId, titolo, contenuto, version, date; isPublic deriva dalla pubblicazione          |
| public_bulletin  | PublicBulletin      | Copia di titolo e testo, noteId univoco, authorId, date                                |
| calendar_events  | CalendarEvent       | userId, titolo, date YYYY-MM-DD, time HH:mm facoltativa, tipo, descrizione, completato |
| quotes           | Quote + SavedQuote  | Preventivo aziendale, creatore; raccolta e archivio privati per utente                 |
| public_quotes    | PublicQuote         | Copia pubblica di titolo, voci, importo e valuta; autore e riferimento al preventivo   |
| chats            | Chat + ChatMember   | direct/group, nome, proprietario del gruppo, partecipanti, lastMessageAt               |
| messages         | ChatMessage         | testo, mittente, timestamp, sequence BigInt, clientId UUID idempotente                 |

Lo schema canonico è `apps/web/prisma/schema.prisma`. La migrazione
`20260930020000_user_profile` aggiunge tabelle, relazioni e indici senza eliminare
i dati esistenti. I preventivi precedenti conservano `createdByUserId = null`:
non viene assegnato loro un autore arbitrario. Possono essere aggiunti alla raccolta
personale dai membri dell’azienda; la pubblicazione è riservata a chi amministra
l’azienda quando il creatore non è noto.

## API e persistenza

Tutte le route richiedono una sessione autenticata. Non accettano un `userId` del
proprietario inviato dal browser: lo ricavano dalla sessione. Le mutazioni
verificano l’origine se presente; le risposte private usano `Cache-Control: private,
no-store`. Zod valida gli input e le API restituiscono 400/401/403/404/409/413
coerenti con l’errore, senza dettagli SQL o credenziali.

| API                                   | Operazioni                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `/api/profile`                        | GET profilo corrente; PATCH nome e/o preset                                 |
| `/api/profile/avatar`                 | POST multipart campo file; ridimensionamento e rimozione metadati           |
| `/api/profile/avatar/:userId`         | GET immagine per gli utenti autenticati                                     |
| `/api/profile/notes`                  | GET ricerca e pagine; POST crea; PATCH update/publish/unpublish; DELETE     |
| `/api/profile/calendar?month=YYYY-MM` | GET mese; POST/PATCH/DELETE eventi personali                                |
| `/api/profile/quotes`                 | GET salvati/archivio/aziendali; POST save/archive/restore/publish/unpublish |
| `/api/profile/quotes?preview=:id`     | GET anteprima esatta della condivisione con versione hash                   |
| `/api/community?kind=notes\|quotes`   | GET bacheca paginata; DELETE pubblicazioni proprie                          |
| `/api/people?q=nome`                  | GET directory paginata senza indirizzi email; id ripetuti per la selezione  |
| `/api/chats`                          | GET proprie chat; POST nuova diretta/gruppo                                 |
| `/api/chats/:id`                      | GET stanza; PATCH rename/add/remove/leave per gruppi                        |
| `/api/chats/:id/messages`             | GET cronologia, parametro before; POST messaggio con clientId               |
| `/api/chats/:id/stream`               | GET Server-Sent Events, cursore after/Last-Event-ID                         |

### Identità

Sei avatar SVG locali. Foto PNG/JPEG/WebP fino a 5 MB, limite del corpo anche per
upload senza Content-Length, controllo formato e massimo 20 milioni di pixel,
conversione a WebP 384×384. Non vengono conservati i metadati EXIF. Il file è
servito solo agli utenti autenticati; email visibile soltanto nel proprio profilo.

### Note e calendario

Le note sono private finché il proprietario sceglie Pubblica. Una pubblicazione
salva una copia: modificare la nota privata non modifica automaticamente ciò che
vedono gli altri. **Aggiorna bacheca** ripubblica la versione scelta; il controllo
`version` rifiuta un salvataggio o una pubblicazione da una schermata obsoleta.
Eliminare una nota elimina anche la sua pubblicazione. Ritirare dalla bacheca
conserva l’originale privato.

Gli eventi usano data e ora locali senza conversione di fuso orario; il calendario
non invia notifiche programmate. Ogni utente vede e modifica soltanto i propri
eventi. Vista mensile limitata a 1.000 eventi con avviso nell’interfaccia.

### Preventivi e condivisione

I nuovi preventivi registrano il creatore e sono salvati automaticamente nel suo
profilo. La raccolta può includere documenti accessibili dalle proprie aziende.
Archiviare nel profilo aggiorna solo `SavedQuote.archivedAt`, non lo stato
commerciale di `Quote`. Per tutte le operazioni resta necessaria l’appartenenza
all’azienda del preventivo.

La pubblicazione richiede il ruolo owner/admin dell’azienda oppure di essere il
creatore del preventivo, anteprima e conferma esplicita. Un hash del contenuto
impedisce di confermare un’anteprima superata. L’API seleziona soltanto titolo,
descrizioni delle voci, quantità, unità, prezzi, totale e valuta. Non pubblica
anagrafica cliente, HTML dell’editor, PDF, allegati o conversazioni. Il testo libero
delle descrizioni va comunque controllato dall’utente nell’anteprima. Un importo
incompleto è `null`, mostrato come **Da definire**.

La bacheca contiene una copia esplicita, non un collegamento che rende pubblico il
documento originale. Le successive modifiche non si propagano senza ripubblicare.
I preventivi eliminati sono esclusi dalla bacheca. L’autore può ritirare la propria
pubblicazione anche se non è più membro dell’azienda. Limiti: 20 documenti per
operazione, 100 voci per preventivo pubblico.

### Chat e aggiornamenti

Una chat diretta viene riutilizzata per la stessa coppia di utenti (chiave univoca).
I gruppi hanno fino a 20 partecipanti; il responsabile rinomina, aggiunge e rimuove
utenti. Prima dell’aggiunta viene indicato che i nuovi partecipanti potranno
leggere tutta la cronologia. Uscendo, il responsabile passa il ruolo al partecipante
rimasto da più tempo; un gruppo vuoto viene eliminato.

SSE invia i messaggi incrementali usando una sequenza persistente, controlla
sessione e partecipazione ogni due secondi e chiude il flusso dopo circa 28–30
secondi. EventSource si riconnette con l’ultimo cursore. Gli invii sono serializzati
sulla stanza e il clientId rende idempotente un tentativo ripetuto. Il client
unisce i messaggi per ID e riprende dal cursore anche dopo il cambio di scheda.
La cronologia carica 50 messaggi alla volta. Il testo di un messaggio è limitato a
5.000 caratteri. Le liste delle chat si aggiornano ogni 8 secondi, le bacheche ogni
10 secondi; il polling viene sospeso quando la scheda del browser è nascosta.
Lo stream della stanza è chiuso quando la sezione Messaggi non è attiva.

Questo trasporto usa PostgreSQL e SSE, con rilevamento server a intervalli di due
secondi, non un servizio Firebase/Supabase. Per un deployment il proxy deve
supportare streaming SSE senza buffering. Non sono inclusi notifiche push,
indicatori di lettura o crittografia end-to-end.

## Avvio e aggiornamenti

Su questa installazione la migrazione è stata applicata e il client Prisma generato.
Dopo il cambiamento dello schema, riavviare il server Next.js già aperto per usare
il nuovo Prisma Client: Ctrl+C nel terminale dell’app, poi `pnpm dev`.

Su un’altra installazione dello stesso progetto:

```sh
pnpm install
docker compose up -d
pnpm db:generate
pnpm --filter @lumi-01/web exec prisma migrate deploy
pnpm dev
```

Non occorrono account di prova, seed né pubblicazioni automatiche. I contenuti
personali e i messaggi vengono creati soltanto dalle azioni degli utenti.

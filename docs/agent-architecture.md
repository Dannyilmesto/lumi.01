# Agente locale di Lumi

Lumi usa Next.js per il backend applicativo e il worker Python per i PDF.
Il registro eseguibile delle azioni è `apps/web/src/lib/agent-tools.ts`: la stessa
voce contiene nome, descrizione, JSON Schema e dispatcher. La route
`/api/assistant/actions` invia i tool a Ollama, interpreta `tool_calls`, verifica
la sessione e i permessi e chiama il backend. Le operazioni sensibili richiedono
conferma nella chat. La GUI aggiorna i dati dopo l'esecuzione e apre le schermate
indicate dal risultato.

## Pattern Python equivalente

Il seguente pattern è utile quando una funzionalità di Lumi viene implementata
nel worker Python. Il backend applicativo deve restare l'autorità per permessi,
revisioni e modifiche; il modello produce soltanto nome del tool e argomenti.

```python
from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class Action:
    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema
    execute: Callable[[dict[str, Any], dict[str, Any]], Any]


class ActionRegistry:
    def __init__(self) -> None:
        self._actions: dict[str, Action] = {}

    def register(self, action: Action) -> None:
        if action.name in self._actions:
            raise ValueError(f"Tool duplicato: {action.name}")
        self._actions[action.name] = action

    def ollama_tools(self) -> list[dict[str, Any]]:
        return [
            {"type": "function", "function": {
                "name": action.name,
                "description": action.description,
                "parameters": action.parameters,
            }}
            for action in self._actions.values()
        ]

    def dispatch(self, name: str, arguments: dict[str, Any], context: dict[str, Any]) -> Any:
        action = self._actions.get(name)
        if action is None:
            raise ValueError("Tool sconosciuto")
        # Validare arguments contro action.parameters (es. jsonschema) prima della chiamata.
        # context contiene identità/sessione accertata dal server, mai generata dal modello.
        return action.execute(arguments, context)
```

Nel codice applicativo attuale, Zod valida gli argomenti e le route esistenti
verificano sessione, azienda, proprietà e revisioni. Aggiungere un bottone o una
nuova funzione richiede una voce nel catalogo e un handler nel dispatcher. Il
catalogo copre 26 azioni su preventivi, agenda, note, clienti, navigazione,
archivio e campi del profilo; non è una mappatura automatica dei click del DOM.

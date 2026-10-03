"""Small, synthetic Ollama benchmark. Connects only to IPv4 loopback; no downloads."""
import argparse
import json
import re
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--model", default="qwen3.5:4b")
parser.add_argument("--output", default="benchmark-ai-locale-2026-09-29.json")
parser.add_argument("--skip-thinking", action="store_true")
args = parser.parse_args()
OUT = ROOT / "outputs" / args.output
MODEL = args.model
BASE = "http://127.0.0.1:11434"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("HTTP redirects are disabled for this offline benchmark")


HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
source = (ROOT / "apps/web/src/lib/workspace-assistant-ai.ts").read_text()
SYSTEM = re.search(r"const instructions = `([\s\S]*?)`;", source).group(1)
REPORT = {
    "started_at": datetime.now(timezone.utc).isoformat(),
    "scope": "Synthetic text tasks only, local Ollama; not an end-to-end PDF/app test",
    "model": MODEL,
    "sampling": {"temperature": 0, "seed": 42},
    "system_prompt": SYSTEM,
    "runs": [],
}


def api(path, payload=None):
    request = urllib.request.Request(
        BASE + path,
        data=None if payload is None else json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    return HTTP.open(request, timeout=50)


def save():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(REPORT, ensure_ascii=False, indent=2) + "\n")


def run(name, messages, context=4096, predict=180, think=False):
    payload = {
        "model": MODEL, "messages": [{"role": "system", "content": SYSTEM}] + messages,
        "stream": True, "think": think, "keep_alive": "5m",
        "options": {"num_ctx": context, "num_predict": predict, "temperature": 0, "seed": 42},
    }
    record = {"name": name, "context": context, "think": think, "num_predict": predict,
              "messages": messages}
    print(json.dumps({"event": "start", "name": name, "context": context, "think": think}), flush=True)
    started = time.perf_counter()
    content = []
    thinking_chars = 0
    first = None
    final = {}
    try:
        with api("/api/chat", payload) as response:
            for line in response:
                if time.perf_counter() - started > 80:
                    raise TimeoutError("Benchmark request exceeded 80 seconds")
                if not line.strip():
                    continue
                chunk = json.loads(line)
                if chunk.get("error"):
                    raise RuntimeError(chunk["error"])
                message = chunk.get("message", {})
                token = message.get("content", "")
                thinking_chars += len(message.get("thinking", ""))
                if token:
                    if first is None:
                        first = time.perf_counter() - started
                    content.append(token)
                if chunk.get("done"):
                    final = chunk
        if not final:
            raise RuntimeError("Stream ended without final metrics")
    except Exception as error:
        record["error"] = str(error)
    record.update({
        "wall_seconds": round(time.perf_counter() - started, 3),
        "first_visible_token_seconds": None if first is None else round(first, 3),
        "response": "".join(content), "thinking_characters": thinking_chars,
        "done_reason": final.get("done_reason"),
        "prompt_tokens": final.get("prompt_eval_count"), "output_tokens": final.get("eval_count"),
    })
    for key in ("load_duration", "prompt_eval_duration", "eval_duration", "total_duration"):
        record[key.replace("duration", "seconds")] = round(final.get(key, 0) / 1e9, 3)
    if final.get("eval_duration"):
        record["generation_tokens_per_second"] = round(final["eval_count"] / (final["eval_duration"] / 1e9), 2)
    with api("/api/ps") as response:
        record["loaded_models"] = json.load(response).get("models", [])
    REPORT["runs"].append(record)
    save()
    print(json.dumps({key: value for key, value in record.items() if key not in ("messages", "loaded_models")}, ensure_ascii=False), flush=True)


with api("/api/tags") as response:
    REPORT["installed_models"] = json.load(response)
with api("/api/show", {"model": MODEL}) as response:
    metadata = json.load(response)
    REPORT["model_metadata"] = {key: metadata.get(key) for key in ("details", "capabilities", "parameters", "model_info")}

PRICE = "Estratto pagina 7, listino sintetico: LAM80 | Porta laminata bianca 80x210 cm | 245,50 EUR/cad | IVA esclusa. Posa: 80,00 EUR una tantum. IVA 22%."
extract = [{"role": "user", "content": PRICE + " Indica codice, prezzo unitario e pagina della porta in una sola frase. Non aggiungere altro."}]
followup = [
    {"role": "user", "content": PRICE + " Qual è il prezzo della porta?"},
    {"role": "assistant", "content": "La porta LAM80 costa 245,50 EUR per unità, IVA esclusa, a pagina 7. Posa: 80 EUR una tantum; IVA: 22%."},
    {"role": "user", "content": "Usa quel risultato per 3 porte. Applica lo sconto del 10% solo alle porte, poi aggiungi la posa una sola volta e l'IVA del 22% su tutto. Dammi imponibile scontato delle porte, imponibile comprensivo della posa e totale finale in euro. Non serve rileggere il documento."},
]
unknown = [{"role": "user", "content": PRICE + " Quanto costa invece il modello GLX900? Rispondi in una frase, senza stimare prezzi."}]

for context in (4096, 8192):
    run(f"warmup_{context}", [{"role": "user", "content": "Scrivi soltanto: Ciao Danny."}], context, 30)
    for repeat in range(1, 3):
        run(f"extract_{context}_{repeat}", extract, context, 90)
        run(f"followup_{context}_{repeat}", followup, context, 180)
    run(f"missing_{context}", unknown, context, 100)

# Same question and target fact, with irrelevant synthetic catalogue rows added.
filler = "\n".join(f"ACC{i:03d} | Accessorio sintetico {i} | finitura standard | prezzo {10 + i},00 EUR/cad | pagina {20 + i // 10}" for i in range(1, 76))
run("extract_long_8192", [{"role": "user", "content": filler + "\n" + extract[0]["content"]}], 8192, 90)

# One bounded experiment: hidden reasoning on a simple calculation, no reasoning text saved.
if not args.skip_thinking and "thinking" in metadata.get("capabilities", []):
    run("followup_thinking_8192", followup, 8192, 512, True)
REPORT["completed_at"] = datetime.now(timezone.utc).isoformat()
save()

type FailureCode =
  | "empty_output"
  | "output_limit"
  | "incomplete"
  | "invalid_chunk"
  | "provider_error"
  | "read_error";

type StreamDiagnostics = {
  code: FailureCode;
  finishReason: string | null;
  reasoningReceived: boolean;
  visibleCharacters: number;
};

type OpenAIChunk = {
  error?: unknown;
  choices?: Array<{
    delta?: {
      content?: unknown;
      reasoning_content?: unknown;
      reasoning?: unknown;
    };
    finish_reason?: unknown;
  }>;
};

const errorMessages: Record<FailureCode, string> = {
  empty_output:
    "Il modello AI locale ha completato la richiesta senza testo. Riprova.",
  output_limit:
    "La risposta ha raggiunto il limite di lunghezza. Puoi chiedere a Lumi di continuare.",
  incomplete: "La risposta si è interrotta prima del completamento. Riprova.",
  invalid_chunk: "Il modello AI locale ha inviato una risposta non leggibile.",
  provider_error: "Il motore AI locale ha interrotto la generazione. Riprova.",
  read_error:
    "Il collegamento con il motore AI locale si è interrotto durante la risposta.",
};

class StreamFailure extends Error {
  readonly code: FailureCode;

  constructor(code: FailureCode) {
    super(errorMessages[code]);
    this.code = code;
  }
}

/** Adapt OpenAI-compatible SSE into the UI event stream without exposing reasoning. */
export function createLLMAnswerStream(
  upstream: ReadableStream<Uint8Array>,
  options: {
    onFailure?: (diagnostics: StreamDiagnostics) => void;
    suppressUrls?: boolean;
  } = {},
) {
  const reader = upstream.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      let receivedDone = false;
      let visibleCharacters = 0;
      let finishReason: string | null = null;
      let reasoningReceived = false;
      let pendingWord = "";
      const emit = (event: object) => {
        if (!cancelled)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
      };
      const tokenText = (token: string, flush = false) => {
        if (!options.suppressUrls) {
          if (token) emit({ type: "token", content: token });
          return;
        }
        pendingWord += token;
        const boundary = flush
          ? pendingWord.length
          : pendingWord.search(/\S*$/);
        if (boundary <= 0) return;
        const content = pendingWord
          .slice(0, boundary)
          .replace(/(?:https?:\/\/|www\.)[^\s]+/gi, "[vedi fonti verificate]");
        pendingWord = pendingWord.slice(boundary);
        if (content) emit({ type: "token", content });
      };
      const consumeEvent = (block: string) => {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) return;
        if (data === "[DONE]") {
          receivedDone = true;
          return;
        }
        let chunk: OpenAIChunk;
        try {
          const value: unknown = JSON.parse(data);
          if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Invalid event shape");
          chunk = value as OpenAIChunk;
        } catch {
          throw new StreamFailure("invalid_chunk");
        }
        if (chunk.error) throw new StreamFailure("provider_error");
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        if (
          typeof delta?.reasoning_content === "string" &&
          delta.reasoning_content.length
        )
          reasoningReceived = true;
        if (typeof delta?.reasoning === "string" && delta.reasoning.length)
          reasoningReceived = true;
        if (
          typeof choice?.finish_reason === "string" &&
          choice.finish_reason.length
        )
          finishReason = choice.finish_reason;
        if (typeof delta?.content === "string" && delta.content.length) {
          visibleCharacters += delta.content.length;
          tokenText(delta.content);
        }
      };

      try {
        while (!receivedDone && !cancelled) {
          const { value, done } = await reader.read();
          if (cancelled) return;
          buffer += decoder.decode(value, { stream: !done });
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() ?? "";
          for (const event of events) {
            consumeEvent(event);
            if (receivedDone) break;
          }
          if (done) {
            if (!receivedDone && buffer.trim()) consumeEvent(buffer);
            break;
          }
        }
        if (cancelled) return;
        tokenText("", true);
        if (!receivedDone) throw new StreamFailure("incomplete");
        if (finishReason === "length") throw new StreamFailure("output_limit");
        if (!visibleCharacters) throw new StreamFailure("empty_output");
        emit({ type: "done" });
      } catch (error) {
        if (cancelled) return;
        const code = error instanceof StreamFailure ? error.code : "read_error";
        options.onFailure?.({
          code,
          finishReason,
          reasoningReceived,
          visibleCharacters,
        });
        emit({ type: "error", code, error: errorMessages[code] });
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
        if (!cancelled) controller.close();
      }
    },
    cancel(reason) {
      cancelled = true;
      return reader.cancel(reason);
    },
  });
}

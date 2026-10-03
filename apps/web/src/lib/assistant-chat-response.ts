import type { WebSource } from "./web-types";

type ChatMetadata = {
  sourcePages: number[];
  documentName: string | null;
  scannedNow: boolean;
};

type ChatTask = (context: {
  signal: AbortSignal;
  status: (message: string) => void;
  metadata: (metadata: ChatMetadata) => void;
  webSources: (sources: WebSource[], notice?: string) => void;
}) => Promise<ReadableStream<Uint8Array>>;

/** Open the response before PDF and model work, keeping progress and cancellation live. */
export function createAssistantChatResponse(
  requestSignal: AbortSignal,
  task: ChatTask,
) {
  const controller = new AbortController();
  const signal = AbortSignal.any([
    requestSignal,
    controller.signal,
    AbortSignal.timeout(300_000),
  ]);
  const encoder = new TextEncoder();
  let cancelled = false;
  let stage = "preparazione";
  const startedAt = Date.now();
  const body = new ReadableStream<Uint8Array>({
    async start(output) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const emit = (event: object) => {
        if (!cancelled && !signal.aborted)
          output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const heartbeat = setInterval(() => {
        if (!cancelled && !signal.aborted)
          output.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 10_000);
      try {
        signal.throwIfAborted();
        const stream = await task({
          signal,
          status(message) {
            stage = message;
            emit({ type: "status", message });
          },
          metadata(metadata) {
            emit({ type: "metadata", ...metadata });
          },
          webSources(sources, notice) {
            emit({ type: "web_sources", sources, notice });
          },
        });
        reader = stream.getReader();
        while (!signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!cancelled && !signal.aborted) output.enqueue(value);
        }
        if (signal.aborted && !cancelled) throw signal.reason;
      } catch (error) {
        if (cancelled || requestSignal.aborted || controller.signal.aborted)
          return;
        const statusCode = signal.aborted
          ? 504
          : error instanceof Error &&
              "statusCode" in error &&
              typeof error.statusCode === "number"
            ? error.statusCode
            : 500;
        const message = signal.aborted
          ? "L’analisi ha superato il tempo disponibile. Chiedi di analizzare una parte più specifica del PDF."
          : statusCode !== 500 && error instanceof Error
            ? error.message
            : "Non sono riuscito a completare la richiesta. Riprova.";
        console.error("Richiesta assistente interrotta.", {
          stage,
          statusCode,
          elapsedMs: Date.now() - startedAt,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
        // A timeout has aborted the worker, but the browser still needs the error event.
        if (!cancelled)
          output.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: message, statusCode })}\n\n`,
            ),
          );
      } finally {
        clearInterval(heartbeat);
        await reader?.cancel().catch(() => undefined);
        reader?.releaseLock();
        controller.abort();
        if (!cancelled) output.close();
      }
    },
    cancel() {
      cancelled = true;
      controller.abort();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

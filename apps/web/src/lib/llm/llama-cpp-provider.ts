import { fitMessagesToContext, LLMContextError } from "./context-manager";
import { getLLMConfig, type LLMConfig } from "./config";
import {
  type LLMChatResult,
  type LLMMessage,
  type LLMProvider,
  type LLMRequestOptions,
  LLMProviderError,
} from "./provider";

type OpenAIChatResponse = {
  error?: { message?: unknown } | string;
  choices?: Array<{
    message?: {
      content?: unknown;
      reasoning_content?: unknown;
      reasoning?: unknown;
      tool_calls?: LLMMessage["tool_calls"];
    };
    finish_reason?: unknown;
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
};

function endpoint(baseUrl: URL, path: string) {
  const base = new URL(baseUrl);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(path, base);
}

function providerErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

function mapProviderError(status: number, detail: string) {
  if (/context|prompt.*too long|too many tokens|exceed.*token/i.test(detail))
    return new LLMProviderError(
      "La richiesta è troppo ampia per la finestra del modello locale. Riduci il testo o chiedi una parte specifica del documento.",
      422,
      "context_length",
    );
  if (/model.*(not found|unavailable)|no model/i.test(detail) || status === 404)
    return new LLMProviderError(
      "Il modello AI locale configurato non è disponibile nel server llama.cpp.",
      503,
      "model_unavailable",
    );
  if (status === 400)
    return new LLMProviderError(
      "llama.cpp non ha accettato la richiesta. Verifica il formato o la dimensione del contenuto.",
      422,
      "invalid_request",
    );
  if (status >= 500)
    return new LLMProviderError(
      "Il motore AI locale ha restituito un errore. Controlla i log di llama.cpp e riprova.",
      502,
      "upstream_error",
    );
  return new LLMProviderError(
    "Il motore AI locale non ha accettato la richiesta.",
    status >= 400 && status < 500 ? status : 502,
    "request_rejected",
  );
}

function prepareMessages(config: LLMConfig, request: LLMRequestOptions) {
  try {
    return fitMessagesToContext(request.messages, {
      contextSize: config.contextSize,
      maxOutputTokens: request.maxTokens,
      contextOverheadTokens: Math.ceil(
        JSON.stringify([request.tools, request.responseFormat]).length / 3,
      ),
    });
  } catch (error) {
    if (error instanceof LLMContextError)
      throw new LLMProviderError(
        error.message,
        error.statusCode,
        "context_length",
      );
    throw error;
  }
}

function requestBody(
  config: LLMConfig,
  request: LLMRequestOptions,
  stream: boolean,
) {
  return {
    model: config.model,
    messages: prepareMessages(config, request),
    stream,
    ...(request.temperature === undefined
      ? {}
      : { temperature: request.temperature }),
    ...(request.maxTokens === undefined
      ? {}
      : { max_tokens: request.maxTokens }),
    ...(request.tools?.length ? { tools: request.tools } : {}),
    ...(request.responseFormat
      ? { response_format: request.responseFormat }
      : {}),
    ...(config.enableThinking
      ? { chat_template_kwargs: { enable_thinking: true } }
      : {}),
    ...(config.baseUrl.port === "11434"
      ? {
          options: {
            num_ctx: config.contextSize,
            num_predict: request.maxTokens,
            think: config.enableThinking,
          },
        }
      : {}),
  };
}

function usageValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export class LlamaCppProvider implements LLMProvider {
  private readonly config: LLMConfig;
  private readonly fetcher: typeof fetch;

  constructor(
    config: LLMConfig = getLLMConfig(),
    fetcher: typeof fetch = (...args) => fetch(...args),
  ) {
    this.config = config;
    this.fetcher = fetcher;
  }

  get model() {
    return this.config.model;
  }

  private async post(
    request: LLMRequestOptions,
    stream: boolean,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(
        endpoint(this.config.baseUrl, "chat/completions"),
        {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
            ...(stream ? { Accept: "text/event-stream" } : {}),
          },
          signal: AbortSignal.any([
            request.signal ?? new AbortController().signal,
            AbortSignal.timeout(
              request.timeoutMs ?? (stream ? 180_000 : 240_000),
            ),
          ]),
          body: JSON.stringify(requestBody(this.config, request, stream)),
        },
      );
    } catch (error) {
      request.signal?.throwIfAborted();
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      console.error("Connessione a llama.cpp non riuscita.", {
        model: this.config.model,
        timedOut,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      throw new LLMProviderError(
        timedOut
          ? "Il motore AI locale ha impiegato troppo tempo per rispondere. Riprova tra poco."
          : "Il motore AI locale non è disponibile. Verifica che llama.cpp sia avviato.",
        timedOut ? 504 : 503,
        timedOut ? "timeout" : "unavailable",
        { cause: error },
      );
    }
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const detail = providerErrorMessage(payload);
      console.error("llama.cpp ha rifiutato la richiesta.", {
        status: response.status,
        model: this.config.model,
        providerError: detail.slice(0, 500),
      });
      throw mapProviderError(response.status, detail);
    }
    return response;
  }

  async chat(request: LLMRequestOptions): Promise<LLMChatResult> {
    const response = await this.post(request, false);
    let payload: OpenAIChatResponse;
    try {
      payload = (await response.json()) as OpenAIChatResponse;
    } catch (error) {
      console.error("Risposta JSON non valida da llama.cpp.", {
        model: this.config.model,
      });
      throw new LLMProviderError(
        "Il motore AI locale ha inviato una risposta non leggibile.",
        502,
        "invalid_json",
        { cause: error },
      );
    }

    const choice = payload.choices?.[0];
    const message = choice?.message;
    if (!message) {
      const detail = providerErrorMessage(payload);
      if (detail) throw mapProviderError(response.status, detail);
      throw new LLMProviderError(
        "Il motore AI locale non ha restituito una risposta leggibile.",
        502,
        "empty_response",
      );
    }
    if (
      typeof message.reasoning_content === "string" &&
      message.reasoning_content
    )
      console.info(
        "llama.cpp ha restituito reasoning separato dalla risposta.",
        {
          model: this.config.model,
        },
      );
    const content =
      typeof message.content === "string"
        ? message.content
        : typeof message.content === "object" &&
            message.content !== null &&
            "text" in message.content &&
            typeof message.content.text === "string"
          ? message.content.text
          : "";
    if (!content.trim() && !message.tool_calls?.length)
      throw new LLMProviderError(
        "Il motore AI locale ha completato la richiesta senza testo.",
        502,
        "empty_response",
      );
    const usage = payload.usage;
    return {
      content,
      toolCalls: message.tool_calls ?? [],
      finishReason:
        typeof choice.finish_reason === "string" ? choice.finish_reason : null,
      ...(usage
        ? {
            usage: {
              promptTokens: usageValue(usage.prompt_tokens),
              completionTokens: usageValue(usage.completion_tokens),
              totalTokens: usageValue(usage.total_tokens),
            },
          }
        : {}),
    };
  }

  async streamChat(request: LLMRequestOptions) {
    const response = await this.post(request, true);
    if (!response.body)
      throw new LLMProviderError(
        "Il motore AI locale non ha avviato il flusso di risposta.",
        502,
        "missing_stream",
      );
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream"))
      throw new LLMProviderError(
        "llama.cpp ha restituito un flusso in un formato non valido.",
        502,
        "invalid_stream",
      );
    return response.body;
  }

  async health(signal?: AbortSignal) {
    try {
      const response = await this.fetcher(
        endpoint(this.config.baseUrl, "models"),
        {
          method: "GET",
          redirect: "error",
          headers: { Authorization: `Bearer ${this.config.apiKey}` },
          signal: AbortSignal.any([
            signal ?? new AbortController().signal,
            AbortSignal.timeout(3_000),
          ]),
        },
      );
      if (!response.ok) {
        console.error("Health check llama.cpp fallito.", {
          status: response.status,
        });
        return {
          available: false,
          model: this.config.model,
          error: "Il server llama.cpp non è raggiungibile.",
        };
      }
      const payload = (await response.json()) as {
        data?: Array<{ id?: unknown }>;
        models?: Array<{ name?: unknown; model?: unknown }>;
      };
      const modelIds = [
        ...(payload.data ?? []).map((item) => item.id),
        ...(payload.models ?? []).flatMap((item) => [item.name, item.model]),
      ].filter((id): id is string => typeof id === "string");
      const availableModel =
        modelIds.length === 0 ||
        modelIds.some((id) => id === this.config.model);
      return {
        available: availableModel,
        model: this.config.model,
        ...(!availableModel
          ? { error: "Il modello configurato non è caricato in llama.cpp." }
          : {}),
      };
    } catch (error) {
      signal?.throwIfAborted();
      console.error("Health check llama.cpp non riuscito.", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      return {
        available: false,
        model: this.config.model,
        error:
          "Il motore AI locale non è disponibile. Verifica che llama.cpp sia avviato.",
      };
    }
  }
}

let defaultProvider: LlamaCppProvider | undefined;

export function getLLMProvider(): LLMProvider {
  defaultProvider ??= new LlamaCppProvider();
  return defaultProvider;
}

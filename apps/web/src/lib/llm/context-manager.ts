import type { LLMMessage } from "./provider";

const defaultOutputBudget = 1_200;
const perMessageOverhead = 12;

function messageText(message: LLMMessage) {
  if (typeof message.content === "string") return message.content;
  if (message.content === null) return "";
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

function estimateMessageTokens(message: LLMMessage) {
  const textTokens = Math.ceil(
    new TextEncoder().encode(messageText(message)).length / 3,
  );
  const imageCount =
    typeof message.content === "string" || message.content === null
      ? 0
      : message.content.filter((part) => part.type === "image_url").length;
  const toolTokens = message.tool_calls
    ? Math.ceil(JSON.stringify(message.tool_calls).length / 3)
    : 0;
  return textTokens + toolTokens + imageCount * 1_536 + perMessageOverhead;
}

export class LLMContextError extends Error {
  readonly statusCode = 422;

  constructor() {
    super(
      "La richiesta è troppo ampia per la finestra del modello locale. Riduci il testo o chiedi una parte specifica del documento.",
    );
  }
}

/** Keep the system prompt and current request, dropping only the oldest history. */
export function fitMessagesToContext(
  messages: LLMMessage[],
  options: {
    contextSize: number;
    maxOutputTokens?: number;
    contextOverheadTokens?: number;
  },
) {
  const budget =
    options.contextSize -
    (options.maxOutputTokens ?? defaultOutputBudget) -
    128 -
    (options.contextOverheadTokens ?? 0);
  const systemMessages = messages.filter(
    (message) => message.role === "system",
  );
  const nonSystemMessages = messages.filter(
    (message) => message.role !== "system",
  );
  const selected = [...nonSystemMessages];
  const measure = () =>
    [...systemMessages, ...selected].reduce(
      (total, message) => total + estimateMessageTokens(message),
      0,
    );

  while (selected.length > 1 && measure() > budget) {
    const nextUserTurn = selected.findIndex(
      (message, index) => index > 0 && message.role === "user",
    );
    if (nextUserTurn > 0) selected.splice(0, nextUserTurn);
    else if (selected[0].role !== "user") selected.shift();
    else break;
  }

  const result = [...systemMessages, ...selected];
  if (measure() > budget) throw new LLMContextError();
  return result;
}

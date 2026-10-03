"use client";

import { Check, Copy } from "lucide-react";
import { createElement, useState, type ReactNode } from "react";

const INLINE_TOKENS =
  /(!)?\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_/g;
const CODE_TOKENS =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|if|else|for|while|class|new|async|await|import|from|export|default|true|false|null|undefined|def|in|not|and|or|print|select|from|where|insert|update|delete|create|table|join|as|on|values|into)\b|\b\d+(?:\.\d+)?\b)/gi;
const KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "class",
  "new",
  "async",
  "await",
  "import",
  "from",
  "export",
  "default",
  "true",
  "false",
  "null",
  "undefined",
  "def",
  "in",
  "not",
  "and",
  "or",
  "print",
  "select",
  "where",
  "insert",
  "update",
  "delete",
  "create",
  "table",
  "join",
  "as",
  "on",
  "values",
  "into",
]);

function safeHref(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (value.startsWith("#")) return value;
  try {
    const { protocol } = new URL(value);
    return ["https:", "http:", "mailto:"].includes(protocol) ? value : null;
  } catch {
    return null;
  }
}

function inlineNodes(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(INLINE_TOKENS.source, "g");
  let cursor = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  const appendText = (text: string) => {
    text.split("\n").forEach((line, lineIndex) => {
      if (lineIndex > 0) nodes.push(<br key={`br-${index++}`} />);
      if (line) nodes.push(<span key={`text-${index++}`}>{line}</span>);
    });
  };

  while ((match = pattern.exec(value))) {
    if (match.index > cursor) appendText(value.slice(cursor, match.index));
    const key = `inline-${index++}`;
    if (match[2] && match[3]) {
      const href = safeHref(match[3]);
      nodes.push(
        href ? (
          <a
            key={key}
            href={href}
            target={/^https?:\/\//i.test(href) ? "_blank" : undefined}
            rel={/^https?:\/\//i.test(href) ? "noopener noreferrer" : undefined}
            referrerPolicy="no-referrer"
          >
            {match[2]}
          </a>
        ) : (
          <span key={key}>{match[2]}</span>
        ),
      );
    } else if (match[4]) {
      nodes.push(<code key={key}>{match[4]}</code>);
    } else if (match[5] || match[6]) {
      nodes.push(<strong key={key}>{match[5] ?? match[6]}</strong>);
    } else if (match[7] || match[8]) {
      nodes.push(<em key={key}>{match[7] ?? match[8]}</em>);
    }
    cursor = pattern.lastIndex;
  }

  if (cursor < value.length) appendText(value.slice(cursor));
  return nodes;
}

function highlightedCode(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(CODE_TOKENS.source, "gi");
  let cursor = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match.index > cursor)
      nodes.push(
        <span key={`code-text-${index++}`}>
          {value.slice(cursor, match.index)}
        </span>,
      );
    const token = match[0];
    const tokenClass = token.startsWith("//") || token.startsWith("/*") || token.startsWith("#")
      ? "comment"
      : /^["'`]/.test(token)
        ? "string"
        : /^\d/.test(token)
          ? "number"
          : KEYWORDS.has(token.toLowerCase())
            ? "keyword"
            : "plain";
    nodes.push(
      <span
        key={`code-token-${index++}`}
        className={tokenClass === "plain" ? undefined : `token-${tokenClass}`}
      >
        {token}
      </span>,
    );
    cursor = pattern.lastIndex;
  }

  if (cursor < value.length)
    nodes.push(<span key={`code-text-${index}`}>{value.slice(cursor)}</span>);
  return nodes;
}

function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  async function copyCode() {
    try {
      if (!navigator.clipboard)
        throw new Error("Copia non disponibile in questo browser.");
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  return (
    <figure className="lumi-chat-code">
      <figcaption>
        <span>{language || "Codice"}</span>
        <button
          type="button"
          onClick={() => void copyCode()}
          aria-label={copied ? "Codice copiato" : "Copia codice"}
          title={copyError ? "Copia non riuscita" : "Copia codice"}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          <span>{copied ? "Copiato" : copyError ? "Riprova" : "Copia"}</span>
        </button>
      </figcaption>
      <pre>
        <code>{highlightedCode(code)}</code>
      </pre>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Codice copiato negli appunti." : ""}
        {copyError ? "Impossibile copiare il codice." : ""}
      </span>
    </figure>
  );
}

function isSeparatorRow(line: string) {
  const cells = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|");
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function tableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isListLine(line: string) {
  return /^\s*(?:[-+*]\s+|\d+[.)]\s+)/.test(line);
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index];
  return (
    /^\s*```/.test(line) ||
    /^ {0,3}#{1,6}\s+/.test(line) ||
    /^\s*>\s?/.test(line) ||
    isListLine(line) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    Boolean(line.includes("|") && lines[index + 1] && isSeparatorRow(lines[index + 1]))
  );
}

export function AssistantMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let blockKey = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^\s*```([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      const language = fence[1].slice(0, 20);
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <CodeBlock
          key={`block-${blockKey++}`}
          language={language}
          code={codeLines.join("\n")}
        />,
      );
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const children = inlineNodes(heading[2]);
      const key = `block-${blockKey++}`;
      const tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      blocks.push(createElement(tag, { key }, children));
      index += 1;
      continue;
    }

    if (line.includes("|") && lines[index + 1] && isSeparatorRow(lines[index + 1])) {
      const header = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="lumi-chat-table-wrap" key={`block-${blockKey++}`}>
          <table>
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={`head-${cellIndex}`}>{inlineNodes(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {header.map((_, cellIndex) => (
                    <td key={`cell-${cellIndex}`}>
                      {inlineNodes(row[cellIndex] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const listMatch = /^\s*(?:([-+*])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = /^\s*(?:([-+*])|(\d+)[.)])\s+(.*)$/.exec(lines[index]);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(
          <li key={`item-${items.length}`}>{inlineNodes(item[3])}</li>,
        );
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={`block-${blockKey++}`}>{items}</List>);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`block-${blockKey++}`}>
          {inlineNodes(quote.join("\n"))}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={`block-${blockKey++}`} />);
      index += 1;
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p key={`block-${blockKey++}`}>{inlineNodes(paragraph.join("\n"))}</p>,
    );
  }

  return <div className="lumi-chat-markdown">{blocks}</div>;
}

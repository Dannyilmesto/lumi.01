export type WorkspaceSalesPeriod = {
  start: Date;
  end: Date;
  label: string;
  isCurrentMonth: boolean;
  isFuturePeriod: boolean;
};

export type WorkspaceDateRange = {
  start: string;
  end: string;
};

export type WorkspaceCalendarEvent = {
  title: string;
  date: string;
  time: string | null;
  completed: boolean;
  assignedUser: { name: string } | null;
};

export type WorkspaceConversationMessage = {
  role: "USER" | "ASSISTANT";
  content: string;
};

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const monthNumbers: Record<string, number> = {
  gennaio: 0,
  febbraio: 1,
  marzo: 2,
  aprile: 3,
  maggio: 4,
  giugno: 5,
  luglio: 6,
  agosto: 7,
  settembre: 8,
  ottobre: 9,
  novembre: 10,
  dicembre: 11,
};

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("it-IT", {
    month: "long",
    year: "numeric",
  }).format(date);
}

export function workspaceSalesPeriod(
  content: string,
  now = new Date(),
): WorkspaceSalesPeriod {
  const normalized = content.toLocaleLowerCase("it-IT");
  let start: Date;
  let end: Date;
  if (/\b(?:quest'?anno|anno corrente|questo anno)\b/.test(normalized)) {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear() + 1, 0, 1);
  } else if (/\b(?:mese prossimo|prossimo mese)\b/.test(normalized)) {
    start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    end = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  } else if (/\b(?:mese scorso|mese precedente|ultimo mese)\b/.test(normalized)) {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }
  return {
    start,
    end,
    label:
      start.getMonth() === 0 && end.getFullYear() !== start.getFullYear()
        ? `anno ${start.getFullYear()}`
        : monthLabel(start),
    isCurrentMonth:
      start.getFullYear() === now.getFullYear() &&
      start.getMonth() === now.getMonth(),
    isFuturePeriod:
      start.getFullYear() > now.getFullYear() ||
      (start.getFullYear() === now.getFullYear() &&
        start.getMonth() > now.getMonth()),
  };
}

export function workspaceCalendarRange(
  content: string,
  now = new Date(),
): WorkspaceDateRange | null {
  const normalized = content.toLocaleLowerCase("it-IT");
  const explicitDate =
    /\b(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/.exec(normalized);
  if (explicitDate) {
    const date = new Date(
      Number(explicitDate[1]),
      Number(explicitDate[2]) - 1,
      Number(explicitDate[3]),
    );
    if (
      date.getFullYear() === Number(explicitDate[1]) &&
      date.getMonth() === Number(explicitDate[2]) - 1 &&
      date.getDate() === Number(explicitDate[3])
    ) {
      const day = dateKey(date);
      return { start: day, end: day };
    }
  }

  const relativeDay = /\b(oggi|domani|dopodomani|ieri)\b/.exec(normalized)?.[1];
  if (relativeDay) {
    const offset =
      relativeDay === "domani"
        ? 1
        : relativeDay === "dopodomani"
          ? 2
          : relativeDay === "ieri"
            ? -1
            : 0;
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    const day = dateKey(date);
    return { start: day, end: day };
  }

  const namedDate =
    /\b([0-3]?\d)(?:º|°)?\s+(?:di\s+)?(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(20\d{2}))?\b/.exec(
      normalized,
    );
  if (namedDate) {
    const month = monthNumbers[namedDate[2]];
    const year = Number(namedDate[3] ?? now.getFullYear());
    const date = new Date(year, month, Number(namedDate[1]));
    if (
      month !== undefined &&
      date.getMonth() === month &&
      date.getFullYear() === year
    ) {
      const day = dateKey(date);
      return { start: day, end: day };
    }
  }

  const numericDate =
    /\b(?:il\s+)?([0-3]?\d)[/-]([01]?\d)(?:[/-](20\d{2}))?\b/.exec(
      normalized,
    );
  if (numericDate) {
    const year = Number(numericDate[3] ?? now.getFullYear());
    const month = Number(numericDate[2]) - 1;
    const date = new Date(year, month, Number(numericDate[1]));
    if (
      month >= 0 &&
      month <= 11 &&
      date.getMonth() === month &&
      date.getFullYear() === year
    ) {
      const day = dateKey(date);
      return { start: day, end: day };
    }
  }

  const dayOnly = /\b(?:il giorno|il|giorno)\s+([0-3]?\d)\b/.exec(
    normalized,
  );
  if (dayOnly) {
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      Number(dayOnly[1]),
    );
    if (date.getMonth() === now.getMonth()) {
      const day = dateKey(date);
      return { start: day, end: day };
    }
  }

  const asksForRemainderOfMonth =
    /\b(?:resto|rimanent\w*|restant\w*|da oggi|da adesso)\b/.test(
      normalized,
    ) && /\b(?:mese|mensil\w*)\b/.test(normalized);
  if (asksForRemainderOfMonth)
    return {
      start: dateKey(now),
      end: dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    };

  if (/\b(?:mese prossimo|prossimo mese)\b/.test(normalized))
    return {
      start: dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
      end: dateKey(new Date(now.getFullYear(), now.getMonth() + 2, 0)),
    };

  if (/\b(?:questo mese|mese corrente|durante il mese)\b/.test(normalized))
    return {
      start: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    };

  if (/\b(?:mese scorso|mese precedente|ultimo mese)\b/.test(normalized))
    return {
      start: dateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      end: dateKey(new Date(now.getFullYear(), now.getMonth(), 0)),
    };

  const namedMonth =
    /\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(20\d{2}))?\b/.exec(
      normalized,
    );
  if (namedMonth) {
    const month = monthNumbers[namedMonth[1]];
    const year = Number(namedMonth[2] ?? now.getFullYear());
    return {
      start: dateKey(new Date(year, month, 1)),
      end: dateKey(new Date(year, month + 1, 0)),
    };
  }

  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekOffset = /\b(?:settimana prossima|prossima settimana)\b/.test(
    normalized,
  )
    ? 7
    : /\b(?:settimana scorsa|scorsa settimana)\b/.test(normalized)
      ? -7
      : 0;
  if (
    weekOffset !== 0 ||
    /\b(?:questa settimana|settimana corrente)\b/.test(normalized)
  ) {
    const start = new Date(weekStart);
    start.setDate(start.getDate() + weekOffset);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start: dateKey(start), end: dateKey(end) };
  }

  const year = /\b(?:nel|durante|tutto il)?\s*(20\d{2})\b/.exec(normalized)?.[1];
  if (year)
    return {
      start: `${year}-01-01`,
      end: `${year}-12-31`,
    };

  if (/\b(?:quest'?anno|anno corrente|questo anno)\b/.test(normalized))
    return {
      start: `${now.getFullYear()}-01-01`,
      end: `${now.getFullYear()}-12-31`,
    };

  return null;
}

export function stripQuotedTextForIntent(content: string) {
  return content
    .replace(/"[^"]*"|“[^”]*”|‘[^’]*’|`[^`]*`/gs, " ")
    .replace(/(?:^|\n)\s*>[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function workspaceFollowUpIntent(
  content: string,
  history: WorkspaceConversationMessage[],
) {
  const normalized = stripQuotedTextForIntent(content)
    .toLocaleLowerCase("it-IT")
    .replace(/[?!.,;:]+$/g, "")
    .trim();
  if (
    !/^(?:(?:e|allora)\s+)?(?:per\s+)?(?:il\s+)?(?:mese prossimo|prossimo mese)$/.test(
      normalized,
    )
  )
    return null;

  for (const message of [...history].reverse()) {
    if (message.role !== "USER") continue;
    const previous = stripQuotedTextForIntent(message.content);
    const calendar = /\b(calendari\w*|agenda|agend\w*|appuntament\w*|riunion\w*|eventi?|scadenz\w*|impegn\w*)\b/i.test(
      previous,
    );
    const sales = /\b(vendit\w*|vendut\w*|fatturat\w*|incass\w*|ricav\w*|guadagn\w*|preventiv\w*\s+accettat\w*)\b/i.test(
      previous,
    );
    if (calendar || sales) return { calendar, sales };
  }
  return null;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00.000Z`));
}

export function formatWorkspaceDataAnswer(input: {
  sales?: {
    period: WorkspaceSalesPeriod;
    total: number;
    count: number;
  };
  calendar?: {
    range: WorkspaceDateRange | null;
    events: WorkspaceCalendarEvent[];
  };
}) {
  const lines: string[] = [];
  if (input.calendar) {
    const { range, events } = input.calendar;
    const interval = range
      ? `dal ${formatDate(range.start)} al ${formatDate(range.end)}`
      : "dall’inizio alla fine del calendario";
    if (events.length) {
      lines.push(
        `Appuntamenti ${interval} (${events.length} totali):`,
        ...events.map((event) => {
          const time = event.time ? ` alle ${event.time}` : "";
          const assignee = event.assignedUser
            ? ` — ${event.assignedUser.name}`
            : "";
          const completed = event.completed ? " (completato)" : "";
          return `- ${formatDate(event.date)}${time}: ${event.title}${assignee}${completed}`;
        }),
      );
    } else {
      lines.push(
        `Non risultano appuntamenti in Lumi ${interval}.`,
      );
    }
  }

  if (input.sales) {
    const { period, total, count } = input.sales;
    const amount = new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: "EUR",
    }).format(total);
    lines.push(
      period.isFuturePeriod && count === 0
        ? `Per ${period.label} non risultano ancora preventivi accettati o approvati registrati.`
        : `Nel periodo ${period.label} risultano ${amount} su ${count} preventivi accettati o approvati.`,
      period.isFuturePeriod
        ? "È un dato dei preventivi già registrati, non una previsione delle vendite future né un importo incassato."
        : period.isCurrentMonth
        ? "È il valore dei preventivi registrati finora, non una previsione delle vendite future né un importo incassato."
        : "È il valore dei preventivi accettati o approvati, non un importo incassato.",
    );
  }

  return lines.join("\n");
}

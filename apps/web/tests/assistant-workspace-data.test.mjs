import test from "node:test";
import assert from "node:assert/strict";
import {
  formatWorkspaceDataAnswer,
  stripQuotedTextForIntent,
  workspaceCalendarRange,
  workspaceFollowUpIntent,
  workspaceSalesPeriod,
} from "../src/lib/assistant-workspace-data.ts";

test("calendar remainder requests stop at the end of the current month", () => {
  const now = new Date(2026, 9, 3, 12);
  assert.deepEqual(
    workspaceCalendarRange("appuntamenti per il resto del mese", now),
    { start: "2026-10-03", end: "2026-10-31" },
  );
});

test("calendar questions without a time period search the whole timeline", () => {
  assert.equal(
    workspaceCalendarRange("il calendario deve essere consultabile dall'inizio alla fine"),
    null,
  );
});

test("next month requests resolve to the complete following month", () => {
  const now = new Date(2026, 9, 3, 12);
  assert.deepEqual(workspaceCalendarRange("il mese prossimo?", now), {
    start: "2026-11-01",
    end: "2026-11-30",
  });
  const period = workspaceSalesPeriod("il mese prossimo?", now);
  assert.equal(period.label, "novembre 2026");
  assert.equal(period.start.getTime(), new Date(2026, 10, 1).getTime());
  assert.equal(period.end.getTime(), new Date(2026, 11, 1).getTime());
  assert.equal(period.isFuturePeriod, true);
});

test("calendar date questions resolve specific dates and month names", () => {
  const now = new Date(2026, 9, 3, 12);
  assert.deepEqual(
    workspaceCalendarRange("che appuntamenti ho il 12 novembre 2026?", now),
    { start: "2026-11-12", end: "2026-11-12" },
  );
  assert.deepEqual(workspaceCalendarRange("appuntamenti domani", now), {
    start: "2026-10-04",
    end: "2026-10-04",
  });
  assert.deepEqual(workspaceCalendarRange("appuntamenti a novembre", now), {
    start: "2026-11-01",
    end: "2026-11-30",
  });
  assert.deepEqual(workspaceCalendarRange("appuntamenti settimana prossima", now), {
    start: "2026-10-05",
    end: "2026-10-11",
  });
});

test("quoted prior answers do not override the user's current calendar intent", () => {
  const request =
    '"Non posso verificare gli appuntamenti perché non ho accesso al documento e il limite è 2027-01-01." Il calendario deve essere consultabile dall’inizio alla fine.';
  assert.equal(
    stripQuotedTextForIntent(request),
    "Il calendario deve essere consultabile dall’inizio alla fine.",
  );
});

test("temporal follow-ups reuse the latest user calendar and sales topics", () => {
  const history = [
    {
      role: "USER",
      content: "Quali appuntamenti ho e quanto ho venduto questo mese?",
    },
    {
      role: "ASSISTANT",
      content: "Non posso verificare senza un estratto completo del documento.",
    },
    { role: "USER", content: "Conosci che giorno è oggi?" },
    { role: "ASSISTANT", content: "Oggi è 2026-10-03." },
  ];
  assert.deepEqual(workspaceFollowUpIntent("il mese prossimo?", history), {
    calendar: true,
    sales: true,
  });
});

test("sales periods use this month by default and prior month when requested", () => {
  const now = new Date(2026, 9, 3, 12);
  const current = workspaceSalesPeriod("quanto ho venduto questo mese", now);
  assert.equal(current.start.getTime(), new Date(2026, 9, 1).getTime());
  assert.equal(current.end.getTime(), new Date(2026, 10, 1).getTime());
  assert.equal(current.label, "ottobre 2026");
  assert.equal(current.isCurrentMonth, true);

  const previous = workspaceSalesPeriod("vendite del mese scorso", now);
  assert.equal(previous.label, "settembre 2026");
  assert.equal(previous.isCurrentMonth, false);
});

test("workspace answers report actual calendar and sales data without inventing document limits", () => {
  const now = new Date(2026, 9, 3, 12);
  const answer = formatWorkspaceDataAnswer({
    calendar: {
      range: workspaceCalendarRange(
        "appuntamenti per il resto del mese",
        now,
      ),
      events: [
        {
          title: "Riunione cliente",
          date: "2026-10-05",
          time: "10:30",
          completed: false,
          assignedUser: { name: "Ada" },
        },
      ],
    },
    sales: {
      period: workspaceSalesPeriod("vendite questo mese", now),
      total: 1234.5,
      count: 2,
    },
  });

  assert.match(
    answer,
    /dal sabato 3 ottobre 2026 al sabato 31 ottobre 2026/,
  );
  assert.match(answer, /Riunione cliente/);
  assert.match(answer, /(?:1\.234|1234),50.*€/);
  assert.match(answer, /2 preventivi accettati o approvati/);
  assert.match(answer, /non una previsione delle vendite future/);
  assert.doesNotMatch(answer, /documento|estratto|limite raggiunto|2027/);
});

test("full-calendar answers state the entire stored range and total event count", () => {
  const answer = formatWorkspaceDataAnswer({
    calendar: {
      range: null,
      events: [
        {
          title: "Primo appuntamento",
          date: "2024-02-10",
          time: null,
          completed: true,
          assignedUser: null,
        },
      ],
    },
  });
  assert.match(answer, /dall’inizio alla fine del calendario \(1 totali\)/);
  assert.match(answer, /sabato 10 febbraio 2024: Primo appuntamento/);
});

test("full-calendar answers include events beyond the first fifty", () => {
  const events = Array.from({ length: 60 }, (_, index) => ({
    title: `Evento ${index + 1}`,
    date: "2026-10-03",
    time: null,
    completed: false,
    assignedUser: null,
  }));
  const answer = formatWorkspaceDataAnswer({
    calendar: { range: null, events },
  });
  assert.match(answer, /60 totali/);
  assert.match(answer, /Evento 60/);
  assert.doesNotMatch(answer, /altri 10 appuntamenti/);
});

test("future sales answers distinguish registered quotes from forecasts", () => {
  const answer = formatWorkspaceDataAnswer({
    sales: {
      period: workspaceSalesPeriod(
        "vendite il mese prossimo",
        new Date(2026, 9, 3, 12),
      ),
      total: 0,
      count: 0,
    },
  });
  assert.match(answer, /Per novembre 2026 non risultano ancora/);
  assert.match(answer, /non una previsione delle vendite future/);
});

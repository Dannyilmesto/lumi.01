export const profileTabs = [
  { id: "notes", label: "Note", symbol: "▤" },
  { id: "calendar", label: "Calendario", symbol: "▦" },
  { id: "quotes", label: "I miei preventivi", symbol: "▧" },
  { id: "archive", label: "Archivio file", symbol: "▣" },
  { id: "community", label: "Bacheche", symbol: "◎" },
  { id: "messages", label: "Messaggi", symbol: "↗" },
] as const;
export type ProfileTab = (typeof profileTabs)[number]["id"];
export function profileTab(value: string | null): ProfileTab {
  return profileTabs.some((tab) => tab.id === value)
    ? (value as ProfileTab)
    : "notes";
}

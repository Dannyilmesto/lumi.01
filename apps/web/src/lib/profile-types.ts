export type Person = {
  id: string;
  name: string;
  image: string | null;
  isPresetAvatar: boolean;
  avatarPreset: string;
};
export type Profile = Person & { email: string; createdAt: string };
export type Note = {
  id: string;
  title: string;
  content: string;
  link: { type: "customer" | "quote"; id: string; label: string } | null;
  version: number;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};
export type CalendarEntry = {
  id: string;
  title: string;
  date: string;
  time: string | null;
  kind: "event" | "deadline" | "note";
  description: string;
  completed: boolean;
  assignedUserId: string;
  assignedUser: { id: string; name: string; color: string };
  canManage: boolean;
};
export type CalendarMember = { id: string; name: string; color: string };
export type PersonalQuote = {
  id: string;
  title: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  status: string;
  amount: string;
  shareAmount: string | null;
  shareItems: {
    description: string;
    quantity: string;
    unit: string;
    totalPrice: string | null;
  }[];
  currency: string;
  organizationName: string;
  isPublic: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  canShare: boolean;
  updatedAt: string;
};
export type PublicQuoteItem = {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string | null;
  totalPrice: string | null;
};
export type PublicPost = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: Person;
};
export type SharedQuote = {
  id: string;
  title: string;
  amount: string | null;
  currency: string;
  details: PublicQuoteItem[];
  createdAt: string;
  author: Person;
};
export type ChatEntry = {
  id: string;
  type: "direct" | "group";
  name: string | null;
  createdById: string | null;
  lastMessageAt: string;
  members: { user: Person }[];
  preview: string;
};
export type DirectMessage = {
  id: string;
  chatId: string;
  senderId: string | null;
  text: string;
  sequence: string;
  clientId: string;
  createdAt: string;
  sender: Person | null;
};
export type PageResult<T> = { items: T[]; nextOffset: number | null };
const amountFormat = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export function formatAmount(value: string, currency: string) {
  return `${amountFormat.format(Number(value))} ${currency}`;
}

export type WebSource = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  publishedAt?: string;
  retrievedAt: string;
  kind: 'page' | 'search' | 'news' | 'api';
};

export type WebResult = {
  status: 'ok' | 'unavailable' | 'clarification';
  sources: WebSource[];
  data?: unknown;
  message?: string;
};

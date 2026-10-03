import { z } from 'zod';
import type { DocumentSettings } from '@/lib/quote-document-format';

/** Validazione lato server: tenuta separata per non includere zod nel bundle dell'editor. */
export const documentSettingsSchema = z.object({
  format: z.enum(['A4', 'Letter']).default('A4'),
  landscape: z.boolean().default(false),
  margin: z.number().int().min(12).max(35).default(20),
  header: z.string().max(160).default(''),
  footer: z.string().max(160).default(''),
  pageNumbers: z.boolean().default(true),
}) satisfies z.ZodType<DocumentSettings>;

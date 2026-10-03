import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => value || null);

export const contactFields = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(1).max(80),
  company: optionalText(160),
  email: z
    .preprocess(
      (value) =>
        typeof value === 'string' && !value.trim() ? null : value,
      z.string().trim().email().max(254).nullable().optional(),
    )
    .transform((value) => value || null),
  address: optionalText(240),
  postalCode: optionalText(32),
  city: optionalText(100),
  province: optionalText(100),
  country: optionalText(100),
  fiscalCode: optionalText(32),
  vatNumber: optionalText(32),
  notes: optionalText(5000),
});

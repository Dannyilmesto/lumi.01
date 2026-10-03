const formatters = new Map<string, Intl.NumberFormat>();

/** Formattatore valuta condiviso: Intl.NumberFormat è costoso da creare a ogni chiamata. */
export function money(value: number, currency = 'EUR') {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
    formatters.set(currency, formatter);
  }
  return formatter.format(value);
}

/**
 * Resolve the explicit `[year]` token in evergreen page titles and headings.
 * Historical years, product/model years and dates should remain literal.
 * UTC keeps the value consistent across build machines and time zones.
 */
export const currentYear = new Date().getUTCFullYear();

export function renderCurrentYear(value: string): string {
  return value.replaceAll('[year]', String(currentYear));
}

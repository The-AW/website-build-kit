/** Convert a BCP 47 locale to Open Graph's language_TERRITORY form when a region is known. */
export function toOpenGraphLocale(locale: string): string | null {
  if (typeof locale !== 'string' || !locale.trim()) return null;
  const parts = locale.trim().replaceAll('_', '-').split('-');
  const language = parts[0];
  if (!/^[A-Za-z]{2,3}$/.test(language)) return null;
  const region = parts.slice(1).find((part) => /^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part));
  return region ? `${language.toLowerCase()}_${region.toUpperCase()}` : null;
}

/**
 * Accept an absent Origin for native/privacy-tooling requests, but when a
 * browser supplies one require the exact request origin, including scheme and
 * port. Comparing host alone would accept a cross-scheme POST.
 */
export function isSameOrigin(requestUrl: string, origin: string | null): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

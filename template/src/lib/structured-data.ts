const PLACEHOLDER_EXACT = new Set([
  'business name',
  'business name ltd',
  'what you do, in six words',
  'hello@example.com',
  '1 example street',
  'town',
  'neighbouring town',
  'st',
  'state',
  '00000',
  '(000) 000-0000',
  '+00000000000',
]);

export function hasConfiguredText(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  const normalized = text.toLocaleLowerCase('en-US');
  if (!text || PLACEHOLDER_EXACT.has(normalized)) return false;
  if (/\{\{|\}\}|<[^>]+>|\b(?:owner input|todo|placeholder)\b|\.\.\./i.test(text)) return false;
  if (/^one or two sentences\b/i.test(text) || /^example\b/i.test(text)) return false;
  return true;
}

export function isValidHttpsUrl(value: unknown): value is string {
  if (!hasConfiguredText(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !/(?:example\.com|example\.test|\.invalid)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export function isValidPhone(value: unknown): value is string {
  return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value.trim());
}

export function isValidEmail(value: unknown): value is string {
  if (!hasConfiguredText(value) || value.includes('example.com')) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function hasCompletePostalAddress(address: {
  street?: unknown;
  locality?: unknown;
  region?: unknown;
  postalCode?: unknown;
  country?: unknown;
}): boolean {
  return [address.street, address.locality, address.region, address.postalCode, address.country].every(hasConfiguredText);
}

export function isValidCoordinates(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 &&
    (latitude !== 0 || longitude !== 0)
  );
}

const encoder = new TextEncoder();

/** Return a stable opaque bucket key without storing the visitor's IP in the rate-limit key. */
export async function rateLimitKey(ip: string, secret: string): Promise<string> {
  if (!ip || ip.length > 128 || secret.length < 32) throw new Error('rate_limit_configuration_invalid');

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(ip)));
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `contact:${hex}`;
}

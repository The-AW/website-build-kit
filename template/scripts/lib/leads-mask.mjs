/**
 * Mask personal data in a lead row for display (`npm run leads:staging`, `leads:production`).
 *
 * The default view shows enough to recognise a row (who roughly, how to match it to an inbox, when,
 * from which page) and nothing that identifies a person on its own: the name keeps each word's first
 * letter, the email its first letter and TLD, the phone its last two digits, the message only its
 * length, and the user agent is dropped. `--reveal` prints the row as stored.
 */
const word = (w) => (w.length <= 1 ? '*' : `${w[0]}***`);

export function maskName(name) {
  return String(name ?? '').trim().split(/\s+/).filter(Boolean).map(word).join(' ') || '';
}

export function maskEmail(email) {
  const value = String(email ?? '');
  const at = value.lastIndexOf('@');
  if (at < 1) return word(value);
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${word(value.slice(0, at))}@${word(dot > 0 ? domain.slice(0, dot) : domain)}${tld}`;
}

export function maskPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length ? `***${digits.slice(-2)}` : '';
}

export function maskMessage(message) {
  return `[${String(message ?? '').length} characters]`;
}

/** One lead row, masked unless `reveal`. */
export function presentLead(row, { reveal = false } = {}) {
  if (reveal) return { ...row };
  return {
    id: row.id,
    created_at: row.created_at,
    status: row.status,
    name: maskName(row.name),
    email: maskEmail(row.email),
    phone: row.phone ? maskPhone(row.phone) : null,
    consent: row.consent,
    source_url: row.source_url,
    message: maskMessage(row.message),
    user_agent: null,
  };
}

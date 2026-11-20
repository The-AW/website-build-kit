/**
 * Validation for the d1_leads contact form (`POST /api/leads`).
 *
 * Shared by the route and the form component, so the field names cannot drift. Untrusted JSON
 * is validated without coercing objects, arrays or numbers to text, and an unknown key is
 * refused rather than ignored. Every message a visitor can read is in LEAD_MESSAGES: translate
 * them there (and in LeadForm.astro) and nowhere else.
 */
import { NO_UTM, type LeadUtm } from './lead-store.ts';

/** The page the form lives on. Stored as the lead's source_url (no query, no fragment). */
export const CONTACT_PATH = '/contact/';

export const LEAD_MESSAGES = {
  unavailable: 'The form is temporarily unavailable.',
  origin: 'This request is not allowed from this origin.',
  notJson: 'Send the form data as JSON.',
  unreadable: 'We could not read the data you sent.',
  invalidData: 'The data you sent is not valid.',
  fields: 'Check the highlighted fields and try again.',
  rateLimited: 'Too many attempts in a short time. Wait a minute and try again.',
  challenge: 'Complete the security check before sending.',
  challengeInvalid: 'The security check expired or was not completed. Try again.',
  challengeUnavailable: 'We could not verify your request right now. Try again later.',
  notStored: 'We could not confirm that your message was sent. If it is urgent, contact us by phone or email.',
  sent: 'Message sent. Thank you for getting in touch.',
  name: 'Enter your name.',
  nameLong: 'The name must be at most 120 characters.',
  email: 'Enter a valid email address.',
  phone: 'Enter a valid phone number or leave it blank.',
  message: 'Write a message.',
  messageLong: 'The message must be at most 5,000 characters.',
  consent: 'Agree to the use of your data so we can reply.',
  field: 'Fill in this field correctly.',
} as const;

export type LeadField = 'name' | 'email' | 'phone' | 'message' | 'consent';
export type LeadFieldErrors = Partial<Record<LeadField, string>>;

export type ValidatedLeadSubmission = {
  name: string;
  email: string;
  phone: string | null;
  message: string;
  turnstileToken: string;
  consent: true;
  utm: LeadUtm;
};

export type LeadValidationResult =
  | { ok: true; value: ValidatedLeadSubmission }
  | { ok: false; errors: LeadFieldErrors };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const PHONE = /^[0-9+().\-\s]*$/;
const ALLOWED_KEYS = new Set(['name', 'email', 'phone', 'message', 'turnstileToken', 'consent', 'utm']);
const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;
const MAX_UTM = 200;

/**
 * The form's `utm` object ({ source, medium, … } read from the page URL). Lenient on purpose: a
 * malformed or oversized UTM becomes NULL; it never costs the visitor their lead.
 */
export function normaliseUtm(input: unknown): LeadUtm {
  const utm: LeadUtm = { ...NO_UTM };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return utm;
  const record = input as Record<string, unknown>;
  for (const key of UTM_KEYS) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed && trimmed.length <= MAX_UTM) utm[key] = trimmed;
  }
  return utm;
}

export function validateLeadSubmission(input: unknown): LeadValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: { message: LEAD_MESSAGES.unreadable } };
  }

  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_KEYS.has(key))) {
    return { ok: false, errors: { message: LEAD_MESSAGES.invalidData } };
  }

  const errors: LeadFieldErrors = {};
  for (const field of ['name', 'email', 'message'] as const) {
    if (typeof record[field] !== 'string') errors[field] = LEAD_MESSAGES.field;
  }
  // The phone is optional: absent, null and '' all mean "not given"; anything else must be text.
  if (record.phone !== undefined && record.phone !== null && typeof record.phone !== 'string') errors.phone = LEAD_MESSAGES.field;
  if (Object.keys(errors).length) return { ok: false, errors };

  const name = (record.name as string).trim();
  const email = (record.email as string).trim();
  const phoneInput = typeof record.phone === 'string' ? record.phone.trim() : '';
  const message = (record.message as string).trim();
  const token = typeof record.turnstileToken === 'string' ? record.turnstileToken.trim() : '';

  if (name.length < 2) errors.name = LEAD_MESSAGES.name;
  else if (name.length > 120) errors.name = LEAD_MESSAGES.nameLong;

  if (email.length < 3 || email.length > 254 || !EMAIL.test(email)) errors.email = LEAD_MESSAGES.email;

  const digits = phoneInput.replace(/\D/g, '').length;
  if (phoneInput.length > 40 || (phoneInput && (!PHONE.test(phoneInput) || digits < 7 || digits > 15))) {
    errors.phone = LEAD_MESSAGES.phone;
  }

  if (!message) errors.message = LEAD_MESSAGES.message;
  else if (message.length > 5000) errors.message = LEAD_MESSAGES.messageLong;

  if (record.consent !== true) errors.consent = LEAD_MESSAGES.consent;

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, email, phone: phoneInput || null, message, turnstileToken: token, consent: true, utm: normaliseUtm(record.utm) } };
}

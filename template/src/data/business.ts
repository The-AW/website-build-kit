/**
 * The one place business facts live.
 *
 * Both the visible UI and the JSON-LD structured data read from here, so the
 * page and the schema can never drift apart. Change a phone number here and it
 * updates the header, footer, every call-to-action and what Google reads.
 *
 * ── FILL THIS IN FIRST. Everything else depends on it. ─────────────────────
 */

/*
 * ── ONE NUMBER, ONE ADDRESS, WRITTEN ONCE ──────────────────────────────────
 *
 * ⚠ `tel:` AND `sms:` USED TO BE FIELDS OF THEIR OWN, so this file held FOUR
 *   copies of the phone number and TWO of the email address. That is the shape
 *   this kit warns about everywhere else — *never store a derived value; two
 *   fields holding one fact is how a tap-to-call button ends up dialling last
 *   year's number.* Somebody changes the number they can SEE, in `display`, and
 *   has no reason to suspect a second copy two lines below it.
 *
 * So the links are built, not typed. What remains is the one pair that cannot
 * be derived either way: `display` is locale formatting and `e164` needs the
 * country code, and no amount of string work turns one into the other. That
 * pair is what `npm run check:contact` compares.
 */
const PHONE_E164 = '+00000000000'; // E.164 WITH the country code — schema.org and tel: need it
const EMAIL = 'hello@example.com';

export const business = {
  name: 'Business Name',

  /**
   * BCP 47 language tag. Drives `<html lang>` and `inLanguage` in structured data.
   *
   * ⚠ SET THIS. The template shipped `en-US` hardcoded in five files while its
   * own compliance reference covered the EAA, UK GDPR and AODA — so a British
   * or Canadian build announced itself as American to every screen reader and
   * every crawler, and printed dates in the wrong order.
   */
  locale: 'en',
  legalName: 'Business Name Ltd',
  tagline: 'What you do, in six words',
  description:
    'One or two sentences that would make sense read aloud on the phone. This becomes the ' +
    'default meta description and the Organization description in structured data.',
  foundedYear: null as number | null,

  phone: {
    /* What a visitor READS, in local convention. The only phone field a client
       ever asks you to change — and the reason the two below are derived. */
    display: '(000) 000-0000',
    e164: PHONE_E164,
    href: `tel:${PHONE_E164}`,
    sms: `sms:${PHONE_E164}`,
  },

  email: {
    display: EMAIL, // shown on the site
    href: `mailto:${EMAIL}`,
  },

  address: {
    street: '1 Example Street',
    locality: 'Town',
    region: 'ST',
    regionName: 'State',
    /**
     * IANA timezone, used for dates rendered in the site's local context.
     */
    timeZone: 'UTC',
    /** Short label printed after the time. Keep it in step with `timeZone`. */
    timeZoneLabel: 'UTC',
    postalCode: '00000',
    country: 'US',
    mapUrl: 'https://maps.google.com/?q=...',
  },

  /** Used by LocalBusiness JSON-LD. Get them from Google Maps. */
  geo: { latitude: null as number | null, longitude: null as number | null },

  hours: {
    days: [] as string[],
    opens: '',
    closes: '',
    display: '',
  },

  priceRange: '',

  /**
   * schema.org types for the organisation node, most general first.
   *
   * ⚠ The default is Organization only. Set a subtype only when the site really
   *   represents that business and the required facts are public and verified.
   *   The template once shipped `LocalBusiness` for every site, even when no
   *   address or local presence was supplied. That was a specific false claim.
   *
   * A site may add a LocalBusiness subtype only after verifying its public facts.
   * The builder requires a complete address before emitting one.
   *
   * The template previously shipped `HVACBusiness` hardcoded for two projects, so every site
   * built from it silently declared itself a heating and ventilation company
   * to Google — valid markup, clean build, wrong business.
   *
   * A wrong subtype is worse than no subtype: it is a specific claim, and rich
   * results and local classification act on it. Pick from the LocalBusiness
   * subtypes at https://schema.org/LocalBusiness — e.g. `Dentist`, `Plumber`,
   * `HealthClub`, `LegalService`. If nothing fits exactly, leave it out.
   */
  schemaTypes: ['Organization'] as string[],

  /**
   * Media-manifest key or emitted src for structured data, or null.
   *
   * Null by default because the template ships no brand assets, and a schema
   * `logo` pointing at a 404 is a warning in Search Console that nothing in a
   * build would surface. Set it only after `npm run media` has generated the
   * real image and its manifest entry; otherwise leave it null.
   */
  logoPath: null as string | null,

  /** Drives areaServed in structured data, and the footer list. */
  serviceAreas: [] as string[],

  /** Enable only after the site's actual service catalog and terms are reviewed. */
  schemaOfferCatalog: false,

  serviceAreaSummary: 'Serving Town and the surrounding area.',

  /**
   * Accreditations and credential badges. `image` is a manifest key, not a URL.
   * Check the artwork before designing the strip around it — badges are often
   * near-white PNGs drawn for a dark background.
   */
  credentials: [] as { name: string; image: string }[],

  socials: [] as { name: string; url: string }[],

  credit: { name: '', url: '' },
} as const;

export const addressOneLine = `${business.address.street}, ${business.address.locality}, ${business.address.region} ${business.address.postalCode}`;

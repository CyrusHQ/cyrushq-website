# portal-overrides.json — Override Notes

These entries grant portal access outside the standard Stripe email lookup.
Used by both `send-access-link.js` and `verify-token.js` (single source of truth).

**When to add an entry:**
- Customer used a typo email at checkout (immutable on the charge)
- Stripe charge has no product metadata (early/manual purchases)
- Complete Bundle or other payment-link purchases where metadata doesn't propagate to the charge

**Format:** `"email@example.com": ["product-id-1", "product-id-2"]`

**Valid product IDs:** `build-your-ai-ceo` · `cron-job-mastery` · `ai-ceo-starter-kit`

---

## Entries

| Email | Products | Reason | Added |
|---|---|---|---|
| beth.shaffer66@gmail.com | course + cron + kit | Early buyer — pre-Stripe-metadata era (Aug 2026) | 2026-08-17 |
| wmp@journeydigital.net | course + kit | Early buyer — pre-Stripe-metadata era (Aug 2026) | 2026-08-17 |
| y.a.j.w84@gmail.com | course + cron + kit | Early buyer — pre-Stripe-metadata era (Aug 2026) | 2026-08-17 |
| bwhit54@yahoo.com | course + cron + kit | Early buyer — pre-Stripe-metadata era (Aug 2026) | 2026-08-17 |
| omnath81@gmail.com | course + cron + kit | Early buyer — pre-Stripe-metadata era (Aug 2026) | 2026-08-17 |
| tools@omegabreweronline.com | course + cron + kit | Early buyer — pre-Stripe-metadata era (Aug 2026) | 2026-08-17 |
| gessick@gmail.com | course + cron + kit | Early buyer — pre-Stripe-metadata era (Aug 2026) | 2026-08-17 |
| pgarduque1@gmail.com | course + cron | Early buyer — pre-Stripe-metadata era (Aug 2026) | 2026-08-17 |
| oburg004@gmail.com | course + cron + kit | Early buyer — pre-Stripe-metadata era (Aug 2026) | 2026-08-17 |
| rwhytemere82@gmail.com | course + cron + kit | Early buyer — pre-Stripe-metadata era (Aug 2026) | 2026-08-17 |
| talent@christyprais.com | course + kit | Early buyer — pre-Stripe-metadata era (Aug 2026) | 2026-08-17 |
| socialsimplicity4you@gmail.com | course + kit | Early buyer — pre-Stripe-metadata era (Aug 2026) | 2026-08-17 |
| info@praisstone.com | course + cron + kit | Early buyer — pre-Stripe-metadata era (Aug 2026) | 2026-08-17 |
| ethalycecloser@gmail.com | course + cron + kit | Complete Bundle $127 — Stripe pi_3UEDH3Dl0ECsHFXr47uPAozF — no metadata on charge, manually enrolled (2026-09-10) | 2026-09-10 |
| wbasquiat@yahoo.com | course + cron + kit | Typo email at checkout (wbasquiat@**tahoo**.com → yahoo.com) — charges ch_3URwKKDl0ECsHFXr197udvmZ + ch_3URwKYDl0ECsHFXr4blvxIfj + ch_3URwKrDl0ECsHFXr08LZ5gTO — Cyrus approval 2026-10-18 | 2026-10-18 |

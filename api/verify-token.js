// GET /api/verify-token?t=TOKEN&e=EMAIL
// Validates HMAC magic link token and returns purchased products

import { createHmac, timingSafeEqual } from 'crypto';

const COURSE_PRODUCT_IDS = ['build-your-ai-ceo', 'cron-job-mastery'];

function generateToken(secret, email) {
  return createHmac('sha256', secret)
    .update(`${secret}:${email.toLowerCase().trim()}`)
    .digest('hex');
}

function loadOverrides() {
  // Hardcoded confirmed buyers — updated from Stripe on 2026-08-17
  // New buyers are handled via live Stripe lookup; this covers early/legacy buyers
  return {
    'beth.shaffer66@gmail.com': ['build-your-ai-ceo', 'cron-job-mastery', 'ai-ceo-starter-kit'],
    'wmp@journeydigital.net': ['build-your-ai-ceo', 'ai-ceo-starter-kit'],
    'y.a.j.w84@gmail.com': ['build-your-ai-ceo', 'cron-job-mastery', 'ai-ceo-starter-kit'],
    'bwhit54@yahoo.com': ['build-your-ai-ceo', 'cron-job-mastery', 'ai-ceo-starter-kit'],
    'omnath81@gmail.com': ['build-your-ai-ceo', 'cron-job-mastery', 'ai-ceo-starter-kit'],
    'tools@omegabreweronline.com': ['build-your-ai-ceo', 'cron-job-mastery', 'ai-ceo-starter-kit'],
    'gessick@gmail.com': ['build-your-ai-ceo', 'cron-job-mastery', 'ai-ceo-starter-kit'],
    'pgarduque1@gmail.com': ['build-your-ai-ceo', 'cron-job-mastery'],
    'oburg004@gmail.com': ['build-your-ai-ceo', 'cron-job-mastery', 'ai-ceo-starter-kit'],
    'rwhytemere82@gmail.com': ['build-your-ai-ceo', 'cron-job-mastery', 'ai-ceo-starter-kit'],
    'talent@christyprais.com': ['build-your-ai-ceo', 'ai-ceo-starter-kit'],
    'socialsimplicity4you@gmail.com': ['build-your-ai-ceo', 'ai-ceo-starter-kit'],
    'info@praisstone.com': ['build-your-ai-ceo'],
    'info@discoveringtruehealth.com': ['build-your-ai-ceo', 'cron-job-mastery', 'ai-ceo-starter-kit']
  };
}

async function getStripeProducts(email) {
  const STRIPE_KEY = process.env.STRIPE_API_KEY;
  if (!STRIPE_KEY) return [];

  const normalEmail = email.toLowerCase().trim();
  const products = new Set();

  try {
    // Fetch charges (up to 100)
    const res = await fetch('https://api.stripe.com/v1/charges?limit=100', {
      headers: {
        Authorization: `Basic ${Buffer.from(`${STRIPE_KEY}:`).toString('base64')}`
      }
    });

    if (!res.ok) {
      console.error('Stripe charges fetch failed:', res.status);
      return [];
    }

    const data = await res.json();
    const charges = data.data || [];

    for (const charge of charges) {
      if (charge.status !== 'succeeded') continue;

      const meta = charge.metadata || {};
      const chargeEmail = (meta.customer_email || charge.receipt_email || '').toLowerCase().trim();

      if (chargeEmail !== normalEmail) continue;

      const product = meta.product || '';
      if (COURSE_PRODUCT_IDS.includes(product)) {
        products.add(product);
      }

      // complete-bundle includes both
      if (product === 'complete-bundle') {
        products.add('build-your-ai-ceo');
        products.add('cron-job-mastery');
      }

      // build-your-ai-ceo upsells include the main course
      if (['ai-ceo-starter-kit'].includes(product) && products.size === 0) {
        // starter kit alone doesn't grant course access unless main course purchased too
      }
    }
  } catch (err) {
    console.error('Stripe query error:', err.message);
  }

  return [...products];
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { t: token, e: encodedEmail } = req.query;

  if (!token || !encodedEmail) {
    return res.status(400).json({ valid: false, error: 'Missing token or email parameter' });
  }

  const email = decodeURIComponent(encodedEmail).toLowerCase().trim();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ valid: false, error: 'Invalid email' });
  }

  const PORTAL_SECRET = process.env.PORTAL_SECRET;
  if (!PORTAL_SECRET) {
    console.error('PORTAL_SECRET not set');
    return res.status(500).json({ valid: false, error: 'Server configuration error' });
  }

  // Recompute expected token
  const expected = generateToken(PORTAL_SECRET, email);

  // Timing-safe comparison
  let tokenMatch = false;
  try {
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(token, 'hex');
    if (expectedBuf.length === providedBuf.length) {
      tokenMatch = timingSafeEqual(expectedBuf, providedBuf);
    }
  } catch {
    tokenMatch = false;
  }

  if (!tokenMatch) {
    return res.status(200).json({ valid: false, error: 'Invalid access link' });
  }

  // Token is valid — load products (overrides first, then Stripe live lookup)
  const overrides = loadOverrides();
  const overrideProducts = overrides[email] || overrides[email.toLowerCase()] || [];
  const stripeProducts = await getStripeProducts(email);
  const allProducts = [...new Set([...overrideProducts, ...stripeProducts])];

  return res.status(200).json({
    valid: true,
    email,
    products: allProducts
  });
}

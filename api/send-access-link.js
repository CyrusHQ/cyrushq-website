// POST /api/send-access-link
// Validates purchase, generates HMAC magic link, sends via GHL email

import { createHmac } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';

const COURSE_PRODUCT_IDS = ['build-your-ai-ceo', 'cron-job-mastery'];

function generateToken(secret, email) {
  return createHmac('sha256', secret)
    .update(`${secret}:${email.toLowerCase().trim()}`)
    .digest('hex');
}

async function loadOverrides() {
  try {
    const filePath = join(process.cwd(), 'api', 'portal-overrides.json');
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function getStripeProducts(email) {
  const STRIPE_KEY = process.env.STRIPE_API_KEY;
  if (!STRIPE_KEY) return [];

  const normalEmail = email.toLowerCase().trim();
  const products = new Set();

  try {
    const res = await fetch('https://api.stripe.com/v1/charges?limit=100', {
      headers: {
        Authorization: `Basic ${Buffer.from(`${STRIPE_KEY}:`).toString('base64')}`
      }
    });

    if (!res.ok) return [];

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
      if (product === 'complete-bundle') {
        products.add('build-your-ai-ceo');
        products.add('cron-job-mastery');
      }
    }
  } catch (err) {
    console.error('Stripe query error:', err.message);
  }

  return [...products];
}

async function sendGHLEmail({ email, firstName, magicLink }) {
  const hexKey = process.env.GHL_API_KEY || '';
  const GHL_API_KEY = /^[0-9a-f]+$/i.test(hexKey)
    ? Buffer.from(hexKey, 'hex').toString('utf8').trim()
    : hexKey.trim();

  const GHL_LOCATION_ID = 'FitEZb4RfLdF1TkKxZEC';
  const GHL_BASE = 'https://services.leadconnectorhq.com';
  const GHL_HEADERS = {
    Authorization: `Bearer ${GHL_API_KEY}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28'
  };

  // Upsert contact
  const contactRes = await fetch(`${GHL_BASE}/contacts/`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({
      email,
      firstName,
      locationId: GHL_LOCATION_ID,
      tags: ['cyrushq-customer', 'magic-link-requested']
    })
  });

  const contactData = await contactRes.json();
  const contactId = contactData.contact?.id || contactData.meta?.contactId;

  if (!contactId) {
    console.error('GHL contact upsert failed:', JSON.stringify(contactData));
    return false;
  }

  const emailBody = `
<div style="font-family:'Inter',Arial,sans-serif; max-width:600px; margin:0 auto; color:#1a1a2e; background:#ffffff;">

  <!-- Header -->
  <div style="background:#070A13; padding:32px; text-align:center; border-bottom:2px solid #C9A84C;">
    <h1 style="color:#C9A84C; margin:0; font-size:24px; letter-spacing:3px; font-family:Georgia,'Playfair Display',serif;">CYRUSHQ.AI</h1>
    <p style="color:#8BA3C4; margin:8px 0 0; font-size:13px; letter-spacing:1px;">Build Your AI CEO — Course Portal</p>
  </div>

  <!-- Body -->
  <div style="padding:48px 40px; background:#ffffff;">
    <h2 style="color:#070A13; margin:0 0 16px; font-family:Georgia,'Playfair Display',serif; font-size:24px;">
      Your access link is ready. 👑
    </h2>
    <p style="color:#555; line-height:1.7; margin:0 0 32px; font-size:15px;">
      Here's your instant access link. Click below — no password needed.
    </p>

    <!-- CTA Button -->
    <div style="text-align:center; margin:0 0 32px;">
      <a href="${magicLink}"
         style="display:inline-block; background:#C9A84C; color:#070A13; padding:20px 40px;
                text-decoration:none; font-weight:700; font-size:16px; letter-spacing:1.5px;
                text-transform:uppercase; font-family:'Inter',Arial,sans-serif;">
        Access My Course Portal →
      </a>
    </div>

    <!-- Bookmark note -->
    <div style="background:#f8f6f1; border:1px solid #e5e7eb; border-radius:8px; padding:16px 20px; margin:0 0 28px; text-align:center;">
      <p style="color:#555; font-size:13px; margin:0; line-height:1.6;">
        🔖 <strong>Bookmark this link for instant access anytime.</strong><br>
        It's unique to you and never expires — no password needed.
      </p>
    </div>

    <p style="color:#888; font-size:13px; line-height:1.6; margin:0;">
      Questions? Just reply to this email — we're fast.<br>
      <a href="mailto:hello@recaptureleads.com" style="color:#C9A84C; text-decoration:none;">hello@recaptureleads.com</a>
    </p>
  </div>

  <!-- Footer -->
  <div style="background:#F8F6F1; padding:20px 32px; text-align:center; border-top:2px solid #C9A84C;">
    <p style="color:#888; font-size:12px; margin:0; line-height:1.7;">
      © 2026 CyrusHQ · <a href="https://cyrushq.ai" style="color:#C9A84C; text-decoration:none;">cyrushq.ai</a> · <a href="mailto:hello@recaptureleads.com" style="color:#C9A84C; text-decoration:none;">hello@recaptureleads.com</a><br>
      Build wisely. Lead calmly. Create systems that endure.
    </p>
  </div>

</div>`.trim();

  const emailRes = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({
      type: 'Email',
      contactId,
      subject: 'Your CyrusHQ access link is ready 👑',
      html: emailBody,
      fromName: 'CyrusHQ Team',
      from: 'hello@recaptureleads.com',
      to: email
    })
  });

  const emailData = await emailRes.json();
  console.log('GHL magic link email result:', JSON.stringify(emailData));
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const rawEmail = (body?.email || '').trim();
  if (!rawEmail || !rawEmail.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  const email = rawEmail.toLowerCase().trim();

  const PORTAL_SECRET = process.env.PORTAL_SECRET;
  if (!PORTAL_SECRET) {
    console.error('PORTAL_SECRET not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Check purchases
  const [stripeProducts, overrides] = await Promise.all([
    getStripeProducts(email),
    loadOverrides()
  ]);

  const overrideProducts = overrides[email] || [];
  const allProducts = [...new Set([...stripeProducts, ...overrideProducts])];

  if (allProducts.length === 0) {
    return res.status(200).json({
      error: "No purchase found for this email. Please check you're using the email you purchased with, or contact hello@recaptureleads.com"
    });
  }

  // Generate magic link
  const token = generateToken(PORTAL_SECRET, email);
  const magicLink = `https://cyrushq.ai/members?t=${token}&e=${encodeURIComponent(email)}`;

  // Extract first name
  // Send email via GHL
  try {
    await sendGHLEmail({ email, firstName: '', magicLink });
  } catch (err) {
    console.error('GHL email send error:', err.message);
    return res.status(500).json({ error: 'Failed to send access email. Please try again or contact hello@recaptureleads.com' });
  }

  return res.status(200).json({
    success: true,
    message: 'Access link sent — check your inbox'
  });
}

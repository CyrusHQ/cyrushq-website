// POST /api/upsell-cron

async function sendCronEmail(email, name) {
  const hexKey = process.env.GHL_API_KEY || '';
  const GHL_API_KEY = hexKey.match(/^[0-9a-f]+$/i)
    ? Buffer.from(hexKey, 'hex').toString('utf8').trim()
    : hexKey.trim();
  const GHL_LOCATION_ID = 'FitEZb4RfLdF1TkKxZEC';
  const GHL_BASE = 'https://services.leadconnectorhq.com';
  const GHL_HEADERS = {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28'
  };

  // Upsert contact and tag
  const contactRes = await fetch(`${GHL_BASE}/contacts/`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({
      email,
      firstName: (name || 'Friend').split(' ')[0],
      lastName: (name || '').split(' ').slice(1).join(' ') || '',
      locationId: GHL_LOCATION_ID,
      tags: ['bought-cron-mastery', 'cyrushq-customer']
    })
  });
  const contactData = await contactRes.json();
  const contactId = contactData.contact?.id;
  if (!contactId) { console.error('GHL cron contact error:', JSON.stringify(contactData)); return; }

  const emailBody = `
<div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #1a1a2e;">
  <div style="background: #0A1628; padding: 32px; text-align: center;">
    <h1 style="color: #C9A84C; margin: 0; font-size: 24px; letter-spacing: 2px;">CYRUSHQ.AI</h1>
    <p style="color: #8BA3C4; margin: 8px 0 0; font-size: 13px;">Your AI CEO System</p>
  </div>
  <div style="padding: 40px 32px; background: #fff;">
    <h2 style="color: #0A1628; margin: 0 0 16px;">Your Cron Job Mastery Module is ready. 👑</h2>
    <p style="color: #555; line-height: 1.6; margin: 0 0 24px;">
      Thank you for adding the <strong>Cron Job Mastery Module</strong> — your 3-video bonus series is waiting for you inside your course portal.
    </p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="https://cyrushq.ai/members"
         style="background: #C9A84C; color: #0A1628; padding: 16px 36px;
                text-decoration: none; font-weight: 700; font-size: 16px;
                display: inline-block; letter-spacing: 1px;">
        ACCESS YOUR COURSE PORTAL →
      </a>
    </div>
    <p style="color: #888; font-size: 13px; margin: 24px 0 0; line-height: 1.5;">
      Save this email — your portal link is permanent.<br>
      Questions? Reply to this email or reach us at hello@cyrushq.ai
    </p>
  </div>
  <div style="background: #F8F6F1; padding: 20px 32px; text-align: center; border-top: 2px solid #C9A84C;">
    <p style="color: #888; font-size: 12px; margin: 0;">
      © CyrusHQ · cyrushq.ai · hello@cyrushq.ai<br>
      Build wisely. Lead calmly. Create systems that endure.
    </p>
  </div>
</div>
  `.trim();

  await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({
      type: 'Email',
      contactId,
      subject: 'Your Cron Job Mastery Module — Access Inside 👑',
      html: emailBody,
      from: 'hello@cyrushq.ai',
      to: email
    })
  });
}
// One-click $9.99 charge for Cron Job Mastery Module
// Uses same customer + payment method from original checkout PaymentIntent

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const { sessionId } = req.body;

  if (!sessionId) return res.status(400).json({ error: 'Missing session ID.' });

  // Test mode bypass
  if (sessionId === 'test_bypass') {
    console.log('[TEST MODE] Cron upsell bypass — skipping Stripe');
    return res.status(200).json({ success: true });
  }

  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
  const STRIPE_BASE   = 'https://api.stripe.com/v1';
  const headers = {
    'Authorization': `Bearer ${STRIPE_SECRET}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  };

  try {
    // 1. Retrieve original PaymentIntent to get customer + payment method
    const piRes = await fetch(`${STRIPE_BASE}/payment_intents/${sessionId}`, { headers });
    const pi    = await piRes.json();

    if (!pi.customer || !pi.payment_method) {
      return res.status(400).json({ error: 'Could not retrieve payment details. Please contact hello@cyrushq.ai' });
    }

    const email = pi.metadata?.customer_email || '';
    const name  = pi.metadata?.customer_name  || '';

    // 2. Charge $9.99 using the same payment method — one click, no new card entry
    const upsellBody = new URLSearchParams({
      amount:           '999',
      currency:         'usd',
      customer:         pi.customer,
      payment_method:   pi.payment_method,
      confirm:          'true',
      'automatic_payment_methods[enabled]': 'true',
      'automatic_payment_methods[allow_redirects]': 'never',
      receipt_email:    email,
      description:      'Cron Job Mastery Module — AI CEO Add-On',
      'metadata[product]':        'cron-job-mastery',
      'metadata[customer_name]':  name,
      'metadata[customer_email]': email
    });

    const upiRes = await fetch(`${STRIPE_BASE}/payment_intents`, { method: 'POST', headers, body: upsellBody });
    const upi    = await upiRes.json();

    if (upi.error || (upi.status !== 'succeeded' && upi.status !== 'processing')) {
      console.error('Cron upsell charge error:', upi.error || upi.status);
      return res.status(400).json({ error: upi.error?.message || 'Payment failed. Please contact hello@cyrushq.ai' });
    }

    console.log(`Cron upsell succeeded for ${email} — PI: ${upi.id}`);

    // Send fulfillment email with portal link
    try { await sendCronEmail(email, name); } catch (e) { console.error('Cron email error:', e); }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('upsell-cron error:', err);
    return res.status(500).json({ error: 'Server error. Contact hello@cyrushq.ai' });
  }
}

// POST /api/upsell-cron
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
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('upsell-cron error:', err);
    return res.status(500).json({ error: 'Server error. Contact hello@cyrushq.ai' });
  }
}

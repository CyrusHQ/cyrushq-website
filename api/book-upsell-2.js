// POST /api/book-upsell-2
// One-click $47 charge for AI CEO Starter Kit — 29 Operating Files (book funnel)
// Uses same customer + payment method from original book bundle checkout PaymentIntent

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const { sessionId, email, source } = req.body;

  if (!sessionId) return res.status(400).json({ error: 'Missing session ID.' });

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
      return res.status(400).json({ error: 'Could not retrieve payment details.' });
    }

    const customerEmail = pi.metadata?.customer_email || email || '';
    const customerName  = pi.metadata?.customer_name  || '';
    const adSource      = source || pi.metadata?.ad_source || 'organic';

    // 2. Charge $47 using the same payment method
    const upsellBody = new URLSearchParams({
      amount:           '4700',
      currency:         'usd',
      customer:         pi.customer,
      payment_method:   pi.payment_method,
      confirm:          'true',
      'automatic_payment_methods[enabled]': 'true',
      'automatic_payment_methods[allow_redirects]': 'never',
      receipt_email:    customerEmail,
      description:      'AI CEO Starter Kit — 29 Operating Files',
      'metadata[product]':          'ai-ceo-starter-kit',
      'metadata[customer_name]':    customerName,
      'metadata[customer_email]':   customerEmail,
      'metadata[ad_source]':        adSource,
      'metadata[funnel]':           'book-bundle'
    });

    const upiRes = await fetch(`${STRIPE_BASE}/payment_intents`, { method: 'POST', headers, body: upsellBody });
    const upi    = await upiRes.json();

    if (upi.error || (upi.status !== 'succeeded' && upi.status !== 'processing')) {
      console.error('Book upsell-2 charge error:', upi.error || upi.status);
      return res.status(400).json({ error: upi.error?.message || 'Payment failed. Please try again.' });
    }

    console.log(`Book upsell-2 (starter kit $47) succeeded for ${customerEmail} — PI: ${upi.id}`);
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('book-upsell-2 error:', err);
    return res.status(500).json({ error: 'Server error. Contact hello@cyrushq.ai' });
  }
}

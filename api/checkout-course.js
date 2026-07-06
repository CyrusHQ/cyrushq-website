// POST /api/checkout-course
// Creates a Stripe PaymentIntent for the course (+ optional cron bump)
// Returns { clientSecret, redirectUrl } or { requiresAction, clientSecret }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const { paymentMethodId, email, name, hasCronBump } = req.body;

  if (!paymentMethodId || !email || !name) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
  const STRIPE_BASE   = 'https://api.stripe.com/v1';
  const headers = {
    'Authorization': `Bearer ${STRIPE_SECRET}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  };

  // Price: $27 core + optional $9.99 cron bump
  const amountCents = hasCronBump ? 3699 : 2700;

  try {
    // 1. Find or create Stripe customer
    const custSearchRes = await fetch(
      `${STRIPE_BASE}/customers/search?query=email:'${encodeURIComponent(email)}'&limit=1`,
      { headers }
    );
    const custSearch = await custSearchRes.json();
    let customerId;

    if (custSearch.data && custSearch.data.length > 0) {
      customerId = custSearch.data[0].id;
    } else {
      const custBody = new URLSearchParams({ email, name });
      const custRes  = await fetch(`${STRIPE_BASE}/customers`, { method: 'POST', headers, body: custBody });
      const custData = await custRes.json();
      if (custData.error) {
        console.error('Stripe customer creation error:', JSON.stringify(custData.error));
        return res.status(500).json({ error: custData.error.message || 'Could not create customer.' });
      }
      customerId = custData.id;
    }

    if (!customerId) {
      console.error('Customer search result:', JSON.stringify(custSearch));
      return res.status(500).json({ error: 'Could not create customer — check Stripe API key permissions.' });
    }

    // 2. Attach payment method to customer
    await fetch(`${STRIPE_BASE}/payment_methods/${paymentMethodId}/attach`, {
      method: 'POST',
      headers,
      body: new URLSearchParams({ customer: customerId })
    });

    // 3. Create PaymentIntent
    const piBody = new URLSearchParams({
      amount:                   String(amountCents),
      currency:                 'usd',
      customer:                 customerId,
      payment_method:           paymentMethodId,
      confirm:                  'true',
      'automatic_payment_methods[enabled]': 'true',
      'automatic_payment_methods[allow_redirects]': 'never',
      receipt_email:            email,
      description:              hasCronBump ? 'Build Your AI CEO + Cron Job Module' : 'Build Your AI CEO Course',
      'metadata[product]':      'build-your-ai-ceo',
      'metadata[has_cron_bump]': hasCronBump ? 'true' : 'false',
      'metadata[customer_name]': name,
      'metadata[customer_email]': email
    });

    const piRes  = await fetch(`${STRIPE_BASE}/payment_intents`, { method: 'POST', headers, body: piBody });
    const pi     = await piRes.json();

    if (pi.error) {
      console.error('Stripe PI error:', pi.error);
      return res.status(400).json({ error: pi.error.message || 'Payment failed. Please try again.' });
    }

    if (pi.status === 'requires_action') {
      return res.status(200).json({
        requiresAction: true,
        clientSecret: pi.client_secret
      });
    }

    if (pi.status === 'succeeded') {
      return res.status(200).json({
        success: true,
        redirectUrl: `/upgrade?session_id=${pi.id}&email=${encodeURIComponent(email)}`
      });
    }

    return res.status(400).json({ error: 'Payment could not be completed. Please try again.' });

  } catch (err) {
    console.error('checkout-course error:', err);
    return res.status(500).json({ error: 'Server error. Please try again or contact hello@cyrushq.ai' });
  }
}

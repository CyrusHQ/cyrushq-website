// POST /api/checkout-course-pro
// Creates a Stripe PaymentIntent for the $97 AI CEO Implementation Program
// Identical flow to checkout-course.js — price and product key differ only

const PIXEL_ID = '898060140812365';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

async function hashSHA256(value) {
  const crypto = await import('crypto');
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

async function sendMetaCAPIInitiateCheckout({ email, fbp, fbc, eventSourceUrl, eventId, amountCents, productKey, productName }) {
  if (!META_ACCESS_TOKEN || !eventId) return;
  try {
    const hashedEmail = await hashSHA256(email);
    const userData = { em: [hashedEmail], external_id: [hashedEmail], client_user_agent: 'Mozilla/5.0 (server-side event)' };
    if (fbp) userData.fbp = fbp;
    if (fbc) userData.fbc = fbc;
    const payload = { data: [{
      event_name: 'InitiateCheckout',
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: eventSourceUrl || 'https://cyrushq.ai/checkout-course-pro',
      user_data: userData,
      custom_data: {
        currency: 'USD',
        value: ((amountCents || 0) / 100).toFixed(2),
        content_name: productName || 'CyrusHQ Product',
        content_category: 'Digital Product',
        content_ids: [productKey || 'cyrushq-product'],
        content_type: 'product',
        num_items: 1
      }
    }]};
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    const result = await res.json();
    if (result.error) { console.error('Meta CAPI InitiateCheckout error:', JSON.stringify(result.error)); return; }
    console.log('Meta CAPI InitiateCheckout sent — events_received:', result.events_received, '| event_id:', eventId);
  } catch (err) {
    console.error('Meta CAPI InitiateCheckout exception:', err.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const { paymentMethodId, email, name, fbp, fbc, eventSourceUrl, initiateCheckoutEventId, adPlatform, utmSource, utmMedium, utmCampaign } = req.body;

  if (!paymentMethodId || !email || !name) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  // Fire CAPI InitiateCheckout — mirrors browser pixel event for iOS14+ / ad-blocker coverage
  sendMetaCAPIInitiateCheckout({
    email, fbp, fbc, eventSourceUrl,
    eventId: initiateCheckoutEventId,
    amountCents: 9700,
    productKey: 'build-your-ai-ceo-pro',
    productName: 'Build Your AI CEO — Implementation Program ($97)'
  }).catch(e => console.error('CAPI InitiateCheckout non-fatal:', e.message));

  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
  const STRIPE_BASE   = 'https://api.stripe.com/v1';
  const headers = {
    'Authorization': `Bearer ${STRIPE_SECRET}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  };

  // Price: $97
  const amountCents = 9700;

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
      description:              adPlatform
        ? `Build Your AI CEO — Implementation Program ($97) — ${adPlatform}`
        : 'Build Your AI CEO — Implementation Program ($97)',
      'metadata[product]':           'build-your-ai-ceo-pro',
      'metadata[customer_name]':      name,
      'metadata[customer_email]':     email,
      ...(fbp            ? { 'metadata[fbp]':              fbp            } : {}),
      ...(fbc            ? { 'metadata[fbc]':              fbc            } : {}),
      ...(eventSourceUrl ? { 'metadata[event_source_url]': eventSourceUrl } : {}),
      ...(adPlatform     ? { 'metadata[ad_platform]':      adPlatform     } : {}),
      ...(utmSource      ? { 'metadata[utm_source]':       utmSource      } : {}),
      ...(utmMedium      ? { 'metadata[utm_medium]':       utmMedium      } : {}),
      ...(utmCampaign    ? { 'metadata[utm_campaign]':     utmCampaign    } : {})
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
    console.error('checkout-course-pro error:', err);
    return res.status(500).json({ error: 'Server error. Please try again or contact hello@cyrushq.ai' });
  }
}

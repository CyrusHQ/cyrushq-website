// CyrusHQ Digital Product Fulfillment
// Stripe webhook → verify → GHL email delivery

const PRODUCT_MAP = {
  'ai-agent-playbook': {
    name: 'AI Agent Playbook',
    downloadUrl: 'https://cyrushq.ai/downloads/ai-agent-playbook-cyrushq-2026-xK9mP3qR.pdf',
    tag: 'bought-ai-agent-playbook'
  },
  '6fig-blueprint': {
    name: '6-Figure AI Agency Blueprint',
    downloadUrl: 'https://cyrushq.ai/downloads/6-figure-blueprint-cyrushq-2026-mN7xQ2wL.pdf',
    tag: 'bought-6fig-blueprint'
  },
  'ai-ceo-starter-kit': {
    name: 'AI CEO Starter Kit',
    downloadUrl: 'https://cyrushq.ai/downloads/ai-ceo-starter-kit-cyrushq-2026-pR4vK8nJ.zip',
    tag: 'bought-starter-kit'
  },
  'ai-growth-engine-pack': {
    name: 'AI Growth Engine Pack',
    downloadUrl: 'https://cyrushq.ai/downloads/ai-growth-engine-pack-cyrushq-2026-tL9xM3vQ.zip',
    tag: 'bought-growth-engine-pack'
  },
  'complete-bundle': {
    name: 'The Complete Bundle — AI CEO System',
    downloadUrl: null, // bundle sends multiple links
    tag: 'bought-complete-bundle',
    isBundle: true,
    bundleItems: [
      { name: 'AI Agent Playbook', url: 'https://cyrushq.ai/downloads/ai-agent-playbook-cyrushq-2026-xK9mP3qR.pdf' },
      { name: '6-Figure AI Agency Blueprint', url: 'https://cyrushq.ai/downloads/6-figure-blueprint-cyrushq-2026-mN7xQ2wL.pdf' },
      { name: 'AI CEO Starter Kit (29 .md files + Setup Guide)', url: 'https://cyrushq.ai/downloads/ai-ceo-starter-kit-cyrushq-2026-pR4vK8nJ.zip' },
      { name: 'AI Growth Engine Pack', url: 'https://cyrushq.ai/downloads/ai-growth-engine-pack-cyrushq-2026-tL9xM3vQ.zip' }
    ]
  }
};

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function verifyStripeSignature(rawBody, signature, secret) {
  // Manual HMAC verification without stripe npm package
  const crypto = await import('crypto');
  const parts = signature.split(',');
  const timestamp = parts.find(p => p.startsWith('t=')).slice(2);
  const v1 = parts.find(p => p.startsWith('v1=')).slice(3);
  const payload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret)
    .update(payload, 'utf8').digest('hex');
  return expected === v1;
}

async function sendDeliveryEmail(customerEmail, customerName, product) {
  // Decode hex-encoded GHL key
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

  // Upsert contact in GHL
  const contactRes = await fetch(`${GHL_BASE}/contacts/`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({
      email: customerEmail,
      firstName: (customerName || 'Friend').split(' ')[0],
      lastName: (customerName || '').split(' ').slice(1).join(' ') || '',
      locationId: GHL_LOCATION_ID,
      tags: [product.tag, 'cyrushq-customer']
    })
  });

  const contactData = await contactRes.json();
  const contactId = contactData.contact?.id;
  if (!contactId) {
    console.error('GHL contact error:', JSON.stringify(contactData));
    return false;
  }

  // Build email body — handle single product and bundle
  let downloadSection = '';
  if (product.isBundle) {
    downloadSection = `
    <p style="color: #555; line-height: 1.6; margin: 0 0 16px;">Your complete bundle includes all 4 products. Click each button below to download:</p>
    ${product.bundleItems.map(item => `
    <div style="margin: 12px 0;">
      <a href="${item.url}"
         style="background: #0A1628; color: #C9A84C; padding: 12px 24px;
                text-decoration: none; font-weight: 700; font-size: 14px;
                display: block; text-align: center; letter-spacing: 1px; border: 2px solid #C9A84C;">
        ${item.name} →
      </a>
    </div>`).join('')}
    `;
  } else {
    downloadSection = `
    <div style="text-align: center; margin: 32px 0;">
      <a href="${product.downloadUrl}"
         style="background: #C9A84C; color: #0A1628; padding: 16px 36px;
                text-decoration: none; font-weight: 700; font-size: 16px;
                display: inline-block; letter-spacing: 1px;">
        DOWNLOAD NOW →
      </a>
    </div>
    `;
  }

  const emailBody = `
<div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #1a1a2e;">
  <div style="background: #0A1628; padding: 32px; text-align: center;">
    <h1 style="color: #C9A84C; margin: 0; font-size: 24px; letter-spacing: 2px;">CYRUSHQ.AI</h1>
    <p style="color: #8BA3C4; margin: 8px 0 0; font-size: 13px;">Your AI CEO System</p>
  </div>

  <div style="padding: 40px 32px; background: #fff;">
    <h2 style="color: #0A1628; margin: 0 0 16px;">Your download is ready. 👑</h2>
    <p style="color: #555; line-height: 1.6; margin: 0 0 24px;">
      Thank you for purchasing <strong>${product.name}</strong>.
    </p>
    ${downloadSection}
    <p style="color: #888; font-size: 13px; margin: 24px 0 0; line-height: 1.5;">
      Save this email — your download links are permanent.<br>
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

  const emailRes = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({
      type: 'Email',
      contactId,
      subject: `Your ${product.name} — Download Inside 👑`,
      html: emailBody,
      from: 'hello@recaptureleads.com', // temp until cyrushq.ai email is live
      to: customerEmail
    })
  });

  const emailData = await emailRes.json();
  console.log('Email result:', JSON.stringify(emailData));
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const rawBody = await getRawBody(req);
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Verify webhook signature
  try {
    const valid = await verifyStripeSignature(rawBody, signature, webhookSecret);
    if (!valid) {
      console.error('Invalid Stripe signature');
      return res.status(400).send('Invalid signature');
    }
  } catch (err) {
    console.error('Signature verification error:', err);
    return res.status(400).send('Signature error');
  }

  const event = JSON.parse(rawBody.toString('utf8'));
  console.log('Stripe event:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name;
    const productKey = session.metadata?.product_key;

    if (!customerEmail || !productKey) {
      console.error('Missing email or product_key', { customerEmail, productKey });
      return res.status(200).json({ received: true, note: 'missing data' });
    }

    const product = PRODUCT_MAP[productKey];
    if (!product) {
      console.error('Unknown product key:', productKey);
      return res.status(200).json({ received: true, note: 'unknown product' });
    }

    console.log(`Fulfilling ${product.name} for ${customerEmail}`);
    await sendDeliveryEmail(customerEmail, customerName, product);
  }

  return res.status(200).json({ received: true });
}

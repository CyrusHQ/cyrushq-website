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
    downloadUrl: 'https://cyrushq.ai/downloads/6fig-blueprint-cyrushq-2026-wN7jL5vT.pdf',
    tag: 'bought-6fig-blueprint'
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
  const GHL_API_KEY = process.env.GHL_API_KEY;
  const GHL_LOCATION_ID = 'FitEZb4RfLdF1TkKxZEC';

  // Upsert contact in GHL
  const contactRes = await fetch('https://rest.gohighlevel.com/v1/contacts/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GHL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: customerEmail,
      firstName: customerName || 'Friend',
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

  // Send delivery email via GHL
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
      Your file is ready to download now.
    </p>
    
    <div style="text-align: center; margin: 32px 0;">
      <a href="${product.downloadUrl}" 
         style="background: #C9A84C; color: #0A1628; padding: 16px 36px; 
                text-decoration: none; font-weight: 700; font-size: 16px;
                display: inline-block; letter-spacing: 1px;">
        DOWNLOAD NOW →
      </a>
    </div>
    
    <p style="color: #888; font-size: 13px; margin: 24px 0 0; line-height: 1.5;">
      Save this email — your download link is permanent.<br>
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

  const emailRes = await fetch(`https://rest.gohighlevel.com/v1/conversations/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GHL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'Email',
      contactId,
      subject: `Your ${product.name} — Download Inside 👑`,
      body: emailBody,
      from: 'hello@cyrushq.ai',
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

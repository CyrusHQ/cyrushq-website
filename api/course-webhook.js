// POST /api/course-webhook
// Stripe webhook handler for course purchases
// Fires GHL automation: course access email + conditional cron bonus + optional starter kit

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function verifyStripeSignature(rawBody, signature, secret) {
  const crypto  = await import('crypto');
  const parts   = signature.split(',');
  const ts      = parts.find(p => p.startsWith('t=')).slice(2);
  const v1      = parts.find(p => p.startsWith('v1=')).slice(3);
  const payload = `${ts}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return expected === v1;
}

async function triggerGHLCourseWorkflow({ email, name, hasCronBump, hasStarterKit }) {
  const hexKey = process.env.GHL_API_KEY || '';
  const GHL_API_KEY = /^[0-9a-f]+$/i.test(hexKey)
    ? Buffer.from(hexKey, 'hex').toString('utf8').trim()
    : hexKey.trim();

  const GHL_LOCATION_ID = 'FitEZb4RfLdF1TkKxZEC';
  const GHL_BASE = 'https://services.leadconnectorhq.com';
  const GHL_HEADERS = {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28'
  };

  const firstName = (name || 'Friend').split(' ')[0];
  const lastName  = (name || '').split(' ').slice(1).join(' ') || '';

  // Build tags based on what they bought
  const tags = ['cyrushq-customer', 'course-build-your-ai-ceo'];
  if (hasCronBump)   tags.push('course-cron-bump-purchased');
  if (hasStarterKit) tags.push('course-starter-kit-purchased');

  // 1. Upsert contact in GHL
  const contactRes = await fetch(`${GHL_BASE}/contacts/`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({ email, firstName, lastName, locationId: GHL_LOCATION_ID, tags })
  });
  const contactData = await contactRes.json();
  const contactId   = contactData.contact?.id;

  if (!contactId) {
    console.error('GHL contact upsert failed:', JSON.stringify(contactData));
    return false;
  }

  // 2. Build email — always includes course login link; conditionally includes bonus + kit links
  const cronSection = hasCronBump ? `
    <div style="background:#fffdf5; border:2px dashed #C9A84C; padding:20px; margin:20px 0; text-align:center;">
      <p style="color:#0A1628; font-weight:700; margin:0 0 8px;">⚡ Your Cron Job Module is Ready</p>
      <p style="color:#555; font-size:14px; margin:0 0 14px;">Find it inside your course portal under "Bonus Module" — or access it directly:</p>
      <a href="https://cyrushq.ai/members"
         style="background:#C9A84C; color:#0A1628; padding:12px 24px; text-decoration:none; font-weight:700; font-size:14px; display:inline-block; letter-spacing:1px;">
        View Cron Job Module →
      </a>
    </div>` : '';

  const kitSection = hasStarterKit ? `
    <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:20px; margin:20px 0; text-align:center;">
      <p style="color:#14532d; font-weight:700; margin:0 0 8px;">✅ AI CEO Starter Kit — 29 Files Enclosed</p>
      <p style="color:#166534; font-size:14px; margin:0 0 14px;">Your operating files are ready to download from your portal.</p>
      <a href="https://cyrushq.ai/downloads/ai-ceo-starter-kit-cyrushq-2026-pR4vK8nJ.zip"
         style="background:#16a34a; color:#fff; padding:12px 24px; text-decoration:none; font-weight:700; font-size:14px; display:inline-block; letter-spacing:1px;">
        Download Starter Kit →
      </a>
    </div>` : '';

  const emailBody = `
<div style="font-family:'Inter',Arial,sans-serif; max-width:600px; margin:0 auto; color:#1a1a2e;">
  <div style="background:#0A1628; padding:32px; text-align:center;">
    <h1 style="color:#C9A84C; margin:0; font-size:24px; letter-spacing:2px; font-family:Georgia,serif;">CYRUSHQ.AI</h1>
    <p style="color:#8BA3C4; margin:8px 0 0; font-size:13px;">Build Your AI CEO</p>
  </div>

  <div style="padding:40px 32px; background:#fff;">
    <h2 style="color:#0A1628; margin:0 0 10px; font-family:Georgia,serif;">Welcome aboard, ${firstName}. 👑</h2>
    <p style="color:#555; line-height:1.6; margin:0 0 20px;">
      Your purchase is confirmed and your course is ready. You're one login away from your AI CEO.
    </p>

    <div style="text-align:center; margin:28px 0;">
      <a href="https://cyrushq.ai/members"
         style="background:#C9A84C; color:#0A1628; padding:18px 36px; text-decoration:none;
                font-weight:700; font-size:16px; display:inline-block; letter-spacing:1.5px;
                text-transform:uppercase;">
        Go to My Course Portal →
      </a>
    </div>

    ${cronSection}
    ${kitSection}

    <p style="color:#555; font-size:14px; line-height:1.6; margin-top:20px;">
      <strong>What to do first:</strong><br>
      Start with Module 1 — it's under 20 minutes and gives you the complete picture before you build.
      Most students have a live AI CEO by the end of the weekend.
    </p>

    <div style="background:#f8f6f1; border:1px solid #e5e7eb; border-radius:8px; padding:16px 20px; margin-top:20px;">
      <p style="color:#1a1a2e; font-size:13px; font-weight:700; margin:0 0 6px;">🔑 Your Course Password</p>
      <p style="color:#C9A84C; font-size:18px; font-weight:700; letter-spacing:2px; margin:0 0 6px;">CyrusAICEO2026</p>
      <p style="color:#888; font-size:12px; margin:0;">You'll need this each time you visit your course portal.</p>
    </div>
    <p style="color:#888; font-size:13px; margin-top:20px; line-height:1.5;">
      Questions? Just reply to this email — we're fast.<br>
      Portal URL: <a href="https://cyrushq.ai/members" style="color:#C9A84C;">cyrushq.ai/members</a>
    </p>
  </div>

  <div style="background:#F8F6F1; padding:20px 32px; text-align:center; border-top:2px solid #C9A84C;">
    <p style="color:#888; font-size:12px; margin:0;">
      © 2026 CyrusHQ · cyrushq.ai · hello@cyrushq.ai<br>
      Build wisely. Lead calmly. Create systems that endure.
    </p>
  </div>
</div>`.trim();

  // 3. Send email via GHL
  const emailRes = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({
      type: 'Email',
      contactId,
      subject: `Your AI CEO course is ready, ${firstName} 👑`,
      html: emailBody,
      from: 'hello@cyrushq.ai',
      to: email
    })
  });

  const emailData = await emailRes.json();
  console.log('GHL email result:', JSON.stringify(emailData));
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const rawBody  = await getRawBody(req);
  const signature = req.headers['stripe-signature'];
  const secret   = process.env.STRIPE_COURSE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

  // Verify webhook
  try {
    const valid = await verifyStripeSignature(rawBody, signature, secret);
    if (!valid) {
      console.error('Invalid Stripe signature on course webhook');
      return res.status(400).send('Invalid signature');
    }
  } catch (err) {
    console.error('Signature verification error:', err);
    return res.status(400).send('Signature error');
  }

  const event = JSON.parse(rawBody.toString('utf8'));
  console.log('Course webhook event:', event.type);

  if (event.type === 'payment_intent.succeeded') {
    const pi    = event.data.object;
    const meta  = pi.metadata || {};
    const email = meta.customer_email || pi.receipt_email;
    const name  = meta.customer_name  || '';

    if (!email) {
      console.error('No email on payment_intent:', pi.id);
      return res.status(200).json({ received: true, note: 'no email' });
    }

    const product      = meta.product || '';
    const hasCronBump  = meta.has_cron_bump === 'true';
    const hasStarterKit = product === 'ai-ceo-starter-kit';

    // Only fire for course-related products
    if (product === 'build-your-ai-ceo' || product === 'ai-ceo-starter-kit') {
      console.log(`Triggering GHL for ${email} — cron:${hasCronBump} kit:${hasStarterKit}`);
      await triggerGHLCourseWorkflow({ email, name, hasCronBump, hasStarterKit });
    }
  }

  return res.status(200).json({ received: true });
}

// POST /api/course-webhook
// Stripe webhook handler for course purchases
// Fires GHL automation: course access email + conditional cron bonus + optional starter kit
// Also fires Meta Conversions API (CAPI) Purchase event for ad attribution

const PIXEL_ID = '898060140812365';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

async function hashSHA256(value) {
  const crypto = await import('crypto');
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

async function sendMetaCAPIEvent({ email, name, customerId, fbp, fbc, eventSourceUrl, paymentIntentId, amountCents }) {
  try {
    const eventTime = Math.floor(Date.now() / 1000);
    const hashedEmail = await hashSHA256(email);
    const hashedExternalId = await hashSHA256(customerId || email);

    // Build user_data — only include fields we have
    const userData = {
      em: [hashedEmail],
      external_id: [hashedExternalId],
      client_user_agent: 'Mozilla/5.0 (server-side event)'
    };
    if (fbp) userData.fbp = fbp;
    if (fbc) userData.fbc = fbc;

    const eventData = {
      event_name: 'Purchase',
      event_time: eventTime,
      event_id: paymentIntentId, // deduplication key — matches pixel event_id if set
      action_source: 'website',
      event_source_url: eventSourceUrl || 'https://cyrushq.ai/checkout-course',
      user_data: userData,
      custom_data: {
        currency: 'USD',
        value: ((amountCents || 4700) / 100).toFixed(2),
        content_name: 'Build Your AI CEO Course',
        content_category: 'Online Course',
        content_ids: ['build-your-ai-ceo'],
        content_type: 'product'
      }
    };

    const payload = { data: [eventData] };

    const res = await fetch(
      `https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    const result = await res.json();
    if (result.error) {
      console.error('Meta CAPI error:', JSON.stringify(result.error));
      return false;
    }
    console.log('Meta CAPI Purchase event sent — events_received:', result.events_received, '| fbtrace_id:', result.fbtrace_id);
    return true;
  } catch (err) {
    console.error('Meta CAPI exception:', err.message);
    return false;
  }
}

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

async function triggerGHLCourseWorkflow({ email, name, hasCronBump, hasStarterKit, isBundle = false }) {
  // Pre-compute magic link for this buyer
  const cryptoMod = await import('crypto');
  const portalSecret = process.env.PORTAL_SECRET || '';
  const magicToken = cryptoMod.createHmac('sha256', portalSecret)
    .update(`${portalSecret}:${email.toLowerCase().trim()}`)
    .digest('hex');
  const magicLink = `https://cyrushq.ai/members?t=${magicToken}&e=${encodeURIComponent(email.toLowerCase().trim())}`;

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
  if (isBundle)      tags.push('complete-bundle-97-purchased');

  // 1. Upsert contact in GHL
  const contactRes = await fetch(`${GHL_BASE}/contacts/`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({ email, firstName, lastName, locationId: GHL_LOCATION_ID, tags })
  });
  const contactData = await contactRes.json();
  // GHL returns contact.id on create, or meta.contactId on duplicate
  const contactId = contactData.contact?.id || contactData.meta?.contactId;

  if (!contactId) {
    console.error('GHL contact upsert failed:', JSON.stringify(contactData));
    return false;
  }

  // 2. Build email — ONE email per buyer; upsell products (cron, kit) suppress their own email.
  // A single bonus note covers all add-ons without sending 3 separate emails.
  const bonusNote = `
    <div style="background:#fffbeb; border:1px solid #C9A84C; border-radius:8px; padding:16px 20px; margin:24px 0;">
      <p style="color:#555; font-size:14px; margin:0; line-height:1.6;">
        ⚡ <strong>Added the Cron Job Module or AI CEO Starter Kit?</strong> They're already unlocked inside your portal — just click your access link above and they'll be waiting for you.
      </p>
    </div>`;
  const cronSection = '';
  const kitSection = '';

  const bundleSection = isBundle ? `
    <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:24px; margin:20px 0;">
      <p style="color:#14532d; font-weight:700; margin:0 0 12px; font-size:15px;">✅ Your Complete Bundle Downloads</p>
      <p style="color:#166534; font-size:14px; margin:0 0 16px;">All 5 items are ready. Download everything in one ZIP or grab them individually:</p>
      <div style="text-align:center; margin-bottom:16px;">
        <a href="https://cyrushq.ai/downloads/ai-ceo-complete-bundle-cyrushq-2026-bX5nR7kP.zip"
           style="background:#16a34a; color:#fff; padding:14px 28px; text-decoration:none; font-weight:700; font-size:14px; display:inline-block; letter-spacing:1px;">
          Download Complete Bundle (All Files) →
        </a>
      </div>
      <p style="color:#555; font-size:13px; margin:0 0 6px;">Or individually:</p>
      <ul style="color:#555; font-size:13px; line-height:2; margin:0; padding-left:20px;">
        <li><a href="https://cyrushq.ai/downloads/ai-agent-playbook-cyrushq-2026-xK9mP3qR.pdf" style="color:#16a34a;">AI Agent Playbook (81-page PDF)</a></li>
        <li><a href="https://cyrushq.ai/downloads/6-figure-blueprint-cyrushq-2026-mN7xQ2wL.pdf" style="color:#16a34a;">6-Figure AI Agency Blueprint (120-page PDF)</a></li>
        <li><a href="https://cyrushq.ai/downloads/ai-ceo-starter-kit-cyrushq-2026-pR4vK8nJ.zip" style="color:#16a34a;">AI CEO Starter Kit (29 plug-and-play files)</a></li>
        <li><a href="https://cyrushq.ai/downloads/ai-growth-engine-pack-cyrushq-2026-tL9xM3vQ.zip" style="color:#16a34a;">AI Growth Engine Pack (4 bonus engine files)</a></li>
      </ul>
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
      <a href="${magicLink}"
         style="background:#C9A84C; color:#0A1628; padding:18px 36px; text-decoration:none;
                font-weight:700; font-size:16px; display:inline-block; letter-spacing:1.5px;
                text-transform:uppercase;">
        Access My Course Portal &rarr;
      </a>
    </div>

    ${isBundle ? bundleSection : bonusNote}

    <p style="color:#555; font-size:14px; line-height:1.6; margin-top:20px;">
      <strong>What to do first:</strong><br>
      Start with Module 1 — it's under 20 minutes and gives you the complete picture before you build.
      Most students have a live AI CEO by the end of the weekend.
    </p>

    <div style="background:#f8f6f1; border:1px solid #e5e7eb; border-radius:8px; padding:14px 18px; margin-top:20px; text-align:center;">
      <p style="color:#555; font-size:13px; margin:0; line-height:1.6;">🔖 <strong>Bookmark this link for instant access anytime — no password needed.</strong></p>
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
      fromName: 'CyrusHQ Team',
      from: 'hello@cyrushq.ai',
      to: email
    })
  });

  const emailData = await emailRes.json();
  console.log('GHL email result:', JSON.stringify(emailData));
  return true;
}

// Tag-only upsert: adds GHL contact tags without sending an email.
// Used for upsell products (cron, starter kit) so buyers only ever get ONE welcome email.
async function addGHLTagsOnly({ email, name, tags }) {
  const hexKey = process.env.GHL_API_KEY || '';
  const GHL_API_KEY = /^[0-9a-f]+$/i.test(hexKey)
    ? Buffer.from(hexKey, 'hex').toString('utf8').trim()
    : hexKey.trim();
  const firstName = (name || 'Friend').split(' ')[0];
  const lastName  = (name || '').split(' ').slice(1).join(' ') || '';
  const res = await fetch('https://services.leadconnectorhq.com/contacts/', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Content-Type': 'application/json', 'Version': '2021-07-28' },
    body: JSON.stringify({ email, firstName, lastName, locationId: 'FitEZb4RfLdF1TkKxZEC', tags })
  });
  const d = await res.json();
  const contactId = d.contact?.id || d.meta?.contactId;
  console.log(`GHL tag-only upsert for ${email} — contactId: ${contactId} tags: ${tags.join(',')}`);
  return true;
}

async function triggerGHLBookBundleWorkflow({ email, name }) {
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
  const tags = ['cyrushq-customer', 'book-bundle-purchased'];

  // 1. Upsert contact in GHL
  const contactRes = await fetch(`${GHL_BASE}/contacts/`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({ email, firstName, lastName, locationId: GHL_LOCATION_ID, tags })
  });
  const contactData = await contactRes.json();
  const contactId = contactData.contact?.id || contactData.meta?.contactId;

  if (!contactId) {
    console.error('GHL book bundle contact upsert failed:', JSON.stringify(contactData));
    return false;
  }

  // 2. Send book delivery email
  const emailBody = `
<div style="font-family:'Inter',Arial,sans-serif; max-width:600px; margin:0 auto; color:#1a1a2e;">
  <div style="background:#0A1628; padding:32px; text-align:center;">
    <h1 style="color:#C9A84C; margin:0; font-size:24px; letter-spacing:2px; font-family:Georgia,serif;">CYRUSHQ.AI</h1>
    <p style="color:#8BA3C4; margin:8px 0 0; font-size:13px;">AI Agency Blueprint</p>
  </div>

  <div style="padding:40px 32px; background:#fff;">
    <h2 style="color:#0A1628; margin:0 0 10px; font-family:Georgia,serif;">Your books are ready, ${firstName}. 👑</h2>
    <p style="color:#555; line-height:1.6; margin:0 0 20px;">
      Your purchase is confirmed. Download your PDFs below — they're available immediately.
    </p>

    <div style="margin:28px 0;">
      <a href="https://cyrushq.ai/downloads/6-figure-blueprint-cyrushq-2026-mN7xQ2wL.pdf"
         style="display:block; background:#C9A84C; color:#0A1628; padding:16px 24px; text-decoration:none;
                font-weight:700; font-size:15px; letter-spacing:1px; text-transform:uppercase; margin-bottom:12px;">
        📄 Download: 6-Figure AI Agency Blueprint →
      </a>
      <a href="https://cyrushq.ai/downloads/ai-agent-playbook-cyrushq-2026-xK9mP3qR.pdf"
         style="display:block; background:#C9A84C; color:#0A1628; padding:16px 24px; text-decoration:none;
                font-weight:700; font-size:15px; letter-spacing:1px; text-transform:uppercase;">
        📄 Download: AI Agent Playbook →
      </a>
    </div>

    <p style="color:#555; font-size:14px; line-height:1.6; margin-top:20px;">
      <strong>Where to start:</strong><br>
      Open the 6-Figure AI Agency Blueprint and begin with Chapter 1. It gives you the complete architecture in under 20 minutes.
      Then follow the 7-phase, 41-day roadmap — every step is numbered, every file is named.
    </p>

    <div style="background:#fffbeb; border:1px solid #C9A84C; border-radius:8px; padding:14px 18px; margin-top:20px;">
      <p style="color:#555; font-size:13px; margin:0; line-height:1.6;">⚡ <strong>Added any bonuses?</strong> If you purchased the AI CEO Starter Kit, Cron Job Module, or Video Course, your downloads are on the page below — and a separate email with any course access link is on its way.</p>
    </div>
    <p style="color:#888; font-size:13px; margin-top:16px; line-height:1.5;">
      Questions? Just reply to this email — we're fast.<br>
      Download page: <a href="https://cyrushq.ai/book-thankyou" style="color:#C9A84C;">cyrushq.ai/book-thankyou</a>
    </p>
  </div>

  <div style="background:#F8F6F1; padding:20px 32px; text-align:center; border-top:2px solid #C9A84C;">
    <p style="color:#888; font-size:12px; margin:0;">
      © 2026 CyrusHQ · cyrushq.ai · hello@cyrushq.ai<br>
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
      subject: `Your AI books are ready, ${firstName} 📄`,
      html: emailBody,
      fromName: 'CyrusHQ Team',
      from: 'hello@cyrushq.ai',
      to: email
    })
  });

  const emailData = await emailRes.json();
  console.log('GHL book bundle email result:', JSON.stringify(emailData));
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

    const product        = meta.product || '';
    const hasCronBump    = product === 'cron-job-mastery';
    const hasStarterKit  = product === 'ai-ceo-starter-kit' || product === 'complete-bundle';
    const isBundle       = product === 'complete-bundle';
    const isBookBundle   = product === 'book-bundle';
    const fbp            = meta.fbp            || null;
    const fbc            = meta.fbc            || null;
    const eventSourceUrl = meta.event_source_url || null;

    // Fire GHL automation for all course-related products (including complete bundle)
    // UPSELL PRODUCTS (cron, starter kit): tag-only — no email. Base course email already went out.
    // This prevents buyers from receiving 2–3 separate emails for a single checkout session.
    const courseProducts = ['build-your-ai-ceo', 'ai-ceo-starter-kit', 'cron-job-mastery', 'complete-bundle', 'book-bundle'];
    if (courseProducts.includes(product)) {
      if (isBookBundle) {
        console.log(`Triggering GHL book-bundle workflow for ${email}`);
        await triggerGHLBookBundleWorkflow({ email, name });
      } else if (product === 'build-your-ai-ceo' || isBundle) {
        // Base course or complete bundle: send the one welcome email
        console.log(`Triggering GHL welcome email for ${email} — product:${product}`);
        await triggerGHLCourseWorkflow({ email, name, hasCronBump: false, hasStarterKit: isBundle, isBundle });
      } else {
        // Upsell-only PI (cron or starter kit): tag the contact, suppress email
        const upsellTags = ['cyrushq-customer', 'course-build-your-ai-ceo'];
        if (product === 'cron-job-mastery')   upsellTags.push('course-cron-bump-purchased');
        if (product === 'ai-ceo-starter-kit') upsellTags.push('course-starter-kit-purchased');
        console.log(`GHL tag-only for ${email} — product:${product} (email suppressed)`);
        await addGHLTagsOnly({ email, name, tags: upsellTags });
      }
    }

    // Fire Meta CAPI Purchase event for all course products
    if (courseProducts.includes(product)) {
      console.log(`Sending Meta CAPI Purchase for ${email} — PI: ${pi.id}`);
      await sendMetaCAPIEvent({
        email,
        name,
        customerId: pi.customer,
        fbp,
        fbc,
        eventSourceUrl,
        paymentIntentId: pi.id,
        amountCents: pi.amount
      });
    }
  }

  return res.status(200).json({ received: true });
}

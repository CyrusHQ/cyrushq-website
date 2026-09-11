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
      event_id: paymentIntentId,
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
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    const result = await res.json();
    if (result.error) { console.error('Meta CAPI error:', JSON.stringify(result.error)); return false; }
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

function getGHLKey() {
  const raw = process.env.GHL_API_KEY || '';
  // Support plain key (preferred) — do not hex-decode keys with dashes
  return raw.trim();
}

const GHL_BASE    = 'https://services.leadconnectorhq.com';
const GHL_LOC_ID  = 'FitEZb4RfLdF1TkKxZEC';

function ghlHeaders() {
  return {
    'Authorization': `Bearer ${getGHLKey()}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28'
  };
}

// Upsert contact → returns contactId (string) or null on failure
async function upsertGHLContact({ email, firstName, lastName, tags }) {
  const res = await fetch(`${GHL_BASE}/contacts/`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify({ email, firstName, lastName, locationId: GHL_LOC_ID, tags })
  });
  const d = await res.json();
  const contactId = d.contact?.id || d.meta?.contactId;
  if (!contactId) console.error('GHL upsert failed for', email, JSON.stringify(d));
  return contactId || null;
}

// Merge tags onto existing contact using PUT — safe, non-destructive add
// GHL POST upsert may not merge tags on existing contacts; PUT is authoritative.
async function mergeGHLTags(contactId, tagsToAdd) {
  if (!contactId || !tagsToAdd?.length) return;
  // GET current tags first
  const getRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, { headers: ghlHeaders() });
  const getData = await getRes.json();
  const existing = getData.contact?.tags || [];
  const merged = [...new Set([...existing, ...tagsToAdd])];
  const putRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: 'PUT',
    headers: ghlHeaders(),
    body: JSON.stringify({ tags: merged })
  });
  const putData = await putRes.json();
  console.log(`GHL tags merged for ${contactId}:`, putData.contact?.tags);
}

async function sendGHLEmail({ contactId, to, subject, html }) {
  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify({ type: 'Email', contactId, subject, html, fromName: 'CyrusHQ', from: 'hello@send.cyrushq.ai', to })
  });
  const d = await res.json();
  console.log('GHL email result:', JSON.stringify(d));
  return d;
}

function buildMagicLink(email) {
  const cryptoMod = require('crypto');
  const portalSecret = process.env.PORTAL_SECRET || '';
  const token = cryptoMod.createHmac('sha256', portalSecret)
    .update(`${portalSecret}:${email.toLowerCase().trim()}`)
    .digest('hex');
  return `https://cyrushq.ai/members?t=${token}&e=${encodeURIComponent(email.toLowerCase().trim())}`;
}

async function triggerGHLCourseWorkflow({ email, name, hasCronBump, hasStarterKit, isBundle = false }) {
  const firstName = (name || 'Friend').split(' ')[0];
  const lastName  = (name || '').split(' ').slice(1).join(' ') || '';
  const magicLink = buildMagicLink(email);

  const tags = ['cyrushq-customer', 'course-build-your-ai-ceo'];
  if (hasCronBump)   tags.push('course-cron-bump-purchased');
  if (hasStarterKit) tags.push('ai-ceo-starter-kit-purchased');
  if (isBundle)      tags.push('complete-bundle-97-purchased');

  const contactId = await upsertGHLContact({ email, firstName, lastName, tags });
  if (!contactId) return false;

  // Always merge tags via PUT to guarantee they stick on existing contacts
  await mergeGHLTags(contactId, tags);

  const bonusNote = `
    <div style="background:#fffbeb; border:1px solid #C9A84C; border-radius:8px; padding:16px 20px; margin:24px 0;">
      <p style="color:#555; font-size:14px; margin:0; line-height:1.6;">
        ⚡ <strong>Added the Cron Job Mastery Module?</strong> It's already unlocked inside your portal — just click your access link above and it'll be waiting for you.<br><br>
        📥 <strong>Purchased the AI CEO Starter Kit?</strong> Check your email — your download link was sent separately.
      </p>
    </div>`;

  const bundleSection = isBundle ? `
    <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:24px; margin:20px 0;">
      <p style="color:#14532d; font-weight:700; margin:0 0 12px; font-size:15px;">✅ Your Complete Bundle Downloads</p>
      <p style="color:#166534; font-size:14px; margin:0 0 16px;">All 5 items are ready:</p>
      <div style="text-align:center; margin-bottom:16px;">
        <a href="https://cyrushq.ai/downloads/ai-ceo-complete-bundle-cyrushq-2026-bX5nR7kP.zip"
           style="background:#16a34a; color:#fff; padding:14px 28px; text-decoration:none; font-weight:700; font-size:14px; display:inline-block; letter-spacing:1px;">
          Download Complete Bundle (All Files) →
        </a>
      </div>
      <ul style="color:#555; font-size:13px; line-height:2; margin:0; padding-left:20px;">
        <li><a href="https://cyrushq.ai/downloads/ai-agent-playbook-cyrushq-2026-xK9mP3qR.pdf" style="color:#16a34a;">AI Agent Playbook (81-page PDF)</a></li>
        <li><a href="https://cyrushq.ai/downloads/6-figure-blueprint-cyrushq-2026-mN7xQ2wL.pdf" style="color:#16a34a;">6-Figure AI Agency Blueprint (120-page PDF)</a></li>
        <li><a href="https://cyrushq.ai/downloads/ai-ceo-starter-kit-cyrushq-2026-v2-qN8mW4xP.zip" style="color:#16a34a;">AI CEO Starter Kit (29 plug-and-play files)</a></li>
        <li><a href="https://cyrushq.ai/downloads/ai-growth-engine-pack-cyrushq-2026-v2-hM3kR7nW.zip" style="color:#16a34a;">AI Growth Engine Pack (4 bonus engine files)</a></li>
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
    <p style="color:#555; line-height:1.6; margin:0 0 20px;">Your purchase is confirmed and your course is ready. You're one login away from your AI CEO.</p>
    <div style="text-align:center; margin:28px 0;">
      <a href="${magicLink}" style="background:#C9A84C; color:#0A1628; padding:18px 36px; text-decoration:none; font-weight:700; font-size:16px; display:inline-block; letter-spacing:1.5px; text-transform:uppercase;">Access My Course Portal &rarr;</a>
    </div>
    ${isBundle ? bundleSection : bonusNote}
    <p style="color:#555; font-size:14px; line-height:1.6; margin-top:20px;"><strong>What to do first:</strong><br>Start with Module 1 — it's under 20 minutes and gives you the complete picture before you build. Most students have a live AI CEO by the end of the weekend.</p>
    <div style="background:#f8f6f1; border:1px solid #e5e7eb; border-radius:8px; padding:14px 18px; margin-top:20px; text-align:center;">
      <p style="color:#555; font-size:13px; margin:0;">🔖 <strong>Bookmark this link for instant access anytime — no password needed.</strong></p>
    </div>
    <p style="color:#888; font-size:13px; margin-top:20px; line-height:1.5;">Questions? Just reply to this email — we're fast.<br>Portal URL: <a href="https://cyrushq.ai/members" style="color:#C9A84C;">cyrushq.ai/members</a></p>
  </div>
  <div style="background:#F8F6F1; padding:20px 32px; text-align:center; border-top:2px solid #C9A84C;">
    <p style="color:#888; font-size:12px; margin:0;">© 2026 CyrusHQ · cyrushq.ai · hello@cyrushq.ai<br>Build wisely. Lead calmly. Create systems that endure.</p>
  </div>
</div>`.trim();

  await sendGHLEmail({ contactId, to: email, subject: `Your AI CEO course is ready, ${firstName} 👑`, html: emailBody });
  return true;
}

async function triggerGHLCronEmail({ email, name }) {
  const firstName = (name || 'Friend').split(' ')[0];
  const lastName  = (name || '').split(' ').slice(1).join(' ') || '';
  const magicLink = buildMagicLink(email);
  const tags = ['cyrushq-customer', 'course-build-your-ai-ceo', 'course-cron-bump-purchased'];

  const contactId = await upsertGHLContact({ email, firstName, lastName, tags });
  if (!contactId) return false;

  // Always merge via PUT — ensures tags land even if contact pre-existed
  await mergeGHLTags(contactId, tags);

  const emailBody = `
<div style="font-family:'Inter',Arial,sans-serif; max-width:600px; margin:0 auto; color:#1a1a2e;">
  <div style="background:#0A1628; padding:32px; text-align:center;">
    <h1 style="color:#C9A84C; margin:0; font-size:24px; letter-spacing:2px; font-family:Georgia,serif;">CYRUSHQ.AI</h1>
    <p style="color:#8BA3C4; margin:8px 0 0; font-size:13px;">Your AI CEO System</p>
  </div>
  <div style="padding:40px 32px; background:#fff;">
    <h2 style="color:#0A1628; margin:0 0 16px; font-family:Georgia,serif;">Your Cron Job Mastery Module is ready, ${firstName}. 👑</h2>
    <p style="color:#555; line-height:1.6; margin:0 0 24px;">Your 3-video bonus series is waiting inside your course portal. Click below to access it now.</p>
    <div style="text-align:center; margin:32px 0;">
      <a href="${magicLink}" style="background:#C9A84C; color:#0A1628; padding:18px 36px; text-decoration:none; font-weight:700; font-size:16px; display:inline-block; letter-spacing:1.5px; text-transform:uppercase;">Access My Course Portal &rarr;</a>
    </div>
    <div style="background:#f8f6f1; border:1px solid #e5e7eb; border-radius:8px; padding:14px 18px; margin-top:20px; text-align:center;">
      <p style="color:#555; font-size:13px; margin:0;">🔖 <strong>Bookmark this link — no password needed, instant access anytime.</strong></p>
    </div>
    <p style="color:#888; font-size:13px; margin-top:20px; line-height:1.5;">Questions? Reply to this email — we're fast.<br>Portal: <a href="https://cyrushq.ai/members" style="color:#C9A84C;">cyrushq.ai/members</a></p>
  </div>
  <div style="background:#F8F6F1; padding:20px 32px; text-align:center; border-top:2px solid #C9A84C;">
    <p style="color:#888; font-size:12px; margin:0;">© 2026 CyrusHQ · cyrushq.ai · hello@cyrushq.ai<br>Build wisely. Lead calmly. Create systems that endure.</p>
  </div>
</div>`.trim();

  await sendGHLEmail({ contactId, to: email, subject: `Your Cron Job Mastery Module — Access Inside 👑`, html: emailBody });
  return true;
}

async function addGHLTagsOnly({ email, name, tags }) {
  const firstName = (name || 'Friend').split(' ')[0];
  const lastName  = (name || '').split(' ').slice(1).join(' ') || '';

  const contactId = await upsertGHLContact({ email, firstName, lastName, tags });
  if (!contactId) return false;

  // Always merge via PUT — critical for upsells on pre-existing contacts
  await mergeGHLTags(contactId, tags);
  return true;
}

async function triggerGHLStarterKitEmail({ email, name }) {
  const firstName = (name || 'Friend').split(' ')[0];
  const lastName  = (name || '').split(' ').slice(1).join(' ') || '';
  const tags = ['cyrushq-customer', 'ai-ceo-starter-kit-purchased'];

  const contactId = await upsertGHLContact({ email, firstName, lastName, tags });
  if (!contactId) return false;

  await mergeGHLTags(contactId, tags);

  const emailBody = `
<div style="font-family:'Inter',Arial,sans-serif; max-width:600px; margin:0 auto; color:#1a1a2e;">
  <div style="background:#0A1628; padding:32px; text-align:center;">
    <h1 style="color:#C9A84C; margin:0; font-size:24px; letter-spacing:2px; font-family:Georgia,serif;">CYRUSHQ.AI</h1>
    <p style="color:#8BA3C4; margin:8px 0 0; font-size:13px;">AI CEO Starter Kit</p>
  </div>
  <div style="padding:40px 32px; background:#fff;">
    <h2 style="color:#0A1628; margin:0 0 10px; font-family:Georgia,serif;">Your Operating System is ready, ${firstName}. 👑</h2>
    <p style="color:#555; line-height:1.6; margin:0 0 20px;">Your purchase is confirmed. Your 29 plug-and-play .md files are ready to download — the same operating system powering a live AI CEO.</p>
    <div style="text-align:center; margin:28px 0;">
      <a href="https://cyrushq.ai/downloads/ai-ceo-starter-kit-cyrushq-2026-v2-qN8mW4xP.zip"
         style="background:#C9A84C; color:#0A1628; padding:18px 36px; text-decoration:none; font-weight:700; font-size:16px; display:inline-block; letter-spacing:1.5px; text-transform:uppercase;">
        Download Your Starter Kit (ZIP) &rarr;
      </a>
    </div>
    <div style="background:#f8f6f1; border:1px solid #e5e7eb; border-radius:8px; padding:16px 20px; margin:24px 0;">
      <p style="color:#555; font-size:14px; margin:0 0 8px; font-weight:600;">What's inside your 29 files:</p>
      <ul style="color:#555; font-size:13px; line-height:2; margin:0; padding-left:20px;">
        <li>IDENTITY.md — your AI's core identity and persona</li>
        <li>SOUL.md — voice, tone, and leadership character</li>
        <li>MEMORY.md — operating knowledge and preferences</li>
        <li>AGENTS.md — agent hierarchy and coordination framework</li>
        <li>ACTIVE_TASK.json — live task state tracker</li>
        <li>+ 24 more plug-and-play protocol files</li>
      </ul>
    </div>
    <p style="color:#555; font-size:14px; line-height:1.6; margin-top:20px;"><strong>How to use:</strong><br>Fill in your details, load the files into your AI, and you're running your own AI CEO in under an hour.</p>
    <p style="color:#888; font-size:13px; margin-top:20px; line-height:1.5;">Questions? Just reply to this email — we're fast.<br>Website: <a href="https://cyrushq.ai" style="color:#C9A84C;">cyrushq.ai</a></p>
  </div>
  <div style="background:#F8F6F1; padding:20px 32px; text-align:center; border-top:2px solid #C9A84C;">
    <p style="color:#888; font-size:12px; margin:0;">© 2026 CyrusHQ · cyrushq.ai · hello@cyrushq.ai<br>Build wisely. Lead calmly. Create systems that endure.</p>
  </div>
</div>`.trim();

  await sendGHLEmail({ contactId, to: email, subject: `Your AI CEO Starter Kit is ready, ${firstName} 👑`, html: emailBody });
  return true;
}

async function triggerGHLGrowthEngineEmail({ email, name }) {
  const firstName = (name || 'Friend').split(' ')[0];
  const lastName  = (name || '').split(' ').slice(1).join(' ') || '';
  const tags = ['cyrushq-customer', 'ai-growth-engine-pack-purchased'];

  const contactId = await upsertGHLContact({ email, firstName, lastName, tags });
  if (!contactId) return false;

  await mergeGHLTags(contactId, tags);

  const emailBody = `
<div style="font-family:'Inter',Arial,sans-serif; max-width:600px; margin:0 auto; color:#1a1a2e;">
  <div style="background:#0A1628; padding:32px; text-align:center;">
    <h1 style="color:#C9A84C; margin:0; font-size:24px; letter-spacing:2px; font-family:Georgia,serif;">CYRUSHQ.AI</h1>
    <p style="color:#8BA3C4; margin:8px 0 0; font-size:13px;">AI Growth Engine Pack</p>
  </div>
  <div style="padding:40px 32px; background:#fff;">
    <h2 style="color:#0A1628; margin:0 0 10px; font-family:Georgia,serif;">Your Growth Engine is ready, ${firstName}. 👑</h2>
    <p style="color:#555; line-height:1.6; margin:0 0 20px;">Your purchase is confirmed. Download your AI Growth Engine Pack below — 4 plug-and-play engine files ready to deploy immediately.</p>
    <div style="text-align:center; margin:28px 0;">
      <a href="https://cyrushq.ai/downloads/ai-growth-engine-pack-cyrushq-2026-v2-hM3kR7nW.zip"
         style="background:#C9A84C; color:#0A1628; padding:18px 36px; text-decoration:none; font-weight:700; font-size:16px; display:inline-block; letter-spacing:1.5px; text-transform:uppercase;">
        Download Growth Engine Pack (ZIP) &rarr;
      </a>
    </div>
    <div style="background:#f8f6f1; border:1px solid #e5e7eb; border-radius:8px; padding:16px 20px; margin:24px 0;">
      <p style="color:#555; font-size:14px; margin:0 0 8px; font-weight:600;">What’s inside your Growth Engine Pack:</p>
      <ul style="color:#555; font-size:13px; line-height:2; margin:0; padding-left:20px;">
        <li>BRAND_AUTHORITY_ENGINE.md — build authority and trust at scale</li>
        <li>CONTENT_AND_AFFILIATE_ENGINE.md — content and affiliate systems</li>
        <li>OFFER_ENGINE.md — craft and position irresistible offers</li>
        <li>TRAFFIC_ACQUISITION_ENGINE.md — paid and organic traffic systems</li>
        <li>+ Setup guide and .txt versions of all files</li>
      </ul>
    </div>
    <p style="color:#555; font-size:14px; line-height:1.6; margin-top:20px;"><strong>How to use:</strong><br>Load each engine file into your AI and follow the prompts. Each one is a standalone operating system for that growth function.</p>
    <p style="color:#888; font-size:13px; margin-top:20px; line-height:1.5;">Questions? Just reply to this email — we’re fast.<br>Website: <a href="https://cyrushq.ai" style="color:#C9A84C;">cyrushq.ai</a></p>
  </div>
  <div style="background:#F8F6F1; padding:20px 32px; text-align:center; border-top:2px solid #C9A84C;">
    <p style="color:#888; font-size:12px; margin:0;">© 2026 CyrusHQ · cyrushq.ai · hello@cyrushq.ai<br>Build wisely. Lead calmly. Create systems that endure.</p>
  </div>
</div>`.trim();

  await sendGHLEmail({ contactId, to: email, subject: `Your AI Growth Engine Pack is ready, ${firstName} 👑`, html: emailBody });
  return true;
}

async function triggerGHLBookBundleWorkflow({ email, name }) {
  const firstName = (name || 'Friend').split(' ')[0];
  const lastName  = (name || '').split(' ').slice(1).join(' ') || '';
  const tags = ['cyrushq-customer', 'book-bundle-purchased'];

  const contactId = await upsertGHLContact({ email, firstName, lastName, tags });
  if (!contactId) return false;

  await mergeGHLTags(contactId, tags);

  const emailBody = `
<div style="font-family:'Inter',Arial,sans-serif; max-width:600px; margin:0 auto; color:#1a1a2e;">
  <div style="background:#0A1628; padding:32px; text-align:center;">
    <h1 style="color:#C9A84C; margin:0; font-size:24px; letter-spacing:2px; font-family:Georgia,serif;">CYRUSHQ.AI</h1>
    <p style="color:#8BA3C4; margin:8px 0 0; font-size:13px;">AI Agency Blueprint</p>
  </div>
  <div style="padding:40px 32px; background:#fff;">
    <h2 style="color:#0A1628; margin:0 0 10px; font-family:Georgia,serif;">Your books are ready, ${firstName}. 👑</h2>
    <p style="color:#555; line-height:1.6; margin:0 0 20px;">Your purchase is confirmed. Download your PDFs below — they're available immediately.</p>
    <div style="margin:28px 0;">
      <a href="https://cyrushq.ai/downloads/6-figure-blueprint-cyrushq-2026-mN7xQ2wL.pdf"
         style="display:block; background:#C9A84C; color:#0A1628; padding:16px 24px; text-decoration:none; font-weight:700; font-size:15px; letter-spacing:1px; text-transform:uppercase; margin-bottom:12px;">
        📄 Download: 6-Figure AI Agency Blueprint →
      </a>
      <a href="https://cyrushq.ai/downloads/ai-agent-playbook-cyrushq-2026-xK9mP3qR.pdf"
         style="display:block; background:#C9A84C; color:#0A1628; padding:16px 24px; text-decoration:none; font-weight:700; font-size:15px; letter-spacing:1px; text-transform:uppercase;">
        📄 Download: AI Agent Playbook →
      </a>
    </div>
    <p style="color:#555; font-size:14px; line-height:1.6; margin-top:20px;"><strong>Where to start:</strong><br>Open the 6-Figure AI Agency Blueprint and begin with Chapter 1.</p>
    <div style="background:#fffbeb; border:1px solid #C9A84C; border-radius:8px; padding:14px 18px; margin-top:20px;">
      <p style="color:#555; font-size:13px; margin:0; line-height:1.6;">⚡ <strong>Added any bonuses?</strong> A separate email with your course access link is on its way.</p>
    </div>
    <p style="color:#888; font-size:13px; margin-top:16px; line-height:1.5;">Questions? Just reply to this email — we're fast.<br>Download page: <a href="https://cyrushq.ai/book-thankyou" style="color:#C9A84C;">cyrushq.ai/book-thankyou</a></p>
  </div>
  <div style="background:#F8F6F1; padding:20px 32px; text-align:center; border-top:2px solid #C9A84C;">
    <p style="color:#888; font-size:12px; margin:0;">© 2026 CyrusHQ · cyrushq.ai · hello@cyrushq.ai<br>Build wisely. Lead calmly. Create systems that endure.</p>
  </div>
</div>`.trim();

  await sendGHLEmail({ contactId, to: email, subject: `Your AI books are ready, ${firstName} 📄`, html: emailBody });
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const rawBody   = await getRawBody(req);
  const signature = req.headers['stripe-signature'];
  const secret    = process.env.STRIPE_COURSE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

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

  // Handle payment_intent.succeeded — funnel/custom checkout purchases (metadata on PI)
  if (event.type === 'payment_intent.succeeded') {
    const pi    = event.data.object;
    const meta  = pi.metadata || {};
    const email = meta.customer_email || pi.receipt_email;
    const name  = meta.customer_name  || '';

    if (!email) {
      console.error('No email on payment_intent:', pi.id);
      return res.status(200).json({ received: true, note: 'no email' });
    }

    const product       = meta.product || '';
    const isBundle      = product === 'complete-bundle';
    const isBookBundle  = product === 'book-bundle';
    const fbp           = meta.fbp || null;
    const fbc           = meta.fbc || null;
    const eventSourceUrl = meta.event_source_url || null;

    const courseProducts = ['build-your-ai-ceo', 'ai-ceo-starter-kit', 'cron-job-mastery', 'complete-bundle', 'book-bundle'];

    if (courseProducts.includes(product)) {
      if (isBookBundle) {
        console.log(`Book bundle for ${email}`);
        await triggerGHLBookBundleWorkflow({ email, name });

      } else if (product === 'build-your-ai-ceo' || isBundle) {
        console.log(`Course welcome for ${email} — product:${product}`);
        await triggerGHLCourseWorkflow({ email, name, hasCronBump: false, hasStarterKit: isBundle, isBundle });

      } else if (product === 'cron-job-mastery') {
        console.log(`Cron email + tag for ${email}`);
        await triggerGHLCronEmail({ email, name });

      } else if (product === 'ai-ceo-starter-kit') {
        const upsellTags = ['cyrushq-customer', 'course-build-your-ai-ceo', 'ai-ceo-starter-kit-purchased'];
        console.log(`Starter kit tag-only for ${email}`);
        await addGHLTagsOnly({ email, name, tags: upsellTags });
      }

      console.log(`Meta CAPI for ${email} — PI: ${pi.id}`);
      await sendMetaCAPIEvent({ email, name, customerId: pi.customer, fbp, fbc, eventSourceUrl, paymentIntentId: pi.id, amountCents: pi.amount });
    }
  }

  // Handle checkout.session.completed — Stripe payment link purchases (metadata on session)
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta    = session.metadata || {};
    const email   = session.customer_details?.email || meta.customer_email || '';
    const name    = session.customer_details?.name  || meta.customer_name  || '';
    const product = meta.product || meta.product_key || '';

    if (!email || !product) {
      console.log('checkout.session.completed — missing email or product, skipping:', { email, product });
      return res.status(200).json({ received: true, note: 'no email or product' });
    }

    console.log(`checkout.session.completed — product:${product} email:${email}`);

    const isBundle     = product === 'complete-bundle';
    const isBookBundle = product === 'book-bundle';

    if (isBundle) {
      console.log(`Complete Bundle (payment link) for ${email}`);
      await triggerGHLCourseWorkflow({ email, name, hasCronBump: true, hasStarterKit: true, isBundle: true });
    } else if (isBookBundle || product === '2-book-bundle') {
      console.log(`Book bundle (payment link) for ${email}`);
      await triggerGHLBookBundleWorkflow({ email, name });
    } else if (product === 'build-your-ai-ceo') {
      await triggerGHLCourseWorkflow({ email, name, hasCronBump: false, hasStarterKit: false, isBundle: false });
    } else if (product === 'ai-ceo-starter-kit') {
      console.log(`Starter kit email + tag for ${email}`);
      await triggerGHLStarterKitEmail({ email, name });
    } else if (product === 'ai-growth-engine-pack') {
      console.log(`Growth engine email + tag for ${email}`);
      await triggerGHLGrowthEngineEmail({ email, name });
    }
    // Meta CAPI for checkout.session purchases
    await sendMetaCAPIEvent({
      email, name,
      customerId: session.customer,
      fbp: meta.fbp || null,
      fbc: meta.fbc || null,
      eventSourceUrl: meta.event_source_url || 'https://cyrushq.ai',
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
      amountCents: session.amount_total
    });
  }

  return res.status(200).json({ received: true });
}

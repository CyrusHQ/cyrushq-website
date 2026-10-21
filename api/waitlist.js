// POST /api/waitlist
// Captures name + email for the Advanced Course waitlist.
// Upserts GHL contact, merges 'advanced-course-waitlist' tag, sends confirmation email.

const GHL_BASE   = 'https://services.leadconnectorhq.com';
const GHL_LOC_ID = 'FitEZb4RfLdF1TkKxZEC';

function getGHLKey() {
  return (process.env.GHL_API_KEY || '').trim();
}

function ghlHeaders() {
  return {
    'Authorization': `Bearer ${getGHLKey()}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28'
  };
}

async function upsertGHLContact({ email, firstName, lastName, tags }) {
  const res = await fetch(`${GHL_BASE}/contacts/`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify({ email, firstName, lastName, locationId: GHL_LOC_ID, tags })
  });
  const d = await res.json();
  const contactId = d.contact?.id || d.meta?.contactId;
  if (!contactId) {
    console.error('GHL waitlist upsert failed for', email, JSON.stringify(d));
  }
  return contactId || null;
}

async function mergeGHLTags(contactId, tagsToAdd) {
  if (!contactId || !tagsToAdd?.length) return;
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const getRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, { headers: ghlHeaders() });
    const getData = await getRes.json();
    const existing = getData.contact?.tags || [];
    const merged = [...new Set([...existing, ...tagsToAdd])];
    await fetch(`${GHL_BASE}/contacts/${contactId}`, {
      method: 'PUT',
      headers: ghlHeaders(),
      body: JSON.stringify({ tags: merged })
    });
    const verifyRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, { headers: ghlHeaders() });
    const verifyData = await verifyRes.json();
    const finalTags = verifyData.contact?.tags || [];
    const allPresent = tagsToAdd.every(t => finalTags.includes(t));
    if (allPresent) {
      console.log(`Waitlist tags merged for ${contactId} (attempt ${attempt}):`, finalTags);
      return;
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, attempt * 500));
    } else {
      console.error(`Waitlist tag verify failed after ${MAX_ATTEMPTS} attempts for ${contactId}`);
    }
  }
}

async function sendGHLEmail({ contactId, to, subject, html }) {
  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify({
      type: 'Email',
      contactId,
      subject,
      html,
      fromName: 'CyrusHQ',
      from: 'hello@send.cyrushq.ai',
      to
    })
  });
  const d = await res.json();
  console.log('Waitlist confirmation email result:', JSON.stringify(d));
  return d;
}

export default async function handler(req, res) {
  // CORS — allow requests from cyrushq.ai
  res.setHeader('Access-Control-Allow-Origin', 'https://cyrushq.ai');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email } = req.body || {};

  if (!email || !name) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  const emailLower = email.trim().toLowerCase();
  const nameParts  = name.trim().split(' ');
  const firstName  = nameParts[0] || '';
  const lastName   = nameParts.slice(1).join(' ') || '';
  const tags       = ['advanced-course-waitlist'];

  try {
    // 1. Upsert contact
    const contactId = await upsertGHLContact({ email: emailLower, firstName, lastName, tags });

    if (contactId) {
      // 2. Merge tag — safe for pre-existing contacts
      await mergeGHLTags(contactId, tags);

      // 3. Confirmation email
      const emailHtml = `
<div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a2e;">
  <div style="background:#070A13;padding:32px;text-align:center;border-bottom:2px solid #C9A84C;">
    <h1 style="color:#C9A84C;margin:0;font-size:22px;letter-spacing:3px;font-family:Georgia,serif;">CYRUSHQ.AI</h1>
    <p style="color:#8BA3C4;margin:8px 0 0;font-size:13px;">Advanced AI Systems</p>
  </div>
  <div style="padding:40px 32px;background:#ffffff;">
    <h2 style="color:#070A13;margin:0 0 16px;font-family:Georgia,serif;font-size:22px;line-height:1.3;">
      You're on the list, ${firstName}. 🏛️
    </h2>
    <p style="color:#555;line-height:1.7;margin:0 0 20px;font-size:15px;">
      The Advanced AI Systems course is being built right now — deep tool integration, 
      multi-agent orchestration, and full autonomous system architecture. The kind of build 
      that changes how you operate.
    </p>
    <p style="color:#555;line-height:1.7;margin:0 0 24px;font-size:15px;">
      As a founding member of this waitlist, you'll be the first to know when doors open — 
      and you'll get access before it's announced publicly.
    </p>
    <div style="background:#F8F6F1;border-left:4px solid #C9A84C;padding:18px 22px;margin:28px 0;border-radius:0 6px 6px 0;">
      <p style="color:#070A13;margin:0;font-size:14px;font-weight:600;line-height:1.6;">
        What's coming in the Advanced Course:<br>
        <span style="color:#555;font-weight:400;">
          • Deep tool integration &amp; API orchestration<br>
          • Multi-agent systems that coordinate and delegate<br>
          • Full autonomous system builds — end to end<br>
          • Production-grade architecture, not just demos
        </span>
      </p>
    </div>
    <p style="color:#888;font-size:13px;line-height:1.6;margin-top:28px;">
      In the meantime, if you haven't already — 
      <a href="https://cyrushq.ai/course-pro" style="color:#C9A84C;text-decoration:none;font-weight:600;">the $97 course</a> 
      is the foundation everything else is built on.<br><br>
      Questions? Just reply to this email.<br>
      — The CyrusHQ Team
    </p>
  </div>
  <div style="background:#F8F6F1;padding:20px 32px;text-align:center;border-top:2px solid #C9A84C;">
    <p style="color:#aaa;font-size:12px;margin:0;line-height:1.6;">
      © 2026 CyrusHQ · <a href="https://cyrushq.ai" style="color:#C9A84C;text-decoration:none;">cyrushq.ai</a><br>
      Build wisely. Lead calmly. Create systems that endure.
    </p>
  </div>
</div>`.trim();

      await sendGHLEmail({
        contactId,
        to: emailLower,
        subject: `You're on the Advanced Course waitlist, ${firstName} 🏛️`,
        html: emailHtml
      });
    } else {
      // Contact creation failed — log it, still return success to user (don't block UX)
      console.error(`Waitlist: GHL contact creation failed for ${emailLower} — email not sent`);
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Waitlist handler error:', err.message, err.stack);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

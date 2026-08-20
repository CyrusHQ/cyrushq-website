// POST /api/send-kit-update
// One-time bulk send: updated starter kit notification to all buyers
// Remove this file after use.

const BUYERS = [
  { email: 'jgrullon2@hotmail.com',            name: 'Joe' },
  { email: 'beth.shaffer66@gmail.com',          name: 'Beth' },
  { email: 'wmp@journeydigital.net',            name: 'Wayne' },
  { email: 'y.a.j.w84@gmail.com',              name: 'Akini' },
  { email: 'bwhit54@yahoo.com',                 name: 'William' },
  { email: 'omnath81@gmail.com',                name: 'Omnath' },
  { email: 'tools@omegabreweronline.com',       name: 'Omega' },
  { email: 'gessick@gmail.com',                 name: 'Gregory' },
  { email: 'oburg004@gmail.com',                name: 'Ochez' },
  { email: 'rwhytemere82@gmail.com',            name: 'Michael' },
  { email: 'socialsimplicity4you@gmail.com',    name: 'David' },
];

const GHL_BASE        = 'https://services.leadconnectorhq.com';
const GHL_LOCATION_ID = 'FitEZb4RfLdF1TkKxZEC';
const KIT_URL         = 'https://cyrushq.ai/downloads/ai-ceo-starter-kit-cyrushq-2026-pR4vK8nJ.zip';

function buildEmail(firstName) {
  return `
<div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a2e;">

  <!-- Header -->
  <div style="background:#070A13;padding:32px;text-align:center;border-bottom:2px solid #C9A84C;">
    <h1 style="color:#C9A84C;margin:0;font-size:24px;letter-spacing:3px;font-family:Georgia,serif;">CYRUSHQ.AI</h1>
    <p style="color:#8BA3C4;margin:8px 0 0;font-size:13px;letter-spacing:1px;">Build Your AI CEO</p>
  </div>

  <!-- Body -->
  <div style="padding:44px 40px;background:#ffffff;">
    <h2 style="color:#070A13;margin:0 0 16px;font-family:Georgia,serif;font-size:22px;">
      Your AI CEO Starter Kit just got a major upgrade. 👑
    </h2>

    <p style="color:#444;line-height:1.7;font-size:15px;margin:0 0 6px;">
      Hey ${firstName},
    </p>
    <p style="color:#444;line-height:1.7;font-size:15px;margin:0 0 24px;">
      Thank you for purchasing the AI CEO Starter Kit — we've been working hard to make it even better for you. The new version is ready and it's yours, no new purchase needed.
    </p>

    <!-- What's new -->
    <div style="background:#f8f6f1;border:2px solid #C9A84C;border-radius:10px;padding:24px 28px;margin:0 0 28px;">
      <p style="color:#7a5c1e;font-weight:700;font-size:14px;margin:0 0 14px;letter-spacing:.5px;text-transform:uppercase;">What's New in This Version</p>

      <p style="color:#333;font-size:14px;margin:0 0 8px;">
        ✅ <strong>3-folder structure</strong> — organized so you know exactly what to do and in what order
      </p>
      <p style="color:#555;font-size:13px;margin:0 0 4px;padding-left:20px;">
        📁 <strong>Core Identity Files</strong> — the 5 files that define who your AI CEO is
      </p>
      <p style="color:#555;font-size:13px;margin:0 0 4px;padding-left:20px;">
        📁 <strong>Business System Files</strong> — all 24 operating engines
      </p>
      <p style="color:#555;font-size:13px;margin:0 0 16px;padding-left:20px;">
        📁 <strong>START HERE</strong> — setup guide + interactive HTML viewer
      </p>

      <p style="color:#333;font-size:14px;margin:0 0 8px;">
        ✅ <strong>Every file now includes a .txt version</strong> — open and edit on any computer, no special software needed
      </p>

      <p style="color:#333;font-size:14px;margin:0 0 8px;">
        ✅ <strong>New 6-step Setup Guide</strong> — from installation to your first venture launch, including a test prompt to verify your system is working
      </p>

      <p style="color:#333;font-size:14px;margin:0;">
        ✅ <strong>Interactive HTML Viewer</strong> — browse all 29 files in your browser, search for [ ] placeholders instantly with Cmd+F
      </p>
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin:0 0 28px;">
      <a href="${KIT_URL}"
         style="display:inline-block;background:#C9A84C;color:#070A13;padding:18px 36px;
                text-decoration:none;font-weight:700;font-size:15px;letter-spacing:1px;
                text-transform:uppercase;border-radius:4px;">
        ⬇ Download Your Updated Kit →
      </a>
    </div>

    <div style="background:#fffbeb;border:1px solid #C9A84C;border-radius:8px;padding:14px 18px;margin:0 0 24px;text-align:center;">
      <p style="color:#444;font-size:13px;margin:0;line-height:1.6;">
        This is the same kit you purchased — just significantly better organized and easier to use.<br>
        <strong>No new purchase needed. This is yours.</strong>
      </p>
    </div>

    <p style="color:#888;font-size:13px;line-height:1.6;margin:0;">
      Welcome to the CyrusHQ community. We're just getting started. 👑<br><br>
      Questions? Reply to this email — we're fast.<br>
      <a href="mailto:hello@cyrushq.ai" style="color:#C9A84C;text-decoration:none;">hello@cyrushq.ai</a>
    </p>
  </div>

  <!-- Footer -->
  <div style="background:#F8F6F1;padding:20px 32px;text-align:center;border-top:2px solid #C9A84C;">
    <p style="color:#888;font-size:12px;margin:0;line-height:1.7;">
      © 2026 CyrusHQ · <a href="https://cyrushq.ai" style="color:#C9A84C;text-decoration:none;">cyrushq.ai</a> · <a href="mailto:hello@cyrushq.ai" style="color:#C9A84C;text-decoration:none;">hello@cyrushq.ai</a><br>
      Build wisely. Lead calmly. Create systems that endure.
    </p>
  </div>

</div>`.trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const hexKey    = process.env.GHL_API_KEY || '';
  const GHL_KEY   = /^[0-9a-fA-F]{64,}$/.test(hexKey)
    ? Buffer.from(hexKey, 'hex').toString('utf8').trim()
    : hexKey.trim();

  const GHL_HEADERS = {
    'Authorization': `Bearer ${GHL_KEY}`,
    'Content-Type':  'application/json',
    'Version':       '2021-07-28'
  };

  const results = [];

  for (const buyer of BUYERS) {
    try {
      // 1. Upsert contact
      const cRes = await fetch(`${GHL_BASE}/contacts/`, {
        method: 'POST',
        headers: GHL_HEADERS,
        body: JSON.stringify({
          email: buyer.email,
          firstName: buyer.name,
          locationId: GHL_LOCATION_ID,
          tags: ['cyrushq-customer', 'kit-update-sent-aug-2026']
        })
      });
      const cData   = await cRes.json();
      const contactId = cData.contact?.id || cData.meta?.contactId;

      if (!contactId) {
        results.push({ email: buyer.email, status: 'error', detail: 'contact upsert failed' });
        continue;
      }

      // 2. Send email
      const eRes = await fetch(`${GHL_BASE}/conversations/messages`, {
        method: 'POST',
        headers: GHL_HEADERS,
        body: JSON.stringify({
          type:      'Email',
          contactId,
          subject:   'Your AI CEO Starter Kit just got a major upgrade 👑',
          html:      buildEmail(buyer.name),
          fromName:  'CyrusHQ Team',
          from:      'hello@cyrushq.ai',
          to:        buyer.email
        })
      });
      const eData = await eRes.json();
      results.push({ email: buyer.email, status: eRes.ok ? 'sent' : 'error', detail: JSON.stringify(eData).slice(0, 120) });

    } catch (err) {
      results.push({ email: buyer.email, status: 'exception', detail: err.message });
    }
  }

  const sent   = results.filter(r => r.status === 'sent').length;
  const errors = results.filter(r => r.status !== 'sent').length;
  return res.status(200).json({ sent, errors, results });
}

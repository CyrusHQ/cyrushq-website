// GET /api/get-portal-link?e=EMAIL
// Generates a valid magic portal link for a confirmed buyer.
// Called by course-thankyou.html to wire the "Go to Portal" button directly.

import { createHmac } from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const rawEmail = (req.query.e || '').trim().toLowerCase();
  if (!rawEmail || !rawEmail.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const PORTAL_SECRET = process.env.PORTAL_SECRET || '';
  if (!PORTAL_SECRET) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const token = createHmac('sha256', PORTAL_SECRET)
    .update(`${PORTAL_SECRET}:${rawEmail}`)
    .digest('hex');

  const magicLink = `https://cyrushq.ai/members?t=${token}&e=${encodeURIComponent(rawEmail)}`;

  return res.status(200).json({ url: magicLink });
}

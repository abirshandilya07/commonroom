import { z } from 'zod';

// GIF search through GIPHY, proxied by the server so the API key stays private and the
// app's strict image policy (same-origin only) still holds. A picked GIF is then sent like
// any photo: encrypted in the browser and uploaded as an attachment.
const MEDIA_HOST = /^(media\d*|i)\.giphy\.com$/;
const MAX_GIF_BYTES = 8 * 1024 * 1024;
export function registerGifs({app, requireUser, apiKey, fetchImpl = fetch}) {
  const proxied = (url) => `/api/gifs/file?u=${encodeURIComponent(url)}`;
  app.get('/api/gifs/status', requireUser, (_req, res) => res.json({configured: !!apiKey}));
  app.get('/api/gifs/search', requireUser, async (req, res) => {
    if (!apiKey) return res.status(503).json({error: 'GIF search is off. Add GIPHY_API_KEY to backend/.env and restart.'});
    const q = z.string().trim().max(50).catch('').parse(req.query.q);
    const url = q
      ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(apiKey)}&limit=24&rating=pg-13`;
    let data;
    try {
      const response = await fetchImpl(url, {signal: AbortSignal.timeout(10_000)});
      data = await response.json().catch(() => ({}));
      if (!response.ok) return res.status(502).json({error: response.status === 401 || response.status === 403 ? 'GIPHY rejected the API key. Check GIPHY_API_KEY in backend/.env.' : 'GIF search is unavailable right now.'});
    } catch {return res.status(502).json({error: 'Couldn’t reach GIPHY. Check your internet connection.'});}
    const gifs = (data.data || []).map(g => {
      const preview = g.images?.fixed_width_small?.url || g.images?.fixed_width?.url;
      const full = g.images?.downsized?.url || g.images?.original?.url;
      return preview && full ? {id: String(g.id), title: String(g.title || 'GIF').slice(0, 80), preview: proxied(preview), full: proxied(full)} : null;
    }).filter(Boolean);
    res.json({gifs});
  });
  app.get('/api/gifs/file', requireUser, async (req, res) => {
    let target;
    try {target = new URL(String(req.query.u || ''));} catch {return res.status(400).json({error: 'Invalid GIF.'});}
    // Only GIPHY's media hosts: the proxy can't be used to fetch anything else.
    if (target.protocol !== 'https:' || !MEDIA_HOST.test(target.hostname)) return res.status(400).json({error: 'Invalid GIF.'});
    try {
      const response = await fetchImpl(target, {signal: AbortSignal.timeout(15_000), redirect: 'error'});
      const type = response.headers.get('content-type') || '';
      if (!response.ok || !/^image\/(gif|webp)/.test(type)) return res.status(502).json({error: 'GIF unavailable.'});
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_GIF_BYTES) return res.status(413).json({error: 'That GIF is too large.'});
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.type(type.split(';')[0]).send(bytes);
    } catch {res.status(502).json({error: 'GIF unavailable.'});}
  });
}

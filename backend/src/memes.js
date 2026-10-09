import { z } from 'zod';

// Memer: a random Reddit meme from meme-api.com (free, no key), fetched by the server.
// NSFW and spoiler posts are skipped. The image is proxied same-origin, then sent like any
// photo: encrypted in the browser and uploaded as an attachment, so everyone in the chat sees it.
const API = 'https://meme-api.com/gimme';
const IMAGE_HOST = /^(i\.redd\.it|preview\.redd\.it|i\.imgur\.com)$/;
const MAX_MEME_BYTES = 8 * 1024 * 1024;
export const SUBREDDIT = /^[A-Za-z0-9_]{2,21}$/;
export function registerMemes({app, requireUser, fetchImpl = fetch}) {
  app.get('/api/memes/random', requireUser, async (req, res) => {
    const sub = z.string().trim().regex(SUBREDDIT).optional().catch(undefined).parse(req.query.sub || undefined);
    if (req.query.sub && !sub) return res.status(400).json({error: 'That isn’t a valid subreddit name.'});
    let data;
    try {
      const response = await fetchImpl(`${API}/${sub ? `${encodeURIComponent(sub)}/` : ''}10`, {signal: AbortSignal.timeout(10_000)});
      data = await response.json().catch(() => ({}));
      if (!response.ok) return res.status(response.status === 404 || response.status === 400 ? 404 : 502).json({error: sub ? `Couldn’t find memes in r/${sub}.` : 'The meme service is unavailable right now.'});
    } catch {return res.status(502).json({error: 'Couldn’t reach the meme service. Check your internet connection.'});}
    const memes = (data.memes || [data]).filter(m => m && !m.nsfw && !m.spoiler && typeof m.url === 'string').filter(m => {
      try {const u = new URL(m.url); return u.protocol === 'https:' && IMAGE_HOST.test(u.hostname) && /\.(jpe?g|png|gif|webp)$/i.test(u.pathname);} catch {return false;}
    });
    const meme = memes[Math.floor(Math.random() * memes.length)];
    if (!meme) return res.status(404).json({error: sub ? `No safe memes found in r/${sub}.` : 'No safe memes found right now. Try again.'});
    res.json({
      title: String(meme.title || 'Meme').slice(0, 200),
      subreddit: String(meme.subreddit || sub || 'memes').slice(0, 30),
      postLink: typeof meme.postLink === 'string' && meme.postLink.startsWith('https://') ? meme.postLink : null,
      image: `/api/memes/file?u=${encodeURIComponent(meme.url)}`,
    });
  });
  app.get('/api/memes/file', requireUser, async (req, res) => {
    let target;
    try {target = new URL(String(req.query.u || ''));} catch {return res.status(400).json({error: 'Invalid meme.'});}
    // Only Reddit and Imgur image hosts: the proxy can't be used to fetch anything else.
    if (target.protocol !== 'https:' || !IMAGE_HOST.test(target.hostname)) return res.status(400).json({error: 'Invalid meme.'});
    try {
      const response = await fetchImpl(target, {signal: AbortSignal.timeout(15_000), redirect: 'error'});
      const type = response.headers.get('content-type') || '';
      if (!response.ok || !/^image\/(jpeg|png|gif|webp)/.test(type)) return res.status(502).json({error: 'Meme unavailable.'});
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_MEME_BYTES) return res.status(413).json({error: 'That meme is too large.'});
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.type(type.split(';')[0]).send(bytes);
    } catch {res.status(502).json({error: 'Meme unavailable.'});}
  });
}

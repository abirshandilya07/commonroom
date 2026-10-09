import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { conversationFor, membersFor } from './chat.js';

// Moderation: anyone can block a person or report a message; a group's creator reviews its reports.
// Messages are end-to-end encrypted, so a report only carries text the reporter chooses to include.
export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'inappropriate', 'other'];
export function registerModeration({app, io, db, requireUser, room}) {
  const userExists = (id) => !!db.prepare('SELECT id FROM users WHERE id=?').get(id);
  const blocksOf = (userId) => db.prepare('SELECT blocked_id FROM blocks WHERE blocker_id=?').all(userId).map(r => r.blocked_id);
  app.get('/api/blocks', requireUser, (req, res) => res.json({blocked: blocksOf(req.user.id)}));
  app.put('/api/blocks/:userId', requireUser, (req, res) => {
    if (req.params.userId === req.user.id) return res.status(400).json({error: 'You can’t block yourself.'});
    if (!userExists(req.params.userId)) return res.status(404).json({error: 'User not found.'});
    db.prepare('INSERT OR IGNORE INTO blocks VALUES(?,?,?)').run(req.user.id, req.params.userId, new Date().toISOString());
    io.to(room(req.user.id)).emit('blocks:changed');
    res.json({blocked: blocksOf(req.user.id)});
  });
  app.delete('/api/blocks/:userId', requireUser, (req, res) => {
    db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(req.user.id, req.params.userId);
    io.to(room(req.user.id)).emit('blocks:changed');
    res.json({blocked: blocksOf(req.user.id)});
  });

  const reportInput = z.object({reason: z.enum(REPORT_REASONS), note: z.string().trim().max(500).optional(), excerpt: z.string().max(2000).optional()}).strict();
  const reportView = (r) => ({id: r.id, messageId: r.message_id, conversationId: r.conversation_id, reason: r.reason, note: r.note || '', excerpt: r.excerpt || '',
    reporter: {id: r.reporter_id, name: r.reporter_name}, sender: {id: r.sender_id, name: r.sender_name}, messageDeleted: !!r.deleted_at, createdAt: r.created_at});
  const reviewers = (conversationId) => {
    const c = db.prepare('SELECT kind,created_by FROM conversations WHERE id=?').get(conversationId);
    return c?.kind === 'group' ? [c.created_by] : [];
  };
  app.post('/api/messages/:id/report', requireUser, (req, res) => {
    const messageId = z.coerce.number().int().positive().parse(req.params.id);
    const input = reportInput.parse(req.body);
    const message = db.prepare('SELECT * FROM messages WHERE id=?').get(messageId);
    if (!message || !conversationFor(db, message.conversation_id, req.user.id)) return res.status(404).json({error: 'Message not found.'});
    if (message.sender_id === req.user.id) return res.status(400).json({error: 'You can’t report your own message.'});
    const reason = input.note ? `${input.reason}: ${input.note}` : input.reason;
    try {
      db.prepare('INSERT INTO reports(id,reporter_id,message_id,conversation_id,reason,excerpt,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), req.user.id, messageId, message.conversation_id, reason, input.excerpt || null, new Date().toISOString());
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return res.status(409).json({error: 'You already reported this message.'});
      throw error;
    }
    io.to(reviewers(message.conversation_id).map(room)).emit('reports:changed', {conversationId: message.conversation_id});
    res.status(201).json({ok: true, reviewed: reviewers(message.conversation_id).length > 0});
  });
  const listReports = (conversationId) => db.prepare(`SELECT r.*, u.name AS reporter_name, m.sender_id, s.name AS sender_name, m.deleted_at FROM reports r
    JOIN users u ON u.id=r.reporter_id JOIN messages m ON m.id=r.message_id JOIN users s ON s.id=m.sender_id
    WHERE r.conversation_id=? AND r.resolved_at IS NULL ORDER BY r.created_at DESC LIMIT 100`).all(conversationId).map(reportView);
  const requireModerator = (req, res) => {
    const c = conversationFor(db, req.params.id, req.user.id);
    if (!c) {res.status(404).json({error: 'Conversation not found.'}); return null;}
    if (c.kind !== 'group' || c.created_by !== req.user.id) {res.status(403).json({error: 'Only the group creator can review reports.'}); return null;}
    return c;
  };
  app.get('/api/conversations/:id/reports', requireUser, (req, res) => {
    if (!requireModerator(req, res)) return;
    res.json({reports: listReports(req.params.id)});
  });
  app.post('/api/conversations/:id/reports/:reportId/resolve', requireUser, (req, res) => {
    if (!requireModerator(req, res)) return;
    if (!db.prepare('UPDATE reports SET resolved_at=? WHERE id=? AND conversation_id=? AND resolved_at IS NULL').run(new Date().toISOString(), req.params.reportId, req.params.id).changes) return res.status(404).json({error: 'Report not found.'});
    io.to(room(req.user.id)).emit('reports:changed', {conversationId: req.params.id});
    res.json({ok: true});
  });
  return {membersFor};
}

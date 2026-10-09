import { z } from 'zod';
import { avatarUrl } from './chat.js';

// Friends: anyone can send a request; once accepted, friends see each other's presence on the home screen.
// A request either way between people where one has blocked the other is refused.
export const friendIdsOf = (db, userId) => db.prepare("SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END AS id FROM friendships WHERE (user_a=? OR user_b=?) AND status='accepted'").all(userId, userId, userId).map(r => r.id);
export const friendshipBetween = (db, me, other) => {
  const [a, b] = [me, other].sort();
  const row = db.prepare('SELECT * FROM friendships WHERE user_a=? AND user_b=?').get(a, b);
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  return row.requested_by === me ? 'outgoing' : 'incoming';
};
export const removeFriendship = (db, one, two) => {const [a, b] = [one, two].sort(); return db.prepare('DELETE FROM friendships WHERE user_a=? AND user_b=?').run(a, b).changes;};

export function registerFriends({app, io, db, requireUser, room, visibleStatus, onFriendsChanged}) {
  const userId = z.string().uuid();
  const avatarVersion = (id) => db.prepare('SELECT updated_at FROM avatars WHERE user_id=?').get(id)?.updated_at;
  const person = (row) => ({id: row.id, name: row.name, username: row.username, avatarUrl: avatarUrl(row.id, avatarVersion(row.id))});
  const blockedEitherWay = (one, two) => !!db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)').get(one, two, two, one);
  const changed = (...ids) => {io.to(ids.map(room)).emit('friends:changed'); onFriendsChanged?.(ids);};
  const order = {online: 0, dnd: 1, offline: 2};
  const listFor = (me) => {
    const rows = db.prepare(`SELECT u.id,u.name,u.username,f.status,f.requested_by,f.created_at,f.accepted_at FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.user_a=? THEN f.user_b ELSE f.user_a END WHERE f.user_a=? OR f.user_b=?`).all(me, me, me);
    const friends = rows.filter(r => r.status === 'accepted').map(r => ({...person(r), status: visibleStatus(r.id), since: r.accepted_at}))
      .sort((x, y) => order[x.status] - order[y.status] || x.name.localeCompare(y.name));
    const pending = (mine) => rows.filter(r => r.status === 'pending' && (r.requested_by === me) === mine).map(r => ({...person(r), createdAt: r.created_at})).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    return {friends, incoming: pending(false), outgoing: pending(true)};
  };
  app.get('/api/friends', requireUser, (req, res) => res.json(listFor(req.user.id)));
  // Sending a request to someone who already asked you accepts theirs.
  app.post('/api/friends/requests', requireUser, (req, res) => {
    const {userId: target} = z.object({userId}).strict().parse(req.body);
    if (target === req.user.id) return res.status(400).json({error: 'You can’t add yourself as a friend.'});
    if (!db.prepare('SELECT id FROM users WHERE id=?').get(target)) return res.status(404).json({error: 'User not found.'});
    if (blockedEitherWay(req.user.id, target)) return res.status(403).json({error: 'You can’t send a friend request to this person.'});
    const state = friendshipBetween(db, req.user.id, target);
    if (state === 'friends') return res.status(409).json({error: 'You are already friends.'});
    if (state === 'outgoing') return res.status(409).json({error: 'Friend request already sent.'});
    const [a, b] = [req.user.id, target].sort(), now = new Date().toISOString();
    if (state === 'incoming') db.prepare("UPDATE friendships SET status='accepted',accepted_at=? WHERE user_a=? AND user_b=?").run(now, a, b);
    else db.prepare("INSERT INTO friendships VALUES(?,?,?,'pending',?,NULL)").run(a, b, req.user.id, now);
    changed(req.user.id, target);
    res.status(state === 'incoming' ? 200 : 201).json({friendship: friendshipBetween(db, req.user.id, target)});
  });
  app.post('/api/friends/requests/:userId/accept', requireUser, (req, res) => {
    const other = userId.parse(req.params.userId);
    if (friendshipBetween(db, req.user.id, other) !== 'incoming') return res.status(404).json({error: 'Friend request not found.'});
    const [a, b] = [req.user.id, other].sort();
    db.prepare("UPDATE friendships SET status='accepted',accepted_at=? WHERE user_a=? AND user_b=?").run(new Date().toISOString(), a, b);
    changed(req.user.id, other);
    res.json({friendship: 'friends'});
  });
  // Declines an incoming request or cancels one you sent.
  app.delete('/api/friends/requests/:userId', requireUser, (req, res) => {
    const other = userId.parse(req.params.userId);
    if (!['incoming', 'outgoing'].includes(friendshipBetween(db, req.user.id, other))) return res.status(404).json({error: 'Friend request not found.'});
    removeFriendship(db, req.user.id, other);
    changed(req.user.id, other);
    res.json({friendship: 'none'});
  });
  app.delete('/api/friends/:userId', requireUser, (req, res) => {
    const other = userId.parse(req.params.userId);
    if (friendshipBetween(db, req.user.id, other) !== 'friends') return res.status(404).json({error: 'You are not friends with this person.'});
    removeFriendship(db, req.user.id, other);
    changed(req.user.id, other);
    res.json({friendship: 'none'});
  });
}

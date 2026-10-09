import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { conversationFor, membersFor } from './chat.js';

// Common Room AI: a Gemini-powered assistant with its own private chat, @ai mentions in any
// conversation, and reminders/tasks. Chats stay end-to-end encrypted: the browser only sends
// the AI the message that mentions it, plus recent messages when the person asks it to read them.
export const AI_NAME = 'Common Room AI';
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const NOT_CONFIGURED = 'The AI assistant isn’t set up yet. Add GROQ_API_KEY=your-key (or GEMINI_API_KEY) to backend/.env, then restart Commonroom.';
const MAX_ACTIONS = 10;

const responseSchema = {
  type: 'OBJECT',
  properties: {
    reply: {type: 'STRING', description: 'Your answer to the person, in plain text or light Markdown.'},
    actions: {type: 'ARRAY', items: {type: 'OBJECT', properties: {
      type: {type: 'STRING', enum: ['reminder', 'task', 'complete']},
      title: {type: 'STRING', description: 'Short reminder/task text. Empty for complete.'},
      dueAt: {type: 'STRING', description: 'ISO 8601 date-time with the person’s UTC offset, or empty when there is no time.'},
      id: {type: 'STRING', description: 'Only for complete: the id of the open item to mark done.'},
    }, required: ['type']}},
  },
  required: ['reply', 'actions'],
};

export class AiError extends Error {}
// Groq's JSON mode has no schema, so the expected shape is spelled out in the instructions.
const JSON_FORMAT = 'Always answer with one JSON object only, no other text: {"reply": string, "actions": [{"type": "reminder"|"task"|"complete", "title": string, "dueAt": string, "id": string}]}. Use "actions": [] when there is nothing to create. dueAt is ISO 8601 with the person’s UTC offset, or "" when there is no time.';
const parseAnswer = (text) => {
  try {return JSON.parse(text);} catch {/* fall through */}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {try {return JSON.parse(match[0]);} catch {/* plain text */}}
  return {reply: text, actions: []};
};

// Calls Groq's OpenAI-compatible chat API from the server so the key never reaches the browser.
export function groqClient({apiKey, model = DEFAULT_GROQ_MODEL, fetchImpl = fetch} = {}) {
  if (!apiKey) return null;
  const call = (body) => fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(45_000),
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify(body),
  });
  const generate = async function generate({system, contents}) {
    const messages = [{role: 'system', content: `${system}\n\n${JSON_FORMAT}`},
      ...contents.map(c => ({role: c.role === 'model' ? 'assistant' : 'user', content: c.parts.map(p => p.text).join('\n')}))];
    const body = {model, messages, temperature: 0.4, max_completion_tokens: 2048, response_format: {type: 'json_object'}};
    let response, data;
    try {
      response = await call(body);
      data = await response.json().catch(() => ({}));
      // If the model's JSON didn't validate, ask again without strict JSON mode and parse leniently.
      if (response.status === 400 && /json/i.test(data?.error?.code || data?.error?.message || '')) {
        delete body.response_format;
        response = await call(body);
        data = await response.json().catch(() => ({}));
      }
    } catch {throw new AiError('Couldn’t reach Groq. Check your internet connection and try again.');}
    if (!response.ok) {
      console.error('Groq error', response.status, data?.error?.message);
      if (response.status === 401 || response.status === 403) throw new AiError('Groq rejected the API key. Check GROQ_API_KEY in backend/.env.');
      if (response.status === 429) throw new AiError('Groq is busy or over its free limit. Try again in a minute.');
      if (response.status === 404 || /model/i.test(data?.error?.message || '') && response.status === 400) throw new AiError(`Groq model “${model}” isn’t available. Set GROQ_MODEL in backend/.env to a current model.`);
      throw new AiError('The AI couldn’t answer that. Try rephrasing.');
    }
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new AiError('The AI didn’t return an answer. Try rephrasing.');
    return parseAnswer(text);
  };
  generate.provider = 'Groq';
  return generate;
}

// Calls the Gemini REST API from the server so the key never reaches the browser.
export function geminiClient({apiKey, model = DEFAULT_GEMINI_MODEL, fetchImpl = fetch} = {}) {
  if (!apiKey) return null;
  const generate = async function generate({system, contents}) {
    let response;
    try {
      response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(45_000),
        headers: {'Content-Type': 'application/json', 'x-goog-api-key': apiKey},
        body: JSON.stringify({systemInstruction: {parts: [{text: system}]}, contents,
          generationConfig: {temperature: 0.4, responseMimeType: 'application/json', responseSchema}}),
      });
    } catch {throw new AiError('Couldn’t reach Gemini. Check your internet connection and try again.');}
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Gemini error', response.status, data?.error?.message);
      if (response.status === 429) throw new AiError('Gemini is busy or over its free quota. Try again in a minute.');
      if (response.status === 404) throw new AiError(`Gemini model “${model}” wasn’t found. Set GEMINI_MODEL in backend/.env to a current model.`);
      if ([400, 401, 403].includes(response.status) && /api key|permission|unauth/i.test(data?.error?.message || '')) throw new AiError('Gemini rejected the API key. Check GEMINI_API_KEY in backend/.env.');
      throw new AiError('Gemini couldn’t answer that. Try rephrasing.');
    }
    const text = (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
    if (!text) throw new AiError('Gemini didn’t return an answer. Try rephrasing.');
    return parseAnswer(text);
  };
  generate.provider = 'Gemini';
  return generate;
}

const askInput = z.object({
  conversationId: z.string().uuid().optional(),
  prompt: z.string().trim().min(1).max(2000),
  // Recent decrypted messages, only sent when the person asks the AI to read the chat.
  context: z.array(z.object({name: z.string().max(80), text: z.string().max(2000), at: z.string().max(40).optional()}).strict()).max(50).optional(),
  timezone: z.string().max(64).optional(),
  offsetMinutes: z.number().int().min(-840).max(840).optional(),
}).strict();
const itemInput = z.object({kind: z.enum(['reminder', 'task']), title: z.string().trim().min(1).max(200), dueAt: z.string().datetime({offset: true}).nullable().optional(), conversationId: z.string().uuid().nullable().optional()}).strict();
const validDate = (value) => {if (!value) return null; const time = Date.parse(value); return Number.isFinite(time) ? new Date(time).toISOString() : null;};
const localTime = (offsetMinutes = 0) => {
  const local = new Date(Date.now() - offsetMinutes * 60_000).toISOString().slice(0, 19);
  const abs = Math.abs(offsetMinutes);
  return `${local}${offsetMinutes <= 0 ? '+' : '-'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};

export function registerAssistant({app, io, db, requireUser, room, generate, reminderIntervalMs = 15_000}) {
  const conversationName = (id, userId) => {
    if (!id) return null;
    const c = db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
    if (!c) return null;
    if (c.kind === 'group') return c.title;
    return membersFor(db, id).find(m => m.id !== userId)?.name || 'Direct message';
  };
  const itemView = (row) => ({id: row.id, kind: row.kind, title: row.title, dueAt: row.due_at, done: !!row.done, createdAt: row.created_at, conversationId: row.conversation_id, conversationName: conversationName(row.conversation_id, row.user_id)});
  const messageView = (row) => ({id: row.id, conversationId: row.conversation_id, role: row.role, body: row.body, contextCount: row.context_count,
    askedBy: row.conversation_id ? {id: row.user_id, name: db.prepare('SELECT name FROM users WHERE id=?').get(row.user_id)?.name || 'Someone'} : null,
    items: row.items ? JSON.parse(row.items) : [], createdAt: row.created_at});
  const insertMessage = (userId, conversationId, role, body, contextCount = 0, items = []) => {
    const result = db.prepare('INSERT INTO ai_messages(user_id,conversation_id,role,body,context_count,items,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(userId, conversationId, role, body, contextCount, items.length ? JSON.stringify(items) : null, new Date().toISOString());
    return messageView(db.prepare('SELECT * FROM ai_messages WHERE id=?').get(result.lastInsertRowid));
  };
  const openItems = (userId) => db.prepare('SELECT * FROM ai_items WHERE user_id=? AND done=0 ORDER BY COALESCE(due_at,created_at) LIMIT 40').all(userId);
  const itemsChanged = (userId) => io.to(room(userId)).emit('items:changed');
  const audience = (userId, conversationId) => conversationId ? membersFor(db, conversationId).map(m => room(m.id)) : [room(userId)];

  app.get('/api/ai/status', requireUser, (_req, res) => res.json({configured: !!generate, name: AI_NAME, provider: generate?.provider || null}));
  app.get('/api/ai/messages', requireUser, (req, res) => {
    const conversationId = typeof req.query.conversationId === 'string' ? req.query.conversationId : null;
    if (conversationId && !conversationFor(db, conversationId, req.user.id)) return res.status(404).json({error: 'Conversation not found.'});
    const rows = conversationId
      ? db.prepare('SELECT * FROM ai_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 100').all(conversationId)
      : db.prepare('SELECT * FROM ai_messages WHERE user_id=? AND conversation_id IS NULL ORDER BY id DESC LIMIT 200').all(req.user.id);
    res.json({messages: rows.reverse().map(messageView)});
  });
  app.delete('/api/ai/messages', requireUser, (req, res) => {
    db.prepare('DELETE FROM ai_messages WHERE user_id=? AND conversation_id IS NULL').run(req.user.id);
    io.to(room(req.user.id)).emit('ai:cleared');
    res.json({ok: true});
  });

  const asks = new Map();
  app.post('/api/ai/ask', requireUser, async (req, res) => {
    const input = askInput.parse(req.body);
    const userId = req.user.id, conversationId = input.conversationId || null;
    if (conversationId && !conversationFor(db, conversationId, userId)) return res.status(404).json({error: 'Conversation not found.'});
    const window = asks.get(userId);
    if (window && Date.now() - window.start < 60_000) {if (++window.count > 15) return res.status(429).json({error: 'You’re asking the AI a lot. Try again in a minute.'});}
    else asks.set(userId, {start: Date.now(), count: 1});
    const created = [];
    // In a private AI chat the question is saved so the conversation has memory.
    if (!conversationId) created.push(insertMessage(userId, null, 'user', input.prompt));
    const rooms = audience(userId, conversationId);
    if (created.length) io.to(rooms).emit('ai:message', created[0]);
    io.to(rooms).emit('ai:thinking', {conversationId, active: true});
    let reply, items = [], changed = false;
    try {
      if (!generate) reply = NOT_CONFIGURED;
      else {
        const offset = input.offsetMinutes ?? 0;
        const open = openItems(userId);
        const system = [
          `You are ${AI_NAME}, a friendly, concise assistant inside Commonroom, a private campus chat app. Keep answers short (under 150 words) unless asked for more.`,
          `You are talking with ${req.user.name} (@${req.user.username}). Their local time now is ${localTime(offset)}${input.timezone ? ` (${input.timezone})` : ''}.`,
          'You can create reminders and to-do tasks for this person by adding actions. Only create them when asked. A reminder needs dueAt; for a task dueAt is optional. Write dueAt in ISO 8601 with the person’s UTC offset. If a reminder has no clear time, ask for one instead of guessing. To mark an open item done, add {type:"complete", id}. Confirm what you created, with the time in their local time, in your reply.',
          open.length ? `Their open reminders and tasks:\n${open.map(i => `- id ${i.id}: ${i.kind} “${i.title}”${i.due_at ? ` due ${i.due_at} (UTC)` : ''}`).join('\n')}` : 'They have no open reminders or tasks.',
          conversationId
            ? (input.context?.length
              ? `They mentioned you in the chat “${conversationName(conversationId, userId)}” and asked you to read its recent messages, which are included. Use them only to answer this question.`
              : `They mentioned you in the chat “${conversationName(conversationId, userId)}”. You can’t see that chat’s other messages, for privacy. If they ask about the conversation, tell them to ask you to “read the chat”.`)
            : 'This is your private chat with them.',
        ].join('\n\n');
        let contents;
        if (conversationId) {
          const context = input.context?.length ? `Recent messages from the chat (oldest first):\n${input.context.map(m => `${m.name}: ${m.text}`).join('\n')}\n\n` : '';
          contents = [{role: 'user', parts: [{text: `${context}${req.user.name} asks: ${input.prompt}`}]}];
        } else {
          const history = db.prepare('SELECT role,body FROM ai_messages WHERE user_id=? AND conversation_id IS NULL ORDER BY id DESC LIMIT 20').all(userId).reverse();
          // Gemini expects alternating turns that start with the person, so merge runs such as reminder notices.
          contents = [];
          for (const m of history) {
            const role = m.role === 'assistant' ? 'model' : 'user';
            if (!contents.length && role === 'model') continue;
            if (contents.at(-1)?.role === role) contents.at(-1).parts[0].text += `\n\n${m.body}`;
            else contents.push({role, parts: [{text: m.body}]});
          }
        }
        const result = await generate({system, contents});
        reply = typeof result?.reply === 'string' && result.reply.trim() ? result.reply.trim().slice(0, 4000) : 'Done.';
        for (const action of (Array.isArray(result?.actions) ? result.actions : []).slice(0, MAX_ACTIONS)) {
          if (action?.type === 'complete') {
            if (db.prepare('UPDATE ai_items SET done=1 WHERE id=? AND user_id=?').run(String(action.id || ''), userId).changes) changed = true;
            continue;
          }
          if (!['reminder', 'task'].includes(action?.type)) continue;
          const title = String(action.title || '').trim().slice(0, 200);
          const dueAt = validDate(action.dueAt);
          if (!title || (action.type === 'reminder' && !dueAt)) continue;
          const id = randomUUID();
          db.prepare('INSERT INTO ai_items(id,user_id,conversation_id,kind,title,due_at,created_at) VALUES(?,?,?,?,?,?,?)').run(id, userId, conversationId, action.type, title, dueAt, new Date().toISOString());
          items.push({id, kind: action.type, title, dueAt});
          changed = true;
        }
      }
    } catch (error) {
      reply = error instanceof AiError ? error.message : 'The AI ran into a problem. Try again.';
      if (!(error instanceof AiError)) console.error(error);
    } finally {
      io.to(rooms).emit('ai:thinking', {conversationId, active: false});
    }
    const answer = insertMessage(userId, conversationId, 'assistant', reply, input.context?.length || 0, items);
    created.push(answer);
    io.to(rooms).emit('ai:message', answer);
    if (changed) itemsChanged(userId);
    res.json({messages: created});
  });

  // The "Reminders & tasks" section.
  app.get('/api/items', requireUser, (req, res) => res.json({items: db.prepare('SELECT * FROM ai_items WHERE user_id=? ORDER BY done, due_at IS NULL, due_at, created_at DESC').all(req.user.id).map(itemView)}));
  app.post('/api/items', requireUser, (req, res) => {
    const input = itemInput.parse(req.body);
    const dueAt = validDate(input.dueAt);
    if (input.kind === 'reminder' && !dueAt) return res.status(400).json({error: 'A reminder needs a date and time.'});
    if (input.conversationId && !conversationFor(db, input.conversationId, req.user.id)) return res.status(404).json({error: 'Conversation not found.'});
    const id = randomUUID();
    db.prepare('INSERT INTO ai_items(id,user_id,conversation_id,kind,title,due_at,created_at) VALUES(?,?,?,?,?,?,?)').run(id, req.user.id, input.conversationId || null, input.kind, input.title, dueAt, new Date().toISOString());
    itemsChanged(req.user.id);
    res.status(201).json({item: itemView(db.prepare('SELECT * FROM ai_items WHERE id=?').get(id))});
  });
  app.patch('/api/items/:id', requireUser, (req, res) => {
    const input = z.object({done: z.boolean().optional(), title: z.string().trim().min(1).max(200).optional(), dueAt: z.string().datetime({offset: true}).nullable().optional()}).strict().parse(req.body);
    const item = db.prepare('SELECT * FROM ai_items WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!item) return res.status(404).json({error: 'Item not found.'});
    const dueAt = input.dueAt === undefined ? item.due_at : validDate(input.dueAt);
    if (item.kind === 'reminder' && !dueAt) return res.status(400).json({error: 'A reminder needs a date and time.'});
    // A new due time means the reminder should fire again.
    const notifiedAt = dueAt === item.due_at ? item.notified_at : null;
    db.prepare('UPDATE ai_items SET done=?,title=?,due_at=?,notified_at=? WHERE id=?')
      .run(input.done === undefined ? item.done : (input.done ? 1 : 0), input.title ?? item.title, dueAt, notifiedAt, item.id);
    itemsChanged(req.user.id);
    res.json({item: itemView(db.prepare('SELECT * FROM ai_items WHERE id=?').get(req.params.id))});
  });
  app.delete('/api/items/:id', requireUser, (req, res) => {
    if (!db.prepare('DELETE FROM ai_items WHERE id=? AND user_id=?').run(req.params.id, req.user.id).changes) return res.status(404).json({error: 'Item not found.'});
    itemsChanged(req.user.id);
    res.json({ok: true});
  });

  // Due reminders (and tasks with a due time) are announced once, in the private AI chat.
  function checkReminders() {
    const due = db.prepare('SELECT * FROM ai_items WHERE done=0 AND notified_at IS NULL AND due_at IS NOT NULL AND due_at<=? ORDER BY due_at LIMIT 100').all(new Date().toISOString());
    for (const item of due) {
      db.prepare('UPDATE ai_items SET notified_at=? WHERE id=?').run(new Date().toISOString(), item.id);
      const message = insertMessage(item.user_id, null, 'assistant', item.kind === 'reminder' ? `⏰ Reminder: ${item.title}` : `📌 Task due: ${item.title}`);
      io.to(room(item.user_id)).emit('ai:message', message);
      io.to(room(item.user_id)).emit('reminder:due', itemView(item));
      itemsChanged(item.user_id);
    }
    return due.length;
  }
  const timer = setInterval(checkReminders, reminderIntervalMs);
  timer.unref?.();
  return {checkReminders, stop: () => clearInterval(timer)};
}

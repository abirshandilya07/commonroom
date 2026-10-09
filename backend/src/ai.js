import { randomUUID } from 'node:crypto';
import { openDatabase } from './db.js';
import { createIdentity, decryptMessage, encryptMessage } from '../../shared/crypto.js';
import { membersFor, saveMessage } from './chat.js';

export const BOT_USER_ID = '00000000-0000-4000-8000-000000000001';
export const BOT_USERNAME = 'campus_ai';
export const BOT_NAME = 'Campus AI Companion';

let botIdentity = null;
let selectedModel = null;

export async function ensureBotIdentity(db) {
  let user = db.prepare('SELECT * FROM users WHERE id=?').get(BOT_USER_ID);
  if (!user) {
    db.prepare('INSERT INTO users(id, name, username, password_hash, created_at, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run(BOT_USER_ID, BOT_NAME, BOT_USERNAME, 'BOT_NO_LOGIN', new Date().toISOString(), 'online');
  }

  let identityRow = db.prepare('SELECT * FROM identities WHERE user_id=?').get(BOT_USER_ID);
  if (!identityRow) {
    const generated = await createIdentity(BOT_USER_ID);
    db.prepare('INSERT INTO identities(user_id, public_keys, vault, created_at) VALUES (?, ?, ?, ?)')
      .run(
        BOT_USER_ID,
        JSON.stringify({ encryptionKey: generated.record.encryptionKey, signingKey: generated.record.signingKey }),
        JSON.stringify({ ...generated.record.vault, recoveryKey: generated.recoveryKey }),
        new Date().toISOString()
      );
    botIdentity = generated.unlocked;
  } else {
    const vaultData = JSON.parse(identityRow.vault);
    const publicKeys = JSON.parse(identityRow.public_keys);
    const { unlockIdentity } = await import('../../shared/crypto.js');
    botIdentity = await unlockIdentity(BOT_USER_ID, { ...publicKeys, vault: vaultData }, vaultData.recoveryKey);
  }
  return botIdentity;
}

async function resolveActiveModel(apiKey) {
  if (selectedModel) return selectedModel;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (res.ok) {
      const data = await res.json();
      const modelIds = (data.data || []).map(m => m.id);
      
      const chatModels = modelIds.filter(id => 
        !id.includes('guard') && 
        !id.includes('whisper') && 
        !id.includes('embed') &&
        !id.includes('distil')
      );
      
      const priority = [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'llama-3.1-70b-versatile',
        'mixtral-8x7b-32768'
      ];
      
      const found = priority.find(p => chatModels.includes(p)) || chatModels.find(m => m.includes('llama')) || chatModels[0];
      if (found) {
        selectedModel = found;
        console.log(`[Campus AI] Selected active Groq model: ${selectedModel}`);
        return selectedModel;
      }
    }
  } catch (err) {
    console.warn('Could not query Groq models dynamically:', err);
  }

  selectedModel = 'llama-3.3-70b-versatile';
  return selectedModel;
}

async function callLlm(prompt, context = []) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return `[Campus AI Demo]: I received your message: "${prompt.slice(0, 100)}". Add GROQ_API_KEY=your_key in backend/.env to enable live Groq responses!`;
  }

  const model = await resolveActiveModel(apiKey);

  const messages = [
    {
      role: 'system',
      content: 'You are Commonroom Campus AI, a friendly, concise, and helpful campus assistant for students. Provide direct, practical answers formatted in clean markdown.'
    },
    ...context.map(c => ({ role: c.role === 'user' ? 'user' : 'assistant', content: c.text })),
    { role: 'user', content: prompt }
  ];

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 1024
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`Groq API error on model ${model}:`, err);
      selectedModel = null;
      return `Groq Error: ${err}`;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "I couldn't formulate a response.";
  } catch (err) {
    console.error('Groq request error:', err);
    return `Groq Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function handleBotTrigger({ db, io, conversationId, message, senderId }) {
  try {
    if (senderId === BOT_USER_ID || !message.encrypted) return;

    const conversation = db.prepare('SELECT * FROM conversations WHERE id=?').get(conversationId);
    if (!conversation) return;

    const members = membersFor(db, conversationId);
    const isDirectBot = conversation.kind === 'direct' && members.some(m => m.id === BOT_USER_ID);
    
    const encryptedForBot = message.encrypted.recipients.some(r => r.userId === BOT_USER_ID);
    if (!isDirectBot && !encryptedForBot) return;

    if (!botIdentity) await ensureBotIdentity(db);

    let plainText = '';
    try {
      const sender = members.find(m => m.id === senderId);
      plainText = await decryptMessage(botIdentity, message, sender.identity);
    } catch (err) {
      console.error('Bot failed to decrypt incoming message:', err);
      return;
    }

    const isMentioned = /(@campus_ai|\/ai\b|@ai\b)/i.test(plainText);
    if (!isDirectBot && !isMentioned) return;

    const cleanedPrompt = plainText.replace(/(@campus_ai|\/ai|@ai)/gi, '').trim() || 'Hello!';

    const room = (id) => `user:${id}`;
    io.to(members.map(m => room(m.id))).emit('typing:update', {
      conversationId,
      userId: BOT_USER_ID,
      name: BOT_NAME,
      typing: true
    });

    const replyText = await callLlm(cleanedPrompt);

    io.to(members.map(m => room(m.id))).emit('typing:update', {
      conversationId,
      userId: BOT_USER_ID,
      name: BOT_NAME,
      typing: false
    });

    const botClientId = randomUUID();

    // Ensure the sender (the bot itself) is included in the members list passed to encryptMessage
    const recipientMembers = [...members.map(m => ({ id: m.id, identity: m.identity }))];
    if (!recipientMembers.some(m => m.id === BOT_USER_ID)) {
      recipientMembers.push({ id: BOT_USER_ID, identity: botIdentity.publicIdentity });
    }

    const encryptedReply = await encryptMessage(
      botIdentity,
      conversationId,
      botClientId,
      replyText,
      recipientMembers
    );

    const saved = saveMessage(db, BOT_USER_ID, {
      conversationId,
      clientId: botClientId,
      encrypted: encryptedReply
    });

    io.to(members.map(m => room(m.id))).emit('message:new', saved.message);
  } catch (error) {
    console.error('handleBotTrigger execution failed:', error);
  }
}
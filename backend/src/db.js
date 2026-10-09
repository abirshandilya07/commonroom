import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
const conversationSchema = (name) => `CREATE TABLE ${name} (
 id TEXT PRIMARY KEY, user_a TEXT REFERENCES users(id), user_b TEXT REFERENCES users(id), created_at TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'direct' CHECK(kind IN ('direct','group')), title TEXT, created_by TEXT REFERENCES users(id),
 CHECK(kind='group' OR (user_a IS NOT NULL AND user_b IS NOT NULL AND user_a < user_b)), UNIQUE(user_a,user_b)
)`;
export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), {recursive:true});
  const existed=filename!==':memory:' && existsSync(filename);
  const db=new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);`);
  const columns=db.prepare('PRAGMA table_info(conversations)').all();
  if (!columns.length) db.exec(conversationSchema('conversations'));
  else if (!columns.some(c=>c.name==='kind')) {
    // VACUUM INTO creates a consistent backup including WAL content, not a raw file copy.
    if(existed) db.prepare('VACUUM INTO ?').run(`${filename}.pre-v3-${Date.now()}.sqlite`);
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
    try {
      db.exec(`${conversationSchema('conversations_v3')};
        INSERT INTO conversations_v3(id,user_a,user_b,created_at,kind,created_by) SELECT id,user_a,user_b,created_at,'direct',user_a FROM conversations;
        DROP TABLE conversations; ALTER TABLE conversations_v3 RENAME TO conversations; COMMIT;`);
    } catch(e) {db.exec('ROLLBACK');throw e;} finally {db.exec('PRAGMA foreign_keys=ON');}
  }
  db.exec(`CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,conversation_id TEXT NOT NULL REFERENCES conversations(id),sender_id TEXT NOT NULL REFERENCES users(id),client_id TEXT NOT NULL,body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),created_at TEXT NOT NULL,encrypted_payload TEXT,UNIQUE(sender_id,client_id));
    CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id,id);
    CREATE TABLE IF NOT EXISTS conversation_members(conversation_id TEXT NOT NULL REFERENCES conversations(id),user_id TEXT NOT NULL REFERENCES users(id),last_read_id INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(conversation_id,user_id));
    CREATE INDEX IF NOT EXISTS members_user ON conversation_members(user_id,conversation_id);
    INSERT OR IGNORE INTO conversation_members(conversation_id,user_id) SELECT id,user_a FROM conversations WHERE kind='direct';
    INSERT OR IGNORE INTO conversation_members(conversation_id,user_id) SELECT id,user_b FROM conversations WHERE kind='direct';
    CREATE TABLE IF NOT EXISTS identities(user_id TEXT PRIMARY KEY REFERENCES users(id),public_keys TEXT NOT NULL,vault TEXT NOT NULL,created_at TEXT NOT NULL);`);
  if(!db.prepare('PRAGMA table_info(messages)').all().some(c=>c.name==='encrypted_payload')) db.exec('ALTER TABLE messages ADD COLUMN encrypted_payload TEXT');
  // v4: profiles, presence status, private notes, reactions, edits/deletes and encrypted attachments.
  const addColumn=(table,column,type)=>{if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);};
  addColumn('users','status',"TEXT NOT NULL DEFAULT 'online'");
  addColumn('messages','edited_at','TEXT');
  addColumn('messages','deleted_at','TEXT');
  addColumn('messages','attachment_id','TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS avatars(user_id TEXT PRIMARY KEY REFERENCES users(id),mime TEXT NOT NULL,data BLOB NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS notes(owner_id TEXT NOT NULL REFERENCES users(id),target_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner_id,target_id));
    CREATE TABLE IF NOT EXISTS reactions(message_id INTEGER NOT NULL REFERENCES messages(id),user_id TEXT NOT NULL REFERENCES users(id),emoji TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(message_id,user_id,emoji));
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),uploader_id TEXT NOT NULL REFERENCES users(id),size INTEGER NOT NULL,created_at TEXT NOT NULL);`);
  // v5: Common Room AI chat history and reminders/tasks.
  db.exec(`CREATE TABLE IF NOT EXISTS ai_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES users(id),conversation_id TEXT REFERENCES conversations(id),role TEXT NOT NULL CHECK(role IN ('user','assistant')),body TEXT NOT NULL,context_count INTEGER NOT NULL DEFAULT 0,items TEXT,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ai_messages_owner ON ai_messages(user_id,conversation_id,id);
    CREATE INDEX IF NOT EXISTS ai_messages_conversation ON ai_messages(conversation_id,id);
    CREATE TABLE IF NOT EXISTS ai_items(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),conversation_id TEXT REFERENCES conversations(id),kind TEXT NOT NULL CHECK(kind IN ('reminder','task')),title TEXT NOT NULL,due_at TEXT,done INTEGER NOT NULL DEFAULT 0,notified_at TEXT,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ai_items_owner ON ai_items(user_id,done);
    CREATE INDEX IF NOT EXISTS ai_items_due ON ai_items(done,notified_at,due_at);`);
  // v6: moderation (blocks and message reports).
  db.exec(`CREATE TABLE IF NOT EXISTS blocks(blocker_id TEXT NOT NULL REFERENCES users(id),blocked_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,PRIMARY KEY(blocker_id,blocked_id));
    CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL REFERENCES users(id),message_id INTEGER NOT NULL REFERENCES messages(id),conversation_id TEXT NOT NULL REFERENCES conversations(id),reason TEXT NOT NULL,excerpt TEXT,created_at TEXT NOT NULL,resolved_at TEXT,UNIQUE(reporter_id,message_id));
    CREATE INDEX IF NOT EXISTS reports_conversation ON reports(conversation_id,resolved_at);`);
  // v7: password-wrapped backup of the device recovery secret.
  addColumn('users','key_backup','TEXT');
  db.exec('PRAGMA user_version=7');
  if(db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database migration integrity check failed.');
  return db;
}

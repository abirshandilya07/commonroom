import { createApplication } from './app.js';
import { geminiClient, groqClient, DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL } from './assistant.js';
const env = (name) => process.env[name]?.trim() || '';
// Groq is used when its key is set; otherwise Gemini.
const ai = env('GROQ_API_KEY') ? {generate: groqClient({apiKey: env('GROQ_API_KEY'), model: env('GROQ_MODEL') || DEFAULT_GROQ_MODEL}), label: `Groq, ${env('GROQ_MODEL') || DEFAULT_GROQ_MODEL}`}
  : {generate: geminiClient({apiKey: env('GEMINI_API_KEY'), model: env('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL}), label: `Gemini, ${env('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL}`};
const port = Number(process.env.PORT || 3001);
const application = createApplication({
  databasePath: process.env.DATABASE_PATH || './data/commonroom.sqlite',
  origins: (process.env.APP_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001').split(',').map((s) => s.trim()),
  secureCookie: process.env.COOKIE_SECURE === 'true',
  trustProxy: process.env.TRUST_PROXY === '1',
  generate: ai.generate,
  giphyKey: env('GIPHY_API_KEY'),
});
application.http.listen(port, '0.0.0.0', () => {console.log(`Commonroom API listening on http://localhost:${port}`); console.log(ai.generate ? `Common Room AI is on (${ai.label}).` : 'Common Room AI is off: add GROQ_API_KEY to backend/.env to turn it on.');});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {await application.close(); process.exit(0);});

import { createApplication } from './app.js';
const port = Number(process.env.PORT || 3001);
const application = createApplication({
  databasePath: process.env.DATABASE_PATH || './data/commonroom.sqlite',
  origins: (process.env.APP_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001').split(',').map((s) => s.trim()),
  secureCookie: process.env.COOKIE_SECURE === 'true',
  trustProxy: process.env.TRUST_PROXY === '1',
});
application.http.listen(port, '0.0.0.0', () => console.log(`Commonroom API listening on http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {await application.close(); process.exit(0);});

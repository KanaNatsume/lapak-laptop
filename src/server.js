import dotenv from 'dotenv';
import app from './app.js';
import './db.js';
import { ensureDefaultUser } from './auth.js';
import { scheduleDatabaseBackups } from './backup.js';

dotenv.config();
ensureDefaultUser();
scheduleDatabaseBackups();

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => {
  console.log(`POS laptop API berjalan di port ${port}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} sedang digunakan. Hentikan server lain atau jalankan dengan PORT=3001.`);
    process.exit(1);
  }
  throw error;
});
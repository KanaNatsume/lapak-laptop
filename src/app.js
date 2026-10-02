import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import routes from './routes/index.js';

const app = express();
dotenv.config();

const port = Number(process.env.PORT || 3000);
const allowedOrigins = new Set((process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((origin) => origin.trim()).filter(Boolean));
allowedOrigins.add(`http://localhost:${port}`);
allowedOrigins.add(`http://127.0.0.1:${port}`);
app.use(cors({ origin: (origin, callback) => !origin || allowedOrigins.has(origin) ? callback(null, true) : callback(new Error('Origin tidak diizinkan')) }));
app.use(express.json({ limit: '1mb' }));
app.use(routes);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendDist = path.join(projectRoot, 'frontend', 'dist');
app.use(express.static(frontendDist));
app.get('*', (_request, response, next) => {
  if (_request.path.startsWith('/api') || path.extname(_request.path)) return next();
  response.sendFile(path.join(frontendDist, 'index.html'), (error) => error && next());
});

app.use((_request, response) => {
  response.status(404).json({ error: 'Endpoint tidak ditemukan' });
});

app.use((error, _request, response, _next) => {
  console.error(error);
  const clientError = /Stok tidak cukup|Item transaksi tidak valid|customer|wajib/i.test(error.message || '') || error.code === 'SQLITE_CONSTRAINT_CHECK';
  response.status(error.statusCode || (clientError ? 400 : 500)).json({ error: clientError ? error.message : 'Terjadi kesalahan pada server' });
});

export default app;
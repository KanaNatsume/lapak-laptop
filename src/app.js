import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import routes from './routes/index.js';

const app = express();
dotenv.config();
app.set('trust proxy', 'loopback');

const contentSecurityPolicy = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  connectSrc: ["'self'"],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  ...(process.env.NODE_ENV === 'production' ? {} : { upgradeInsecureRequests: null })
};
app.use(helmet({ contentSecurityPolicy: { directives: contentSecurityPolicy }, crossOriginEmbedderPolicy: false }));
app.use((_request, response, next) => { response.setHeader('Permissions-Policy', 'camera=(self), microphone=()'); next(); });

const port = Number(process.env.PORT || 3000);
const allowedOrigins = new Set((process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((origin) => origin.trim()).filter(Boolean));
allowedOrigins.add(`http://localhost:${port}`);
allowedOrigins.add(`http://127.0.0.1:${port}`);
app.use(cors({ origin: (origin, callback) => !origin || allowedOrigins.has(origin) ? callback(null, true) : callback(null, false), credentials: true }));
app.use((request, response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
  const origin = request.get('origin');
  if (origin && !allowedOrigins.has(origin)) return response.status(403).json({ error: 'Origin tidak diizinkan untuk aksi ini' });
  next();
});
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
  const clientError = /Stok tidak cukup|Item transaksi tidak valid|customer|wajib|Nominal|Jenis transaksi|Metode pembayaran|tukar tambah|Servis belum|Biaya final/i.test(error.message || '') || error.code === 'SQLITE_CONSTRAINT_CHECK';
  if (!clientError) console.error(error);
  response.status(error.statusCode || (clientError ? 400 : 500)).json({ error: clientError ? error.message : 'Terjadi kesalahan pada server' });
});

export default app;
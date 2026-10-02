import crypto from 'node:crypto';
import dotenv from 'dotenv';
import db from './db.js';

dotenv.config();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expected] = storedHash.split(':');
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return expected && actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function ensureDefaultUser() {
  const exists = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (!exists) {
    const password = process.env.DEFAULT_ADMIN_PASSWORD;
    if (!password || password.length < 10) throw new Error('DEFAULT_ADMIN_PASSWORD wajib diisi dan minimal 10 karakter');
    db.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)').run('Febry', 'admin', hashPassword(password), 'admin');
  }
}

export function login(request, response) {
  const { username, password } = request.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !verifyPassword(password || '', user.password_hash)) return response.status(401).json({ error: 'Username atau password salah' });
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expiresAt);
  response.json({ token, user: { id: user.id, name: user.name, username: user.username, role: user.role } });
}

export function authenticate(request, response, next) {
  const token = request.headers.authorization?.replace('Bearer ', '');
  const session = token && db.prepare('SELECT sessions.expires_at, users.id, users.name, users.username, users.role FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ? AND users.active = 1').get(token);
  if (!session || session.expires_at < Date.now()) return response.status(401).json({ error: 'Login diperlukan' });
  request.user = { id: session.id, name: session.name, username: session.username, role: session.role };
  next();
}

export function authorize(...roles) {
  return (request, response, next) => roles.includes(request.user.role) ? next() : response.status(403).json({ error: 'Anda tidak memiliki izin untuk aksi ini' });
}

export function me(request, response) { response.json({ user: request.user }); }
export function changePassword(request, response) {
  const { current_password, new_password } = request.body;
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(request.user.id);
  if (!new_password || new_password.length < 10) return response.status(400).json({ error: 'Password baru minimal 10 karakter' });
  if (!user || !verifyPassword(current_password || '', user.password_hash)) return response.status(401).json({ error: 'Password lama salah' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), request.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(request.user.id);
  response.status(204).end();
}
export function logout(request, response) { const token = request.headers.authorization?.replace('Bearer ', ''); if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token); response.status(204).end(); }
export { hashPassword };

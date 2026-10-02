import db from '../db.js';
import { hashPassword } from '../auth.js';

export function listUsers(request, response) {
  const rows = db.prepare('SELECT id, name, username, role, active, created_at FROM users').all();
  response.json(rows);
}

export function getUser(request, response) {
  const id = parseInt(request.params.id);
  const user = db.prepare('SELECT id, name, username, role, active, created_at FROM users WHERE id = ?').get(id);
  if (!user) return response.status(404).json({ error: 'User tidak ditemukan' });
  response.json(user);
}

export function createUser(request, response) {
  const { name, username, password, role = 'kasir', active = 1 } = request.body;
  if (!name || !username || !password) return response.status(400).json({ error: 'Nama, username, dan password wajib diisi' });
  if (password.length < 10) return response.status(400).json({ error: 'Password minimal 10 karakter' });
  if (!['admin', 'kasir', 'teknisi'].includes(role)) return response.status(400).json({ error: 'Level akses tidak valid' });

  try {
    const result = db.prepare('INSERT INTO users (name, username, password_hash, role, active) VALUES (?, ?, ?, ?, ?)')
      .run(name, username, hashPassword(password), role, active ? 1 : 0);
    response.status(201).json({ id: result.lastInsertRowid, name, username, role, active });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return response.status(409).json({ error: 'Username sudah digunakan' });
    throw error;
  }
}

export function updateUser(request, response) {
  const id = parseInt(request.params.id);
  const { name, username, role, active } = request.body;
  if (role !== undefined && !['admin', 'kasir', 'teknisi'].includes(role)) return response.status(400).json({ error: 'Level akses tidak valid' });
  if (id === request.user.id && active === false) return response.status(400).json({ error: 'Akun yang sedang digunakan tidak dapat dinonaktifkan' });

  if (name !== undefined) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id);
  }
  if (username !== undefined) {
    try {
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return response.status(409).json({ error: 'Username sudah digunakan' });
      throw error;
    }
  }
  if (role !== undefined) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }
  if (active !== undefined) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  }

  const updatedUser = db.prepare('SELECT id, name, username, role, active, created_at FROM users WHERE id = ?').get(id);
  if (!updatedUser) return response.status(404).json({ error: 'User tidak ditemukan' });
  response.json(updatedUser);
}

export function deleteUser(request, response) {
  const id = parseInt(request.params.id);
  if (id === request.user.id) return response.status(400).json({ error: 'Akun yang sedang digunakan tidak dapat dihapus' });
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (result.changes === 0) return response.status(404).json({ error: 'User tidak ditemukan' });
  response.status(204).end();
}

export function resetUserPassword(request, response) {
  const id = parseInt(request.params.id);
  const { password } = request.body;
  if (!password || password.length < 10) return response.status(400).json({ error: 'Password minimal 10 karakter' });
  const result = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  if (result.changes === 0) return response.status(404).json({ error: 'User tidak ditemukan' });
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  response.status(204).end();
}

export function toggleUserStatus(request, response) {
  const id = parseInt(request.params.id);
  const user = db.prepare('SELECT active FROM users WHERE id = ?').get(id);
  if (!user) return response.status(404).json({ error: 'User tidak ditemukan' });

  const newStatus = user.active === 1 ? 0 : 1;
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(newStatus, id);
  response.json({ id, active: newStatus });
}

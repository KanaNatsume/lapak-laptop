import db from '../db.js';

export function getHealth(_request, response) {
  const result = db.prepare('SELECT 1 AS ok').get();
  response.json({ status: result.ok === 1 ? 'ok' : 'error' });
}
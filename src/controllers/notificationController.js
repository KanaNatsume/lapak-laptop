import db from '../db.js';

export function listNotifications(_request, response) {
  const notifications = [
    ...db.prepare("SELECT id, ticket_number, device_name, status FROM services WHERE status = 'menunggu_persetujuan' ORDER BY created_at DESC LIMIT 10").all().map((item) => ({ id: `approval-${item.id}`, type: 'approval', title: 'Menunggu persetujuan', detail: `${item.ticket_number} · ${item.device_name}` })),
    ...db.prepare("SELECT id, ticket_number, device_name FROM services WHERE status = 'selesai' ORDER BY finished_at DESC LIMIT 10").all().map((item) => ({ id: `done-${item.id}`, type: 'done', title: 'Servis selesai', detail: `${item.ticket_number} · ${item.device_name}` })),
    ...db.prepare('SELECT id, name, stock FROM products WHERE stock <= 2 ORDER BY stock ASC, name LIMIT 10').all().map((item) => ({ id: `stock-${item.id}`, type: 'stock', title: 'Stok menipis', detail: `${item.name} · ${item.stock} tersisa` }))
  ];
  response.json(notifications);
}

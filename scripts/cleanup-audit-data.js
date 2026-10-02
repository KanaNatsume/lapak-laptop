import db from '../src/db.js';

const cleanup = db.transaction(() => {
  db.prepare("DELETE FROM transactions WHERE id IN (SELECT DISTINCT transaction_id FROM transaction_items WHERE name LIKE 'Checkout Test %' OR name LIKE 'Trade Test %' OR name = 'Laptop lama' OR name = 'Harga Palsu')").run();
  db.prepare("DELETE FROM products WHERE name LIKE 'Checkout Test %' OR name LIKE 'Trade Test %' OR name LIKE 'Audit Product %'").run();
});

cleanup();
console.log('audit test data cleaned');
db.close();

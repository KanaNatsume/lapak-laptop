import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, '..');
const databasePath = process.env.DATABASE_PATH || path.join(projectRoot, 'data', 'pos.sqlite');
const schemaPath = path.join(projectRoot, 'schema.sql');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.exec(fs.readFileSync(schemaPath, 'utf8'));

const productTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'products'").get()?.sql || '';
if (!productTableSql.includes("'gadget'")) {
	db.transaction(() => {
		db.exec(`
			DROP INDEX IF EXISTS idx_products_serial_number;
			DROP INDEX IF EXISTS idx_products_name;
			DROP INDEX IF EXISTS idx_products_category_stock;
			CREATE TABLE products_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				category TEXT NOT NULL CHECK (category IN ('laptop', 'aksesoris', 'part_copotan', 'gadget')),
				name TEXT NOT NULL,
				brand TEXT NOT NULL DEFAULT '',
				specs TEXT NOT NULL DEFAULT '{}',
				serial_number TEXT,
				grade_condition TEXT NOT NULL CHECK (grade_condition IN ('A', 'B', 'C', 'Minus')),
				cost_price INTEGER NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
				selling_price INTEGER NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
				stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
				notes TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			INSERT INTO products_new (id, category, name, brand, specs, serial_number, grade_condition, cost_price, selling_price, stock, notes, created_at)
			SELECT id, category, name, brand, specs, serial_number, grade_condition, cost_price, selling_price, stock, notes, created_at FROM products;
			DROP TABLE products;
			ALTER TABLE products_new RENAME TO products;
			CREATE UNIQUE INDEX idx_products_serial_number ON products(serial_number) WHERE serial_number IS NOT NULL AND serial_number <> '';
			CREATE INDEX idx_products_name ON products(name);
			CREATE INDEX idx_products_category_stock ON products(category, stock);
		`);
	})();
}

function addColumnIfMissing(tableName, columnName, definition) {
	const exists = db.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
	if (!exists) db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

addColumnIfMissing('transactions', 'paid_amount', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('transactions', 'change_amount', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('transactions', 'trade_in_total', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('transactions', 'transaction_stage', "TEXT NOT NULL DEFAULT 'final'");
addColumnIfMissing('cash_entries', 'source', "TEXT NOT NULL DEFAULT 'manual'");
addColumnIfMissing('services', 'diagnosis', "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('services', 'cancellation_reason', "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('store_settings', 'opening_time', "TEXT NOT NULL DEFAULT '09:00'");
addColumnIfMissing('store_settings', 'closing_time', "TEXT NOT NULL DEFAULT '21:00'");
addColumnIfMissing('transaction_items', 'serial_number', "TEXT NOT NULL DEFAULT ''");
db.prepare("UPDATE transactions SET paid_amount = grand_total WHERE paid_amount = 0 AND payment_status = 'lunas'").run();
db.prepare("UPDATE transactions SET transaction_stage = 'opening' WHERE notes = 'Nota awal servis'").run();
db.prepare("UPDATE cash_entries SET source = 'transaction' WHERE category = 'Servis' AND description LIKE 'Pembayaran servis %'").run();

export default db;
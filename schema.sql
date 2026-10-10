PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
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

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL,
  device_name TEXT NOT NULL,
  specs TEXT NOT NULL DEFAULT '{}',
  serial_number TEXT NOT NULL DEFAULT '',
  issues TEXT NOT NULL,
  diagnosis TEXT NOT NULL DEFAULT '',
  cancellation_reason TEXT NOT NULL DEFAULT '',
  accessories_included TEXT NOT NULL DEFAULT '',
  password_pin TEXT NOT NULL DEFAULT '',
  technician_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'antrean' CHECK (status IN ('antrean', 'pengecekan', 'menunggu_persetujuan', 'proses_servis', 'selesai', 'diambil', 'batal_gagal')),
  estimated_cost INTEGER NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0),
  down_payment INTEGER NOT NULL DEFAULT 0 CHECK (down_payment >= 0),
  failure_fee INTEGER NOT NULL DEFAULT 0 CHECK (failure_fee >= 0),
  final_cost INTEGER NOT NULL DEFAULT 0 CHECK (final_cost >= 0),
  warranty_days INTEGER NOT NULL DEFAULT 0 CHECK (warranty_days >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('penjualan', 'tukar_tambah', 'servis', 'campuran')),
  transaction_stage TEXT NOT NULL DEFAULT 'final' CHECK (transaction_stage IN ('opening', 'final')),
  subtotal INTEGER NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  trade_in_total INTEGER NOT NULL DEFAULT 0 CHECK (trade_in_total >= 0),
  direct_discount INTEGER NOT NULL DEFAULT 0 CHECK (direct_discount >= 0),
  shipping_cost INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  grand_total INTEGER NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
  paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  change_amount INTEGER NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'transfer', 'qris')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('lunas', 'dp', 'bayar_nanti')),
  notes TEXT NOT NULL DEFAULT '',
  warranty_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS transaction_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('product', 'service', 'trade_in')),
  reference_id INTEGER,
  name TEXT NOT NULL,
  serial_number TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price >= 0),
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transaction_refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  reason TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS store_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  store_name TEXT NOT NULL DEFAULT 'Lapak Laptop',
  store_address TEXT NOT NULL DEFAULT '',
  store_phone TEXT NOT NULL DEFAULT '',
  receipt_footer_text TEXT NOT NULL DEFAULT 'Garansi toko berlaku sesuai ketentuan yang tertera.',
  receipt_closing_text TEXT NOT NULL DEFAULT 'Terima kasih telah berbelanja.',
  paper_size_preference TEXT NOT NULL DEFAULT '58mm' CHECK (paper_size_preference IN ('58mm', '80mm', 'A4')),
  opening_time TEXT NOT NULL DEFAULT '09:00',
  closing_time TEXT NOT NULL DEFAULT '21:00',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO store_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'kasir' CHECK (role IN ('admin', 'kasir', 'teknisi')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cash_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('pemasukan', 'pengeluaran')),
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'transaction')),
  entry_date TEXT NOT NULL DEFAULT (date('now')),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_cash_entries_date_type ON cash_entries(entry_date, entry_type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_serial_number
  ON products(serial_number) WHERE serial_number IS NOT NULL AND serial_number <> '';
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_category_stock ON products(category, stock);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_services_customer_status ON services(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_services_serial_number ON services(serial_number);
CREATE INDEX IF NOT EXISTS idx_transactions_customer_created ON transactions(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction ON transaction_items(transaction_id);
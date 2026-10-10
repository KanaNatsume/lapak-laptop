# POS Laptop

Fondasi aplikasi POS dan servis untuk toko laptop bekas. Backend memakai Express dan SQLite melalui `better-sqlite3`; desainnya sengaja stateless agar ringan di server Debian RAM 2 GB.

## Menjalankan

```bash
npm install
npm run dev
npm run dev:frontend
npm test
```

API berjalan di `http://localhost:3000`, sedangkan SPA tersedia di `http://localhost:5173`. Untuk build produksi, jalankan `npm run build:frontend` lalu `npm start`; Express akan menyajikan `frontend/dist`. Database dibuat otomatis di `data/pos.sqlite`. Salin `.env.example` menjadi `.env` untuk mengganti port, lokasi database, CORS, atau konfigurasi backup.

Backup SQLite dibuat otomatis saat server mulai dan setiap `BACKUP_INTERVAL_MS` (default 24 jam) ke `BACKUP_DIR` (default `data/backups`). File backup yang lebih lama dari `BACKUP_RETENTION_DAYS` (default 30 hari) dihapus. Salin backup ke lokasi terpisah atau storage eksternal untuk perlindungan terhadap kerusakan disk.

## Menjalankan dengan Docker

Docker Compose menyimpan database dan backup pada volume persisten terpisah:

```bash
cp .env.example .env
# Edit .env dan ganti DEFAULT_ADMIN_PASSWORD
docker compose up -d --build
docker compose ps
docker compose logs -f pos-laptop
```

Aplikasi pada deployment Tunnel tidak membuka port 3000 ke host; akses publik menggunakan hostname Cloudflare. Hentikan container tanpa menghapus data dengan `docker compose down`; jangan gunakan `docker compose down -v` kecuali memang ingin menghapus database dan backup. Untuk deployment tanpa IP publik, gunakan service `cloudflared` pada Compose: buat tunnel di Cloudflare Zero Trust, set `CLOUDFLARE_TUNNEL_TOKEN` di `.env`, lalu arahkan public hostname ke service `http://pos-laptop:3000` (nama service Docker, bukan `localhost`). Set `CORS_ORIGIN` ke URL HTTPS public hostname. File Docker tersedia di `Dockerfile`, `docker-compose.yml`, dan `.dockerignore`.

Login awal untuk instalasi baru: username `admin`, password mengikuti `DEFAULT_ADMIN_PASSWORD` di `.env`. Ganti password dari halaman profil setelah login. Session disimpan di SQLite dengan expiry 8 jam dan seluruh endpoint operasional memerlukan `Authorization: Bearer <token>`.

## Struktur backend

```text
schema.sql
src/
  app.js                 # middleware dan error handler
  server.js              # entry point HTTP
  db.js                  # koneksi SQLite, WAL, schema bootstrap
  controllers/           # validasi dan orkestrasi use case HTTP
  routes/                # pemetaan URL ke controller
```

Controller berikutnya sebaiknya dikelompokkan berdasarkan domain:

```text
controllers/productController.js
controllers/customerController.js
controllers/serviceController.js
controllers/transactionController.js
routes/productRoutes.js
routes/customerRoutes.js
routes/serviceRoutes.js
routes/transactionRoutes.js
```

## Kontrak REST yang direncanakan

| Method | Endpoint | Kegunaan |
| --- | --- | --- |
| GET | `/api/health` | Cek proses dan database |
| GET | `/api/products?search=&category=&serial_number=` | Pencarian produk kasir |
| POST | `/api/products` | Tambah stok/barang |
| PUT | `/api/products/:id` | Ubah harga, stok, atau detail |
| GET | `/api/customers?search=` | Cari pelanggan berdasarkan nama/telepon |
| POST | `/api/customers` | Buat pelanggan baru |
| POST | `/api/customers/import/aronium` | Import pelanggan dari CSV Aronium (admin/kasir) |
| GET | `/api/services?status=&search=` | Daftar tiket servis |
| POST | `/api/services` | Terima perangkat servis |
| PATCH | `/api/services/:id/status` | Pindah status dan catat biaya |
| GET | `/api/transactions/:id` | Detail transaksi dan item |
| POST | `/api/transactions` | Checkout penjualan/servis/tukar tambah |
| POST | `/api/transactions/:id/ship` | Mengisi ongkos kirim setelah checkout |
| GET | `/api/transactions/:id/receipt` | Data nota thermal |
| GET | `/api/settings` | Membaca pengaturan toko dan preferensi kertas |
| PUT | `/api/settings` | Menyimpan pengaturan toko |
| POST | `/api/auth/login` | Login user |
| POST | `/api/auth/logout` | Logout user |
| GET | `/api/notifications` | Notifikasi approval servis, servis selesai, dan stok menipis |
| GET | `/api/users` | Daftar user (admin) |
| POST | `/api/users` | Tambah user (admin) |
| PUT | `/api/users/:id` | Ubah nama, username, role, atau status (admin) |
| PUT | `/api/users/:id/password` | Reset password user (admin) |
| DELETE | `/api/users/:id` | Hapus user (admin) |
| GET | `/api/cash-entries` | Daftar pemasukan/pengeluaran dan ringkasan kas |
| POST | `/api/cash-entries` | Catat pemasukan/pengeluaran manual (admin/kasir) |
| PUT | `/api/cash-entries/:id` | Ubah catatan kas (admin/kasir) |
| DELETE | `/api/cash-entries/:id` | Hapus catatan kas (admin/kasir) |

Endpoint checkout harus memproses header transaksi dan seluruh item dalam satu `db.transaction()`. Nilai `grand_total` dihitung server dengan rumus `subtotal - direct_discount + shipping_cost`, bukan dipercaya dari browser.

## Aturan bisnis inti


## Komponen SPA yang disarankan
Import produk dari menu Inventori menyediakan template `.xlsx` yang sudah diformat. Kolom inti meliputi `category`, `name`, `brand`, `serial_number`, `cost_price`, `selling_price`, `stock`, dan `notes`; kolom atribut spesifikasi juga tersedia untuk processor, GPU, memory, storage, display, port, fitur, kelengkapan, sumber unit, fisik, keyboard, touchpad, baterai, benchmark, charger, audio, kamera, security, dan lock status. Untuk atribut pilihan ganda, pisahkan nilai dengan karakter `|`, misalnya `512GB SSD NVMe|1TB HDD`. Import divalidasi secara all-or-nothing dan serial number tetap harus unik.

Import pelanggan Aronium tersedia di menu Pelanggan dan menerima CSV dengan header Aronium (`Name`, `Phone`, `StreetName`, `BuildingNumber`, `AdditionalStreetName`, `PlotIdentification`, `PostalCode`, `City`, `CitySubdivisionName`, `CountrySubentity`, dan `Country`). Kolom alamat digabung menjadi alamat pelanggan. Baris dengan `IsCustomer=0`, `IsEnabled=0`, atau tanpa nama diabaikan. Nomor telepon yang sama (termasuk variasi format `+62`/`0`) tidak diimpor dua kali; impor ulang aman.

```text
src/frontend/
  App.jsx
  api/client.js
  pages/CashierPage.jsx
  pages/ServicePage.jsx
  components/ProductSearch.jsx
  components/CustomerSearch.jsx
  components/Cart.jsx
  components/TradeInForm.jsx
  components/ServiceStatusStepper.jsx
  components/ThermalReceipt.jsx
```

Implementasi SPA saat ini berada di `frontend/` agar tidak bercampur dengan source Express. Jalankan `npm run build:frontend` untuk membuat bundle produksi.

Komponen receipt dan pengaturan:

```text
frontend/src/components/SettingsPage.jsx       # Form pengaturan toko via GET/PUT /api/settings
frontend/src/components/ReceiptPrint.jsx       # Nota responsive 58mm, 80mm, dan A4
frontend/src/components/receipt-print.css      # Layout dan @media print
```

`GET /api/transactions/:id/receipt` menggabungkan transaksi, customer, item beserta serial number, dan `store_settings`. Nominal bayar default sama dengan grand total untuk checkout lunas; API menerima `paid_amount` untuk menghitung `change_amount`.

Scanner serial menggunakan `@zxing/browser` untuk membaca barcode dari kamera atau file foto, sehingga tidak bergantung pada `BarcodeDetector` bawaan browser. Browser tetap memerlukan izin kamera dan konteks `localhost` atau HTTPS. Field serial dapat diisi manual bila kamera tidak tersedia. Alur servis meminta diagnosis dan biaya final saat berpindah dari pengecekan ke menunggu persetujuan, menyediakan cancel dengan alasan, dan otomatis membuat transaksi/nota ketika status menjadi selesai.

Pemasukan servis mengikuti pembayaran aktual: DP dicatat sebesar DP, transaksi `bayar_nanti` belum dicatat sebagai kas, dan setiap pelunasan dicatat saat endpoint pembayaran dipanggil. Pemasukan penjualan dihitung dari `paid_amount` transaksi pada ringkasan kas. Pemasukan/pengeluaran lain dapat dicatat manual dari menu Kas Toko.

Login dibatasi maksimal 10 percobaan per 15 menit per instance server. Ganti `DEFAULT_ADMIN_PASSWORD` sebelum instalasi pertama dan gunakan HTTPS di deployment jaringan publik.

Test integration berada di `test/app.test.js` dan memakai database sementara. Suite menguji login/permission, transaksi, pengurangan stok dan overselling, status servis, kas manual, serta pembayaran servis berdasarkan nominal aktual. Jalankan dengan `npm test`.

`CashierPage` menyimpan state `customer`, `cart`, `discount`, `shippingCost`, `payment`, dan `tradeIns`. `ProductSearch` melakukan debounce singkat lalu menampilkan nama, grade, harga, stok, dan serial. `CustomerSearch` mengisi form pelanggan lama atau menawarkan pembuatan pelanggan baru. `Cart` menghitung preview total, tetapi menganggap respons checkout server sebagai sumber kebenaran. `ThermalReceipt` memakai data receipt yang sama untuk preview dan `window.print()` dengan CSS ukuran kertas thermal.

`ServicePage` memiliki form penerimaan perangkat, daftar tiket berdasarkan status, dan `ServiceStatusStepper`. Saat memilih `batal_gagal`, UI menampilkan simulasi opsi potong DP, biaya cek, atau gratis; keputusan final tetap ditetapkan API agar tidak bisa dimanipulasi dari browser.
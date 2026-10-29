# Rencana Implementasi Sistem Keuangan Lapak Laptop

Status dokumen: audit baca-saja selesai, 10 Oktober 2026. Tidak ada database produksi atau saldo operasional yang diubah. Baseline awal `npm test` lulus 18/18 menggunakan database terisolasi.

## Status Implementasi

- Fase 2: migrasi bernomor 0001–0014 dengan checksum dan backup SQLite sebelum migrasi pending; COA awal tanpa saldo; jurnal double-entry seimbang/idempotent, audit snapshot append-only untuk draft/post/reversal, trigger immutability, dan reversal.
- Fase 3 backend: unit laptop, movement, sumber supplier/perorangan/trade-in, pembelian tunai/kredit, diskon pembelian deterministik, layer spare part FIFO dengan total biaya exact, klasifikasi biaya unit kapitalisasi/beban, dan HPP aktual per unit.
- Checkout memprioritaskan unit `ready`, mencatat alokasi unit, dan mem-posting pendapatan bruto serta HPP secara atomik. Pembayaran lanjutan mem-posting kas lawan piutang tanpa mengulang pendapatan; refund membalik jurnal penjualan, pembayaran, HPP, unit, dan layer secara auditabel.
- DP servis baru dijurnal sebagai kas/bank melawan uang muka pelanggan. Saat invoice servis dibuat, DP diaplikasikan ke pendapatan tanpa kas masuk kedua kali; part pelanggan masuk HPP servis. Assignment internal tidak membuat biaya tenaga kerja otomatis. Teknisi eksternal dibuat sebagai HPP/biaya dan utang; pembayarannya mengurangi utang.
- Work order perbaikan unit toko dapat memesan teknisi/part, mencatat biaya kapitalisasi vs beban, dan mengembalikan unit ke ready hanya setelah QC. Trade-in laptop membuat unit baru berstatus received, bukan langsung stok jual.
- Freight actual setelah packing dicatat terpisah dari charge pada invoice, termasuk ekspedisi/resi, biaya aktual, beban toko, split payable/prepaid, top-up, saldo prepaid, dan pembayaran parsial idempotent.
- Pengeluaran operasional ditalangi staf dapat dicatat sebagai beban dan utang talangan; penggantian penuh/parsial mengurangi utang dan kas tanpa mengakui beban ulang.
- Garansi servis pada nota final bersumber dari `services.warranty_days`, bukan teks garansi yang dikirim klien.
- API tersedia untuk supplier, purchase document/detail, unit/movement, work order unit toko, assignment teknisi, pemakaian part/biaya, tagihan teknisi, dan fulfillment ongkir. UI riwayat transaksi menyediakan pencatatan ongkir aktual/pembayaran ekspedisi; halaman servis pelanggan menyediakan panel part/assignment/tagihan teknisi.
- UI penerimaan pembelian/unit, work order perbaikan unit toko, top-up saldo ekspedisi prabayar, dan daftar laporan belum dibuat.
- Endpoint stok agregat lama tetap tersedia melalui `legacy_stock`; migrasi menyalin kuantitas lama ke subledger kompatibilitas tanpa membuat unit, HPP, atau jurnal fiktif. Checkout lama mengurangi kuantitas legacy, sedangkan PUT stok lama tidak boleh menimpa unit siap jual atau spare part terlacak.
- Test memakai database legacy sementara dan DB POS terisolasi. Test mencakup backup/preservasi ID/stok, diskon pembelian, biaya aktual berbeda per unit, HPP FIFO, biaya eligible vs expense, double-sale, DP servis, HPP part, utang teknisi, work order unit, freight prepaid/payable/partial settlement, idempotensi, refund multi-alokasi, jurnal seimbang, dan rollback. Saldo awal dan jurnal historis tidak dibuat.
- Verifikasi terakhir: `npm test` lulus 26/26; build frontend berhasil dengan peringatan chunk JavaScript di atas 500 KB. Syntax checks backend dan frontend bersih.
- Belum ada UI pembelian/penerimaan unit, pembayaran utang supplier, migrasi opening balance yang diverifikasi, atau jurnal untuk cash-entry manual dan servis lama. Talangan baru hanya mencakup kategori beban operasional yang dipilih; pembelian stok/part memakai alur pembelian dan pengeluaran pribadi owner menunggu konfigurasi akun berjalan/prive.
- Pembatalan servis setelah DP/part dipakai belum otomatis menentukan refund atau failure fee. Alur itu memerlukan kebijakan yang disetujui agar saldo customer dan biaya yang telah timbul tidak ditebak.
- `schema.sql` dan kompatibilitas lama di `src/db.js` masih memiliki bootstrap/migrasi ad hoc; runner bernomor hanya mengatur migrasi baru. Transformasi legacy tersebut perlu dipindah/dipetakan bertahap sebelum dianggap sebagai migrasi penuh.

## 1. Arsitektur yang ditemukan

- Backend ESM Node.js memakai Express 4. `src/app.js` memasang Helmet/CSP, CORS dan pemeriksaan Origin; `src/routes/index.js` membebani API dengan autentikasi cookie, lalu route menerapkan role melalui `authorize`.
- Database adalah satu koneksi `better-sqlite3` di `src/db.js`, dengan foreign key, WAL, dan busy timeout. `schema.sql` dijalankan pada setiap startup. Perubahan lama berupa rebuild tabel produk dan `addColumnIfMissing` dijalankan secara ad hoc; belum ada tabel versi/riwayat migrasi.
- Backend mengelompokkan operasi ke controller produk, transaksi, servis, kas, pelanggan, nota, pengaturan, user, notifikasi, dan health. Transaksi checkout, impor, refund, dan sebagian perubahan multi-baris memakai `db.transaction()`.
- Frontend React/Vite memiliki `App.jsx` sebagai workspace utama untuk kasir, servis, riwayat, inventori, dan pelanggan. API umum berada di `frontend/src/api/client.js`; kas memiliki adapter `cash.js` dan komponen `CashLedgerPage.jsx`.
- Login memakai sesi database dan cookie HttpOnly. Role yang ada hanya `admin`, `kasir`, dan `teknisi`. PIN servis dienkripsi AES-GCM; backup SQLite memakai online backup dan dapat dimirror.
- Test dijalankan dengan Node test runner pada satu server lokal sementara dan native `fetch`; tiap run menghapus/membuat database test terpisah. `supertest` dan `zod` tersedia di `package.json`, tetapi belum dipakai di source/test.

### Relasi data operasional

- `customers` menjadi induk pelanggan dan terhubung ke `services` serta `transactions`.
- `products` menyimpan katalog, satu harga modal generik, harga jual, nomor seri opsional, dan jumlah agregat `stock`.
- `services` menyimpan tiket dan biaya/DP/status servis pelanggan. Perangkat titipan tidak dibuat sebagai produk.
- `transactions` dan `transaction_items` menyimpan invoice beserta item produk, servis, dan trade-in. Referensi item bersifat polimorfik; `products.stock` dikurangi saat item produk dijual.
- `transaction_refunds` menyimpan satu refund penuh per transaksi dengan alasan dan pembuat. Refund membuat pengeluaran pada `cash_entries`.
- `cash_entries` menyimpan kategori bebas, jenis masuk/keluar, sumber manual/transaksi, tanggal, dan pembuat. Tidak ada relasi akun kas/bank atau akun buku besar.
- `users`/`sessions` mengatur akses. `store_settings` mengatur profil/nota toko, bukan konfigurasi akuntansi.

## 2. Fitur yang tersedia dan dapat digunakan kembali

- Checkout, diskon, ongkir tagihan, DP/pelunasan, nota, riwayat, refund penuh, pembayaran servis, dan validasi overselling.
- Impor katalog Excel/CSV, nomor seri, detail spesifikasi, label QR/barcode, serta kategori produk.
- Trade-in membuat produk inventori dan menyimpan nilai taksir sebagai modal. Belum ada status pemeriksaan unit atau identitas perolehan yang memadai.
- Workflow servis pelanggan, biaya final, DP, teknisi yang ditampilkan, PIN terenkripsi, dan nota pembukaan/penyelesaian.
- Catatan kas manual/transaksi, filter tanggal, ringkasan kas, backup SQLite lokal/mirror, autentikasi, role, dan test integrasi.
- SQLite integer Rupiah dan transaksi database yang ada cocok sebagai fondasi posting jurnal atomik. Kompatibilitas API lama dapat dipertahankan sambil menambah sumber data akuntansi.

## 3. Kekurangan akuntansi dan perilaku saat ini

### Penjualan, pembayaran, tukar tambah, dan refund

- `createTransaction` menghitung total server-side, menyimpan invoice/item, dan menurunkan stok dalam transaksi SQLite. `paid_amount` adalah satu angka dan `payment_method` satu pilihan; tidak ada baris pembayaran, alokasi multi-metode, akun penerimaan, atau subledger piutang.
- Penjualan tunai tidak membuat `cash_entries`; ringkasan kas mengambil total `transactions.paid_amount`. Pembayaran lanjutan hanya membuat `cash_entries` untuk transaksi bertipe servis. Ini belum menjadi arus kas per rekening yang dapat direkonsiliasi.
- Nilai penjualan penuh tersimpan di `subtotal`, nilai trade-in di `trade_in_total`, dan uang tagih dihitung sebagai selisih. Ringkasan kas saat ini menjumlahkan uang diterima, bukan pendapatan akrual. Tidak ada pengakuan HPP.
- Refund hanya penuh dan sekali. Stok barang jual dikembalikan; stok produk trade-in dibalik jika unit masih tersedia. Nilai refund dicatat sebagai pengeluaran, tetapi belum ada jurnal retur, pembalikan HPP, atau kredit pelanggan.

### Persediaan, servis, dan biaya lain

- `products.stock` tidak menunjukkan unit mana yang diterima/dijual, biaya aktual setiap laptop, sumber, lokasi, status pemeriksaan, atau riwayat biaya. `cost_price` satu angka katalog tidak cukup untuk HPP unit berbeda.
- Belum ada supplier/pembelian, utang supplier, penerimaan spare part, pemakaian part, work order perbaikan stok, atau alokasi biaya per laptop.
- `services` ditujukan untuk perangkat pelanggan. Tidak ada kepemilikan perangkat toko, part servis, HPP servis, tagihan teknisi eksternal, atau biaya perbaikan yang dikapitalisasi.
- `shipping_cost` hanya ongkir yang masuk ke total invoice. Ongkir aktual, tagihan pelanggan, beban toko, utang ekspedisi, dan saldo prabayar tidak dipisah.
- `cash_entries.category` bebas dan tidak memisahkan beban, aset, utang, transfer rekening, modal, atau penarikan sekutu. Ringkasan saat ini bukan laba rugi dan tidak dapat menjadi neraca.
- Belum ada akun, jurnal, periode buku, laporan, idempotency sumber akuntansi, atau kontrol jurnal posted.

### Migrasi dan operasional

- Tidak ada migrasi bernomor maupun `schema_version`. Bootstrap menjalankan schema dan beberapa perubahan skema/data pada startup; satu migrasi produk membangun ulang tabel.
- Startup memiliki backup periodik, namun migrasi lama berlangsung sebelum backup startup terjadwal. Snapshot harus dipastikan selesai dan diuji pulih sebelum migrasi skema produksi.
- `scripts/cleanup-audit-data.js` menghapus data berdasarkan pola nama pada `DATABASE_PATH`; script ini bukan migrasi dan tidak dijalankan dalam audit.
- Test memakai SQLite terpisah dan aman untuk regresi aplikasi. Belum ada test migrasi dari fixture database versi lama atau laporan keuangan.

## 4. Rancangan tabel

Semua nilai uang disimpan sebagai integer Rupiah; semua tabel baru memakai foreign key, indeks, dan batasan yang dapat ditegakkan SQLite. Detail kolom diselesaikan bersama validasi per fase.

| Tabel | Tujuan |
| --- | --- |
| `schema_migrations` | Versi, nama, checksum, dan waktu migrasi; migrasi berurutan, atomik, dan aman diulang. |
| `accounts` | Bagan akun berkode, tipe (aset, liabilitas, ekuitas, pendapatan, kontra-pendapatan, HPP, beban), saldo normal, akun induk, aktif/postable. |
| `journal_entries` | Tanggal transaksi/pembukuan, nomor referensi, sumber operasional unik, deskripsi, draft/posted/reversed, pembuat, waktu posting, referensi pembalik/koreksi, alasan, dan kunci idempotensi. |
| `journal_lines` | Akun, debit/kredit integer, memo, referensi unit/cost center; hanya satu sisi positif per baris. Posting mensyaratkan jumlah debit = kredit dan jurnal memiliki baris. |
| `cash_accounts` | Kas, bank, QRIS/dompet digital, dan saldo ekspedisi, masing-masing dipetakan ke akun buku besar yang terverifikasi. |
| `payments`, `payment_allocations` | Penerimaan/pengeluaran aktual per akun dan metode, pembagian pembayaran ke invoice/utang/piutang, uang muka, serta idempotensi. |
| `suppliers`, `purchase_documents`, `purchase_items` | Sumber pembelian, invoice tunai/kredit, unit laptop atau spare part, diskon, biaya langsung, dan referensi utang. |
| `inventory_units`, `inventory_movements`, `inventory_cost_components` | Identitas unit laptop, sumber/serial, kondisi, lokasi/status, biaya aktual berlapis, perpindahan, dan keputusan kapitalisasi beserta otorisasi. |
| `part_stock_layers`, `part_movements`, `part_allocations` | Spare part non-serial dengan metode biaya FIFO atau rata-rata tertimbang yang dipilih konsisten dan alokasi ke penjualan/servis/perbaikan unit. |
| `service_work_orders`, `service_parts`, `service_labor`, `service_events` | Kepemilikan perangkat, nomor WO, persetujuan, pemakaian part, teknisi internal/eksternal, tagihan, QC, garansi, dan riwayat tanpa mengganti `services`. |
| `shipping_fulfillments` | Ekspedisi/resi, ongkir estimasi/aktual/tagihan, beban toko, pembayaran, utang, dan saldo prabayar. |
| `partners` / pemetaan akun sekutu | Identitas sekutu dan akun ekuitas berjalan/penarikan yang dipilih berdasarkan dokumen usaha dan kebijakan akuntansi. |
| `fixed_assets` (fase opsional) | Aset tetap, tanggal siap digunakan, dasar biaya, umur/manfaat dan metode penyusutan yang disetujui. |

Transaksi lama, `products`, `services`, `transactions`, `transaction_items`, `transaction_refunds`, dan `cash_entries` dipertahankan. Data operasional baru menautkan jurnal dengan `source_type` dan `source_id`; tabel lama tidak dihapus saat transisi.

## 5. Aturan jurnal yang direncanakan

Jurnal di bawah adalah pola target. Akun spesifik dan tanggal pengakuan final harus dikonfirmasi dengan pemilik/pembuku; tidak ada saldo awal atau jurnal historis yang dibuat otomatis.

| Peristiwa | Debit | Kredit | Aturan |
| --- | --- | --- | --- |
| Beli laptop tunai/kredit | Persediaan unit sebesar biaya perolehan yang dapat dibuktikan | Kas/bank atau utang supplier | Harga beli setelah diskon; kapitalisasi biaya langsung hanya setelah kebijakan disetujui. |
| Bayar utang supplier | Utang supplier | Kas/bank | Tidak mengakui pembelian/beban dua kali. |
| Beli spare part | Persediaan spare part | Kas/bank atau utang | HPP/beban baru diakui saat part digunakan atau ditentukan tidak layak stok. |
| Pakai part untuk servis pelanggan | HPP servis | Persediaan spare part | Alokasi ke work order terkait. |
| Part/biaya langsung untuk perbaikan unit toko | Persediaan unit (hanya biaya yang memenuhi kebijakan) atau beban perbaikan | Persediaan spare part, kas/bank, atau utang | Biaya abnormal/pemborosan dibebankan; wajib alasan dan persetujuan untuk kapitalisasi. |
| Jual laptop | Kas/bank dan piutang atau uang muka yang diaplikasikan | Pendapatan penjualan bruto, dengan diskon/retur sebagai kontra-pendapatan | Pendapatan penjualan bukan hanya selisih trade-in. |
| Pengakuan HPP saat unit terjual | HPP laptop sebesar biaya aktual unit | Persediaan unit | Waktu pengakuan mengikuti serah-terima/kebijakan penjualan. |
| Tukar tambah contoh Rp5 juta / Rp2 juta / Rp3 juta | Kas/bank Rp3 juta dan persediaan unit trade-in Rp2 juta | Pendapatan penjualan Rp5 juta | HPP unit laptop toko yang keluar dicatat terpisah berdasarkan biaya unitnya. Nilai trade-in harus didukung identitas dan pemeriksaan. |
| Invoice servis selesai | Kas/bank/piutang dan/atau uang muka yang diaplikasikan | Pendapatan servis | DP sebelum pendapatan diperoleh menjadi liabilitas uang muka pelanggan; pendapatan diakui saat kewajiban servis dipenuhi. |
| Teknisi eksternal | HPP servis/perbaikan atau akun yang ditetapkan | Kas/bank atau utang teknisi | Kaitkan ke WO/unit. Gaji teknisi internal tetap beban gaji, tanpa biaya tenaga kerja rekaan. |
| Terima DP/pelunasan | Kas/bank | Uang muka pelanggan atau piutang | Pembayaran berikutnya menyelesaikan saldo, tidak membuat pendapatan ulang. |
| Refund/retur | Retur/kontra-pendapatan dan penyesuaian piutang bila relevan | Kas/bank atau kewajiban pengembalian | Kembalikan unit dan HPP berdasarkan biaya aktual; perlakuan retur jasa/part harus sesuai fakta pekerjaan. |
| Pengeluaran operasional | Beban sesuai kategori atau aset/uang muka bila memenuhi kriteria | Kas/bank atau utang | Kategori bukan penentu otomatis kapitalisasi/beban. |
| Pengeluaran pribadi sekutu | Akun ekuitas/berjalan sekutu yang dikonfigurasi | Kas/bank | Tidak otomatis menjadi beban atau diberi label “prive” tanpa kesepakatan akuntansi CV. |
| Ongkir aktual | Beban pengiriman, persediaan bila benar-benar memenuhi kebijakan, atau saldo prabayar | Utang ekspedisi/kas/bank/prabayar | Pisahkan tagihan pelanggan dan biaya aktual; cegah pencatatan ganda. |
| Setoran modal/pinjaman | Kas/bank | Ekuitas sekutu atau utang pendanaan sesuai dokumen | Klasifikasi wajib diverifikasi, bukan disimpulkan dari uang masuk. |
| Aset tetap/penyusutan | Aset tetap atau beban penyusutan | Kas/utang atau akumulasi penyusutan | Penyusutan hanya aktif setelah register, umur, tanggal siap pakai, dan metode disetujui. |

## 6. Strategi migrasi data lama

1. Bekukan ruang lingkup migrasi, buat backup SQLite online di lokasi terpisah, salin kunci PIN secara terpisah, uji restore ke database staging, dan catat hasil pemeriksaan integritas.
2. Pasang runner migrasi bernomor/checksum. Jalankan setiap DDL/data migration dalam transaksi; hentikan startup pada checksum/version mismatch. Jangan menghapus tabel atau mereset database.
3. Jalankan migrasi pada salinan staging berisi fixture legacy dan salinan backup produksi yang tidak dipakai aplikasi; verifikasi row count, ID, relasi, indeks, foreign key, backup, dan rollback.
4. Migrasi awal hanya menambah struktur dan bagan akun tanpa saldo. Jangan membuat jurnal untuk transaksi lama karena metode pembayaran, biaya perolehan per unit, biaya part, dan saldo kas historis tidak cukup teridentifikasi.
5. Tetapkan tanggal cutover setelah owner/pembuku menandatangani opening balance kas tiap rekening, persediaan per unit dari stock opname dan bukti biaya, piutang, utang, uang muka, aset, serta ekuitas. Selisih tetap ditandai sebagai belum direkonsiliasi, bukan dimasukkan ke saldo fiktif.
6. Pertahankan API lama dan tulis jurnal hanya untuk sumber baru setelah cutover. Rekonsiliasi total subledger dengan GL secara berkala sebelum memindahkan laporan sebagai sumber resmi.
7. Deploy produksi hanya setelah backup/restore dan uji migrasi lulus; sediakan prosedur pemulihan versi aplikasi/database yang jelas.

## 7. Tahapan implementasi dan pengujian

| Fase | Cakupan | Gerbang selesai |
| --- | --- | --- |
| 1. Audit | Dokumen ini, pemetaan sumber data, aturan dan keputusan yang belum diketahui | Review owner/pembuku atas kebijakan, daftar akun, tanggal cutover, serta hal ambigu. |
| 2. Migrasi, COA, jurnal | Runner versi/checksum dengan pre-backup, akun, jurnal/lines, service posting seimbang, idempotensi, koreksi/reversal | Migrasi fixture lama aman; test debit=kredit, trigger, akun, foreign key, posting ganda, reversal, rollback. |
| 3. Persediaan/HPP | Unit laptop, movement/cost layers, stok spare part, penerimaan, pemakaian, FIFO/rata-rata | Biaya per unit dapat ditelusuri; penjualan dan retur konsisten; stock opname migrasi disetujui. |
| 4. Servis/trade-in/pengeluaran | Work order dengan kepemilikan, part, teknisi eksternal, unit trade-in, kategori dan sumber biaya | Test servis pelanggan vs unit toko; trade-in masuk pemeriksaan; payroll internal tidak dihitung ganda. |
| 5. Pembayaran/utang-piutang/ongkir/sekutu | Cash accounts, banyak metode per invoice, DP, AP/AR, ekspedisi, transaksi sekutu | Pembayaran idempotent, saldo rekening dan subledger dapat direkonsiliasi, klasifikasi partner terkonfigurasi. |
| 6. Laporan/UI/akses | API laporan dari posted journal, stok dan subledger; role backend; UI filter/ekspor | Trial balance seimbang, neraca A=L+E, laba rugi dan arus kas dapat direkonsiliasi. |
| 7. Cutover/operasi | Uji regresi, backup/restore, migrasi produksi terkontrol, panduan rekonsiliasi | POS lama lulus; owner menyetujui opening balances, laporan paralel, pemulihan, dan tanggal go-live. |

Pengujian dilakukan pada database sementara/fixture; tidak ada test yang memakai `data/pos.sqlite`. Jalankan `npm test`, build frontend, dan test khusus migrasi lama, atomisitas, idempotensi, HPP, pembayaran, laporan dan hak akses pada setiap fase.

## Keputusan yang wajib dikonfirmasi sebelum saldo atau jurnal operasional produksi

- Tanggal cutover/fiscal year dan dasar pengakuan penjualan/servis (serah-terima, penyelesaian, atau kebijakan lain).
- Daftar rekening dan saldo terverifikasi, akun QRIS/ekspedisi prabayar, serta biaya transaksi.
- Struktur sekutu CV, dokumen modal/utang sekutu, akun berjalan, dan perlakuan pengambilan pribadi yang disetujui pembuku.
- Kebijakan diskon, retur/refund parsial, trade-in ditolak/bermasalah, pembatalan setelah part/servis digunakan, serta persediaan rusak/hilang.
- Bukti supplier dan unit per laptop lama; cara stock opname dan penetapan biaya awal setiap unit/spare part.
- Kriteria kapitalisasi perbaikan, biaya abnormal, ongkir masuk/keluar, aset tetap, batas nilai, umur, serta penyusutan.
- Pajak, faktur, kewajiban pelaporan dan kebutuhan ekspor yang berlaku untuk CV.

Keputusan yang belum diketahui dicatat sebagai konfigurasi atau backlog; implementasi tidak mengarang saldo, biaya, pajak, atau klasifikasi ekuitas.

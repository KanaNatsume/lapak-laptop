# Saldo Awal, Valuasi Legacy, dan Rekonsiliasi

Status: implementasi additive pada 19 Oktober 2026. Migrasi produksi belum dijalankan.

## Audit aktual

- Migrasi bernomor yang tersedia adalah `0001` sampai `0016`; migrasi fase ini adalah `0016_reconciliation_workflows.sql`.
- Jurnal berada di `journal_entries`/`journal_lines`. `postJournal` memvalidasi akun, keseimbangan, idempotency key, source event, dan menulis `journal_audit_log`. Trigger melarang perubahan atau penghapusan jurnal posted.
- Stok laptop yang terlacak berada di `inventory_units` dan biaya tambahannya di `inventory_cost_components`; nilai unit berasal dari biaya perolehan dan komponen yang berstatus `capitalized`.
- Spare part terlacak menggunakan `part_stock_layers` dan FIFO. `inventory_product_controls.legacy_stock` tidak memiliki layer biaya aktual.
- `cash_entries` hanya memiliki tipe, kategori bebas, deskripsi, nominal, sumber, tanggal, dan pengguna. Tidak ada akun debit/kredit atau relasi jurnal bawaan.
- Akun `3100` adalah akun parent/non-postable yang masih memerlukan konfigurasi struktur modal sekutu. Sistem tidak mengaktifkannya atau membuat saldo sekutu secara otomatis.

## Implementasi aman

`0016_reconciliation_workflows.sql` menambah:

- `opening_balance_batches` dan `opening_balance_lines` untuk batch saldo awal, sumber bukti, status, approval, journal reference, dan effective date.
- `legacy_valuation_reviews` untuk review biaya unit/stok toko. Data perangkat pelanggan tidak diperlakukan sebagai persediaan toko.
- `cash_entry_reconciliation_mappings` untuk draft rekomendasi akun dan status `ambiguous`/`already_journaled`.
- `reconciliation_audit_log` dengan trigger immutable.

API admin tersedia di `/api/reconciliation/*`. Endpoint read-only `/api/reconciliation/blockers` menyatukan sumber aktual, bukti wajib, kandidat klasifikasi, dampak laporan, approval, jurnal terkait, dan audit history untuk setiap blocker. Alurnya adalah draft, preview, approval, lalu posting. Posting memakai transaksi SQLite dan `postJournal`; kegagalan tidak meninggalkan jurnal parsial. Batch saldo awal posted unik per entitas dan tanggal efektif. Mapping kas unik berdasarkan `cash_entry_id` dan jurnalnya memakai source/idempotency key.

## Kebijakan yang tidak ditebak

- `products.cost_price` pada stok legacy hanya ditampilkan sebagai referensi laporan, bukan HPP resmi.
- Harga jual dan harga trade-in tidak digunakan sebagai biaya perolehan otomatis.
- Review valuasi belum membuat jurnal persediaan; biaya harus diverifikasi dan akun lawan/policy opening harus disetujui terlebih dahulu.
- Mapping kas ambigu tidak dapat disetujui tanpa akun yang dipilih admin. Transaksi yang sudah terdeteksi memiliki jurnal diberi status `already_journaled`.
- Laporan mendapat `completeness` dan `is_final`. Laporan tidak final jika stok legacy, mapping kas manual, atau batch saldo awal masih tertunda.

## Langkah manual sebelum cutover

1. Backup dan uji restore database aktif.
2. Owner/pembuku menetapkan tanggal cutover, akun modal/prive, rekening kas/bank/QRIS, dan aturan kapitalisasi.
3. Lakukan stock opname terpisah antara persediaan toko dan perangkat pelanggan.
4. Lampirkan bukti biaya setiap unit/layer; tandai yang belum terbukti sebagai pending.
5. Tinjau setiap mapping `cash_entries`, khususnya pendapatan servis/penjualan, pembayaran utang, transfer, dan prive.
6. Bandingkan laporan sebelum/sesudah posting pada database uji dan masked copy sebelum migrasi produksi.
7. Jalankan migrasi produksi hanya setelah persetujuan eksplisit dan prosedur rollback disetujui.

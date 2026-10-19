# Laporan Kesiapan Cutover

Tanggal rehearsal: 19 Oktober 2026
Lingkungan: salinan masked legacy di direktori temporary Windows; database aktif tidak disentuh.
Keputusan: **NOT READY**

## 1. Hasil audit

- Jalur migrasi dan accounting berjalan dari migrasi `0001` sampai `0016`.
- Jurnal posted tetap balanced, immutable, memiliki audit trail, dan posting opening balance bersifat idempotent.
- Workflow rekonsiliasi tersedia secara additive dan hanya dapat dipakai admin.
- Tidak ada deployment atau migrasi terhadap `data/pos.sqlite` pada audit ini.
- Test regresi terakhir: 29/29. Build frontend berhasil.

## 2. Backup dan restore

Rehearsal membuat backup pre-migration, backup online setelah migrasi, lalu menyalin backup ke database restore terpisah.

| Pemeriksaan | Hasil |
| --- | --- |
| Baris sebelum backup | journal 2, lines 4, cash 1, product 1, legacy stock 2 |
| Baris sesudah restore | identik dengan sebelum backup |
| Posted debit / credit | 1.100.000 / 1.100.000 |
| SQLite integrity check | `ok` |
| Foreign-key violations | 0 |
| Tabel rekonsiliasi | ada |
| Startup ulang database migrated | berhasil, 16 migration rows |
| Startup ulang database restored | berhasil, 16 migration rows |

## 3. Rehearsal migrasi

Harness `scripts/cutoverRehearsal.mjs` menjalankan migrasi pada masked legacy copy, memverifikasi checksum-ledger melalui migration runner, menguji backup/restore, startup berulang, posting jurnal, opening balance, review valuasi, cash mapping, dan laporan.

Hasil akhir harness: `REHEARSAL_COMPLETE`. Direktori kerja dibuat di `%TEMP%` dan bukan di database aktif.

## 4. Rekonsiliasi numerik

- Trial balance: balanced; debit 1.100.000 dan kredit 1.100.000.
- Balance sheet: balanced; difference 0.
- Cash-flow net change: 1.100.000 berdasarkan jurnal posted.
- Valued unit total: 0 karena fixture legacy stock belum menjadi `inventory_units` bernilai.
- Legacy reference total: 0; `products.cost_price = 0` pada fixture tidak boleh dianggap sebagai biaya perolehan.
- Legacy stock tersisa: 2 unit.
- Cash legacy belum direkonsiliasi: 1 entry, nominal 50.000.

### Bukti sumber pada masked fixture

Identifier berikut hanya berlaku untuk salinan masked rehearsal, bukan klaim tentang database aktif:

| Blocker | Sumber aktual | Status biaya/jurnal | Bukti yang tersedia |
| --- | --- | --- | --- |
| Legacy stock | `products.id = 1`, nama `Masked Legacy Laptop`, kategori `laptop`, brand `Masked Brand` | `products.stock = 2`, `inventory_product_controls.legacy_stock = 2`, `products.cost_price = 0`, `verified_at = NULL`; tidak ada baris `inventory_units` untuk fixture | Hanya saldo stok legacy agregat dari tabel produk/control; tidak ada invoice atau biaya terverifikasi |
| Cash legacy | `cash_entries.id = 1`, tanggal `2026-10-01`, `entry_type = pengeluaran`, kategori `Lainnya`, sumber `manual`, deskripsi `Fixture ambiguous cash` | Nominal `50.000`, mapping dibuat `ambiguous`, jurnal sumber dengan `source_type = cash_entry` dan `source_id = 1`: 0 | Hanya baris `cash_entries`; tidak ada jurnal sumber yang dapat ditautkan pada rehearsal |

Rehearsal membuat review valuasi synthetic untuk menguji lifecycle workflow. Review tersebut bukan bukti biaya historis dan tidak mengubah fixture menjadi data produksi. `MASKED-INVOICE-01` hanya identifier test, bukan invoice pemilik.

## 5. Perbedaan dan blocker yang belum selesai

1. Dua unit legacy masih harus melalui stock opname, bukti biaya, dan keputusan valuasi.
2. Satu cash entry legacy sebesar 50.000 masih ambiguous dan belum dipetakan ke akun.
3. Akun modal/prive sekutu belum dikonfigurasi; akun `3100` parent/non-postable tidak boleh dipakai sebagai akun lawan otomatis.
4. Review valuasi legacy belum mem-post jurnal dampak persediaan. Posting ditahan sampai owner/accountant menyetujui akun lawan dan kebijakan tanggal efektif.
5. Saldo awal, transfer antar rekening, pajak, aset tetap, dan transaksi historis tanpa jurnal masih memerlukan keputusan bisnis bila harus masuk laporan final eksternal.

Karena blocker tersebut, `completeness.complete = false` dan laporan belum boleh diklaim final untuk cutover produksi.

### Rincian tindakan blocker

| Blocker | Informasi yang masih kurang | Bukti yang dibutuhkan | Klasifikasi sah yang belum dipilih | Penyetuju | Dampak laporan |
| --- | --- | --- | --- | --- | --- |
| Stok legacy agregat 2 unit | Nomor seri/unit, kondisi, kepemilikan, tanggal perolehan, biaya per unit, biaya perbaikan yang layak dikapitalisasi | Stock opname bertanda tangan, invoice/kwitansi supplier, bukti transfer, kartu servis, dan pemetaan unit | Persediaan toko pada biaya terbukti; unit customer dikembalikan/dipisahkan; atau pending bila bukti tidak cukup | Owner dan pembuku | Persediaan, HPP, laba kotor, ekuitas awal, dan `is_final` tetap tidak final |
| Cash `id = 1` / Rp50.000 | Tujuan pengeluaran, pihak penerima, rekening sumber, keterkaitan transaksi/utang/aset/prive | Nota, mutasi bank/kas, invoice, bukti pembayaran, atau konfirmasi owner | Beban, pembelian persediaan, pembayaran utang, transfer, prive, atau unidentified/pending | Owner dan pembuku | Kas, beban/persediaan/utang/ekuitas, arus kas, dan `is_final` terdampak |
| Modal/prive | Nama sekutu, akun berjalan, dokumen setoran/penarikan, tanggal efektif, dan rekening | Akta/perjanjian, keputusan owner, rekening koran, bukti setoran/penarikan | Akun ekuitas sekutu atau utang pendanaan; prive hanya bila disetujui | Owner dan pembuku | Ekuitas, arus kas pendanaan, dan neraca dapat berubah |
| Kebijakan valuasi | Dasar biaya, perlakuan repair/freight/pajak, tanggal pengakuan, dan akun lawan | Kebijakan tertulis pembuku serta bukti biaya per item | Biaya historis terbukti; biaya tambahan eligible; atau tetap unvalued/pending | Pembuku dengan persetujuan owner | Nilai persediaan dan HPP historis; tidak boleh memakai harga jual/estimasi otomatis |

## 6. Keputusan owner/accountant yang diperlukan

- Tetapkan tanggal dan periode cutover.
- Tetapkan rekening kas, bank, dan QRIS serta aturan klasifikasi transfer.
- Setujui akun modal/prive dan saldo awal sekutu.
- Selesaikan stock opname dan bukti biaya untuk seluruh legacy stock.
- Tentukan akun dan jurnal untuk cash entry ambiguous.
- Setujui aturan kapitalisasi biaya, perlakuan pajak, aset tetap, dan transaksi historis.
- Setujui laporan hasil posting pada masked copy sebelum menyentuh database aktif.

### Konfigurasi yang disiapkan, tetapi belum diaktifkan

Konfigurasi harus diisi sebagai parameter keputusan, bukan hardcode nama sekutu atau nominal:

- `equity_contribution_account`: kode akun postable untuk setoran modal.
- `owner_draw_account`: kode akun postable untuk prive, bila kebijakan mengizinkannya.
- `funding_liability_account`: kode akun utang pendanaan bila setoran diperlakukan sebagai pinjaman.
- `cash_account_code`: kode akun kas/bank/QRIS yang benar-benar dibuktikan.
- `legacy_inventory_offset_account`: kode akun lawan valuasi yang disetujui.
- `valuation_policy`: pilihan tertulis biaya historis terbukti, biaya tambahan eligible, atau pending/unvalued.
- `effective_date` dan `approved_by`: tanggal berlaku dan identitas penyetuju.

Tidak ada nilai default yang membuat jurnal. Setiap field wajib divalidasi sebagai akun postable aktif dan setiap konfigurasi wajib memiliki bukti serta approval sebelum workflow posting dapat menggunakannya.

## 7. Perintah cutover dan rollback yang aman

Perintah berikut adalah prosedur tertulis, bukan perintah yang dijalankan dalam audit ini. Jalankan hanya setelah maintenance window, backup tervalidasi, dan persetujuan eksplisit.

```powershell
$env:DATABASE_PATH = 'C:\path\to\data\pos.sqlite'
$env:BACKUP_DIR = 'C:\path\to\backup'
npm.cmd start
```

Rollback harus dilakukan dengan menghentikan aplikasi, menyimpan file database hasil cutover untuk investigasi, lalu memulihkan backup tervalidasi ke path database aktif dan menjalankan integrity check sebelum aplikasi dibuka kembali. Jangan menghapus backup asli.

```powershell
Copy-Item 'C:\path\to\backup\pos-pre-migration-<id>.sqlite' 'C:\path\to\data\pos.sqlite' -Force
node --input-type=module -e "import Database from 'better-sqlite3'; const db = new Database(process.env.DATABASE_PATH); console.log(db.pragma('integrity_check', {simple:true})); console.log(db.pragma('foreign_key_check')); db.close()"
```

Path placeholder wajib diganti dengan path yang disetujui dan diverifikasi. Rehearsal ini tidak memberikan izin untuk menjalankan rollback terhadap database aktif.

## 8. Status akhir

**NOT READY FOR PRODUCTION CUTOVER.**

Workflow review blocker sekarang tersedia melalui API admin `/api/reconciliation/blockers` dan panel Rekonsiliasi. Review tersebut read-only terhadap sumber dan menampilkan bukti wajib, kandidat klasifikasi, dampak laporan, status approval, jurnal terkait, serta audit history.

Kriteria cutover yang belum terpenuhi:

- Setiap legacy stock memiliki identitas dan bukti biaya yang cukup, atau keputusan eksplisit untuk tetap unvalued/customer-owned.
- Setiap cash legacy memiliki klasifikasi dan akun yang disetujui; item ambigu tetap pending dan tidak memiliki jurnal.
- Konfigurasi modal/prive/valuasi memiliki kode akun postable, tanggal efektif, bukti, dan approval owner/pembuku tanpa default hardcode.
- Posting yang disetujui menghasilkan satu jurnal idempotent; koreksi memakai reversal, bukan edit langsung.
- Audit history lengkap dan `completeness.complete = true` sehingga laporan dapat `is_final = true`.

Sistem teknis lolos rehearsal isolated untuk migrasi, backup/restore, integrity, idempotency, dan keseimbangan jurnal. Kesiapan produksi tertahan oleh rekonsiliasi data legacy dan keputusan akuntansi yang belum disetujui. Tidak ada perubahan database aktif dan tidak ada deployment yang dilakukan.

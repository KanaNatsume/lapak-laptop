# Rencana dan Audit Laporan Keuangan

Status: implementasi laporan selesai pada 19 Oktober 2026. Sumber laporan adalah jurnal `posted` dan subledger persediaan/utang; `cash_entries` bukan sumber laba. Setiap response laporan kini membawa `completeness` dan `is_final`; status final tidak boleh diklaim selama data legacy material belum direkonsiliasi.

## Status selesai

- Backend read-only tersedia pada `/api/reports/:type` untuk `profit-loss`, `balance-sheet`, `cash-flow`, `trial-balance`, `general-ledger`, `inventory`, `unit-profit`, `service-profit`, `receivables`, `payables`, dan `stock-aging`.
- UI admin tersedia pada menu **Laporan** dengan filter periode/as-of, ringkasan, tabel detail, loading/error/empty state, dan angka yang seluruhnya berasal dari API.
- Test integrasi memakai jurnal posted, draft yang sengaja diabaikan, periode berbeda, piutang/utang, serta seluruh tipe laporan. Neraca diuji `Aset = Liabilitas + Ekuitas` dan trial balance diuji total debit=kredit.
- Verifikasi: `npm test` lulus 29/29 dan build frontend berhasil. Build memberi advisory chunk awal sekitar 854 KB; jsPDF tetap lazy-loaded sebagai chunk terpisah.

## Audit aktual

- Tidak ada service/controller/route laporan keuangan sebelumnya.
- Jurnal berada pada `journal_entries` dan `journal_lines`, dengan akun pada `accounts`. Jurnal `reversed` tidak termasuk query posted; jurnal pembalik berstatus `posted` tetap termasuk.
- Pendapatan penjualan, servis, dan ongkir memakai akun `4100`, `4200`, `4300`. Retur/diskon memakai `4900`.
- HPP laptop, servis, dan spare part memakai `5100`, `5200`, `5110`.
- Kas/bank/QRIS memakai `1110`, `1120`, `1130`; piutang `1200`; persediaan laptop/spare part/gadget `1310`, `1320`, `1330`; prepaid ekspedisi `1400`.
- Utang supplier, uang muka pelanggan, teknisi eksternal, dan ekspedisi memakai `2100`, `2200`, `2300`, `2400`.
- Unit laptop dan biaya kapitalisasi tersedia melalui `inventory_units` dan `inventory_unit_costs`. Layer spare part FIFO tersedia melalui `part_stock_layers` dan `remaining_cost`.
- Piutang invoice dihitung dari akun `1200`; pembayaran memakai `transaction_payment_events`. Utang supplier berasal dari jurnal pembelian dan utang teknisi/ekspedisi dari tabel operasional serta jurnal `2300`/`2400`.
- Belum ada saldo awal, prive, aset tetap, atau jurnal cash-entry manual yang terhubung ke akun buku besar. Laporan harus menampilkan keterbatasan ini, bukan membuat angka penyeimbang.
- Workflow additive rekonsiliasi tersedia di `/api/reconciliation/*` untuk saldo awal, review valuasi legacy, dan draft mapping `cash_entries`; workflow ini belum dijalankan pada database produksi.

## Laporan

| Laporan | Sumber | Rumus utama |
| --- | --- | --- |
| Laba rugi | Mutasi akun revenue, contra revenue, COGS, expense pada jurnal posted dalam `from..to` | Pendapatan bersih - HPP - beban |
| Neraca | Saldo kumulatif akun posted sampai `as_of` | Aset = liabilitas + akun ekuitas + laba berjalan |
| Arus kas | Mutasi debit/kredit akun kas/bank/QRIS, diklasifikasikan menurut source journal | Kas masuk/keluar aktual; bukan pendapatan/beban |
| Neraca saldo | Semua akun posted sampai tanggal akhir | Debit akhir dan kredit akhir harus sama |
| Buku besar | Journal lines posted, filter akun/tanggal | Saldo berjalan debit-kredit per akun |
| Nilai persediaan | Unit belum terjual + layer spare part remaining + akun persediaan posted | Unit cost aktual + biaya kapitalisasi; legacy stock dipisahkan sebagai belum tervaluasi |
| Profit unit | `inventory_unit_allocations` dan item transaksi | Harga jual bersih - allocated HPP |
| Profit servis | Pendapatan `4200` dan HPP `5200` per service source | Pendapatan servis - part/teknisi eksternal |
| Piutang | Saldo akun `1200`, dikelompokkan customer/invoice | Invoice revenue debit - payment credit |
| Utang | Supplier purchase, technician bills, freight fulfillments dan akun liability | Recognition credit - payment debit |
| Umur stok | Unit/layer yang belum sold, dihitung dari `acquired_at`/`received_at` sampai `as_of` | Bucket 0-30, 31-60, 61-90, >90 hari |

## Integritas dan filter

- Validasi tanggal memakai format `YYYY-MM-DD`; periode tidak boleh `from > to`.
- Laporan periode memakai `posting_date BETWEEN from AND to` dan `status = 'posted'`.
- Neraca, saldo akun, persediaan, piutang, utang, dan umur stok memakai saldo kumulatif sampai tanggal akhir.
- Semua laporan read-only dan tidak menulis jurnal/saldo.
- Balance sheet tidak memasukkan akun fiktif. Laba berjalan disajikan sebagai komponen ekuitas turunan agar persamaan dapat direkonsiliasi; data opening balance yang belum ada ditampilkan sebagai keterbatasan.
- Arus kas mengklasifikasikan berdasarkan sumber journal: pembelian/servis/penjualan/operasional sebagai operasi, aset tetap sebagai investasi, modal/pendanaan sebagai pendanaan. Transfer antar akun internal belum memiliki tipe transfer eksplisit dan ditandai keterbatasan.

## File implementasi

- `src/reports/reportService.js`: query agregat posted dan subledger.
- `src/controllers/reportController.js`, `src/routes/reportRoutes.js`: API read-only admin.
- `frontend/src/components/FinancialReportsPage.jsx`, `frontend/src/api/client.js`, `frontend/src/App.jsx`: UI filter/tab laporan.
- `test/reports.test.js`: fixture journal, inventory, revenue, HPP, payable/receivable, periode, keseimbangan dan rekonsiliasi.

## Risiko data historis

- Transaksi lama sebelum cutover tidak otomatis memiliki jurnal atau biaya unit; laporan menampilkan hanya posted journal dan subledger yang ada.
- `products.stock` legacy tanpa unit cost tidak boleh dipakai untuk profit unit atau HPP; nilai tersebut ditampilkan sebagai legacy/unvalued.
- Saldo awal, prive, pajak, aset tetap, dan transfer antar rekening perlu kebijakan/rekonsiliasi sebelum laporan dianggap final untuk pelaporan eksternal.

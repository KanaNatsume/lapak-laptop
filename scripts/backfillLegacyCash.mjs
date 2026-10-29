// Backfill jurnal untuk cash_entries lama lewat workflow rekonsiliasi.
// Pemakaian: node scripts/backfillLegacyCash.mjs --opening-cash=5000000 --cutover=2026-09-30 [--legacy-stock] [--apply]
// Tanpa --apply, skrip hanya menampilkan rencana pemetaan (tidak mengubah database).
import db from '../src/db.js';
import {
  addOpeningLine, approveCashMapping, approveOpeningBatch, createCashMapping,
  createLegacyValuationReview, createOpeningBatch, listLegacyValuationCandidates,
  postCashMapping, postOpeningBatch, verifyLegacyValuation
} from '../src/reconciliation/reconciliationService.js';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));
const apply = args.apply === 'true';
const openingCash = Number(args['opening-cash'] || 0);
const legacyStock = args['legacy-stock'] === 'true';
const cutover = args.cutover || '2026-09-30';
const userId = Number(args.user || 1);

const expenseRules = [
  [/listrik|air|pdam|motor|bensin|oli|iklan|sablon/, '6300', 'beban_operasional'],
  [/makan|minum|beras|telur|mie|seragam|kebersihan|sampah/, '6200', 'beban_operasional'],
  [/pengiriman|ongkir|tiki|jne/, '6400', 'beban_operasional'],
  [/service|servis|baterai|batre|ssd|keyboard|kb/, '5200', 'beban_operasional']
];

function classify(entry) {
  const text = `${entry.category} ${entry.description}`.toLowerCase();
  if (entry.entry_type === 'pemasukan') {
    return { debit: '1110', credit: /service|servis/.test(text) ? '4200' : '4100', category: 'pendapatan' };
  }
  const rule = expenseRules.find(([pattern]) => pattern.test(text));
  if (!rule) return null;
  return { debit: rule[1], credit: '1110', category: rule[2] };
}

const entries = db.prepare(`SELECT c.* FROM cash_entries c
  LEFT JOIN cash_entry_reconciliation_mappings m ON m.cash_entry_id = c.id
  WHERE m.id IS NULL ORDER BY c.entry_date, c.id`).all();
const plan = entries.map((entry) => ({ entry, rule: classify(entry) }));
const unmapped = plan.filter((item) => !item.rule);
for (const { entry, rule } of plan) {
  console.log(`#${entry.id} ${entry.entry_date} ${entry.entry_type} ${entry.amount} "${entry.description}" -> ${rule ? `${rule.debit}/${rule.credit}` : 'TIDAK DIKENALI'}`);
}
if (unmapped.length) {
  console.log(`\n${unmapped.length} entri tidak dikenali; hentikan dan tentukan akunnya secara manual.`);
  process.exit(1);
}
if (!apply) {
  console.log('\nDry run selesai. Tambahkan --apply untuk memposting.');
  process.exit(0);
}

db.transaction(() => {
  const openingLines = [];
  if (openingCash > 0) openingLines.push({ accountCode: '1110', amount: openingCash, sourceType: 'owner_confirmation', sourceReference: 'backfill-saldo-awal-kas' });
  if (legacyStock) {
    const candidates = listLegacyValuationCandidates(db);
    let stockTotal = 0;
    for (const item of candidates) {
      const product = db.prepare('SELECT cost_price FROM products WHERE id = ?').get(item.product_id);
      const cost = product.cost_price * item.quantity;
      if (cost <= 0) continue;
      const review = createLegacyValuationReview(db, { productId: item.product_id, unitId: item.unit_id, quantity: item.quantity, purchaseCost: cost, sourceType: 'cost_price_produk', sourceReference: `produk-${item.product_id}`, verificationNote: 'Biaya diambil dari cost_price produk lama', createdBy: userId });
      verifyLegacyValuation(db, review.id, userId);
      stockTotal += cost;
    }
    if (stockTotal > 0) openingLines.push({ accountCode: '1310', amount: stockTotal, sourceType: 'cost_price_produk', sourceReference: 'backfill-persediaan' });
    console.log(`Persediaan lama: ${candidates.length} item, nilai ${stockTotal}`);
  }
  if (openingLines.length) {
    const batch = createOpeningBatch(db, { effectiveDate: cutover, sourceSummary: 'Saldo awal kas dan persediaan', notes: 'Diisi saat backfill historis', createdBy: userId });
    const common = { verificationStatus: 'verified', createdBy: userId };
    for (const line of openingLines) addOpeningLine(db, batch.id, { ...common, ...line, side: 'debit' });
    const total = openingLines.reduce((sum, line) => sum + line.amount, 0);
    addOpeningLine(db, batch.id, { ...common, accountCode: '3110', side: 'credit', amount: total, sourceType: 'owner_confirmation', sourceReference: 'backfill-modal-awal' });
    approveOpeningBatch(db, batch.id, userId);
    postOpeningBatch(db, batch.id, userId);
  }
  for (const { entry, rule } of plan) {
    const mapping = createCashMapping(db, entry.id, userId);
    approveCashMapping(db, mapping.id, { reviewedBy: userId, debitAccountCode: rule.debit, creditAccountCode: rule.credit, categoryCode: rule.category, note: 'Backfill historis berdasarkan kategori' });
    postCashMapping(db, mapping.id, userId);
  }
})();
console.log('\nBackfill selesai.');

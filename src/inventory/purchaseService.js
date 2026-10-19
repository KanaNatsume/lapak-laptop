import crypto from 'node:crypto';
import { postJournal } from '../accounting/journalService.js';
import { createInventoryUnit } from './inventoryUnitService.js';

const cashAccountCodes = new Set(['1110', '1120', '1130']);

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Tanggal pembelian harus YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Tanggal pembelian tidak valid');
  return value;
}

function normalizePurchase(input) {
  const sourceType = String(input.sourceType || '');
  if (!['supplier', 'individual'].includes(sourceType)) throw new Error('Sumber pembelian harus supplier atau perorangan');
  const supplierId = input.supplierId === undefined || input.supplierId === null || input.supplierId === '' ? null : Number(input.supplierId);
  if (sourceType === 'supplier' && (!Number.isSafeInteger(supplierId) || supplierId <= 0)) throw new Error('Supplier wajib dipilih');
  if (sourceType === 'individual' && supplierId !== null) throw new Error('Pembelian perorangan tidak boleh memakai supplier');
  const supplier = supplierId ? input.db.prepare('SELECT id, name, active FROM suppliers WHERE id = ?').get(supplierId) : null;
  if (supplierId && (!supplier || !supplier.active)) throw new Error('Supplier tidak ditemukan atau nonaktif');
  const sourceLabel = String(input.sourceLabel || supplier?.name || '').trim();
  if (!sourceLabel) throw new Error('Nama sumber pembelian wajib diisi');
  const paymentMode = String(input.paymentMode || '');
  if (!['cash', 'credit'].includes(paymentMode)) throw new Error('Metode pembelian harus tunai atau kredit');
  const cashAccountCode = paymentMode === 'cash' ? String(input.cashAccountCode || '') : null;
  if (paymentMode === 'cash' && !cashAccountCodes.has(cashAccountCode)) throw new Error('Pilih akun kas, bank, atau QRIS yang valid');
  const purchaseDate = validDate(input.purchaseDate || new Date().toISOString().slice(0, 10));
  const createdBy = Number(input.createdBy);
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!Number.isSafeInteger(createdBy) || createdBy <= 0) throw new Error('Pembuat pembelian tidak valid');
  if (!idempotencyKey || idempotencyKey.length > 160) throw new Error('Kunci idempotensi pembelian wajib diisi maksimal 160 karakter');
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('Pembelian harus berisi minimal satu produk');

  let grossAmount = 0;
  const items = input.items.map((item, index) => {
    const productId = Number(item.productId);
    const quantity = Number(item.quantity);
    const unitCost = Number(item.unitCost);
    const product = Number.isSafeInteger(productId) && productId > 0 ? input.db.prepare('SELECT id, category, name FROM products WHERE id = ?').get(productId) : null;
    if (!product) throw new Error(`Produk baris ${index + 1} tidak ditemukan`);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(unitCost) || unitCost <= 0) throw new Error(`Jumlah dan harga modal baris ${index + 1} harus Rupiah integer positif`);
    const inventoryType = product.category === 'laptop' ? 'laptop_unit' : product.category === 'part_copotan' ? 'spare_part' : null;
    if (!inventoryType) throw new Error(`Pembelian unit hanya menerima laptop atau spare part copotan (${product.name})`);
    const serialNumbers = item.serialNumbers === undefined ? [] : item.serialNumbers;
    if (!Array.isArray(serialNumbers) || serialNumbers.length > quantity || (inventoryType !== 'laptop_unit' && serialNumbers.length > 0)) throw new Error(`Nomor seri baris ${index + 1} tidak valid`);
    const normalizedSerials = serialNumbers.map((serial) => String(serial || '').trim());
    if (new Set(normalizedSerials.filter(Boolean)).size !== normalizedSerials.filter(Boolean).length) throw new Error(`Nomor seri duplikat pada baris ${index + 1}`);
    const lineTotal = quantity * unitCost;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(grossAmount + lineTotal)) throw new Error('Total pembelian melebihi batas Rupiah integer');
    grossAmount += lineTotal;
    return { index, productId, productName: product.name, inventoryType, quantity, unitCost, lineTotal, serialNumbers: normalizedSerials, condition: String(item.condition || 'unknown'), notes: String(item.notes || '').trim() };
  });
  const discountAmount = Number(input.discountAmount || 0);
  if (!Number.isSafeInteger(discountAmount) || discountAmount < 0 || discountAmount >= grossAmount) throw new Error('Diskon pembelian harus integer Rupiah dan lebih kecil dari total bruto');
  let unappliedDiscount = discountAmount;
  for (const item of items) {
    const numerator = BigInt(discountAmount) * BigInt(item.lineTotal);
    item.discountAmount = Number(numerator / BigInt(grossAmount));
    item.discountRemainder = numerator % BigInt(grossAmount);
    unappliedDiscount -= item.discountAmount;
  }
  const discountOrder = [...items].sort((left, right) => left.discountRemainder === right.discountRemainder ? left.index - right.index : left.discountRemainder > right.discountRemainder ? -1 : 1);
  for (const item of discountOrder) {
    if (!unappliedDiscount) break;
    if (item.discountAmount + 1 >= item.lineTotal) continue;
    item.discountAmount += 1;
    unappliedDiscount -= 1;
  }
  if (unappliedDiscount) throw new Error('Diskon tidak dapat dialokasikan tanpa membuat nilai persediaan nol');
  for (const item of items) {
    item.netAmount = item.lineTotal - item.discountAmount;
    item.baseUnitCost = Math.floor(item.netAmount / item.quantity);
    item.unitCostRemainder = item.netAmount % item.quantity;
    if (item.baseUnitCost <= 0) throw new Error(`Diskon menghasilkan biaya per unit nol untuk ${item.productName}`);
    delete item.discountRemainder;
    delete item.index;
  }
  const totalAmount = grossAmount - discountAmount;
  const normalized = { supplierId, sourceType, sourceLabel, supplierInvoice: String(input.supplierInvoice || '').trim(), purchaseDate, paymentMode, cashAccountCode, createdBy, idempotencyKey, grossAmount, discountAmount, totalAmount, items };
  normalized.requestHash = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return normalized;
}

export function getInventoryPurchase(db, id) {
  const purchase = db.prepare(`SELECT inventory_purchases.*, suppliers.name AS supplier_name
    FROM inventory_purchases LEFT JOIN suppliers ON suppliers.id = inventory_purchases.supplier_id
    WHERE inventory_purchases.id = ?`).get(id);
  if (!purchase) return null;
  const items = db.prepare(`SELECT inventory_purchase_items.*, products.name AS product_name
      , COALESCE(inventory_purchase_item_discounts.discount_amount, 0) AS discount_amount
      , COALESCE(inventory_purchase_item_discounts.net_amount, inventory_purchase_items.line_total) AS net_amount
    FROM inventory_purchase_items JOIN products ON products.id = inventory_purchase_items.product_id
    LEFT JOIN inventory_purchase_item_discounts ON inventory_purchase_item_discounts.purchase_item_id = inventory_purchase_items.id
    WHERE inventory_purchase_items.purchase_id = ? ORDER BY inventory_purchase_items.id`).all(id);
  const units = db.prepare('SELECT id, unit_code, product_id, serial_number, status, acquisition_cost FROM inventory_units WHERE purchase_item_id IN (SELECT id FROM inventory_purchase_items WHERE purchase_id = ?) ORDER BY id').all(id);
  return { ...purchase, items, units };
}

export function createInventoryPurchase(db, input) {
  const purchase = normalizePurchase({ ...input, db });
  const existing = db.prepare('SELECT id, request_hash FROM inventory_purchases WHERE idempotency_key = ?').get(purchase.idempotencyKey);
  if (existing) {
    if (existing.request_hash !== purchase.requestHash) throw new Error('Kunci idempotensi pembelian sudah dipakai untuk data berbeda');
    return { ...getInventoryPurchase(db, existing.id), duplicate: true };
  }

  const create = db.transaction(() => {
    const purchaseNumber = `PUR-${purchase.purchaseDate.replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const debitTotals = new Map();
    for (const item of purchase.items) {
      const accountCode = item.inventoryType === 'laptop_unit' ? '1310' : '1320';
      debitTotals.set(accountCode, (debitTotals.get(accountCode) || 0) + item.netAmount);
    }
    const journalLines = [...debitTotals.entries()].map(([accountCode, debit]) => ({ accountCode, debit, credit: 0, memo: 'Penerimaan persediaan' }));
    journalLines.push({ accountCode: purchase.paymentMode === 'cash' ? purchase.cashAccountCode : '2100', debit: 0, credit: purchase.totalAmount, memo: purchase.paymentMode === 'cash' ? 'Pembayaran pembelian' : 'Utang pembelian' });
    const journal = postJournal(db, {
      entryDate: purchase.purchaseDate,
      postingDate: purchase.purchaseDate,
      reference: purchase.supplierInvoice || purchaseNumber,
      source: { type: 'inventory_purchase', id: purchaseNumber, event: 'recognition' },
      description: `Pembelian persediaan ${purchaseNumber} · ${purchase.sourceLabel}`,
      idempotencyKey: `inventory-purchase:${purchase.idempotencyKey}`,
      createdBy: purchase.createdBy,
      lines: journalLines
    });
    const result = db.prepare(`INSERT INTO inventory_purchases (
      purchase_number, supplier_id, source_type, source_label, supplier_invoice, purchase_date,
      payment_mode, cash_account_code, total_amount, journal_entry_id, created_by, idempotency_key, request_hash,
      gross_amount, discount_amount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      purchaseNumber, purchase.supplierId, purchase.sourceType, purchase.sourceLabel,
      purchase.supplierInvoice, purchase.purchaseDate, purchase.paymentMode,
      purchase.cashAccountCode, purchase.totalAmount, journal.id, purchase.createdBy,
      purchase.idempotencyKey, purchase.requestHash, purchase.grossAmount, purchase.discountAmount
    );
    const purchaseId = Number(result.lastInsertRowid);
    const insertItem = db.prepare(`INSERT INTO inventory_purchase_items (
      purchase_id, product_id, inventory_type, quantity, unit_cost, line_total
    ) VALUES (?, ?, ?, ?, ?, ?)`);
    const insertLayer = db.prepare(`INSERT INTO part_stock_layers (
      product_id, purchase_item_id, quantity_received, quantity_remaining, unit_cost, total_cost, remaining_cost
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insertDiscount = db.prepare('INSERT INTO inventory_purchase_item_discounts (purchase_item_id, discount_amount, net_amount) VALUES (?, ?, ?)');
    for (const item of purchase.items) {
      const purchaseItemId = Number(insertItem.run(purchaseId, item.productId, item.inventoryType, item.quantity, item.unitCost, item.lineTotal).lastInsertRowid);
      insertDiscount.run(purchaseItemId, item.discountAmount, item.netAmount);
      if (item.inventoryType === 'laptop_unit') {
        for (let index = 0; index < item.quantity; index += 1) {
          const unitCost = item.baseUnitCost + Number(index < item.unitCostRemainder);
          createInventoryUnit(db, {
            productId: item.productId,
            sourceType: purchase.sourceType,
            sourceReference: purchaseNumber,
            sourceLabel: purchase.sourceLabel,
            acquiredAt: purchase.purchaseDate,
            acquisitionCost: unitCost,
            condition: item.condition,
            serialNumber: item.serialNumbers[index] || '',
            notes: item.notes,
            purchaseItemId,
            createdBy: purchase.createdBy
          });
        }
      } else {
        const layerUnitCost = Math.ceil(item.netAmount / item.quantity);
        const layerResult = insertLayer.run(item.productId, purchaseItemId, item.quantity, item.quantity, layerUnitCost, item.netAmount, item.netAmount);
        const layerId = Number(layerResult.lastInsertRowid);
        const stockUpdate = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.quantity, item.productId);
        if (stockUpdate.changes !== 1) throw new Error(`Stok spare part ${item.productName} gagal diperbarui`);
        db.prepare(`INSERT INTO part_stock_movements (
          product_id, layer_id, movement_type, quantity_delta, unit_cost, source_type, source_id, reason, created_by, total_cost
        ) VALUES (?, ?, 'purchase', ?, ?, 'inventory_purchase', ?, 'Penerimaan spare part', ?, ?)`).run(item.productId, layerId, item.quantity, layerUnitCost, purchaseNumber, purchase.createdBy, item.netAmount);
      }
    }
    return { ...getInventoryPurchase(db, purchaseId), duplicate: false };
  });
  return create.immediate();
}

export function createSupplier(db, input, createdBy) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Nama supplier wajib diisi');
  const result = db.prepare(`INSERT INTO suppliers (name, phone, address, tax_number, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?)`).run(name, String(input.phone || '').trim(), String(input.address || '').trim(), String(input.taxNumber || '').trim(), String(input.notes || '').trim(), createdBy);
  return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(result.lastInsertRowid);
}

export function listSuppliers(db) {
  return db.prepare('SELECT * FROM suppliers WHERE active = 1 ORDER BY name').all();
}

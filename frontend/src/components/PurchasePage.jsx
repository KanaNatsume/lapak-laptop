import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { createInventoryPurchase, createSupplier, getInventoryPurchases, getProducts, getSuppliers } from '../api/client.js';
import './purchase.css';

const today = new Date().toISOString().slice(0, 10);
const money = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0)).replace('Rp', 'Rp ');
const emptyLine = () => ({ productId: '', quantity: 1, unitCost: '', serialNumbers: '', condition: 'unknown', notes: '' });

export default function PurchasePage({ onToast }) {
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [lines, setLines] = useState([emptyLine()]);
  const [form, setForm] = useState({ supplierId: '', supplierInvoice: '', purchaseDate: today, paymentMode: 'credit', cashAccountCode: '1110', discountAmount: '' });
  const [supplierForm, setSupplierForm] = useState({ name: '', phone: '', address: '' });
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [loadedProducts, loadedSuppliers, loadedPurchases] = await Promise.all([getProducts('', true), getSuppliers(), getInventoryPurchases()]);
      setProducts(loadedProducts.filter((product) => ['laptop', 'part_copotan'].includes(product.category)));
      setSuppliers(loadedSuppliers);
      setPurchases(loadedPurchases);
    } catch (error) { onToast?.(error.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function updateLine(index, key, value) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line));
  }

  async function saveSupplier(event) {
    event.preventDefault();
    try {
      const supplier = await createSupplier(supplierForm);
      setSuppliers((current) => [...current, supplier].sort((left, right) => left.name.localeCompare(right.name)));
      setForm((current) => ({ ...current, supplierId: supplier.id }));
      setSupplierForm({ name: '', phone: '', address: '' });
      setShowSupplierForm(false);
      onToast?.('Supplier ditambahkan');
    } catch (error) { onToast?.(error.message); }
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        supplierId: Number(form.supplierId),
        discountAmount: Number(form.discountAmount || 0),
        idempotencyKey: `purchase-ui-${crypto.randomUUID()}`,
        items: lines.map((line) => ({
          productId: Number(line.productId),
          quantity: Number(line.quantity),
          unitCost: Number(line.unitCost),
          serialNumbers: line.serialNumbers.split(/[,\n]/).map((serial) => serial.trim()).filter(Boolean),
          condition: line.condition,
          notes: line.notes
        }))
      };
      const purchase = await createInventoryPurchase(payload);
      onToast?.(`Pembelian ${purchase.purchase_number} tersimpan dan jurnal diposting`);
      setLines([emptyLine()]);
      setForm((current) => ({ ...current, supplierInvoice: '', discountAmount: '' }));
      await load();
    } catch (error) { onToast?.(error.message); }
    finally { setSaving(false); }
  }

  return <section className="purchase-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> PEMBELIAN SUPPLIER</div><h1>Barang masuk, <em>tercatat rapi.</em></h1><p>Penerimaan stok sekaligus mencatat persediaan dan utang atau kas.</p></div><button className="button ghost" onClick={load} disabled={loading}><RefreshCw size={15} /> Segarkan</button></div>
    <div className="purchase-layout">
      <form className="panel purchase-form" onSubmit={submit}>
        <div className="panel-header"><div><h2>Pembelian baru</h2><p>Harga di sini adalah biaya perolehan yang dibuktikan supplier.</p></div></div>
        <div className="purchase-fields">
          <label>Supplier<select required value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })}><option value="">Pilih supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
          <button type="button" className="button ghost supplier-add" onClick={() => setShowSupplierForm(!showSupplierForm)}><Plus size={15} /> Supplier baru</button>
          <label>No. invoice<input value={form.supplierInvoice} onChange={(event) => setForm({ ...form, supplierInvoice: event.target.value })} placeholder="Opsional" /></label>
          <label>Tanggal<input required type="date" value={form.purchaseDate} onChange={(event) => setForm({ ...form, purchaseDate: event.target.value })} /></label>
          <label>Metode<select value={form.paymentMode} onChange={(event) => setForm({ ...form, paymentMode: event.target.value })}><option value="credit">Kredit / utang supplier</option><option value="cash">Tunai / bank / QRIS</option></select></label>
          {form.paymentMode === 'cash' && <label>Akun pembayaran<select value={form.cashAccountCode} onChange={(event) => setForm({ ...form, cashAccountCode: event.target.value })}><option value="1110">Kas toko</option><option value="1120">Bank</option><option value="1130">QRIS</option></select></label>}
          <label>Diskon pembelian<input type="number" min="0" value={form.discountAmount} onChange={(event) => setForm({ ...form, discountAmount: event.target.value })} placeholder="0" /></label>
        </div>
        {showSupplierForm && <div className="supplier-inline"><label>Nama supplier<input required value={supplierForm.name} onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })} /></label><label>Telepon<input value={supplierForm.phone} onChange={(event) => setSupplierForm({ ...supplierForm, phone: event.target.value })} /></label><label>Alamat<input value={supplierForm.address} onChange={(event) => setSupplierForm({ ...supplierForm, address: event.target.value })} /></label><button type="button" className="button primary" onClick={saveSupplier}>Simpan supplier</button></div>}
        <div className="purchase-lines"><div className="purchase-lines-heading"><h3>Barang</h3><button type="button" className="button ghost" onClick={() => setLines([...lines, emptyLine()])}><Plus size={15} /> Tambah baris</button></div>{lines.map((line, index) => <div className="purchase-line" key={index}><label>Produk<select required value={line.productId} onChange={(event) => updateLine(index, 'productId', event.target.value)}><option value="">Pilih produk</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.category === 'laptop' ? 'Laptop' : 'Part'}</option>)}</select></label><label>Qty<input required type="number" min="1" value={line.quantity} onChange={(event) => updateLine(index, 'quantity', event.target.value)} /></label><label>Harga/unit<input required type="number" min="1" value={line.unitCost} onChange={(event) => updateLine(index, 'unitCost', event.target.value)} placeholder="Rp" /></label><label>Serial laptop<textarea value={line.serialNumbers} onChange={(event) => updateLine(index, 'serialNumbers', event.target.value)} placeholder="Satu per baris" /></label><label>Kondisi<select value={line.condition} onChange={(event) => updateLine(index, 'condition', event.target.value)}><option value="unknown">Belum dinilai</option><option value="A">A</option><option value="B">B</option><option value="C">C</option></select></label>{lines.length > 1 && <button type="button" className="icon-button bordered danger-icon" onClick={() => setLines(lines.filter((_, lineIndex) => lineIndex !== index))} aria-label="Hapus baris"><Trash2 size={15} /></button>}</div>)}</div>
        <button className="button primary purchase-submit" type="submit" disabled={saving || loading}>{saving ? 'Menyimpan...' : 'Simpan pembelian & posting jurnal'}</button>
      </form>
      <section className="panel purchase-history"><div className="panel-header"><div><h2>Riwayat pembelian</h2><p>{purchases.length} dokumen pembelian</p></div></div><div className="purchase-history-list">{purchases.length ? purchases.map((purchase) => <article key={purchase.id}><div><strong>{purchase.purchase_number}</strong><small>{purchase.purchase_date} · {purchase.supplier_name || purchase.source_label}</small></div><div><strong>{money(purchase.total_amount)}</strong><small>{purchase.payment_mode === 'credit' ? 'Utang supplier' : 'Dibayar'}</small></div><span className="status posted">Posted</span></article>) : <div className="empty-state"><strong>Belum ada pembelian</strong><span>Dokumen supplier yang tersimpan akan tampil di sini.</span></div>}</div></section>
    </div>
  </section>;
}

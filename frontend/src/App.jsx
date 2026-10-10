import { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import QRCode from 'qrcode';
import { changePassword, createCustomer, createProduct, createService, createTransaction, downloadProductImportTemplate, getCustomers, getNotifications, getProducts, getReceipt, getServiceAccess, getServiceOpeningReceipt, getServices, getSettings, getTransactions, importAroniumCustomers, importProducts, login, logout, payTransaction, refundTransaction as issueRefund, updateProduct, updateServiceStatus } from './api/client.js';
import ReceiptPrint from './components/ReceiptPrint.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import UserManagementPage from './components/UserManagementPage.jsx';
import CashLedgerPage from './components/CashLedgerPage.jsx';
import ProductCodeCamera from './components/ProductCodeCamera.jsx';
import './components/serial-scanner.css';
import './components/product-import.css';
import {
  ArrowUpRight,
  Bell,
  Camera,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Eye,
  EyeOff,
  QrCode,
  Laptop,
  FileSpreadsheet,
  Download,
  Minus,
  Plus,
  Pencil,
  Printer,
  Search,
  ScanLine,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  Wrench,
  X
} from 'lucide-react';

const demoProducts = [
  { id: 1, name: 'ThinkPad X1 Carbon Gen 8', brand: 'Lenovo', price: 8750000, stock: 1, grade: 'A', serial: 'PF2K9X1A', category: 'Laptop', spec: 'Core i7 · 16GB · 512GB' },
  { id: 2, name: 'MacBook Pro 13 M1', brand: 'Apple', price: 11900000, stock: 1, grade: 'A', serial: 'FVFG2K3M', category: 'Laptop', spec: 'M1 · 8GB · 256GB' },
  { id: 3, name: 'Aspire 5 A514', brand: 'Acer', price: 4750000, stock: 2, grade: 'B', serial: 'NXA1R2C8', category: 'Laptop', spec: 'Ryzen 5 · 8GB · 512GB' },
  { id: 4, name: 'USB-C 65W Charger', brand: 'Ugreen', price: 325000, stock: 8, grade: 'A', serial: '', category: 'Aksesoris', spec: 'GaN · 65W · Type-C' },
  { id: 5, name: 'Keyboard Wireless K380', brand: 'Logitech', price: 490000, stock: 4, grade: 'A', serial: '', category: 'Aksesoris', spec: 'Bluetooth · Multi-device' }
];

const serviceTickets = [
  { id: 'SRV-240918-07', customer: 'Dimas Pratama', device: 'MacBook Air 2020', issue: 'Tidak bisa charging', status: 'menunggu persetujuan', age: '2 jam' },
  { id: 'SRV-240918-06', customer: 'Nadia Putri', device: 'ASUS VivoBook 14', issue: 'Install ulang + backup', status: 'proses servis', age: 'Hari ini' },
  { id: 'SRV-240917-11', customer: 'Raka Wijaya', device: 'ThinkPad T480', issue: 'Ganti keyboard', status: 'selesai', age: 'Kemarin' }
];

const demoCustomers = [
  { id: 1, name: 'Alya Ramadhani', phone: '0812 8844 1092', tag: 'Member' },
  { id: 2, name: 'Dimas Pratama', phone: '0813 2201 7790', tag: 'Pelanggan lama' },
  { id: 3, name: 'Nadia Putri', phone: '0857 6004 3312', tag: 'Pelanggan lama' }
];

const currency = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const formatPrice = (value) => currency.format(value).replace('Rp', 'Rp ');
const productCategoryLabel = (category) => ({ laptop: 'Laptop', aksesoris: 'Aksesoris', part_copotan: 'Part copotan', gadget: 'Gadget' }[category] || category);
const formatSpecs = (specs = {}) => Object.entries(specs).filter(([key, value]) => key !== 'grade_condition' && !key.endsWith('_note') && value).flatMap(([, value]) => Array.isArray(value) ? value : typeof value === 'object' ? Object.values(value).filter(Boolean) : value).join(' · ') || 'Spesifikasi belum diisi';
const pageTitle = (page) => ({ kasir: 'Kasir baru', servis: 'Antrian servis', riwayat: 'Riwayat transaksi', inventori: 'Inventori', pelanggan: 'Pelanggan', kas: 'Kas toko', pengaturan: 'Pengaturan', users: 'Manajemen user', user: 'Profil pengguna' }[page] || 'Workspace');
const escapePrintText = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function printReceipt(receipt) {
  if (!receipt) return;
  const printWindow = window.open('', '_blank', 'width=420,height=700');
  if (!printWindow) return;
  const items = receipt.items || [];
  const paperWidth = receipt.paper_size_preference === 'A4' ? '794px' : receipt.paper_size_preference === '80mm' ? '302px' : '219px';
  const remainingAmount = Math.max(0, Number(receipt.grand_total || 0) - Number(receipt.paid_amount || 0));
  const paymentRows = receipt.transaction_type === 'servis' ? `<div class="row"><span>Down Payment / DP</span><span>${formatPrice(receipt.paid_amount)}</span></div><div class="row"><span>Sisa pembayaran</span><span>${formatPrice(remainingAmount)}</span></div>` : `<div class="row"><span>Bayar</span><span>${formatPrice(receipt.paid_amount)}</span></div>`;
  printWindow.document.write(`<html><head><title>${escapePrintText(receipt.invoice_number)}</title><style>body{font:12px monospace;width:${paperWidth};margin:20px auto;color:#111}h1{text-align:center;font-size:16px;margin:0 0 5px}.center{text-align:center}.line{border-top:1px dashed #111;margin:10px 0}.row{display:flex;justify-content:space-between;gap:10px;margin:5px 0}.item{margin:8px 0}.serial{font-size:10px;color:#555}strong{font-size:14px}@media print{body{margin:0;width:${paperWidth}}}</style></head><body><h1>${escapePrintText(receipt.store_name || 'LAPAK LAPTOP')}</h1><div class="center">${escapePrintText(receipt.store_address || '')}<br>${escapePrintText(receipt.store_phone || '')}</div><div class="line"></div><div>Invoice: ${escapePrintText(receipt.invoice_number)}</div><div>${escapePrintText(receipt.created_at || new Date().toLocaleString('id-ID'))}</div><div>Pelanggan: ${escapePrintText(receipt.customer_name || 'Umum')}</div><div class="line"></div>${items.map((item) => `<div class="item"><div>${escapePrintText(item.name)}</div>${item.serial_number ? `<div class="serial">SN: ${escapePrintText(item.serial_number)}</div>` : ''}<div class="row"><span>${item.qty} x ${formatPrice(item.price)}</span><span>${formatPrice(item.subtotal)}</span></div></div>`).join('')}<div class="line"></div><div class="row"><span>Subtotal</span><span>${formatPrice(receipt.subtotal)}</span></div><div class="row"><span>Diskon</span><span>-${formatPrice(receipt.direct_discount)}</span></div><div class="row"><span>Ongkir</span><span>${formatPrice(receipt.shipping_cost)}</span></div><div class="row"><strong>Total</strong><strong>${formatPrice(receipt.grand_total)}</strong></div>${paymentRows}<div class="row"><span>Kembali</span><span>${formatPrice(receipt.change_amount)}</span></div><div class="line"></div><div class="center">${escapePrintText(receipt.receipt_footer_text || '')}<br><br>${escapePrintText(receipt.receipt_closing_text || '')}</div></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

async function printProductLabel(product) {
  const printWindow = window.open('', '_blank', 'width=420,height=320');
  if (!printWindow) return;
  try {
    const code = `POS:${product.id}`;
    const qr = await QRCode.toDataURL(code, { width: 240, margin: 1, errorCorrectionLevel: 'M' });
    printWindow.document.write(`<html><head><title>Label ${escapePrintText(product.name)}</title><style>@page{size:50mm 30mm;margin:0}*{box-sizing:border-box}body{width:50mm;height:30mm;margin:0;padding:2mm;font:7pt Arial,sans-serif;display:flex;align-items:center;gap:2mm;color:#111}.qr{width:24mm;height:24mm}.info{min-width:0;flex:1}.name{font-size:8pt;font-weight:bold;max-height:10mm;overflow:hidden}.brand{margin-top:1mm;color:#444}.price{margin-top:2mm;font-size:9pt;font-weight:bold}.code{margin-top:1mm;font-size:6pt}</style></head><body><img class="qr" src="${qr}"/><div class="info"><div class="name">${escapePrintText(product.name)}</div><div class="brand">${escapePrintText(product.brand || '')}</div><div class="price">${formatPrice(product.selling_price ?? product.price)}</div><div class="code">${escapePrintText(code)}</div></div></body></html>`);
    printWindow.onload = () => printWindow.print();
    printWindow.document.close();
  } catch (error) {
    printWindow.close();
    throw error;
  }
}

function App() {
  const [authUser, setAuthUser] = useState(() => JSON.parse(localStorage.getItem('pos_user') || 'null'));
  if (!authUser) return <LoginView onLogin={setAuthUser} />;
  return <MainApp authUser={authUser} onAuthUserUpdated={setAuthUser} onLogout={async () => { try { await logout(); } catch {} localStorage.removeItem('pos_token'); localStorage.removeItem('pos_user'); setAuthUser(null); }} />;
}

function MainApp({ authUser, onAuthUserUpdated, onLogout }) {
  const can = (...roles) => roles.includes(authUser.role);
  const [activePage, setActivePage] = useState(authUser.role === 'teknisi' ? 'servis' : 'kasir');
  const [products, setProducts] = useState([]);
  const [inventoryProducts, setInventoryProducts] = useState([]);
  const [loadedServiceTickets, setServiceTickets] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [cart, setCart] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [discount, setDiscount] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [tradeIn, setTradeIn] = useState(null);
  const [showTradeIn, setShowTradeIn] = useState(false);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [toast, setToast] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paidAmount, setPaidAmount] = useState(0);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [returnToServiceAfterCustomer, setReturnToServiceAfterCustomer] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [settlementTransaction, setSettlementTransaction] = useState(null);
  const [refundTarget, setRefundTarget] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [storeSettings, setStoreSettings] = useState({ opening_time: '09:00', closing_time: '21:00' });
  const [serviceQuote, setServiceQuote] = useState(null);

  useEffect(() => {
    Promise.all([getProducts(), getProducts('', true), can('admin', 'kasir') ? getCustomers() : Promise.resolve([]), getServices(), can('admin', 'kasir') ? getTransactions() : Promise.resolve([]), getNotifications()]).then(([loadedProducts, loadedInventory, loadedCustomers, loadedServices, loadedTransactions, loadedNotifications]) => {
      const normalizedProducts = loadedProducts.map((item) => ({ ...item, price: item.selling_price, grade: item.grade_condition, serial: item.serial_number || '', category: productCategoryLabel(item.category), spec: formatSpecs(item.specs) }));
      const normalizedInventory = loadedInventory.map((item) => ({ ...item, price: item.selling_price, grade: item.grade_condition, serial: item.serial_number || '', category: productCategoryLabel(item.category), spec: formatSpecs(item.specs) }));
      setProducts(normalizedProducts);
      setInventoryProducts(normalizedInventory);
      setCustomers(loadedCustomers);
      setCustomer(loadedCustomers[0] || null);
      setServiceTickets(loadedServices.map((item) => ({ ...item, serviceId: item.id, customerId: item.customer_id, id: item.ticket_number, customer: item.customer_name, device: item.device_name, issue: item.issues, status: item.status.replaceAll('_', ' ') })));
      setTransactions(loadedTransactions);
      setNotifications(loadedNotifications);
    }).catch((error) => setToast(error.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { getSettings().then(setStoreSettings).catch(() => {}); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const todayTransactions = transactions.filter((transaction) => transaction.created_at?.slice(0, 10) === today);
  const todaySalesTotal = todayTransactions.reduce((total, transaction) => total + Number(transaction.grand_total || 0), 0);
  const activeServiceTickets = loadedServiceTickets.filter((ticket) => !['selesai', 'diambil', 'batal gagal'].includes(ticket.status));
  const approvalServiceTickets = loadedServiceTickets.filter((ticket) => ticket.status === 'menunggu persetujuan');

  const filteredProducts = products.filter((product) => {
    const query = searchTerm.toLowerCase();
    return (!category || product.category === category) && (product.name.toLowerCase().includes(query) || product.serial.toLowerCase().includes(query) || product.brand.toLowerCase().includes(query));
  });

  const filteredCustomers = customers.filter((item) => `${item.name} ${item.phone}`.toLowerCase().includes(customerSearch.toLowerCase()));
  const subtotal = cart.reduce((total, item) => total + item.price * item.qty, 0);
  const total = Math.max(0, subtotal - discount + shipping - (tradeIn?.value || 0));

  function addToCart(product) {
    const existing = cart.find((item) => item.id === product.id);
    if (existing) {
      if (existing.qty >= product.stock) return setToast('Jumlah melebihi stok tersedia');
      setCart(cart.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item));
    } else setCart([...cart, { ...product, qty: 1 }]);
    setToast(`${product.name} ditambahkan`);
  }

  function addScannedProduct(rawCode) {
    const code = String(rawCode || '').trim();
    const productId = code.match(/^POS:(\d+)$/i)?.[1];
    const product = products.find((item) => productId ? String(item.id) === productId : String(item.serial || '').toLowerCase() === code.toLowerCase());
    if (!product) return setToast(`Produk dengan kode ${code} tidak ditemukan`);
    if (product.stock < 1) return setToast(`${product.name} sedang habis`);
    addToCart(product);
  }

  function removeFromCart(id) {
    setCart(cart.filter((item) => item.id !== id));
  }

  function changeQuantity(id, delta) {
    setCart((current) => current.map((item) => item.id !== id ? item : { ...item, qty: Math.max(1, Math.min(item.stock, item.qty + delta)) }));
  }

  async function completePayment() {
    if (!cart.length || !customer) return setToast('Pilih pelanggan dan minimal satu barang');
    try {
      const result = await createTransaction({ customer_id: customer.id, transaction_type: tradeIn ? 'tukar_tambah' : 'penjualan', direct_discount: discount, shipping_cost: shipping, paid_amount: paidAmount > 0 ? paidAmount : null, payment_method: paymentMethod, payment_status: paidAmount > 0 && paidAmount < total ? 'dp' : 'lunas', items: [...cart.map((item) => ({ item_type: 'product', reference_id: item.id, qty: item.qty })), ...(tradeIn ? [{ item_type: 'trade_in', name: tradeIn.name, category: tradeIn.category, price: tradeIn.value, selling_price: tradeIn.sellingPrice, qty: 1 }] : [])] });
      setToast(`Transaksi tersimpan · ${result.invoice_number}`);
      const completeReceipt = await getReceipt(result.id);
      setReceipt(completeReceipt);
      setTransactions((current) => [result, ...current]);
      printReceipt(completeReceipt);
      const tradeInItem = result.items?.find((item) => item.item_type === 'trade_in');
      if (tradeInItem) {
        const incomingProduct = { id: tradeInItem.reference_id, category: productCategoryLabel(tradeIn.category), name: tradeIn.name, brand: '', specs: {}, serial_number: null, grade_condition: 'B', cost_price: tradeIn.value, selling_price: tradeIn.sellingPrice, stock: tradeInItem.qty, notes: `Barang masuk dari tukar tambah ${result.invoice_number}`, price: tradeIn.sellingPrice, grade: 'B', serial: '', spec: 'Spesifikasi belum diisi' };
        setProducts((current) => [incomingProduct, ...current]);
        setInventoryProducts((current) => [incomingProduct, ...current]);
      }
      setCart([]); setDiscount(0); setShipping(0); setTradeIn(null); setPaidAmount(0);
      setProducts((current) => current.map((item) => { const sold = cart.find((entry) => entry.id === item.id); return sold ? { ...item, stock: item.stock - sold.qty } : item; }).filter((item) => item.stock > 0));
      setInventoryProducts((current) => current.map((item) => { const sold = cart.find((entry) => entry.id === item.id); return sold ? { ...item, stock: item.stock - sold.qty } : item; }));
    } catch (error) { setToast(error.message); }
  }

  async function saveProduct(payload) {
    try {
      const saved = editingProduct ? await updateProduct(editingProduct.id, payload) : await createProduct(payload);
      const normalized = { ...saved, price: saved.selling_price, grade: saved.grade_condition, serial: saved.serial_number || '', category: productCategoryLabel(saved.category), spec: formatSpecs(saved.specs) };
      if (editingProduct) {
        setProducts((current) => current.map((item) => item.id === normalized.id ? normalized : item));
        setInventoryProducts((current) => current.map((item) => item.id === normalized.id ? normalized : item));
      } else {
        setProducts((current) => [normalized, ...current]); setInventoryProducts((current) => [normalized, ...current]);
      }
      setEditingProduct(null); setModal(null); setToast(editingProduct ? 'Produk berhasil diperbarui' : 'Produk berhasil ditambahkan');
    } catch (error) { setToast(error.message); }
  }

  async function importProductFile(file) {
    try {
      const result = await importProducts(file);
      const storedOptions = JSON.parse(localStorage.getItem('pos_custom_spec_options') || '{}');
      for (const product of result.products) {
        for (const group of specificationPresets) {
          const value = product.specs?.[group.key];
          if (group.fields || value === undefined || value === null || value === '') continue;
          const importedOptions = Array.isArray(value) ? value : [value];
          const builtIn = new Set((group.options || []).map((option) => String(option).trim().toLowerCase()));
          const existingOptions = storedOptions[group.key] || [];
          storedOptions[group.key] = uniqueSpecificationOptions([...existingOptions, ...importedOptions.map(String)]).filter((option) => !builtIn.has(option.trim().toLowerCase()));
        }
      }
      localStorage.setItem('pos_custom_spec_options', JSON.stringify(storedOptions));
      const normalized = result.products.map((item) => ({ ...item, price: item.selling_price, grade: item.grade_condition, serial: item.serial_number || '', category: productCategoryLabel(item.category), spec: formatSpecs(item.specs) }));
      const mergeProducts = (current) => { const importedIds = new Set(normalized.map((item) => item.id)); return [...normalized, ...current.filter((item) => !importedIds.has(item.id))]; };
      setProducts(mergeProducts);
      setInventoryProducts(mergeProducts);
      setToast(`${result.imported} produk berhasil diimport${result.skipped ? `, ${result.skipped} baris dilewati karena sudah ada` : ''}`);
    } catch (error) { setToast(error.message); }
  }

  async function downloadProductTemplate() {
    try { await downloadProductImportTemplate(); } catch (error) { setToast(error.message); }
  }

  async function saveCustomer(payload) {
    try {
      const saved = await createCustomer(payload);
      setCustomers((current) => [saved, ...current]); setCustomer(saved); setModal(returnToServiceAfterCustomer ? 'service' : null); setReturnToServiceAfterCustomer(false); setToast('Pelanggan berhasil ditambahkan');
    } catch (error) { setToast(error.message); }
  }

  async function importAroniumCustomerFile(file) {
    try {
      const result = await importAroniumCustomers(file);
      if (result.customers.length) setCustomers((current) => [...result.customers, ...current]);
      setToast(`${result.imported} pelanggan diimpor, ${result.skipped} duplikat dilewati, ${result.ignored} baris tidak diimpor`);
    } catch (error) { setToast(error.message); }
  }

  async function saveService(payload) {
    try {
      const saved = await createService(payload);
      const openingReceipt = await getServiceOpeningReceipt(saved.id);
      setReceipt(openingReceipt); printReceipt(openingReceipt);
      setServiceTickets((current) => [{ ...saved, serviceId: saved.id, customerId: saved.customer_id, id: saved.ticket_number, customer: customer?.name || 'Pelanggan', device: saved.device_name, issue: saved.issues, status: saved.status.replaceAll('_', ' ') }, ...current]); setModal(null); setToast(`Tiket ${saved.ticket_number} berhasil dibuat dan nota awal dicetak`);
    } catch (error) { setToast(error.message); }
  }

  async function changeServiceStatus(serviceId, currentStatus, ticket) {
    const next = { antrean: 'pengecekan', pengecekan: 'menunggu_persetujuan', 'menunggu persetujuan': 'proses_servis', 'proses servis': 'selesai', selesai: 'diambil' }[currentStatus];
    if (!next) return setToast('Tiket sudah berada di status akhir');
    if (next === 'menunggu_persetujuan') return setServiceQuote({ serviceId, ticket });
    const payload = { status: next };
    try {
      const updated = await updateServiceStatus(serviceId, payload);
      setServiceTickets((current) => current.map((ticket) => ticket.serviceId === serviceId ? { ...ticket, status: updated.status.replaceAll('_', ' ') } : ticket));
      setToast(`Status tiket diubah ke ${next.replaceAll('_', ' ')}`);
      if (next === 'selesai' && ticket) {
        const downPayment = Number(ticket.down_payment || 0);
        const paymentStatus = downPayment <= 0 ? 'bayar_nanti' : downPayment >= Number(updated.final_cost || 0) ? 'lunas' : 'dp';
        const transaction = await createTransaction({ customer_id: ticket.customerId, transaction_type: 'servis', paid_amount: downPayment, payment_status: paymentStatus, payment_method: 'cash', items: [{ item_type: 'service', reference_id: serviceId, name: `Servis ${ticket.device}`, price: updated.final_cost, qty: 1 }] });
        const serviceReceipt = await getReceipt(transaction.id); setReceipt(serviceReceipt); printReceipt(serviceReceipt);
      }
    } catch (error) { setToast(error.message); }
  }

  async function submitServiceQuote({ diagnosis, final_cost }) {
    try {
      const updated = await updateServiceStatus(serviceQuote.serviceId, { status: 'menunggu_persetujuan', diagnosis, final_cost: Number(final_cost) });
      setServiceTickets((current) => current.map((ticket) => ticket.serviceId === serviceQuote.serviceId ? { ...ticket, status: updated.status.replaceAll('_', ' ') } : ticket));
      setServiceQuote(null); setToast('Quote servis dikirim untuk persetujuan customer');
    } catch (error) { setToast(error.message); }
  }

  async function cancelService(serviceId) {
    const reason = window.prompt('Alasan customer membatalkan servis:');
    if (!reason) return;
    try { await updateServiceStatus(serviceId, { status: 'batal_gagal', cancellation_reason: reason }); setServiceTickets((current) => current.map((ticket) => ticket.serviceId === serviceId ? { ...ticket, status: 'batal gagal' } : ticket)); setToast('Tiket servis dibatalkan'); } catch (error) { setToast(error.message); }
  }

  async function reprintTransaction(transaction) {
    try { setReceipt(await getReceipt(transaction.id)); } catch (error) { setToast(error.message); }
  }

  async function settleTransaction(transaction, amount) {
    const remaining = Math.max(0, Number(transaction.grand_total || 0) - Number(transaction.paid_amount || 0));
    if (amount === undefined) return remaining > 0 ? setSettlementTransaction(transaction) : setToast('Transaksi ini tidak memiliki sisa tagihan');
    if (!remaining || Number(amount) <= 0) return setToast('Nominal pelunasan tidak valid');
    try { 
      const updated = await payTransaction(transaction.id, Number(amount)); 
      setTransactions((current) => current.map((item) => item.id === updated.id ? updated : item)); 
      setSettlementTransaction(null);
      setReceipt(await getReceipt(updated.id)); 
      setToast(`Pembayaran ${updated.payment_status}`); 
    } catch (error) { 
      setToast(error.message || 'Gagal melunasi'); 
    }
  }

  async function submitRefund(transaction, reason) {
    try {
      const updated = await issueRefund(transaction.id, reason);
      setTransactions((current) => current.map((item) => item.id === updated.id ? updated : item));
      setRefundTarget(null);
      setToast(`Refund dicatat · ${formatPrice(updated.refund_amount)}`);
      return true;
    } catch (error) {
      setToast(error.message || 'Refund gagal diproses');
      return false;
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><Laptop size={20} strokeWidth={2.5} /></div>
          <div><strong>lapak.</strong><span>laptop second</span></div>
        </div>
        <div className="store-status"><span className="pulse-dot" /> Toko buka <span className="status-time">{storeSettings.opening_time}–{storeSettings.closing_time}</span></div>
        <nav className="primary-nav" aria-label="Navigasi utama">
          <p className="nav-label">Workspace</p>
          {can('admin', 'kasir') && <NavButton icon={<ShoppingCart size={18} />} label="Kasir" active={activePage === 'kasir'} onClick={() => setActivePage('kasir')} />}
          {can('admin', 'kasir', 'teknisi') && <NavButton icon={<Wrench size={18} />} label="Servis" active={activePage === 'servis'} onClick={() => setActivePage('servis')} badge={activeServiceTickets.length ? String(activeServiceTickets.length) : undefined} />}
          {can('admin', 'kasir') && <NavButton icon={<ClipboardList size={18} />} label="Riwayat transaksi" active={activePage === 'riwayat'} onClick={() => setActivePage('riwayat')} />}
          <p className="nav-label secondary-label">Kelola</p>
          {can('admin', 'kasir', 'teknisi') && <NavButton icon={<ShoppingBag size={18} />} label="Inventori" active={activePage === 'inventori'} onClick={() => setActivePage('inventori')} />}
          {can('admin', 'kasir') && <NavButton icon={<UsersRound size={18} />} label="Pelanggan" active={activePage === 'pelanggan'} onClick={() => setActivePage('pelanggan')} />}
          {can('admin', 'kasir') && <NavButton icon={<CircleDollarSign size={18} />} label="Kas toko" active={activePage === 'kas'} onClick={() => setActivePage('kas')} />}
          {can('admin') && <NavButton icon={<UsersRound size={18} />} label="User & akses" active={activePage === 'users'} onClick={() => setActivePage('users')} />}
        </nav>
        <div className="sidebar-bottom">
          <div className="mini-metric"><span>Penjualan hari ini</span><strong>{formatPrice(todaySalesTotal)}</strong><small><ArrowUpRight size={13} /> {todayTransactions.length} transaksi tercatat</small></div>
          {can('admin') && <NavButton icon={<Settings size={18} />} label="Pengaturan" active={activePage === 'pengaturan'} onClick={() => setActivePage('pengaturan')} />}
          <button className="profile" onClick={() => setActivePage('user')}><div className="avatar">{authUser.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</div><div><strong>{authUser.name}</strong><span>{authUser.role}</span></div><ChevronDown size={16} /></button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{pageTitle(activePage)}</strong></div>
          <div className="topbar-actions"><div className="notification-wrap"><button className="icon-button" aria-label="Notifikasi" onClick={() => setShowNotifications(!showNotifications)}><Bell size={19} />{notifications.length > 0 && <i />}</button>{showNotifications && <NotificationPanel notifications={notifications} onClose={() => setShowNotifications(false)} />}</div><div className="date-chip">{new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date())}</div></div>
        </header>
        {activePage === 'kasir' && can('admin', 'kasir') ? (
          <CashierView {...{ cart, customer, searchTerm, setSearchTerm, filteredProducts, addToCart, addScannedProduct, removeFromCart, changeQuantity, customerSearch, setCustomerSearch, filteredCustomers, showCustomerPicker, setShowCustomerPicker, setCustomer, subtotal, discount, setDiscount, shipping, setShipping, tradeIn, setTradeIn, showTradeIn, setShowTradeIn, total, paidAmount, setPaidAmount, completePayment, paymentMethod, setPaymentMethod, category, setCategory, loading, todayTransactionCount: todayTransactions.length, todaySalesTotal, activeServiceCount: activeServiceTickets.length, approvalServiceCount: approvalServiceTickets.length, openProductModal: () => { setEditingProduct(null); setModal('product'); }, openCustomerModal: () => setModal('customer') }} />
        ) : activePage === 'servis' && can('admin', 'kasir', 'teknisi') ? <ServiceView serviceTickets={loadedServiceTickets} setToast={setToast} onChangeStatus={can('admin', 'teknisi') ? changeServiceStatus : undefined} onCancelStatus={can('admin', 'teknisi') ? cancelService : undefined} canCreate={can('admin', 'kasir')} canManage={can('admin', 'teknisi')} openServiceModal={() => setModal('service')} />
            : activePage === 'riwayat' && can('admin', 'kasir') ? <TransactionHistory transactions={transactions} onPrint={reprintTransaction} onSettle={settleTransaction} onRefund={setRefundTarget} />
            : activePage === 'inventori' ? <InventoryView products={inventoryProducts} openProductModal={can('admin', 'kasir') ? () => { setEditingProduct(null); setModal('product'); } : undefined} onEditProduct={can('admin', 'kasir') ? (product) => { setEditingProduct(product); setModal('product'); } : undefined} onPrintLabel={can('admin', 'kasir') ? printProductLabel : undefined} onImportProducts={can('admin', 'kasir') ? importProductFile : undefined} onDownloadTemplate={can('admin', 'kasir') ? downloadProductTemplate : undefined} />
              : activePage === 'pelanggan' && can('admin', 'kasir') ? <CustomerView customers={customers} openCustomerModal={can('admin', 'kasir') ? () => setModal('customer') : undefined} onImportCustomers={can('admin', 'kasir') ? importAroniumCustomerFile : undefined} />
                : activePage === 'kas' && can('admin', 'kasir') ? <CashLedgerPage onToast={setToast} />
                : activePage === 'users' && can('admin') ? <UserManagementPage currentUser={authUser} onCurrentUserUpdated={(user) => { localStorage.setItem('pos_user', JSON.stringify(user)); onAuthUserUpdated(user); }} onToast={setToast} />
                : activePage === 'pengaturan' && can('admin') ? <SettingsPage onSaved={(message, settings) => { setToast(message); if (settings) setStoreSettings(settings); }} />
                  : <UserView authUser={authUser} onLogout={onLogout} />}
        {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} onPrint={() => printReceipt(receipt)} />}
        {settlementTransaction && <SettlementModal transaction={settlementTransaction} onClose={() => setSettlementTransaction(null)} onSave={(amount) => settleTransaction(settlementTransaction, amount)} />}
        {refundTarget && <RefundModal transaction={refundTarget} onClose={() => setRefundTarget(null)} onSave={(reason) => submitRefund(refundTarget, reason)} />}
        {modal === 'product' && <ProductModal product={editingProduct} onClose={() => { setEditingProduct(null); setModal(null); }} onSave={saveProduct} />}
        {modal === 'customer' && <CustomerModal onClose={() => setModal(null)} onSave={saveCustomer} />}
        {modal === 'service' && can('admin', 'kasir') && <ServiceModal customers={customers} customer={customer} onClose={() => { setModal(null); setReturnToServiceAfterCustomer(false); }} onSave={saveService} onAddCustomer={() => { setReturnToServiceAfterCustomer(true); setModal('customer'); }} />}
        {serviceQuote && <ServiceQuoteModal ticket={serviceQuote.ticket} onClose={() => setServiceQuote(null)} onSave={submitServiceQuote} />}
        {toast && <button className="toast" onClick={() => setToast('')}>{toast}<X size={14} /></button>}
      </main>
    </div>
  );
}

function NavButton({ icon, label, active, onClick, badge }) {
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}><span>{icon}</span>{label}{badge && <b>{badge}</b>}</button>;
}

function CashierView(props) {
  const { cart, customer, searchTerm, setSearchTerm, filteredProducts, addToCart, addScannedProduct, removeFromCart, changeQuantity, customerSearch, setCustomerSearch, filteredCustomers, showCustomerPicker, setShowCustomerPicker, setCustomer, subtotal, discount, setDiscount, shipping, setShipping, tradeIn, setTradeIn, showTradeIn, setShowTradeIn, total, paidAmount, setPaidAmount, completePayment, paymentMethod, setPaymentMethod, category, setCategory, loading, todayTransactionCount, todaySalesTotal, activeServiceCount, approvalServiceCount, openProductModal, openCustomerModal } = props;
  const [scanCode, setScanCode] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [productPage, setProductPage] = useState(1);
  const [productPageSize, setProductPageSize] = useState(8);
  const productPageCount = Math.max(1, Math.ceil(filteredProducts.length / productPageSize));
  const currentProductPage = Math.min(productPage, productPageCount);
  const visibleProducts = filteredProducts.slice((currentProductPage - 1) * productPageSize, currentProductPage * productPageSize);
  function submitScan(event) { event.preventDefault(); const code = scanCode.trim(); if (!code) return; addScannedProduct(code); setScanCode(''); }
  function detectedCode(code) { addScannedProduct(code); setCameraOpen(false); }
  return <>
    <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> TRANSAKSI BARU</div><h1>Mulai penjualan <em>hari ini.</em></h1><p>Tambahkan barang ke keranjang, pilih pelanggan, lalu selesaikan pembayaran.</p></div><div className="heading-actions"><button className="button ghost" onClick={() => window.print()}><Printer size={16} /> Cetak laporan</button><button className="button primary" onClick={openProductModal}><Plus size={17} /> Produk baru</button></div></section>
    <div className="stats-row"><StatCard label="Transaksi hari ini" value={todayTransactionCount} detail="Transaksi tercatat" icon={<CircleDollarSign size={19} />} accent="green" /><StatCard label="Nilai penjualan" value={formatPrice(todaySalesTotal)} detail="Total transaksi hari ini" icon={<ArrowUpRight size={19} />} accent="yellow" /><StatCard label="Servis aktif" value={activeServiceCount} detail={`${approvalServiceCount} perlu persetujuan`} icon={<Wrench size={19} />} accent="coral" /></div>
    <div className="workspace-grid">
      <section className="catalog-panel panel">
        <div className="panel-header"><div><h2>Pilih barang</h2><p>{filteredProducts.length} barang tersedia untuk dijual</p></div><div className="filter-pill"><span className="filter-dot" /> {category || 'Semua kategori'} <ChevronDown size={14} /></div></div>
        <div className="search-field large"><Search size={18} /><input value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setProductPage(1); }} placeholder="Cari nama, brand, atau serial number..." /><kbd>⌘ K</kbd></div>
        <form className="cashier-scan-row" onSubmit={submitScan}><ScanLine size={17} /><input autoComplete="off" value={scanCode} onChange={(event) => setScanCode(event.target.value)} placeholder="Scan QR/barcode atau serial number" /><button type="button" className="button ghost" onClick={() => setCameraOpen((open) => !open)}><Camera size={15} /> Kamera</button><button type="submit" className="button primary">Pilih</button></form>
        {cameraOpen && <ProductCodeCamera onDetected={detectedCode} onClose={() => setCameraOpen(false)} />}
        <div className="category-tabs"><button className={!category ? 'selected' : ''} onClick={() => { setCategory(''); setProductPage(1); }}>Semua <span>{filteredProducts.length}</span></button><button className={category === 'Laptop' ? 'selected' : ''} onClick={() => { setCategory('Laptop'); setProductPage(1); }}>Laptop</button><button className={category === 'Aksesoris' ? 'selected' : ''} onClick={() => { setCategory('Aksesoris'); setProductPage(1); }}>Aksesoris</button><button className={category === 'Part copotan' ? 'selected' : ''} onClick={() => { setCategory('Part copotan'); setProductPage(1); }}>Part copotan</button><button className={category === 'Gadget' ? 'selected' : ''} onClick={() => { setCategory('Gadget'); setProductPage(1); }}>Gadget</button></div>
        <div className="product-list">{loading ? <div className="empty-cart">Memuat inventori...</div> : visibleProducts.map((product) => <ProductRow key={product.id} product={product} onAdd={() => addToCart(product)} />)}</div>
        {!loading && filteredProducts.length > 0 && <div className="inventory-pagination cashier-pagination"><label className="inventory-page-size">Tampilkan<select aria-label="Barang per halaman" value={productPageSize} onChange={(event) => { setProductPageSize(Number(event.target.value)); setProductPage(1); }}><option value="8">8</option><option value="16">16</option><option value="32">32</option></select></label><span className="inventory-page-status">Halaman {currentProductPage} dari {productPageCount}</span><div className="inventory-page-buttons"><button type="button" className="icon-button bordered" aria-label="Halaman barang sebelumnya" disabled={currentProductPage <= 1} onClick={() => setProductPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} /></button><button type="button" className="icon-button bordered" aria-label="Halaman barang berikutnya" disabled={currentProductPage >= productPageCount} onClick={() => setProductPage((value) => Math.min(productPageCount, value + 1))}><ChevronRight size={16} /></button></div></div>}
      </section>
      <section className="checkout-panel panel">
        <div className="panel-header checkout-title"><div><h2>Keranjang <span className="count-badge">{cart.length}</span></h2><p>INV-240918-018 · Draft</p></div><button className="text-button" onClick={() => cart.forEach((item) => removeFromCart(item.id))}>Kosongkan</button></div>
        <div className="customer-select" onClick={() => setShowCustomerPicker(!showCustomerPicker)}><div className="customer-avatar"><UserRound size={17} /></div><div className="customer-info"><span>Pelanggan</span><strong>{customer?.name || 'Pilih pelanggan'}</strong></div><ChevronDown size={17} />{showCustomerPicker && <div className="customer-popover" onClick={(event) => event.stopPropagation()}><div className="search-field"><Search size={15} /><input autoFocus value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Cari nama atau nomor..." /></div>{filteredCustomers.map((item) => <button key={item.id} className="customer-option" onClick={() => { setCustomer(item); setShowCustomerPicker(false); }}><div className="avatar small">{item.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</div><div><strong>{item.name}</strong><span>{item.phone}</span></div><small>{item.tag || 'Pelanggan'}</small></button>)}<button className="new-customer" onClick={openCustomerModal}><Plus size={15} /> Tambah pelanggan baru</button></div>}</div>
        <div className="cart-items">{cart.length ? cart.map((item) => <CartItem key={item.id} item={item} onRemove={() => removeFromCart(item.id)} onChangeQuantity={(delta) => changeQuantity(item.id, delta)} />) : <div className="empty-cart"><ShoppingCart size={27} /><strong>Keranjang masih kosong</strong><span>Pilih barang di sebelah kiri untuk mulai.</span></div>}</div>
        <div className="adjustments"><button className={`adjustment-row ${tradeIn ? 'filled' : ''}`} onClick={() => setShowTradeIn(!showTradeIn)}><span><Smartphone size={16} /> Tukar tambah {tradeIn && <b>1 barang</b>}</span><span>{tradeIn ? `-${formatPrice(tradeIn.value)}` : <Plus size={16} />}</span></button>{showTradeIn && <TradeInForm onSave={(name, value, category, sellingPrice) => { setTradeIn({ name, value: Number(value), category, sellingPrice: Number(sellingPrice) }); setShowTradeIn(false); }} onCancel={() => setShowTradeIn(false)} />}</div>
        <div className="totals"><div><span>Subtotal</span><strong>{formatPrice(subtotal)}</strong></div><div className="input-total"><span>Potongan nego</span><label>Rp <input type="number" min="0" value={discount || ''} onChange={(event) => setDiscount(Number(event.target.value))} placeholder="0" /></label></div><div className="input-total"><span>Ongkos kirim</span><label>Rp <input type="number" min="0" value={shipping || ''} onChange={(event) => setShipping(Number(event.target.value))} placeholder="0" /></label></div><div className="grand-total"><span>Total bayar</span><strong>{formatPrice(total)}</strong></div></div>
        <div className="payment-methods"><span>Metode pembayaran</span><div>{['cash', 'transfer', 'qris'].map((method) => <button key={method} className={`payment ${paymentMethod === method ? 'active' : ''}`} onClick={() => setPaymentMethod(method)}>{method.toUpperCase()}</button>)}</div><label className="paid-input">Nominal bayar <input type="number" min="0" value={paidAmount || ''} onChange={(event) => setPaidAmount(Number(event.target.value))} placeholder={String(total)} /></label></div><button className="checkout-button" onClick={completePayment}>Bayar {formatPrice(total)} <ArrowUpRight size={18} /></button>
      </section>
    </div>
  </>;
}

function StatCard({ label, value, detail, icon, accent }) { return <div className={`stat-card ${accent}`}><div className="stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>; }

function ProductRow({ product, onAdd }) { return <div className="product-row"><div className={`product-thumb ${product.category === 'Aksesoris' ? 'accessory' : ''}`}><Laptop size={27} /></div><div className="product-details"><div><strong>{product.name}</strong></div><small>{product.brand} · {product.spec}</small><span className="serial">{product.serial || 'Tanpa serial number'}</span></div><div className="product-price"><strong>{formatPrice(product.price)}</strong><span>{product.stock} stok</span></div><button className="add-button" onClick={onAdd} aria-label={`Tambah ${product.name}`}><Plus size={17} /></button></div>; }

function CartItem({ item, onRemove, onChangeQuantity }) { return <div className="cart-item"><div className="cart-thumb"><Laptop size={19} /></div><div className="cart-item-info"><strong>{item.name}</strong><span>{item.serial || item.spec}</span><b>{formatPrice(item.price * item.qty)}</b></div><div className="quantity"><button onClick={() => onChangeQuantity(-1)}><Minus size={13} /></button><span>{item.qty}</span><button onClick={() => onChangeQuantity(1)}><Plus size={13} /></button></div><button className="remove-button" onClick={onRemove} aria-label={`Hapus ${item.name}`}><Trash2 size={15} /></button></div>; }

function TradeInForm({ onSave, onCancel }) { const [name, setName] = useState(''); const [value, setValue] = useState(''); const [category, setCategory] = useState('gadget'); const [sellingPrice, setSellingPrice] = useState(''); return <div className="trade-form"><div><label>Perangkat masuk</label><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Contoh: iPad 11 (A16)" /><label>Kategori inventori</label><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="gadget">Gadget</option><option value="laptop">Laptop</option><option value="aksesoris">Aksesoris</option><option value="part_copotan">Part copotan</option></select><label>Harga taksiran / modal</label><div className="money-input"><span>Rp</span><input type="number" min="0" value={value} onChange={(event) => setValue(event.target.value)} placeholder="0" /></div><label>Harga jual</label><div className="money-input"><span>Rp</span><input type="number" min="1" value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} placeholder="0" /></div></div><div className="trade-actions"><button onClick={onCancel}>Batal</button><button disabled={!name.trim() || !value || Number(sellingPrice) <= 0} onClick={() => onSave(name.trim(), value, category, sellingPrice)}>Simpan ke inventori</button></div></div>; }

function ServiceViewMock() { const [activeStatus, setActiveStatus] = useState('Semua tiket'); const statuses = ['Semua tiket', 'Antrean', 'Pengecekan', 'Menunggu persetujuan', 'Proses servis', 'Selesai']; return <><section className="page-heading service-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> WORKSPACE SERVIS</div><h1>Semua perangkat, <em>terpantau.</em></h1><p>Kelola penerimaan, persetujuan, dan progres perbaikan dari satu tempat.</p></div><button className="button primary"><Plus size={17} /> Tiket servis baru</button></section><div className="service-summary"><div><span>Perlu perhatian</span><strong>2 tiket</strong><small>Menunggu persetujuan pelanggan</small></div><div><span>Dalam pengerjaan</span><strong>4 tiket</strong><small>Rata-rata selesai 1,8 hari</small></div><div><span>Selesai bulan ini</span><strong>38 tiket</strong><small><ArrowUpRight size={13} /> 8,2% dari bulan lalu</small></div><div className="service-illustration"><Sparkles size={22} /><span>Rapi hari ini,<br /><strong>tenang besok.</strong></span></div></div><section className="panel service-panel"><div className="panel-header"><div><h2>Tiket servis</h2><p>8 tiket aktif di semua cabang</p></div><div className="service-tools"><div className="search-field"><Search size={15} /><input placeholder="Cari tiket atau pelanggan..." /></div><button className="icon-button bordered"><Settings size={17} /></button></div></div><div className="status-tabs">{statuses.map((status) => <button className={activeStatus === status ? 'selected' : ''} key={status} onClick={() => setActiveStatus(status)}>{status}{status === 'Menunggu persetujuan' && <b>2</b>}</button>)}</div><div className="ticket-table"><div className="table-head"><span>TIKET</span><span>PELANGGAN & PERANGKAT</span><span>KELUHAN</span><span>STATUS</span><span>MASUK</span><span /></div>{serviceTickets.map((ticket) => <div className="ticket-row" key={ticket.id}><strong>{ticket.id}</strong><div className="ticket-customer"><div className="device-icon"><Laptop size={16} /></div><span><strong>{ticket.customer}</strong><small>{ticket.device}</small></span></div><span>{ticket.issue}</span><span className={`service-status ${ticket.status.replaceAll(' ', '-')}`}><i />{ticket.status}</span><span className="ticket-age">{ticket.age}</span><button className="row-arrow"><ArrowUpRight size={16} /></button></div>)}</div></section></>; }

function ServiceView({
  serviceTickets,
  setToast,
  onChangeStatus,
  onCancelStatus,
  canCreate,
  canManage,
  openServiceModal,
}) {
  const [activeStatus, setActiveStatus] = useState("Semua tiket");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [revealedPins, setRevealedPins] = useState({});
  const statuses = [
    "Semua tiket",
    "antrean",
    "pengecekan",
    "menunggu persetujuan",
    "proses servis",
    "selesai",
  ];
  const filteredTickets = serviceTickets.filter((ticket) => {
    const matchesStatus = activeStatus === "Semua tiket" || ticket.status === activeStatus;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${ticket.id} ${ticket.customer} ${ticket.device} ${ticket.issue}`.toLowerCase().includes(query);
    return matchesStatus && matchesSearch;
  });
  const pageCount = Math.max(1, Math.ceil(filteredTickets.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleTickets = filteredTickets.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstTicket = filteredTickets.length ? (currentPage - 1) * pageSize + 1 : 0;
  const lastTicket = Math.min(currentPage * pageSize, filteredTickets.length);
  async function toggleServicePin(ticket) {
    if (Object.hasOwn(revealedPins, ticket.id)) {
      setRevealedPins((current) => { const next = { ...current }; delete next[ticket.id]; return next; });
      return;
    }
    try {
      const result = await getServiceAccess(ticket.serviceId);
      setRevealedPins((current) => ({ ...current, [ticket.id]: result.password_pin || '(tidak ada PIN)' }));
    } catch (error) { setToast(error.message); }
  }
  return (
    <>
      <section className="page-heading service-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> WORKSPACE SERVIS
          </div>
          <h1>
            Semua perangkat, <em>terpantau.</em>
          </h1>
          <p>
            Kelola penerimaan, persetujuan, dan progres perbaikan dari satu
            tempat.
          </p>
        </div>
        {canCreate && (
          <button className="button primary" onClick={openServiceModal}>
            <Plus size={17} /> Tiket servis baru
          </button>
        )}
      </section>
      <section className="panel service-panel">
        <div className="panel-header">
          <div>
            <h2>Tiket servis</h2>
            <p>{filteredTickets.length} tiket · Menampilkan {firstTicket}–{lastTicket}</p>
          </div>
          <div className="service-tools">
            <div className="search-field">
              <Search size={15} />
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Cari tiket atau pelanggan..." />
            </div>
            <button
              className="icon-button bordered"
              onClick={() =>
                setToast(
                  "Filter servis: gunakan tab status atau cari tiket di kolom pencarian",
                )
              }
            >
              <Settings size={17} />
            </button>
          </div>
        </div>
        <div className="status-tabs">
          {statuses.map((status) => (
            <button
              className={activeStatus === status ? "selected" : ""}
              key={status}
              onClick={() => { setActiveStatus(status); setPage(1); }}
            >
              {status}
            </button>
          ))}
        </div>
        <div className="ticket-table">
          <div className="table-head">
            <span>TIKET</span>
            <span>PELANGGAN & PERANGKAT</span>
            <span>KELUHAN</span>
            <span>STATUS</span>
            <span>MASUK</span>
            <span />
          </div>
          {visibleTickets.map((ticket) => (
            <div className="ticket-row" key={ticket.id}>
              <strong>{ticket.id}</strong>
              <div className="ticket-customer">
                <div className="device-icon">
                  <Laptop size={16} />
                </div>
                <span>
                  <strong>{ticket.customer}</strong>
                  <small>{ticket.device}</small>
                  {canManage && <button type="button" className="service-pin-toggle" onClick={() => toggleServicePin(ticket)} title={Object.hasOwn(revealedPins, ticket.id) ? "Sembunyikan PIN" : "Lihat PIN perangkat"}>{Object.hasOwn(revealedPins, ticket.id) ? <><EyeOff size={13} /> {revealedPins[ticket.id]}</> : <><Eye size={13} /> Lihat PIN</>}</button>}
                </span>
              </div>
              <span>{ticket.issue}</span>
              <button
                disabled={!canManage}
                className={`service-status ${ticket.status.replaceAll(" ", "-")}`}
                onClick={() =>
                  onChangeStatus?.(ticket.serviceId, ticket.status, ticket)
                }
              >
                <i />
                {ticket.status}
              </button>
              <span className="ticket-age">{ticket.age || "Aktif"}</span>
              <button
                disabled={!canManage}
                className="row-arrow"
                onClick={() =>
                  onChangeStatus?.(ticket.serviceId, ticket.status, ticket)
                }
              >
                <ArrowUpRight size={16} />
              </button>
              {canManage && ticket.status === "menunggu persetujuan" && (
                <button
                  className="cancel-ticket"
                  onClick={() => onCancelStatus(ticket.serviceId)}
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
        {filteredTickets.length > 0 && (
          <div className="inventory-pagination service-pagination">
            <label className="inventory-page-size">
              Tampilkan
              <select aria-label="Tiket per halaman" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
              </select>
              per halaman
            </label>
            <span className="inventory-page-status">Halaman {currentPage} dari {pageCount}</span>
            <div className="inventory-page-buttons">
              <button type="button" className="icon-button bordered" aria-label="Halaman tiket sebelumnya" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} /></button>
              <button type="button" className="icon-button bordered" aria-label="Halaman tiket berikutnya" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="modal-card">
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Tutup">
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

const specificationPresets = [
  {
    key: "processor",
    label: "Processor / CPU",
    mode: "single",
    options: [
      "Intel Core i3 6th Gen",
      "Intel Core i5 8th Gen",
      "Intel Core i5 10th Gen",
      "Intel Core i7 8th Gen",
      "Intel Core i7 10th Gen",
      "AMD Ryzen 5 3500U",
      "AMD Ryzen 7 3700U",
      "Apple M1",
    ],
  },
  {
    key: "gpu",
    label: "Graphics Card / GPU",
    options: [
      "Intel Iris Xe Graphics",
      "Intel HD 520",
      "Intel HD 530",
      "Nvidia GTX 970M 3GB GDDR5 192 bit",
      "Nvidia GTX 960M 4GB GDDR5 128 bit",
      "AMD Radeon Graphics",
      "Apple M1 GPU Core",
    ],
  },
  {
    key: "memory",
    label: "RAM / Memory",
    mode: "single",
    options: [
      "4GB DDR4",
      "8GB DDR4",
      "16GB DDR4",
      "16GB DDR4 3200MHz",
      "32GB LPDDR4 3733MHz",
      "16GB LPDDR4X 4266MHz",
    ],
  },
  {
    key: "storage",
    label: "Storage",
    options: [
      "256GB SSD NVMe",
      "512GB SSD NVMe",
      "1TB HDD",
      "256GB SSD",
      "240GB SSD",
      "256GB SSD Flash Storage",
      "512GB SSD Flash Storage",
    ],
    note: true,
  },
  {
    key: "display",
    label: "Layar / Panel",
    options: [
      '14" Full HD IPS',
      '15.6" Full HD IPS 144Hz',
      "Anti-glare",
      "Touchscreen",
      '14" LED HD',
      '15.6" IPS 1080p',
      '13.3" IPS 900p',
      '13.3" Retina Display with TrueTone',
      '14" IPS 1200p',
    ],
    note: true,
  },
  {
    key: "port_io",
    label: "Port / I/O",
    options: [
      "USB-A 3.0 x2",
      "HDMI",
      "HDMI / DP",
      "Card Reader",
      "SD Card",
      "RJ45",
      "DVD Drive",
      "USB Type C with Thunderbolt 3 & DisplayPort",
      "USB 3.0",
      "SDXC Card",
      "External Graphics Card Port",
      "Thunderbolt 2",
      "Charger Barrel",
      "DP Type-C",
    ],
    note: true,
  },
  {
    key: "feature",
    label: "Fitur",
    options: [
      "Backlit Keyboard",
      "Fingerprint Reader",
      "Wi-Fi 5",
      "Bluetooth 5",
      "Bluetooth",
      "Webcam",
      "RGB Backlit Keyboard",
      "FHD Webcam",
      "HD Webcam",
      "Airdrop",
      "Wi-Fi 6",
      "Face Unlock",
    ],
  },
  {
    key: "contents",
    label: "Berisi / Kelengkapan",
    options: [
      "Charger",
      "Tas",
      "Dus",
      "Buku manual",
      "Adaptor original",
      "Kabel power",
    ],
  },
  {
    key: "unit_source",
    label: "Sumber Unit",
    mode: "single",
    options: [
      "Pribadi",
      "Toko / reseller",
      "Lelang",
      "Ex-kantor",
      "Ex-display",
      "Import",
    ],
  },
  {
    key: "physical",
    label: "Fisik",
    fields: [{ key: "description", label: "Keterangan" }],
  },
  {
    key: "keyboard",
    label: "Keyboard",
    fields: [{ key: "description", label: "Keterangan" }],
  },
  {
    key: "touchpad",
    label: "Touchpad",
    options: [
      "Pointer normal",
      "Precision Touchpad",
      "Klik normal",
      "Ada ghost click",
    ],
    note: true,
  },
  {
    key: "battery",
    label: "Baterai",
    fields: [
      { key: "cycle_count", label: "Cycle Count", type: "number" },
      { key: "capacity", label: "Capacity (mAh/Wh)" },
      { key: "health", label: "Battery Health (%)", type: "number" },
    ],
  },
  {
    key: "benchmark",
    label: "Benchmark",
    fields: [
      { key: "cinebench_r23", label: "Cinebench R23 (Multi Core)" },
      {
        key: "superposition",
        label: "Unigine Superposition (720p Low / 1080p Medium / 4K Optimized)",
      },
      { key: "valley", label: "Unigine Valley (Basic)" },
    ],
  },
  {
    key: "charger",
    label: "Charger",
    fields: [
      { key: "voltage", label: "Voltase", type: "number" },
      { key: "ampere", label: "Ampere", type: "number" },
      { key: "watt", label: "Watt", type: "number", readOnly: true },
    ],
  },
  {
    key: "audio",
    label: "Audio",
    options: [
      "Speaker normal",
      "Mic normal",
      "Jack audio normal",
      "Speaker pecah",
      "Mic tidak berfungsi",
      "Jack audio longgar",
    ],
    note: true,
  },
  {
    key: "camera",
    label: "Camera",
    options: [
      "Kamera depan",
      "Kamera belakang",
      "Webcam normal",
      "Webcam buram",
      "Kamera tidak tersedia",
    ],
  },
  {
    key: "security",
    label: "Security",
    options: [
      "Fingerprint",
      "Face Unlock",
      "BIOS password clear",
      "Activation Lock clear",
      "MDM clear",
      "iCloud sign-out",
    ],
  },
  {
    key: "lock_status",
    label: "Lock Status",
    options: [
      "BIOS unlock",
      "Activation Lock unlock",
      "MDM unlock",
      "iCloud unlock",
      "Ada password BIOS",
      "Perlu verifikasi akun",
    ],
  },
];

function ProductModal({ product, onClose, onSave }) {
  const [form, setForm] = useState(() =>
    product
      ? {
          category:
            {
              Laptop: "laptop",
              Aksesoris: "aksesoris",
              "Part copotan": "part_copotan",
              Gadget: "gadget",
            }[product.category] || product.category,
          name: product.name,
          brand: product.brand || "",
          serial_number: product.serial_number || product.serial || "",
          selling_price: product.selling_price,
          cost_price: product.cost_price,
          stock: product.stock,
          specs: product.specs || {},
          notes: product.notes || "",
        }
      : {
          category: "laptop",
          name: "",
          brand: "",
          serial_number: "",
          selling_price: "",
          cost_price: "",
          stock: "1",
          specs: {},
          notes: "",
        },
  );
  const update = (key) => (event) =>
    setForm({ ...form, [key]: event.target.value });
  function submit(event) {
    event.preventDefault();
    onSave({
      ...form,
      selling_price: Number(form.selling_price),
      cost_price: Number(form.cost_price || 0),
      stock: Number(form.stock),
      notes: form.notes,
    });
  }
  return (
    <Modal title="Tambah produk" onClose={onClose}>
      <form className="modal-form product-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Nama / model" required>
            <input
              required
              value={form.name}
              onChange={update("name")}
              placeholder="Contoh: ThinkPad T480"
            />
          </Field>
          <Field label="Brand">
            <input
              value={form.brand}
              onChange={update("brand")}
              placeholder="Lenovo"
            />
          </Field>
          <Field label="Kategori">
            <select value={form.category} onChange={update("category")}>
              <option value="laptop">Laptop</option>
              <option value="aksesoris">Aksesoris</option>
              <option value="part_copotan">Part copotan</option>
              <option value="gadget">Gadget</option>
            </select>
          </Field>
          <Field label="Serial number">
            <div className="scan-field">
              <input
                value={form.serial_number}
                onChange={update("serial_number")}
                placeholder="Opsional untuk aksesoris"
              />
              <SerialScanner
                onDetected={(serial_number) =>
                  setForm({ ...form, serial_number })
                }
              />
            </div>
          </Field>
          <Field label="Stok">
            <input
              required
              type="number"
              min="0"
              value={form.stock}
              onChange={update("stock")}
            />
          </Field>
          <Field label="Harga modal">
            <input
              required
              type="number"
              min="0"
              value={form.cost_price}
              onChange={update("cost_price")}
              placeholder="0"
            />
          </Field>
          <Field label="Harga jual">
            <input
              required
              type="number"
              min="0"
              value={form.selling_price}
              onChange={update("selling_price")}
              placeholder="0"
            />
          </Field>
        </div>
        <section className="specification-editor">
          <div className="specification-heading">
            <div>
              <strong>Preset atribut spesifikasi</strong>
              <small>
                Pilih spesifikasi yang sesuai. Anda bisa menambahkan pilihan
                sendiri.
              </small>
            </div>
            <span>
              {
                specificationPresets.filter((group) => {
                  const value = form.specs[group.key];
                  return Array.isArray(value) ? value.length : value;
                }).length
              }{" "}
              bagian terisi
            </span>
          </div>
          <div className="specification-grid">
            {specificationPresets.map((group) => (
              <SpecificationGroup
                key={group.key}
                group={group}
                value={form.specs[group.key]}
                note={form.specs[`${group.key}_note`] || ""}
                onChange={(value) =>
                  setForm({
                    ...form,
                    specs: { ...form.specs, [group.key]: value },
                  })
                }
                onNoteChange={(note) =>
                  setForm({
                    ...form,
                    specs: { ...form.specs, [`${group.key}_note`]: note },
                  })
                }
              />
            ))}
          </div>
        </section>
        <Field label="Keterangan umum">
          <textarea
            value={form.notes}
            onChange={update("notes")}
            rows="3"
            placeholder="Kondisi fisik, kelengkapan, catatan garansi, atau keterangan lain..."
          />
        </Field>
        <ModalActions onClose={onClose} />
      </form>
    </Modal>
  );
}

function uniqueSpecificationOptions(options) {
  const seen = new Set();
  return options.filter((option) => {
    const key = String(option).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function SpecificationGroup({ group, value, customOptions = [], onOptionsChange, note, onChange, onNoteChange }) {
  const [storedOptions, setStoredOptions] = useState(() => uniqueSpecificationOptions(JSON.parse(localStorage.getItem('pos_custom_spec_options') || '{}')[group.key] || []));
  customOptions = storedOptions;
  const options = uniqueSpecificationOptions([...(group.options || []), ...customOptions]);
  useEffect(() => { const saved = JSON.parse(localStorage.getItem('pos_custom_spec_options') || '{}'); const clean = uniqueSpecificationOptions(saved[group.key] || []); if (clean.length !== (saved[group.key] || []).length) { localStorage.setItem('pos_custom_spec_options', JSON.stringify({ ...saved, [group.key]: clean })); setStoredOptions(clean); } }, [group.key]);
  const [newOption, setNewOption] = useState('');
  const selected = group.mode === 'single' ? (value || '') : (value || []);
  const fieldValues = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  function toggle(option) { if (group.mode === 'single') return onChange(option); onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]); }
  function addOption() { const option = newOption.trim(); if (!option || options.some((item) => String(item).trim().toLowerCase() === option.toLowerCase())) return; const next = uniqueSpecificationOptions([...customOptions, option]); setStoredOptions(next); const saved = JSON.parse(localStorage.getItem('pos_custom_spec_options') || '{}'); localStorage.setItem('pos_custom_spec_options', JSON.stringify({ ...saved, [group.key]: next })); toggle(option); setNewOption(''); }
  return <section className="specification-group"><h3><span className="specification-icon">+</span>{group.label}</h3>{group.fields ? <div className="specification-fields">{group.fields.map((field) => <label key={field.key}><span>{field.label}</span><input type={field.type || 'text'} readOnly={field.readOnly} value={field.key === 'watt' ? (Number(fieldValues.voltage || 0) * Number(fieldValues.ampere || 0) || '') : (fieldValues[field.key] || '')} onChange={(event) => onChange({ ...fieldValues, [field.key]: event.target.value, ...(field.key === 'voltage' || field.key === 'ampere' ? { watt: String(Number(fieldValues.voltage || (field.key === 'voltage' ? event.target.value : 0)) * Number(fieldValues.ampere || (field.key === 'ampere' ? event.target.value : 0)) || '') } : {}) })} /></label>)}</div> : <><div className="specification-options">{group.mode === 'single' ? <select value={selected} onChange={(event) => onChange(event.target.value)}><option value="">Pilih {group.label.toLowerCase()}...</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select> : options.map((option) => <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />{option}</label>)}</div><div className="add-spec-option"><input value={newOption} onChange={(event) => setNewOption(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addOption(); } }} placeholder="Tambah pilihan baru..." /><button type="button" onClick={addOption}>+</button></div></>}{group.note && <textarea className="specification-note" value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder={`Keterangan ${group.label.toLowerCase()}...`} rows="2" />}</section>;
}

function CustomerModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name: '', phone: '', address: '' });
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  return <Modal title="Tambah pelanggan" onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSave(form); }}><Field label="Nama" required><input required value={form.name} onChange={update('name')} placeholder="Nama pelanggan" /></Field><Field label="Nomor telepon" required><input required value={form.phone} onChange={update('phone')} placeholder="08xx" /></Field><Field label="Alamat"><textarea value={form.address} onChange={update('address')} placeholder="Alamat lengkap" /></Field><ModalActions onClose={onClose} /></form></Modal>;
}

function ServiceModal({ customers, customer, onClose, onSave, onAddCustomer }) {
  const [selectedCustomer, setSelectedCustomer] = useState(customer?.id || customers[0]?.id || '');
  const [form, setForm] = useState({ device_name: '', serial_number: '', issues: '', accessories_included: '', password_pin: '', estimated_cost: '', down_payment: '', failure_fee: '', technician_name: '' });
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  function submit(event) { event.preventDefault(); if (!selectedCustomer) return; onSave({ ...form, customer_id: Number(selectedCustomer), estimated_cost: Number(form.estimated_cost || 0), down_payment: Number(form.down_payment || 0), failure_fee: Number(form.failure_fee || 0) }); }
  return <Modal title="Tiket servis baru" onClose={onClose}><form className="modal-form" onSubmit={submit}><Field label="Pelanggan" required><div className="customer-form-select"><select required value={selectedCustomer} onChange={(event) => setSelectedCustomer(event.target.value)}><option value="">Pilih pelanggan</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.phone}</option>)}</select><button type="button" onClick={onAddCustomer}><Plus size={14} /> Pelanggan baru</button></div></Field><div className="form-grid"><Field label="Nama perangkat" required><input required value={form.device_name} onChange={update('device_name')} placeholder="MacBook Air 2020" /></Field><Field label="Serial number"><div className="scan-field"><input value={form.serial_number} onChange={update('serial_number')} /><SerialScanner onDetected={(serial_number) => setForm({ ...form, serial_number })} /></div></Field><Field label="Kelengkapan"><input value={form.accessories_included} onChange={update('accessories_included')} placeholder="Charger, tas" /></Field><Field label="Password / PIN"><input value={form.password_pin} onChange={update('password_pin')} /></Field><Field label="Teknisi"><input value={form.technician_name} onChange={update('technician_name')} /></Field><Field label="Estimasi biaya"><input type="number" min="0" value={form.estimated_cost} onChange={update('estimated_cost')} /></Field></div><Field label="Keluhan" required><textarea required value={form.issues} onChange={update('issues')} placeholder="Jelaskan masalah perangkat" /></Field><div className="form-grid"><Field label="DP"><input type="number" min="0" value={form.down_payment} onChange={update('down_payment')} /></Field><Field label="Biaya cek jika gagal"><input type="number" min="0" value={form.failure_fee} onChange={update('failure_fee')} /></Field></div><ModalActions onClose={onClose} disabled={!selectedCustomer} /></form></Modal>;
}

function Field({ label, required, children }) { return <label className="form-field"><span>{label}{required && <b>*</b>}</span>{children}</label>; }
function ModalActions({ onClose, disabled = false }) { return <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Batal</button><button type="submit" className="button primary" disabled={disabled}>Simpan</button></div>; }

function ServiceQuoteModal({ ticket, onClose, onSave }) {
  const [form, setForm] = useState({ diagnosis: '', final_cost: ticket?.estimated_cost || '' });
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  return <Modal title="Hasil pengecekan & quote" onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSave(form); }}><div className="form-note"><Wrench size={15} /> {ticket?.id} · {ticket?.device}</div><Field label="Diagnosis / kerusakan" required><textarea required value={form.diagnosis} onChange={update('diagnosis')} placeholder="Contoh: IC charging rusak, perlu penggantian" /></Field><Field label="Biaya servis final" required><input required min="0" type="number" value={form.final_cost} onChange={update('final_cost')} /></Field><p className="form-hint">Customer akan melihat nominal ini dan dapat menyetujui atau membatalkan servis.</p><ModalActions onClose={onClose} /></form></Modal>;
}

function SerialScanner({ onDetected }) {
  const [message, setMessage] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef(null);
  const controlsRef = useRef(null);

  function stopCamera() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraOpen(false);
  }

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    if (!cameraOpen) return undefined;
    let cancelled = false;
    async function startScanning() {
      try {
        const video = videoRef.current;
        if (!video) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video, (result) => {
          if (cancelled || !result) return;
          onDetected(result.getText());
          setMessage('Barcode terbaca');
          stopCamera();
        });
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      } catch {
        setMessage('Akses kamera ditolak atau tidak tersedia');
        stopCamera();
      }
    }
    startScanning();
    return () => { cancelled = true; controlsRef.current?.stop(); };
  }, [cameraOpen, onDetected]);

  async function scan(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!('BarcodeDetector' in window)) return setMessage('BarcodeDetector tidak didukung browser ini');
    try {
      const detector = new window.BarcodeDetector();
      const codes = await detector.detect(await createImageBitmap(file));
      if (codes[0]?.rawValue) { onDetected(codes[0].rawValue); setMessage('Barcode terbaca'); } else setMessage('Barcode tidak ditemukan');
    } catch { setMessage('Scan gagal, isi serial secara manual'); }
  }
  return <div className="serial-scanner"><div className="serial-scanner-actions"><button type="button" className="scan-button" onClick={() => { setMessage(''); setCameraOpen(true); }} title="Gunakan kamera untuk scan barcode"><Camera size={14} /> Kamera</button><label className="scan-button" title="Scan foto barcode"><ScanLine size={14} /><input type="file" accept="image/*" capture="environment" onChange={scan} /> Foto</label></div>{cameraOpen && <div className="camera-scanner"><video ref={videoRef} muted playsInline /><div className="camera-guide" /><button type="button" className="camera-close" onClick={stopCamera}>Tutup kamera</button></div>}{message && <small className="scanner-message">{message}</small>}</div>;
}

function SectionHeading({ eyebrow, title, description, action, onAction }) { return <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> {eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <button className="button primary" onClick={onAction}><Plus size={17} /> {action}</button>}</section>; }

function TransactionHistory({ transactions, onPrint, onSettle, onRefund }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const filteredTransactions = transactions.filter((transaction) => `${transaction.invoice_number} ${transaction.transaction_type} ${transaction.payment_status} ${transaction.refunded_at ? 'refund direfund' : ''} ${transaction.created_at}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filteredTransactions.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleTransactions = filteredTransactions.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstTransaction = filteredTransactions.length ? (currentPage - 1) * pageSize + 1 : 0;
  const lastTransaction = Math.min(currentPage * pageSize, filteredTransactions.length);
  return (
    <>
      <SectionHeading
        eyebrow="CATATAN PENJUALAN"
        title={
          <>
            Semua transaksi, <em>tersimpan.</em>
          </>
        }
        description="Lihat invoice, cetak nota, terima pelunasan, atau proses refund penuh."
      />
      <section className="panel table-panel">
        <div className="panel-header">
          <div>
            <h2>Riwayat transaksi</h2>
            <p>{filteredTransactions.length} transaksi · Menampilkan {firstTransaction}–{lastTransaction}</p>
          </div>
          <div className="search-field">
            <Search size={15} />
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Cari invoice..." />
          </div>
        </div>
        <div className="history-list">
          {visibleTransactions.length ? (
            visibleTransactions.map((transaction) => (
              <div className="history-row" key={transaction.id}>
                <div>
                  <strong>{transaction.invoice_number}</strong>
                  <small>{transaction.created_at}</small>
                </div>
                <span>
                  {transaction.transaction_type} · {transaction.refunded_at ? 'direfund' : transaction.payment_status}
                </span>
                <strong>{formatPrice(transaction.grand_total)}</strong>
                <div className="history-actions">
                  {!transaction.refunded_at && transaction.payment_status !== "lunas" &&
                    Number(transaction.grand_total || 0) >
                      Number(transaction.paid_amount || 0) && (
                      <button
                        type="button"
                        className="settle-button"
                        onClick={() => onSettle(transaction)}
                      >
                        Pelunasan
                      </button>
                    )}
                  {!transaction.refunded_at && <button type="button" className="refund-button" onClick={() => onRefund(transaction)}>{Number(transaction.paid_amount || 0) > 0 ? 'Refund' : 'Batalkan'}</button>}
                  <button
                    type="button"
                    className="icon-button bordered"
                    onClick={() => onPrint(transaction)}
                    aria-label={`Cetak ${transaction.invoice_number}`}
                  >
                    <Printer size={16} />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <ClipboardList size={30} />
              <strong>{search ? "Transaksi tidak ditemukan" : "Belum ada transaksi"}</strong>
              <span>{search ? "Coba kata pencarian lain." : "Transaksi yang selesai akan muncul di sini."}</span>
            </div>
          )}
        </div>
        {filteredTransactions.length > 0 && (
          <div className="inventory-pagination transaction-pagination">
            <label className="inventory-page-size">
              Tampilkan
              <select aria-label="Transaksi per halaman" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
              </select>
              per halaman
            </label>
            <span className="inventory-page-status">Halaman {currentPage} dari {pageCount}</span>
            <div className="inventory-page-buttons">
              <button type="button" className="icon-button bordered" aria-label="Halaman transaksi sebelumnya" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} /></button>
              <button type="button" className="icon-button bordered" aria-label="Halaman transaksi berikutnya" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function InventoryView({
  products,
  openProductModal,
  onEditProduct,
  onPrintLabel,
  onImportProducts,
  onDownloadTemplate,
}) {
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const filteredProducts = products.filter((product) => {
    const query = search.trim().toLowerCase();
    const matchesCategory = !category || product.category === category;
    const matchesSearch =
      !query ||
      `${product.name} ${product.brand} ${product.serial || ""}`
        .toLowerCase()
        .includes(query);
    return matchesCategory && matchesSearch;
  });
  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageProducts = filteredProducts.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const firstProduct = filteredProducts.length
    ? (currentPage - 1) * pageSize + 1
    : 0;
  const lastProduct = Math.min(currentPage * pageSize, filteredProducts.length);
  const categoryCount = (value) =>
    products.filter((product) => product.category === value).length;
  const totalCost = filteredProducts.reduce(
    (total, product) =>
      total + Number(product.cost_price || 0) * Number(product.stock || 0),
    0,
  );
  return (
    <>
      <SectionHeading
        eyebrow="KELOLA STOK"
        title={
          <>
            Inventori yang <em>rapi.</em>
          </>
        }
        description="Pantau barang, serial number, dan stok yang tersedia."
        action={openProductModal ? "Tambah produk" : undefined}
        onAction={openProductModal}
      />
      <section className="panel table-panel">
        <div className="panel-header inventory-header">
          <div>
            <h2>Daftar inventori</h2>
            <p>
              {filteredProducts.length} produk · Menampilkan {firstProduct}–
              {lastProduct} · Total modal{" "}
              <strong>{formatPrice(totalCost)}</strong>
            </p>
          </div>
          <div className="inventory-actions">
            {onImportProducts && (
              <>
                <button className="button ghost" onClick={onDownloadTemplate}>
                  <Download size={15} /> Template Excel
                </button>
                <label className="button primary" htmlFor="product-import-file">
                  <FileSpreadsheet size={15} /> Import Excel
                </label>
                <input
                  id="product-import-file"
                  hidden
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onImportProducts(file);
                    event.target.value = "";
                  }}
                />
              </>
            )}
            <div className="search-field">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Cari produk atau serial..."
              />
            </div>
          </div>
        </div>
        <div className="category-tabs inventory-category-tabs">
          <button
            className={!category ? "selected" : ""}
            onClick={() => {
              setCategory("");
              setPage(1);
            }}
          >
            Semua <span>{products.length}</span>
          </button>
          <button
            className={category === "Laptop" ? "selected" : ""}
            onClick={() => {
              setCategory("Laptop");
              setPage(1);
            }}
          >
            Laptop <span>{categoryCount("Laptop")}</span>
          </button>
          <button
            className={category === "Aksesoris" ? "selected" : ""}
            onClick={() => {
              setCategory("Aksesoris");
              setPage(1);
            }}
          >
            Aksesoris <span>{categoryCount("Aksesoris")}</span>
          </button>
          <button
            className={category === "Part copotan" ? "selected" : ""}
            onClick={() => {
              setCategory("Part copotan");
              setPage(1);
            }}
          >
            Part <span>{categoryCount("Part copotan")}</span>
          </button>
          <button
            className={category === "Gadget" ? "selected" : ""}
            onClick={() => {
              setCategory("Gadget");
              setPage(1);
            }}
          >
            Gadget <span>{categoryCount("Gadget")}</span>
          </button>
        </div>
        <div className="history-list">
          {filteredProducts.length ? (
            pageProducts.map((product) => (
              <div className="history-row inventory-row" key={product.id}>
                <div>
                  <strong>{product.name}</strong>
                  <small>
                    {product.brand} · {product.serial || "Tanpa serial"}
                  </small>
                </div>
                <strong>{formatPrice(product.price)}</strong>
                <span className="stock-label">{product.stock} stok</span>
                {onPrintLabel && (
                  <button
                    className="icon-button bordered"
                    onClick={() => onPrintLabel(product)}
                    aria-label={`Cetak label barcode ${product.name}`}
                    title="Cetak label QR"
                  >
                    <QrCode size={15} />
                  </button>
                )}
                {onEditProduct ? (
                  <button
                    className="icon-button bordered"
                    onClick={() => onEditProduct(product)}
                    aria-label={`Edit ${product.name}`}
                  >
                    <Pencil size={15} />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))
          ) : (
            <div className="empty-state">
              <ShoppingBag size={30} />
              <strong>Tidak ada produk</strong>
              <span>Belum ada produk pada kategori ini.</span>
            </div>
          )}
        </div>
        <div className="inventory-pagination">
          <label className="inventory-page-size">
            Tampilkan
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              <option value="8">8</option>
              <option value="16">16</option>
              <option value="32">32</option>
            </select>
            per halaman
          </label>
          <span className="inventory-page-status">
            Halaman {currentPage} dari {pageCount}
          </span>
          <div className="inventory-page-buttons">
            <button
              type="button"
              className="icon-button bordered"
              aria-label="Halaman sebelumnya"
              title="Sebelumnya"
              disabled={currentPage <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="icon-button bordered"
              aria-label="Halaman berikutnya"
              title="Berikutnya"
              disabled={currentPage >= pageCount}
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function CustomerView({ customers, openCustomerModal, onImportCustomers }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const filteredCustomers = customers.filter((customer) => `${customer.name} ${customer.phone} ${customer.address || ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filteredCustomers.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageCustomers = filteredCustomers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstCustomer = filteredCustomers.length ? (currentPage - 1) * pageSize + 1 : 0;
  const lastCustomer = Math.min(currentPage * pageSize, filteredCustomers.length);
  return (
    <>
      <SectionHeading
        eyebrow="DATABASE PELANGGAN"
        title={
          <>
            Kenali pelanggan, <em>lebih dekat.</em>
          </>
        }
        description="Simpan kontak pelanggan untuk transaksi dan servis berikutnya."
        action={openCustomerModal ? "Tambah pelanggan" : undefined}
        onAction={openCustomerModal}
      />
      <section className="panel table-panel customer-panel">
        <div className="panel-header">
          <div>
            <h2>Daftar pelanggan</h2>
            <p>{filteredCustomers.length} pelanggan · Menampilkan {firstCustomer}–{lastCustomer}</p>
          </div>
          <div className="customer-list-actions">
            <div className="search-field customer-list-search"><Search size={15} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Cari nama, telepon, atau alamat..." /></div>
            {onImportCustomers && <div className="customer-import-actions"><label className="button ghost" htmlFor="aronium-customer-import"><FileSpreadsheet size={15} /> Import Aronium CSV</label><input id="aronium-customer-import" hidden type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportCustomers(file); event.target.value = ''; }} /></div>}
          </div>
        </div>
        <div className="history-list">
          {pageCustomers.length ? (
            pageCustomers.map((item) => (
              <div className="history-row" key={item.id}>
                <div className="customer-table-name">
                  <div className="avatar small">
                    {item.name
                      .split(" ")
                      .map((part) => part[0])
                      .join("")
                      .slice(0, 2)}
                  </div>
                  <strong>{item.name}</strong>
                </div>
                <span>{item.phone}</span>
                <span>{item.address || "Alamat belum diisi"}</span>
                <button className="icon-button bordered">
                  <ArrowUpRight size={16} />
                </button>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <UsersRound size={30} />
              <strong>Belum ada pelanggan</strong>
              <span>{search ? "Coba kata pencarian lain." : "Tambahkan pelanggan baru untuk mulai."}</span>
            </div>
          )}
        </div>
        {filteredCustomers.length > 0 && <div className="inventory-pagination customer-pagination">
          <label className="inventory-page-size">Tampilkan
            <select aria-label="Jumlah pelanggan per halaman" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
            per halaman
          </label>
          <span className="inventory-page-status">Halaman {currentPage} dari {pageCount}</span>
          <div className="inventory-page-buttons">
            <button type="button" className="icon-button bordered" aria-label="Pelanggan sebelumnya" title="Sebelumnya" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} /></button>
            <button type="button" className="icon-button bordered" aria-label="Pelanggan berikutnya" title="Berikutnya" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight size={16} /></button>
          </div>
        </div>}
      </section>
    </>
  );
}

function SettingsView() {
  return (
    <>
      <SectionHeading
        eyebrow="KONFIGURASI TOKO"
        title={
          <>
            Atur toko <em>sesuai ritme.</em>
          </>
        }
        description="Kelola preferensi cetak nota dan operasional toko."
      />
      <section className="panel settings-panel">
        <div className="setting-row">
          <div>
            <strong>Nama toko</strong>
            <span>Nama yang tampil pada nota thermal</span>
          </div>
          <input defaultValue="Lapak Laptop" />
        </div>
        <div className="setting-row">
          <div>
            <strong>Alamat toko</strong>
            <span>Alamat yang tampil pada nota thermal</span>
          </div>
          <input defaultValue="Jl. Teknologi No. 18" />
        </div>
        <div className="setting-row">
          <div>
            <strong>Garansi default</strong>
            <span>Catatan garansi untuk transaksi baru</span>
          </div>
          <input defaultValue="Garansi toko 7 hari" />
        </div>
        <button className="button primary">Simpan pengaturan</button>
      </section>
    </>
  );
}

function UserView({ authUser, onLogout }) {
  const [form, setForm] = useState({ current_password: "", new_password: "" });
  const [message, setMessage] = useState("");
  async function submit(event) {
    event.preventDefault();
    try {
      await changePassword(form);
      setMessage("Password berhasil diubah. Silakan login kembali.");
      setTimeout(onLogout, 700);
    } catch (error) {
      setMessage(error.message);
    }
  }
  return (
    <>
      <SectionHeading
        eyebrow="AKUN PENGGUNA"
        title={
          <>
            Halo, <em>{authUser.name.split(" ")[0]}.</em>
          </>
        }
        description="Kelola identitas dan akses kerja Anda."
      />
      <section className="panel settings-panel">
        <div className="user-profile-card">
          <div className="avatar large">
            {authUser.name
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)}
          </div>
          <div>
            <h2>{authUser.name}</h2>
            <p>{authUser.role}</p>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <strong>Username</strong>
            <span>Identitas login akun</span>
          </div>
          <input value={authUser.username} readOnly />
        </div>
        <form onSubmit={submit}>
          <div className="setting-row">
            <div>
              <strong>Password lama</strong>
              <span>Verifikasi sebelum mengganti password</span>
            </div>
            <input
              required
              type="password"
              value={form.current_password}
              onChange={(event) =>
                setForm({ ...form, current_password: event.target.value })
              }
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Password baru</strong>
              <span>Minimal 10 karakter</span>
            </div>
            <input
              required
              minLength="10"
              type="password"
              value={form.new_password}
              onChange={(event) =>
                setForm({ ...form, new_password: event.target.value })
              }
            />
          </div>
          {message && <p className="login-error">{message}</p>}
          <button className="button primary" type="submit">
            Ubah password
          </button>
        </form>
        <button className="text-button" onClick={onLogout}>
          Keluar dari akun
        </button>
      </section>
    </>
  );
}

function LoginView({ onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  async function submit(event) { event.preventDefault(); try { const result = await login(form); localStorage.removeItem('pos_token'); localStorage.setItem('pos_user', JSON.stringify(result.user)); onLogin(result.user); } catch (requestError) { setError(requestError.message); } }
  return <main className="login-screen"><section className="login-card"><div className="brand-mark"><Laptop size={20} /></div><div className="login-eyebrow">LAPAK LAPTOP · WORKSPACE</div><h1>Selamat datang<br /><em>kembali.</em></h1><p>Masuk untuk mengelola penjualan, inventori, dan servis.</p><form onSubmit={submit}><label>Username<input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label><label>Password<input required type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>{error && <small className="login-error">{error}</small>}<button className="checkout-button" type="submit">Masuk ke workspace <ArrowUpRight size={17} /></button></form></section></main>;
}

function NotificationPanel({ notifications, onClose }) { return <div className="notification-panel"><div className="notification-header"><strong>Notifikasi</strong><button onClick={onClose}>Tutup</button></div>{notifications.length ? notifications.map((item) => <div className="notification-item" key={item.id}><span className={`notification-dot ${item.type}`} /><div><strong>{item.title}</strong><small>{item.detail}</small></div></div>) : <div className="notification-empty"><Bell size={18} /><span>Tidak ada notifikasi baru.</span></div>}</div>; }

function ReceiptModal({ receipt, onClose, onPrint }) { return <Modal title="Nota transaksi" onClose={onClose}><ReceiptPrint receipt={receipt} onPrint={onPrint} /></Modal>; }

function SettlementModal({ transaction, onClose, onSave }) {
  const remaining = Math.max(0, Number(transaction.grand_total || 0) - Number(transaction.paid_amount || 0));
  const [amount, setAmount] = useState(String(remaining));
  return <Modal title="Pelunasan transaksi" onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSave(amount); }}><div className="form-note"><CircleDollarSign size={15} /> {transaction.invoice_number} · Sisa tagihan {formatPrice(remaining)}</div><Field label="Nominal pembayaran" required><input autoFocus required type="number" min="1" max={remaining} value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Batal</button><button type="submit" className="button primary">Simpan pelunasan</button></div></form></Modal>;
}
 
 function RefundModal({ transaction, onClose, onSave }) {
   const [reason, setReason] = useState('');
   const [saving, setSaving] = useState(false);
   async function submit(event) {
     event.preventDefault();
     setSaving(true);
     const saved = await onSave(reason);
     if (!saved) setSaving(false);
   }
   return <Modal title={Number(transaction.paid_amount || 0) > 0 ? 'Refund transaksi' : 'Batalkan transaksi'} onClose={onClose}><form className="modal-form" onSubmit={submit}><div className="form-note"><CircleDollarSign size={15} /> {transaction.invoice_number} · Pengembalian penuh {formatPrice(transaction.paid_amount || 0)}</div><p className="refund-warning">Stok barang terjual akan dikembalikan. Jika transaksi tukar tambah, barang yang diterima toko harus masih tersedia di inventori.</p><Field label="Alasan refund" required><textarea autoFocus required minLength="3" maxLength="500" rows="3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Tuliskan alasan pembatalan atau refund" /></Field><div className="modal-actions"><button type="button" className="button ghost" disabled={saving} onClick={onClose}>Kembali</button><button type="submit" className="refund-confirm" disabled={saving || reason.trim().length < 3}>{saving ? 'Memproses...' : 'Konfirmasi refund'}</button></div></form></Modal>;
 }

export default App;
import './receipt-print.css';
import { Printer } from 'lucide-react';

const money = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const formatMoney = (value) => money.format(Number(value || 0)).replace('Rp', 'Rp ');

export default function ReceiptPrint({ receipt, onPrint }) {
  const size = receipt?.paper_size_preference || '58mm';
  return <article className={`receipt-sheet receipt-${size.replace('mm', 'mm').toLowerCase()} ${size === 'A4' ? 'receipt-a4' : ''}`}>
    <div className="receipt-actions print:hidden"><button type="button" onClick={onPrint} className="flex items-center gap-2 rounded-md bg-[#15221e] px-4 py-2 text-xs font-bold text-white hover:bg-[#28463a]"><Printer size={15} /> Cetak</button></div>
    <header className="receipt-header"><h1>{receipt?.store_name || 'Lapak Laptop'}</h1><p>{receipt?.store_address}</p><p>{receipt?.store_phone}</p></header>
    <div className="receipt-rule" />
    <div className="receipt-meta"><div><span>No Nota</span><strong>{receipt?.invoice_number}</strong></div><div><span>Tanggal</span><strong>{receipt?.created_at ? new Date(receipt.created_at.replace(' ', 'T') + 'Z').toLocaleString('id-ID') : '-'}</strong></div><div><span>Pelanggan</span><strong>{receipt?.customer_name || 'Umum'}</strong></div></div>
    <div className="receipt-rule" />
    <section className="receipt-items">{(receipt?.items || []).map((item) => <div className="receipt-item" key={item.id}><div className="receipt-item-main"><strong>{item.name}</strong><span>{item.qty} x {formatMoney(item.price)}</span></div>{item.serial_number && <div className="receipt-serial">SN: {item.serial_number}</div>}<strong>{formatMoney(item.subtotal)}</strong></div>)}</section>
    <div className="receipt-rule" />
    <section className="receipt-totals"><div><span>Subtotal</span><strong>{formatMoney(receipt?.subtotal)}</strong></div><div><span>Diskon (Nego)</span><strong>- {formatMoney(receipt?.direct_discount)}</strong></div><div><span>Ongkir</span><strong>{formatMoney(receipt?.shipping_cost)}</strong></div><div className="receipt-grand"><span>Grand Total</span><strong>{formatMoney(receipt?.grand_total)}</strong></div><div><span>Nominal Bayar</span><strong>{formatMoney(receipt?.paid_amount)}</strong></div><div><span>Kembalian</span><strong>{formatMoney(receipt?.change_amount)}</strong></div></section>
    <footer className="receipt-footer"><p>{receipt?.receipt_footer_text}</p><strong>{receipt?.receipt_closing_text}</strong></footer>
  </article>;
}

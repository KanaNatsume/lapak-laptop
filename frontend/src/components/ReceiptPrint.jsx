import './receipt-print.css';
import { Printer, Share2 } from 'lucide-react';

const money = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const formatMoney = (value) => money.format(Number(value || 0)).replace('Rp', 'Rp ');

export default function ReceiptPrint({ receipt, onPrint, onShare }) {
  const size = receipt?.paper_size_preference || '58mm';
  const remainingAmount = Math.max(0, Number(receipt?.grand_total || 0) - Number(receipt?.paid_amount || 0));
  return <article className={`receipt-sheet receipt-${size.replace('mm', 'mm').toLowerCase()} ${size === 'A4' ? 'receipt-a4' : ''}`}>
    <div className="receipt-actions print:hidden"><button type="button" onClick={onShare} className="flex items-center gap-2 rounded-md border border-[#dfe6de] bg-white px-4 py-2 text-xs font-bold text-[#405249] hover:bg-[#f6f8f4]"><Share2 size={15} /> PDF / WhatsApp</button><button type="button" onClick={onPrint} className="flex items-center gap-2 rounded-md bg-[#15221e] px-4 py-2 text-xs font-bold text-white hover:bg-[#28463a]"><Printer size={15} /> Cetak</button></div>
    <header className="receipt-header">{receipt?.store_logo_data_url && <img className="receipt-store-logo" src={receipt.store_logo_data_url} alt="Logo toko" />}<h1>{receipt?.store_name || 'Lapak Laptop'}</h1>{receipt?.store_address && <p>{receipt.store_address}</p>}{receipt?.store_phone && <p>{receipt.store_phone}</p>}{receipt?.store_whatsapp && <p>WhatsApp {receipt.store_whatsapp}</p>}<div className="receipt-social">{[receipt?.store_instagram && `Instagram ${receipt.store_instagram}`, receipt?.store_facebook && `Facebook ${receipt.store_facebook}`, receipt?.store_tiktok && `TikTok ${receipt.store_tiktok}`].filter(Boolean).join(' · ')}</div></header>
    <div className="receipt-rule" />
    <div className="receipt-meta"><div><span>No Nota</span><strong>{receipt?.invoice_number}</strong></div><div><span>Tanggal</span><strong>{receipt?.created_at ? new Date(receipt.created_at.replace(' ', 'T') + 'Z').toLocaleString('id-ID') : '-'}</strong></div><div><span>Pelanggan</span><strong>{receipt?.customer_name || 'Umum'}</strong></div>{receipt?.customer_phone && <div><span>Telepon pelanggan</span><strong>{receipt.customer_phone}</strong></div>}</div>
    <div className="receipt-rule" />
    <section className="receipt-items">{(receipt?.items || []).map((item) => <div className="receipt-item" key={item.id}><div className="receipt-item-main"><strong>{item.name}</strong><span>{item.qty} x {formatMoney(item.price)}</span></div>{item.serial_number && <div className="receipt-serial">SN: {item.serial_number}</div>}<strong>{formatMoney(item.subtotal)}</strong></div>)}</section>
    {receipt?.warranty_note && <div className="receipt-meta"><div><span>Garansi</span><strong>{receipt.warranty_note}</strong></div></div>}
    <div className="receipt-rule" />
    <section className="receipt-totals"><div><span>Subtotal</span><strong>{formatMoney(receipt?.subtotal)}</strong></div><div><span>Diskon (Nego)</span><strong>- {formatMoney(receipt?.direct_discount)}</strong></div><div><span>Ongkir</span><strong>{formatMoney(receipt?.shipping_cost)}</strong></div><div className="receipt-grand"><span>Grand Total</span><strong>{formatMoney(receipt?.grand_total)}</strong></div>{receipt?.transaction_type === 'servis' ? <><div><span>Down Payment / DP</span><strong>{formatMoney(receipt?.paid_amount)}</strong></div><div><span>Sisa Pembayaran</span><strong>{formatMoney(remainingAmount)}</strong></div></> : <div><span>Nominal Bayar</span><strong>{formatMoney(receipt?.paid_amount)}</strong></div>}<div><span>Kembalian</span><strong>{formatMoney(receipt?.change_amount)}</strong></div></section>
    <footer className="receipt-footer"><p>{receipt?.receipt_footer_text}</p><strong>{receipt?.receipt_closing_text}</strong></footer>
  </article>;
}

import { useEffect, useState } from 'react';
import { BarChart3, BookOpen, Calculator, CircleDollarSign, FileText, PackageSearch, RefreshCw, Scale, Wallet } from 'lucide-react';
import { getFinancialReport } from '../api/client.js';
import './financial-reports.css';

const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 8)}01`;
const money = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0)).replace('Rp', 'Rp ');
const number = (value) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(value || 0));
const reportTypes = [
  ['profit-loss', 'Laba rugi', BarChart3], ['balance-sheet', 'Neraca', Scale], ['cash-flow', 'Arus kas', Wallet],
  ['trial-balance', 'Neraca saldo', Calculator], ['general-ledger', 'Buku besar', BookOpen], ['inventory', 'Persediaan', PackageSearch],
  ['unit-profit', 'Profit unit', BarChart3], ['service-profit', 'Profit servis', CircleDollarSign], ['receivables', 'Piutang', FileText],
  ['payables', 'Utang', FileText], ['stock-aging', 'Umur stok', RefreshCw]
];

function Summary({ label, value, accent = '' }) { return <div className={`report-summary ${accent}`}><span>{label}</span><strong>{typeof value === 'number' ? money(value) : value}</strong></div>; }
function Completeness({ data }) { if (!data || data.complete) return null; return <div className="report-note">Laporan belum final: {data.legacy_stock_units} unit stok legacy, {data.cash_entries_unreconciled} transaksi kas, dan {data.opening_batches_pending} batch saldo awal masih perlu rekonsiliasi.</div>; }
function Cell({ value }) { return <td>{typeof value === 'number' ? money(value) : String(value ?? '-')}</td>; }
function Table({ columns, rows }) { return <div className="report-table-wrap"><table className="report-table"><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={row.id || row.entry_number || row.unit_code || row.layer_id || index}>{columns.map((column) => <Cell key={column.key} value={row[column.key]} />)}</tr>) : <tr><td colSpan={columns.length} className="report-empty">Tidak ada data pada periode ini.</td></tr>}</tbody></table></div>; }

export default function FinancialReportsPage({ onToast }) {
  const [type, setType] = useState('profit-loss');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const current = reportTypes.find(([key]) => key === type);
  async function load() {
    setLoading(true); setError('');
    try { setData(await getFinancialReport(type, type === 'balance-sheet' || type === 'trial-balance' || type === 'inventory' || type === 'receivables' || type === 'payables' || type === 'stock-aging' ? { as_of: to } : { from, to })); }
    catch (requestError) { setError(requestError.message); onToast?.(requestError.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [type]);
  function renderReport() {
    if (!data) return null;
    if (type === 'profit-loss') return <><Completeness data={data.completeness} /><div className="report-summary-grid"><Summary label="Pendapatan bersih" value={data.net_revenue} accent="income" /><Summary label="Laba kotor" value={data.gross_profit} /><Summary label="Laba / rugi bersih" value={data.net_profit} accent={data.net_profit >= 0 ? 'income' : 'loss'} /></div><Table columns={[{ key: 'code', label: 'Akun' }, { key: 'name', label: 'Nama' }, { key: 'type', label: 'Jenis' }, { key: 'amount', label: 'Mutasi' }]} rows={data.rows} /></>;
    if (type === 'balance-sheet') return <><Completeness data={data.completeness} /><div className="report-summary-grid"><Summary label="Total aset" value={data.total_assets} /><Summary label="Liabilitas" value={data.total_liabilities} /><Summary label="Ekuitas + laba berjalan" value={data.total_equity} accent={data.balanced ? 'income' : 'loss'} /><Summary label="Selisih neraca" value={data.difference} accent={data.balanced ? 'income' : 'loss'} /></div><div className="report-note">{data.balanced ? 'Neraca seimbang: aset = liabilitas + ekuitas.' : 'Neraca belum seimbang; periksa jurnal posted dan saldo awal.'}</div><Table columns={[{ key: 'code', label: 'Akun' }, { key: 'name', label: 'Nama' }, { key: 'amount', label: 'Saldo' }]} rows={[...data.assets, ...data.liabilities, ...data.equity, { code: 'CURRENT', name: 'Laba berjalan', amount: data.current_earnings }]} /></>;
    if (type === 'cash-flow') return <><div className="report-summary-grid"><Summary label="Operasi" value={data.operating} /><Summary label="Investasi" value={data.investing} /><Summary label="Pendanaan" value={data.financing} /><Summary label="Perubahan kas bersih" value={data.net_change} /></div><div className="report-note">{data.limitation}</div><Table columns={[{ key: 'posting_date', label: 'Tanggal' }, { key: 'entry_number', label: 'Jurnal' }, { key: 'description', label: 'Deskripsi' }, { key: 'activity', label: 'Aktivitas' }, { key: 'amount', label: 'Arus' }]} rows={data.lines} /></>;
    if (type === 'trial-balance') return <><div className="report-summary-grid"><Summary label="Total debit" value={data.totals.debit} /><Summary label="Total kredit" value={data.totals.credit} /><Summary label="Status" value={data.balanced ? 'Seimbang' : 'Tidak seimbang'} accent={data.balanced ? 'income' : 'loss'} /></div><Table columns={[{ key: 'code', label: 'Kode' }, { key: 'name', label: 'Nama akun' }, { key: 'debit_balance', label: 'Debit akhir' }, { key: 'credit_balance', label: 'Kredit akhir' }]} rows={data.accounts} /></>;
    if (type === 'general-ledger') return <Table columns={[{ key: 'posting_date', label: 'Tanggal' }, { key: 'entry_number', label: 'Jurnal' }, { key: 'reference', label: 'Referensi' }, { key: 'account_code', label: 'Akun' }, { key: 'description', label: 'Deskripsi' }, { key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Kredit' }, { key: 'running_balance', label: 'Saldo berjalan' }]} rows={data.lines} />;
    if (type === 'inventory') return <><div className="report-summary-grid"><Summary label="Laptop/unit tervaluasi" value={data.unit_value} /><Summary label="Spare part" value={data.part_value} /><Summary label="Legacy referensi" value={data.legacy_value_reference_only} /></div><div className="report-note">{data.limitation}</div><Table columns={[{ key: 'unit_code', label: 'Unit' }, { key: 'product_name', label: 'Produk' }, { key: 'serial_number', label: 'Serial' }, { key: 'status', label: 'Status' }, { key: 'value', label: 'Nilai' }]} rows={data.units} /></>;
    if (type === 'unit-profit') return <><div className="report-summary-grid"><Summary label="Penjualan bersih" value={data.total_sales} /><Summary label="HPP unit" value={data.total_hpp} /><Summary label="Laba unit" value={data.total_profit} accent={data.total_profit >= 0 ? 'income' : 'loss'} /></div><Table columns={[{ key: 'unit_code', label: 'Unit' }, { key: 'product_name', label: 'Produk' }, { key: 'invoice_number', label: 'Invoice' }, { key: 'net_sales', label: 'Penjualan bersih' }, { key: 'hpp', label: 'HPP' }, { key: 'gross_profit', label: 'Laba' }]} rows={data.rows} /></>;
    if (type === 'service-profit') return <><div className="report-summary-grid"><Summary label="Pendapatan servis" value={data.revenue} /><Summary label="HPP servis" value={data.hpp} /><Summary label="Laba servis" value={data.gross_profit} accent={data.gross_profit >= 0 ? 'income' : 'loss'} /></div></>;
    if (type === 'receivables' || type === 'payables') return <><div className="report-summary-grid"><Summary label={type === 'receivables' ? 'Total piutang' : 'Total utang'} value={data.total} /></div><Table columns={[{ key: 'invoice_number', label: 'Referensi' }, { key: 'customer_name', label: 'Pelanggan' }, { key: 'code', label: 'Akun' }, { key: 'name', label: 'Nama akun' }, { key: 'balance', label: 'Saldo' }]} rows={data.rows} /></>;
    return <><div className="report-summary-grid">{['0-30', '31-60', '61-90', '90+'].map((bucket) => <Summary key={bucket} label={`${bucket} hari`} value={data.buckets[bucket] || 0} />)}</div><Table columns={[{ key: 'kind', label: 'Jenis' }, { key: 'unit_code', label: 'Unit/layer' }, { key: 'product_name', label: 'Produk' }, { key: 'age_days', label: 'Umur hari' }, { key: 'value', label: 'Nilai' }]} rows={data.rows} /></>;
  }
  return <section className="reports-page"><div className="page-heading reports-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> LAPORAN KEUANGAN</div><h1>Angka yang <em>terrekonsiliasi.</em></h1><p>Sumber: jurnal posted dan subledger persediaan.</p></div></div><section className="panel reports-panel"><div className="report-toolbar"><div className="report-tabs">{reportTypes.map(([key, label, Icon]) => <button key={key} className={type === key ? 'selected' : ''} onClick={() => setType(key)}><Icon size={14} /> {label}</button>)}</div><div className="report-filters"><label>Dari<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Sampai / as of<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="button primary" onClick={load} disabled={loading}>{loading ? 'Memuat...' : 'Terapkan'}</button></div></div><div className="report-title"><h2>{current?.[1]}</h2><span>{type === 'balance-sheet' || type === 'trial-balance' || type === 'inventory' || type === 'receivables' || type === 'payables' || type === 'stock-aging' ? `Per ${to}` : `${from} – ${to}`}</span></div>{error ? <div className="report-error">{error}</div> : loading ? <div className="report-loading">Memuat laporan...</div> : renderReport()}</section></section>;
}

import { useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  HandCoins,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  createCashEntry,
  createCashAdvance,
  deleteCashEntry,
  getCashAdvances,
  getCashEntries,
  reimburseCashAdvance,
  updateCashEntry,
} from "../api/cash.js";
import "./cash-ledger.css";

const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 8)}01`;
const emptyForm = {
  entry_type: "pengeluaran",
  category: "",
  description: "",
  amount: "",
  entry_date: today,
};
const emptyAdvanceForm = {
  lenderName: "Febry",
  category: "Makan/minum",
  description: "",
  amount: "",
  expenseDate: today,
  expenseAccountCode: "6200",
};
const money = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export default function CashLedgerPage({ onToast }) {
  const [range, setRange] = useState({ from: monthStart, to: today });
  const [data, setData] = useState({
    entries: [],
    summary: { pemasukan_manual: 0, pengeluaran: 0, penjualan: 0 },
  });
  const [advanceData, setAdvanceData] = useState({ expenses: [], outstanding: 0 });
  const [form, setForm] = useState(emptyForm);
  const [advanceForm, setAdvanceForm] = useState(emptyAdvanceForm);
  const [repayment, setRepayment] = useState(null);
  const [repaymentForm, setRepaymentForm] = useState({ amount: "", paidDate: today, cashAccountCode: "1110" });
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showAdvanceForm, setShowAdvanceForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  async function load() {
    setLoading(true);
    try {
      const [cash, advances] = await Promise.all([
        getCashEntries(range.from, range.to),
        getCashAdvances(range.from, range.to),
      ]);
      setData(cash);
      setAdvanceData(advances);
    } catch (requestError) {
      onToast(requestError.message);
    } finally {
      setLoading(false);
    }
  }
  function openAdvanceForm() {
    setAdvanceForm({ ...emptyAdvanceForm, expenseDate: range.to });
    setError("");
    setShowAdvanceForm(true);
  }
  async function submitAdvance(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await createCashAdvance({
        ...advanceForm,
        amount: Number(advanceForm.amount),
        idempotencyKey: crypto.randomUUID(),
      });
      setShowAdvanceForm(false);
      await load();
      onToast("Talangan dicatat sebagai utang toko");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }
  function openRepayment(expense) {
    setRepayment(expense);
    setRepaymentForm({
      amount: String(expense.outstanding_amount),
      paidDate: today,
      cashAccountCode: "1110",
    });
    setError("");
  }
  async function submitRepayment(event) {
    event.preventDefault();
    if (!repayment) return;
    setSaving(true);
    setError("");
    try {
      await reimburseCashAdvance(repayment.id, {
        ...repaymentForm,
        amount: Number(repaymentForm.amount),
        idempotencyKey: crypto.randomUUID(),
      });
      setRepayment(null);
      await load();
      onToast("Penggantian talangan dicatat");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    load();
  }, [range.from, range.to]);
  const totalIncome =
    Number(data.summary.penjualan) + Number(data.summary.pemasukan_manual);
  const balance = totalIncome - Number(data.summary.pengeluaran);
  const pageCount = Math.max(1, Math.ceil(data.entries.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleEntries = data.entries.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function openCreate(type = "pengeluaran") {
    setEditingId(null);
    setForm({ ...emptyForm, entry_type: type, entry_date: range.to });
    setError("");
    setShowForm(true);
  }
  function openEdit(entry) {
    setEditingId(entry.id);
    setForm({
      entry_type: entry.entry_type,
      category: entry.category,
      description: entry.description,
      amount: entry.amount,
      entry_date: entry.entry_date,
    });
    setError("");
    setShowForm(true);
  }
  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editingId)
        await updateCashEntry(editingId, {
          ...form,
          amount: Number(form.amount),
        });
      else await createCashEntry({ ...form, amount: Number(form.amount) });
      await load();
      closeForm();
      onToast(
        editingId ? "Catatan kas diperbarui" : "Catatan kas berhasil disimpan",
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }
  async function remove(entry) {
    if (!window.confirm("Hapus catatan kas ini?")) return;
    try {
      await deleteCashEntry(entry.id);
      setData((current) => ({
        ...current,
        entries: current.entries.filter((item) => item.id !== entry.id),
      }));
      onToast("Catatan kas dihapus");
    } catch (requestError) {
      onToast(requestError.message);
    }
  }

  return (
    <>
      <section className="page-heading cash-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> ARUS KAS TOKO
          </div>
          <h1>
            Pemasukan dan <em>pengeluaran.</em>
          </h1>
          <p>
            Catat biaya operasional dan pantau posisi kas toko dalam satu
            tempat.
          </p>
        </div>
        <div className="heading-actions">
          <button className="button ghost" onClick={openAdvanceForm}>
            <HandCoins size={16} /> Catat talangan
          </button>
          <button
            className="button ghost"
            onClick={() => openCreate("pengeluaran")}
          >
            <ArrowDownLeft size={16} /> Pengeluaran
          </button>
          <button
            className="button primary"
            onClick={() => openCreate("pemasukan")}
          >
            <ArrowUpRight size={16} /> Pemasukan
          </button>
        </div>
      </section>
      <section className="cash-page">
        <div className="cash-toolbar">
          <div>
            <strong>Periode laporan</strong>
            <span>{data.entries.length} catatan kas</span>
          </div>
          <div className="date-range">
            <label>
              Dari
              <input
                type="date"
                value={range.from}
                onChange={(event) => {
                  setRange({ ...range, from: event.target.value });
                  setPage(1);
                }}
              />
            </label>
            <label>
              Sampai
              <input
                type="date"
                value={range.to}
                onChange={(event) => {
                  setRange({ ...range, to: event.target.value });
                  setPage(1);
                }}
              />
            </label>
          </div>
        </div>
        <div className="cash-summary">
          <div className="cash-summary-card income">
            <ArrowUpRight size={18} />
            <span>Total pemasukan</span>
            <strong>{money.format(totalIncome)}</strong>
            <small>
              Penjualan {money.format(data.summary.penjualan)} + manual
            </small>
          </div>
          <div className="cash-summary-card expense">
            <ArrowDownLeft size={18} />
            <span>Total pengeluaran</span>
            <strong>{money.format(data.summary.pengeluaran)}</strong>
            <small>Termasuk refund, penggantian talangan, dan biaya manual</small>
          </div>
          <div className="cash-summary-card balance">
            <CircleDollarSign size={18} />
            <span>Saldo bersih</span>
            <strong>{money.format(balance)}</strong>
            <small>Perhitungan periode terpilih</small>
          </div>
        </div>
        <section className="panel cash-list-panel">
          <div className="panel-header">
            <div>
              <h2>Catatan kas</h2>
              <p>Pemasukan dan pengeluaran dari transaksi maupun catatan manual.</p>
            </div>
          </div>
          {loading ? (
            <div className="empty-state">Memuat catatan kas...</div>
          ) : data.entries.length ? (
            <div className="cash-list">
              {visibleEntries.map((entry) => (
                <div className="cash-row" key={entry.id}>
                  <div className={`cash-type ${entry.entry_type}`}>
                    <>
                      {entry.entry_type === "pemasukan" ? (
                        <ArrowUpRight size={16} />
                      ) : (
                        <ArrowDownLeft size={16} />
                      )}
                    </>
                  </div>
                  <div>
                    <strong>{entry.description}</strong>
                    <small>
                      {entry.category} · {entry.entry_date}
                      {entry.created_by_name
                        ? ` · ${entry.created_by_name}`
                        : ""}
                    </small>
                  </div>
                  <strong
                    className={
                      entry.entry_type === "pemasukan"
                        ? "income-text"
                        : "expense-text"
                    }
                  >
                    {entry.entry_type === "pemasukan" ? "+" : "-"}{" "}
                    {money.format(entry.amount)}
                  </strong>
                  {entry.source === "manual" && <div className="cash-actions">
                    <button
                      className="icon-button bordered"
                      onClick={() => openEdit(entry)}
                      title="Edit catatan"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-button bordered danger-icon"
                      onClick={() => remove(entry)}
                      title="Hapus catatan"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <CircleDollarSign size={30} />
              <strong>Belum ada catatan kas</strong>
              <span>
                Tambahkan pemasukan atau pengeluaran untuk periode ini.
              </span>
            </div>
          )}
          {!loading && data.entries.length > 0 && (
            <div className="inventory-pagination cash-pagination">
              <label className="inventory-page-size">
                Tampilkan
                <select
                  aria-label="Catatan kas per halaman"
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
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
                  aria-label="Halaman kas sebelumnya"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button bordered"
                  aria-label="Halaman kas berikutnya"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </section>
        <section className="panel cash-list-panel advance-panel">
          <div className="panel-header">
            <div>
              <h2>Talangan pengeluaran toko</h2>
              <p>Pengeluaran ditalangi tidak mengurangi kas toko sampai penggantian dibayar.</p>
            </div>
            <strong className="advance-outstanding">
              Belum diganti {money.format(advanceData.outstanding)}
            </strong>
          </div>
          {advanceData.expenses.length ? (
            <div className="advance-list">
              {advanceData.expenses.map((expense) => (
                <div className="advance-row" key={expense.id}>
                  <div>
                    <strong>{expense.description}</strong>
                    <small>
                      {expense.category} · Ditalangi {expense.lender_name} · {expense.expense_date}
                    </small>
                  </div>
                  <div>
                    <strong>{money.format(expense.amount)}</strong>
                    <small>
                      Sudah diganti {money.format(expense.reimbursed_amount)} · Sisa {money.format(expense.outstanding_amount)}
                    </small>
                  </div>
                  {expense.outstanding_amount > 0 ? (
                    <button className="button ghost" onClick={() => openRepayment(expense)}>
                      Catat penggantian
                    </button>
                  ) : <span className="advance-paid">Lunas</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">Belum ada talangan untuk periode ini.</div>
          )}
        </section>
      </section>
      {showForm && (
        <div className="modal-backdrop">
          <form className="modal-card" onSubmit={submit}>
            <div className="modal-header">
              <h2>{editingId ? "Edit catatan kas" : "Catat kas baru"}</h2>
              <button type="button" className="icon-button" onClick={closeForm}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-form">
              <div className="form-grid">
                <label className="form-field">
                  <span>
                    Jenis catatan<b>*</b>
                  </span>
                  <select
                    value={form.entry_type}
                    onChange={(event) =>
                      setForm({ ...form, entry_type: event.target.value })
                    }
                  >
                    <option value="pemasukan">Pemasukan</option>
                    <option value="pengeluaran">Pengeluaran</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>
                    Tanggal<b>*</b>
                  </span>
                  <input
                    required
                    type="date"
                    value={form.entry_date}
                    onChange={(event) =>
                      setForm({ ...form, entry_date: event.target.value })
                    }
                  />
                </label>
              </div>
              <label className="form-field">
                <span>
                  Kategori<b>*</b>
                </span>
                <input
                  required
                  value={form.category}
                  onChange={(event) =>
                    setForm({ ...form, category: event.target.value })
                  }
                  placeholder={
                    form.entry_type === "pemasukan"
                      ? "Contoh: Modal tambahan"
                      : "Contoh: Listrik, transportasi"
                  }
                />
              </label>
              <label className="form-field">
                <span>
                  Keterangan<b>*</b>
                </span>
                <input
                  required
                  value={form.description}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                  placeholder="Jelaskan transaksi kas"
                />
              </label>
              <label className="form-field">
                <span>
                  Nominal<b>*</b>
                </span>
                <input
                  required
                  min="1"
                  type="number"
                  value={form.amount}
                  onChange={(event) =>
                    setForm({ ...form, amount: event.target.value })
                  }
                  placeholder="0"
                />
              </label>
              {error && <p className="login-error">{error}</p>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="button ghost"
                  onClick={closeForm}
                >
                  Batal
                </button>
                <button
                  disabled={saving}
                  type="submit"
                  className="button primary"
                >
                  {saving ? "Menyimpan..." : "Simpan catatan"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
      {showAdvanceForm && (
        <div className="modal-backdrop">
          <form className="modal-card" onSubmit={submitAdvance}>
            <div className="modal-header">
              <h2>Catat pengeluaran ditalangi</h2>
              <button type="button" className="icon-button" onClick={() => setShowAdvanceForm(false)}><X size={18} /></button>
            </div>
            <div className="modal-form">
              <p className="advance-notice">Untuk biaya operasional toko yang dibayar uang pribadi. Pembelian stok laptop/part dan pengeluaran pribadi owner dicatat melalui alur terpisah.</p>
              <label className="form-field"><span>Ditalangi oleh<b>*</b></span><input required maxLength="120" value={advanceForm.lenderName} onChange={(event) => setAdvanceForm({ ...advanceForm, lenderName: event.target.value })} /></label>
              <div className="form-grid">
                <label className="form-field"><span>Kategori<b>*</b></span><select value={advanceForm.category} onChange={(event) => setAdvanceForm({ ...advanceForm, category: event.target.value, expenseAccountCode: event.target.value === "Operasional toko" ? "6300" : event.target.value === "Perbaikan abnormal" ? "6500" : event.target.value === "Pengeluaran pribadi owner" ? "3120" : "6200" })}><option>Makan/minum</option><option>Perlengkapan/konsumsi</option><option>Operasional toko</option><option>Perbaikan abnormal</option><option>Pengeluaran pribadi owner</option></select></label>
                <label className="form-field"><span>Tanggal<b>*</b></span><input required type="date" value={advanceForm.expenseDate} onChange={(event) => setAdvanceForm({ ...advanceForm, expenseDate: event.target.value })} /></label>
              </div>
              <label className="form-field"><span>Keterangan<b>*</b></span><input required maxLength="500" value={advanceForm.description} onChange={(event) => setAdvanceForm({ ...advanceForm, description: event.target.value })} placeholder="Contoh: makan malam karyawan" /></label>
              <label className="form-field"><span>Nominal<b>*</b></span><input required min="1" type="number" value={advanceForm.amount} onChange={(event) => setAdvanceForm({ ...advanceForm, amount: event.target.value })} /></label>
              {error && <p className="login-error">{error}</p>}
              <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setShowAdvanceForm(false)}>Batal</button><button disabled={saving} type="submit" className="button primary">{saving ? "Menyimpan..." : "Simpan talangan"}</button></div>
            </div>
          </form>
        </div>
      )}
      {repayment && (
        <div className="modal-backdrop">
          <form className="modal-card" onSubmit={submitRepayment}>
            <div className="modal-header">
              <h2>Ganti talangan · {repayment.lender_name}</h2>
              <button type="button" className="icon-button" onClick={() => setRepayment(null)}><X size={18} /></button>
            </div>
            <div className="modal-form">
              <p className="advance-notice">Sisa utang: {money.format(repayment.outstanding_amount)}. Pembayaran akan mengurangi kas toko dan utang, bukan mencatat beban baru.</p>
              <label className="form-field"><span>Nominal penggantian<b>*</b></span><input required min="1" max={repayment.outstanding_amount} type="number" value={repaymentForm.amount} onChange={(event) => setRepaymentForm({ ...repaymentForm, amount: event.target.value })} /></label>
              <div className="form-grid">
                <label className="form-field"><span>Tanggal<b>*</b></span><input required type="date" value={repaymentForm.paidDate} onChange={(event) => setRepaymentForm({ ...repaymentForm, paidDate: event.target.value })} /></label>
                <label className="form-field"><span>Dibayar dari<b>*</b></span><select value={repaymentForm.cashAccountCode} onChange={(event) => setRepaymentForm({ ...repaymentForm, cashAccountCode: event.target.value })}><option value="1110">Kas toko</option><option value="1120">Bank</option><option value="1130">QRIS</option></select></label>
              </div>
              {error && <p className="login-error">{error}</p>}
              <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setRepayment(null)}>Batal</button><button disabled={saving} type="submit" className="button primary">{saving ? "Menyimpan..." : "Catat penggantian"}</button></div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

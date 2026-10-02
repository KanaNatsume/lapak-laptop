import { useEffect, useState } from 'react';
import { Check, FileText, Save, Settings } from 'lucide-react';
import { getSettings, updateSettings } from '../api/client.js';

const defaults = {
  store_name: 'Lapak Laptop',
  store_address: '',
  store_phone: '',
  receipt_footer_text: 'Garansi toko berlaku sesuai ketentuan yang tertera.',
  receipt_closing_text: 'Terima kasih telah berbelanja.',
  paper_size_preference: '58mm',
  opening_time: '09:00',
  closing_time: '21:00'
};

export default function SettingsPage({ onSaved }) {
  const [form, setForm] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then((settings) => setForm({ ...defaults, ...settings })).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const settings = await updateSettings(form);
      setForm(settings);
      setSaved(true);
      onSaved?.('Pengaturan toko berhasil disimpan', settings);
      setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      onSaved?.(error.message);
    } finally {
      setSaving(false);
    }
  }

  return <section className="settings-page">
    <div className="settings-heading">
      <div><div className="settings-eyebrow"><Settings size={14} /> KONFIGURASI NOTA</div><h1>Pengaturan toko</h1><p>Atur identitas toko dan tampilan nota penjualan.</p></div>
      {saved && <div className="settings-saved"><Check size={15} /> Tersimpan</div>}
    </div>
    <div className="settings-layout"><form onSubmit={submit} className="settings-card">
      {loading ? <p className="settings-loading">Memuat pengaturan...</p> : <>
        <div className="settings-section-title"><span>01</span><div><strong>Identitas toko</strong><small>Informasi yang tampil pada bagian atas nota.</small></div></div>
        <div className="settings-grid">
          <label className="settings-field">Nama toko<input required value={form.store_name} onChange={update('store_name')} /></label>
          <label className="settings-field">Nomor HP<input value={form.store_phone} onChange={update('store_phone')} placeholder="08xxxxxxxxxx" /></label>
        </div>
        <label className="settings-field settings-field-full">Alamat toko<textarea value={form.store_address} onChange={update('store_address')} rows="2" /></label>
        <div className="settings-section-title settings-section-spaced"><span>02</span><div><strong>Jam operasional</strong><small>Jam ini tampil di sidebar dan membantu tim mengetahui jadwal toko.</small></div></div>
        <div className="settings-grid"><label className="settings-field">Buka<input type="time" value={form.opening_time} onChange={update('opening_time')} /></label><label className="settings-field">Tutup<input type="time" value={form.closing_time} onChange={update('closing_time')} /></label></div>
        <div className="settings-section-title settings-section-spaced"><span>03</span><div><strong>Pesan pada nota</strong><small>Gunakan teks singkat agar tetap terbaca di kertas thermal.</small></div></div>
        <div className="settings-grid">
          <label className="settings-field">Teks garansi / footer<textarea value={form.receipt_footer_text} onChange={update('receipt_footer_text')} rows="4" placeholder="Garansi toko berlaku..." /></label>
          <label className="settings-field">Teks penutup nota<textarea value={form.receipt_closing_text} onChange={update('receipt_closing_text')} rows="4" placeholder="Terima kasih..." /></label>
        </div>
        <fieldset className="settings-paper"><legend>Ukuran kertas nota</legend><div>{['58mm', '80mm', 'A4'].map((size) => <label key={size} className={form.paper_size_preference === size ? 'selected' : ''}><input type="radio" name="paper_size" value={size} checked={form.paper_size_preference === size} onChange={update('paper_size_preference')} /><strong>{size}</strong><small>{size === 'A4' ? 'Invoice standar' : 'Thermal kasir'}</small></label>)}</div></fieldset>
        <div className="settings-actions"><button disabled={saving} className="settings-save"><Save size={15} /> {saving ? 'Menyimpan...' : 'Simpan pengaturan'}</button></div>
      </>}
    </form><aside className="settings-preview"><div className="preview-label"><FileText size={14} /> PREVIEW NOTA</div><div className={`mini-receipt ${form.paper_size_preference === 'A4' ? 'a4' : ''}`}><strong>{form.store_name || 'Nama toko'}</strong><span>{form.store_address || 'Alamat toko'}</span><span>{form.store_phone || 'Nomor telepon'}</span><hr /><div className="preview-row"><span>Nota</span><span>INV-0001</span></div><div className="preview-row"><span>Nama pelanggan</span><span>Umum</span></div><hr /><div className="preview-item"><span>ThinkPad X1 Carbon</span><b>Rp 8.750.000</b><small>SN: PF2K9X1A</small></div><div className="preview-row total"><strong>Total</strong><strong>Rp 8.750.000</strong></div><hr /><small>{form.receipt_footer_text || 'Teks garansi tampil di sini.'}</small><b>{form.receipt_closing_text || 'Teks penutup tampil di sini.'}</b></div><p>Preview menyesuaikan ukuran {form.paper_size_preference} yang dipilih.</p></aside></div>
  </section>;
}

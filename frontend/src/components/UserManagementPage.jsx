import { useEffect, useState } from 'react';
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserCheck, UserRound, UserX, UsersRound, X } from 'lucide-react';
import { createUser, deleteUser, getUsers, resetUserPassword, updateUser } from '../api/client.js';
import './user-management.css';

const roles = {
  admin: { label: 'Admin', description: 'Akses penuh, termasuk user dan pengaturan.', color: 'admin' },
  kasir: { label: 'Kasir', description: 'Kasir, transaksi, inventori, dan pelanggan.', color: 'cashier' },
  teknisi: { label: 'Teknisi', description: 'Antrian servis dan progres pekerjaan teknis.', color: 'technician' }
};

const emptyForm = { name: '', username: '', password: '', role: 'kasir', active: true };

export default function UserManagementPage({ currentUser, onCurrentUserUpdated, onToast }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [passwordId, setPasswordId] = useState(null);
  const [password, setPassword] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadUsers() {
    try { setUsers(await getUsers()); } catch (requestError) { onToast(requestError.message); } finally { setLoading(false); }
  }
  useEffect(() => { loadUsers(); }, []);

  const filteredUsers = users.filter((user) => `${user.name} ${user.username} ${user.role}`.toLowerCase().includes(search.toLowerCase()));
  const activeCount = users.filter((user) => user.active).length;

  function startCreate() { setEditingId(null); setForm(emptyForm); setError(''); setShowForm(true); }
  function startEdit(user) { setEditingId(user.id); setForm({ name: user.name, username: user.username, password: '', role: user.role, active: Boolean(user.active) }); setError(''); setShowForm(true); }
  function closeForm() { setEditingId(null); setForm(emptyForm); setError(''); setShowForm(false); }

  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const saved = editingId
        ? await updateUser(editingId, { name: form.name, username: form.username, role: form.role, active: form.active })
        : await createUser(form);
      setUsers((current) => editingId ? current.map((user) => user.id === saved.id ? saved : user) : [saved, ...current]);
      if (saved.id === currentUser.id) onCurrentUserUpdated(saved);
      closeForm(); onToast(editingId ? 'Data user berhasil diperbarui' : 'User baru berhasil dibuat');
    } catch (requestError) { setError(requestError.message); } finally { setSaving(false); }
  }

  async function toggleStatus(user) {
    try {
      const saved = await updateUser(user.id, { active: !Boolean(user.active) });
      setUsers((current) => current.map((item) => item.id === saved.id ? saved : item));
      if (saved.id === currentUser.id) onCurrentUserUpdated(saved);
      onToast(saved.active ? 'User diaktifkan' : 'User dinonaktifkan');
    } catch (requestError) { onToast(requestError.message); }
  }

  async function submitPassword(event) {
    event.preventDefault();
    try { await resetUserPassword(passwordId, password); setPasswordId(null); setPassword(''); onToast('Password user berhasil direset'); }
    catch (requestError) { setError(requestError.message); }
  }

  async function removeUser(user) {
    if (!window.confirm(`Hapus user ${user.name}?`)) return;
    try { await deleteUser(user.id); setUsers((current) => current.filter((item) => item.id !== user.id)); onToast('User berhasil dihapus'); }
    catch (requestError) { onToast(requestError.message); }
  }

  return <><section className="page-heading user-management-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> ADMINISTRASI AKSES</div><h1>User dan <em>hak akses.</em></h1><p>Kelola akun tim, level kerja, dan status akses aplikasi.</p></div><button className="button primary" onClick={startCreate}><Plus size={17} /> Tambah user</button></section><section className="user-management-page"><div className="access-summary">{Object.entries(roles).map(([key, role]) => <div className={`access-summary-card ${role.color}`} key={key}><div className="access-summary-icon"><ShieldCheck size={17} /></div><div><strong>{users.filter((user) => user.role === key).length}</strong><span>{role.label}</span></div></div>)}<div className="access-summary-card active"><div className="access-summary-icon"><UserCheck size={17} /></div><div><strong>{activeCount}</strong><span>User aktif</span></div></div></div><section className="panel user-management-panel"><div className="panel-header"><div><h2>Daftar user</h2><p>{users.length} akun terdaftar · {activeCount} aktif</p></div><div className="search-field user-search"><UserRound size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama atau username..." /></div></div>{loading ? <div className="empty-state">Memuat user...</div> : <div className="user-list">{filteredUsers.length ? filteredUsers.map((user) => <div className="user-row" key={user.id}><div className="user-identity"><div className="avatar">{user.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</div><div><strong>{user.name}</strong><small>@{user.username}</small></div></div><div><span className={`role-badge ${roles[user.role]?.color}`}>{roles[user.role]?.label || user.role}</span><small className="role-description">{roles[user.role]?.description}</small></div><span className={`status-badge ${user.active ? 'active' : 'inactive'}`}>{user.active ? 'Aktif' : 'Nonaktif'}</span><div className="user-actions"><button className="icon-button bordered" title="Edit user" onClick={() => startEdit(user)}><Pencil size={15} /></button><button className="icon-button bordered" title="Reset password" onClick={() => { setPasswordId(user.id); setPassword(''); setError(''); }}><KeyRound size={15} /></button><button className="icon-button bordered" title={user.active ? 'Nonaktifkan user' : 'Aktifkan user'} onClick={() => toggleStatus(user)}>{user.active ? <UserX size={15} /> : <UserCheck size={15} />}</button><button className="icon-button bordered danger-icon" title="Hapus user" onClick={() => removeUser(user)}><Trash2 size={15} /></button></div></div>) : <div className="empty-state"><UsersRound size={30} /><strong>User tidak ditemukan</strong><span>Ubah kata kunci pencarian atau tambahkan user baru.</span></div>}</div>}</section></section>{showForm && <div className="modal-backdrop"><form className="modal-card" onSubmit={submit}><div className="modal-header"><h2>{editingId ? 'Edit user' : 'Tambah user'}</h2><button type="button" className="icon-button" onClick={closeForm}><X size={18} /></button></div><div className="modal-form"><div className="form-grid"><label className="form-field"><span>Nama lengkap<b>*</b></span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nama anggota tim" /></label><label className="form-field"><span>Username<b>*</b></span><input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="username login" /></label></div>{!editingId && <label className="form-field"><span>Password awal<b>*</b></span><input required minLength="10" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Minimal 10 karakter" /></label>}<div className="form-grid"><label className="form-field"><span>Level akses<b>*</b></span><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{Object.entries(roles).map(([key, role]) => <option key={key} value={key}>{role.label}</option>)}</select></label>{editingId && <label className="form-field"><span>Status akun</span><select value={form.active ? '1' : '0'} onChange={(event) => setForm({ ...form, active: event.target.value === '1' })}><option value="1">Aktif</option><option value="0">Nonaktif</option></select></label>}</div><div className="form-note"><ShieldCheck size={15} /><span>{roles[form.role].description}</span></div>{error && <p className="login-error">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={closeForm}>Batal</button><button disabled={saving} type="submit" className="button primary">{saving ? 'Menyimpan...' : 'Simpan user'}</button></div></div></form></div>}{passwordId !== null && <div className="modal-backdrop"><form className="modal-card" onSubmit={submitPassword}><div className="modal-header"><h2>Reset password</h2><button type="button" className="icon-button" onClick={() => setPasswordId(null)}><X size={18} /></button></div><div className="modal-form"><p className="form-hint">Password lama tidak diperlukan. User akan diminta memakai password baru ini saat login berikutnya.</p><label className="form-field"><span>Password baru<b>*</b></span><input required minLength="10" autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Minimal 10 karakter" /></label>{error && <p className="login-error">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={() => setPasswordId(null)}>Batal</button><button type="submit" className="button primary">Reset password</button></div></div></form></div>}</>;
}

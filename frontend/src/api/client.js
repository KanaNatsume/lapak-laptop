export const api = async (path, options = {}) => {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: { ...(!isFormData ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const body = response.status === 204 ? null : await response.json();
  if (response.status === 401) {
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_user');
    window.location.reload();
    throw new Error(body.error || 'Login diperlukan');
  }
  if (!response.ok) throw new Error(body?.errors?.length ? `${body.error}: ${body.errors.join('; ')}` : body?.error || 'Permintaan gagal');
  return body;
};

export const getProducts = (search = '', includeOutOfStock = false) => api(`/products?search=${encodeURIComponent(search)}${includeOutOfStock ? '&include_out_of_stock=true' : ''}`);
export const getCustomers = (search = '') => api(`/customers?search=${encodeURIComponent(search)}`);
export const getServices = () => api('/services');
export const getServiceAccess = (id) => api(`/services/${id}/access`);
export const getServiceOpeningReceipt = (id) => api(`/services/${id}/opening-receipt`);
export const getTransactions = () => api('/transactions');
export const getSettings = () => api('/settings');
export const updateSettings = (payload) => api('/settings', { method: 'PUT', body: JSON.stringify(payload) });
export const getReceipt = (id) => api(`/transactions/${id}/receipt`);
export const payTransaction = (id, amount) => api(`/transactions/${id}/payment`, { method: 'POST', body: JSON.stringify({ amount }) });
export const refundTransaction = (id, reason) => api(`/transactions/${id}/refund`, { method: 'POST', body: JSON.stringify({ reason }) });
export const createProduct = (payload) => api('/products', { method: 'POST', body: JSON.stringify(payload) });
export const updateProduct = (id, payload) => api(`/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const deleteProduct = (id) => api(`/products/${id}`, { method: 'DELETE' });
export const importProducts = (file) => api('/products/import', { method: 'POST', body: (() => { const form = new FormData(); form.append('file', file); return form; })() });
export const downloadProductImportTemplate = async () => {
  const response = await fetch('/api/products/import/template', { credentials: 'include' });
  if (!response.ok) throw new Error('Template Excel tidak dapat diunduh');
  const link = document.createElement('a'); link.href = URL.createObjectURL(await response.blob()); link.download = 'template-import-produk.xlsx'; link.click(); URL.revokeObjectURL(link.href);
};
export const createCustomer = (payload) => api('/customers', { method: 'POST', body: JSON.stringify(payload) });
export const importAroniumCustomers = (file) => api('/customers/import/aronium', { method: 'POST', body: (() => { const form = new FormData(); form.append('file', file); return form; })() });
export const createTransaction = (payload) => api('/transactions', { method: 'POST', body: JSON.stringify(payload) });
export const createService = (payload) => api('/services', { method: 'POST', body: JSON.stringify(payload) });
export const updateServiceStatus = (id, payload) => api(`/services/${id}/status`, { method: 'PATCH', body: JSON.stringify(payload) });
export const login = (payload) => api('/auth/login', { method: 'POST', body: JSON.stringify(payload) });
export const logout = () => api('/auth/logout', { method: 'POST' });
export const changePassword = (payload) => api('/auth/password', { method: 'PUT', body: JSON.stringify(payload) });
export const getNotifications = () => api('/notifications');
export const getUsers = () => api('/users');
export const createUser = (payload) => api('/users', { method: 'POST', body: JSON.stringify(payload) });
export const updateUser = (id, payload) => api(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const resetUserPassword = (id, password) => api(`/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) });
export const deleteUser = (id) => api(`/users/${id}`, { method: 'DELETE' });
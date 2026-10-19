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
export const getInventoryUnits = (productId, status) => api(`/inventory/units${productId ? `?product_id=${encodeURIComponent(productId)}${status ? `&status=${encodeURIComponent(status)}` : ''}` : status ? `?status=${encodeURIComponent(status)}` : ''}`);
export const getInventoryUnitMovements = (id) => api(`/inventory/units/${id}/movements`);
export const getInventoryUnitCosts = (id) => api(`/inventory/units/${id}/cost-components`);
export const updateInventoryUnitStatus = (id, payload) => api(`/inventory/units/${id}/status`, { method: 'PATCH', body: JSON.stringify(payload) });
export const getInventoryPurchases = () => api('/inventory/purchases');
export const getInventoryPurchase = (id) => api(`/inventory/purchases/${id}`);
export const createInventoryPurchase = (payload) => api('/inventory/purchases', { method: 'POST', body: JSON.stringify(payload) });
export const getSuppliers = () => api('/suppliers');
export const createSupplier = (payload) => api('/suppliers', { method: 'POST', body: JSON.stringify(payload) });
export const getFreightFulfillments = (transactionId) => api(`/freight/fulfillments${transactionId ? `?transaction_id=${encodeURIComponent(transactionId)}` : ''}`);
export const getFreightFulfillment = (id) => api(`/freight/fulfillments/${id}`);
export const recordFreightActualCost = (transactionId, payload) => api(`/transactions/${transactionId}/freight/actual`, { method: 'POST', body: JSON.stringify(payload) });
export const payFreightFulfillment = (id, payload) => api(`/freight/fulfillments/${id}/payments`, { method: 'POST', body: JSON.stringify(payload) });
export const getFreightPrepaidBalance = () => api('/freight/prepaid-balance');
export const topUpFreightBalance = (payload) => api('/freight/prepaid-topups', { method: 'POST', body: JSON.stringify(payload) });
export const getFinancialReport = (type, params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')).toString();
  return api(`/reports/${type}${query ? `?${query}` : ''}`);
};
export const getCustomers = (search = '') => api(`/customers?search=${encodeURIComponent(search)}`);
export const getServices = () => api('/services');
export const getServiceAccess = (id) => api(`/services/${id}/access`);
export const getServiceOpeningReceipt = (id) => api(`/services/${id}/opening-receipt`);
export const getTransactions = () => api('/transactions');
export const getSettings = () => api('/settings');
export const updateSettings = (payload) => api('/settings', { method: 'PUT', body: JSON.stringify(payload) });
export const getReceipt = (id) => api(`/transactions/${id}/receipt`);
export const payTransaction = (id, amount, paymentMethod = 'cash', idempotencyKey = crypto.randomUUID()) => api(`/transactions/${id}/payment`, { method: 'POST', body: JSON.stringify({ amount, payment_method: paymentMethod, idempotency_key: idempotencyKey }) });
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
export const getServicePartUsages = (id) => api(`/services/${id}/part-usages`);
export const getServiceTechnicianAssignments = (id) => api(`/services/${id}/technician-assignments`);
export const recordServicePartUsage = (id, payload) => api(`/services/${id}/part-usages`, { method: 'POST', body: JSON.stringify(payload) });
export const createExternalTechnician = (payload) => api('/external-technicians', { method: 'POST', body: JSON.stringify(payload) });
export const getExternalTechnicians = () => api('/external-technicians');
export const assignServiceTechnician = (id, payload) => api(`/services/${id}/technician-assignments`, { method: 'POST', body: JSON.stringify(payload) });
export const createServiceTechnicianBill = (assignmentId, payload) => api(`/service-technician-assignments/${assignmentId}/bills`, { method: 'POST', body: JSON.stringify(payload) });
export const payServiceTechnicianBill = (billId, payload) => api(`/service-technician-bills/${billId}/payments`, { method: 'POST', body: JSON.stringify(payload) });
export const login = (payload) => api('/auth/login', { method: 'POST', body: JSON.stringify(payload) });
export const logout = () => api('/auth/logout', { method: 'POST' });
export const changePassword = (payload) => api('/auth/password', { method: 'PUT', body: JSON.stringify(payload) });
export const getNotifications = () => api('/notifications');
export const getUsers = () => api('/users');
export const createUser = (payload) => api('/users', { method: 'POST', body: JSON.stringify(payload) });
export const updateUser = (id, payload) => api(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const resetUserPassword = (id, password) => api(`/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) });
export const deleteUser = (id) => api(`/users/${id}`, { method: 'DELETE' });
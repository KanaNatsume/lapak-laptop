import { api } from './client.js';

export const getCashEntries = (from, to) => api(`/cash-entries?from=${from}&to=${to}`);
export const createCashEntry = (payload) => api('/cash-entries', { method: 'POST', body: JSON.stringify(payload) });
export const updateCashEntry = (id, payload) => api(`/cash-entries/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const deleteCashEntry = (id) => api(`/cash-entries/${id}`, { method: 'DELETE' });
export const getCashAdvances = (from, to) => api(`/cash-advances?from=${from}&to=${to}`);
export const createCashAdvance = (payload) => api('/cash-advances', { method: 'POST', body: JSON.stringify(payload) });
export const reimburseCashAdvance = (id, payload) => api(`/cash-advances/${id}/reimbursements`, { method: 'POST', body: JSON.stringify(payload) });

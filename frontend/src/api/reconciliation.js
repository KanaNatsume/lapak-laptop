import { api } from './client.js';

export const getReconciliationCompleteness = (asOf) => api(`/reconciliation/completeness?as_of=${encodeURIComponent(asOf)}`);
export const getReconciliationBlockers = (asOf) => api(`/reconciliation/blockers?as_of=${encodeURIComponent(asOf)}`);
export const getOpeningBalances = () => api('/reconciliation/opening-balances');
export const createOpeningBalance = (payload) => api('/reconciliation/opening-balances', { method: 'POST', body: JSON.stringify(payload) });
export const getLegacyValuations = (status = '') => api(`/reconciliation/legacy-valuations${status ? `?status=${encodeURIComponent(status)}` : ''}`);
export const getLegacyValuationCandidates = () => api('/reconciliation/legacy-valuations/candidates');
export const createLegacyValuation = (payload) => api('/reconciliation/legacy-valuations', { method: 'POST', body: JSON.stringify(payload) });
export const verifyLegacyValuation = (id) => api(`/reconciliation/legacy-valuations/${id}/verify`, { method: 'POST', body: '{}' });
export const getCashMappings = (status = '') => api(`/reconciliation/cash-mappings${status ? `?status=${encodeURIComponent(status)}` : ''}`);
export const createCashMapping = (cashEntryId) => api(`/reconciliation/cash-mappings/${cashEntryId}`, { method: 'POST', body: '{}' });
export const approveCashMapping = (id, payload) => api(`/reconciliation/cash-mappings/${id}/approve`, { method: 'POST', body: JSON.stringify(payload) });
import { reportByType } from '../reports/reportService.js';

export function getFinancialReport(request, response) {
  try {
    response.json(reportByType(request.params.type, request.query));
  } catch (error) {
    if (/harus|tidak valid|tidak tersedia|tidak boleh/.test(error.message || '')) return response.status(400).json({ error: error.message });
    console.error(error);
    response.status(500).json({ error: 'Laporan gagal dibuat' });
  }
}

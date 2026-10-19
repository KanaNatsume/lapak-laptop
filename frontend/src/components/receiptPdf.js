const money = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const formatMoney = (value) => money.format(Number(value || 0)).replace('Rp', 'Rp ');
const cleanFileName = (value) => String(value || 'nota').replace(/[^a-z\d_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'nota';

export async function createReceiptPdf(receipt) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  function ensureSpace(height) {
    if (y + height > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
  }
  function addText(value, { size = 9, bold = false, x = margin, width = contentWidth, align = 'left', gap = 4 } = {}) {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(String(value || ''), width);
    const height = lines.length * size * 0.42;
    ensureSpace(height + gap);
    pdf.text(lines, x, y, { align });
    y += height + gap;
  }
  function addRule() {
    ensureSpace(6);
    pdf.setDrawColor(190, 198, 192);
    pdf.setLineDashPattern([1, 1], 0);
    pdf.line(margin, y, pageWidth - margin, y);
    pdf.setLineDashPattern([], 0);
    y += 6;
  }
  function addPair(label, value, bold = false) {
    const rightWidth = 48;
    addText(label, { size: bold ? 10 : 9, bold, width: contentWidth - rightWidth, gap: 4 });
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(bold ? 10 : 9);
    pdf.text(formatMoney(value), pageWidth - margin, y - 4, { align: 'right' });
  }

  const logo = receipt?.store_logo_data_url || '';
  if (logo) {
    try {
      const format = logo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      pdf.addImage(logo, format, margin, y - 2, 22, 18, undefined, 'FAST');
      y += 19;
    } catch {}
  }
  addText(receipt?.store_name || 'Lapak Laptop', { size: 16, bold: true, align: 'center', gap: 3 });
  if (receipt?.store_address) addText(receipt.store_address, { size: 8, align: 'center', gap: 2 });
  const storeContacts = [receipt?.store_phone, receipt?.store_whatsapp && `WhatsApp ${receipt.store_whatsapp}`].filter(Boolean).join(' · ');
  if (storeContacts) addText(storeContacts, { size: 8, align: 'center', gap: 2 });
  const social = [['Instagram', receipt?.store_instagram], ['Facebook', receipt?.store_facebook], ['TikTok', receipt?.store_tiktok]].filter(([, value]) => value).map(([label, value]) => `${label} ${value}`).join(' · ');
  if (social) addText(social, { size: 8, align: 'center', gap: 2 });

  addRule();
  addText(`Nota: ${receipt?.invoice_number || '-'}`, { bold: true });
  addText(`Tanggal: ${receipt?.created_at || '-'}`);
  addText(`Pelanggan: ${receipt?.customer_name || 'Umum'}`);
  if (receipt?.customer_phone) addText(`Telepon pelanggan: ${receipt.customer_phone}`);
  addRule();

  for (const item of receipt?.items || []) {
    const nameLines = pdf.splitTextToSize(String(item.name || ''), contentWidth);
    ensureSpace(nameLines.length * 4 + 13);
    addText(item.name, { size: 9, bold: true, gap: 2 });
    if (item.serial_number) addText(`SN: ${item.serial_number}`, { size: 8, gap: 2 });
    addText(`${item.qty} x ${formatMoney(item.price)}     ${formatMoney(item.subtotal)}`, { size: 8, gap: 4 });
  }
  if (receipt?.warranty_note) addText(`Garansi: ${receipt.warranty_note}`, { size: 8, bold: true });
  addRule();
  addPair('Subtotal', receipt?.subtotal);
  addPair('Diskon', -Number(receipt?.direct_discount || 0));
  addPair('Ongkir ditagih', receipt?.shipping_cost);
  addPair('Total', receipt?.grand_total, true);
  addPair(receipt?.transaction_type === 'servis' ? 'DP tercatat' : 'Dibayar', receipt?.paid_amount);
  if (Number(receipt?.remaining_amount || 0) > 0) addPair('Sisa pembayaran', receipt.remaining_amount);
  if (Number(receipt?.change_amount || 0) > 0) addPair('Kembalian', receipt.change_amount);
  addRule();
  if (receipt?.receipt_footer_text) addText(receipt.receipt_footer_text, { size: 8, align: 'center', gap: 5 });
  if (receipt?.receipt_closing_text) addText(receipt.receipt_closing_text, { size: 9, bold: true, align: 'center' });

  return { blob: pdf.output('blob'), fileName: `Nota-${cleanFileName(receipt?.invoice_number)}.pdf` };
}

function normalizeWhatsAppNumber(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  return digits;
}

export async function shareReceiptPdf(receipt) {
  const { blob, fileName } = await createReceiptPdf(receipt);
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const text = `Halo ${receipt?.customer_name || ''}, berikut nota ${receipt?.invoice_number || ''} dari ${receipt?.store_name || 'Lapak Laptop'}.`;
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: `Nota ${receipt?.invoice_number || ''}`, text });
    return 'shared';
  }

  const whatsappNumber = normalizeWhatsAppNumber(receipt?.customer_phone);
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`${text} PDF nota telah diunduh; silakan lampirkan file ${fileName}.`)}`;
  const whatsappWindow = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  if (!whatsappWindow) return 'downloaded';
  return 'downloaded';
}

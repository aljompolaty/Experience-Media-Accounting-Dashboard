/* WhatsApp sharing and Excel export (opens directly in Google Sheets). */

// wa.me needs the international number without "+". A local number has no country code, so
// it is left out and WhatsApp asks the user to pick the contact instead.
function whatsappNumber(phone) {
    const p = String(phone || '').replace(/[^\d+]/g, '');
    if (p.startsWith('+')) return p.slice(1);
    if (p.startsWith('00')) return p.slice(2);
    return '';
}

function openWhatsApp(phone, text) {
    window.open(`https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

function shareProjectStatement(pid) {
    const p = getProject(pid);
    if (!p) return;
    const s = projectSummary(p, currentRates());
    const client = getClient(p.clientId);
    const company = appData.settings.company.name;
    const payments = [...p.payments].sort(byDate).map(pay =>
        `• ${formatDate(pay.date)}: ${pay.title} — ${plainMoney(pay.amount, pay.currency)}`);
    const lines = [
        `*${company}*`,
        `كشف حساب المشروع ${p.code}`,
        `العميل: ${client ? client.name : clientName(p.clientId)}`,
        `الخدمة: ${p.service}`,
        '',
        `قيمة التعاقد: ${plainMoney(p.contractSdg, 'SDG')}`,
        `المستلم: ${plainMoney(s.receivedSdg, 'SDG')}`,
        `*الرصيد المستحق: ${plainMoney(s.remainingSdg, 'SDG')}*`
    ];
    if (payments.length) lines.push('', 'الدفعات المستلمة:', ...payments);
    lines.push('', 'نصنع تجارب إعلامية ترسخ في الأذهان');
    openWhatsApp(client && client.phone, lines.join('\n'));
}

function shareQuote(id) {
    const q = appData.quotes.find(x => x.id === id);
    if (!q) return;
    const client = getClient(q.clientId);
    const lines = [
        `*${appData.settings.company.name}*`,
        `عرض سعر رقم ${q.number}`,
        `مقدم إلى: ${client ? client.name : clientName(q.clientId)}`,
        '',
        ...q.items.map(i => `• ${i.description}: ${new Intl.NumberFormat('en-US').format(i.qty)} ×${plainMoney(i.unitPrice, q.currency)} = ${plainMoney(i.qty * i.unitPrice, q.currency)}`),
        '',
        `*الإجمالي: ${plainMoney(quoteTotal(q), q.currency)}*`
    ];
    if (q.validUntil) lines.push(`العرض صالح حتى ${formatDate(q.validUntil)}`);
    if (q.notes) lines.push('', q.notes);
    lines.push('', 'نصنع تجارب إعلامية ترسخ في الأذهان');
    openWhatsApp(client && client.phone, lines.join('\n'));
}

// ---------- Excel export ----------
const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

function round2(n) { return Math.round(n * 100) / 100; }

function exportSheets() {
    const cur = currentRates();
    const today = todayIso();
    const rows = [];
    const add = (name, list) => rows.push([name, list]);

    add('المشاريع', appData.projects.map(p => {
        const s = projectSummary(p, cur);
        return {
            'الكود': p.code, 'العميل': clientName(p.clientId), 'الخدمة': p.service, 'الحالة': PROJECT_STATUS[p.status],
            'الكمية': p.quantity, 'قيمة التعاقد (ج.س)': p.contractSdg, 'المحصل (ج.س)': round2(s.receivedSdg), 'المحصل (ج.م)': round2(s.receivedEgp),
            'المتبقي (ج.س)': round2(s.remainingSdg), 'المتبقي بسعر اليوم (ج.م)': round2(s.remainingEgp), 'التكاليف (ج.م)': round2(s.costEgp),
            'غير المسدد للموردين (ج.م)': round2(s.unpaidEgp), 'الربح المتوقع (ج.م)': round2(s.profit), 'الهامش %': round2(s.margin),
            'نقطة التعادل': s.breakEven ? round2(s.breakEven) : '', 'الإنجاز %': s.progress
        };
    }));

    add('الدفعات', appData.projects.flatMap(p => p.payments.map(pay => ({
        'المشروع': p.code, 'البيان': pay.title, 'التاريخ': pay.date || '', 'المبلغ': pay.amount, 'العملة': pay.currency,
        'سعر ج.م': pay.rates.egp, 'سعر $': pay.rates.usd || '', 'المعادل (ج.س)': round2(toSdg(pay.amount, pay.currency, pay.rates)),
        'المعادل (ج.م)': round2(toEgp(pay.amount, pay.currency, pay.rates))
    }))));

    add('المصروفات', appData.projects.flatMap(p => p.expenses.map(e => ({
        'المشروع': p.code, 'البند': e.title, 'المورد': e.supplierId ? supplierName(e.supplierId) : '', 'التاريخ': e.date || '',
        'الاستحقاق': e.dueDate || '', 'المبلغ': e.amount, 'العملة': e.currency, 'سعر ج.م': e.rates.egp, 'سعر $': e.rates.usd || '',
        'المعادل (ج.م)': round2(toEgp(e.amount, e.currency, e.rates)), 'المسدد': round2(expensePaid(e)), 'المتبقي': round2(expenseOutstanding(e)),
        'الحالة': EXPENSE_STATUS_PILL[expenseStatus(e, today)][0]
    }))));

    add('الدفعات المتوقعة', appData.projects.flatMap(p => p.schedule.map(s => ({
        'المشروع': p.code, 'البيان': s.title, 'التاريخ': s.date, 'المبلغ (ج.س)': s.amount, 'بسعر اليوم (ج.م)': round2(s.amount / cur.egp)
    }))));

    add('مراحل التنفيذ', appData.projects.flatMap(p => p.workflow.map(st => ({
        'المشروع': p.code, 'المرحلة': st.name, 'الحالة': STEP_STATUS[st.status], 'المسؤول': st.owner || '', 'الموعد النهائي': st.dueDate || ''
    }))));

    add('العملاء', appData.clients.map(c => ({ 'الاسم': c.name, 'الهاتف': c.phone, 'ملاحظات': c.notes, 'عدد المشاريع': appData.projects.filter(p => p.clientId === c.id).length })));
    add('الموردون', appData.suppliers.map(s => ({ 'الاسم': s.name, 'الهاتف': s.phone, 'ملاحظات': s.notes })));

    add('عروض الأسعار', appData.quotes.map(q => ({
        'الرقم': q.number, 'العميل': clientName(q.clientId), 'التاريخ': q.date, 'صالح حتى': q.validUntil || '', 'العملة': q.currency,
        'الإجمالي': quoteTotal(q), 'الحالة': QUOTE_STATUS[q.status], 'المشروع': q.projectId && getProject(q.projectId) ? getProject(q.projectId).code : ''
    })));

    const cf = cashflowForecast(appData, cur);
    add('التدفق النقدي', cf.events.map(ev => ({
        'التاريخ': ev.date, 'البيان': ev.title, 'المشروع': ev.project.code, 'وارد (ج.م)': ev.kind === 'in' ? round2(ev.amountEgp) : '',
        'صادر (ج.م)': ev.kind === 'out' ? round2(ev.amountEgp) : '', 'الرصيد (ج.م)': round2(ev.balance), 'متأخر': ev.overdue ? 'نعم' : ''
    })));

    add('أسعار الصرف', [...appData.fxRates].sort(byDate).map(r => ({ 'التاريخ': r.date, 'ج.م (ج.س)': r.egp, '$ (ج.س)': r.usd || '' })));

    add('سجل التغييرات', (appData.auditLog || []).map(e => ({
        'الوقت': new Date(e.at).toLocaleString('en-GB'), 'العملية': (AUDIT_TYPE_PILL[e.type] || [e.type])[0], 'النوع': e.entity,
        'الاسم': e.name, 'المشروع': e.project || '', 'التفاصيل': e.detail, 'الجهاز': e.device || ''
    })));
    return rows;
}

async function exportExcel() {
    try {
        if (!window.XLSX) await loadScript(XLSX_SRC);
    } catch (err) {
        alert('تعذر تحميل مكتبة Excel. تحقق من الاتصال بالإنترنت ثم أعد المحاولة.');
        return;
    }
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    exportSheets().forEach(([name, list]) => {
        const ws = XLSX.utils.json_to_sheet(list.length ? list : [{ 'لا توجد بيانات': '' }]);
        const headers = Object.keys(list[0] || { 'لا توجد بيانات': '' });
        ws['!cols'] = headers.map(h => ({ wch: Math.min(40, Math.max(h.length + 2, ...list.map(r => String(r[h] ?? '').length + 1))) }));
        XLSX.utils.book_append_sheet(wb, ws, name);
    });
    XLSX.writeFile(wb, `experience-media-${todayIso()}.xlsx`);
    showToast('تم تنزيل ملف Excel');
}

/* Printable branded documents (quote, client statement). Printed via the browser, which can save as PDF. */

function printDocument(html) {
    const area = el('printArea');
    area.innerHTML = html;
    const img = area.querySelector('img');
    const go = () => window.print();
    if (img && !img.complete) {
        img.addEventListener('load', go, { once: true });
        img.addEventListener('error', go, { once: true });
    } else {
        go();
    }
}

function docShell({ title, number, date, party, body, notes }) {
    const c = appData.settings.company;
    // Phone numbers and emails have no strong direction, so pin them LTR inside the RTL page.
    const ltr = value => value ? `<span dir="ltr">${escapeHtml(value)}</span>` : '';
    const contact = [ltr(c.phone), ltr(c.email), escapeHtml(c.address)].filter(Boolean).join(' · ');
    return `
        <div class="doc">
            <div class="doc-head">
                <img src="brand/logo-horizontal-color.webp" class="doc-logo" alt="Experience Media">
                <div class="doc-company">
                    <strong>${escapeHtml(c.name)}</strong>
                    ${contact ? `<span>${contact}</span>` : ''}
                </div>
            </div>
            <div class="doc-title-row">
                <h1>${title}</h1>
                <div class="doc-meta">
                    <div>الرقم: <strong>${escapeHtml(number)}</strong></div>
                    <div>التاريخ: <strong>${formatDate(date)}</strong></div>
                </div>
            </div>
            <div class="doc-party">${party}</div>
            ${body}
            ${notes ? `<div class="doc-notes"><strong>ملاحظات وشروط</strong><p>${escapeHtml(notes)}</p></div>` : ''}
            <div class="doc-foot">نصنع تجارب إعلامية ترسخ في الأذهان</div>
        </div>`;
}

function printQuote(id) {
    const q = appData.quotes.find(x => x.id === id);
    if (!q) return;
    const client = getClient(q.clientId);
    const rows = q.items.map((item, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(item.description)}</td>
            <td>${formatNum(item.qty)}</td>
            <td>${formatMoney(item.unitPrice, q.currency)}</td>
            <td>${formatMoney(item.qty * item.unitPrice, q.currency)}</td>
        </tr>`).join('');

    printDocument(docShell({
        title: 'عرض سعر',
        number: q.number,
        date: q.date,
        party: `
            <div><span>مقدم إلى:</span> <strong>${escapeHtml(client ? client.name : clientName(q.clientId))}</strong></div>
            ${client && client.phone ? `<div><span>الهاتف:</span> <bdi dir="ltr">${escapeHtml(client.phone)}</bdi></div>` : ''}
            ${q.validUntil ? `<div><span>صالح حتى:</span> ${formatDate(q.validUntil)}</div>` : ''}`,
        body: `
            <table class="doc-table">
                <thead><tr><th>#</th><th>البند</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div class="doc-totals"><div class="doc-grand"><span>الإجمالي</span><strong>${formatMoney(quoteTotal(q), q.currency)}</strong></div></div>`,
        notes: q.notes
    }));
}

function printProjectStatement(pid) {
    const p = getProject(pid);
    if (!p) return;
    const s = projectSummary(p, currentRates());
    const client = getClient(p.clientId);
    const rows = [...p.payments].sort(byDate).map((pay, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(pay.title)}</td>
            <td>${formatDate(pay.date)}</td>
            <td>${formatMoney(pay.amount, pay.currency)}</td>
            <td>${formatMoney(toSdg(pay.amount, pay.currency, pay.rates), 'SDG')}</td>
        </tr>`).join('');

    printDocument(docShell({
        title: 'كشف حساب عميل',
        number: `INV-${p.code}`,
        date: todayIso(),
        party: `
            <div><span>العميل:</span> <strong>${escapeHtml(client ? client.name : clientName(p.clientId))}</strong></div>
            <div><span>المشروع:</span> ${escapeHtml(p.code)} · ${escapeHtml(p.service)}</div>
            <div><span>الكمية:</span> ${formatNum(p.quantity)} · <span>سعر الوحدة:</span> ${formatMoney(p.quantity > 0 ? p.contractSdg / p.quantity : 0, 'SDG')}</div>`,
        body: `
            <h2 class="doc-section">الدفعات المستلمة</h2>
            <table class="doc-table">
                <thead><tr><th>#</th><th>البيان</th><th>التاريخ</th><th>المبلغ</th><th>المعادل (ج.س)</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="5">لا توجد دفعات مستلمة بعد</td></tr>'}</tbody>
            </table>
            <div class="doc-totals">
                <div><span>قيمة التعاقد</span><strong>${formatMoney(p.contractSdg, 'SDG')}</strong></div>
                <div><span>إجمالي المستلم</span><strong>${formatMoney(s.receivedSdg, 'SDG')}</strong></div>
                <div class="doc-grand"><span>الرصيد المستحق</span><strong>${formatMoney(s.remainingSdg, 'SDG')}</strong></div>
            </div>`
    }));
}

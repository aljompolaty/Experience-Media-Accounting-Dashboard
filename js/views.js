/* Page views. Each view renders into #app and draws its charts. */

const EXPENSE_STATUS_PILL = {
    paid: ['مسدد', 'pos'],
    partial: ['مسدد جزئيًا', 'warn'],
    unpaid: ['غير مسدد', 'muted'],
    overdue: ['متأخر', 'neg']
};

function cashAlertState(p, s) {
    if (s.remainingSdg < 0) {
        return {
            level: 'danger', title: 'المحصل يتجاوز قيمة العقد',
            text: `تم تسجيل دفعات بقيمة تزيد عن إجمالي التعاقد (${formatMoney(p.contractSdg, 'SDG')}). راجع سجل الدفعات.`,
            value: formatMoney(-s.remainingSdg, 'SDG')
        };
    }
    if (s.cashGap > 0) {
        return {
            level: 'danger', title: 'العجز النقدي المتبقي لتغطية التكاليف',
            text: `المحصل الفعلي (${formatMoney(s.receivedEgp, 'EGP')}) لا يغطي إجمالي التكلفة (${formatMoney(s.costEgp, 'EGP')}). الفارق يُسدد عند تحصيل الدفعة المتبقية.`,
            value: formatMoney(s.cashGap, 'EGP')
        };
    }
    return {
        level: 'ok', title: 'التكاليف مغطاة بالكامل من المحصل',
        text: `المحصل الفعلي (${formatMoney(s.receivedEgp, 'EGP')}) يغطي إجمالي التكلفة (${formatMoney(s.costEgp, 'EGP')}) والفائض متاح.`,
        value: `+${formatMoney(-s.cashGap, 'EGP')}`
    };
}

function collectAlerts(cur, cf) {
    const alerts = [];
    fxAlerts(appData, cur).forEach(a => {
        const crossed = a.level === 'danger';
        alerts.push({
            level: a.level,
            title: `${crossed ? 'سعر الصرف تجاوز نقطة التعادل' : 'سعر الصرف يقترب من نقطة التعادل'}: ${escapeHtml(a.project.code)}`,
            text: `نقطة التعادل ${formatNum(a.summary.breakEven)} ج.س وسعر اليوم ${formatNum(cur.egp)} ج.س. ${crossed ? 'تحصيل المتبقي الآن يعني خسارة.' : `الفارق ${formatPct(a.distance)} فقط.`}`,
            href: `#/project/${a.project.id}`
        });
    });

    if (cf.firstNegative) {
        alerts.push({
            level: 'danger', title: 'عجز نقدي متوقع',
            text: `يصبح الرصيد سالبًا بتاريخ ${formatDate(cf.firstNegative)}، وأدنى رصيد متوقع ${formatMoney(cf.minBalance, 'EGP')}.`,
            href: '#/cashflow'
        });
    }

    const overdueOut = cf.events.filter(e => e.kind === 'out' && e.overdue);
    if (overdueOut.length) {
        alerts.push({
            level: 'danger', title: `${overdueOut.length} مستحقات موردين متأخرة`,
            text: 'تجاوزت تاريخ استحقاقها ولم تُسدد بالكامل.', value: formatMoney(overdueOut.reduce((s, e) => s + e.amountEgp, 0), 'EGP'), href: '#/suppliers'
        });
    }

    const overdueIn = cf.events.filter(e => e.kind === 'in' && e.overdue);
    if (overdueIn.length) {
        alerts.push({
            level: 'warn', title: `${overdueIn.length} دفعات عملاء متأخرة`,
            text: 'تجاوزت تاريخها المتوقع ولم تُسجل كمحصلة.', value: formatMoney(overdueIn.reduce((s, e) => s + e.amountEgp, 0), 'EGP'), href: '#/cashflow'
        });
    }

    appData.projects.filter(p => p.status === 'active').forEach(p => {
        const late = projectSummary(p, cur).overdueSteps;
        if (late) alerts.push({ level: 'warn', title: `مراحل متأخرة: ${escapeHtml(p.code)}`, text: `${late} مرحلة تجاوزت موعدها النهائي ولم تكتمل.`, href: `#/project/${p.id}` });
    });
    return alerts;
}

function eventsTable(events, { limit, showBalance = true } = {}) {
    const rows = (limit ? events.slice(0, limit) : events).map(ev => {
        const label = ev.overdue ? pill(`متأخر منذ ${formatDate(ev.originalDate)}`, 'neg') : (ev.undated ? pill('بدون تاريخ استحقاق', 'muted') : '');
        const who = ev.kind === 'out' && ev.supplierId ? ` · ${escapeHtml(supplierName(ev.supplierId))}` : '';
        return `
            <tr>
                <td>${formatDate(ev.date)}</td>
                <td><div class="cell-title">${escapeHtml(ev.title)}</div><div class="cell-date"><a href="#/project/${ev.project.id}">${escapeHtml(ev.project.code)}</a>${who} ${label}</div></td>
                <td class="text-pos">${ev.kind === 'in' ? formatMoney(ev.amountEgp, 'EGP') : ''}</td>
                <td class="text-neg">${ev.kind === 'out' ? formatMoney(ev.amountEgp, 'EGP') : ''}</td>
                ${showBalance ? `<td class="strong ${ev.balance < 0 ? 'text-neg' : ''}">${formatMoney(ev.balance, 'EGP')}</td>` : ''}
            </tr>`;
    });
    return `
        <div class="table-wrap">
            <table>
                <thead><tr><th>التاريخ</th><th>البيان</th><th>وارد</th><th>صادر</th>${showBalance ? '<th>الرصيد</th>' : ''}</tr></thead>
                <tbody>${rows.length ? rows.join('') : emptyRow(showBalance ? 5 : 4, 'لا توجد حركات متوقعة')}</tbody>
            </table>
        </div>`;
}

function cashflowPoints(cf) {
    const today = todayIso();
    const byDay = new Map([[today, cf.cash]]);
    cf.events.forEach(ev => byDay.set(ev.date, ev.balance));
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, balance]) => ({ x: Date.parse(date), y: balance, tone: 'brand' }));
}

function dateLabel(x) {
    return formatShortDate(isoDate(new Date(x)));
}

// ---------- Overview ----------
function renderOverview() {
    const cur = currentRates();
    const rows = appData.projects.map(p => ({ p, s: projectSummary(p, cur) }));
    const active = rows.filter(r => r.p.status === 'active');
    const sum = key => rows.reduce((total, r) => total + r.s[key], 0);
    const cf = cashflowForecast(appData, cur);
    const profit = sum('profit');
    const contract = sum('contractEgp');

    const projectRows = rows.map(({ p, s }) => `
        <tr class="row-link" data-href="#/project/${p.id}">
            <td><a href="#/project/${p.id}" class="strong">${escapeHtml(p.code)}</a></td>
            <td>${escapeHtml(clientName(p.clientId))}</td>
            <td class="cell-wrap">${escapeHtml(p.service)}</td>
            <td>${progressBar(s.progress)}</td>
            <td>${formatMoney(s.contractEgp, 'EGP')}</td>
            <td class="strong ${s.profit < 0 ? 'text-neg' : 'text-pos'}">${formatMoney(s.profit, 'EGP')}</td>
            <td>${formatPct(s.margin)}</td>
            <td>${pill(PROJECT_STATUS[p.status], p.status === 'active' ? 'brand' : 'muted')}</td>
        </tr>`);

    el('app').innerHTML = `
        ${viewHeader('لوحة المتابعة العامة', `كل المشاريع بسعر اليوم ${formatNum(cur.egp)} ج.س للجنيه المصري`, '<button type="button" class="btn btn-primary" data-action="new-project">+ مشروع جديد</button>')}
        <div class="grid-kpi">
            ${kpiCard('المشاريع النشطة', `${active.length} / ${rows.length}`, 'نشط / الإجمالي')}
            ${kpiCard('المحصل من العملاء', formatMoney(sum('receivedEgp'), 'EGP'), 'بأسعار الصرف المثبتة', 'text-pos')}
            ${kpiCard('المتبقي عند العملاء', formatMoney(sum('remainingEgp'), 'EGP'), 'بسعر اليوم', 'text-warn')}
            ${kpiCard('إجمالي التكاليف', formatMoney(sum('costEgp'), 'EGP'), `منها غير مسدد ${formatMoney(sum('unpaidEgp'), 'EGP')}`, 'text-neg')}
            ${kpiCard('الربح المتوقع', formatMoney(profit, 'EGP'), `هامش ${formatPct(contract > 0 ? (profit / contract) * 100 : 0)}`, profit < 0 ? 'text-neg' : 'text-brand')}
            ${kpiCard('النقد المتاح (تقديري)', formatMoney(cf.cash, 'EGP'), 'المحصل ناقص المسدد للموردين', cf.cash < 0 ? 'text-neg' : '')}
        </div>

        <div class="alerts">${alertsHtml(collectAlerts(cur, cf))}</div>

        <div class="card">
            <div class="card-header"><h3 class="card-title">المشاريع</h3><span class="badge">${rows.length} مشروع</span></div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>الكود</th><th>العميل</th><th>الخدمة</th><th>الإنجاز</th><th>قيمة العقد</th><th>الربح المتوقع</th><th>الهامش</th><th>الحالة</th></tr></thead>
                    <tbody>${projectRows.length ? projectRows.join('') : emptyRow(8, 'لا توجد مشاريع بعد. ابدأ بإضافة مشروع جديد.')}</tbody>
                </table>
            </div>
        </div>

        <div class="grid-2">
            <div class="card">
                <div class="card-header"><h3 class="card-title">أقرب الاستحقاقات</h3><a href="#/cashflow" class="btn btn-quiet btn-sm">التدفق النقدي كاملًا ←</a></div>
                ${eventsTable(cf.events, { limit: 6, showBalance: false })}
            </div>
            <div class="card">
                <div class="card-header"><h3 class="card-title">الرصيد النقدي المتوقع</h3><span class="badge">أدنى رصيد ${formatMoney(cf.minBalance, 'EGP')}</span></div>
                <div class="chart-box"><canvas id="overviewCashChart"></canvas></div>
            </div>
        </div>`;

    drawLineChart(el('overviewCashChart'), cashflowPoints(cf), { xLabel: dateLabel, step: true });
}

// ---------- Project ----------
function renderProject(route) {
    const p = getProject(route.id);
    if (!p) {
        el('app').innerHTML = `${viewHeader('المشروع غير موجود')}<p class="muted">ربما حُذف هذا المشروع. <a href="#/">العودة للوحة العامة</a></p>`;
        return;
    }
    const cur = currentRates();
    const s = projectSummary(p, cur);
    const today = todayIso();
    const template = getTemplate(p.serviceType);
    const alert = cashAlertState(p, s);
    const ids = { pid: p.id };

    const paymentRows = [...p.payments].sort(byDate).map(pay => `
        <tr>
            <td><div class="cell-title">${escapeHtml(pay.title)}</div><div class="cell-date">${formatDate(pay.date)}</div></td>
            <td>${formatMoney(pay.amount, pay.currency)}</td>
            <td class="muted">${formatNum(pay.rates.egp)}${pay.currency === 'USD' ? `<div class="cell-date">$ ${formatNum(pay.rates.usd)}</div>` : ''}</td>
            <td class="text-pos strong">${formatMoney(toEgp(pay.amount, pay.currency, pay.rates), 'EGP')}</td>
            ${rowActions('payment', { ...ids, id: pay.id })}
        </tr>`);

    const scheduleRows = [...p.schedule].sort(byDate).map(item => `
        <tr>
            <td><div class="cell-title">${escapeHtml(item.title)}</div><div class="cell-date">${formatDate(item.date)} ${item.date < today ? pill('متأخرة', 'neg') : ''}</div></td>
            <td>${formatMoney(item.amount, 'SDG')}</td>
            <td class="muted">≈ ${formatMoney(item.amount / cur.egp, 'EGP')}</td>
            ${rowActions('schedule', { ...ids, id: item.id }, `<button type="button" class="btn btn-primary btn-sm" data-action="collect-schedule"${dataAttrs({ ...ids, id: item.id })}>تحصيل</button>`)}
        </tr>`);

    const expenseRows = [...p.expenses].sort(byDate).map(e => {
        const status = expenseStatus(e, today);
        const [label, tone] = EXPENSE_STATUS_PILL[status];
        const paidNote = status === 'partial' ? `<div class="cell-date">${formatMoney(expensePaid(e), e.currency)} من ${formatMoney(e.amount, e.currency)}</div>` : '';
        const settle = status === 'paid' ? '' : `<button type="button" class="btn btn-secondary btn-sm" data-action="settle-expense"${dataAttrs({ ...ids, id: e.id })}>سداد</button>`;
        return `
            <tr>
                <td><div class="cell-title">${escapeHtml(e.title)}</div><div class="cell-date">${formatDate(e.date)}</div></td>
                <td>${e.supplierId ? escapeHtml(supplierName(e.supplierId)) : '<span class="muted">—</span>'}</td>
                <td>${formatMoney(e.amount, e.currency)}<div class="cell-date">بسعر ${formatNum(e.currency === 'USD' ? e.rates.usd : e.rates.egp)}</div></td>
                <td class="text-neg strong">${formatMoney(toEgp(e.amount, e.currency, e.rates), 'EGP')}</td>
                <td>${e.dueDate ? formatDate(e.dueDate) : '<span class="muted">—</span>'}</td>
                <td>${pill(label, tone)}${paidNote}</td>
                ${rowActions('expense', { ...ids, id: e.id }, settle)}
            </tr>`;
    });

    const stepRows = p.workflow.map(step => {
        const late = step.status !== 'completed' && step.dueDate && step.dueDate < today;
        const meta = [step.owner ? `المسؤول: ${escapeHtml(step.owner)}` : '', step.dueDate ? `<span class="${late ? 'text-neg strong' : ''}">الموعد: ${formatDate(step.dueDate)}${late ? ' (متأخرة)' : ''}</span>` : ''].filter(Boolean).join(' · ');
        return `
            <div class="step ${step.status === 'completed' ? 'done' : step.status === 'in_progress' ? 'active' : ''}">
                <div class="step-body">
                    <span class="step-name">${escapeHtml(step.name)}</span>
                    ${meta ? `<span class="step-meta">${meta}</span>` : ''}
                </div>
                <div class="step-tools">
                    <select class="step-select" aria-label="حالة المرحلة"${dataAttrs({ pid: p.id, step: step.id })}>
                        ${Object.entries(STEP_STATUS).map(([v, l]) => `<option value="${v}" ${step.status === v ? 'selected' : ''}>${l}</option>`).join('')}
                    </select>
                    <button type="button" class="icon-btn" data-action="edit-step"${dataAttrs({ ...ids, id: step.id })} aria-label="تعديل المرحلة">✎</button>
                    <button type="button" class="icon-btn danger" data-action="delete-step"${dataAttrs({ ...ids, id: step.id })} aria-label="حذف المرحلة">✕</button>
                </div>
            </div>`;
    });

    const sens = sensitivityRows(s, cur.egp);
    const sensRows = sens.map(r => `
        <tr class="${r.isBreakEven ? 'row-breakeven' : r.isCurrent ? 'row-current' : ''}">
            <td>${formatNum(r.rate)}${r.isCurrent ? '<span class="tag tag-current">اليوم</span>' : ''}${r.isBreakEven ? '<span class="tag tag-breakeven">نقطة التعادل</span>' : ''}</td>
            <td>${formatNum(r.remEgp)}</td>
            <td>${formatNum(r.totalContract)}</td>
            <td class="strong ${r.profit < 0 ? 'text-neg' : 'text-pos'}">${formatNum(r.profit)}</td>
            <td>${formatPct(r.margin)}</td>
        </tr>`);
    let sensNote;
    if (s.breakEven) sensNote = `نقطة التعادل: ${formatNum(s.breakEven)} ج.س / 1 ج.م. إذا تجاوز سعر الصرف هذا الرقم عند تحصيل المتبقي يتحول المشروع إلى خسارة.`;
    else if (s.openSdg <= 0) sensNote = 'لا يوجد مبلغ متبقٍ عند العميل، فالنتيجة ثابتة ولا تتأثر بسعر الصرف.';
    else sensNote = 'المحصل يغطي التكاليف بالكامل، فالمشروع رابح عند أي سعر صرف للدفعة المتبقية.';

    let scheduleNote = '';
    if (s.scheduledSdg > s.openSdg + 0.5) scheduleNote = `<p class="matrix-note text-warn">المجدول (${formatMoney(s.scheduledSdg, 'SDG')}) يتجاوز المتبقي عند العميل (${formatMoney(s.openSdg, 'SDG')}).</p>`;
    else if (s.unscheduledSdg > 0.5) scheduleNote = `<p class="matrix-note">${formatMoney(s.unscheduledSdg, 'SDG')} من المتبقي لم تُجدول بعد، ولن تظهر في توقع التدفق النقدي.</p>`;

    el('app').innerHTML = `
        <div class="view-header">
            <div>
                <a href="#/" class="back-link">→ كل المشاريع</a>
                <h2 class="page-title">${escapeHtml(p.code)} · ${escapeHtml(clientName(p.clientId))}</h2>
            </div>
            <div class="view-actions">
                <button type="button" class="btn btn-quiet" data-action="print-invoice"${dataAttrs(ids)}>طباعة كشف الحساب</button>
                <button type="button" class="btn btn-secondary" data-action="edit-project"${dataAttrs(ids)}>تعديل المشروع</button>
                <button type="button" class="icon-btn danger" data-action="delete-project"${dataAttrs(ids)} title="حذف المشروع" aria-label="حذف المشروع">✕</button>
            </div>
        </div>

        <div class="grid-3">
            <div class="card">
                <div class="card-header">
                    <span class="badge">${escapeHtml(p.code)}</span>
                    ${pill(PROJECT_STATUS[p.status], p.status === 'active' ? 'brand' : 'muted')}
                </div>
                <h2 class="project-client">العميل: <a href="#/clients">${escapeHtml(clientName(p.clientId))}</a></h2>
                <p class="project-service">الخدمة: ${escapeHtml(p.service)}${template ? ` <span class="muted">(${escapeHtml(template.name)})</span>` : ''}</p>
                <div class="meta-list">
                    <div class="meta-row"><span>قيمة القطعة:</span><strong>${formatMoney(p.quantity > 0 ? p.contractSdg / p.quantity : 0, 'SDG')}</strong></div>
                    <div class="meta-row"><span>إجمالي التعاقد:</span><strong>${formatMoney(p.contractSdg, 'SDG')}</strong></div>
                    <div class="meta-row"><span>إجمالي العقد المعادل:</span><strong class="text-brand">${formatMoney(s.contractEgp, 'EGP')}</strong></div>
                </div>
            </div>
            <div class="grid-kpi span-2">
                ${kpiCard('المحصل الفعلي', formatMoney(s.receivedEgp, 'EGP'), s.receivedSdg > 0 ? `${formatMoney(s.receivedSdg, 'SDG')} (متوسط مُثبّت ${formatNum(s.avgLockedFx)})` : 'لا توجد دفعات بعد', 'text-pos')}
                ${kpiCard('المتبقي عند العميل', formatMoney(s.remainingEgp, 'EGP'), `${formatMoney(s.openSdg, 'SDG')} (سعر اليوم ${formatNum(cur.egp)})`, 'text-warn')}
                ${kpiCard('إجمالي التكلفة الفعلية', formatMoney(s.costEgp, 'EGP'), `${formatMoney(s.costPerPiece, 'EGP')} / قطعة · غير مسدد ${formatMoney(s.unpaidEgp, 'EGP')}`, 'text-neg')}
                ${kpiCard('صافي الربح المتوقع', formatMoney(s.profit, 'EGP'), `<span class="${s.margin >= 0 ? 'text-pos' : 'text-neg'}">هامش ربح: ${formatPct(s.margin)}</span>`, s.profit >= 0 ? 'text-brand' : 'text-neg')}
            </div>
        </div>

        ${alertsHtml([alert]).replace('alert-sm', '')}

        <div class="grid-2">
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">الدفعات المحصلة <small>(سعر صرف مثبّت)</small></h3>
                    <button type="button" class="btn btn-primary" data-action="add-payment"${dataAttrs(ids)}>+ إضافة دفعة</button>
                </div>
                <div class="table-wrap">
                    <table>
                        <thead><tr><th>البيان</th><th>المبلغ</th><th>سعر الصرف</th><th>المعادل (ج.م)</th><th></th></tr></thead>
                        <tbody>${paymentRows.length ? paymentRows.join('') : emptyRow(5, 'لا توجد دفعات مسجلة')}</tbody>
                    </table>
                </div>
            </div>
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">الدفعات المتوقعة من العميل</h3>
                    <button type="button" class="btn btn-secondary" data-action="add-schedule"${dataAttrs(ids)}>+ جدولة دفعة</button>
                </div>
                <div class="table-wrap">
                    <table>
                        <thead><tr><th>البيان</th><th>المبلغ</th><th>بسعر اليوم</th><th></th></tr></thead>
                        <tbody>${scheduleRows.length ? scheduleRows.join('') : emptyRow(4, 'لا توجد دفعات مجدولة')}</tbody>
                    </table>
                </div>
                ${scheduleNote}
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h3 class="card-title">المصروفات ومستحقات الموردين</h3>
                <button type="button" class="btn btn-secondary" data-action="add-expense"${dataAttrs(ids)}>+ إضافة مصروف</button>
            </div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>البند</th><th>المورد</th><th>المبلغ الأصلي</th><th>المعادل (ج.م)</th><th>الاستحقاق</th><th>السداد</th><th></th></tr></thead>
                    <tbody>${expenseRows.length ? expenseRows.join('') : emptyRow(7, 'لا توجد مصروفات مسجلة')}</tbody>
                </table>
            </div>
        </div>

        <div class="grid-2">
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">متابعة مراحل التنفيذ</h3>
                    <div class="view-actions">
                        <span class="badge">⁦${s.progress}%⁩ مكتمل</span>
                        <button type="button" class="btn btn-quiet btn-sm" data-action="add-step"${dataAttrs(ids)}>+ مرحلة</button>
                    </div>
                </div>
                <div class="progress-bar-bg"><div class="progress-bar-fill" style="width: ${s.progress}%"></div></div>
                <div class="steps">${stepRows.length ? stepRows.join('') : '<p class="muted">لا توجد مراحل.</p>'}</div>
            </div>
            <div class="card">
                <div class="card-header"><h3 class="card-title">حساسية سعر الصرف للدفعة المتبقية (${formatMoney(s.openSdg, 'SDG')})</h3></div>
                <div class="table-wrap">
                    <table class="table-center">
                        <thead><tr><th>سعر الصرف</th><th>المتبقي (ج.م)</th><th>إجمالي العقد</th><th>صافي الربح</th><th>الهامش</th></tr></thead>
                        <tbody>${sensRows.join('')}</tbody>
                    </table>
                </div>
                <p class="matrix-note">${sensNote}</p>
                <div class="chart-box"><canvas id="profitChartCanvas"></canvas></div>
            </div>
        </div>`;

    const chartPoints = sens.filter(r => r.rate <= cur.egp * 2).map(r => ({ x: r.rate, y: r.profit }));
    drawLineChart(el('profitChartCanvas'), chartPoints, { markerX: s.breakEven && s.breakEven <= cur.egp * 2 ? s.breakEven : null });
}

// ---------- Clients ----------
function renderClients() {
    const cur = currentRates();
    const rows = appData.clients.map(c => {
        const projects = appData.projects.filter(p => p.clientId === c.id);
        const totals = projects.reduce((t, p) => {
            const s = projectSummary(p, cur);
            return { contract: t.contract + p.contractSdg, received: t.received + s.receivedEgp, open: t.open + s.openSdg };
        }, { contract: 0, received: 0, open: 0 });
        const links = projects.map(p => `<a href="#/project/${p.id}">${escapeHtml(p.code)}</a>`).join('، ');
        return `
            <tr>
                <td><div class="cell-title">${escapeHtml(c.name)}</div>${c.notes ? `<div class="cell-date">${escapeHtml(c.notes)}</div>` : ''}</td>
                <td>${c.phone ? escapeHtml(c.phone) : '<span class="muted">—</span>'}</td>
                <td>${links || '<span class="muted">لا يوجد</span>'}</td>
                <td>${formatMoney(totals.contract, 'SDG')}</td>
                <td class="text-pos">${formatMoney(totals.received, 'EGP')}</td>
                <td class="strong ${totals.open > 0 ? 'text-warn' : ''}">${formatMoney(totals.open, 'SDG')}</td>
                ${rowActions('client', { id: c.id })}
            </tr>`;
    });

    el('app').innerHTML = `
        ${viewHeader('العملاء', 'أرصدة العملاء ومشاريعهم', '<button type="button" class="btn btn-primary" data-action="add-client">+ إضافة عميل</button>')}
        <div class="card">
            <div class="table-wrap">
                <table>
                    <thead><tr><th>العميل</th><th>الهاتف</th><th>المشاريع</th><th>إجمالي التعاقدات</th><th>المحصل</th><th>الرصيد المستحق</th><th></th></tr></thead>
                    <tbody>${rows.length ? rows.join('') : emptyRow(7, 'لا يوجد عملاء بعد')}</tbody>
                </table>
            </div>
        </div>`;
}

// ---------- Suppliers ----------
function renderSuppliers() {
    const today = todayIso();
    const allExpenses = appData.projects.flatMap(p => p.expenses.map(e => ({ p, e })));

    const supplierRows = appData.suppliers.map(sup => {
        const items = allExpenses.filter(x => x.e.supplierId === sup.id);
        const billed = items.reduce((t, x) => t + toEgp(x.e.amount, x.e.currency, x.e.rates), 0);
        const paid = items.reduce((t, x) => t + toEgp(Math.min(x.e.amount, expensePaid(x.e)), x.e.currency, x.e.rates), 0);
        const nextDue = items.filter(x => expenseOutstanding(x.e) > 0.005 && x.e.dueDate).map(x => x.e.dueDate).sort()[0];
        return `
            <tr>
                <td><div class="cell-title">${escapeHtml(sup.name)}</div>${sup.notes ? `<div class="cell-date">${escapeHtml(sup.notes)}</div>` : ''}</td>
                <td>${sup.phone ? escapeHtml(sup.phone) : '<span class="muted">—</span>'}</td>
                <td>${items.length}</td>
                <td>${formatMoney(billed, 'EGP')}</td>
                <td class="text-pos">${formatMoney(paid, 'EGP')}</td>
                <td class="strong ${billed - paid > 0.005 ? 'text-neg' : ''}">${formatMoney(billed - paid, 'EGP')}</td>
                <td>${nextDue ? `${formatDate(nextDue)} ${nextDue < today ? pill('متأخر', 'neg') : ''}` : '<span class="muted">—</span>'}</td>
                ${rowActions('supplier', { id: sup.id })}
            </tr>`;
    });

    const dues = allExpenses
        .filter(x => expenseOutstanding(x.e) > 0.005)
        .sort((a, b) => (a.e.dueDate || '0000').localeCompare(b.e.dueDate || '0000'));
    const dueRows = dues.map(({ p, e }) => {
        const out = expenseOutstanding(e);
        const status = expenseStatus(e, today);
        const [label, tone] = EXPENSE_STATUS_PILL[status];
        return `
            <tr>
                <td><div class="cell-title">${escapeHtml(e.title)}</div><div class="cell-date"><a href="#/project/${p.id}">${escapeHtml(p.code)}</a></div></td>
                <td>${e.supplierId ? escapeHtml(supplierName(e.supplierId)) : '<span class="muted">بدون مورد</span>'}</td>
                <td>${e.dueDate ? formatDate(e.dueDate) : '<span class="muted">غير محدد</span>'}</td>
                <td>${formatMoney(out, e.currency)}</td>
                <td class="text-neg strong">${formatMoney(toEgp(out, e.currency, e.rates), 'EGP')}</td>
                <td>${pill(label, tone)}</td>
                <td class="row-actions"><button type="button" class="btn btn-secondary btn-sm" data-action="settle-expense"${dataAttrs({ pid: p.id, id: e.id })}>سداد</button></td>
            </tr>`;
    });
    const totalDue = dues.reduce((t, x) => t + toEgp(expenseOutstanding(x.e), x.e.currency, x.e.rates), 0);

    el('app').innerHTML = `
        ${viewHeader('الموردون', 'حسابات الموردين والمستحقات غير المسددة', '<button type="button" class="btn btn-primary" data-action="add-supplier">+ إضافة مورد</button>')}
        <div class="card">
            <div class="card-header"><h3 class="card-title">المستحقات غير المسددة</h3><span class="badge">الإجمالي ${formatMoney(totalDue, 'EGP')}</span></div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>البند</th><th>المورد</th><th>الاستحقاق</th><th>المتبقي</th><th>المعادل (ج.م)</th><th>الحالة</th><th></th></tr></thead>
                    <tbody>${dueRows.length ? dueRows.join('') : emptyRow(7, 'لا توجد مستحقات غير مسددة')}</tbody>
                </table>
            </div>
            <p class="matrix-note">لربط مصروف بمورد، عدّل المصروف من صفحة مشروعه واختر المورد.</p>
        </div>
        <div class="card">
            <div class="card-header"><h3 class="card-title">حسابات الموردين</h3></div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>المورد</th><th>الهاتف</th><th>البنود</th><th>إجمالي الفواتير</th><th>المسدد</th><th>المتبقي</th><th>أقرب استحقاق</th><th></th></tr></thead>
                    <tbody>${supplierRows.length ? supplierRows.join('') : emptyRow(8, 'لا يوجد موردون بعد')}</tbody>
                </table>
            </div>
        </div>`;
}

// ---------- Cash flow ----------
function renderCashflow() {
    const cur = currentRates();
    const cf = cashflowForecast(appData, cur);
    const inflow = cf.events.filter(e => e.kind === 'in').reduce((t, e) => t + e.amountEgp, 0);
    const outflow = cf.events.filter(e => e.kind === 'out').reduce((t, e) => t + e.amountEgp, 0);

    el('app').innerHTML = `
        ${viewHeader('التدفق النقدي المتوقع', 'الرصيد من اليوم مع الدفعات المجدولة من العملاء والمستحقات غير المسددة للموردين')}
        <div class="grid-kpi">
            ${kpiCard('النقد المتاح الآن (تقديري)', formatMoney(cf.cash, 'EGP'), `رصيد افتتاحي ${formatMoney(appData.settings.openingCashEgp || 0, 'EGP')} + المحصل − المسدد`, cf.cash < 0 ? 'text-neg' : 'text-brand')}
            ${kpiCard('وارد متوقع', formatMoney(inflow, 'EGP'), 'دفعات العملاء المجدولة بسعر اليوم', 'text-pos')}
            ${kpiCard('صادر متوقع', formatMoney(outflow, 'EGP'), 'مستحقات الموردين غير المسددة', 'text-neg')}
            ${kpiCard('أدنى رصيد متوقع', formatMoney(cf.minBalance, 'EGP'), cf.firstNegative ? `أول عجز بتاريخ ${formatDate(cf.firstNegative)}` : 'لا يوجد عجز متوقع', cf.minBalance < 0 ? 'text-neg' : 'text-pos')}
        </div>
        ${cf.unscheduledEgp > 0.5 ? `<div class="alert-box alert-warn alert-sm"><div class="alert-main"><div class="alert-icon">!</div><div><h3 class="alert-title">مبالغ عند العملاء غير مجدولة</h3><p class="alert-text">حوالي ${formatMoney(cf.unscheduledEgp, 'EGP')} متبقية عند العملاء بلا تاريخ متوقع، فهي غير محسوبة في هذا التوقع. جدولها من صفحة كل مشروع.</p></div></div></div>` : ''}
        <div class="card">
            <div class="card-header"><h3 class="card-title">الرصيد المتوقع عبر الزمن</h3></div>
            <div class="chart-box chart-tall"><canvas id="cashChart"></canvas></div>
        </div>
        <div class="card">
            <div class="card-header"><h3 class="card-title">الحركات المتوقعة</h3><span class="badge">${cf.events.length} حركة</span></div>
            ${eventsTable(cf.events)}
            <p class="matrix-note">المستحقات المتأخرة أو بدون تاريخ تُحسب اليوم، والدفعات المتأخرة من العملاء أيضًا، حتى لا يبدو التوقع أفضل من الواقع.</p>
        </div>`;

    drawLineChart(el('cashChart'), cashflowPoints(cf), { xLabel: dateLabel, step: true });
}

// ---------- FX ----------
function renderFx() {
    const cur = currentRates();
    const history = [...appData.fxRates].sort(byDate);
    const margin = appData.settings.fxAlertMargin;

    const rateRows = [...history].reverse().map((r, i, arr) => {
        const prev = arr[i + 1];
        const change = prev ? ((r.egp - prev.egp) / prev.egp) * 100 : null;
        return `
            <tr>
                <td>${formatDate(r.date)}</td>
                <td class="strong">${formatNum(r.egp)}</td>
                <td>${change === null ? '<span class="muted">—</span>' : `<span class="${change > 0 ? 'text-neg' : change < 0 ? 'text-pos' : 'muted'}">${change > 0 ? '+' : ''}${formatPct(change)}</span>`}</td>
                <td>${r.usd ? formatNum(r.usd) : '<span class="muted">—</span>'}</td>
                <td>${r.usd ? formatNum(r.usd / r.egp) : '<span class="muted">—</span>'}</td>
                ${rowActions('rate', { id: r.id })}
            </tr>`;
    });

    const exposure = appData.projects.filter(p => p.status === 'active').map(p => {
        const s = projectSummary(p, cur);
        const distance = s.breakEven ? ((s.breakEven - cur.egp) / cur.egp) * 100 : null;
        let status;
        if (!s.breakEven) status = pill('غير متأثر', 'pos');
        else if (cur.egp >= s.breakEven) status = pill('تجاوز التعادل', 'neg');
        else if (distance <= margin) status = pill('قريب من التعادل', 'warn');
        else status = pill('آمن', 'pos');
        return `
            <tr>
                <td><a href="#/project/${p.id}" class="strong">${escapeHtml(p.code)}</a> <span class="muted">${escapeHtml(clientName(p.clientId))}</span></td>
                <td>${formatMoney(s.openSdg, 'SDG')}</td>
                <td>${s.breakEven ? formatNum(s.breakEven) : '<span class="muted">—</span>'}</td>
                <td>${distance === null ? '<span class="muted">—</span>' : formatPct(distance)}</td>
                <td>${status}</td>
            </tr>`;
    });

    el('app').innerHTML = `
        ${viewHeader('أسعار الصرف', 'سجل يومي للأسعار، وتعرّض المشاريع لتغيرها', '<button type="button" class="btn btn-primary" data-action="add-rate">+ تسجيل سعر</button>')}
        <div class="grid-kpi">
            ${kpiCard('الجنيه المصري', `${formatNum(cur.egp)} ج.س`, `آخر تحديث ${formatDate(cur.date)}`, 'text-brand')}
            ${kpiCard('الدولار', cur.usd ? `${formatNum(cur.usd)} ج.س` : '—', cur.usd ? 'آخر سعر مسجل' : 'لم يُسجل سعر للدولار بعد')}
            ${kpiCard('الدولار بالجنيه المصري', cur.usd ? `${formatNum(cur.usd / cur.egp)} ج.م` : '—', 'محسوب من السعرين')}
            ${kpiCard('حد التنبيه', formatPct(margin), 'من نقطة التعادل. يُعدّل من الإعدادات')}
        </div>
        <div class="card">
            <div class="card-header"><h3 class="card-title">تعرّض المشاريع النشطة لسعر الصرف</h3></div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>المشروع</th><th>المتبقي عند العميل</th><th>نقطة التعادل</th><th>المسافة من سعر اليوم</th><th>الحالة</th></tr></thead>
                    <tbody>${exposure.length ? exposure.join('') : emptyRow(5, 'لا توجد مشاريع نشطة')}</tbody>
                </table>
            </div>
        </div>
        <div class="grid-2">
            <div class="card">
                <div class="card-header"><h3 class="card-title">تطور سعر الجنيه المصري</h3></div>
                <div class="chart-box"><canvas id="fxChart"></canvas></div>
            </div>
            <div class="card">
                <div class="card-header"><h3 class="card-title">السجل اليومي</h3><span class="badge">${history.length} يوم</span></div>
                <div class="table-wrap">
                    <table>
                        <thead><tr><th>التاريخ</th><th>ج.م (ج.س)</th><th>التغير</th><th>$ (ج.س)</th><th>$ (ج.م)</th><th></th></tr></thead>
                        <tbody>${rateRows.join('')}</tbody>
                    </table>
                </div>
            </div>
        </div>`;

    drawLineChart(el('fxChart'), history.map(r => ({ x: Date.parse(r.date), y: r.egp, tone: 'brand' })), { xLabel: dateLabel });
}

// ---------- Quotes ----------
function renderQuotes() {
    const tones = { draft: 'muted', sent: 'brand', accepted: 'pos', rejected: 'neg' };
    const rows = [...appData.quotes].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).map(q => {
        const project = q.projectId && getProject(q.projectId);
        const expired = q.status !== 'accepted' && q.validUntil && q.validUntil < todayIso();
        return `
            <tr>
                <td class="strong">${escapeHtml(q.number)}</td>
                <td>${escapeHtml(clientName(q.clientId))}</td>
                <td>${formatDate(q.date)}</td>
                <td>${q.validUntil ? formatDate(q.validUntil) : '—'} ${expired ? pill('منتهي', 'neg') : ''}</td>
                <td class="strong">${formatMoney(quoteTotal(q), q.currency)}</td>
                <td>${pill(QUOTE_STATUS[q.status], tones[q.status])}</td>
                <td>${project ? `<a href="#/project/${project.id}">${escapeHtml(project.code)}</a>` : `<button type="button" class="btn btn-primary btn-sm" data-action="convert-quote"${dataAttrs({ id: q.id })}>تحويل إلى مشروع</button>`}</td>
                ${rowActions('quote', { id: q.id }, `<button type="button" class="btn btn-quiet btn-sm" data-action="print-quote"${dataAttrs({ id: q.id })}>طباعة</button>`)}
            </tr>`;
    });

    el('app').innerHTML = `
        ${viewHeader('عروض الأسعار', 'أنشئ العرض واطبعه أو احفظه PDF، ثم حوّله إلى مشروع عند قبوله', '<button type="button" class="btn btn-primary" data-action="add-quote">+ عرض سعر جديد</button>')}
        <div class="card">
            <div class="table-wrap">
                <table>
                    <thead><tr><th>الرقم</th><th>العميل</th><th>التاريخ</th><th>صالح حتى</th><th>الإجمالي</th><th>الحالة</th><th>المشروع</th><th></th></tr></thead>
                    <tbody>${rows.length ? rows.join('') : emptyRow(8, 'لا توجد عروض أسعار بعد')}</tbody>
                </table>
            </div>
        </div>`;
}

// ---------- Settings ----------
function renderSettings() {
    const st = appData.settings;
    const c = st.company;
    const templates = appData.workflowTemplates.map(t => `
        <div class="template-box">
            <div class="form-group">
                <label for="tplName_${escapeHtml(t.id)}">اسم القالب</label>
                <input id="tplName_${escapeHtml(t.id)}" value="${escapeHtml(t.name)}">
            </div>
            <div class="form-group">
                <label for="tplSteps_${escapeHtml(t.id)}">المراحل (مرحلة في كل سطر)</label>
                <textarea id="tplSteps_${escapeHtml(t.id)}" rows="6">${escapeHtml(t.steps.join('\n'))}</textarea>
            </div>
            <button type="button" class="btn btn-quiet btn-sm text-neg" data-action="delete-template"${dataAttrs({ key: t.id })}>حذف القالب</button>
        </div>`).join('');

    el('app').innerHTML = `
        ${viewHeader('الإعدادات', 'بيانات الشركة على المستندات، وحدود التنبيه، وقوالب المراحل، والنسخ الاحتياطي', '<button type="button" class="btn btn-primary" data-action="save-settings">حفظ الإعدادات</button>')}
        <div class="grid-2">
            <div class="card">
                <div class="card-header"><h3 class="card-title">بيانات الشركة على المستندات</h3></div>
                <div class="modal-fields">
                    <div class="form-group"><label for="setName">اسم الشركة</label><input id="setName" value="${escapeHtml(c.name)}"></div>
                    <div class="form-group half"><label for="setPhone">الهاتف</label><input id="setPhone" value="${escapeHtml(c.phone)}"></div>
                    <div class="form-group half"><label for="setEmail">البريد الإلكتروني</label><input id="setEmail" value="${escapeHtml(c.email)}"></div>
                    <div class="form-group"><label for="setAddress">العنوان</label><input id="setAddress" value="${escapeHtml(c.address)}"></div>
                </div>
            </div>
            <div class="card">
                <div class="card-header"><h3 class="card-title">الإعدادات المالية</h3></div>
                <div class="modal-fields">
                    <div class="form-group half">
                        <label for="setMargin">حد تنبيه سعر الصرف (%)</label>
                        <input id="setMargin" type="number" step="any" min="0" value="${st.fxAlertMargin}">
                        <p class="form-hint">تنبيه عندما يقترب سعر اليوم من نقطة تعادل أي مشروع بهذه النسبة.</p>
                    </div>
                    <div class="form-group half">
                        <label for="setOpening">الرصيد النقدي الافتتاحي (ج.م)</label>
                        <input id="setOpening" type="number" step="any" value="${st.openingCashEgp}">
                        <p class="form-hint">النقد المتوفر قبل المشاريع المسجلة، ويبدأ منه التدفق النقدي.</p>
                    </div>
                </div>
            </div>
        </div>
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">قوالب مراحل التنفيذ حسب نوع الخدمة</h3>
                <button type="button" class="btn btn-quiet btn-sm" data-action="add-template">+ قالب جديد</button>
            </div>
            <p class="matrix-note" style="margin: 0 0 1rem;">تُنسخ مراحل القالب عند إنشاء مشروع جديد، ولا يتغير المشروع القائم عند تعديل القالب.</p>
            <div class="templates-grid">${templates}</div>
        </div>
        <div class="card">
            <div class="card-header"><h3 class="card-title">النسخ الاحتياطي</h3></div>
            <p class="alert-text" style="margin-bottom: 1rem;">البيانات محفوظة على هذا المتصفح فقط. نزّل نسخة احتياطية دوريًا، واستوردها لنقل البيانات إلى جهاز آخر.</p>
            <div class="view-actions">
                <button type="button" class="btn btn-primary" data-action="export-data">تنزيل نسخة احتياطية</button>
                <label for="importFile" class="btn btn-secondary">استيراد نسخة احتياطية</label>
            </div>
        </div>`;
}

function saveSettings() {
    const margin = parseFloat(el('setMargin').value);
    const opening = parseFloat(el('setOpening').value);
    if (!(margin >= 0 && margin <= 100)) { alert('حد التنبيه يجب أن يكون بين 0 و100.'); return; }
    const templates = [];
    for (const t of appData.workflowTemplates) {
        const name = el(`tplName_${t.id}`).value.trim();
        const steps = el(`tplSteps_${t.id}`).value.split('\n').map(x => x.trim()).filter(Boolean);
        if (!name || !steps.length) { alert('كل قالب يحتاج اسمًا ومرحلة واحدة على الأقل.'); return; }
        templates.push({ ...t, name, steps });
    }
    appData.workflowTemplates = templates;
    appData.settings.fxAlertMargin = margin;
    appData.settings.openingCashEgp = isFinite(opening) ? opening : 0;
    appData.settings.company = {
        name: el('setName').value.trim() || DEFAULT_SETTINGS.company.name,
        phone: el('setPhone').value.trim(),
        email: el('setEmail').value.trim(),
        address: el('setAddress').value.trim()
    };
    saveData();
    showToast('تم حفظ الإعدادات');
}

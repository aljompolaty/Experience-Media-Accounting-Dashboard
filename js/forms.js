/* Entity forms (add / edit) and delete operations. Each form mutates appData on submit. */

const PROJECT_STATUS = { active: 'نشط', completed: 'مكتمل' };
const STEP_STATUS = { pending: 'قيد الانتظار', in_progress: 'قيد التنفيذ', completed: 'مكتمل' };
const QUOTE_STATUS = { draft: 'مسودة', sent: 'مُرسل', accepted: 'مقبول', rejected: 'مرفوض' };

function toOptions(map) {
    return Object.entries(map).map(([value, label]) => ({ value, label }));
}

function currencyOptions() {
    return Object.keys(CURRENCIES).map(c => ({ value: c, label: CURRENCIES[c].label }));
}

function clientOptions() {
    return [{ value: '', label: 'اختر عميلًا' }, ...appData.clients.map(c => ({ value: c.id, label: c.name }))];
}

function rateFields(rates, hint) {
    return [
        { name: 'rateEgp', label: 'سعر الجنيه المصري (ج.س)', type: 'number', value: rates.egp, half: true, hint },
        { name: 'rateUsd', label: 'سعر الدولار (ج.س)', type: 'number', value: rates.usd ?? '', half: true, hint: 'مطلوب فقط عند التعامل بالدولار.' }
    ];
}

function readRates(v) {
    if (!(v.rateEgp > 0)) return { error: 'أدخل سعر الجنيه المصري بالسوداني أكبر من صفر.' };
    if (v.currency === 'USD' && !(v.rateUsd > 0)) return { error: 'أدخل سعر الدولار لأن العملة المختارة دولار.' };
    return { rates: { egp: v.rateEgp, usd: v.rateUsd > 0 ? v.rateUsd : null } };
}

// Resolves the client chosen in a form: an existing one, or a new one typed by name.
function resolveClient(v) {
    if (v.newClient) {
        const client = { id: newId(), name: v.newClient, phone: '', notes: '' };
        appData.clients.push(client);
        return client.id;
    }
    return v.clientId ? Number(v.clientId) : null;
}

function confirmDelete(label, name) {
    return confirm(`هل تريد حذف ${label} "${name}"؟ لا يمكن التراجع عن الحذف.`);
}

// ---------- Projects ----------
function openProjectForm(project, prefill = {}) {
    const isNew = !project;
    const base = project || prefill;
    const fields = [
        { name: 'code', label: 'كود المشروع', value: base.code || nextProjectCode(), half: true },
        { name: 'status', label: 'الحالة', type: 'select', options: toOptions(PROJECT_STATUS), value: base.status || 'active', half: true },
        { name: 'clientId', label: 'العميل', type: 'select', options: clientOptions(), value: base.clientId || '', half: true },
        { name: 'newClient', label: 'أو عميل جديد', placeholder: 'اكتب اسم العميل الجديد', half: true },
        { name: 'service', label: 'وصف الخدمة', value: base.service || '', placeholder: 'مثال: تنفيذ 1000 تيشيرت مطبوع' },
        { name: 'quantity', label: 'الكمية', type: 'number', value: base.quantity ?? 1, half: true },
        { name: 'contractSdg', label: 'قيمة التعاقد (ج.س)', type: 'number', value: base.contractSdg ?? '', half: true }
    ];
    if (isNew) {
        fields.push({
            name: 'serviceType', label: 'نوع الخدمة (قالب مراحل التنفيذ)', type: 'select',
            options: appData.workflowTemplates.map(t => ({ value: t.id, label: t.name })), value: base.serviceType || appData.workflowTemplates[0].id
        });
    }

    openForm({
        title: isNew ? 'مشروع جديد' : 'تعديل المشروع',
        submitLabel: isNew ? 'إنشاء المشروع' : 'حفظ التعديلات',
        fields,
        onSubmit: v => {
            if (!v.code) return 'أدخل كود المشروع.';
            if (appData.projects.some(p => p.code === v.code && (!project || p.id !== project.id))) return 'هذا الكود مستخدم لمشروع آخر.';
            if (!v.newClient && !v.clientId) return 'اختر عميلًا أو اكتب اسم عميل جديد.';
            if (!(v.quantity > 0)) return 'أدخل كمية أكبر من صفر.';
            if (!(v.contractSdg > 0)) return 'أدخل قيمة تعاقد أكبر من صفر.';
            const record = { code: v.code, status: v.status, clientId: resolveClient(v), service: v.service, quantity: v.quantity, contractSdg: v.contractSdg };

            if (!isNew) { Object.assign(project, record); return; }

            const template = getTemplate(v.serviceType);
            const created = {
                id: newId(), ...record, serviceType: v.serviceType, createdAt: todayIso(),
                payments: [], expenses: [], schedule: [],
                workflow: (template ? template.steps : []).map((name, i) => ({ id: i + 1, name, status: 'pending', owner: '', dueDate: null }))
            };
            appData.projects.push(created);
            const quote = prefill.quoteId && appData.quotes.find(q => q.id === prefill.quoteId);
            if (quote) { quote.projectId = created.id; quote.status = 'accepted'; }
            setTimeout(() => { location.hash = `#/project/${created.id}`; }, 0);
        }
    });
}

function deleteProject(pid) {
    const p = getProject(pid);
    if (!p || !confirmDelete('المشروع', `${p.code} · ${clientName(p.clientId)}`)) return;
    appData.projects = appData.projects.filter(x => x.id !== pid);
    appData.quotes.forEach(q => { if (q.projectId === pid) q.projectId = null; });
    location.hash = '#/';
    saveData();
}

function deleteFromProject(pid, list, id, label) {
    const p = getProject(pid);
    const item = p && p[list].find(x => x.id === id);
    if (!item || !confirmDelete(label, item.title || item.name)) return;
    p[list] = p[list].filter(x => x.id !== id);
    saveData();
}

// ---------- Client payments ----------
function openPaymentForm(pid, id, prefill = null, onSaved = null) {
    const p = getProject(pid);
    const payment = id ? p.payments.find(x => x.id === id) : null;
    const base = payment || prefill || {};
    openForm({
        title: payment ? 'تعديل الدفعة' : 'إضافة دفعة محصلة',
        submitLabel: 'حفظ الدفعة',
        fields: [
            { name: 'title', label: 'بيان الدفعة', value: base.title || '', placeholder: 'مثال: الدفعة الثانية' },
            { name: 'date', label: 'تاريخ التحصيل', type: 'date', value: base.date || todayIso(), half: true },
            { name: 'currency', label: 'العملة', type: 'select', options: currencyOptions(), value: base.currency || 'SDG', half: true },
            { name: 'amount', label: 'المبلغ', type: 'number', value: base.amount ?? '' },
            ...rateFields(base.rates || currentRates(), 'سعر يوم التحصيل، ويبقى ثابتًا لهذه الدفعة.')
        ],
        onSubmit: v => {
            if (!v.date) return 'حدّد تاريخ التحصيل.';
            if (!(v.amount > 0)) return 'أدخل مبلغًا أكبر من صفر.';
            const r = readRates(v);
            if (r.error) return r.error;
            upsert(p.payments, payment && payment.id, { title: v.title || 'دفعة', date: v.date, amount: v.amount, currency: v.currency, rates: r.rates });
            if (onSaved) onSaved();
        }
    });
}

// ---------- Expected client installments ----------
function openScheduleForm(pid, id) {
    const p = getProject(pid);
    const item = id ? p.schedule.find(x => x.id === id) : null;
    const s = projectSummary(p, currentRates());
    openForm({
        title: item ? 'تعديل الدفعة المتوقعة' : 'جدولة دفعة متوقعة من العميل',
        fields: [
            { name: 'title', label: 'البيان', value: item ? item.title : '', placeholder: 'مثال: الدفعة الثانية عند التسليم' },
            { name: 'date', label: 'التاريخ المتوقع', type: 'date', value: item ? item.date : addDays(todayIso(), 14), half: true },
            { name: 'amount', label: 'المبلغ (ج.س)', type: 'number', value: item ? item.amount : (s.unscheduledSdg || ''), half: true, hint: `غير المجدول من المتبقي: ${formatMoney(s.unscheduledSdg, 'SDG')}` }
        ],
        onSubmit: v => {
            if (!v.date) return 'حدّد التاريخ المتوقع.';
            if (!(v.amount > 0)) return 'أدخل مبلغًا أكبر من صفر.';
            upsert(p.schedule, item && item.id, { title: v.title || 'دفعة متوقعة', date: v.date, amount: v.amount });
        }
    });
}

// Records an installment as collected: opens a prefilled payment and drops the schedule item on save.
function collectSchedule(pid, id) {
    const p = getProject(pid);
    const item = p.schedule.find(x => x.id === id);
    if (!item) return;
    openPaymentForm(pid, null, { title: item.title, date: todayIso(), currency: 'SDG', amount: item.amount }, () => {
        p.schedule = p.schedule.filter(x => x.id !== id);
    });
}

// ---------- Expenses / supplier dues ----------
function openExpenseForm(pid, id) {
    const p = getProject(pid);
    const expense = id ? p.expenses.find(x => x.id === id) : null;
    const base = expense || {};
    const paidTotal = expense ? expensePaid(expense) : 0;
    openForm({
        title: expense ? 'تعديل المصروف' : 'إضافة مصروف',
        submitLabel: 'حفظ المصروف',
        fields: [
            { name: 'title', label: 'بند المصروف', value: base.title || '', placeholder: 'مثال: تكلفة الطباعة' },
            { name: 'supplierId', label: 'المورد', type: 'select', options: [{ value: '', label: 'بدون مورد' }, ...appData.suppliers.map(s => ({ value: s.id, label: s.name }))], value: base.supplierId || '' },
            { name: 'date', label: 'تاريخ المصروف', type: 'date', value: base.date || todayIso(), half: true },
            { name: 'dueDate', label: 'تاريخ الاستحقاق للمورد', type: 'date', value: base.dueDate || '', half: true, hint: 'اتركه فارغًا إن لم يُحدد.' },
            { name: 'currency', label: 'العملة', type: 'select', options: currencyOptions(), value: base.currency || 'EGP', half: true },
            { name: 'amount', label: 'المبلغ', type: 'number', value: base.amount ?? '', half: true },
            ...rateFields(base.rates || currentRates(), 'سعر يوم الصرف، ويبقى ثابتًا لهذا المصروف.'),
            { name: 'paidTotal', label: 'المسدد للمورد حتى الآن (بنفس العملة)', type: 'number', value: paidTotal, hint: expense ? 'عدّله فقط لتصحيح خطأ. لتسجيل سداد جديد استخدم زر "سداد".' : 'اكتب المبلغ كاملًا إن كان مسددًا عند التسجيل.' }
        ],
        onSubmit: v => {
            if (!v.date) return 'حدّد تاريخ المصروف.';
            if (!(v.amount > 0)) return 'أدخل مبلغًا أكبر من صفر.';
            const paid = v.paidTotal || 0;
            if (paid < 0 || paid > v.amount + 0.005) return 'المبلغ المسدد لا يمكن أن يتجاوز قيمة المصروف.';
            const r = readRates(v);
            if (r.error) return r.error;

            const record = {
                title: v.title || 'مصروف', date: v.date, dueDate: v.dueDate || null,
                supplierId: v.supplierId ? Number(v.supplierId) : null, amount: v.amount, currency: v.currency, rates: r.rates
            };
            // Only rewrite the settlement history when the paid total was actually changed.
            if (Math.abs(paid - paidTotal) > 0.005 || !expense) {
                const last = expense && [...expense.settlements].sort(byDate).pop();
                record.settlements = paid > 0 ? [{ id: newId(), date: last ? last.date : v.date, amount: paid }] : [];
            }
            upsert(p.expenses, expense && expense.id, record);
        }
    });
}

function openSettleForm(pid, id) {
    const p = getProject(pid);
    const e = p.expenses.find(x => x.id === id);
    if (!e) return;
    const outstanding = expenseOutstanding(e);
    openForm({
        title: `سداد: ${e.title}`,
        submitLabel: 'تسجيل السداد',
        fields: [
            { name: 'amount', label: `المبلغ المسدد (${CURRENCIES[e.currency].short})`, type: 'number', value: Math.round(outstanding * 100) / 100, half: true, hint: `المتبقي: ${formatMoney(outstanding, e.currency)}` },
            { name: 'date', label: 'تاريخ السداد', type: 'date', value: todayIso(), half: true }
        ],
        onSubmit: v => {
            if (!v.date) return 'حدّد تاريخ السداد.';
            if (!(v.amount > 0)) return 'أدخل مبلغًا أكبر من صفر.';
            if (v.amount > outstanding + 0.005) return 'المبلغ أكبر من المتبقي للمورد.';
            e.settlements.push({ id: newId(), date: v.date, amount: v.amount });
        }
    });
}

// ---------- Workflow steps ----------
function openStepForm(pid, id) {
    const p = getProject(pid);
    const step = id ? p.workflow.find(x => x.id === id) : null;
    openForm({
        title: step ? 'تعديل المرحلة' : 'إضافة مرحلة',
        fields: [
            { name: 'name', label: 'اسم المرحلة', value: step ? step.name : '' },
            { name: 'owner', label: 'المسؤول', value: step ? step.owner : '', half: true, placeholder: 'اسم الموظف' },
            { name: 'dueDate', label: 'الموعد النهائي', type: 'date', value: step ? step.dueDate || '' : '', half: true },
            { name: 'status', label: 'الحالة', type: 'select', options: toOptions(STEP_STATUS), value: step ? step.status : 'pending' }
        ],
        onSubmit: v => {
            if (!v.name) return 'أدخل اسم المرحلة.';
            const record = { name: v.name, owner: v.owner, dueDate: v.dueDate || null, status: v.status };
            if (step) Object.assign(step, record);
            else p.workflow.push({ id: p.workflow.reduce((m, s) => Math.max(m, s.id), 0) + 1, ...record });
        }
    });
}

// ---------- Clients and suppliers ----------
function openPartyForm(kind, id) {
    const list = kind === 'client' ? appData.clients : appData.suppliers;
    const label = kind === 'client' ? 'العميل' : 'المورد';
    const item = id ? list.find(x => x.id === id) : null;
    openForm({
        title: item ? `تعديل ${label}` : `إضافة ${kind === 'client' ? 'عميل' : 'مورد'}`,
        fields: [
            { name: 'name', label: 'الاسم', value: item ? item.name : '' },
            { name: 'phone', label: 'الهاتف', value: item ? item.phone : '', placeholder: '+249912345678', hint: kind === 'client' ? 'بالصيغة الدولية (يبدأ بـ +) ليفتح واتساب محادثة العميل مباشرة.' : '' },
            { name: 'notes', label: 'ملاحظات', type: 'textarea', value: item ? item.notes : '' }
        ],
        onSubmit: v => {
            if (!v.name) return 'أدخل الاسم.';
            upsert(list, item && item.id, { name: v.name, phone: v.phone, notes: v.notes });
        }
    });
}

function deleteParty(kind, id) {
    if (kind === 'client') {
        const c = getClient(id);
        if (!c) return;
        if (appData.projects.some(p => p.clientId === id) || appData.quotes.some(q => q.clientId === id)) {
            alert('لا يمكن حذف هذا العميل لأن له مشاريع أو عروض أسعار مسجلة.');
            return;
        }
        if (!confirmDelete('العميل', c.name)) return;
        appData.clients = appData.clients.filter(x => x.id !== id);
    } else {
        const s = getSupplier(id);
        if (!s) return;
        if (appData.projects.some(p => p.expenses.some(e => e.supplierId === id))) {
            alert('لا يمكن حذف هذا المورد لأن له مصروفات مسجلة.');
            return;
        }
        if (!confirmDelete('المورد', s.name)) return;
        appData.suppliers = appData.suppliers.filter(x => x.id !== id);
    }
    saveData();
}

// ---------- FX history ----------
function openRateForm(id) {
    const entry = id ? appData.fxRates.find(r => r.id === id) : null;
    const cur = currentRates();
    openForm({
        title: entry ? 'تعديل سعر الصرف' : 'تسجيل سعر صرف',
        fields: [
            { name: 'date', label: 'التاريخ', type: 'date', value: entry ? entry.date : todayIso() },
            { name: 'egp', label: 'سعر الجنيه المصري (ج.س)', type: 'number', value: entry ? entry.egp : cur.egp, half: true },
            { name: 'usd', label: 'سعر الدولار (ج.س)', type: 'number', value: entry ? entry.usd ?? '' : cur.usd ?? '', half: true, hint: 'اختياري.' }
        ],
        onSubmit: v => {
            if (!v.date) return 'حدّد التاريخ.';
            if (!(v.egp > 0)) return 'أدخل سعر الجنيه المصري أكبر من صفر.';
            if (appData.fxRates.some(r => r.date === v.date && (!entry || r.id !== entry.id))) return 'يوجد سعر مسجل لهذا التاريخ، عدّله بدلًا من إضافة سعر جديد.';
            upsert(appData.fxRates, entry && entry.id, { date: v.date, egp: v.egp, usd: v.usd > 0 ? v.usd : null });
        }
    });
}

function deleteRate(id) {
    if (appData.fxRates.length <= 1) { alert('يجب أن يبقى سعر صرف واحد على الأقل.'); return; }
    const entry = appData.fxRates.find(r => r.id === id);
    if (!entry || !confirmDelete('سعر يوم', formatDate(entry.date))) return;
    appData.fxRates = appData.fxRates.filter(r => r.id !== id);
    saveData();
}

// ---------- Quotes ----------
function openQuoteForm(id) {
    const quote = id ? appData.quotes.find(q => q.id === id) : null;
    const base = quote || {};
    const date = base.date || todayIso();
    openForm({
        title: quote ? `تعديل عرض السعر ${quote.number}` : 'عرض سعر جديد',
        submitLabel: 'حفظ العرض',
        fields: [
            { name: 'number', label: 'رقم العرض', value: base.number || nextQuoteNumber(), half: true },
            { name: 'status', label: 'الحالة', type: 'select', options: toOptions(QUOTE_STATUS), value: base.status || 'draft', half: true },
            { name: 'clientId', label: 'العميل', type: 'select', options: clientOptions(), value: base.clientId || '', half: true },
            { name: 'newClient', label: 'أو عميل جديد', placeholder: 'اكتب اسم العميل الجديد', half: true },
            { name: 'date', label: 'تاريخ العرض', type: 'date', value: date, half: true },
            { name: 'validUntil', label: 'صالح حتى', type: 'date', value: base.validUntil || addDays(date, 14), half: true },
            { name: 'currency', label: 'عملة العرض', type: 'select', options: currencyOptions(), value: base.currency || 'SDG' },
            { name: 'items', type: 'items', value: base.items || [] },
            { name: 'notes', label: 'ملاحظات وشروط', type: 'textarea', value: base.notes || '', placeholder: 'مثال: 50% مقدم عند التعاقد والباقي عند التسليم.' }
        ],
        onSubmit: v => {
            if (!v.number) return 'أدخل رقم العرض.';
            if (!v.newClient && !v.clientId) return 'اختر عميلًا أو اكتب اسم عميل جديد.';
            if (!v.date) return 'حدّد تاريخ العرض.';
            const items = v.items.filter(i => i.description && i.qty > 0 && i.unitPrice > 0);
            if (!items.length) return 'أضف بندًا واحدًا على الأقل بوصف وكمية وسعر.';
            if (items.length !== v.items.length) return 'كل بند يحتاج وصفًا وكمية وسعرًا أكبر من صفر.';
            upsert(appData.quotes, quote && quote.id, {
                number: v.number, status: v.status, clientId: resolveClient(v), date: v.date, validUntil: v.validUntil || null,
                currency: v.currency, items: items.map(i => ({ id: newId(), ...i })), notes: v.notes, projectId: base.projectId || null
            });
        }
    });
}

function convertQuote(id) {
    const quote = appData.quotes.find(q => q.id === id);
    if (!quote) return;
    if (quote.projectId && getProject(quote.projectId)) { location.hash = `#/project/${quote.projectId}`; return; }
    const total = quoteTotal(quote);
    const first = quote.items[0] ? quote.items[0].description : '';
    openProjectForm(null, {
        clientId: quote.clientId,
        service: quote.items.length > 1 ? `${first} وبنود أخرى` : first,
        quantity: quote.items.reduce((sum, i) => sum + i.qty, 0),
        contractSdg: Math.round(toSdg(total, quote.currency, currentRates())),
        quoteId: quote.id
    });
}

function deleteQuote(id) {
    const quote = appData.quotes.find(q => q.id === id);
    if (!quote || !confirmDelete('عرض السعر', quote.number)) return;
    appData.quotes = appData.quotes.filter(q => q.id !== id);
    saveData();
}

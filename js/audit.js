/* Automatic change log. Instead of hooking every form, each save diffs the data against the
   previous save and records what was added, edited or deleted. */

const AUDIT_LIMIT = 1000;
let auditBaseline = null;

// Plain text (no bidi isolates) so entries read cleanly in exports and WhatsApp too.
function plainMoney(num, currency) {
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num)} ${CURRENCIES[currency].short}`;
}

const AUDIT_COLLECTIONS = [
    { key: 'clients', label: 'عميل', name: x => x.name, detail: x => x.phone || '' },
    { key: 'suppliers', label: 'مورد', name: x => x.name, detail: x => x.phone || '' },
    { key: 'quotes', label: 'عرض سعر', name: x => x.number, detail: x => `${plainMoney(quoteTotal(x), x.currency)} · ${QUOTE_STATUS[x.status]}` },
    { key: 'fxRates', label: 'سعر صرف', name: x => formatDate(x.date), detail: x => `ج.م ${x.egp}${x.usd ? ` · $ ${x.usd}` : ''}` },
    { key: 'workflowTemplates', label: 'قالب مراحل', name: x => x.name, detail: x => `${x.steps.length} مراحل` }
];

const AUDIT_PROJECT_LISTS = [
    { key: 'payments', label: 'دفعة', name: x => x.title, detail: x => `${plainMoney(x.amount, x.currency)} · ${formatDate(x.date)}` },
    { key: 'expenses', label: 'مصروف', name: x => x.title, detail: x => `${plainMoney(x.amount, x.currency)} · مسدد ${plainMoney(expensePaid(x), x.currency)}` },
    { key: 'schedule', label: 'دفعة متوقعة', name: x => x.title, detail: x => `${plainMoney(x.amount, 'SDG')} · ${formatDate(x.date)}` },
    { key: 'workflow', label: 'مرحلة', name: x => x.name, detail: x => STEP_STATUS[x.status] }
];

const PROJECT_FIELDS = { code: 'الكود', clientId: 'العميل', service: 'الخدمة', quantity: 'الكمية', contractSdg: 'قيمة التعاقد', status: 'الحالة' };

function snapshotForAudit(data) {
    const { auditLog, ...rest } = data;
    return clone(rest);
}

function resetAuditBaseline() {
    auditBaseline = snapshotForAudit(appData);
}

function auditEntry(type, entity, name, detail = '', project = null) {
    return {
        id: newId(), at: new Date().toISOString(), type, entity, name: name || '', detail,
        project: project ? project.code : null, projectId: project ? project.id : null,
        device: typeof deviceName === 'function' ? deviceName() : ''
    };
}

function diffList(before, after, spec, project) {
    const entries = [];
    const beforeById = new Map(before.map(x => [x.id, x]));
    const afterIds = new Set(after.map(x => x.id));
    after.forEach(item => {
        const old = beforeById.get(item.id);
        if (!old) {
            entries.push(auditEntry('add', spec.label, spec.name(item), spec.detail(item), project));
        } else if (JSON.stringify(old) !== JSON.stringify(item)) {
            const was = spec.detail(old);
            const now = spec.detail(item);
            entries.push(auditEntry('edit', spec.label, spec.name(item), was !== now ? `من ${was} إلى ${now}` : 'تعديل البيانات', project));
        }
    });
    before.forEach(item => {
        if (!afterIds.has(item.id)) entries.push(auditEntry('delete', spec.label, spec.name(item), spec.detail(item), project));
    });
    return entries;
}

function diffData(before, after) {
    const entries = [];
    AUDIT_COLLECTIONS.forEach(spec => entries.push(...diffList(before[spec.key] || [], after[spec.key] || [], spec)));

    const beforeProjects = new Map((before.projects || []).map(p => [p.id, p]));
    const afterIds = new Set(after.projects.map(p => p.id));
    after.projects.forEach(p => {
        const old = beforeProjects.get(p.id);
        if (!old) {
            entries.push(auditEntry('add', 'مشروع', p.code, `${clientName(p.clientId)} · ${plainMoney(p.contractSdg, 'SDG')}`, p));
            return;
        }
        const changed = Object.keys(PROJECT_FIELDS).filter(k => JSON.stringify(old[k]) !== JSON.stringify(p[k]));
        if (changed.length) entries.push(auditEntry('edit', 'مشروع', p.code, `تغيّر: ${changed.map(k => PROJECT_FIELDS[k]).join('، ')}`, p));
        AUDIT_PROJECT_LISTS.forEach(spec => entries.push(...diffList(old[spec.key] || [], p[spec.key] || [], spec, p)));
    });
    (before.projects || []).forEach(p => {
        if (!afterIds.has(p.id)) entries.push(auditEntry('delete', 'مشروع', p.code, `${clientName(p.clientId)} · ${plainMoney(p.contractSdg, 'SDG')}`));
    });

    if (JSON.stringify(before.settings) !== JSON.stringify(after.settings)) entries.push(auditEntry('edit', 'الإعدادات', 'إعدادات النظام'));
    return entries;
}

function addAuditEntries(entries) {
    if (!entries.length) return;
    appData.auditLog = [...entries, ...(appData.auditLog || [])].slice(0, AUDIT_LIMIT);
}

// Called by saveData() before the data is persisted.
function recordAudit() {
    if (auditBaseline) addAuditEntries(diffData(auditBaseline, appData));
    resetAuditBaseline();
}

// ---------- Activity page ----------
const AUDIT_TYPE_PILL = { add: ['إضافة', 'pos'], edit: ['تعديل', 'brand'], delete: ['حذف', 'neg'], import: ['استيراد', 'warn'] };

function renderActivity() {
    const log = appData.auditLog || [];
    const rows = log.map(e => {
        const [label, tone] = AUDIT_TYPE_PILL[e.type] || [e.type, 'muted'];
        const when = new Date(e.at);
        const search = `${e.entity} ${e.name} ${e.project || ''} ${e.detail} ${e.device}`.toLowerCase();
        const project = e.projectId && getProject(e.projectId)
            ? `<a href="#/project/${e.projectId}">${escapeHtml(e.project)}</a>`
            : (e.project ? escapeHtml(e.project) : '<span class="muted">—</span>');
        return `
            <tr data-search="${escapeHtml(search)}">
                <td>${formatDate(isoDate(when))}<div class="cell-date">${when.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}</div></td>
                <td>${pill(label, tone)}</td>
                <td>${escapeHtml(e.entity)}</td>
                <td class="cell-wrap strong">${escapeHtml(e.name)}</td>
                <td>${project}</td>
                <td class="cell-wrap muted">${escapeHtml(e.detail)}</td>
                <td class="muted">${escapeHtml(e.device || '—')}</td>
            </tr>`;
    });

    el('app').innerHTML = `
        ${viewHeader('سجل التغييرات', `كل إضافة وتعديل وحذف، مع وقته والجهاز الذي تم منه. يُحفظ آخر ${AUDIT_LIMIT} تغيير.`)}
        <div class="card">
            <div class="card-header">
                <input type="search" id="activitySearch" class="search-input" placeholder="ابحث باسم، مشروع، مبلغ…" aria-label="بحث في السجل">
                <span class="badge">${log.length} تغيير</span>
            </div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>الوقت</th><th>العملية</th><th>النوع</th><th>الاسم</th><th>المشروع</th><th>التفاصيل</th><th>الجهاز</th></tr></thead>
                    <tbody id="activityBody">${rows.length ? rows.join('') : emptyRow(7, 'لا توجد تغييرات مسجلة بعد. يبدأ السجل من أول تعديل بعد هذا التحديث.')}</tbody>
                </table>
            </div>
        </div>`;

    el('activitySearch').addEventListener('input', (ev) => {
        const q = ev.target.value.trim().toLowerCase();
        document.querySelectorAll('#activityBody tr[data-search]').forEach(tr => {
            tr.classList.toggle('hidden', q && !tr.dataset.search.includes(q));
        });
    });
}

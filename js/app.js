/* Router, header, theme, actions and event wiring. Loaded last. */

const VIEWS = {
    overview: renderOverview,
    project: renderProject,
    clients: renderClients,
    suppliers: renderSuppliers,
    cashflow: renderCashflow,
    fx: renderFx,
    quotes: renderQuotes,
    settings: renderSettings
};

const NAV = [
    ['overview', '#/', 'الرئيسية'],
    ['clients', '#/clients', 'العملاء'],
    ['suppliers', '#/suppliers', 'الموردون'],
    ['cashflow', '#/cashflow', 'التدفق النقدي'],
    ['fx', '#/fx', 'أسعار الصرف'],
    ['quotes', '#/quotes', 'عروض الأسعار'],
    ['settings', '#/settings', 'الإعدادات']
];

function parseRoute() {
    const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
    return { name: VIEWS[name] ? name : 'overview', id: id ? Number(id) : null };
}

function render() {
    const route = parseRoute();
    const cur = currentRates();
    const egpInput = el('fxEgpInput');
    const usdInput = el('fxUsdInput');
    if (document.activeElement !== egpInput) egpInput.value = cur.egp;
    if (document.activeElement !== usdInput) usdInput.value = cur.usd ?? '';

    const section = route.name === 'project' ? 'overview' : route.name;
    el('mainNav').innerHTML = NAV.map(([key, href, label]) =>
        `<a href="${href}" class="${key === section ? 'active' : ''}" ${key === section ? 'aria-current="page"' : ''}>${label}</a>`).join('');

    VIEWS[route.name](route);
}

let toastTimer;
function showToast(text) {
    const toast = el('toast');
    toast.innerText = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// ---------- Theme ----------
function isDarkTheme() {
    const explicit = document.documentElement.dataset.theme;
    if (explicit) return explicit === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function toggleTheme() {
    const next = isDarkTheme() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* storage unavailable */ }
    render();
}

// ---------- Settings helpers ----------
// Copies unsaved template edits from the page so adding or removing a template keeps them.
function syncTemplatesFromPage() {
    appData.workflowTemplates.forEach(t => {
        const name = el(`tplName_${t.id}`);
        const steps = el(`tplSteps_${t.id}`);
        if (name) t.name = name.value.trim() || t.name;
        if (steps) t.steps = steps.value.split('\n').map(x => x.trim()).filter(Boolean);
    });
}

function exportData() {
    const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `experience-media-backup-${todayIso()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
        let data;
        try {
            data = normalize(migrate(JSON.parse(reader.result)));
        } catch (err) {
            alert('الملف غير صالح أو تالف.');
            return;
        }
        if (!confirm(`سيتم استبدال كل البيانات الحالية بالنسخة المستوردة (${data.projects.length} مشروع). متابعة؟`)) return;
        appData = data;
        saveData();
        showToast('تم استيراد النسخة الاحتياطية');
    };
    reader.readAsText(file);
}

// ---------- Actions ----------
const ACTIONS = {
    'close-modal': () => closeModals(),
    'item-add': () => addItemRow(),
    'item-remove': (d, btn) => { btn.closest('tr').remove(); recalcItems(); },

    'new-project': () => openProjectForm(null),
    'edit-project': d => openProjectForm(getProject(d.pid)),
    'delete-project': d => deleteProject(d.pid),
    'print-invoice': d => printProjectStatement(d.pid),

    'add-payment': d => openPaymentForm(d.pid, null),
    'edit-payment': d => openPaymentForm(d.pid, d.id),
    'delete-payment': d => deleteFromProject(d.pid, 'payments', d.id, 'الدفعة'),

    'add-schedule': d => openScheduleForm(d.pid, null),
    'edit-schedule': d => openScheduleForm(d.pid, d.id),
    'delete-schedule': d => deleteFromProject(d.pid, 'schedule', d.id, 'الدفعة المتوقعة'),
    'collect-schedule': d => collectSchedule(d.pid, d.id),

    'add-expense': d => openExpenseForm(d.pid, null),
    'edit-expense': d => openExpenseForm(d.pid, d.id),
    'delete-expense': d => deleteFromProject(d.pid, 'expenses', d.id, 'المصروف'),
    'settle-expense': d => openSettleForm(d.pid, d.id),

    'add-step': d => openStepForm(d.pid, null),
    'edit-step': d => openStepForm(d.pid, d.id),
    'delete-step': d => deleteFromProject(d.pid, 'workflow', d.id, 'المرحلة'),

    'add-client': () => openPartyForm('client', null),
    'edit-client': d => openPartyForm('client', d.id),
    'delete-client': d => deleteParty('client', d.id),
    'add-supplier': () => openPartyForm('supplier', null),
    'edit-supplier': d => openPartyForm('supplier', d.id),
    'delete-supplier': d => deleteParty('supplier', d.id),

    'add-rate': () => openRateForm(null),
    'edit-rate': d => openRateForm(d.id),
    'delete-rate': d => deleteRate(d.id),

    'add-quote': () => openQuoteForm(null),
    'edit-quote': d => openQuoteForm(d.id),
    'delete-quote': d => deleteQuote(d.id),
    'print-quote': d => printQuote(d.id),
    'convert-quote': d => convertQuote(d.id),

    'save-settings': () => saveSettings(),
    'add-template': () => {
        syncTemplatesFromPage();
        appData.workflowTemplates.push({ id: `tpl${newId()}`, name: 'قالب جديد', steps: ['المرحلة الأولى'] });
        saveData();
    },
    'delete-template': d => {
        if (appData.workflowTemplates.length <= 1) { alert('يجب أن يبقى قالب واحد على الأقل.'); return; }
        syncTemplatesFromPage();
        const t = getTemplate(d.key);
        if (!t || !confirmDelete('القالب', t.name)) return;
        appData.workflowTemplates = appData.workflowTemplates.filter(x => x.id !== d.key);
        saveData();
    },
    'export-data': () => exportData()
};

document.addEventListener('click', (ev) => {
    if (ev.target.classList.contains('modal-overlay')) return closeModals();
    const btn = ev.target.closest('[data-action]');
    if (btn) {
        const handler = ACTIONS[btn.dataset.action];
        if (!handler) return;
        ev.preventDefault();
        handler({ pid: Number(btn.dataset.pid) || null, id: Number(btn.dataset.id) || null, key: btn.dataset.key }, btn);
        return;
    }
    const row = ev.target.closest('tr[data-href]');
    if (row && !ev.target.closest('a, button, select, input')) location.hash = row.dataset.href;
});

document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeModals();
});

document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.classList.contains('step-select')) {
        const p = getProject(Number(t.dataset.pid));
        const step = p && p.workflow.find(s => s.id === Number(t.dataset.step));
        if (step) { step.status = t.value; saveData(); }
    }
});

el('modalForm').addEventListener('submit', (ev) => { ev.preventDefault(); submitActiveForm(); });
el('modalForm').addEventListener('input', (ev) => { if (ev.target.closest('#itemsBody')) recalcItems(); });

// Header rates: commit on change (blur or Enter), so a half-typed number is never saved.
[['fxEgpInput', 'egp'], ['fxUsdInput', 'usd']].forEach(([id, field]) => {
    el(id).addEventListener('change', (e) => {
        const value = parseFloat(e.target.value);
        if (value > 0) {
            setTodayRate(field, value);
            saveData();
            showToast(`تم تسجيل سعر اليوم: ${formatNum(value)} ج.س`);
        } else {
            render();
        }
    });
});

el('importFile').addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (file) importData(file);
    ev.target.value = '';
});

el('themeToggle').addEventListener('click', toggleTheme);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
});
// Fonts change text metrics; redraw the canvases once the brand font is ready.
if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);
render();

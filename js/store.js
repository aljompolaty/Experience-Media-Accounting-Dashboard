/* Data model, schema migrations and persistence (localStorage). */

const STORAGE_KEY = 'exp_media_dashboard';
const THEME_KEY = 'exp_media_theme';
const SCHEMA_VERSION = 3;

// The original single-project data (schema v2). Fresh installs start from it and run the
// same migration as existing users, so both paths produce identical data.
const LEGACY_DEFAULT = {
    version: 2,
    fxRate: 185,
    project: { code: 'PRJ-001', client: 'شركة تينز', service: 'تنفيذ 1000 تيشيرت مطبوع' },
    contractSdg: 31000000,
    quantity: 1000,
    payments: [
        { id: 1, title: 'الدفعة الأولى المقدمة', date: null, sdg: 14000000, fxRate: 175 }
    ],
    expenses: [
        { id: 1, title: 'تكلفة المصنع (تصنيع وطباعة 1000 تيشيرت × 130 ج.م)', date: null, amount: 130000, currency: 'EGP', fxRate: 185 },
        { id: 2, title: 'تكلفة الشحن والتخليص', date: null, amount: 11000, currency: 'EGP', fxRate: 185 }
    ],
    workflow: [
        { id: 1, name: '1. استلام أمر الشراء والتصميم المعمد', status: 'completed' },
        { id: 2, name: '2. إرسال أمر التصنيع للمصنع والبدء', status: 'completed' },
        { id: 3, name: '3. فحص الجودة والتعبئة والتغليف', status: 'in_progress' },
        { id: 4, name: '4. الشحن والتخريج من المصنع', status: 'pending' },
        { id: 5, name: '5. تسليم الشحنة للعميل وتوقيع الإستلام', status: 'pending' },
        { id: 6, name: '6. تحصيل الدفعة المتبقية والتحليل المالي النهائي', status: 'pending' }
    ]
};

const DEFAULT_TEMPLATES = [
    { id: 'print', name: 'طباعة وتصنيع', steps: ['استلام أمر الشراء والتصميم المعتمد', 'إرسال أمر التصنيع للمصنع والبدء', 'فحص الجودة والتعبئة والتغليف', 'الشحن والتخريج من المصنع', 'تسليم الشحنة للعميل وتوقيع الاستلام', 'تحصيل الدفعة المتبقية والتحليل المالي النهائي'] },
    { id: 'video', name: 'إنتاج فيديو', steps: ['استلام الفكرة والموجز', 'كتابة السيناريو واعتماده', 'التصوير', 'المونتاج والتعليق الصوتي', 'مراجعة العميل والتعديلات', 'التسليم النهائي وتحصيل المتبقي'] },
    { id: 'billboard', name: 'لوحات إعلانية', steps: ['استلام الطلب وتحديد المواقع', 'التصميم واعتماده', 'حجز المواقع والتصاريح', 'الطباعة والتجهيز', 'التركيب والتوثيق بالصور', 'تحصيل المتبقي وتقرير الحملة'] },
    { id: 'general', name: 'خدمة عامة', steps: ['استلام الطلب', 'التنفيذ', 'المراجعة', 'التسليم', 'التحصيل'] }
];

const DEFAULT_SETTINGS = {
    fxAlertMargin: 10,
    openingCashEgp: 0,
    company: { name: 'اكسبيرينس ميديا', phone: '', email: '', address: '' }
};

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

// v1 (no version field) had no dates, and SDG expenses floated with the market rate.
// They are locked at the rate saved with the data at migration time.
function migrateV1(data) {
    const lockRate = parseFloat(data.fxRate) || LEGACY_DEFAULT.fxRate;
    data.payments = (data.payments || []).map(p => ({ date: null, ...p }));
    data.expenses = (data.expenses || []).map(e => ({ date: null, fxRate: lockRate, ...e }));
    data.project = data.project || clone(LEGACY_DEFAULT.project);
    data.workflow = data.workflow || [];
    data.version = 2;
    return data;
}

// v2 was a single project. v3 holds many projects, clients, suppliers, FX history and quotes.
// Every amount now carries the rates locked on its date: { egp: SDG per EGP, usd: SDG per USD }.
function migrateV2(data) {
    const rate = parseFloat(data.fxRate) || LEGACY_DEFAULT.fxRate;
    const project = data.project || clone(LEGACY_DEFAULT.project);
    return {
        version: 3,
        settings: clone(DEFAULT_SETTINGS),
        fxRates: [{ id: 1, date: todayIso(), egp: rate, usd: null }],
        clients: [{ id: 1, name: project.client, phone: '', notes: '' }],
        suppliers: [],
        workflowTemplates: clone(DEFAULT_TEMPLATES),
        projects: [{
            id: 1,
            code: project.code,
            clientId: 1,
            service: project.service,
            serviceType: 'print',
            quantity: data.quantity,
            contractSdg: data.contractSdg,
            status: 'active',
            createdAt: todayIso(),
            payments: (data.payments || []).map(p => ({
                id: p.id, title: p.title, date: p.date, amount: p.sdg, currency: 'SDG', rates: { egp: p.fxRate, usd: null }
            })),
            // Old expenses had no payment tracking; they start as unpaid supplier dues.
            expenses: (data.expenses || []).map(e => ({
                id: e.id, title: e.title, date: e.date, amount: e.amount, currency: e.currency,
                rates: { egp: e.fxRate, usd: null }, supplierId: null, dueDate: null, settlements: []
            })),
            schedule: [],
            workflow: (data.workflow || []).map(s => ({ ...s, owner: '', dueDate: null }))
        }],
        quotes: []
    };
}

function migrate(data) {
    if (!data.version || data.version < 2) data = migrateV1(data);
    if (data.version === 2) data = migrateV2(data);
    return data;
}

// Fill anything missing so older or hand-edited data never breaks rendering.
function normalize(data) {
    data.settings = { ...clone(DEFAULT_SETTINGS), ...data.settings };
    data.settings.company = { ...DEFAULT_SETTINGS.company, ...data.settings.company };
    if (!Array.isArray(data.fxRates) || !data.fxRates.length) data.fxRates = [{ id: newId(), date: todayIso(), egp: LEGACY_DEFAULT.fxRate, usd: null }];
    ['clients', 'suppliers', 'projects', 'quotes'].forEach(key => { if (!Array.isArray(data[key])) data[key] = []; });
    if (!Array.isArray(data.workflowTemplates) || !data.workflowTemplates.length) data.workflowTemplates = clone(DEFAULT_TEMPLATES);
    data.projects.forEach(p => {
        ['payments', 'expenses', 'schedule', 'workflow'].forEach(key => { if (!Array.isArray(p[key])) p[key] = []; });
        p.expenses.forEach(e => { if (!Array.isArray(e.settlements)) e.settlements = []; });
    });
    return data;
}

function persist(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
        console.error('تعذر حفظ البيانات في المتصفح', err);
    }
}

function loadData() {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (err) { stored = null; }
    if (!stored || typeof stored !== 'object') return normalize(migrate(clone(LEGACY_DEFAULT)));
    const storedVersion = stored.version;
    const data = normalize(migrate(stored));
    // Persist right away so rates locked during migration can't drift on a later load.
    if (storedVersion !== data.version) persist(data);
    return data;
}

let appData = loadData();

function saveData() {
    persist(appData);
    render();
}

// ---------- Lookups ----------
function getProject(id) { return appData.projects.find(p => p.id === id); }
function getClient(id) { return appData.clients.find(c => c.id === id); }
function getSupplier(id) { return appData.suppliers.find(s => s.id === id); }
function getTemplate(id) { return appData.workflowTemplates.find(t => t.id === id); }
function clientName(id) { const c = getClient(id); return c ? c.name : 'عميل غير محدد'; }
function supplierName(id) { const s = getSupplier(id); return s ? s.name : '—'; }

// Latest recorded EGP rate, and latest recorded USD rate (it may be on an older day).
function currentRates() {
    const sorted = [...appData.fxRates].sort(byDate);
    const latest = sorted[sorted.length - 1];
    const latestUsd = [...sorted].reverse().find(r => r.usd > 0);
    return { egp: latest.egp, usd: latestUsd ? latestUsd.usd : null, date: latest.date };
}

function setTodayRate(field, value) {
    const today = todayIso();
    let entry = appData.fxRates.find(r => r.date === today);
    if (!entry) {
        const cur = currentRates();
        entry = { id: newId(), date: today, egp: cur.egp, usd: cur.usd };
        appData.fxRates.push(entry);
    }
    entry[field] = value;
}

function upsert(list, id, record) {
    const idx = list.findIndex(x => x.id === id);
    if (idx >= 0) list[idx] = { ...list[idx], ...record };
    else list.push({ id: newId(), ...record });
}

function nextProjectCode() {
    const max = appData.projects.reduce((m, p) => {
        const match = /PRJ-(\d+)/.exec(p.code || '');
        return match ? Math.max(m, Number(match[1])) : m;
    }, 0);
    return `PRJ-${String(max + 1).padStart(3, '0')}`;
}

function nextQuoteNumber() {
    const year = todayIso().slice(0, 4);
    const max = appData.quotes.reduce((m, q) => {
        const match = new RegExp(`Q-${year}-(\\d+)`).exec(q.number || '');
        return match ? Math.max(m, Number(match[1])) : m;
    }, 0);
    return `Q-${year}-${String(max + 1).padStart(3, '0')}`;
}

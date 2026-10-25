/* Cloud sync with Supabase. Local-first: every device works from localStorage and syncs one
   document per user. Each save carries the revision it was based on, so a device holding stale
   data can never silently overwrite newer data saved from another device. */

const CLOUD_CONFIG_KEY = 'exp_media_cloud';
const SYNC_META_KEY = 'exp_media_sync';
const SUPABASE_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';

let cloudClient = null;
let cloudUser = null;
let syncStatus = { state: 'off', message: '' };
let pushTimer = null;
let pushing = false;
let changeSeq = 0;
let lastPullAt = 0;

function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (err) { return fallback; }
}

function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* storage unavailable */ }
}

function cloudConfig() { return readJson(CLOUD_CONFIG_KEY, null); }
function syncMeta() { return readJson(SYNC_META_KEY, { revision: 0, dirty: false, lastSyncedAt: null, userId: null }); }
function setSyncMeta(patch) { writeJson(SYNC_META_KEY, { ...syncMeta(), ...patch }); }

function guessDeviceName() {
    return /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'الجوال' : 'الكمبيوتر';
}

function deviceName() {
    const cfg = cloudConfig();
    return (cfg && cfg.device) || guessDeviceName();
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`تعذر تحميل ${src}`));
        document.head.appendChild(s);
    });
}

// ---------- Status badge ----------
const SYNC_BADGE = {
    'signed-out': ['سجّل الدخول للمزامنة', 'warn'],
    syncing: ['جارٍ المزامنة…', 'brand'],
    synced: ['متزامن ✓', 'pos'],
    pending: ['تعديلات بانتظار الرفع', 'warn'],
    offline: ['دون اتصال · يحفظ محليًا', 'muted'],
    error: ['خطأ في المزامنة', 'neg'],
    conflict: ['تعارض بين الأجهزة · اضغط للحل', 'neg']
};

function setSyncStatus(state, message = '') {
    syncStatus = { state, message };
    renderSyncBadge();
}

function renderSyncBadge() {
    const badge = el('syncBadge');
    if (!badge) return;
    const spec = SYNC_BADGE[syncStatus.state];
    badge.classList.toggle('hidden', !spec);
    if (!spec) return;
    badge.className = `sync-badge pill pill-${spec[1]}`;
    badge.innerText = spec[0];
    const meta = syncMeta();
    badge.title = syncStatus.message || (meta.lastSyncedAt ? `آخر مزامنة: ${new Date(meta.lastSyncedAt).toLocaleString('ar-EG-u-nu-latn')}` : '');
}

function failSync(error) {
    const offline = !navigator.onLine || /fetch|network/i.test(error.message || '');
    setSyncStatus(offline ? 'offline' : 'error', error.message || '');
    if (!offline) console.error('Sync error', error);
}

// ---------- Lifecycle ----------
async function initCloud() {
    const cfg = cloudConfig();
    if (!cfg) { setSyncStatus('off'); return; }
    try {
        if (!window.supabase) await loadScript(SUPABASE_SRC);
        cloudClient = window.supabase.createClient(cfg.url, cfg.key, {
            auth: { persistSession: true, autoRefreshToken: true, storageKey: 'exp_media_auth' }
        });
        const { data } = await cloudClient.auth.getSession();
        cloudUser = data.session ? data.session.user : null;
        if (!cloudUser) { setSyncStatus('signed-out'); return; }
        await pullFromCloud();
    } catch (err) {
        failSync(err);
    }
}

// Called by saveData() after every local change.
function markDirty() {
    changeSeq++;
    setSyncMeta({ dirty: true });
    if (!cloudClient || !cloudUser) return;
    setSyncStatus(navigator.onLine ? 'pending' : 'offline');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => pushToCloud(), 1500);
}

function adoptRemote(row) {
    appData = normalize(migrate(row.data));
    persist(appData);
    resetAuditBaseline();
    setSyncMeta({ revision: row.revision, dirty: false, lastSyncedAt: new Date().toISOString(), userId: cloudUser.id });
    setSyncStatus('synced');
    render();
    showToast('تم تحميل أحدث نسخة من السحابة');
}

async function pullFromCloud() {
    if (!cloudClient || !cloudUser) return;
    if (!navigator.onLine) { setSyncStatus('offline'); return; }
    lastPullAt = Date.now();
    setSyncStatus('syncing');

    const { data: row, error } = await cloudClient
        .from('workspaces').select('data, revision, device, updated_at').eq('user_id', cloudUser.id).maybeSingle();
    if (error) return failSync(error);

    let meta = syncMeta();
    if (meta.userId && meta.userId !== cloudUser.id) {
        // Another account was used on this device before: its revision means nothing here.
        setSyncMeta({ revision: 0, userId: cloudUser.id });
        meta = syncMeta();
    }

    if (!row) return createRemote();
    if (row.revision === meta.revision) {
        if (meta.dirty) return pushToCloud();
        setSyncStatus('synced');
        return;
    }
    // The cloud holds a version this device has not seen.
    if (!meta.dirty && meta.revision > 0) return adoptRemote(row);
    return resolveConflict(row);
}

// Both sides may hold changes the other lacks; the user decides which copy wins.
function resolveConflict(row) {
    const when = new Date(row.updated_at).toLocaleString('ar-EG-u-nu-latn');
    const from = row.device ? ` من جهاز "${row.device}"` : '';
    if (confirm(`توجد نسخة في السحابة${from} محفوظة بتاريخ ${when}، وتختلف عن نسخة هذا الجهاز.\n\nموافق: تحميل نسخة السحابة إلى هذا الجهاز.\nإلغاء: الإبقاء على نسخة هذا الجهاز.`)) {
        adoptRemote(row);
        return;
    }
    if (confirm('هل تريد رفع نسخة هذا الجهاز واستبدال نسخة السحابة بها؟\n\nنسخة السحابة الحالية تبقى محفوظة في النسخ اليومية داخل Supabase.')) {
        pushToCloud(row.revision);
        return;
    }
    setSyncStatus('conflict', 'لم تُحسم بعد: اضغط لاختيار النسخة');
}

async function createRemote() {
    setSyncStatus('syncing');
    const seqAtStart = changeSeq;
    const { error } = await cloudClient.from('workspaces').insert({ user_id: cloudUser.id, data: appData, revision: 1, device: deviceName() });
    // A unique violation means another device created the row first: compare with it instead.
    if (error) return error.code === '23505' ? pullFromCloud() : failSync(error);
    setSyncMeta({ revision: 1, dirty: changeSeq !== seqAtStart, lastSyncedAt: new Date().toISOString(), userId: cloudUser.id });
    setSyncStatus('synced');
    showToast('تم رفع بياناتك إلى السحابة لأول مرة');
}

// baseRevision overrides the last seen revision, used only when the user chose to overwrite the cloud.
async function pushToCloud(baseRevision) {
    if (!cloudClient || !cloudUser) return;
    if (!navigator.onLine) { setSyncStatus('offline'); return; }
    if (pushing) { clearTimeout(pushTimer); pushTimer = setTimeout(() => pushToCloud(), 1000); return; }

    pushing = true;
    setSyncStatus('syncing');
    const base = baseRevision ?? syncMeta().revision;
    const seqAtStart = changeSeq;
    const { data, error } = await cloudClient
        .from('workspaces')
        .update({ data: appData, revision: base + 1, device: deviceName() })
        .eq('user_id', cloudUser.id)
        .eq('revision', base)
        .select('revision');
    pushing = false;

    if (error) return failSync(error);
    if (!data || !data.length) return pullFromCloud();  // someone saved first: go through the conflict path

    const stillDirty = changeSeq !== seqAtStart;
    setSyncMeta({ revision: base + 1, dirty: stillDirty, lastSyncedAt: new Date().toISOString(), userId: cloudUser.id });
    setSyncStatus('synced');
    if (stillDirty) markDirty();
}

// ---------- Account actions (from the settings page) ----------
function isSecretKey(key) {
    if (/^sb_secret_/.test(key)) return true;
    try {
        const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload.role === 'service_role';
    } catch (err) {
        return false;
    }
}

async function connectCloud() {
    const url = el('cloudUrl').value.trim().replace(/\/+$/, '');
    const key = el('cloudKey').value.trim();
    const device = el('cloudDevice').value.trim();
    if (!/^https:\/\/.+/.test(url)) { alert('أدخل رابط المشروع كاملًا ويبدأ بـ https://'); return; }
    if (!key) { alert('أدخل المفتاح العام للمشروع.'); return; }
    if (isSecretKey(key)) { alert('هذا مفتاح سري (service_role / secret) ولا يجوز وضعه في المتصفح. استخدم المفتاح العام anon أو publishable.'); return; }
    writeJson(CLOUD_CONFIG_KEY, { url, key, device: device || guessDeviceName() });
    await initCloud();
    render();
}

async function signInCloud() {
    const email = el('cloudEmail').value.trim();
    const password = el('cloudPassword').value;
    if (!email || !password) { alert('أدخل البريد الإلكتروني وكلمة المرور.'); return; }
    setSyncStatus('syncing');
    const { data, error } = await cloudClient.auth.signInWithPassword({ email, password });
    if (error) {
        setSyncStatus('signed-out');
        alert(/invalid login/i.test(error.message) ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' : `تعذر تسجيل الدخول: ${error.message}`);
        return;
    }
    cloudUser = data.user;
    await pullFromCloud();
    render();
}

async function signOutCloud() {
    if (!confirm('تسجيل الخروج من السحابة؟ تبقى بيانات هذا الجهاز محفوظة عليه.')) return;
    if (cloudClient) await cloudClient.auth.signOut();
    cloudUser = null;
    setSyncStatus('signed-out');
    render();
}

async function disconnectCloud() {
    if (!confirm('فصل هذا الجهاز عن السحابة؟ تبقى البيانات على هذا الجهاز وفي السحابة كما هي، وتتوقف المزامنة.')) return;
    if (cloudClient) await cloudClient.auth.signOut();
    cloudClient = null;
    cloudUser = null;
    try { localStorage.removeItem(CLOUD_CONFIG_KEY); localStorage.removeItem(SYNC_META_KEY); } catch (err) { /* storage unavailable */ }
    setSyncStatus('off');
    render();
}

function cloudSettingsHtml() {
    const cfg = cloudConfig();
    if (!cfg) {
        return `
            <p class="alert-text" style="margin-bottom: 1rem;">اربط النظام بمشروع Supabase لمزامنة بياناتك بين الكمبيوتر والجوال. خطوات الإعداد في ملف <strong>SUPABASE_SETUP.md</strong> داخل المستودع.</p>
            <div class="modal-fields">
                <div class="form-group"><label for="cloudUrl">رابط المشروع (Project URL)</label><input id="cloudUrl" dir="ltr" placeholder="https://xxxx.supabase.co" autocomplete="off"></div>
                <div class="form-group">
                    <label for="cloudKey">المفتاح العام (anon أو publishable)</label>
                    <input id="cloudKey" dir="ltr" autocomplete="off">
                    <p class="form-hint">مفتاح عام مصمم للاستخدام في المتصفح، وبياناتك محمية بقواعد الأمان في قاعدة البيانات. لا تضع هنا المفتاح السري أبدًا.</p>
                </div>
                <div class="form-group"><label for="cloudDevice">اسم هذا الجهاز</label><input id="cloudDevice" value="${escapeHtml(guessDeviceName())}"><p class="form-hint">يظهر في سجل التغييرات وعند التعارض بين الأجهزة.</p></div>
            </div>
            <button type="button" class="btn btn-primary" data-action="cloud-connect">ربط السحابة</button>`;
    }
    const host = escapeHtml(cfg.url.replace(/^https:\/\//, ''));
    if (!cloudUser) {
        return `
            <p class="alert-text" style="margin-bottom: 1rem;">مرتبط بالمشروع <span dir="ltr">${host}</span>. سجّل الدخول بالحساب الذي أنشأته في Supabase.</p>
            <div class="modal-fields">
                <div class="form-group half"><label for="cloudEmail">البريد الإلكتروني</label><input id="cloudEmail" type="email" dir="ltr" autocomplete="username"></div>
                <div class="form-group half"><label for="cloudPassword">كلمة المرور</label><input id="cloudPassword" type="password" dir="ltr" autocomplete="current-password"></div>
            </div>
            <div class="view-actions">
                <button type="button" class="btn btn-primary" data-action="cloud-signin">تسجيل الدخول</button>
                <button type="button" class="btn btn-quiet" data-action="cloud-disconnect">فصل السحابة</button>
            </div>`;
    }
    const meta = syncMeta();
    return `
        <div class="meta-list" style="margin: 0 0 1rem;">
            <div class="meta-row"><span>الحساب:</span><strong dir="ltr">${escapeHtml(cloudUser.email)}</strong></div>
            <div class="meta-row"><span>المشروع:</span><strong dir="ltr">${host}</strong></div>
            <div class="meta-row"><span>هذا الجهاز:</span><strong>${escapeHtml(deviceName())}</strong></div>
            <div class="meta-row"><span>آخر مزامنة:</span><strong>${meta.lastSyncedAt ? new Date(meta.lastSyncedAt).toLocaleString('ar-EG-u-nu-latn') : '—'}</strong></div>
            <div class="meta-row"><span>رقم النسخة:</span><strong>${meta.revision}</strong></div>
        </div>
        <div class="view-actions">
            <button type="button" class="btn btn-primary" data-action="cloud-sync">مزامنة الآن</button>
            <button type="button" class="btn btn-secondary" data-action="cloud-signout">تسجيل الخروج</button>
            <button type="button" class="btn btn-quiet" data-action="cloud-disconnect">فصل السحابة</button>
        </div>`;
}

function onSyncBadgeClick() {
    if (syncStatus.state === 'conflict' || syncStatus.state === 'error' || syncStatus.state === 'pending') pullFromCloud();
    else location.hash = '#/settings';
}

window.addEventListener('online', () => { if (cloudUser) pullFromCloud(); });
window.addEventListener('offline', () => { if (cloudUser) setSyncStatus('offline'); });
// Catch changes made on another device when coming back to this one.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && cloudUser && Date.now() - lastPullAt > 20000) pullFromCloud();
});

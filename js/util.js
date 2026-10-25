/* Shared formatting and small helpers. Loaded first; everything here is global. */

const CURRENCIES = {
    SDG: { label: 'جنيه سوداني (SDG)', short: 'ج.س' },
    EGP: { label: 'جنيه مصري (EGP)', short: 'ج.م' },
    USD: { label: 'دولار أمريكي (USD)', short: '$' }
};

// Isolated LTR run keeps the minus sign on the left, even mid-sentence in RTL text.
function formatNum(num) {
    return `⁦${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(num)}⁩`;
}

function formatMoney(num, currency) {
    return `${formatNum(num)} ${CURRENCIES[currency].short}`;
}

// Isolated LTR run so the percent sign stays after the number in RTL text.
function formatPct(num) {
    return `⁦${(isFinite(num) ? num : 0).toFixed(1)}%⁩`;
}

function formatCompact(num) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(num);
}

function isoDate(d) {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function todayIso() {
    return isoDate(new Date());
}

function addDays(iso, days) {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + days);
    return isoDate(d);
}

function formatDate(iso) {
    if (!iso) return 'بدون تاريخ';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

function formatShortDate(iso) {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function byDate(a, b) {
    return (a.date || '').localeCompare(b.date || '') || a.id - b.id;
}

let idSeq = 0;
function newId() {
    idSeq = (idSeq + 1) % 1000;
    return Date.now() * 1000 + idSeq;
}

function el(id) {
    return document.getElementById(id);
}

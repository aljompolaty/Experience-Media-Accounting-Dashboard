/* Shared UI: the generic form modal, small HTML components and the canvas line chart. */

// ---------- Form modal ----------
let activeForm = null;

// fields: [{ name, label, type: text|number|date|select|textarea|items, value, options, half, hint, placeholder }]
// onSubmit(values) mutates appData and returns an error string, or nothing on success.
function openForm({ title, fields, submitLabel = 'حفظ', onSubmit }) {
    activeForm = { fields, onSubmit };
    el('modalTitle').innerText = title;
    el('modalSubmit').innerText = submitLabel;
    el('modalFields').innerHTML = fields.map(fieldHtml).join('');
    el('modalError').innerText = '';
    el('formModal').classList.remove('hidden');
    if (fields.some(f => f.type === 'items')) recalcItems();
    const first = el('modalFields').querySelector('input, select, textarea');
    if (first) first.focus();
}

function closeModals() {
    el('formModal').classList.add('hidden');
    activeForm = null;
}

function fieldHtml(f) {
    const id = `f_${f.name}`;
    const value = f.value ?? '';
    let input;
    if (f.type === 'select') {
        input = `<select id="${id}">${f.options.map(o => `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
        input = `<textarea id="${id}" rows="${f.rows || 3}" placeholder="${escapeHtml(f.placeholder || '')}">${escapeHtml(value)}</textarea>`;
    } else if (f.type === 'items') {
        return `<div class="form-group">${itemsEditorHtml(f.value || [])}</div>`;
    } else {
        const numberAttrs = f.type === 'number' ? 'step="any" min="0"' : '';
        input = `<input type="${f.type || 'text'}" id="${id}" value="${escapeHtml(value)}" placeholder="${escapeHtml(f.placeholder || '')}" ${numberAttrs}>`;
    }
    return `
        <div class="form-group ${f.half ? 'half' : ''}">
            <label for="${id}">${f.label}</label>
            ${input}
            ${f.hint ? `<p class="form-hint">${f.hint}</p>` : ''}
        </div>`;
}

function readForm() {
    const values = {};
    activeForm.fields.forEach(f => {
        if (f.type === 'items') { values[f.name] = readItems(); return; }
        const raw = el(`f_${f.name}`).value;
        values[f.name] = f.type === 'number' ? (raw === '' ? null : parseFloat(raw)) : raw.trim();
    });
    return values;
}

function submitActiveForm() {
    if (!activeForm) return;
    const error = activeForm.onSubmit(readForm());
    if (typeof error === 'string') {
        el('modalError').innerText = error;
        return;
    }
    closeModals();
    saveData();
}

// ---------- Quote line items editor ----------
function itemRowHtml(item = {}) {
    return `
        <tr class="item-row">
            <td><input class="item-desc" value="${escapeHtml(item.description || '')}" placeholder="وصف البند" aria-label="وصف البند"></td>
            <td><input class="item-qty" type="number" step="any" min="0" value="${item.qty ?? ''}" aria-label="الكمية"></td>
            <td><input class="item-price" type="number" step="any" min="0" value="${item.unitPrice ?? ''}" aria-label="سعر الوحدة"></td>
            <td class="item-sum">—</td>
            <td><button type="button" class="icon-btn danger" data-action="item-remove" aria-label="حذف البند">✕</button></td>
        </tr>`;
}

function itemsEditorHtml(items) {
    const rows = (items.length ? items : [{}]).map(itemRowHtml).join('');
    return `
        <label>بنود العرض</label>
        <div class="table-wrap">
            <table class="items-table">
                <thead><tr><th>البند</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th></th></tr></thead>
                <tbody id="itemsBody">${rows}</tbody>
            </table>
        </div>
        <div class="items-foot">
            <button type="button" class="btn btn-quiet btn-sm" data-action="item-add">+ إضافة بند</button>
            <span>الإجمالي: <strong id="itemsTotal">—</strong></span>
        </div>`;
}

function addItemRow() {
    el('itemsBody').insertAdjacentHTML('beforeend', itemRowHtml());
    recalcItems();
}

function readItems() {
    return [...document.querySelectorAll('#itemsBody .item-row')].map(row => ({
        description: row.querySelector('.item-desc').value.trim(),
        qty: parseFloat(row.querySelector('.item-qty').value) || 0,
        unitPrice: parseFloat(row.querySelector('.item-price').value) || 0
    })).filter(item => item.description || item.qty || item.unitPrice);
}

function recalcItems() {
    let total = 0;
    document.querySelectorAll('#itemsBody .item-row').forEach(row => {
        const sum = (parseFloat(row.querySelector('.item-qty').value) || 0) * (parseFloat(row.querySelector('.item-price').value) || 0);
        total += sum;
        row.querySelector('.item-sum').innerText = formatNum(sum);
    });
    if (el('itemsTotal')) el('itemsTotal').innerText = formatNum(total);
}

// ---------- Small components ----------
function kpiCard(title, value, sub = '', tone = '') {
    return `
        <div class="kpi-card">
            <span class="kpi-title">${title}</span>
            <div class="kpi-val ${tone}">${value}</div>
            <span class="kpi-sub">${sub}</span>
        </div>`;
}

function pill(text, tone = 'muted') {
    return `<span class="pill pill-${tone}">${text}</span>`;
}

function emptyRow(cols, text) {
    return `<tr class="empty-row"><td colspan="${cols}">${text}</td></tr>`;
}

function dataAttrs(attrs) {
    return Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ` data-${k}="${escapeHtml(v)}"`).join('');
}

function rowActions(kind, attrs, extra = '') {
    const a = dataAttrs(attrs);
    return `
        <td class="row-actions">
            ${extra}
            <button type="button" class="icon-btn" data-action="edit-${kind}"${a} title="تعديل" aria-label="تعديل">✎</button>
            <button type="button" class="icon-btn danger" data-action="delete-${kind}"${a} title="حذف" aria-label="حذف">✕</button>
        </td>`;
}

function viewHeader(title, sub = '', actions = '') {
    return `
        <div class="view-header">
            <div>
                <h2 class="page-title">${title}</h2>
                ${sub ? `<p class="page-sub">${sub}</p>` : ''}
            </div>
            <div class="view-actions">${actions}</div>
        </div>`;
}

function progressBar(percent) {
    return `<div class="mini-progress" title="${percent}%"><span style="width: ${percent}%"></span></div>`;
}

function alertsHtml(alerts) {
    if (!alerts.length) {
        return `<div class="alert-box alert-ok alert-sm"><div class="alert-main"><div class="alert-icon">✓</div><div><h3 class="alert-title">لا توجد تنبيهات</h3><p class="alert-text">كل المشاريع والمستحقات ضمن الحدود الآمنة.</p></div></div></div>`;
    }
    return alerts.map(a => {
        const tag = a.href ? 'a' : 'div';
        return `
            <${tag} class="alert-box alert-${a.level} alert-sm" ${a.href ? `href="${a.href}"` : ''}>
                <div class="alert-main">
                    <div class="alert-icon">${a.level === 'ok' ? '✓' : '!'}</div>
                    <div><h3 class="alert-title">${a.title}</h3><p class="alert-text">${a.text}</p></div>
                </div>
                ${a.value ? `<div class="alert-value">${a.value}</div>` : ''}
            </${tag}>`;
    }).join('');
}

// ---------- Canvas line chart ----------
function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// points: [{ x, y, tone? }] with x ascending. opts: { xLabel(x), markerX, step }
function drawLineChart(canvas, points, opts = {}) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.parentElement.clientWidth || 300;
    const cssH = canvas.parentElement.clientHeight || 180;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const colors = { brand: cssVar('--xm-blue'), line: cssVar('--line'), muted: cssVar('--muted'), pos: cssVar('--pos'), neg: cssVar('--neg') };
    ctx.direction = 'ltr';
    ctx.font = `500 11px ${getComputedStyle(document.body).fontFamily}`;

    if (points.length < 2) {
        ctx.fillStyle = colors.muted;
        ctx.textAlign = 'center';
        ctx.direction = 'rtl';
        ctx.fillText('لا توجد بيانات كافية للرسم', cssW / 2, cssH / 2);
        return;
    }

    const padL = 52, padR = 16, padT = 14, padB = 26;
    const w = cssW - padL - padR;
    const h = cssH - padT - padB;
    const minX = points[0].x;
    const maxX = points[points.length - 1].x;
    let minY = Math.min(0, ...points.map(p => p.y));
    let maxY = Math.max(0, ...points.map(p => p.y));
    if (minY === maxY) { minY -= 1; maxY += 1; }
    const xOf = x => padL + ((x - minX) / (maxX - minX || 1)) * w;
    const yOf = y => padT + h - ((y - minY) / (maxY - minY)) * h;

    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'right';
    ctx.fillText(formatCompact(maxY), padL - 6, yOf(maxY) + 4);
    if (minY < 0) ctx.fillText(formatCompact(minY), padL - 6, yOf(minY) + 4);

    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + h);
    ctx.lineTo(padL + w, padT + h);
    ctx.stroke();

    // Zero line
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = colors.muted;
    ctx.beginPath();
    ctx.moveTo(padL, yOf(0));
    ctx.lineTo(padL + w, yOf(0));
    ctx.stroke();
    ctx.fillText('0', padL - 6, yOf(0) + 4);

    if (opts.markerX !== undefined && opts.markerX !== null) {
        ctx.strokeStyle = colors.neg;
        ctx.beginPath();
        ctx.moveTo(xOf(opts.markerX), padT);
        ctx.lineTo(xOf(opts.markerX), padT + h);
        ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.strokeStyle = colors.brand;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(xOf(p.x), yOf(p.y));
        else if (opts.step) { ctx.lineTo(xOf(p.x), yOf(points[idx - 1].y)); ctx.lineTo(xOf(p.x), yOf(p.y)); }
        else ctx.lineTo(xOf(p.x), yOf(p.y));
    });
    ctx.stroke();

    ctx.textAlign = 'center';
    let lastLabelX = -Infinity;
    points.forEach(p => {
        const x = xOf(p.x);
        ctx.fillStyle = p.y < 0 ? colors.neg : (p.tone === 'brand' ? colors.brand : colors.pos);
        ctx.beginPath();
        ctx.arc(x, yOf(p.y), 4, 0, Math.PI * 2);
        ctx.fill();
        if (x - lastLabelX >= 36) {
            ctx.fillStyle = colors.muted;
            ctx.fillText(opts.xLabel ? opts.xLabel(p.x) : formatNum(p.x), x, padT + h + 16);
            lastLabelX = x;
        }
    });
}

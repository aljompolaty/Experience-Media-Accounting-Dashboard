/* Financial calculations. Pure functions over the data model; EGP is the reporting currency. */

function toSdg(amount, currency, rates) {
    if (currency === 'SDG') return amount;
    if (currency === 'EGP') return amount * rates.egp;
    return amount * (rates.usd || 0);
}

function toEgp(amount, currency, rates) {
    return toSdg(amount, currency, rates) / rates.egp;
}

function expensePaid(e) {
    return e.settlements.reduce((sum, x) => sum + x.amount, 0);
}

function expenseOutstanding(e) {
    return Math.max(0, e.amount - expensePaid(e));
}

function expenseStatus(e, today) {
    if (expenseOutstanding(e) <= 0.005) return 'paid';
    if (e.dueDate && e.dueDate < today) return 'overdue';
    return expensePaid(e) > 0 ? 'partial' : 'unpaid';
}

// Rate at which the open SDG balance exactly covers the remaining cost gap.
// null when no rate changes the outcome (gap already covered, or nothing left to collect).
function calcBreakEven(openSdg, cashGap) {
    if (openSdg <= 0 || cashGap <= 0) return null;
    return openSdg / cashGap;
}

function projectSummary(p, cur) {
    const today = todayIso();
    let receivedSdg = 0;
    let receivedEgp = 0;
    p.payments.forEach(pay => {
        receivedSdg += toSdg(pay.amount, pay.currency, pay.rates);
        receivedEgp += toEgp(pay.amount, pay.currency, pay.rates);
    });

    const remainingSdg = p.contractSdg - receivedSdg;
    const openSdg = Math.max(0, remainingSdg);
    const remainingEgp = openSdg / cur.egp;
    const contractEgp = receivedEgp + remainingEgp;

    let costEgp = 0;
    let paidEgp = 0;
    p.expenses.forEach(e => {
        costEgp += toEgp(e.amount, e.currency, e.rates);
        paidEgp += toEgp(Math.min(e.amount, expensePaid(e)), e.currency, e.rates);
    });

    const profit = contractEgp - costEgp;
    const cashGap = costEgp - receivedEgp;
    const scheduledSdg = p.schedule.reduce((sum, s) => sum + s.amount, 0);
    const completed = p.workflow.filter(s => s.status === 'completed').length;

    return {
        receivedSdg, receivedEgp, remainingSdg, openSdg, remainingEgp, contractEgp,
        costEgp, paidEgp, unpaidEgp: costEgp - paidEgp,
        profit,
        margin: contractEgp > 0 ? (profit / contractEgp) * 100 : 0,
        cashGap,
        breakEven: calcBreakEven(openSdg, cashGap),
        avgLockedFx: receivedEgp > 0 ? receivedSdg / receivedEgp : 0,
        costPerPiece: p.quantity > 0 ? costEgp / p.quantity : 0,
        scheduledSdg,
        unscheduledSdg: Math.max(0, openSdg - scheduledSdg),
        progress: p.workflow.length ? Math.round((completed / p.workflow.length) * 100) : 0,
        overdueSteps: p.workflow.filter(s => s.status !== 'completed' && s.dueDate && s.dueDate < today).length
    };
}

function sensitivityRows(s, currentFx) {
    const factors = [0.9, 1.1, 1.25, 1.4, 1.6];
    const rates = [currentFx, ...factors.map(f => Math.round(currentFx * f))];
    if (s.breakEven) rates.push(s.breakEven);
    return [...new Set(rates)].sort((a, b) => a - b).map(rate => {
        const remEgp = s.openSdg / rate;
        const totalContract = s.receivedEgp + remEgp;
        const rawProfit = totalContract - s.costEgp;
        const profit = Math.abs(rawProfit) < 0.01 ? 0 : rawProfit;
        return {
            rate, remEgp, totalContract, profit,
            margin: totalContract > 0 ? (profit / totalContract) * 100 : 0,
            isBreakEven: rate === s.breakEven,
            isCurrent: rate === currentFx
        };
    });
}

// Expected cash position over time: today's cash, then scheduled client installments in and
// unpaid supplier dues out. Overdue and undated items are placed on today, the cautious choice.
function cashflowForecast(data, cur) {
    const today = todayIso();
    let cash = Number(data.settings.openingCashEgp) || 0;
    let unscheduledSdg = 0;
    const events = [];

    data.projects.forEach(p => {
        const s = projectSummary(p, cur);
        cash += s.receivedEgp - s.paidEgp;
        unscheduledSdg += s.unscheduledSdg;

        p.schedule.forEach(item => {
            const overdue = item.date < today;
            events.push({ date: overdue ? today : item.date, originalDate: item.date, overdue, kind: 'in', title: item.title, project: p, amountEgp: item.amount / cur.egp });
        });

        p.expenses.forEach(e => {
            const out = expenseOutstanding(e);
            if (out <= 0.005) return;
            const overdue = !!e.dueDate && e.dueDate < today;
            events.push({
                date: !e.dueDate || overdue ? today : e.dueDate, originalDate: e.dueDate, overdue, undated: !e.dueDate,
                kind: 'out', title: e.title, supplierId: e.supplierId, project: p, amountEgp: toEgp(out, e.currency, e.rates)
            });
        });
    });

    // Same day: money out before money in, so the forecast never looks better than it is.
    events.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'out' ? -1 : 1));

    let balance = cash;
    let minBalance = cash;
    let firstNegative = cash < -0.005 ? today : null;
    events.forEach(ev => {
        balance += ev.kind === 'in' ? ev.amountEgp : -ev.amountEgp;
        ev.balance = balance;
        if (balance < minBalance) minBalance = balance;
        if (balance < -0.005 && !firstNegative) firstNegative = ev.date;
    });

    return { cash, events, minBalance, endBalance: balance, firstNegative, unscheduledEgp: unscheduledSdg / cur.egp };
}

function fxAlerts(data, cur) {
    const margin = Number(data.settings.fxAlertMargin) || 0;
    return data.projects
        .filter(p => p.status === 'active')
        .map(p => {
            const s = projectSummary(p, cur);
            if (!s.breakEven) return null;
            const distance = ((s.breakEven - cur.egp) / cur.egp) * 100;
            if (cur.egp >= s.breakEven) return { level: 'danger', project: p, summary: s, distance };
            if (distance <= margin) return { level: 'warn', project: p, summary: s, distance };
            return null;
        })
        .filter(Boolean);
}

function quoteTotal(q) {
    return q.items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
}

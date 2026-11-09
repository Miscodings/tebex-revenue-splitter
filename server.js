// Revenue Split tool: zero-dependency Node server. Run: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3377;
// Your data lives OUTSIDE the project folder so it can never be committed by accident.
const os = require('os');
const DEFAULT_DATA = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'RevenueSplit')
  : path.join(os.homedir(), '.revenue-split');
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA;
const DB_FILE = path.join(DATA_DIR, 'db.json');
// one-time migration from the old in-project location
const LEGACY_DB = path.join(__dirname, 'data', 'db.json');
if (!process.env.DATA_DIR && !fs.existsSync(DB_FILE) && fs.existsSync(LEGACY_DB)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.copyFileSync(LEGACY_DB, DB_FILE);
  console.log('Migrated data to', DB_FILE);
}
const BAD_STATUS = /refund|charge\s*back|dispute|declin|fail|cancel|void/i;

// ---------- storage ----------
function defaultDb() {
  return {
    settings: {
      discordWebhook: '', currency: 'USD', ownerName: 'Me',
      // wallet "Group" column (store domain) -> source name
      walletGroups: {}, // map each store shown in your wallet export to a source below
      tebexSource: 'Main Store', // source that the Tebex API sync imports into
      notifyPurchases: false, purchaseWebhook: '', // Discord alert for every new sale
      highlightKeyword: 'skin', // sales whose items contain this word get a highlighted alert
      settleDays: 13, // approx days before a purchase leaves "settling"
      ownerSources: [], // sources whose money is 100% yours (no partner splits)
      calcFrom: '', // YYYY-MM-DD: only count sales/payouts from this date in the payout calculator
      walletDir: path.join(os.homedir(), 'Downloads'), // where the wallet export CSV gets downloaded
    },
    // fee/tax % only used when a payment has no real fee/tax value (CSV lacked columns)
    sources: [
      { name: 'Main Store', feePercent: 5, feeFixed: 0, taxPercent: 0 },
      { name: 'Side Income', feePercent: 0, feeFixed: 0, taxPercent: 0 },
    ],
    // example deal, edit or delete in the Partners tab
    partners: [
      {
        id: 'partner-a',
        name: 'Partner A',
        rules: [
          { label: 'Premium skins', match: 'skin', exclude: '', sources: [], percent: 60, base: 'net' },
          { label: 'All store sales', match: '', exclude: '', sources: ['Main Store'], percent: 7, base: 'net' },
        ],
      },
    ],
    payments: [],
    payouts: [],
    wallet: [], // every row of the Tebex wallet export (purchases, withdrawals, other)
  };
}
function load() {
  const def = defaultDb();
  try {
    const file = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return { ...def, ...file, settings: { ...def.settings, ...(file.settings || {}) } };
  } catch { return def; }
}
function save(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, DB_FILE + '.bak');
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- money math (integer cents) ----------
const toCents = (n) => Math.round(Number(n) * 100);
const fromCents = (c) => c / 100;

function netOf(p, source) {
  const gross = toCents(p.gross);
  const s = source || { feePercent: 0, feeFixed: 0, taxPercent: 0 };
  const tax = p.tax != null ? toCents(p.tax) : Math.round(gross * (s.taxPercent || 0) / 100);
  const fee = p.fee != null ? toCents(p.fee) : Math.round((gross - tax) * (s.feePercent || 0) / 100) + toCents(s.feeFixed || 0);
  return { gross, tax, fee, net: gross - tax - fee, taxEst: p.tax == null, feeEst: p.fee == null };
}

const kw = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
function ruleMatches(rule, p) {
  const name = String(p.product || '').toLowerCase();
  if (rule.sources && rule.sources.length && !rule.sources.includes(p.source)) return false;
  const inc = kw(rule.match), exc = kw(rule.exclude);
  if (inc.length && !inc.some((k) => name.includes(k))) return false;
  if (exc.length && exc.some((k) => name.includes(k))) return false;
  return true;
}

// Compute every payment's split. Returns enriched rows.
// Typical price per item = median gross of payments that contained only that item.
function itemPrices(db) {
  const seen = {};
  for (const p of db.payments) {
    if (!p.items || p.items.length !== 1 || BAD_STATUS.test(p.status || '')) continue;
    (seen[p.items[0]] ||= []).push(toCents(p.gross));
  }
  const out = {};
  for (const [k, v] of Object.entries(seen)) { v.sort((a, b) => a - b); out[k] = v[Math.floor(v.length / 2)]; }
  return out;
}
// Split a payment into per-item shares (weights = typical item price) so rules only apply to matching items.
function lineShares(p, prices) {
  const items = p.items && p.items.length ? p.items : null;
  if (!items || items.length === 1) return [{ name: items ? items[0] : p.product, w: 1 }];
  const known = items.every((n) => prices[n] > 0);
  return items.map((n) => ({ name: n, w: known ? prices[n] : 1 }));
}
function compute(db) {
  const srcMap = Object.fromEntries(db.sources.map((s) => [s.name, s]));
  const prices = itemPrices(db);
  return db.payments.map((p) => {
    const m = netOf(p, srcMap[p.source]);
    // refunds/declines and sales in other currencies (kept by the owner, not in the USD wallet) are not counted
    const active = !BAD_STATUS.test(p.status || '') && (!p.currency || p.currency === db.settings.currency);
    const splits = [];
    if (active) {
      const lines = lineShares(p, prices); const wSum = lines.reduce((a, l) => a + l.w, 0);
      for (const partner of db.partners) {
        partner.rules.forEach((rule, i) => {
          const hit = lines.filter((l) => ruleMatches(rule, { source: p.source, product: l.name }));
          if (!hit.length) return;
          const share = hit.reduce((a, l) => a + l.w, 0) / wSum;
          const base = (rule.base === 'gross' ? m.gross : m.net) * share;
          splits.push({ partner: partner.id, rule: i, label: rule.label, cents: Math.round(base * Number(rule.percent) / 100) });
        });
      }
    }
    const owed = splits.reduce((a, s) => a + s.cents, 0);
    return { ...p, ...m, active, splits, owed, mine: m.net - owed, month: String(p.date).slice(0, 7) };
  });
}

function report(db, month) {
  const rows = compute(db).filter((r) => !month || r.month === month);
  const act = rows.filter((r) => r.active);
  const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);
  const partners = {};
  for (const pt of db.partners) partners[pt.id] = { id: pt.id, name: pt.name, owed: 0, byRule: {} };
  for (const r of act) for (const s of r.splits) {
    const pt = partners[s.partner];
    pt.owed += s.cents;
    pt.byRule[s.label] = (pt.byRule[s.label] || 0) + s.cents;
  }
  const bySource = {};
  for (const r of act) {
    const b = (bySource[r.source] ||= { gross: 0, tax: 0, fee: 0, net: 0, count: 0 });
    b.gross += r.gross; b.tax += r.tax; b.fee += r.fee; b.net += r.net; b.count++;
  }
  const totals = {
    gross: sum(act, 'gross'), tax: sum(act, 'tax'), fee: sum(act, 'fee'), net: sum(act, 'net'),
    owed: sum(act, 'owed'), mine: sum(act, 'mine'), count: act.length,
    refunded: rows.length - act.length,
  };
  const warnings = [];
  if (act.some((r) => r.feeEst || r.taxEst)) warnings.push('Some payments use ESTIMATED fee/tax from Sources settings (CSV had no fee/tax columns). Check against your real payout.');
  if ((db.wallet || []).length) {
    const first = db.wallet.reduce((a, w) => (w.date < a ? w.date : a), '9');
    const miss = act.filter((r) => !r.ref && r.date >= first && r.currency === (db.settings.currency || 'USD'));
    const gone = act.filter((r) => !r.ref && (r.date < first || r.currency !== (db.settings.currency || 'USD')));
    if (miss.length) warnings.push(`${miss.length} ${db.settings.currency} sales (gross ${money(miss.reduce((a, r) => a + r.gross, 0), db.settings.currency)}) are NOT in your wallet export. Fees are estimated for them; check Tebex.`);
    if (gone.length) warnings.push(`${gone.length} sales are older than the wallet history or in another currency, so they can't be checked against the wallet.`);
  }
  const foreign = rows.filter((r) => r.currency && r.currency !== db.settings.currency && !BAD_STATUS.test(r.status || '')).length;
  if (foreign) warnings.push(`${foreign} sales in other currencies are not counted (only ${db.settings.currency} is split).`);
  if (act.some((r) => r.mine < 0)) warnings.push('Some payments pay partners more than the net amount (your share is negative). Check rules.');
  return { month: month || 'all', totals, partners: Object.values(partners), bySource, warnings };
}

function monthly(db) {
  const months = [...new Set(db.payments.map((p) => String(p.date).slice(0, 7)))].sort();
  // Everything before "count from" is treated as settled up: neither those sales nor those payouts count toward balances.
  const from = db.settings.calcFrom || '';
  const paid = {};
  for (const po of db.payouts) if (!from || po.date >= from) paid[po.partner] = (paid[po.partner] || 0) + toCents(po.amount);
  const history = months.map((m) => report(db, m));
  const owedAll = {};
  for (const r of compute(db)) {
    if (!r.active || (from && r.date.slice(0, 10) < from)) continue;
    for (const s of r.splits) owedAll[s.partner] = (owedAll[s.partner] || 0) + s.cents;
  }
  const balances = db.partners.map((p) => ({
    id: p.id, name: p.name, owed: owedAll[p.id] || 0, paid: paid[p.id] || 0,
    balance: (owedAll[p.id] || 0) - (paid[p.id] || 0),
  }));
  return { months: history, balances };
}

// ---------- CSV ----------
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t'
    : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = [];
    } else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}
const ALIASES = {
  id: ['transaction id', 'transactionid', 'txn id', 'txn', 'payment id', 'id', 'transaction', 'order id', 'order'],
  date: ['date', 'created at', 'created', 'time', 'timestamp', 'purchased', 'purchase date'],
  product: ['package', 'packages', 'package name', 'product', 'product name', 'item', 'items', 'title', 'name'],
  gross: ['price', 'amount', 'total', 'gross', 'paid', 'gross amount', 'payment amount'],
  tax: ['tax', 'vat', 'sales tax', 'tax amount'],
  fee: ['fee', 'fees', 'transaction fee', 'processing fee', 'commission'],
  status: ['status', 'state'],
  currency: ['currency'],
  user: ['username', 'player', 'user', 'ign', 'customer'],
};
function num(v) {
  if (v == null || String(v).trim() === '') return null;
  let s = String(v).replace(/[^0-9.,\-()]/g, '');
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[()\-]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = /,\d{2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : (neg ? -n : n);
}
function importCsv(db, text, source) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV has no data rows');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = {};
  for (const [k, names] of Object.entries(ALIASES)) {
    for (const n of names) { const i = head.indexOf(n); if (i >= 0) { col[k] = i; break; } }
  }
  if (col.date == null || col.gross == null) throw new Error(`Need Date and Price/Amount columns. Found headers: ${rows[0].join(' | ')}`);
  const seen = new Set(db.payments.map((p) => `${p.source}|${p.id}`));
  let added = 0, dupes = 0; const skipped = [];
  rows.slice(1).forEach((r, idx) => {
    const g = (k) => (col[k] != null ? (r[col[k]] ?? '').trim() : '');
    const d = new Date(g('date')); const gross = num(g('gross'));
    if (isNaN(d) || gross == null) { skipped.push(`row ${idx + 2}: bad date or amount`); return; }
    const id = g('id') || `${d.toISOString()}|${g('user')}|${g('product')}|${gross}`;
    const key = `${source}|${id}`;
    if (seen.has(key)) { dupes++; return; }
    seen.add(key);
    const status = g('status');
    let amt = gross;
    // Refund rows with positive amount: keep sign positive; BAD_STATUS excludes them from totals.
    db.payments.push({
      id, source, date: d.toISOString(), product: g('product') || '(unknown)', user: g('user'),
      gross: amt, tax: col.tax != null ? num(g('tax')) : null, fee: col.fee != null ? num(g('fee')) : null,
      status, currency: g('currency') || db.settings.currency,
    });
    added++;
  });
  return { added, dupes, skipped, mapped: Object.fromEntries(Object.entries(col).map(([k, i]) => [k, rows[0][i]])) };
}

// ---------- Tebex wallet ----------
const WALLET_MATCH_MS = 120000;
const IGNORE_STORE = '(ignore)';
const walletDate = (s) => new Date(String(s).trim().replace(' ', 'T') + ':00Z'); // wallet times line up with UTC
function importWallet(db, text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV has no data rows');
  const head = rows[0].map((h) => h.trim());
  const ix = (n) => head.indexOf(n);
  const C = { ref: ix('Reference'), group: ix('Group'), date: ix('Date'), desc: ix('Description'), amt: ix('Amount Without Currency'), tax: ix('Sales Tax Without Currency'), fee: ix('Fee Without Currency'), total: ix('Total Without Currency'), cur: ix('Currency') };
  if (Object.values(C).some((i) => i < 0)) throw new Error('Not a Tebex wallet export. Headers found: ' + head.join(' | '));
  db.wallet = db.wallet || [];
  const have = new Set(db.wallet.map((w) => w.ref));
  let added = 0, dupes = 0;
  for (const r of rows.slice(1)) {
    const ref = (r[C.ref] || '').trim(); if (!ref) continue;
    if (have.has(ref)) { dupes++; continue; }
    const d = walletDate(r[C.date]); if (isNaN(d)) continue;
    const w = {
      ref, group: (r[C.group] || '').trim(), date: d.toISOString(), desc: (r[C.desc] || '').trim(),
      amount: num(r[C.amt]) ?? 0, tax: num(r[C.tax]) ?? 0, fee: num(r[C.fee]) ?? 0, total: num(r[C.total]) ?? 0, currency: (r[C.cur] || '').trim() || db.settings.currency,
    };
    db.wallet.push(w); have.add(ref); added++;
  }
  const link = linkWallet(db);
  return { added, dupes, matched: link.matched, created: link.created, unmapped: link.unmapped };
}
// Turn wallet purchase rows into payments (idempotent). Safe to call again after the store mapping changes.
function linkWallet(db) {
  const groups = db.settings.walletGroups || {};
  const hasRef = new Set(db.payments.map((p) => p.ref).filter(Boolean));
  let matched = 0, created = 0; const unmapped = {};
  for (const w of db.wallet || []) {
    if (w.desc !== 'Purchase' || w.linked) continue;
    if (hasRef.has(w.ref)) { w.linked = true; continue; }
    const source = groups[w.group];
    if (source === IGNORE_STORE) { w.linked = true; continue; }
    if (!source) { unmapped[w.group] = (unmapped[w.group] || 0) + 1; continue; }
    const d = new Date(w.date);
    // attach real tax/fee to the matching API/CSV payment (same store, same amount, within 2 min), else create one
    let best = null, bestDelta = Infinity;
    for (const p of db.payments) {
      if (p.source !== source || p.ref || toCents(p.gross) !== toCents(w.amount)) continue;
      const delta = Math.abs(new Date(p.date) - d);
      if (delta <= WALLET_MATCH_MS && delta < bestDelta) { best = p; bestDelta = delta; }
    }
    if (best) { best.ref = w.ref; best.tax = w.tax; best.fee = w.fee; matched++; }
    else {
      db.payments.push({ id: w.ref, ref: w.ref, walletOnly: true, source, date: w.date, product: '(wallet purchase, no product info)', user: '', gross: w.amount, tax: w.tax, fee: w.fee, status: 'Complete', currency: w.currency });
      created++;
    }
    w.linked = true; hasRef.add(w.ref);
  }
  return { matched, created, unmapped };
}
function walletReport(db, month) {
  const all = db.wallet || [];
  const groups = db.settings.walletGroups || {};
  const total = all.reduce((a, w) => a + toCents(w.total), 0);
  const cutoff = Date.now() - (Number(db.settings.settleDays) || 0) * 86400000;
  const settling = all.filter((w) => w.desc === 'Purchase' && new Date(w.date).getTime() > cutoff).reduce((a, w) => a + toCents(w.total), 0);
  const rows = all.filter((w) => !month || w.date.slice(0, 7) === month);
  const byProject = {}; let withdrawn = 0, other = 0;
  const allGroups = [...new Set(all.filter((w) => w.desc === 'Purchase').map((w) => w.group))].filter(Boolean);
  for (const w of rows) {
    if (w.desc === 'Purchase') {
      if (groups[w.group] === IGNORE_STORE) continue;
      const k = groups[w.group] || `(unmapped: ${w.group})`;
      const b = (byProject[k] ||= { gross: 0, tax: 0, fee: 0, net: 0, count: 0 });
      b.gross += toCents(w.amount); b.tax += toCents(w.tax); b.fee += toCents(w.fee); b.net += toCents(w.total); b.count++;
    } else if (w.desc === 'Withdrawal') withdrawn += toCents(w.total);
    else other += toCents(w.total);
  }
  const owedPartners = monthly(db).balances.reduce((a, b) => a + b.balance, 0);
  const months = [...new Set(all.map((w) => w.date.slice(0, 7)))].sort().map((m) => {
    const o = { month: m, net: {}, withdrawn: 0 };
    for (const w of all) if (w.date.slice(0, 7) === m) {
      if (w.desc === 'Purchase') { const k = groups[w.group] || 'unmapped'; o.net[k] = (o.net[k] || 0) + toCents(w.total); }
      else if (w.desc === 'Withdrawal') o.withdrawn += toCents(w.total);
    }
    return o;
  });
  return {
    month: month || 'all', total, settling, withdrawable: total - settling, owedPartners, yours: total - owedPartners,
    byProject, withdrawn, other, months, rowCount: all.length, groups, allGroups, settleDays: db.settings.settleDays,
  };
}

// Import the newest "... Wallet Export ....csv" found in a folder.
function importNewestWalletFile(db, dir) {
  if (!dir || !fs.existsSync(dir)) throw new Error('Folder not found: ' + dir);
  const files = fs.readdirSync(dir).filter((f) => /wallet export.*\.csv$/i.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error('No "Wallet Export" CSV in ' + dir + '. On wallet.tebex.io click Export, then Download on the Exports page.');
  const r = importWallet(db, fs.readFileSync(path.join(dir, files[0].f), 'utf8'));
  return { ...r, file: files[0].f, fileTime: new Date(files[0].t).toISOString() };
}

// Payout calculator: only SETTLED money, owner-only sources come off first, rest is split by the rules.
function calcPayout(db, opt = {}) {
  const s = db.settings; const D = 86400000; const now = opt.now || Date.now();
  const cutoff = now - (Number(s.settleDays) || 0) * D;
  const wr = walletReport(db, '');
  const owner = new Set(s.ownerSources || []);
  const from = (opt.from ?? s.calcFrom) || '';
  const lastW = (db.wallet || []).filter((w) => w.desc === 'Withdrawal').sort((a, b) => b.date.localeCompare(a.date))[0];
  const lastWalletRow = (db.wallet || []).reduce((a, w) => (w.date > a ? w.date : a), '');
  const groups = s.walletGroups || {};
  // estimate of settled-but-not-withdrawn owner money: purchases that settled after the last withdrawal
  const since = lastW ? new Date(lastW.date).getTime() - (Number(s.settleDays) || 0) * D : 0;
  let ownerCycle = 0;
  for (const w of db.wallet || []) {
    if (w.desc !== 'Purchase' || !owner.has(groups[w.group])) continue;
    const t = new Date(w.date).getTime();
    if (t > since && t <= cutoff) ownerCycle += toCents(w.total);
  }
  const withdrawableEst = Math.max(0, wr.withdrawable);
  const withdrawable = opt.withdrawable != null ? toCents(opt.withdrawable) : withdrawableEst;
  const ownerPart = Math.min(withdrawable, opt.owner != null ? toCents(opt.owner) : ownerCycle);
  const pool = withdrawable - ownerPart;

  const walletLoaded = (db.wallet || []).length > 0;
  const rows = compute(db).filter((r) => r.active && !owner.has(r.source) && (!from || r.date.slice(0, 10) >= from));
  let unverified = 0;
  const per = {};
  for (const pt of db.partners) per[pt.id] = { id: pt.id, name: pt.name, settled: 0, deferred: 0, paid: 0, byRule: {} };
  for (const r of rows) {
    if (walletLoaded && !r.ref) { if (r.splits.length) unverified++; continue; } // not in wallet: can't be settled money
    const settled = new Date(r.date).getTime() <= cutoff;
    for (const sp of r.splits) {
      const p = per[sp.partner]; if (!p) continue;
      if (settled) { p.settled += sp.cents; p.byRule[sp.label] = (p.byRule[sp.label] || 0) + sp.cents; } else p.deferred += sp.cents;
    }
  }
  for (const po of db.payouts) if (per[po.partner] && (!from || po.date >= from)) per[po.partner].paid += toCents(po.amount);
  const partners = Object.values(per).map((p) => ({ ...p, unpaid: Math.max(0, p.settled - p.paid), overpaid: Math.max(0, p.paid - p.settled) }));
  const need = partners.reduce((a, p) => a + p.unpaid, 0);
  const pay = Math.min(need, pool);
  for (const p of partners) { p.pay = need ? Math.floor(p.unpaid * pay / need) : 0; p.carry = p.unpaid - p.pay; }
  const paidOut = partners.reduce((a, p) => a + p.pay, 0);
  return {
    now: new Date(now).toISOString(), cutoff: new Date(cutoff).toISOString(), settleDays: s.settleDays, from,
    withdrawable, withdrawableEst, ownerPart, ownerCycle, pool, partners, need, paidOut, shortfall: need - paidOut,
    youKeep: withdrawable - paidOut, deferred: partners.reduce((a, p) => a + p.deferred, 0),
    unverified, lastWithdrawal: lastW ? lastW.date : null, lastWalletRow, walletDir: s.walletDir, ownerSources: [...owner],
  };
}

// ---------- Tebex API sync ----------
const TEBEX_BASE = process.env.TEBEX_BASE || 'https://plugin.tebex.io';
async function fetchTebexPayments(secret) {
  const out = [];
  for (let page = 1; page <= 500; page++) {
    const res = await fetch(`${TEBEX_BASE}/payments?paged=1&page=${page}`, { headers: { 'X-Tebex-Secret': secret, Accept: 'application/json' } });
    if (res.status === 403 || res.status === 401) throw new Error('Tebex rejected the secret key (HTTP ' + res.status + ')');
    if (!res.ok) throw new Error(`Tebex API error ${res.status}`);
    const j = await res.json();
    const data = Array.isArray(j) ? j : j.data;
    if (!Array.isArray(data)) throw new Error('Unexpected Tebex response shape');
    out.push(...data);
    if (Array.isArray(j) || !j.next_page_url || j.current_page >= j.last_page) break;
  }
  return out;
}
const fuzzyKey = (source, iso, user, gross) => `${source}|${String(iso).slice(0, 16)}|${String(user || '').toLowerCase()}|${Number(gross).toFixed(2)}`;
let syncing = false;
async function syncTebex() {
  if (syncing) throw new Error('Sync already running');
  syncing = true;
  try {
    const secret = load().settings.tebexSecret;
    if (!secret) throw new Error('Set the Tebex secret key in Settings first');
    const remote = await fetchTebexPayments(secret); // all awaiting done before touching the db
    const db = load();
    const source = db.settings.tebexSource || 'Main Store';
    if (!db.sources.some((s) => s.name === source)) throw new Error(`Source "${source}" not found; add it under Sources`);
    const byId = new Map(), byFuzzy = new Map();
    for (const p of db.payments) if (p.source === source) { byId.set(String(p.id), p); byFuzzy.set(fuzzyKey(p.source, p.date, p.user, p.gross), p); }
    let added = 0, updated = 0, skipped = 0;
    for (const r of remote) {
      const d = new Date(r.date); const gross = Number(r.amount);
      if (isNaN(d) || isNaN(gross)) { skipped++; continue; }
      const user = r.player && r.player.name || '';
      const status = r.status || '';
      const existing = byId.get(String(r.id)) || byFuzzy.get(fuzzyKey(source, d.toISOString(), user, gross));
      if (existing) {
        if (status && existing.status !== status) { existing.status = status; updated++; }
        if (!existing.items && r.packages) existing.items = r.packages.map((x) => x.name); // backfill item list
        continue;
      }
      // adopt a payment the wallet import created before this sale was synced (keeps its real fee/tax)
      const orphan = db.payments.find((p) => p.walletOnly && p.source === source && toCents(p.gross) === toCents(gross) && Math.abs(new Date(p.date) - d) <= WALLET_MATCH_MS);
      if (orphan) {
        orphan.id = String(r.id); orphan.walletOnly = false; orphan.user = user; orphan.status = status || orphan.status;
        orphan.items = (r.packages || []).map((x) => x.name);
        orphan.product = (r.packages || []).map((x) => x.name).join(', ') || orphan.product;
        byId.set(orphan.id, orphan); updated++; continue;
      }
      const p = {
        id: String(r.id), source, date: d.toISOString(), product: (r.packages || []).map((x) => x.name).join(', ') || '(unknown)',
        user, gross, tax: null, fee: null, status, currency: (r.currency && r.currency.iso_4217) || db.settings.currency,
        items: (r.packages || []).map((x) => x.name),
      };
      db.payments.push(p); byId.set(p.id, p); byFuzzy.set(fuzzyKey(source, p.date, user, gross), p); added++;
    }
    db.settings.lastSync = new Date().toISOString(); db.settings.lastSyncResult = `added ${added}, updated ${updated}, skipped ${skipped}`;
    save(db);
    try { const n = await notifyPurchases(db); if (n.sent) { db.settings.lastSyncResult += `, announced ${n.sent} in Discord`; save(db); } }
    catch (e) { db.settings.lastSyncResult += `, Discord alert failed: ${e.message}`; save(db); }
    return { added, updated, skipped, total: remote.length };
  } finally { syncing = false; }
}
let syncTimer = null;
function scheduleSync() {
  clearInterval(syncTimer);
  const mins = Number(load().settings.autoSyncMinutes) || 0;
  if (mins > 0) syncTimer = setInterval(() => syncTebex().catch((e) => {
    const db = load(); db.settings.lastSyncResult = 'ERROR: ' + e.message; save(db); console.error('sync failed:', e.message);
  }), Math.max(mins, 1) * 60000);
}

// ---------- Discord ----------
const money = (c, cur) => `${fromCents(c).toFixed(2)} ${cur}`;
const DISCORD_RE = /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//;

// Embed for one new purchase: items, amounts, whether it matched the highlight keyword, and what each partner is owed after it.
function purchaseEmbed(db, p, cum, test) {
  const cur = db.settings.currency || 'USD';
  const kwd = (db.settings.highlightKeyword || '').trim().toLowerCase();
  const items = p.items && p.items.length ? p.items : [p.product];
  const hit = kwd ? items.filter((n) => n.toLowerCase().includes(kwd)) : [];
  const fields = [
    { name: 'Items', value: items.join('\n').slice(0, 1000) || '-' },
    { name: 'Amount', value: money(p.grossC, cur), inline: true },
    { name: 'Est. net', value: money(p.netC, cur), inline: true },
  ];
  if (p.user) fields.push({ name: 'Buyer', value: p.user, inline: true });
  if (hit.length) fields.push({ name: `${kwd[0].toUpperCase()}${kwd.slice(1)} purchase`, value: hit.join('\n').slice(0, 1000) });
  for (const pt of db.partners) {
    const earned = p.splits.filter((s) => s.partner === pt.id);
    const c = cum[pt.id];
    if (!earned.length && !(c && c.unpaid > 0)) continue;
    const earn = earned.reduce((a, s) => a + s.cents, 0);
    const owedNow = c ? c.owed - c.paid : 0;
    fields.push({
      name: pt.name,
      value: `${earn ? `+${money(earn, cur)} from this sale (${[...new Set(earned.map((s) => s.label))].join(', ')})\n` : ''}**Owed now: ${owedNow > 0 ? money(owedNow, cur) : `${money(0, cur)} (paid up${owedNow < 0 ? `, ${money(-owedNow, cur)} ahead` : ''})`}**`,
    });
  }
  return {
    title: `${test ? '[TEST] ' : ''}${hit.length ? `${kwd[0].toUpperCase()}${kwd.slice(1)} purchase` : 'New purchase'}`,
    color: hit.length ? 0xf0b429 : 0x5b8def, fields, timestamp: p.date, footer: { text: `${p.source} | ${String(p.ref || p.id).slice(0, 40)}` },
  };
}
// Running "owed to each partner" after every sale, in time order.
function runningOwed(db) {
  const from = db.settings.calcFrom || '';
  const rows = compute(db).filter((r) => r.active && (!from || r.date.slice(0, 10) >= from)).sort((a, b) => a.date.localeCompare(b.date));
  const paid = {};
  for (const po of db.payouts) if (!from || po.date >= from) paid[po.partner] = (paid[po.partner] || 0) + toCents(po.amount);
  const owed = {}; const out = new Map();
  for (const r of rows) {
    for (const s of r.splits) owed[s.partner] = (owed[s.partner] || 0) + s.cents;
    const snap = {};
    for (const pt of db.partners) { const o = owed[pt.id] || 0, pd = paid[pt.id] || 0; snap[pt.id] = { owed: o, paid: pd, unpaid: o - pd }; }
    out.set(r.source + '|' + r.id, snap);
  }
  return out;
}
async function postEmbeds(url, embeds) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds }) });
    if (res.status === 429 && attempt === 0) { const j = await res.json().catch(() => ({})); await new Promise((r) => setTimeout(r, Math.min(5000, (j.retry_after || 2) * 1000))); continue; }
    if (!res.ok) throw new Error(`Discord returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }
}
// Called after each Tebex sync. Posts every not-yet-announced sale that is newer than when alerts were switched on.
async function notifyPurchases(db) {
  const url = db.settings.purchaseWebhook;
  if (!db.settings.notifyPurchases || !DISCORD_RE.test(url || '')) return { sent: 0 };
  const src = db.settings.tebexSource || 'Main Store'; const after = db.settings.notifyAfter || '';
  const byId = new Map(compute(db).map((r) => [r.source + '|' + r.id, r]));
  const cum = runningOwed(db);
  const queue = db.payments.filter((p) => !p.notified && p.source === src && p.date > after && !p.walletOnly)
    .sort((a, b) => a.date.localeCompare(b.date)).map((p) => ({ p, r: byId.get(p.source + '|' + p.id) })).filter((x) => x.r && x.r.active);
  let sent = 0;
  for (let i = 0; i < queue.length; i += 10) {
    const chunk = queue.slice(i, i + 10);
    await postEmbeds(url, chunk.map(({ p, r }) => purchaseEmbed(db, { ...p, grossC: r.gross, netC: r.net, splits: r.splits }, cum.get(p.source + '|' + p.id) || {})));
    chunk.forEach(({ p }) => { p.notified = true; }); sent += chunk.length;
  }
  return { sent };
}
async function postDiscord(db, month) {
  const url = db.settings.discordWebhook;
  if (!DISCORD_RE.test(url || '')) throw new Error('Set a valid Discord webhook URL in Settings first');
  const r = report(db, month); const cur = db.settings.currency; const t = r.totals;
  const fields = [
    { name: 'Gross sales', value: money(t.gross, cur), inline: true },
    { name: 'Tax', value: money(t.tax, cur), inline: true },
    { name: 'Fees', value: money(t.fee, cur), inline: true },
    { name: 'Net', value: money(t.net, cur), inline: true },
    { name: 'Owed to partners', value: money(t.owed, cur), inline: true },
    { name: `${db.settings.ownerName || 'Owner'} keeps`, value: money(t.mine, cur), inline: true },
  ];
  for (const p of r.partners) {
    if (!p.owed) continue;
    const lines = Object.entries(p.byRule).map(([k, v]) => `${k}: ${money(v, cur)}`).join('\n');
    fields.push({ name: `Owed to ${p.name}: ${money(p.owed, cur)}`, value: lines || '-' });
  }
  const body = { embeds: [{ title: `Store revenue ${month || 'all time'}`, color: 0x7c5cff, fields, footer: { text: `${t.count} sales, ${t.refunded} refunded/excluded` } }] };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Discord returned ${res.status}: ${await res.text()}`);
}

// ---------- HTTP ----------
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok, no) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 50e6) req.destroy(); }); req.on('end', () => ok(b)); req.on('error', no); });

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    // block cross-site requests from other websites hitting localhost
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return send(res, 403, { error: 'forbidden host' });
    if (req.method !== 'GET' && req.headers.origin && new URL(req.headers.origin).host !== host) return send(res, 403, { error: 'forbidden origin' });

    if (!u.pathname.startsWith('/api/')) {
      const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
      const pub = path.join(__dirname, 'public');
      const full = path.join(pub, decodeURIComponent(f));
      if (!full.startsWith(pub + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404); return res.end('not found'); }
      const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(full));
    }
    const db = load();
    const route = `${req.method} ${u.pathname}`;
    const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {};

    switch (route) {
      case 'POST /api/notify-test': {
        if (!DISCORD_RE.test(db.settings.purchaseWebhook || '')) throw new Error('Save a valid Discord webhook URL for purchase alerts first');
        const sample = db.payments.filter((p) => p.source === (db.settings.tebexSource || 'Main Store') && p.items).sort((a, b) => b.date.localeCompare(a.date))[0];
        if (!sample) throw new Error('No synced sales yet to build a sample from');
        const r = compute(db).find((x) => x.source === sample.source && x.id === sample.id);
        await postEmbeds(db.settings.purchaseWebhook, [purchaseEmbed(db, { ...sample, grossC: r.gross, netC: r.net, splits: r.splits }, runningOwed(db).get(sample.source + '|' + sample.id) || {}, true)]);
        return send(res, 200, { ok: true });
      }
      case 'GET /api/state': return send(res, 200, { settings: { ...db.settings, tebexSecret: undefined, tebexSecretSet: !!db.settings.tebexSecret, purchaseWebhook: undefined, purchaseWebhookSet: !!db.settings.purchaseWebhook }, sources: db.sources, partners: db.partners, payouts: db.payouts, monthly: monthly(db) });
      case 'GET /api/report': return send(res, 200, report(db, u.searchParams.get('month') || ''));
      case 'GET /api/payments': {
        const m = u.searchParams.get('month');
        return send(res, 200, compute(db).filter((r) => !m || r.month === m).sort((a, b) => b.date.localeCompare(a.date)));
      }
      case 'POST /api/import': {
        if (!db.sources.some((s) => s.name === body.source)) throw new Error('Unknown source');
        const r = importCsv(db, body.csv || '', body.source); save(db); return send(res, 200, r);
      }
      case 'POST /api/payment': {
        const gross = Number(body.gross); const d = new Date(body.date);
        if (isNaN(gross) || isNaN(d) || !body.product) throw new Error('product, date, gross required');
        db.payments.push({
          id: 'manual-' + Date.now(), source: body.source, date: d.toISOString(), product: body.product, user: body.user || '',
          gross, tax: body.tax === '' || body.tax == null ? null : Number(body.tax), fee: body.fee === '' || body.fee == null ? null : Number(body.fee),
          status: body.status || 'Complete', currency: db.settings.currency,
        });
        save(db); return send(res, 200, { ok: true });
      }
      case 'POST /api/payment/delete': db.payments = db.payments.filter((p) => !(p.id === body.id && p.source === body.source)); save(db); return send(res, 200, { ok: true });
      case 'POST /api/payments/clear': if (body.confirm !== 'DELETE') throw new Error('confirm'); db.payments = []; save(db); return send(res, 200, { ok: true });
      case 'POST /api/config': {
        if (body.settings) {
          const s = { ...body.settings }; delete s.tebexSecretSet; delete s.purchaseWebhookSet; delete s.lastSync; delete s.lastSyncResult;
          if (!s.tebexSecret) delete s.tebexSecret; // blank = keep existing
          if (!s.purchaseWebhook) delete s.purchaseWebhook;
          if (s.purchaseWebhook && !DISCORD_RE.test(s.purchaseWebhook)) throw new Error('That is not a Discord webhook URL (it should start with https://discord.com/api/webhooks/)');
          // switching alerts on: only announce sales from now on, never the backlog
          if (s.notifyPurchases && !db.settings.notifyPurchases) s.notifyAfter = new Date().toISOString();
          db.settings = { ...db.settings, ...s };
        }
        if (body.sources) db.sources = body.sources;
        if (body.partners) db.partners = body.partners;
        const link = linkWallet(db); // mapping may have changed
        save(db); scheduleSync(); return send(res, 200, { ok: true, linked: link });
      }
      case 'GET /api/calc': {
        const q = u.searchParams; const n = (k) => (q.get(k) === null || q.get(k) === '' ? null : Number(q.get(k)));
        return send(res, 200, calcPayout(db, { withdrawable: n('withdrawable'), owner: n('owner'), from: q.get('from') ?? undefined }));
      }
      case 'POST /api/import-wallet-folder': {
        if (body.dir) db.settings.walletDir = body.dir;
        const r = importNewestWalletFile(db, db.settings.walletDir); save(db); return send(res, 200, r);
      }
      case 'GET /api/wallet': return send(res, 200, walletReport(db, u.searchParams.get('month') || ''));
      case 'POST /api/import-wallet': { const r = importWallet(db, body.csv || ''); save(db); return send(res, 200, r); }
      case 'POST /api/sync-tebex': return send(res, 200, await syncTebex());
      case 'POST /api/tebex-secret/clear': delete db.settings.tebexSecret; save(db); return send(res, 200, { ok: true });
      case 'POST /api/payout': {
        if (!db.partners.some((p) => p.id === body.partner) || !(Number(body.amount) > 0)) throw new Error('partner and positive amount required');
        db.payouts.push({ id: 'po-' + Date.now(), partner: body.partner, amount: Number(body.amount), date: body.date || new Date().toISOString().slice(0, 10), note: body.note || '' });
        save(db); return send(res, 200, { ok: true });
      }
      case 'POST /api/payout/delete': db.payouts = db.payouts.filter((p) => p.id !== body.id); save(db); return send(res, 200, { ok: true });
      case 'POST /api/discord': await postDiscord(db, body.month || ''); return send(res, 200, { ok: true });
      default: return send(res, 404, { error: 'no route' });
    }
  } catch (e) { send(res, 400, { error: e.message }); }
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Revenue Split running: http://localhost:${PORT}`);
    scheduleSync();
    if (load().settings.autoSyncMinutes > 0) syncTebex().catch((e) => console.error('sync failed:', e.message));
  });
}
module.exports = { server, syncTebex, notifyPurchases, linkWallet, importWallet, walletReport, calcPayout, compute, report, importCsv, netOf, defaultDb, parseCsv };

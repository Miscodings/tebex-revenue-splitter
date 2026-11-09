// Demo mode: runs the app on port 3378 with generated FAKE data in a temp folder.
// Nothing here touches your real data. Start with: npm run demo
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = path.join(os.tmpdir(), 'revenue-split-demo');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
process.env.DATA_DIR = dir;

const app = require('./server');

function rng(seed) { // deterministic, so screenshots are repeatable
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = rng(20260101);
const pick = (a) => a[Math.floor(rand() * a.length)];
const c = (n) => Math.round(n * 100) / 100;

const db = app.defaultDb();
db.settings.walletGroups = { 'shop.example-server.net': 'Main Store', 'marketplace-demo.tebex.io': 'Side Income' };
db.settings.ownerSources = ['Side Income'];
db.settings.ownerName = 'You';
db.settings.settleDays = 13;
db.settings.walletDir = 'C:\\Users\\you\\Downloads'; // placeholder path, so screenshots never show a real username
db.settings.calcFrom = new Date(Date.now() - 62 * 864e5).toISOString().slice(0, 10);

const CATALOG = [
  ['Starter Crate', 4.99, 5], ['Coin Pack 1,000', 9.99, 8], ['Coin Pack 5,000', 24.99, 5], ['Adventurer Rank (Permanent)', 14.99, 4],
  ['Champion Rank (Permanent)', 29.99, 3], ['Ember Wyrm Skin', 39.99, 2], ['Frostbound Skin', 34.99, 2], ['Pet Bundle', 12.49, 3],
];
const wallet = [];
let n = 0;
const now = Date.now();
for (let day = 150; day >= 0; day--) {
  const growth = 0.6 + (150 - day) / 150; // busier over time
  const sales = Math.floor(rand() * 4 * growth);
  for (let i = 0; i < sales; i++) {
    const t = now - day * 864e5 - Math.floor(rand() * 864e5);
    const basket = rand() < 0.2 ? [pick(CATALOG), pick(CATALOG)] : [pick(CATALOG)];
    const gross = c(basket.reduce((a, b) => a + b[1], 0));
    const tax = rand() < 0.25 ? c(gross * 0.08) : 0;
    const platform = c(gross * 0.05), gateway = c(gross * 0.029 + 0.3);
    const fee = c(platform + gateway);
    const iso = new Date(t).toISOString().slice(0, 19) + '.000Z';
    n++;
    db.payments.push({ id: String(100000 + n), source: 'Main Store', date: iso, product: basket.map((b) => b[0]).join(', '), items: basket.map((b) => b[0]), user: 'player' + n, gross, tax: null, fee: null, status: 'Complete', currency: 'USD' });
    wallet.push({ ref: 'tbx-demo-' + n, group: 'shop.example-server.net', date: iso.slice(0, 16) + ':00.000Z', desc: 'Purchase', amount: gross, tax, fee, total: c(gross - tax - fee), currency: 'USD' });
  }
  if (rand() < 0.35) { // side income
    const gross = c(2 + rand() * 20); const fee = c(gross * 0.06);
    n++;
    wallet.push({ ref: 'tbx-demo-' + n, group: 'marketplace-demo.tebex.io', date: new Date(now - day * 864e5 - rand() * 864e5).toISOString().slice(0, 16) + ':00.000Z', desc: 'Purchase', amount: gross, tax: 0, fee, total: c(gross - fee), currency: 'USD' });
  }
}
// a few refunds
db.payments.filter((p, i) => i % 37 === 0).forEach((p) => { p.status = 'Refund'; });
// withdrawals on the 1st of the last months
for (let m = 3; m >= 1; m--) {
  const d = new Date(); d.setUTCMonth(d.getUTCMonth() - (m - 1), 1); d.setUTCHours(3, 14, 0, 0);
  wallet.push({ ref: 'pmt-demo-' + m, group: '', date: d.toISOString(), desc: 'Withdrawal', amount: c(-(350 + m * 170)), tax: 0, fee: 0, total: c(-(350 + m * 170)), currency: 'USD' });
  if (m > 1) db.payouts.push({ id: 'po-demo-' + m, partner: 'partner-a', amount: 90 + m * 25, date: d.toISOString().slice(0, 10), note: 'demo payout' });
}
wallet.sort((a, b) => a.date.localeCompare(b.date));
db.wallet = wallet;
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db, null, 2));
// link wallet rows to the fake payments (attaches fees, same code path as real data)
const loaded = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
app.linkWallet(loaded);
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(loaded, null, 2));

const PORT = process.env.PORT || 3378;
app.server.listen(PORT, '127.0.0.1', () => console.log(`DEMO MODE (fake data): http://localhost:${PORT}`));

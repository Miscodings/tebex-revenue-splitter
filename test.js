const assert = require('assert');
const { report, importCsv, defaultDb } = require('./server');
const db = defaultDb();
const csv = `Transaction ID,Date,Username,Package,Price,Currency,Status
T1,2026-10-02 10:00:00,a,Fire Dragon Skin,10.00,USD,Complete
T2,2026-10-03 10:00:00,b,Starter Rank,20.00,USD,Complete
T3,2026-10-04 10:00:00,c,Ice Dragon Skin,10.00,USD,Refunded
T1,2026-10-02 10:00:00,a,Fire Dragon Skin,10.00,USD,Complete
`;
const r = importCsv(db, csv, 'Main Store');
assert.equal(r.added, 3); assert.equal(r.dupes, 1);
const rep = report(db, '2026-10');
// Tebex 5% fee: T1 net 9.50, T2 net 19.00 ; T3 refunded excluded
assert.equal(rep.totals.net, 2850);
// T1: 60%*9.50=5.70 + 7%*9.50=0.665->0.67 (round half up on cents: 66.5 -> 67) ; T2: 7%*19=1.33
const an = rep.partners[0];
assert.equal(an.owed, 570 + 67 + 133);
assert.equal(rep.totals.mine, 2850 - an.owed);
console.log('ok', an.owed / 100);

// wallet import: unmapped store is reported, then linking works after mapping (no duplicate payments)
const { importWallet, linkWallet } = require('./server');
const w = defaultDb();
const wcsv = `Reference,Group,Date,Description,Amount,Sales Tax,Total Fee,Total,Currency,Platform Fee,Gateway Fee,Amount Without Currency,Sales Tax Without Currency,Fee Without Currency,Total Without Currency
tbx-a,shop.test,"2026-10-02 10:00",Purchase,$10.00,---,$0.80,$9.20,USD,$0.50,$0.30,10.00,---,0.80,9.20
pmt-1,---,"2026-10-05 10:00",Withdrawal,-$5.00,---,$0.00,-$5.00,USD,$0.00,$0.00,-5.00,---,0.00,-5.00
`;
let r1 = importWallet(w, wcsv);
assert.deepEqual(r1.unmapped, { 'shop.test': 1 }); assert.equal(w.payments.length, 0);
w.settings.walletGroups['shop.test'] = 'Main Store';
let l = linkWallet(w); assert.equal(l.created, 1);
l = linkWallet(w); assert.equal(l.created + l.matched, 0); assert.equal(w.payments.length, 1);
assert.equal(importWallet(w, wcsv).dupes, 2);
assert.equal(w.payments[0].fee, 0.8);
// basket split: dragon skin share only, not the rank
const b = defaultDb();
['Fire Dragon Skin', 'Starter Rank'].forEach((n, i) => b.payments.push({ id: 's' + i, source: 'Main Store', date: '2026-10-0' + (i + 1) + 'T10:00:00Z', product: n, items: [n], gross: n.includes('Skin') ? 30 : 10, tax: 0, fee: 0, status: 'Complete', currency: 'USD' }));
b.payments.push({ id: 'bk', source: 'Main Store', date: '2026-10-04T10:00:00Z', product: 'Fire Dragon Skin, Starter Rank', items: ['Fire Dragon Skin', 'Starter Rank'], gross: 40, tax: 0, fee: 0, status: 'Complete', currency: 'USD' });
const rb = require('./server').compute(b).find((x) => x.id === 'bk');
assert.equal(rb.splits.find((s) => s.label === 'Premium skins').cents, 1800); // 60% of the 30.00 skin share, not of 40.00
console.log('wallet + basket ok');

// test purchases: excluded from totals/splits by buyer name or by flag; "count from" accepts an exact timestamp
const t = defaultDb();
t.settings.testAccounts = 'TesterBob, someone';
const mk = (id, user, d, gross, extra = {}) => t.payments.push({ id, source: 'Main Store', date: d, product: 'Fire Skin', items: ['Fire Skin'], user, gross, tax: 0, fee: 0, status: 'Complete', currency: 'USD', ...extra });
mk('r1', 'RealBuyer', '2026-10-05T10:00:00Z', 10);
mk('t1', 'testerbob', '2026-10-05T11:00:00Z', 100);            // test by name (case-insensitive)
mk('t2', 'Other', '2026-10-05T12:00:00Z', 100, { test: true }); // test by flag
const rt = require('./server').report(t, '2026-10');
assert.equal(rt.totals.count, 1); assert.equal(rt.totals.gross, 1000);
assert.equal(require('./server').compute(t).filter((x) => x.test).length, 2);
const cp = require('./server').calcPayout(t, { from: '2026-10-05T10:30:00.000Z', now: new Date('2026-12-01T00:00:00Z').getTime() });
assert.equal(cp.partners[0].settled, 0); // r1 is before the exact cut-off, so it is treated as already settled up
const cp2 = require('./server').calcPayout(t, { from: '2026-10-05', now: new Date('2026-12-01T00:00:00Z').getTime() });
assert.ok(cp2.partners[0].settled > 0);
console.log('test accounts + timestamp cut-off ok');

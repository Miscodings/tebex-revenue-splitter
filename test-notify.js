// Discord purchase alerts, with fetch stubbed so nothing is really posted.
const assert = require('assert');
const os = require('os');
process.env.DATA_DIR = require('path').join(os.tmpdir(), 'rs-notify-test');
const { defaultDb } = require('./server');
const app = require('./server');

const sent = [];
globalThis.fetch = async (url, opt) => { sent.push({ url, body: JSON.parse(opt.body) }); return { ok: true, status: 200, text: async () => '' }; };

const db = defaultDb();
db.settings.purchaseWebhook = 'https://discord.com/api/webhooks/1/abc';
db.settings.notifyPurchases = true;
db.settings.notifyAfter = '2026-10-01T00:00:00.000Z';
db.settings.highlightKeyword = 'skin';
const add = (id, d, items, gross) => db.payments.push({ id, source: 'Main Store', date: d, product: items.join(', '), items, gross, tax: 0, fee: 0, status: 'Complete', currency: 'USD', user: 'buyer' + id });
add('old', '2026-09-30T10:00:00Z', ['Starter Rank'], 10);          // before alerts were enabled: must NOT be announced
add('1', '2026-10-02T10:00:00Z', ['Fire Skin'], 30);              // highlighted
add('2', '2026-10-03T10:00:00Z', ['Starter Rank'], 10);           // plain
db.payouts.push({ id: 'p', partner: 'partner-a', amount: 5, date: '2026-10-02' });

(async () => {
  const fn = (d) => app.notifyPurchases(d);
  const r = await fn(db);
  assert.equal(r.sent, 2);
  const embeds = sent.flatMap((s) => s.body.embeds);
  assert.equal(embeds.length, 2);
  assert.ok(/skin purchase/i.test(embeds[0].title), 'first is highlighted');
  assert.equal(embeds[1].title, 'New purchase');
  const pa = embeds[0].fields.find((f) => f.name === 'Partner A').value;
  assert.ok(pa.includes('Owed now:'), pa);
  // 60% of 28.50-ish net skin share + 7% of all, minus 5 paid
  console.log(embeds[0].fields.map((f) => f.name + ': ' + f.value.replace(/\n/g, ' / ')).join('\n'));
  assert.ok(db.payments.find((p) => p.id === '1').notified && !db.payments.find((p) => p.id === 'old').notified);
  assert.equal((await fn(db)).sent, 0); // no repeats
  console.log('notify ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

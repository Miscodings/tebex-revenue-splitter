// Mock Tebex API sync test. Uses temp data dir; never touches real data.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'));
let status2 = 'Complete';
const pay = (id, amt, name, date, st) => ({ id, amount: amt, date, currency: { iso_4217: 'USD', symbol: '$' }, status: st, player: { id: 1, name: 'p' + id, uuid: 'x' }, packages: [{ id: 1, name }] });
const mock = http.createServer((req, res) => {
  assert.equal(req.headers['x-tebex-secret'], 'KEY');
  const page = Number(new URL(req.url, 'http://x').searchParams.get('page'));
  const pages = [
    [pay(1, '10.00', 'Fire Dragon Skin', '2026-10-02T10:00:00+0000', 'Complete')],
    [pay(2, '20.00', 'Starter Rank', '2026-10-03T10:00:00+00:00', status2)],
  ];
  res.end(JSON.stringify({ total: 2, current_page: page, last_page: 2, next_page_url: page < 2 ? 'x' : null, data: pages[page - 1] }));
});
mock.listen(0, async () => {
  process.env.TEBEX_BASE = 'http://127.0.0.1:' + mock.address().port; process.env.DATA_DIR = dir;
  const { syncTebex, report } = require('./server');
  const fsx = require('fs'); const f = path.join(dir, 'db.json');
  const { defaultDb } = require('./server'); const d = defaultDb(); d.settings.tebexSecret = 'KEY'; fsx.writeFileSync(f, JSON.stringify(d));
  let r = await syncTebex(); assert.deepEqual([r.added, r.updated], [2, 0]);
  r = await syncTebex(); assert.deepEqual([r.added, r.updated], [0, 0]);
  status2 = 'Refund'; r = await syncTebex(); assert.deepEqual([r.added, r.updated], [0, 1]);
  const db = JSON.parse(fsx.readFileSync(f, 'utf8'));
  const rep = report(db, '2026-10'); assert.equal(rep.totals.count, 1); assert.equal(rep.totals.net, 950);
  console.log('sync ok'); mock.close(); process.exit(0);
});

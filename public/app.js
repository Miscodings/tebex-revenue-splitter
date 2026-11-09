const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let S=null,tab=(location.hash||'').slice(1),month=localStorage.getItem('month')||'';
const TABS={dash:'Overview',wallet:'Wallet',calc:'Payout calculator',pay:'Payments',partners:'Partners & rules',payouts:'Payouts',settings:'Settings'};
const SUBS={
  dash:'What came in, what it cost, and who gets what.',
  wallet:'Your Tebex wallet: what is settled, what is still settling, and what you really keep.',
  calc:'Work out a payout from money that has actually settled. Side income comes off first, the rest is split by your rules.',
  pay:'Every sale, with the real fee and tax where the wallet knows them.',
  partners:'The deals that decide who earns a share of which sales.',
  payouts:'What you have paid, and what is still owed.',
  settings:'Sources, Tebex sync and Discord alerts.'};
const ICONS={ // simple line icons, 24x24
  dash:'<path d="M4 13h6V4H4zM14 20h6v-9h-6zM14 8h6V4h-6zM4 20h6v-3H4z"/>',
  wallet:'<path d="M4 7a2 2 0 0 1 2-2h11v4"/><path d="M4 7v10a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6a2 2 0 0 1-2-2"/><circle cx="16" cy="13.5" r="1"/>',
  calc:'<circle cx="9" cy="9" r="5"/><path d="M14.5 9.2a5 5 0 1 1-5.3 5.3"/><path d="M9 7v4M7.5 9h3"/>',
  pay:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  partners:'<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.5a3 3 0 0 1 0 5.5M18 20a6 6 0 0 0-3-5.2"/>',
  payouts:'<path d="M7 17 17 7M9 7h8v8"/>',
  settings:'<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'};
if(!(tab in TABS))tab='dash';
const cur=()=>S.settings.currency;
const m$=c=>(c/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+' '+cur();
const mN=c=>`<span data-count="${c}">${m$(c)}</span>`; // money that counts up when a view opens
const bare=c=>(c/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const mB=c=>`<span data-count="${c}" data-bare="1">${bare(c)}</span><span class="unit">${esc(cur())}</span>`; // big figure: currency set small
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
function animateNumbers(root){
  if(reduceMotion)return;
  root.querySelectorAll('[data-count]').forEach(el=>{
    const to=Number(el.dataset.count);if(!isFinite(to)||Math.abs(to)<1)return;
    const t0=performance.now(),dur=650;
    const fmt=el.dataset.bare?bare:m$;
    (function step(now){const p=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-p,3);el.textContent=fmt(Math.round(to*e));if(p<1)requestAnimationFrame(step)})(t0);
  });
}
async function api(p,body){const r=await fetch('/api/'+p,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j}
function toast(t,bad){const e=$('#toast');e.textContent=t;e.className=bad?'bad':'';e.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>e.style.display='none',6000)}
const guard=f=>async(...a)=>{try{await f(...a)}catch(e){toast(e.message,1)}};
async function refresh(){S=await api('state');
  const ms=S.monthly.months.map(m=>m.month);if(month&&!ms.includes(month))month='';
  $('#month').innerHTML='<option value="">All time</option>'+ms.slice().reverse().map(m=>`<option ${m===month?'selected':''}>${m}</option>`).join('');
  $('#nav').innerHTML=Object.entries(TABS).map(([k,v])=>`<button class="${k===tab?'on':''}" ${k===tab?'aria-current="page"':''} onclick="go('${k}')"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>${v}</button>`).join('');
  const chip=$('#syncchip'),on=S.settings.autoSyncMinutes>0&&S.settings.tebexSecretSet;
  chip.className=on?'':'off';
  chip.querySelector('span').textContent=on?(S.settings.lastSync?'Synced '+new Date(S.settings.lastSync).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'Auto-sync on'):'Auto-sync off';
  await render()}
$('#month').onchange=e=>{month=e.target.value;localStorage.setItem('month',month);refresh()};
window.go=t=>{tab=t;history.replaceState(null,'','#'+t);if(t==='calc')window.__showerNext=true;refresh()};
async function render(){const f={dash,wallet,calc,pay,partners,payouts,settings}[tab];
  const body=await f();
  $('#main').innerHTML=`<h1 class="view-title">${TABS[tab]}</h1><p class="view-sub">${SUBS[tab]}</p>${body}`;
  animateNumbers($('#main'));
  if(tab==='calc'&&window.__showerNext){window.__showerNext=false;requestAnimationFrame(fireShower)}}
// coins fall from the withdrawable total into each segment of the split bar
function fireShower(){
  const S_=window.RevenueScene;if(!S_||!S_.enabled)return;
  const from=document.querySelector('.pool .big');if(!from)return;
  const fb=from.getBoundingClientRect();
  const col={side:'#aeb8d6',partner:'#e5704f',you:'#5fd1b3'};
  const targets=[...document.querySelectorAll('.split .seg')].map(el=>{const b=el.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2,color:col[el.dataset.kind]||'#d9a441',weight:Number(el.dataset.w),spread:Math.max(20,b.width*.7)}}).filter(t=>t.weight>0);
  S_.shower({x:fb.left+fb.width/2,y:fb.bottom-4},targets,70);
}

async function dash(){
  const r=await api('report?month='+month),t=r.totals;
  const hist=S.monthly.months,max=Math.max(1,...hist.map(h=>h.totals.net));
  return `${r.warnings.map(w=>`<div class="warn">${esc(w)}</div>`).join('')}
  ${!S.monthly.months.length?`<div class="card empty"><h2>No sales yet</h2><p>Add your Tebex secret key under Settings for automatic import, or upload a payments CSV on the Payments tab.</p><div class="row" style="justify-content:center"><button class="p" onclick="go('settings')">Open Settings</button><button onclick="go('pay')">Import a CSV</button></div></div>`:`
  <section class="card hero"><div>
    <div class="big">${mB(t.mine)}</div>
    <div class="cap">${esc(S.settings.ownerName||'You')} keep from ${month||'all time'}<br><small>${t.count} sales${t.refunded?`, ${t.refunded} refunded or not counted`:''}</small></div>
    <div class="actions"><button onclick="discord()">Send summary to Discord</button></div></div>
   <div class="grid">
    <div class="stat"><span>Gross</span><b>${mN(t.gross)}</b></div>
    <div class="stat"><span>Tax</span><b>${mN(t.tax)}</b></div>
    <div class="stat"><span>Fees</span><b>${mN(t.fee)}</b></div>
    <div class="stat"><span>Net</span><b>${mN(t.net)}</b></div>
    <div class="stat"><span>Owed to partners</span><b class="bad">${mN(t.owed)}</b></div></div></section>`}
  <div class="card"><h2>Owed per partner</h2><table><tr><th>Partner</th><th>Breakdown</th><th class="n">Owed</th></tr>
   ${r.partners.map(p=>`<tr><td>${esc(p.name)}</td><td>${Object.entries(p.byRule).map(([k,v])=>`${esc(k)}: ${m$(v)}`).join('<br>')||'-'}</td><td class="n">${m$(p.owed)}</td></tr>`).join('')||'<tr><td colspan=3 class="mute">No partners</td></tr>'}</table></div>
  <div class="card"><h2>By source</h2><table><tr><th>Source</th><th class="n">Sales</th><th class="n">Gross</th><th class="n">Tax</th><th class="n">Fees</th><th class="n">Net</th></tr>
   ${Object.entries(r.bySource).map(([k,b])=>`<tr><td>${esc(k)}</td><td class="n">${b.count}</td><td class="n">${m$(b.gross)}</td><td class="n">${m$(b.tax)}</td><td class="n">${m$(b.fee)}</td><td class="n">${m$(b.net)}</td></tr>`).join('')||'<tr><td colspan=6 class="mute">No data. Import payments.</td></tr>'}</table></div>
  <div class="card"><h2>Month by month</h2>
   <div class="bars" role="img" aria-label="Net income per month">${hist.map((h,i)=>`<div title="${h.month}: net ${m$(h.totals.net)}" style="height:${Math.max(2,h.totals.net/max*100)}%;animation-delay:${Math.min(i*35,600)}ms"><span>${h.month.slice(2)}</span></div>`).join('')}</div>
   <table><tr><th>Month</th><th class="n">Gross</th><th class="n">Net</th><th class="n">Partners</th><th class="n">You</th></tr>
   ${hist.slice().reverse().map(h=>`<tr><td>${h.month}</td><td class="n">${m$(h.totals.gross)}</td><td class="n">${m$(h.totals.net)}</td><td class="n">${m$(h.totals.owed)}</td><td class="n">${m$(h.totals.mine)}</td></tr>`).join('')}</table></div>`}
window.discord=guard(async()=>{await api('discord',{month});toast('Sent to Discord')});

async function pay(){
  const rows=await api('payments?month='+month);
  const srcOpts=S.sources.map(s=>`<option>${esc(s.name)}</option>`).join('');
  return `<div class="card"><h2>Import CSV</h2>
   <div class="row"><select id="isrc">${srcOpts}</select><input type="file" id="ifile" accept=".csv,.tsv,.txt">
   <button class="p" onclick="doImport()">Import</button></div>
   <small>Tebex: Creator panel > Payments > Export. Needs Date + Price/Amount columns; Transaction ID, Package, Status, Tax, Fee, Currency used if present. Re-importing is safe: duplicates skipped. Fee/Tax missing in CSV are estimated from Sources settings.</small></div>
  <div class="card"><h2>Add one manually</h2><div class="row">
   <select id="msrc">${srcOpts}</select><input id="mprod" placeholder="Product name"><input id="mdate" type="date" value="${new Date().toISOString().slice(0,10)}">
   <input id="mgross" type="number" step="0.01" placeholder="Gross" style="width:90px"><input id="mtax" type="number" step="0.01" placeholder="Tax (opt)" style="width:90px"><input id="mfee" type="number" step="0.01" placeholder="Fee (opt)" style="width:90px">
   <button class="p" onclick="addPay()">Add</button></div></div>
  <div class="card"><h2>Payments (${rows.length})</h2><div style="overflow:auto"><table><tr><th>Date</th><th>Source</th><th>Product</th><th>Status</th><th class="n">Gross</th><th class="n">Tax</th><th class="n">Fee</th><th class="n">Net</th><th class="n">Partners</th><th>Test</th><th></th></tr>
  ${rows.slice(0,500).map(r=>`<tr class="${r.active?'':'mute'}"><td>${r.date.slice(0,10)}</td><td>${esc(r.source)}</td><td>${esc(r.product)}</td><td>${esc(r.status)}${r.test?' <b class="bad">TEST</b>':''}</td>
   <td class="n">${m$(r.gross)}</td><td class="n">${m$(r.tax)}${r.taxEst?'*':''}</td><td class="n">${m$(r.fee)}${r.feeEst?'*':''}</td><td class="n">${m$(r.net)}</td>
   <td class="n" title="${esc(r.splits.map(s=>s.label+': '+m$(s.cents)).join('\n'))}">${m$(r.owed)}</td>
   <td><input type="checkbox" aria-label="Mark as test purchase" ${r.test?'checked':''} data-id="${esc(r.id)}" data-src="${esc(r.source)}" onchange="markTest(this)"></td>
   <td><button class="d" data-id="${esc(r.id)}" data-src="${esc(r.source)}" onclick="delPay(this)">x</button></td></tr>`).join('')}</table></div>
  <small>* = estimated. Showing newest 500. Hover Partners cell for the split.</small>
  <div class="row"><button class="d" onclick="clearAll()">Delete ALL payments</button></div></div>`}
window.doImport=guard(async()=>{const f=$('#ifile').files[0];if(!f)throw new Error('Pick a file');
  const r=await api('import',{source:$('#isrc').value,csv:await f.text()});
  toast(`Added ${r.added}, duplicates ${r.dupes}, skipped ${r.skipped.length}${r.skipped.length?' ('+r.skipped.slice(0,3).join('; ')+')':''}`);refresh()});
window.addPay=guard(async()=>{await api('payment',{source:$('#msrc').value,product:$('#mprod').value,date:$('#mdate').value,gross:$('#mgross').value,tax:$('#mtax').value,fee:$('#mfee').value});refresh()});
window.markTest=guard(async b=>{await api('payment/test',{id:b.dataset.id,source:b.dataset.src,test:b.checked});toast(b.checked?'Marked as test: no longer counted':'Counted again');refresh()});
window.delPay=guard(async b=>{await api('payment/delete',{id:b.dataset.id,source:b.dataset.src});refresh()});
window.clearAll=guard(async()=>{if(prompt('Type DELETE to wipe all payments')==='DELETE'){await api('payments/clear',{confirm:'DELETE'});refresh()}});

let draft=null;
async function partners(){draft=draft||JSON.parse(JSON.stringify(S.partners));
  return `<div class="card"><h2>Partners & split rules</h2>
  <small>Each rule pays the partner <b>percent</b> of a payment's net (or gross) when the product name contains any <b>match</b> keyword (comma separated; blank = every product), none of the <b>exclude</b> keywords, and the source is in the list (blank = all). Rules <b>stack</b>, so "60% of skins" plus "7% of all store sales" both apply to a skin sale.</small>
  ${draft.map((p,pi)=>`<div class="card" style="margin-top:12px"><div class="row"><input value="${esc(p.name)}" onchange="draft[${pi}].name=this.value;draft[${pi}].id=draft[${pi}].id||this.value.toLowerCase().replace(/\\W+/g,'-')" placeholder="Partner name"><button class="d" onclick="draft.splice(${pi},1);render()">Remove partner</button></div>
   <table><tr><th>Label</th><th>Match</th><th>Exclude</th><th>Sources</th><th>%</th><th>Of</th><th></th></tr>
   ${p.rules.map((r,ri)=>`<tr><td><input value="${esc(r.label)}" onchange="draft[${pi}].rules[${ri}].label=this.value" style="width:130px"></td>
    <td><input value="${esc(r.match)}" onchange="draft[${pi}].rules[${ri}].match=this.value" style="width:130px"></td>
    <td><input value="${esc(r.exclude)}" onchange="draft[${pi}].rules[${ri}].exclude=this.value" style="width:100px"></td>
    <td><input value="${esc((r.sources||[]).join(', '))}" onchange="draft[${pi}].rules[${ri}].sources=this.value.split(',').map(s=>s.trim()).filter(Boolean)" placeholder="all" style="width:110px"></td>
    <td><input type="number" step="0.01" value="${r.percent}" onchange="draft[${pi}].rules[${ri}].percent=Number(this.value)" style="width:70px"></td>
    <td><select onchange="draft[${pi}].rules[${ri}].base=this.value"><option ${r.base!=='gross'?'selected':''} value="net">net</option><option ${r.base==='gross'?'selected':''} value="gross">gross</option></select></td>
    <td><button class="d" onclick="draft[${pi}].rules.splice(${ri},1);render()">x</button></td></tr>`).join('')}</table>
   <div class="row"><button onclick="draft[${pi}].rules.push({label:'New rule',match:'',exclude:'',sources:[],percent:0,base:'net'});render()">+ rule</button></div></div>`).join('')}
  <div class="row"><button onclick="draft.push({id:'p'+Date.now(),name:'New partner',rules:[]});render()">+ partner</button><button class="p" onclick="savePartners()">Save changes</button></div></div>`}

let cin={w:'',o:''};
async function calc(){
  const q=new URLSearchParams({withdrawable:cin.w,owner:cin.o});
  const c=await api('calc?'+q);
  const stale=c.lastWalletRow?(Date.now()-new Date(c.lastWalletRow).getTime())/36e5:null;
  const step=(n,t)=>`<span class="mute">${n}.</span> <b>${t}</b>`;
  return `<div class="card"><h2>${step(1,'Refresh wallet data')}</h2>
   <div class="row"><a href="https://wallet.tebex.io/exports" target="_blank" rel="noopener"><button type="button">Open Tebex wallet exports</button></a>
   <small>Click Export on the Summary page if no fresh one is listed, then Download.</small></div>
   <div class="row">Downloads folder <input id="wdir" style="width:260px" value="${esc(c.walletDir)}"><button class="p" onclick="importFolder()">Import newest wallet export</button></div>
   <small>Newest wallet row in the tool: ${c.lastWalletRow?esc(new Date(c.lastWalletRow).toLocaleString()):'none'}${stale!=null&&stale>24?` <b class="bad">(${Math.round(stale/24)} days old: export again)</b>`:''}. Sales are also auto-synced from Tebex if enabled.</small></div>
  <div class="card"><h2>${step(2,'Check the numbers')}</h2>
   <div class="row">Withdrawable on Tebex wallet page <input type="number" step="0.01" style="width:210px" placeholder="${(c.withdrawableEst/100).toFixed(2)} (estimate)" value="${esc(cin.w)}" onchange="cin.w=this.value">
    <small>Type the exact figure from the wallet page. Blank = estimate.</small></div>
   <div class="row">${esc(c.ownerSources.join(', ')||'Owner-only')} money inside it <input type="number" step="0.01" style="width:210px" placeholder="${(c.ownerCycle/100).toFixed(2)} (estimate)" value="${esc(cin.o)}" onchange="cin.o=this.value">
    <small>Settled ${esc(c.ownerSources.join(', '))} sales since your last withdrawal${c.lastWithdrawal?' ('+esc(c.lastWithdrawal.slice(0,10))+')':''}. Blank = estimate.</small></div>
   <div class="row">Count partner sales from <input type="date" value="${esc(c.from.slice(0,10))}" onchange="setFrom(this.value)"><small>${c.from.length>10?'Set to an exact moment (settled up as of '+esc(new Date(c.from).toLocaleString())+'). Picking a date here replaces it. ':''}Start of the deal. Earlier sales and payouts are ignored.</small></div>
   <div class="row"><button class="p" onclick="window.__showerNext=true;render()">Calculate</button></div></div>
  <div class="card"><h2>${step(3,'Result')} <small>sales settled before ${esc(new Date(c.cutoff).toLocaleDateString())} (${c.settleDays}-day window)</small></h2>
   <div class="pool"><div><small>Withdrawable now</small><div class="big">${mB(c.withdrawable)}</div></div>
    <small>${esc(c.ownerSources.join(', ')||'Owner-only income')} comes off first, the rest is split by your rules.</small></div>
   <div class="split" role="img" aria-label="Split of the withdrawable amount">
    ${c.ownerPart>0?`<div class="seg k-side" data-kind="side" data-w="${c.ownerPart}" style="flex:${c.ownerPart}"></div>`:''}
    ${c.paidOut>0?`<div class="seg k-partner" data-kind="partner" data-w="${c.paidOut}" style="flex:${c.paidOut}"></div>`:''}
    ${c.pool-c.paidOut>0?`<div class="seg k-you" data-kind="you" data-w="${c.pool-c.paidOut}" style="flex:${c.pool-c.paidOut}"></div>`:''}
   </div>
   <div class="legend">
    ${c.ownerPart>0?`<div class="k-side"><b>${mN(c.ownerPart)}</b><span>${esc(c.ownerSources.join(', ')||'Owner-only income')}, all yours</span></div>`:''}
    ${c.partners.map(p=>`<div class="k-partner"><b>${mN(p.pay)}</b><span>Pay ${esc(p.name)}. Owed on settled sales ${m$(p.settled)}${p.paid?`, already paid ${m$(p.paid)}`:''}</span></div>`).join('')}
    <div class="k-you"><b>${mN(c.youKeep)}</b><span>You keep in total</span></div></div>
   ${!c.from?`<div class="warn"><b>Set "Count partner sales from" in step 2 first.</b> With no start date this counts every sale ever, and any partner payouts you made earlier aren't in the tool, so the amounts above are not reliable. Use the first day of the period you haven't paid yet (for example 2026-10-01 if you last paid on Nov 1st), or record past payouts on the Payouts tab.</div>`:''}
   ${c.shortfall>0?`<div class="warn">Not enough settled store money to cover everyone. ${m$(c.shortfall)} carries over to the next payout.</div>`:''}
   ${c.partners.filter(p=>p.overpaid).map(p=>`<div class="warn">${esc(p.name)}: payouts recorded (${m$(p.paid)}) exceed what the settled sales owe (${m$(p.settled)}). Check the "count from" date.</div>`).join('')}
   ${c.unverified?`<div class="warn">${c.unverified} sales that earn partners money aren't in the wallet export, so they're left out. Re-import the wallet or check them in Tebex.</div>`:''}
   <small>Still settling (not payable yet, accrues to partners next time): ${m$(c.deferred)}</small>
   ${c.partners.filter(p=>p.pay>0).map(p=>`<div class="row"><button onclick="recordCalc('${esc(p.id)}',${p.pay})">Record ${m$(p.pay)} as paid to ${esc(p.name)}</button></div>`).join('')}
   ${c.partners.filter(p=>Object.keys(p.byRule).length).map(p=>`<details><summary>${esc(p.name)} breakdown</summary><table>${Object.entries(p.byRule).map(([k,v])=>`<tr><td>${esc(k)}</td><td class="n">${m$(v)}</td></tr>`).join('')}</table></details>`).join('')}</div>`}
window.importFolder=guard(async()=>{const r=await api('import-wallet-folder',{dir:$('#wdir').value});toast(`Imported ${r.file}: ${r.added} new rows, ${r.matched} sales got real fees, ${r.dupes} already known.`);refresh()});
window.setFrom=guard(async v=>{await api('config',{settings:{calcFrom:v}});await refresh()});
window.recordCalc=guard(async(id,cents)=>{await api('payout',{partner:id,amount:(cents/100).toFixed(2),note:'from payout calculator'});toast('Recorded');refresh()});

async function wallet(){
  const w=await api('wallet?month='+month);
  const names=[...new Set([...Object.keys(w.byProject),...S.sources.map(s=>s.name)])];
  const projRows=Object.entries(w.byProject).map(([k,b])=>`<tr><td>${esc(k)}</td><td class="n">${b.count}</td><td class="n">${m$(b.gross)}</td><td class="n">${m$(b.tax)}</td><td class="n">${m$(b.fee)}</td><td class="n">${m$(b.net)}</td></tr>`).join('');
  const projNames=[...new Set(w.months.flatMap(m=>Object.keys(m.net)))];
  return `<div class="card"><h2>Tebex wallet <small>(as of last import, ${w.rowCount} rows)</small></h2>
  ${w.rowCount?`<div class="grid">
   <div class="stat"><span>Total balance</span><b>${mN(w.total)}</b></div>
   <div class="stat"><span>Settling (approx.)</span><b>${mN(w.settling)}</b></div>
   <div class="stat"><span>Withdrawable (approx.)</span><b>${mN(w.withdrawable)}</b></div>
   <div class="stat"><span>Still owed to partners</span><b class="bad">${mN(w.owedPartners)}</b></div>
   <div class="stat"><span>Really yours</span><b class="good">${mN(w.yours)}</b></div></div>
   <small>Really yours = wallet balance minus partner money not yet paid out (see Payouts tab). Settling uses a ${w.settleDays}-day window, which is an estimate; the wallet page has the exact figure.</small>`:'<p class="mute">No wallet data yet. Import your wallet export below.</p>'}</div>
  <div class="card"><h2>Import wallet export</h2>
   <div class="row"><input type="file" id="wfile" accept=".csv"><button class="p" onclick="importWalletFile()">Import</button></div>
   <small>Get the file at wallet.tebex.io > Exports (Export button on the Summary page, then Download). Safe to re-import: rows already seen are skipped. Real fee and tax from the wallet replace estimates on matching sales.</small></div>
  ${w.rowCount?`<div class="card"><h2>By project ${month||'(all time)'}</h2><table><tr><th>Project</th><th class="n">Sales</th><th class="n">Gross</th><th class="n">Tax</th><th class="n">Fees</th><th class="n">Net to wallet</th></tr>${projRows||'<tr><td colspan=6 class="mute">Nothing this month</td></tr>'}</table>
   <small>Withdrawn ${month||'all time'}: ${m$(-w.withdrawn)}${w.other?` | Other income (ads etc.): ${m$(w.other)}`:''}</small></div>
  <div class="card"><h2>Month by month (net into wallet)</h2><table><tr><th>Month</th>${projNames.map(n=>`<th class="n">${esc(n)}</th>`).join('')}<th class="n">Withdrawn</th></tr>
   ${w.months.slice().reverse().map(m=>`<tr><td>${m.month}</td>${projNames.map(n=>`<td class="n">${m$(m.net[n]||0)}</td>`).join('')}<td class="n">${m$(-m.withdrawn)}</td></tr>`).join('')}</table></div>`:''}
  <div class="card"><h2>Wallet store mapping</h2><small>Your wallet export lists the store each sale came from. Tell the tool which source each one is, or ignore it. Changes apply immediately.</small>
   ${w.allGroups.map(g=>{const s=w.groups[g]||'';return `<div class="row"><code style="min-width:300px">${esc(g)}</code><select data-g="${esc(g)}" onchange="setGroup(this.dataset.g,this.value)"><option value="" ${s?'':'selected'}>Choose a source...</option>${S.sources.map(x=>`<option ${x.name===s?'selected':''}>${esc(x.name)}</option>`).join('')}<option value="(ignore)" ${s==='(ignore)'?'selected':''}>(ignore this store)</option></select>${s?'':'<small class="bad">not mapped yet, its sales are not counted</small>'}</div>`}).join('')||'<small>No wallet stores yet. Import a wallet export first.</small>'}
   <div class="row">Settling window <input type="number" style="width:70px" value="${w.settleDays}" onchange="setSettle(this.value)"> days</div></div>`}
window.importWalletFile=guard(async()=>{const f=$('#wfile').files[0];if(!f)throw new Error('Pick the wallet CSV');
  const r=await api('import-wallet',{csv:await f.text()});const un=Object.entries(r.unmapped);
  toast(`Wallet: ${r.added} new rows, ${r.dupes} already known. Real fees applied to ${r.matched} sales, ${r.created} new sales created.${un.length?' UNMAPPED stores: '+un.map(([g,n])=>g+' ('+n+')').join(', '):''}`,un.length);refresh()});
window.setGroup=guard(async(g,s)=>{await api('config',{settings:{walletGroups:{...(await api('state')).settings.walletGroups,[g]:s}}});toast('Saved');refresh()});
window.setSettle=guard(async v=>{await api('config',{settings:{settleDays:Number(v)}});refresh()});
window.savePartners=guard(async()=>{draft.forEach(p=>{if(!p.id)p.id=p.name.toLowerCase().replace(/\W+/g,'-')});await api('config',{partners:draft});draft=null;toast('Saved');refresh()});

async function payouts(){
  const b=S.monthly.balances;
  return `<div class="card"><h2>Balances (all time)</h2><table><tr><th>Partner</th><th class="n">Owed</th><th class="n">Paid</th><th class="n">Still owed</th></tr>
  ${b.map(x=>`<tr><td>${esc(x.name)}</td><td class="n">${m$(x.owed)}</td><td class="n">${m$(x.paid)}</td><td class="n ${x.balance>0?'bad':'good'}"><b>${m$(x.balance)}</b></td></tr>`).join('')}</table></div>
  <div class="card"><h2>Record a payment you sent</h2><div class="row"><select id="ppart">${S.partners.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
  <input id="pamt" type="number" step="0.01" placeholder="Amount"><input id="pdate" type="date" value="${new Date().toISOString().slice(0,10)}"><input id="pnote" placeholder="Note (PayPal txn...)"><button class="p" onclick="addPayout()">Record</button></div></div>
  <div class="card"><h2>History</h2><table><tr><th>Date</th><th>Partner</th><th class="n">Amount</th><th>Note</th><th></th></tr>
  ${S.payouts.slice().reverse().map(p=>`<tr><td>${esc(p.date)}</td><td>${esc((S.partners.find(x=>x.id===p.partner)||{}).name||p.partner)}</td><td class="n">${m$(Math.round(p.amount*100))}</td><td>${esc(p.note)}</td><td><button class="d" onclick="delPayout('${esc(p.id)}')">x</button></td></tr>`).join('')}</table></div>`}
window.addPayout=guard(async()=>{await api('payout',{partner:$('#ppart').value,amount:$('#pamt').value,date:$('#pdate').value,note:$('#pnote').value});refresh()});
window.delPayout=guard(async id=>{await api('payout/delete',{id});refresh()});

let sdraft=null,sbase=null;
// Only send fields that were edited in this form, so a stale form can never overwrite settings changed elsewhere (e.g. the count-from date).
function draftDiff(){const out={};const st={};for(const k of Object.keys(sdraft.settings))if(JSON.stringify(sdraft.settings[k])!==JSON.stringify(sbase.settings[k]))st[k]=sdraft.settings[k];if(Object.keys(st).length)out.settings=st;if(JSON.stringify(sdraft.sources)!==JSON.stringify(sbase.sources))out.sources=sdraft.sources;return out}
async function settings(){if(!sdraft){sdraft={sources:JSON.parse(JSON.stringify(S.sources)),settings:{...S.settings}};sbase=JSON.parse(JSON.stringify(sdraft))}
  return `<div class="card"><h2>Sources (where money comes from)</h2>
  <small>Fee/tax % are used ONLY for payments whose CSV had no fee/tax values. Fee % applies after tax is removed. Compare one month against your real Tebex/MCModels payout and tune until it matches.</small>
  <div style="overflow-x:auto"><table><tr><th>Name</th><th>Fee %</th><th>Fixed fee / sale</th><th>Tax % (included in price)</th><th title="All of this source's money is yours: no partner splits, comes off first in the calculator">All mine</th><th></th></tr>
  ${sdraft.sources.map((s,i)=>`<tr><td><input value="${esc(s.name)}" onchange="sdraft.sources[${i}].name=this.value"></td>
   <td><input type="number" step="0.01" style="width:80px" value="${s.feePercent}" onchange="sdraft.sources[${i}].feePercent=Number(this.value)"></td>
   <td><input type="number" step="0.01" style="width:80px" value="${s.feeFixed}" onchange="sdraft.sources[${i}].feeFixed=Number(this.value)"></td>
   <td><input type="number" step="0.01" style="width:80px" value="${s.taxPercent}" onchange="sdraft.sources[${i}].taxPercent=Number(this.value)"></td>
   <td><input type="checkbox" aria-label="All money from this source is mine" ${(sdraft.settings.ownerSources||[]).includes(s.name)?'checked':''} onchange="toggleOwner(${i},this.checked)"></td>
   <td><button class="d" onclick="sdraft.sources.splice(${i},1);render()" aria-label="Remove source">x</button></td></tr>`).join('')}</table></div>
  <div class="row"><button onclick="sdraft.sources.push({name:'New source',feePercent:0,feeFixed:0,taxPercent:0});render()">+ source</button><button class="p" onclick="saveSettings()">Save</button></div></div>
  <div class="card"><h2>Settings</h2><div class="row">Currency <input style="width:70px" value="${esc(sdraft.settings.currency)}" onchange="sdraft.settings.currency=this.value">
   Your name <input value="${esc(sdraft.settings.ownerName)}" onchange="sdraft.settings.ownerName=this.value"></div>
  <div class="row">Discord webhook <input style="flex:1;min-width:300px" type="password" value="${esc(sdraft.settings.discordWebhook)}" onchange="sdraft.settings.discordWebhook=this.value" placeholder="https://discord.com/api/webhooks/..."></div>
  <div class="row"><button class="p" onclick="saveSettings()">Save</button></div></div>
  <div class="card"><h2>Tebex auto-import</h2>
  <small>Uses your Tebex server secret key (stored only in data/db.json on this PC; never shown again after saving). Fetches payments from the Tebex API. API gives no fee/tax, so those are estimated from the source settings above.</small>
  <div class="row">Secret key <input type="password" style="flex:1;min-width:300px" autocomplete="off" placeholder="${S.settings.tebexSecretSet?'(saved - type to replace)':'paste secret key'}" onchange="sdraft.settings.tebexSecret=this.value">
   ${S.settings.tebexSecretSet?'<button class="d" onclick="clearSecret()">Remove key</button>':''}</div>
  <div class="row">Import into source <select onchange="sdraft.settings.tebexSource=this.value">${sdraft.sources.map(s=>`<option ${s.name===(sdraft.settings.tebexSource||'Main Store')?'selected':''}>${esc(s.name)}</option>`).join('')}</select>
   Auto-sync every <input type="number" min="0" style="width:70px" value="${sdraft.settings.autoSyncMinutes||0}" onchange="sdraft.settings.autoSyncMinutes=Number(this.value)"> min (0 = off)</div>
  <div class="row"><button class="p" onclick="saveSettings()">Save</button><button onclick="syncNow()">Sync now</button>
   <small>${S.settings.lastSync?'Last sync '+esc(new Date(S.settings.lastSync).toLocaleString())+': '+esc(S.settings.lastSyncResult||''):esc(S.settings.lastSyncResult||'Never synced')}</small></div></div>
  <div class="card"><h2>Discord purchase alerts</h2>
  <small>Posts an embed for every new sale found by the Tebex sync: items, amount, and what each partner is owed afterwards. Needs auto-sync switched on above and the app running. Only sales from the moment you turn this on are announced. In Discord: channel settings > Integrations > Webhooks > New Webhook > Copy Webhook URL.</small>
  <div class="row">Webhook URL <input type="password" style="flex:1;min-width:300px" autocomplete="off" placeholder="${S.settings.purchaseWebhookSet?'(saved - type to replace)':'https://discord.com/api/webhooks/...'}" onchange="sdraft.settings.purchaseWebhook=this.value"></div>
  <div class="row"><label><input type="checkbox" ${sdraft.settings.notifyPurchases?'checked':''} onchange="sdraft.settings.notifyPurchases=this.checked"> Announce new purchases</label>
   Test accounts <input style="width:200px" placeholder="your in-game names" title="Purchases by these buyers are never counted and are announced as [TEST]" value="${esc(sdraft.settings.testAccounts||'')}" onchange="sdraft.settings.testAccounts=this.value">
   Highlight items containing <input style="width:120px" value="${esc(sdraft.settings.highlightKeyword||'')}" onchange="sdraft.settings.highlightKeyword=this.value"></div>
  <div class="row"><button class="p" onclick="saveSettings()">Save</button><button onclick="testAlert()">Send test alert</button></div></div>`}
window.toggleOwner=(i,on)=>{const n=sdraft.sources[i].name,set=new Set(sdraft.settings.ownerSources||[]);on?set.add(n):set.delete(n);sdraft.settings.ownerSources=[...set]};
window.testAlert=guard(async()=>{if(sdraft){const d=draftDiff();if(Object.keys(d).length)await api('config',d)}await api('notify-test',{});toast('Test alert sent to Discord')});
window.syncNow=guard(async()=>{if(sdraft){const d=draftDiff();if(Object.keys(d).length)await api('config',d)}toast('Syncing...');const r=await api('sync-tebex');sdraft=null;toast(`Tebex: ${r.added} new, ${r.updated} status changes, ${r.skipped} skipped (of ${r.total})`);refresh()});
window.clearSecret=guard(async()=>{await api('tebex-secret/clear',{});sdraft=null;refresh()});
window.saveSettings=guard(async()=>{const d=draftDiff();if(Object.keys(d).length)await api('config',d);sdraft=null;sbase=null;toast('Saved');refresh()});
if(tab==='calc')window.__showerNext=true;
refresh().catch(e=>toast(e.message,1));

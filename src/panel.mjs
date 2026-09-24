const STYLES = `
:root{
  --bg:#f4f5f7;
  --surface:#fdfdfe;
  --surface-2:#eff1f4;
  --raised:#e7eaee;
  --line:#e2e5ea;
  --line-strong:#ccd2da;
  --text:#15181c;
  --text-dim:#5a626d;
  --text-faint:#868d98;
  --accent:#2563eb;
  --accent-soft:rgba(37,99,235,.10);
  --on-accent:#fdfdfe;
  --ok:#15803d;
  --warn:#b45309;
  --err:#b91c1c;
  --sidebar:212px;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans SC","Helvetica Neue",Arial,sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--text); font:14px/1.55 var(--sans);
  display:flex; min-height:100dvh; -webkit-font-smoothing:antialiased;
}
.mono,num,.num{font-family:var(--mono); font-variant-numeric:tabular-nums}

/* left sidebar */
.sidebar{
  width:var(--sidebar); flex:none; position:sticky; top:0; height:100dvh; overflow-y:auto;
  background:var(--surface); border-right:1px solid var(--line);
  display:flex; flex-direction:column; padding:20px 12px 14px;
}
.brand{padding:0 10px 18px; border-bottom:1px solid var(--line)}
.brand h1{margin:0; font-size:15px; font-weight:650; letter-spacing:-.01em}
.brand p{margin:3px 0 0; font-size:11.5px; color:var(--text-faint)}
.nav{display:flex; flex-direction:column; gap:1px; padding:14px 0; flex:1}
.nav button{
  appearance:none; border:0; background:none; font:inherit; font-size:13px; font-weight:500;
  color:var(--text-dim); text-align:left; cursor:pointer; width:100%;
  padding:9px 11px; border-left:2px solid transparent;
  transition:background .14s ease, color .14s ease, border-color .14s ease, padding-left .14s ease;
}
.nav button:hover{background:var(--surface-2); color:var(--text)}
.nav button[aria-selected="true"]{background:var(--accent-soft); color:var(--accent); border-left-color:var(--accent); padding-left:14px}
.side-foot{border-top:1px solid var(--line); padding:12px 10px 0; display:flex; flex-direction:column; gap:7px}
.chip{display:inline-flex; align-items:center; gap:7px; font-size:11.5px; color:var(--text-dim)}
.dot{width:7px; height:7px; background:var(--text-faint); flex:none}
.dot.ok{background:var(--ok)} .dot.bad{background:var(--err)}

/* live channel */
.live{display:inline-flex; align-items:center; gap:7px; font-size:11.5px; color:var(--text-dim)}
.live[data-on="0"] .dot{background:var(--err)}
.live[data-on="1"] .dot{background:var(--ok); animation:pulse 2.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1} 50%{opacity:.3}}
tr.fresh{animation:flash 1.6s ease-out 1}
@keyframes flash{from{background:var(--accent-soft)} to{background:transparent}}
.feed-empty{padding:28px 16px; text-align:center; color:var(--text-faint); font-size:12.5px}

main{flex:1; min-width:0; padding:30px 34px 72px}
.wrap{max-width:1120px}
.view{display:none}
.view.on{display:block; animation:viewIn .22s cubic-bezier(.2,.8,.2,1) both}
@keyframes viewIn{from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:none}}

h2.section{margin:28px 0 12px; font-size:14px; font-weight:600}
h2.section:first-child{margin-top:0}
.head{display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px}

/* surfaces: sharp, separated by hairlines */
.card{background:var(--surface); border:1px solid var(--line)}
.card.pad{padding:16px}
.rows{display:flex; flex-direction:column}
.row{display:flex; align-items:baseline; justify-content:space-between; gap:16px; padding:7px 0; font-size:13px}
.row + .row{border-top:1px solid var(--line)}
.row dt{color:var(--text-dim); flex:none}
.row dd{margin:0; text-align:right; min-width:0; overflow-wrap:anywhere}

/* metrics */
.metrics{display:grid; gap:1px; background:var(--line); border:1px solid var(--line);
  grid-template-columns:repeat(auto-fit,minmax(158px,1fr))}
.metric{background:var(--surface); padding:15px 16px; transition:background .14s ease}
.metric:hover{background:var(--surface-2)}
.metric .k{color:var(--text-faint); font-size:11px; text-transform:uppercase; letter-spacing:.07em}
.metric .v{font-family:var(--mono); font-variant-numeric:tabular-nums; font-size:24px; font-weight:650; margin-top:7px; letter-spacing:-.02em; animation:pop .24s ease-out both}
.metric .s{color:var(--text-faint); font-size:11.5px; margin-top:3px}
@keyframes pop{from{opacity:0; transform:translateY(4px)} to{opacity:1; transform:none}}

/* bars */
.bar{height:6px; background:var(--line-strong); overflow:hidden; margin-top:10px}
.bar > i{display:block; height:100%; background:var(--accent); transition:width .45s cubic-bezier(.2,.8,.2,1)}
.bar.warn > i{background:var(--warn)} .bar.over > i{background:var(--err)}
.quota-row{padding:15px 0}
.quota-row + .quota-row{border-top:1px solid var(--line)}
.quota-top{display:flex; justify-content:space-between; align-items:baseline; gap:12px}
.quota-top .label{font-size:13px}
.quota-top .val{font-family:var(--mono); font-variant-numeric:tabular-nums; font-size:13px; color:var(--text-dim)}

/* chart: drawn in pixel coordinates, so the viewBox matches the rendered size */
.chart-box{border:1px solid var(--line); background:var(--surface); padding:16px}
.chart{display:block; width:100%}
.chart-line{fill:none; stroke:var(--accent); stroke-width:2; stroke-linejoin:round; stroke-linecap:round}
.chart-area{fill:var(--accent-soft); stroke:none}
.chart-base{stroke:var(--line-strong); stroke-width:1}
.chart-line.anim{animation:fadeUp .5s cubic-bezier(.2,.8,.2,1) both}
.chart-area.anim{animation:fade .6s ease-out both}
@keyframes fadeUp{from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:none}}
@keyframes fade{from{opacity:0} to{opacity:1}}
.chart-foot{display:flex; justify-content:space-between; gap:12px; margin-top:10px;
  font-family:var(--mono); font-size:11.5px; color:var(--text-faint)}

/* cache hit rate as a car-dashboard dial: red < 80%, orange 80-90%, green >= 90% */
.cache-gauge{border-top:1px solid var(--line); margin-top:3px; padding-top:12px}
.cache-gauge .gauge-head{display:flex; align-items:baseline; justify-content:space-between; gap:6px}
.cache-gauge .k{font-size:11px; text-transform:uppercase; letter-spacing:.07em; color:var(--text-faint)}
.cache-gauge svg{display:block; width:100%; max-width:178px; height:auto; margin:2px auto 0; overflow:visible}
.cache-gauge .track{fill:none; stroke:var(--line); stroke-width:2}
.cache-gauge .arc{fill:none; stroke:var(--text-faint); stroke-width:3;
  transition:stroke-dashoffset .55s cubic-bezier(.2,.8,.2,1), stroke .2s linear}
.cache-gauge .tick{stroke:var(--line-strong); stroke-width:1}
.cache-gauge .tick.major{stroke:var(--text-faint); stroke-width:1.4}
.cache-gauge .tick-label{fill:var(--text-faint); font-family:var(--mono); font-size:8.5px; text-anchor:middle}
.cache-gauge .needle{stroke:var(--text-dim); stroke-width:2; stroke-linecap:round;
  transition:transform .55s cubic-bezier(.2,.8,.2,1), stroke .2s linear}
.cache-gauge .hub{fill:var(--surface); stroke:var(--text-dim); stroke-width:1.6; transition:stroke .2s linear}
.cache-gauge .readout{font-family:var(--mono); font-size:25px; font-weight:650; letter-spacing:-.02em;
  line-height:1.05; text-align:center; margin-top:1px; color:var(--text)}
.cache-gauge .s{font-size:11px; color:var(--text-faint); margin-top:3px; text-align:center}
.cache-gauge[data-level="low"] .arc,.cache-gauge[data-level="low"] .needle{stroke:var(--err)}
.cache-gauge[data-level="low"] .hub{stroke:var(--err)}
.cache-gauge[data-level="low"] .readout{color:var(--err)}
.cache-gauge[data-level="mid"] .arc,.cache-gauge[data-level="mid"] .needle{stroke:var(--warn)}
.cache-gauge[data-level="mid"] .hub{stroke:var(--warn)}
.cache-gauge[data-level="mid"] .readout{color:var(--warn)}
.cache-gauge[data-level="high"] .arc,.cache-gauge[data-level="high"] .needle{stroke:var(--ok)}
.cache-gauge[data-level="high"] .hub{stroke:var(--ok)}
.cache-gauge[data-level="high"] .readout{color:var(--ok)}
td.cache-low{color:var(--err)} td.cache-mid{color:var(--warn)} td.cache-high{color:var(--ok)}
/* per-request inline bars in the live feed */
.mini{height:3px; background:var(--line); margin-top:4px; overflow:hidden}
.mini > i{display:block; height:100%; width:0; background:var(--text-faint);
  transition:width .45s cubic-bezier(.2,.8,.2,1)}
.mini > i.low{background:var(--err)} .mini > i.mid{background:var(--warn)} .mini > i.high{background:var(--ok)}
.mini > i.speed{background:var(--accent)}

/* rate-limit windows, compact, bottom-left */
.side-windows{border-top:1px solid var(--line); margin-top:3px; padding-top:12px;
  display:flex; flex-direction:column; gap:12px}
.side-window .quota-top .label{font-size:11.5px; color:var(--text-dim)}
.side-window .quota-top .val{font-size:11px}
.side-window .bar{height:4px; margin-top:6px}

/* dashboard scope + account list */
.side-scope{border-top:1px solid var(--line); margin-top:3px; padding-top:12px}
.side-scope select{font-size:12px; padding:6px 8px}
.acc-row{display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 0}
.acc-row + .acc-row{border-top:1px solid var(--line)}
.acc-main{min-width:0}
.acc-name{font-weight:600; font-size:13.5px; display:flex; align-items:center; gap:8px}
.acc-sub{color:var(--text-faint); font-size:11.5px; margin-top:2px}
.acc-actions{display:flex; gap:8px; flex: none}
.tag.active{border-color:rgba(37,99,235,.45); color:var(--accent)}
.tag.cool{border-color:rgba(217,164,65,.45); color:var(--warn)}
.mode-hint{color:var(--text-faint); font-size:11.5px; margin-top:8px}
.tag.bad{border-color:rgba(185,28,28,.45); color:var(--err)}
.tag.warn{border-color:rgba(217,164,65,.45); color:var(--warn)}
.mini-bar{height:4px; background:var(--line-strong); overflow:hidden; margin-top:6px; width:92px}
.mini-bar > i{display:block; height:100%; background:var(--accent); transition:width .4s cubic-bezier(.2,.8,.2,1)}
.mini-bar.warn > i{background:var(--warn)}
.mini-bar.over > i{background:var(--err)}
.acc-quota{font-family:var(--mono); font-variant-numeric:tabular-nums; font-size:12px}
.win-reset{color:var(--text-faint); font-size:11px; margin-top:3px}

/* forms */
label{display:block; font-size:12px; color:var(--text-dim); margin-bottom:6px}
input,textarea,select{
  width:100%; background:var(--surface); color:var(--text); font:inherit; font-size:13px;
  border:1px solid var(--line-strong); padding:9px 11px; outline:none;
  transition:border-color .14s ease, box-shadow .14s ease;
}
textarea{resize:vertical; min-height:76px; font-family:var(--mono); font-size:12.5px}
input::placeholder,textarea::placeholder{color:var(--text-faint)}
input:focus,textarea:focus,select:focus{border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft)}
.field{display:flex; flex-direction:column}
.field + .field{margin-top:14px}
.help{color:var(--text-faint); font-size:11.5px; margin-top:6px}

/* buttons: sharp */
button.btn{
  appearance:none; font:inherit; font-size:13px; font-weight:550; cursor:pointer;
  height:34px; padding:0 15px; border:1px solid var(--line-strong);
  background:var(--surface); color:var(--text); white-space:nowrap;
  transition:background .14s ease, border-color .14s ease, color .14s ease, transform .06s ease;
}
button.btn:hover{background:var(--raised); border-color:var(--text-faint)}
button.btn:active{transform:translateY(1px)}
button.btn.primary{background:var(--accent); border-color:var(--accent); color:var(--on-accent)}
button.btn.primary:hover{background:#1d4fd7; border-color:#1d4fd7}
button.btn.danger:hover{border-color:var(--err); color:var(--err)}
button.btn[disabled]{opacity:.45; cursor:not-allowed; transform:none}
.btn-row{display:flex; gap:10px; flex-wrap:wrap; align-items:center}

.seg{display:inline-flex; border:1px solid var(--line-strong)}
.seg button{appearance:none; border:0; border-right:1px solid var(--line-strong); background:var(--surface);
  color:var(--text-dim); font:inherit; font-size:12.5px; padding:6px 14px; cursor:pointer;
  transition:background .14s ease, color .14s ease}
.seg button:last-child{border-right:0}
.seg button:hover{background:var(--surface-2); color:var(--text)}
.seg button[aria-pressed="true"]{background:var(--accent); color:var(--on-accent)}

/* access gate for non-loopback clients */
.gate{position:fixed; inset:0; z-index:40; display:grid; place-items:center; background:rgba(244,245,247,.92); padding:24px}
.gate-box{width:100%; max-width:420px; background:var(--surface); border:1px solid var(--line-strong); padding:24px}
.gate-title{font-size:15px; font-weight:600; margin-bottom:6px}
.gate-help{color:var(--text-dim); font-size:12.5px; margin-bottom:16px; line-height:1.6}

/* messages */
.msg{display:none; margin-top:14px; padding:10px 12px; font-size:13px;
  border:1px solid var(--line-strong); border-left-width:3px; background:var(--surface-2);
  animation:viewIn .18s ease-out both}
.msg.show{display:block}
.msg.ok{border-left-color:var(--ok)} .msg.err{border-left-color:var(--err)} .msg.info{border-left-color:var(--accent)}

/* tables */
.table-wrap{border:1px solid var(--line); overflow:auto; max-height:560px; background:var(--surface)}
table{width:100%; border-collapse:collapse; font-size:13px}
thead th{position:sticky; top:0; background:var(--surface-2); z-index:1;
  text-align:left; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.06em;
  color:var(--text-faint); padding:9px 12px; border-bottom:1px solid var(--line-strong); white-space:nowrap}
tbody td{padding:9px 12px; border-bottom:1px solid var(--line); vertical-align:middle}
tbody tr:last-child td{border-bottom:0}
tbody tr{transition:background .12s ease}
tbody tr:hover td{background:var(--surface-2)}
td.id{font-family:var(--mono); font-size:12.5px; cursor:pointer}
td.id:hover{color:var(--accent)}
tr.locked td.id{color:var(--text-faint)}
.tag{display:inline-block; padding:2px 8px; font-size:11px; border:1px solid var(--line-strong); color:var(--text-dim); white-space:nowrap}
.tag.yes{border-color:rgba(21,128,61,.45); color:var(--ok)}
.tag.no{border-color:rgba(180,83,9,.4); color:var(--warn)}
.dim{color:var(--text-faint)}
.price{font-family:var(--mono); font-size:12px; color:var(--text-dim); white-space:nowrap}

pre.out{margin:14px 0 0; padding:13px; min-height:120px; max-height:460px; overflow:auto;
  background:#fbfbfc; border:1px solid var(--line); font-family:var(--mono); font-size:12.5px;
  line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere}
pre.out .think{color:var(--text-faint)}
.empty{padding:40px 16px; text-align:center; color:var(--text-faint); font-size:13px}
.hide{display:none !important}
.skel{color:var(--text-faint)}

@media (prefers-reduced-motion: reduce){
  *{animation:none !important; transition:none !important}
}
@media (max-width:820px){
  body{flex-direction:column}
  .sidebar{width:auto; height:auto; position:static; padding:14px 12px 10px}
  .brand{padding-bottom:12px}
  .nav{flex-direction:row; overflow-x:auto; padding:10px 0 2px; gap:2px}
  .nav button{width:auto; white-space:nowrap; border-left:0; border-bottom:2px solid transparent; padding:8px 11px}
  .nav button[aria-selected="true"]{padding-left:11px; border-bottom-color:var(--accent)}
  .side-foot{flex-direction:row; gap:14px; padding-top:10px}
  main{padding:20px 16px 56px}
}
`;

const SCRIPT = String.raw`
var state = { status:null, models:[], accessible:[], scope:'accessible', quota:null, stats:null, series:'cost', hours:24, account:null, accountSummary:null, accountQuota:[] };
var KEY = 'cmdc_gateway_client_key';
var poll = null;

function $(id){ return document.getElementById(id); }
function clientKey(){ return localStorage.getItem(KEY) || ''; }
function esc(v){ return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function api(path, options){
  options = options || {};
  var headers = Object.assign({'Content-Type':'application/json'}, options.headers || {});
  var k = clientKey();
  if (k) headers['x-api-key'] = k;
  var res = await fetch(path, Object.assign({}, options, {headers:headers}));
  var text = await res.text();
  var data = null;
  try { data = text ? JSON.parse(text) : null; } catch(e){ data = {raw:text}; }
  if (!res.ok){
    if (res.status === 401){
      var gateMsg = (data && data.error && data.error.message) || '需要访问密钥';
      showGate(gateMsg);
      throw new Error(gateMsg);
    }
    var m = (data && data.error && data.error.message) || (data && data.type === 'error' && data.error && data.error.message) || ('HTTP ' + res.status);
    throw new Error(m);
  }
  return data;
}

function showGate(message){
  $('gate').className = 'gate';
  if (message) say('gate-msg', message, 'err'); else hush('gate-msg');
  try { $('gate-input').focus(); } catch(e){}
}

function hideGate(){ $('gate').className = 'gate hide'; }

function maskKey(key){
  if (!key) return '-';
  return key.length > 14 ? key.slice(0, 8) + '...' + key.slice(-4) : key;
}

function submitGate(){
  var value = $('gate-input').value.trim();
  if (!value){ say('gate-msg', '请输入 access key', 'err'); return; }
  localStorage.setItem(KEY, value);
  $('gate-input').value = '';
  hideGate();
  live.stopped = false;
  refreshAll();
  restartLive();
}

function say(id, text, kind){ var el = $(id); el.textContent = text; el.className = 'msg show ' + (kind || 'info'); }
function hush(id){ $(id).className = 'msg'; }
function num(n){ return typeof n === 'number' ? n.toLocaleString('en-US') : '-'; }
function money(n){ return typeof n === 'number' ? '$' + n.toFixed(n < 1 ? 3 : 2) : '-'; }
function moneyAt(n, digits){ return typeof n === 'number' ? '$' + n.toFixed(digits) : '-'; }
function moneySide(used, cap){
  var digits = used > 0 && used < 0.01 ? 4 : 2;
  return moneyAt(used, digits) + ' / ' + moneyAt(cap, 2);
}
function pct(n){ return typeof n === 'number' ? (n * 100).toFixed(1) + '%' : '-'; }
function ms(n){ return typeof n === 'number' ? Math.round(n) + ' ms' : '-'; }
function tokens(n){
  if (typeof n !== 'number') return '-';
  if (n >= 1e9) return (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return String(n);
}
function clock(msValue){
  if (!msValue) return '-';
  var d = new Date(msValue);
  return d.toLocaleString('zh-CN', {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
}
function priceCell(price){
  if (!price || typeof price.input !== 'number') return '<span class="dim">-</span>';
  var parts = [price.input, price.output].map(function(v){ return typeof v === 'number' ? v : 0; });
  var cache = typeof price.cacheRead === 'number' ? price.cacheRead : 0;
  return '<span class="price">' + parts[0] + ' / ' + parts[1] + ' / ' + cache + '</span>';
}

function showTab(name){
  var tabs = document.querySelectorAll('#nav button');
  for (var i=0;i<tabs.length;i++) tabs[i].setAttribute('aria-selected', String(tabs[i].getAttribute('data-tab') === name));
  var views = document.querySelectorAll('.view');
  for (var j=0;j<views.length;j++) views[j].className = 'view';
  $('view-' + name).className = 'view on';
}

function paintStatus(){
  var s = state.status; if (!s) return;
  var authed = s.auth && s.auth.hasKey;
  $('health-dot').className = 'dot ' + (authed ? 'ok' : 'bad');
  $('health-text').textContent = authed ? '已连接' : '未登录';
  $('side-plan').textContent = s.plan && s.plan.planName ? ('套餐 ' + s.plan.planName) : '套餐未知';

  $('ov-backend').textContent = s.baseUrl + ' (' + s.apiEnv + ')';
  $('ov-listen').textContent = s.host + ':' + s.port;
  $('ov-port').textContent = s.fixedPort
    ? (s.portPinned ? String(s.fixedPort) + ' 已固定' : String(s.fixedPort) + ' 已固定（本次临时用 ' + s.port + '）')
    : '-';
  $('ov-config').textContent = s.configFile || '-';
  $('ov-lan').textContent = (s.lanUrls && s.lanUrls.length)
    ? s.lanUrls.map(function(u){ return u + '/v1'; }).join('   ')
    : '未开放，仅本机可用';
  $('ov-accesskey').textContent = maskKey(s.accessKey);
  setAccessKeyNote(s);
  $('ov-cli').textContent = s.cliVersion;
  $('ov-models').textContent = s.models.filterApplied ? s.models.accessible + ' / ' + s.models.total : String(s.models.total);
  $('ov-mode').textContent = s.mode + ' / ' + s.permissionMode;
  $('ov-reasoning').textContent = s.reasoningEffort
    ? (s.reasoningEffort + '（网关默认，客户端未指定时生效）')
    : '未设置（客户端没说就用上游默认）';
  $('ov-cwd').textContent = s.cwd;
  $('ov-store').textContent = s.storeFile;
  var fp = s.fingerprint;
  $('ov-fp').textContent = !fp ? '未运行' : fp.recorded ? ('已上报 HTTP ' + fp.status) : ('未上报 ' + (fp.reason || ''));

  var a = s.auth || {};
  var acc = s.accounts || {};
  $('btn-logout').disabled = !acc.count || acc.readonly;
  $('side-accounts').textContent = '账号 ' + (acc.count || 0) +
    (acc.invalidCount ? ' · ' + acc.invalidCount + ' 失效' : '') +
    (acc.coolingCount ? ' · ' + acc.coolingCount + ' 冷却' : '');
  renderAccounts(s.accounts);
  renderScope(s.accounts);
}

function winCell(w){
  if (!w) return '<span class="dim">不限</span>';
  var ratio = w.cap > 0 ? Math.min(100, (w.used / w.cap) * 100) : 0;
  var cls = w.exceeded ? 'over' : (ratio > 75 ? 'warn' : '');
  return '<div class="acc-quota">' + moneySide(w.used, w.cap) + '</div>' +
    '<div class="mini-bar ' + cls + '"><i style="width:' + ratio.toFixed(1) + '%"></i></div>' +
    '<div class="win-reset">重置 ' + clock(w.resetAt) + '</div>';
}

function accountStateTag(a, q){
  if (a.invalid) return '<span class="tag bad" title="' + esc(a.invalidReason || '') + '">Key 已失效</span>';
  if (a.coolingUntil) return '<span class="tag cool">冷却至 ' + new Date(a.coolingUntil).toLocaleTimeString('zh-CN', {hour12:false}) + '</span>';
  if (q && q.partial) return '<span class="tag warn">部分数据缺失</span>';
  if (q && q.error) return '<span class="tag no">额度查询失败</span>';
  return '<span class="tag yes">正常</span>';
}

function renderAccounts(summary){
  if (!summary) return;
  state.accountSummary = summary;
  var list = summary.accounts || [];
  var byId = {};
  for (var x=0;x<state.accountQuota.length;x++){
    var row = state.accountQuota[x];
    if (row && row.id) byId[row.id] = row.quota || null;
  }

  if (list.length === 0){
    $('acc-list').innerHTML = '<tr><td colspan="7"><div class="empty">还没有账号，用下面的表单添加</div></td></tr>';
  } else {
    var html = '';
    for (var i=0;i<list.length;i++){
      var a = list[i];
      var q = a.quota || byId[a.id] || null;
      var c = q && q.credits ? q.credits : null;
      var tags = '';
      if (a.active) tags += ' <span class="tag active">当前</span>';
      if (a.lastServed && !a.active) tags += ' <span class="tag">上次服务</span>';
      if (a.explicit) tags += ' <span class="tag">来自环境变量</span>';
      html += '<tr>' +
        '<td><div class="acc-name">' + esc(a.userName) + tags + '</div>' +
          '<div class="acc-sub mono">' + esc(a.maskedKey) + ' · ' + esc(a.keyName || '-') + '</div></td>' +
        '<td>' + accountStateTag(a, q) + '</td>' +
        '<td class="dim">' + esc((q && q.planName) || '-') + '</td>' +
        '<td class="num">' + (c ? money(c.monthly) + ' / ' + money(c.purchased) + ' / ' + money(c.free) : '-') + '</td>' +
        '<td>' + (q ? winCell(q.windows && q.windows.fiveHour) : '<span class="dim">-</span>') + '</td>' +
        '<td>' + (q ? winCell(q.windows && q.windows.weekly) : '<span class="dim">-</span>') + '</td>' +
        '<td><div class="acc-actions">' +
          (a.active ? '' : '<button class="btn" data-act="active" data-id="' + esc(a.id) + '">设为当前</button>') +
          '<button class="btn" data-act="verify" data-id="' + esc(a.id) + '">重新校验</button>' +
          (a.coolingUntil || a.invalid ? '<button class="btn" data-act="reset" data-id="' + esc(a.id) + '">清除冷却</button>' : '') +
          (a.explicit ? '' : '<button class="btn danger" data-act="del" data-id="' + esc(a.id) + '">删除</button>') +
        '</div></td></tr>';
    }
    $('acc-list').innerHTML = html;
  }

  var buttons = document.querySelectorAll('#acc-list button');
  for (var j=0;j<buttons.length;j++){
    buttons[j].onclick = function(){
      var act = this.getAttribute('data-act');
      var id = this.getAttribute('data-id');
      if (act === 'active') doSetActive(id);
      else if (act === 'verify') doVerifyAccount(id);
      else if (act === 'reset') doResetAccount(id);
      else if (act === 'del') doDeleteAccount(id);
    };
  }
  var modes = document.querySelectorAll('#mode-seg button');
  for (var k=0;k<modes.length;k++){
    modes[k].setAttribute('aria-pressed', String(modes[k].getAttribute('data-mode') === summary.mode));
  }
  if (summary.readonly){
    $('mode-hint').textContent = '当前用 --api-key / 环境变量提供 Key：账号管理已关闭，改动不会落盘。去掉该参数并改用面板登录才能使用多账号。';
    return;
  }
  $('mode-hint').textContent = summary.count > 1
    ? '共 ' + summary.count + ' 个账号。' +
      (summary.mode === 'sequential'
        ? '用完一个再换下一个：额度耗尽的账号会一直冷却到额度窗口重置。'
        : '遇 429 自动换：一直用当前账号，额度不足或限流才切到下一个，冷却默认 5 分钟。') +
      ' 仪表盘当前看：' + (summary.dashboard === 'all' ? '全部合计' : '单个账号') + '。'
    : '单账号模式：账号轮换需要 2 个以上账号才会生效。';
}

function renderScope(summary){
  var box = $('side-scope-box');
  if (!summary || !summary.multi){
    box.className = 'side-scope hide';
    if (!state.account || state.account !== 'all') state.account = 'all';
    return;
  }
  box.className = 'side-scope';
  var known = false;
  for (var i=0;i<summary.accounts.length;i++) if (summary.accounts[i].id === state.account) known = true;
  if (!state.account || (state.account !== 'all' && !known)) state.account = summary.dashboard || 'all';
  var sel = $('side-scope');
  var html = '<option value="all">全部（合计）</option>';
  for (var j=0;j<summary.accounts.length;j++){
    var a = summary.accounts[j];
    html += '<option value="' + esc(a.id) + '">' + esc(a.userName) + (a.active ? ' · 当前' : '') + '</option>';
  }
  sel.innerHTML = html;
  sel.value = state.account;
}

function paintModels(){
  var q = ($('model-filter').value || '').trim().toLowerCase();
  var rows = state.models.filter(function(m){
    if (!q) return true;
    return m.id.toLowerCase().indexOf(q) >= 0 || (m.name || '').toLowerCase().indexOf(q) >= 0;
  });
  var html = '';
  for (var i=0;i<rows.length;i++){
    var m = rows[i];
    var efforts = (m.reasoningEfforts && m.reasoningEfforts.length) ? m.reasoningEfforts.join(', ') : '-';
    var access = m.accessible ? '<span class="tag yes">可用</span>' : '<span class="tag no">需 ' + (m.minimumPlanName || '更高') + '</span>';
    html += '<tr class="' + (m.accessible ? '' : 'locked') + '">' +
      '<td class="id" data-id="' + m.id + '">' + m.id + '<div class="dim" style="font-family:var(--sans);font-size:11.5px">' + esc(m.name || '') + '</div></td>' +
      '<td class="num">' + (m.contextWindow ? num(m.contextWindow) : '-') + '</td>' +
      '<td class="dim">' + efforts + '</td>' +
      '<td>' + priceCell(m.cost) + '</td>' +
      '<td>' + access + '</td></tr>';
  }
  $('models-body').innerHTML = html || '<tr><td colspan="5"><div class="empty">没有匹配的模型</div></td></tr>';
  $('models-count').textContent = rows.length + ' / ' + state.models.length;
  var cells = document.querySelectorAll('#models-body td.id');
  for (var j=0;j<cells.length;j++){
    cells[j].onclick = function(){
      var id = this.getAttribute('data-id');
      if (navigator.clipboard) navigator.clipboard.writeText(id);
      say('models-msg', '已复制 ' + id, 'ok');
    };
  }
}

function paintQuota(){
  var q = state.quota; if (!q) return;
  $('q-plan').textContent = q.planName || '-';
  $('q-monthly').textContent = money(q.credits.monthly);
  $('q-purchased').textContent = money(q.credits.purchased);
  $('q-free').textContent = money(q.credits.free);
  $('q-requests').textContent = num(q.usage.requests);
  $('q-tokens-in').textContent = tokens(q.usage.tokensIn);
  $('q-tokens-out').textContent = tokens(q.usage.tokensOut);
  $('q-cost').textContent = money(q.usage.cost);
  var p = q.period;
  $('q-period').textContent = p && p.start
    ? new Date(p.start).toLocaleDateString('zh-CN') + ' 至 ' + new Date(p.end).toLocaleDateString('zh-CN') + '   ' + (p.status || '')
    : '-';

  var windows = [['fiveHour','5 小时窗口','q-fh'], ['weekly','每周窗口','q-wk']];
  for (var i=0;i<windows.length;i++){
    var w = q.windows[windows[i][0]];
    var host = $(windows[i][2]);
    if (!w){ host.innerHTML = '<div class="quota-top"><span class="label">' + windows[i][1] + '</span><span class="val">不限</span></div>'; continue; }
    var ratio = w.cap > 0 ? Math.min(100, (w.used / w.cap) * 100) : 0;
    var cls = w.exceeded ? 'over' : (ratio > 75 ? 'warn' : '');
    host.innerHTML = '<div class="quota-top"><span class="label">' + windows[i][1] + '</span><span class="val">' + moneySide(w.used, w.cap) + '</span></div>' +
      '<div class="bar ' + cls + '"><i style="width:' + ratio.toFixed(1) + '%"></i></div>' +
      '<div class="help">重置于 ' + clock(w.resetAt) + '</div>';
  }
  paintSideWindows();
  paintQuotaParts();
  if (q.error) say('quota-msg', (q.partial ? '部分账号额度获取失败：' : '额度获取失败：') + q.error +
    (q.authError ? '（该账号的 Key 可能已失效，去「账号」页重新校验）' : ''), 'err');
  else if (q.stale) say('quota-msg', '显示的是上次成功获取的数据', 'info');
  else if (q.periodMixed) say('quota-msg', '各账号计费周期不同，已隐藏周期一栏', 'info');
  else hush('quota-msg');
}

function paintQuotaParts(){
  var q = state.quota;
  var parts = q && q.parts ? q.parts : null;
  var body = $('quota-parts-body');
  if (!parts || parts.length === 0){
    body.innerHTML = '<tr><td colspan="8"><div class="empty">单账号模式：上方数据就是这个账号的额度</div></td></tr>';
    return;
  }
  var rows = '';
  for (var i=0;i<parts.length;i++){
    var p = parts[i];
    var c = p.credits || {};
    var status = p.error
      ? '<span class="tag no" title="' + esc(p.error) + '">' + (p.authError ? 'Key 已失效' : '查询失败') + '</span>'
      : (p.stale ? '<span class="tag cool">可能是旧数据</span>' : '<span class="tag yes">正常</span>');
    rows += '<tr><td class="id" style="cursor:default">' + esc(p.accountName) + '</td>' +
      '<td class="dim">' + esc(p.planName || '-') + '</td>' +
      '<td class="num">' + money(c.monthly) + '</td>' +
      '<td class="num">' + money(c.purchased) + '</td>' +
      '<td class="num">' + money(c.free) + '</td>' +
      '<td>' + winCell(p.windows && p.windows.fiveHour) + '</td>' +
      '<td>' + winCell(p.windows && p.windows.weekly) + '</td>' +
      '<td>' + status + '</td></tr>';
  }
  body.innerHTML = rows;
}

function setAccessKeyNote(s){
  var el = $('ov-accesskey-warn');
  if (!el) return;
  if (s.accessKeyLegacyPublic){
    el.textContent = '⚠ 这个密钥是旧版本里公开写死的默认值：仓库公开后它等于公开口令，任何能访问本端口的人都能消耗你的订阅额度。建议立刻换成随机值 —— 加参数启动一次即可：--client-key cmdc_你的新密钥 --save-port';
    el.className = 'msg show err';
  } else if (s.accessKeyGenerated){
    el.textContent = '首次运行时自动生成，已写入 config.json；客户端配置一次即可长期使用。想更换就加 --client-key cmdc_新密钥 --save-port。';
    el.className = 'msg show info';
  } else {
    el.className = 'msg';
  }
}

function cacheLevel(rate){
  if (typeof rate !== 'number' || !isFinite(rate)) return 'none';
  if (rate < 0.8) return 'low';
  if (rate < 0.9) return 'mid';
  return 'high';
}

function cacheClass(rate){
  var level = cacheLevel(rate);
  return level === 'none' ? '' : 'cache-' + level;
}

function windowLabel(hours){ return hours === 168 ? '7 天' : hours + ' 小时'; }

/** Drives the cache dial: the needle angle and the drawn arc both come from the same rate. */
function paintGauge(hostId, rate){
  var host = $(hostId);
  if (!host) return;
  host.setAttribute('data-level', cacheLevel(rate));
  var t = (typeof rate === 'number' && isFinite(rate)) ? Math.min(1, Math.max(0, rate)) : 0;
  var needle = host.querySelector('.needle');
  if (needle) needle.setAttribute('transform', 'rotate(' + (150 + 240 * t - 270).toFixed(2) + ' 100 96)');
  var arc = host.querySelector('.arc');
  if (arc) {
    var len = Number(arc.getAttribute('data-len')) || 0;
    arc.setAttribute('stroke-dashoffset', (len * (1 - t)).toFixed(2));
  }
}

function paintCacheRate(){
  var t = state.stats && state.stats.totals;
  var rate = t ? t.cacheHitRate : null;
  paintGauge('cache-rate', rate);
  $('cache-rate-value').textContent = typeof rate === 'number' ? (rate * 100).toFixed(1) + '%' : '-';
  $('cache-rate-sub').textContent = t && t.requests
    ? t.requests + ' 次请求 / ' + windowLabel(state.hours)
    : '窗口内暂无请求';
}

function paintSideWindows(){
  var pairs = [['fiveHour', 'side-fh'], ['weekly', 'side-wk']];
  for (var i=0;i<pairs.length;i++){
    var w = state.quota && state.quota.windows ? state.quota.windows[pairs[i][0]] : null;
    var host = $(pairs[i][1]);
    var value = host.querySelector('.val');
    var bar = host.querySelector('.bar');
    var fill = host.querySelector('.bar > i');
    if (!w){
      value.textContent = state.quota ? '不限' : '-';
      fill.style.width = '0%';
      bar.className = 'bar';
      continue;
    }
    var ratio = w.cap > 0 ? Math.min(100, (w.used / w.cap) * 100) : 0;
    value.textContent = moneySide(w.used, w.cap);
    fill.style.width = ratio.toFixed(1) + '%';
    bar.className = 'bar' + (w.exceeded ? ' over' : (ratio > 75 ? ' warn' : ''));
  }
}

var chartKey = '';

function paintChart(){
  var s = state.stats; if (!s) return;
  var metric = state.series;
  var values = s.series.map(function(b){ return metric === 'cost' ? b.cost : (b.promptTokens + b.completionTokens); });

  var key = metric + '|' + s.windowHours + '|' + values.length;
  var anim = key !== chartKey ? ' anim' : '';
  chartKey = key;

  var host = $('chart');
  var width = Math.max(240, host.clientWidth || 640);
  var height = 190;
  var top = 16;
  var bottom = 26;
  var max = 0;
  for (var i=0;i<values.length;i++) if (values[i] > max) max = values[i];

  if (max <= 0){
    host.innerHTML = '<div class="empty">窗口内还没有经过本网关的请求</div>';
  } else {
    var n = values.length;
    var stepX = n > 1 ? (width - 2) / (n - 1) : 0;
    var baseY = height - bottom;
    var line = '';
    var pts = [];
    for (var j=0;j<n;j++){
      var x = 1 + j * stepX;
      var y = top + (1 - values[j] / max) * (height - top - bottom);
      pts.push([x, y]);
      line += (j ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    var area = line + ' L' + pts[n-1][0].toFixed(1) + ' ' + baseY + ' L' + pts[0][0].toFixed(1) + ' ' + baseY + ' Z';
    host.innerHTML = '<svg class="chart" width="100%" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" role="img" aria-label="消耗曲线">' +
      '<line class="chart-base" x1="0" y1="' + baseY + '" x2="' + width + '" y2="' + baseY + '"></line>' +
      '<path class="chart-area' + anim + '" d="' + area + '"></path>' +
      '<path class="chart-line' + anim + '" d="' + line + '"></path>' +
    '</svg>';
  }

  $('chart-from').textContent = new Date(s.series[0].t).toLocaleString('zh-CN', {month:'2-digit', day:'2-digit', hour:'2-digit'});
  $('chart-to').textContent = new Date(s.generatedAt).toLocaleString('zh-CN', {month:'2-digit', day:'2-digit', hour:'2-digit'});
  $('chart-peak').textContent = '峰值 ' + (metric === 'cost' ? money(max) : tokens(max));
  $('chart-label').textContent = metric === 'cost' ? '花费 (USD)' : 'tokens';
}

function paintStats(){
  var s = state.stats; if (!s) return;
  var t = s.totals;
  $('st-cache').textContent = pct(t.cacheHitRate);
  $('st-cache-sub').textContent = tokens(t.cachedTokens) + ' / ' + tokens(t.promptTokens) + ' tokens 命中';
  $('st-ttft').textContent = t.avgTtftMs === null ? '-' : ms(t.avgTtftMs);
  $('st-ttft-sub').textContent = t.measuredTtft ? (t.measuredTtft + ' 次流式请求') : '暂无流式样本';
  $('st-duration').textContent = t.avgDurationMs === null ? '-' : ms(t.avgDurationMs);
  $('st-duration-sub').textContent = t.requests + ' 次请求，失败 ' + t.failed;
  $('st-cost').textContent = money(t.cost);
  $('st-cost-sub').textContent = '按 models.json 价格估算';
  $('st-tokens').textContent = tokens(t.totalTokens);
  $('st-tokens-sub').textContent = '入 ' + tokens(t.promptTokens) + ' / 出 ' + tokens(t.completionTokens);
  $('st-reasoning').textContent = pct(t.reasoningShare);
  $('st-reasoning-sub').textContent = '推理 ' + tokens(t.reasoningTokens) + ' / 正文 ' + tokens(t.textTokens) + ' tokens';
  $('st-success').textContent = t.requests ? pct(t.ok / t.requests) : '-';
  $('st-success-sub').textContent = '窗口 ' + windowLabel(s.windowHours);

  paintChart();
  paintCacheRate();

  var rows = '';
  for (var j=0;j<s.models.length;j++){
    var m = s.models[j];
    rows += '<tr><td class="id">' + m.model + '</td>' +
      '<td class="num">' + m.requests + (m.failed ? ' <span class="dim">(' + m.failed + ' 失败)</span>' : '') + '</td>' +
      '<td class="num ' + cacheClass(m.cacheHitRate) + '">' + pct(m.cacheHitRate) + '</td>' +
      '<td class="num">' + (m.avgTtftMs === null ? '-' : ms(m.avgTtftMs)) + '</td>' +
      '<td class="num">' + tokens(m.promptTokens + m.completionTokens) + '</td>' +
      '<td class="num">' + pct(m.reasoningShare) + '</td>' +
      '<td>' + priceCell(m.price) + '</td>' +
      '<td class="num">' + money(m.cost) + '</td></tr>';
  }
  $('stats-body').innerHTML = rows || '<tr><td colspan="8"><div class="empty">窗口内还没有经过本网关的请求</div></td></tr>';

  var scopeLabel = s.accountId === 'all' ? '（全部账号合计）' : '（单个账号）';
  $('stats-scope').textContent = scopeLabel;

  var acctRows = '';
  var accounts = s.accounts || [];
  for (var x=0;x<accounts.length;x++){
    var acc = accounts[x];
    acctRows += '<tr><td class="id">' + esc(acc.accountName) + (acc.scoped ? ' <span class="tag active">当前范围</span>' : '') + '</td>' +
      '<td class="num">' + acc.requests + (acc.failed ? ' <span class="dim">(' + acc.failed + ' 失败)</span>' : '') + '</td>' +
      '<td class="num ' + cacheClass(acc.cacheHitRate) + '">' + pct(acc.cacheHitRate) + '</td>' +
      '<td class="num">' + (acc.avgTtftMs === null ? '-' : ms(acc.avgTtftMs)) + '</td>' +
      '<td class="num">' + tokens(acc.promptTokens + acc.completionTokens) + '</td>' +
      '<td class="num">' + money(acc.cost) + '</td></tr>';
  }
  $('acct-stats-body').innerHTML = acctRows || '<tr><td colspan="6"><div class="empty">窗口内还没有经过本网关的请求</div></td></tr>';
}

var live = { on:false, feed:[], ctrl:null, retry:0, stopped:false, restarting:false, everConnected:false };

function paintLive(){
  $('live-chip').setAttribute('data-on', live.on ? '1' : '0');
  $('live-text').textContent = live.on ? '实时已连接' : (live.stopped ? '实时已停用' : '实时重连中');
}

function reasoningCell(r){
  if (typeof r.reasoningTokens === 'number' && r.reasoningTokens > 0) return tokens(r.reasoningTokens);
  if (typeof r.reasoningChars === 'number' && r.reasoningChars > 0) return tokens(r.reasoningChars) + '<span class="dim">字</span>';
  return '<span class="dim">-</span>';
}

/** A compact inline bar so the feed can be compared at a glance without reading every number. */
function miniBar(ratio, cls){
  if (typeof ratio !== 'number' || !isFinite(ratio)) return '';
  var width = Math.max(0, Math.min(1, ratio)) * 100;
  return '<div class="mini"><i class="' + (cls || '') + '" style="width:' + width.toFixed(1) + '%"></i></div>';
}

function paintFeed(){
  // the first-token bar is scaled against the slowest request currently listed, so it stays
  // readable whatever this workload's absolute latency happens to be
  var slowest = 0;
  for (var j=0;j<live.feed.length;j++){
    var ttft = live.feed[j].ttftMs;
    if (typeof ttft === 'number' && ttft > slowest) slowest = ttft;
  }
  var rows = '';
  for (var i=0;i<live.feed.length;i++){
    var r = live.feed[i];
    var cacheRate = r.promptTokens ? r.cachedTokens / r.promptTokens : null;
    var level = cacheLevel(cacheRate);
    rows += '<tr' + (i === 0 ? ' class="fresh"' : '') + '>' +
      '<td class="num dim">' + new Date(r.t).toLocaleTimeString('zh-CN', {hour12:false}) + '</td>' +
      '<td class="id">' + esc(r.model) + '</td>' +
      '<td class="dim">' + (r.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI') + (r.stream ? ' / 流式' : ' / 单次') + '</td>' +
      '<td class="num">' + ms(r.ttftMs) + miniBar(slowest && typeof r.ttftMs === 'number' ? r.ttftMs / slowest : null, 'speed') + '</td>' +
      '<td class="num">' + ms(r.durationMs) + '</td>' +
      '<td class="num ' + cacheClass(cacheRate) + '">' + pct(cacheRate) + miniBar(cacheRate, level === 'none' ? '' : level) + '</td>' +
      '<td class="num">' + reasoningCell(r) + '</td>' +
      '<td class="num">' + ((r.promptTokens || 0) + (r.completionTokens || 0)) + '</td>' +
      '<td class="num">' + money(r.cost) + (r.ok ? '' : ' <span class="tag no">失败</span>') + '</td></tr>';
  }
  $('feed-body').innerHTML = rows || '<tr><td colspan="9"><div class="feed-empty">等待请求</div></td></tr>';
}

function handleFrame(frame){
  if (!frame || frame.charAt(0) === ':') return;
  var ev = 'message', data = '';
  var lines = frame.split('\n');
  for (var i=0;i<lines.length;i++){
    if (lines[i].indexOf('event: ') === 0) ev = lines[i].slice(7).trim();
    else if (lines[i].indexOf('data: ') === 0) data += lines[i].slice(6);
  }
  if (!data) return;
  var payload;
  try { payload = JSON.parse(data); } catch(e){ return; }
  if (ev === 'request'){
    live.feed.unshift(payload);
    if (live.feed.length > 20) live.feed.pop();
    paintFeed();
  } else if (ev === 'stats'){ state.stats = payload; paintStats(); }
  else if (ev === 'status'){ state.status = payload; paintStatus(); }
  else if (ev === 'quota'){ state.quota = payload; paintQuota(); applyQuotaParts(payload); renderAccounts(state.accountSummary); }
}

/* the aggregate push already carries every account's credits and windows: reuse it
   instead of firing another request just to refresh the accounts table */
function applyQuotaParts(q){
  if (!q || !q.parts || !state.accountQuota || !state.accountQuota.length) return;
  var byId = {};
  for (var i=0;i<q.parts.length;i++) byId[q.parts[i].accountId] = q.parts[i];
  for (var j=0;j<state.accountQuota.length;j++){
    var row = state.accountQuota[j];
    if (row && byId[row.id]) row.quota = byId[row.id];
  }
}

async function connectLive(){
  if (live.stopped) return;
  live.ctrl = new AbortController();
  var headers = {};
  var k = clientKey();
  if (k) headers['x-api-key'] = k;
  try {
    var res = await fetch('/api/events?hours=' + state.hours + '&account=' + encodeURIComponent(state.account || 'all'), {headers:headers, signal:live.ctrl.signal});
    if (!res.ok){
      if (res.status === 401){
        live.stopped = true; live.on = false; paintLive();
        say('stats-msg', '实时通道鉴权失败，请刷新页面并在弹窗中填入 client key', 'err');
        return;
      }
      throw new Error('HTTP ' + res.status);
    }
    live.on = true;
    live.retry = 0;
    paintLive();
    if (live.everConnected) refreshAll(); else live.everConnected = true;

    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '';
    while (true){
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, {stream:true});
      var at = buf.indexOf('\n\n');
      while (at >= 0){
        var frame = buf.slice(0, at);
        buf = buf.slice(at + 2);
        at = buf.indexOf('\n\n');
        handleFrame(frame);
      }
    }
    throw new Error('实时通道已断开');
  } catch(e){
    if (live.stopped) return;
    live.on = false;
    paintLive();
    if (live.restarting){ live.restarting = false; connectLive(); return; }
    live.retry = Math.min(live.retry + 1, 6);
    setTimeout(connectLive, Math.round(400 * Math.pow(1.7, live.retry)));
  }
}

function restartLive(){
  live.restarting = true;
  live.retry = 0;
  if (live.ctrl) live.ctrl.abort();
  else connectLive();
}

async function loadStatus(){ state.status = await api('/api/status'); paintStatus(); }

function paintModelSelect(){
  var list = state.accessible && state.accessible.length ? state.accessible : state.models;
  var sel = $('pg-model');
  var current = sel.value;
  var options = '';
  for (var i=0;i<list.length;i++) options += '<option value="' + list[i].id + '">' + list[i].id + '</option>';
  sel.innerHTML = options || '<option value="">没有可用模型</option>';
  if (current){
    for (var j=0;j<list.length;j++){
      if (list[j].id === current){ sel.value = current; break; }
    }
  }
}

async function loadModels(){
  var data = await api('/api/models?scope=' + state.scope);
  state.models = data.models || [];
  state.accessible = state.scope === 'accessible' ? state.models : ((await api('/api/models?scope=accessible')).models || []);
  $('scope-accessible').setAttribute('aria-pressed', String(state.scope === 'accessible'));
  $('scope-all').setAttribute('aria-pressed', String(state.scope === 'all'));
  if (data.planError) say('models-msg', '套餐信息获取失败，已展示全部：' + data.planError, 'err'); else hush('models-msg');
  paintModels();
  paintModelSelect();
}

async function loadAccountQuota(){
  var data = await api('/api/accounts/quota');
  state.accountQuota = data.accounts || [];
  renderAccounts(data);
}

async function loadQuota(){
  var data = await api('/api/quota?account=' + encodeURIComponent(state.account || 'all'));
  state.quota = data.quota;
  paintQuota();
}
async function loadStats(){
  var data = await api('/api/stats?hours=' + state.hours + '&account=' + encodeURIComponent(state.account || 'all'));
  state.stats = data.stats;
  if (live.feed.length === 0 && data.stats.recent) live.feed = data.stats.recent.slice(0, 20);
  paintStats();
  paintFeed();
}

async function refreshAll(){
  try {
    await loadStatus();
    await Promise.all([loadModels(), loadQuota(), loadStats(), loadAccountQuota()]);
  } catch(e){
    say('login-msg', '刷新失败：' + e.message, 'err');
  }
}

async function setScope(scope){
  state.scope = scope;
  try { await loadModels(); } catch(e){ say('models-msg', e.message, 'err'); }
}

async function setSeries(kind){
  state.series = kind;
  $('chart-cost').setAttribute('aria-pressed', String(kind === 'cost'));
  $('chart-tokens').setAttribute('aria-pressed', String(kind === 'tokens'));
  paintStats();
}

async function setHours(hours){
  state.hours = hours;
  var nodes = document.querySelectorAll('#range-seg button');
  for (var i=0;i<nodes.length;i++) nodes[i].setAttribute('aria-pressed', String(Number(nodes[i].getAttribute('data-hours')) === hours));
  try { await loadStats(); } catch(e){ say('stats-msg', e.message, 'err'); }
  restartLive();
}

async function setDashScope(scope){
  state.account = scope;
  try {
    await api('/api/accounts/scope', {method:'POST', body: JSON.stringify({scope: scope})});
  } catch(e){
    say('login-msg', '保存统计范围失败：' + e.message, 'err');
  }
  await Promise.all([loadQuota(), loadStats()]);
  restartLive();
}

async function doSetActive(id){
  try {
    var out = await api('/api/accounts/active', {method:'POST', body: JSON.stringify({id: id})});
    if (out && out.warning) say('login-msg', out.warning, 'err');
    else say('login-msg', '已设为当前账号：之后的新请求会优先打到它（看这行有没有出现「上次服务」标签就能确认）', 'ok');
    await refreshAll();
    restartLive();
  } catch(e){ say('login-msg', '切换账号失败：' + e.message, 'err'); }
}

async function doVerifyAccount(id){
  say('login-msg', '正在用该 Key 请求 /alpha/whoami 校验…', 'info');
  try {
    var out = await api('/api/accounts/' + encodeURIComponent(id) + '/verify', {method:'POST'});
    if (out.valid) say('login-msg', '校验通过，该账号已恢复可用', 'ok');
    else say('login-msg', '校验失败：' + (out.error || '未知原因'), 'err');
    await refreshAll();
    restartLive();
  } catch(e){ say('login-msg', '校验请求失败：' + e.message, 'err'); }
}

async function doResetAccount(id){
  try {
    await api('/api/accounts/' + encodeURIComponent(id) + '/reset', {method:'POST'});
    say('login-msg', '已清除该账号的冷却与失效标记', 'ok');
    await refreshAll();
    restartLive();
  } catch(e){ say('login-msg', '清除失败：' + e.message, 'err'); }
}

async function doDeleteAccount(id){
  if (!window.confirm('删除这个账号？')) return;
  try {
    await api('/api/accounts/' + encodeURIComponent(id), {method:'DELETE'});
    await refreshAll();
    restartLive();
  } catch(e){ say('login-msg', '删除失败：' + e.message, 'err'); }
}

async function doSetMode(mode){
  try {
    await api('/api/accounts/mode', {method:'POST', body: JSON.stringify({mode: mode})});
    say('login-msg', mode === 'sequential' ? '已切换为：用完一个再换下一个' : '已切换为：遇 429 自动切换', 'ok');
    await refreshAll();
  } catch(e){ say('login-msg', '切换模式失败：' + e.message, 'err'); }
}

async function doApiKeyLogin(){
  var key = $('key-input').value.trim();
  if (!key){ say('login-msg', '请输入 API Key', 'err'); return; }
  $('btn-key').disabled = true;
  try {
    var out = await api('/api/auth/apikey', {method:'POST', body: JSON.stringify({apiKey:key})});
    var count = out.accounts ? out.accounts.count : null;
    say('login-msg', (out.created ? '已添加账号 ' : '已更新账号 ') + (out.userName || 'unknown') + (count ? '，共 ' + count + ' 个' : ''), 'ok');
    $('key-input').value = '';
    state.scope = 'accessible';
    await refreshAll();
    restartLive();
  } catch(e){
    say('login-msg', '登录失败：' + e.message, 'err');
  } finally { $('btn-key').disabled = false; }
}

async function doBrowserLogin(){
  hush('login-msg');
  try {
    var out = await api('/api/auth/browser/start', {method:'POST'});
    window.open(out.url, '_blank', 'noopener');
    $('browser-url').textContent = out.url;
    $('browser-box').className = '';
    say('login-msg', '已打开授权页面，请在该页面完成登录', 'info');
    if (poll) clearInterval(poll);
    var before = (state.status && state.status.auth && state.status.auth.authenticatedAt) || '';
    poll = setInterval(async function(){
      try {
        var s = await api('/api/status', {silent:true});
        var now = (s.auth && s.auth.authenticatedAt) || '';
        if (now && now !== before){
          clearInterval(poll); poll = null;
          say('login-msg', '浏览器登录成功，身份 ' + (s.auth.userName || ''), 'ok');
          state.scope = 'accessible';
          await refreshAll();
        }
      } catch(e){}
    }, 2000);
  } catch(e){ say('login-msg', '无法发起登录：' + e.message, 'err'); }
}

async function doLogout(){
  if (!window.confirm('清空本网关保存的全部账号？不会影响 cmdc 命令行。')) return;
  try {
    await api('/api/auth/logout', {method:'POST'});
    if (poll){ clearInterval(poll); poll = null; }
    say('login-msg', '已清空全部账号', 'ok');
    state.scope = 'accessible';
    state.account = 'all';
    await refreshAll();
    restartLive();
  } catch(e){ say('login-msg', '清空失败：' + e.message, 'err'); }
}

async function doPlanRefresh(){
  $('btn-refresh').disabled = true;
  try {
    var out = await api('/api/plan/refresh', {method:'POST'});
    say('quota-msg', '已刷新：可用 ' + out.accessible + ' / ' + out.total + ' 个模型', 'ok');
    await refreshAll();
  } catch(e){ say('quota-msg', '刷新失败：' + e.message, 'err'); }
  finally { $('btn-refresh').disabled = false; }
}

async function sendChat(){
  var model = $('pg-model').value;
  var prompt = $('pg-prompt').value.trim();
  if (!model || !prompt){ say('pg-msg', '请选择模型并输入内容', 'err'); return; }
  var system = $('pg-system').value.trim();
  var maxTokens = parseInt($('pg-maxtokens').value, 10) || 2048;
  var stream = $('pg-stream').getAttribute('aria-pressed') === 'true';
  var messages = [];
  if (system) messages.push({role:'system', content:system});
  messages.push({role:'user', content:prompt});

  $('btn-send').disabled = true;
  hush('pg-msg');
  $('pg-out').textContent = '';
  var started = Date.now();
  var text = '', reasoning = '', ttft = null;
  function paint(){
    $('pg-out').innerHTML = (reasoning ? '<span class="think">' + esc(reasoning) + '</span>\n\n' : '') + esc(text);
  }
  try {
    var headers = {'Content-Type':'application/json'};
    var k = clientKey();
    if (k) headers['x-api-key'] = k;
    var res = await fetch('/v1/chat/completions', {
      method:'POST', headers:headers,
      body: JSON.stringify({model:model, messages:messages, max_tokens:maxTokens, stream:stream})
    });
    if (!res.ok){
      var raw = await res.text();
      var parsed = null;
      try { parsed = JSON.parse(raw); } catch(e){}
      throw new Error((parsed && parsed.error && parsed.error.message) || raw.slice(0, 300));
    }
    if (!stream){
      var data = await res.json();
      var msg = data.choices[0].message;
      reasoning = msg.reasoning_content || '';
      text = msg.content || '';
      paint();
      say('pg-msg', '完成，finish=' + data.choices[0].finish_reason + '，耗时 ' + (Date.now() - started) + ' ms', 'ok');
      loadStats().catch(function(){});
      return;
    }
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '', finish = null, usage = null;
    while (true){
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, {stream:true});
      var at = buf.indexOf('\n\n');
      while (at >= 0){
        var line = buf.slice(0, at);
        buf = buf.slice(at + 2);
        at = buf.indexOf('\n\n');
        if (line.indexOf('data: ') !== 0) continue;
        var payload = line.slice(6);
        if (payload === '[DONE]') continue;
        var json = null;
        try { json = JSON.parse(payload); } catch(e){ continue; }
        if (ttft === null) ttft = Date.now() - started;
        var c = json.choices && json.choices[0];
        if (c && c.delta){
          if (c.delta.reasoning_content) reasoning += c.delta.reasoning_content;
          if (c.delta.content) text += c.delta.content;
        }
        if (c && c.finish_reason) finish = c.finish_reason;
        if (json.usage) usage = json.usage;
        paint();
      }
    }
    var meta = '完成，finish=' + finish + '，首字 ' + (ttft === null ? '-' : ttft + ' ms') + '，总耗时 ' + (Date.now() - started) + ' ms';
    if (usage) meta += '，tokens ' + usage.prompt_tokens + ' / ' + usage.completion_tokens;
    say('pg-msg', meta, 'ok');
    loadStats().catch(function(){});
  } catch(e){
    say('pg-msg', '请求失败：' + e.message, 'err');
  } finally { $('btn-send').disabled = false; }
}

function init(){
  var tabs = document.querySelectorAll('#nav button');
  for (var i=0;i<tabs.length;i++) tabs[i].onclick = function(){ showTab(this.getAttribute('data-tab')); };
  $('btn-key').onclick = doApiKeyLogin;
  $('btn-browser').onclick = doBrowserLogin;
  $('btn-logout').onclick = doLogout;
  $('side-scope').onchange = function(){ setDashScope(this.value); };
  $('gate-btn').onclick = submitGate;
  $('gate-input').addEventListener('keydown', function(e){ if (e.key === 'Enter') submitGate(); });
  $('btn-copy-key').onclick = function(){
    var key = state.status && state.status.accessKey;
    if (!key){ say('gate-msg', '暂时读不到密钥', 'err'); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(key);
    this.textContent = '已复制';
    var button = this;
    setTimeout(function(){ button.textContent = '复制'; }, 1500);
  };
  var modeButtons = document.querySelectorAll('#mode-seg button');
  for (var m=0;m<modeButtons.length;m++){
    modeButtons[m].onclick = function(){ doSetMode(this.getAttribute('data-mode')); };
  }
  $('btn-refresh').onclick = doPlanRefresh;
  $('btn-stats-refresh').onclick = function(){ loadStats().catch(function(e){ say('stats-msg', e.message, 'err'); }); };
  $('btn-send').onclick = sendChat;
  $('model-filter').oninput = paintModels;
  $('scope-accessible').onclick = function(){ setScope('accessible'); };
  $('scope-all').onclick = function(){ setScope('all'); };
  $('chart-cost').onclick = function(){ setSeries('cost'); };
  $('chart-tokens').onclick = function(){ setSeries('tokens'); };
  var ranges = document.querySelectorAll('#range-seg button');
  for (var r=0;r<ranges.length;r++) ranges[r].onclick = function(){ setHours(Number(this.getAttribute('data-hours'))); };
  $('pg-stream').onclick = function(){ this.setAttribute('aria-pressed', String(this.getAttribute('aria-pressed') !== 'true')); };
  $('key-input').addEventListener('keydown', function(e){ if (e.key === 'Enter') doApiKeyLogin(); });
  $('pg-prompt').addEventListener('keydown', function(e){ if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendChat(); });

  var resizeTimer = null;
  window.addEventListener('resize', function(){
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function(){ paintChart(); }, 150);
  });

  refreshAll();
  connectLive();
}

document.addEventListener('DOMContentLoaded', init);
`;

const NAV = [
  ['overview', '概览'],
  ['stats', '指标'],
  ['models', '模型'],
  ['quota', '用量'],
  ['accounts', '账号'],
  ['playground', '调试台'],
];

/**
 * The sidebar cache dial, drawn like a car speedometer: a 240° sweep with minor and major
 * ticks, a needle, and the value drawn as an arc.
 *
 * All geometry is computed here so the markup stays static; the client only rotates the needle
 * and moves the arc's dash offset (see paintGauge), which is what produces the sweep. The arc
 * length travels to the client in data-len so the two can never disagree about it.
 */
function cacheGaugeMarkup() {
  const cx = 100;
  const cy = 96;
  const radius = 64;
  const start = 150;
  const sweep = 240;
  const arcLength = (radius * sweep * Math.PI) / 180;
  const round = (value) => Number(value.toFixed(2));
  const at = (angle, distance) => {
    const radians = (angle * Math.PI) / 180;
    return [cx + distance * Math.cos(radians), cy + distance * Math.sin(radians)];
  };
  const arcPath = () => {
    const [x1, y1] = at(start, radius);
    const [x2, y2] = at(start + sweep, radius);
    return `M ${round(x1)} ${round(y1)} A ${radius} ${radius} 0 1 1 ${round(x2)} ${round(y2)}`;
  };

  let ticks = '';
  for (let offset = 0; offset <= sweep; offset += 6) {
    const major = offset % 30 === 0;
    const [x1, y1] = at(start + offset, radius + 2);
    const [x2, y2] = at(start + offset, radius + (major ? 14 : 7));
    ticks += `<line class="tick${major ? ' major' : ''}" x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}"></line>`;
  }

  let labels = '';
  for (let step = 0; step <= 4; step += 1) {
    const [x, y] = at(start + (sweep * step) / 4, radius + 24);
    labels += `<text class="tick-label" x="${round(x)}" y="${round(y + 3)}">${step * 25}</text>`;
  }

  return `<svg viewBox="0 0 200 146" role="img" aria-label="缓存命中率仪表">
  <path class="track" d="${arcPath()}"></path>
  <path class="arc" d="${arcPath()}" data-len="${round(arcLength)}" stroke-dasharray="${round(arcLength)}" stroke-dashoffset="${round(arcLength)}"></path>
  ${ticks}
  ${labels}
  <line class="needle" x1="${cx}" y1="${cy + 11}" x2="${cx}" y2="${cy - radius + 8}" transform="rotate(-120 ${cx} ${cy})"></line>
  <circle class="hub" cx="${cx}" cy="${cy}" r="5"></circle>
</svg>`;
}

function navButtons() {
  return NAV.map(([id, label], index) => `<button data-tab="${id}" aria-selected="${index === 0 ? 'true' : 'false'}">${label}</button>`).join('\n    ');
}

export function panelHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>cmdc gateway</title>
<style>${STYLES}</style>
</head>
<body>
<aside class="sidebar">
  <div class="brand">
    <h1>cmdc gateway</h1>
    <p>Command Code 到 OpenAI / Anthropic</p>
  </div>
  <nav class="nav" id="nav">
    ${navButtons()}
  </nav>
  <div class="side-foot">
    <span class="chip"><span class="dot" id="health-dot"></span><span id="health-text">加载中</span></span>
    <span class="chip" id="side-plan">套餐未知</span>
    <span class="chip" id="side-accounts">账号 -</span>
    <div class="live" id="live-chip" data-on="0"><span class="dot"></span><span id="live-text">实时未连接</span></div>

    <div class="side-scope hide" id="side-scope-box">
      <label for="side-scope">统计范围</label>
      <select id="side-scope"></select>
    </div>

    <div class="cache-gauge" id="cache-rate" data-level="none">
      <div class="gauge-head"><span class="k">缓存命中率</span></div>
      ${cacheGaugeMarkup()}
      <div class="readout" id="cache-rate-value">-</div>
      <div class="s" id="cache-rate-sub">等待数据</div>
    </div>

    <div class="side-windows">
      <div class="side-window" id="side-fh">
        <div class="quota-top"><span class="label">5 小时</span><span class="val">-</span></div>
        <div class="bar"><i style="width:0%"></i></div>
      </div>
      <div class="side-window" id="side-wk">
        <div class="quota-top"><span class="label">每周</span><span class="val">-</span></div>
        <div class="bar"><i style="width:0%"></i></div>
      </div>
    </div>
  </div>
</aside>

<main>
<div class="wrap">
  <section id="view-overview" class="view on">
    <h2 class="section">运行状态</h2>
    <div class="card pad">
      <dl class="rows" style="margin:0">
        <div class="row"><dt>后端</dt><dd class="mono" id="ov-backend">-</dd></div>
        <div class="row"><dt>监听</dt><dd class="mono" id="ov-listen">-</dd></div>
        <div class="row"><dt>固定端口</dt><dd class="mono" id="ov-port">-</dd></div>
        <div class="row"><dt>局域网地址</dt><dd class="mono" id="ov-lan">-</dd></div>
        <div class="row"><dt>访问密钥</dt><dd class="mono"><span id="ov-accesskey">-</span> <button class="btn" id="btn-copy-key" style="height:22px; padding:0 9px; font-size:11px">复制</button></dd></div>
        <div class="msg" id="ov-accesskey-warn"></div>
        <div class="row"><dt>cli 版本</dt><dd class="mono" id="ov-cli">-</dd></div>
        <div class="row"><dt>可用模型</dt><dd class="mono" id="ov-models">-</dd></div>
        <div class="row"><dt>mode</dt><dd class="mono" id="ov-mode">-</dd></div>
        <div class="row"><dt>推理档位</dt><dd id="ov-reasoning">-</dd></div>
        <div class="row"><dt>工作目录</dt><dd class="mono" id="ov-cwd">-</dd></div>
        <div class="row"><dt>凭据文件</dt><dd class="mono" id="ov-store">-</dd></div>
        <div class="row"><dt>配置文件</dt><dd class="mono" id="ov-config">-</dd></div>
        <div class="row"><dt>设备指纹</dt><dd id="ov-fp">-</dd></div>
      </dl>
    </div>

    <h2 class="section">端点</h2>
    <div class="card pad">
      <dl class="rows" style="margin:0">
        <div class="row"><dt>GET</dt><dd class="mono">/health, /v1/models, /v1/models/:id</dd></div>
        <div class="row"><dt>POST</dt><dd class="mono">/v1/chat/completions</dd></div>
        <div class="row"><dt>POST</dt><dd class="mono">/v1/messages</dd></div>
        <div class="row"><dt>GET</dt><dd class="mono">/callback, /callback/complete</dd></div>
        <div class="row"><dt>API</dt><dd class="mono">/api/status, /api/models, /api/quota, /api/stats, /api/plan/refresh</dd></div>
        <div class="row"><dt>账号</dt><dd class="mono">/api/accounts, /api/accounts/quota, /api/accounts/active, /api/accounts/mode, /api/accounts/scope</dd></div>
        <div class="row"><dt>账号操作</dt><dd class="mono">POST /api/accounts/:id/verify, POST /api/accounts/:id/reset, DELETE /api/accounts/:id</dd></div>
        <div class="row"><dt>AUTH</dt><dd class="mono">/api/auth/apikey, /api/auth/browser/start, /api/auth/logout</dd></div>
      </dl>
    </div>
  </section>

  <section id="view-stats" class="view">
    <div class="head">
      <h2 class="section" style="margin:0">本网关指标 <span class="dim" style="font-weight:400; font-size:12px" id="stats-scope"></span></h2>
      <div style="display:flex; gap:10px; align-items:center">
        <div class="seg" id="range-seg">
          <button data-hours="1" aria-pressed="false">1 小时</button>
          <button data-hours="24" aria-pressed="true">24 小时</button>
          <button data-hours="168" aria-pressed="false">7 天</button>
        </div>
        <button class="btn" id="btn-stats-refresh">刷新</button>
      </div>
    </div>

    <div class="metrics">
      <div class="metric"><div class="k">缓存命中率</div><div class="v" id="st-cache">-</div><div class="s" id="st-cache-sub">-</div></div>
      <div class="metric"><div class="k">平均首字</div><div class="v" id="st-ttft">-</div><div class="s" id="st-ttft-sub">-</div></div>
      <div class="metric"><div class="k">平均耗时</div><div class="v" id="st-duration">-</div><div class="s" id="st-duration-sub">-</div></div>
      <div class="metric"><div class="k">成功率</div><div class="v" id="st-success">-</div><div class="s" id="st-success-sub">-</div></div>
      <div class="metric"><div class="k">tokens</div><div class="v" id="st-tokens">-</div><div class="s" id="st-tokens-sub">-</div></div>
      <div class="metric"><div class="k">推理占比</div><div class="v" id="st-reasoning">-</div><div class="s" id="st-reasoning-sub">-</div></div>
      <div class="metric"><div class="k">估算花费</div><div class="v" id="st-cost">-</div><div class="s" id="st-cost-sub">-</div></div>
    </div>

    <h2 class="section">消耗曲线 <span class="dim" style="font-weight:400; font-size:12px" id="chart-label"></span></h2>
    <div class="chart-box">
      <div id="chart"><div class="empty">读取中</div></div>
      <div class="chart-foot">
        <span id="chart-from">-</span>
        <span id="chart-peak">-</span>
        <span id="chart-to">-</span>
      </div>
      <div style="margin-top:12px">
        <div class="seg" id="series-seg">
          <button id="chart-cost" aria-pressed="true">花费</button>
          <button id="chart-tokens" aria-pressed="false">tokens</button>
        </div>
      </div>
    </div>

    <h2 class="section">实时活动</h2>
    <div class="table-wrap" style="max-height:330px">
      <table>
        <thead><tr><th>时间</th><th>模型</th><th>方式</th><th>首字</th><th>耗时</th><th>缓存</th><th>推理</th><th>tokens</th><th>花费</th></tr></thead>
        <tbody id="feed-body"><tr><td colspan="9"><div class="feed-empty">等待请求</div></td></tr></tbody>
      </table>
    </div>
    <div class="help">新请求由服务端实时推送，无需刷新。留空 system 时后端注入的 harness 提示词通常大量命中缓存。「推理」是模型内部思考的 token 量（上游 outputTokenDetails 的拆分），已含在 tokens 总数里，不计入可见正文。「缓存」是这一条请求自己的命中率，下方的横条以当前列表里最慢的一条为满格，用来横向比较快慢。</div>

    <h2 class="section">按账号</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>账号</th><th>请求</th><th>缓存命中</th><th>平均首字</th><th>tokens</th><th>估算花费</th></tr></thead>
        <tbody id="acct-stats-body"><tr><td colspan="6"><div class="empty">读取中</div></td></tr></tbody>
      </table>
    </div>

    <h2 class="section">按模型</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>模型</th><th>请求</th><th>缓存命中</th><th>平均首字</th><th>tokens</th><th>推理占比</th><th>价格 入/出/缓存 $/M</th><th>估算花费</th></tr></thead>
        <tbody id="stats-body"><tr><td colspan="8"><div class="empty">读取中</div></td></tr></tbody>
      </table>
    </div>
    <div class="msg" id="stats-msg"></div>
  </section>

  <section id="view-models" class="view">
    <div class="head">
      <h2 class="section" style="margin:0">模型</h2>
      <div class="seg">
        <button id="scope-accessible" aria-pressed="true">仅可用</button>
        <button id="scope-all" aria-pressed="false">全部</button>
      </div>
    </div>
    <div class="card pad">
      <div class="btn-row" style="justify-content:space-between">
        <input id="model-filter" placeholder="搜索模型 id 或名称" style="max-width:320px" />
        <span class="chip" id="models-count">0</span>
      </div>
      <div class="table-wrap" style="margin-top:12px">
        <table>
          <thead><tr><th>模型</th><th>上下文</th><th>推理档位</th><th>价格 入/出/缓存 $/M</th><th>可用性</th></tr></thead>
          <tbody id="models-body"><tr><td colspan="5"><div class="empty">读取中</div></td></tr></tbody>
        </table>
      </div>
      <div class="help">价格是每 1M tokens 的挂牌价，来自 models.json。点击 ID 复制。</div>
      <div class="msg" id="models-msg"></div>
    </div>
  </section>

  <section id="view-quota" class="view">
    <div class="head">
      <h2 class="section" style="margin:0">账号额度</h2>
      <button class="btn" id="btn-refresh">刷新套餐数据</button>
    </div>
    <div class="metrics">
      <div class="metric"><div class="k">套餐</div><div class="v" id="q-plan">-</div></div>
      <div class="metric"><div class="k">月度余额</div><div class="v" id="q-monthly">-</div></div>
      <div class="metric"><div class="k">按量余额</div><div class="v" id="q-purchased">-</div></div>
      <div class="metric"><div class="k">赠送余额</div><div class="v" id="q-free">-</div></div>
    </div>

    <h2 class="section">限流窗口</h2>
    <div class="card pad">
      <div class="quota-row" id="q-fh"></div>
      <div class="quota-row" id="q-wk"></div>
    </div>

    <h2 class="section">本期用量</h2>
    <div class="metrics">
      <div class="metric"><div class="k">请求数</div><div class="v" id="q-requests">-</div></div>
      <div class="metric"><div class="k">输入 tokens</div><div class="v" id="q-tokens-in">-</div></div>
      <div class="metric"><div class="k">输出 tokens</div><div class="v" id="q-tokens-out">-</div></div>
      <div class="metric"><div class="k">花费</div><div class="v" id="q-cost">-</div></div>
    </div>
    <div class="card pad" style="margin-top:12px">
      <dl class="rows" style="margin:0">
        <div class="row"><dt>计费周期</dt><dd id="q-period">-</dd></div>
      </dl>
      <div class="msg" id="quota-msg"></div>
    </div>

    <h2 class="section">按账号明细</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>账号</th><th>套餐</th><th>月度余额</th><th>按量余额</th><th>赠送余额</th><th>5 小时窗口</th><th>每周窗口</th><th>状态</th></tr></thead>
        <tbody id="quota-parts-body"><tr><td colspan="8"><div class="empty">读取中</div></td></tr></tbody>
      </table>
    </div>
    <div class="help">上方合计与这里的分项来自同一个缓存（默认 60 秒）。某个账号查询失败时合计会标记为部分数据缺失，不会把它当作 0 参与合计。</div>
  </section>

  <section id="view-accounts" class="view">
    <div class="head">
      <h2 class="section" style="margin:0">账号</h2>
      <div class="seg" id="mode-seg">
        <button data-mode="sequential" aria-pressed="false">用完再换</button>
        <button data-mode="failover" aria-pressed="false">遇 429 自动换</button>
      </div>
    </div>
    <div class="card pad">
      <div class="table-wrap" style="border:0">
        <table>
          <thead><tr><th>账号</th><th>状态</th><th>套餐</th><th>余额 月/按量/赠送</th><th>5 小时窗口</th><th>每周窗口</th><th>操作</th></tr></thead>
          <tbody id="acc-list"><tr><td colspan="7"><div class="empty">读取中</div></td></tr></tbody>
        </table>
      </div>
      <div class="mode-hint" id="mode-hint"></div>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn danger" id="btn-logout">清空全部账号</button>
      </div>
    </div>

    <h2 class="section">添加账号</h2>
    <div class="card pad">
      <div class="field">
        <label for="key-input">Command Code API Key</label>
        <input id="key-input" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴要添加的账号的 API Key" />
        <div class="help">先用该 Key 请求 /alpha/whoami 校验，通过后写入本网关的凭据文件，不影响 cmdc 命令行。同名账号会合并成一条，不同账号各占一条。</div>
      </div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn primary" id="btn-key">验证并添加</button>
        <button class="btn" id="btn-browser">用浏览器登录添加</button>
      </div>
      <div id="browser-box" class="hide" style="margin-top:14px">
        <label>若浏览器没有自动打开，手动访问</label>
        <div class="mono" id="browser-url" style="font-size:12px; color:var(--text-dim); overflow-wrap:anywhere"></div>
      </div>
      <div class="msg" id="login-msg"></div>
    </div>
  </section>

  <section id="view-playground" class="view">
    <h2 class="section">调试台</h2>
    <div class="card pad">
      <div class="metrics" style="grid-template-columns:minmax(220px,1fr) 150px auto; border:0; gap:14px; background:none">
        <div class="field" style="margin:0">
          <label for="pg-model">模型</label>
          <select id="pg-model"></select>
        </div>
        <div class="field" style="margin:0">
          <label for="pg-maxtokens">max_tokens</label>
          <input id="pg-maxtokens" type="number" value="2048" />
        </div>
        <div class="field" style="margin:0">
          <label>输出方式</label>
          <button class="btn" id="pg-stream" aria-pressed="true">流式</button>
        </div>
      </div>
      <div class="field">
        <label for="pg-system">System（留空则由后端注入 cmdc 的 harness 提示词）</label>
        <textarea id="pg-system" placeholder="可选"></textarea>
      </div>
      <div class="field">
        <label for="pg-prompt">User</label>
        <textarea id="pg-prompt" placeholder="输入内容，Ctrl + Enter 发送"></textarea>
      </div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn primary" id="btn-send">发送</button>
      </div>
      <div class="msg" id="pg-msg"></div>
      <pre class="out" id="pg-out">输出会显示在这里</pre>
    </div>
  </section>
</div>
</main>

<div class="gate hide" id="gate">
  <div class="gate-box">
    <div class="gate-title">需要访问密钥</div>
    <div class="gate-help">这个网关对局域网开放，<b>非本机</b>访问必须带 access key。密钥在网关启动日志里，或本机打开面板后在「概览」页复制。</div>
    <div class="field">
      <label for="gate-input">Access Key</label>
      <input id="gate-input" type="password" autocomplete="off" spellcheck="false" placeholder="cmdc_..." />
    </div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn primary" id="gate-btn">连接</button>
    </div>
    <div class="msg" id="gate-msg"></div>
  </div>
</div>

<script>${SCRIPT}</script>
</body>
</html>`;
}

export function callbackPage({ ok, title, message }) {
  const accent = ok ? '#15803d' : '#b91c1c';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${title}</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f7;color:#15181c;
  font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans SC",sans-serif}
.box{max-width:440px;margin:24px;padding:32px;text-align:center;background:#fdfdfe;border:1px solid #e2e5ea}
.icon{width:44px;height:44px;margin:0 auto 16px;display:grid;place-items:center;
  font-size:20px;border:1px solid ${accent};color:${accent}}
h1{margin:0 0 8px;font-size:18px;font-weight:600}
p{margin:0;color:#5a626d;font-size:13.5px}
a{display:inline-block;margin-top:20px;color:#2563eb;text-decoration:none;font-size:13px}
a:hover{text-decoration:underline}
@media (prefers-reduced-motion: reduce){*{animation:none !important}}
</style>
</head>
<body>
<div class="box">
  <div class="icon">${ok ? '&#10003;' : '&#10005;'}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  <a href="/panel">返回控制面板</a>
</div>
</body>
</html>`;
}

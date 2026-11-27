/* Shared helpers used by every page. */
const NAV = [
  { group: 'Live system', items: [
    ['index.html', 'Dashboard'],
    ['monitor.html', 'Process monitor'],
    ['priority-control.html', 'Change priority'],
  ] },
  { group: 'CPU scheduling', items: [
    ['fcfs.html', 'First Come First Served'],
    ['sjf.html', 'Shortest Job First'],
    ['srtf.html', 'Shortest Remaining Time'],
    ['priority-scheduling.html', 'Priority scheduling'],
    ['round-robin.html', 'Round Robin'],
    ['multilevel.html', 'Multilevel feedback queue'],
  ] },
  { group: 'Analysis', items: [
    ['compare.html', 'Compare algorithms'],
    ['recommender.html', 'Scheduling recommender'],
  ] },
];

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = x => (Number.isFinite(x) ? String(Math.round(x * 100) / 100) : '-');

function renderNav() {
  const cur = location.pathname.split('/').pop() || 'index.html';
  $('nav').innerHTML =
    '<a class="brand" href="index.html"><strong>Smart CPU Process Manager</strong><small>Operating Systems capstone</small></a>' +
    NAV.map(g => `<div class="grp"><p>${g.group}</p>${g.items.map(([h, t]) =>
      `<a href="${h}"${h === cur ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</div>`).join('');
}

/* ---------- Backend calls ---------- */
function showOffline(on) {
  let b = $('offline');
  if (on && !b) {
    b = document.createElement('div');
    b.id = 'offline'; b.className = 'banner bad'; b.setAttribute('role', 'alert');
    b.innerHTML = '<strong>Can\'t reach the backend.</strong> Start it with <code>python app.py</code>, then open <code>http://127.0.0.1:5000</code>.';
    $('app').prepend(b);
  } else if (!on && b) b.remove();
}

async function api(path, opt) {
  let r;
  try { r = await fetch(path, opt); } catch (e) { showOffline(true); throw e; }
  showOffline(false);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

/* ---------- Workload (shared across every scheduling page) ---------- */
const WL_KEY = 'scpm.workload.v1';
const SAMPLE = [['P1', 0, 8, 3], ['P2', 1, 4, 1], ['P3', 2, 9, 4], ['P4', 3, 5, 2], ['P5', 6, 2, 5]]
  .map(([pid, arrival, burst, priority]) => ({ pid, arrival, burst, priority }));

function loadWL() {
  try { const v = JSON.parse(localStorage.getItem(WL_KEY)); if (Array.isArray(v) && v.length) return v; } catch (e) { /* use sample */ }
  return SAMPLE.map(p => ({ ...p }));
}
function saveWL(ps) { try { localStorage.setItem(WL_KEY, JSON.stringify(ps)); } catch (e) { /* ignore */ } }

function mountWorkload(el, opt = {}) {
  let ps = loadWL();
  const showPri = !!opt.priority;
  const changed = () => { saveWL(ps); if (opt.onChange) opt.onChange(); };

  function draw() {
    el.innerHTML = `
      <div class="tbl-wrap"><table class="tbl wl">
        <thead><tr><th>Process</th><th>Arrival time</th><th>Burst time</th>${showPri ? '<th>Priority<small>1 is highest</small></th>' : ''}<th><span class="sr-only"></span></th></tr></thead>
        <tbody>${ps.map((p, i) => `<tr data-i="${i}">
          <td><input aria-label="Process name" data-k="pid" value="${esc(p.pid)}"></td>
          <td><input aria-label="Arrival time" type="number" min="0" step="1" data-k="arrival" value="${p.arrival}"></td>
          <td><input aria-label="Burst time" type="number" min="1" step="1" data-k="burst" value="${p.burst}"></td>
          ${showPri ? `<td><input aria-label="Priority" type="number" step="1" data-k="priority" value="${p.priority}"></td>` : ''}
          <td><button class="icon" data-del="${i}" aria-label="Remove ${esc(p.pid)}">&times;</button></td></tr>`).join('')}
        </tbody></table></div>
      <div class="row gap">
        <button class="btn ghost" data-act="add">Add process</button>
        <button class="btn ghost" data-act="sample">Load sample</button>
        <button class="btn ghost" data-act="random">Random workload</button>
      </div>
      <p class="err wl-err" role="alert"></p>`;
  }

  el.addEventListener('input', e => {
    const k = e.target.dataset.k; if (!k) return;
    const i = +e.target.closest('tr').dataset.i;
    ps[i][k] = k === 'pid' ? e.target.value.trim() : e.target.valueAsNumber;
    changed();
  });
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.del !== undefined) ps.splice(+b.dataset.del, 1);
    else if (b.dataset.act === 'add') ps.push({ pid: 'P' + (ps.length + 1), arrival: 0, burst: 4, priority: 3 });
    else if (b.dataset.act === 'sample') ps = SAMPLE.map(p => ({ ...p }));
    else if (b.dataset.act === 'random') {
      const n = 4 + Math.floor(Math.random() * 4), r = (a, z) => a + Math.floor(Math.random() * (z - a + 1));
      ps = Array.from({ length: n }, (_, i) => ({ pid: 'P' + (i + 1), arrival: r(0, 10), burst: r(1, 12), priority: r(1, 5) }));
    } else return;
    draw(); changed();
  });

  function get() {
    const err = el.querySelector('.wl-err');
    const fail = m => { err.textContent = m; return null; };
    if (!ps.length) return fail('Add at least one process.');
    const seen = new Set();
    for (const p of ps) {
      if (!p.pid) return fail('Every process needs a name.');
      if (seen.has(p.pid)) return fail(`Two processes are named ${p.pid}. Give each one a unique name.`);
      seen.add(p.pid);
      if (!Number.isInteger(p.arrival) || p.arrival < 0) return fail(`${p.pid}: arrival time must be a whole number, 0 or more.`);
      if (!Number.isInteger(p.burst) || p.burst < 1) return fail(`${p.pid}: burst time must be a whole number, 1 or more.`);
      if (!Number.isInteger(p.priority)) return fail(`${p.pid}: priority must be a whole number.`);
    }
    err.textContent = '';
    return ps.map(p => ({ ...p }));
  }

  draw();
  return { get };
}

/* ---------- Results rendering ---------- */
const PALETTE = ['#2747e8', '#0e8a6b', '#c2410c', '#7c3aed', '#b4237a', '#0f7fa8', '#8a6d00', '#c0392b', '#3f6b1f', '#5b5fc7', '#9a3412', '#0b6e4f'];
const colorOf = (pid, order) => PALETTE[order.indexOf(pid) % PALETTE.length];

function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(Math.max(x, 1)));
  for (const m of [1, 2, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}

function renderGantt(el, segs, order, label) {
  const total = segs[segs.length - 1].end;
  let marks = [...new Set([0, ...segs.map(s => s.end)])];
  if (marks.length > 24) {
    const step = niceStep(total / 20);
    marks = [];
    for (let t = 0; t <= total; t += step) marks.push(t);
    if (marks[marks.length - 1] !== total) marks.push(total);
  }
  const pct = x => (x / total * 100) + '%';
  const width = Math.max(560, total * 26);
  const usedPids = order.filter(p => segs.some(s => s.pid === p));
  el.innerHTML = `${label ? `<p class="gantt-label">${esc(label)}</p>` : ''}
    <div class="gantt-wrap"><div class="gantt-inner" style="min-width:${width}px">
      <div class="track" role="img" aria-label="Gantt chart: ${segs.map(s => `${s.pid ?? 'idle'} from ${s.start} to ${s.end}`).join(', ')}">
        ${segs.map(s => s.pid === null
          ? `<div class="blk idle" style="left:${pct(s.start)};width:${pct(s.end - s.start)}" title="CPU idle ${s.start} to ${s.end}">idle</div>`
          : `<div class="blk" style="left:${pct(s.start)};width:${pct(s.end - s.start)};background:${colorOf(s.pid, order)}" title="${esc(s.pid)}: ${s.start} to ${s.end}${s.q !== undefined ? ` (queue ${s.q})` : ''}">${esc(s.pid)}${s.q !== undefined ? `<small>Q${s.q}</small>` : ''}</div>`).join('')}
      </div>
      <div class="ticks">${marks.map(m => `<span class="tick" style="left:${pct(m)}">${m}</span>`).join('')}</div>
    </div></div>
    <p class="legend">${usedPids.map(p => `<span><i style="background:${colorOf(p, order)}"></i>${esc(p)}</span>`).join('')}</p>`;
}

function renderStats(el, r) {
  const items = [
    [num(r.avg.waiting), 'Average waiting time'],
    [num(r.avg.turnaround), 'Average turnaround time'],
    [num(r.avg.response), 'Average response time'],
    [num(r.cpuUtil) + '%', 'CPU utilisation'],
    [num(r.throughput), 'Jobs finished per time unit'],
    [r.ctx, 'Context switches'],
  ];
  el.innerHTML = `<div class="stats">${items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;
}

function renderMetrics(el, r, showPri) {
  const a = r.avg;
  el.innerHTML = `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Process</th><th class="n">Arrival</th><th class="n">Burst</th>${showPri ? '<th class="n">Priority</th>' : ''}
      <th class="n">Completion</th><th class="n">Turnaround</th><th class="n">Waiting</th><th class="n">Response</th></tr></thead>
    <tbody>${r.rows.map(x => `<tr><td>${esc(x.pid)}</td><td class="n">${x.arrival}</td><td class="n">${x.burst}</td>${showPri ? `<td class="n">${x.priority}</td>` : ''}
      <td class="n">${x.completion}</td><td class="n">${x.turnaround}</td><td class="n">${x.waiting}</td><td class="n">${x.response}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Average</td><td></td><td></td>${showPri ? '<td></td>' : ''}<td></td><td class="n">${num(a.turnaround)}</td><td class="n">${num(a.waiting)}</td><td class="n">${num(a.response)}</td></tr></tfoot>
  </table></div>
  <p class="muted">Turnaround = completion - arrival. Waiting = turnaround - burst. Response = first time on the CPU - arrival.</p>`;
}

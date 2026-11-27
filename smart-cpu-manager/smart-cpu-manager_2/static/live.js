/* Live system pages. These need the Flask backend (app.py). */
const LEVEL_LABEL = { low: 'Low', below: 'Below normal', normal: 'Normal', above: 'Above normal', high: 'High', realtime: 'Realtime' };
const LEVEL_ORDER = ['low', 'below', 'normal', 'above', 'high'];

const levelTag = l => (l ? `<span class="tag ${l}">${LEVEL_LABEL[l] || l}</span>` : '<span class="muted">-</span>');

/* Runs fn now and then every `ms`, but only starts the next run after the
   previous one has finished, so slow responses can never pile up. */
function poll(fn, ms) {
  let timer = null, running = false, interval = ms;
  const schedule = () => { clearTimeout(timer); if (interval) timer = setTimeout(tick, interval); };
  async function tick() {
    if (running) return;
    running = true;
    if (!document.hidden) { try { await fn(); } catch (e) { /* banner already shown */ } }
    running = false;
    schedule();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(timer); tick(); } });
  tick();
  return m => { interval = m; clearTimeout(timer); if (!running) schedule(); };
}

function fmtUptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

/* ===== Dashboard ===== */
function initDashboard() {
  $('app').innerHTML = `
    <header class="head"><h1>Dashboard</h1><p class="lead">A live view of this computer's CPU, memory and busiest processes. It refreshes every two seconds.</p></header>
    <div class="stats" id="stats"></div>
    <div class="two">
      <section class="panel"><h2>CPU use, last two minutes</h2>
        <svg class="spark" id="spark" viewBox="0 0 300 100" preserveAspectRatio="none" role="img" aria-label="CPU usage history"></svg>
        <div class="cores" id="cores"></div></section>
      <section class="panel"><h2>Busiest processes</h2>
        <div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Process</th><th class="n">CPU %</th><th class="n">Mem %</th></tr></thead><tbody id="top"></tbody></table></div>
        <a href="monitor.html">See every process</a></section>
    </div>`;
  const hist = [];

  poll(async () => {
    const [s, procs] = await Promise.all([api('/api/system'), api('/api/processes')]);
    hist.push(s.cpu); if (hist.length > 60) hist.shift();
    const load = s.load ? `${s.load[0]}` : null;
    $('stats').innerHTML = [
      [s.cpu + '%', 'CPU use'],
      [s.memory_percent + '%', `Memory (${s.memory_used_gb} of ${s.memory_total_gb} GB)`],
      [s.processes, 'Running processes'],
      [s.cores, 'Logical cores'],
      load !== null ? [load, 'Load average (1 min)'] : [fmtUptime(s.uptime_s), 'Uptime'],
    ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');

    const pts = hist.map((v, i) => `${(i / 59) * 300},${100 - v}`);
    const first = ((hist.length - 1) / 59) * 300;
    $('spark').innerHTML =
      [25, 50, 75].map(y => `<line x1="0" x2="300" y1="${y}" y2="${y}" stroke="#e1e7f0" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('') +
      `<polygon points="0,100 ${pts.join(' ')} ${first},100" fill="#2747e8" fill-opacity="0.12"/>` +
      `<polyline points="${pts.join(' ')}" fill="none" stroke="#2747e8" stroke-width="2" vector-effect="non-scaling-stroke"/>`;

    $('cores').innerHTML = s.per_core.map((v, i) => `<div class="core">Core ${i} &nbsp;${v}%<div><i style="width:${v}%"></i></div></div>`).join('');

    $('top').innerHTML = procs.sort((a, b) => b.cpu - a.cpu).slice(0, 6)
      .map(p => `<tr><td><span class="cut" title="${esc(p.name)} (PID ${p.pid})">${esc(p.name)}</span></td><td class="n">${p.cpu}</td><td class="n">${p.mem}</td></tr>`).join('');
  }, 2000);
}

/* ===== Process monitor ===== */
function initMonitor() {
  $('app').innerHTML = `
    <header class="head"><h1>Process monitor</h1><p class="lead">Every process running on this computer. Select a column heading to sort, or open a process to change its priority.</p></header>
    <div class="toolbar">
      <input id="q" type="search" placeholder="Search by name, PID or user" aria-label="Search processes">
      <label class="field" style="margin:0">Refresh
        <select id="rate"><option value="1000">Every second</option><option value="2000" selected>Every 2 seconds</option><option value="5000">Every 5 seconds</option><option value="0">Paused</option></select></label>
      <span class="muted" id="count"></span>
    </div>
    <div class="scroll-y" style="max-height:none"><table class="tbl sortable"><thead id="head"></thead><tbody id="body"></tbody></table></div>`;

  const cols = [
    ['pid', 'PID', 'n'], ['name', 'Name', ''], ['user', 'User', ''], ['status', 'State', ''],
    ['cpu', 'CPU %', 'n'], ['mem', 'Memory %', 'n'], ['threads', 'Threads', 'n'], ['level', 'Priority', ''],
  ];
  let rows = [], sort = 'cpu', dir = -1;

  function drawHead() {
    $('head').innerHTML = '<tr>' + cols.map(([k, t, c]) =>
      `<th class="${c}" data-k="${k}" ${k === sort ? `aria-sort="${dir > 0 ? 'ascending' : 'descending'}"` : ''}>${t}${k === sort ? (dir > 0 ? ' &#9650;' : ' &#9660;') : ''}</th>`).join('') + '<th></th></tr>';
  }
  function draw() {
    const q = $('q').value.trim().toLowerCase();
    let list = rows.filter(p => !q || p.name.toLowerCase().includes(q) || String(p.pid) === q || p.user.toLowerCase().includes(q));
    list.sort((a, b) => {
      const x = a[sort], y = b[sort];
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
    });
    $('count').textContent = `${list.length} of ${rows.length} processes`;
    $('body').innerHTML = list.slice(0, 400).map(p => `<tr>
      <td class="n">${p.pid}</td><td>${esc(p.name)}</td><td>${esc(p.user)}</td>
      <td>${p.status === 'stopped' ? '<span class="tag stopped">stopped</span>' : esc(p.status)}</td>
      <td class="n bar" style="--v:${Math.min(100, p.cpu)}%">${p.cpu}</td><td class="n bar" style="--v:${Math.min(100, p.mem * 4)}%">${p.mem}</td>
      <td class="n">${p.threads}</td><td>${levelTag(p.level)}</td>
      <td><a href="priority-control.html?pid=${p.pid}">Change priority</a></td></tr>`).join('');
  }

  $('head').addEventListener('click', e => {
    const th = e.target.closest('th'); if (!th || !th.dataset.k) return;
    if (sort === th.dataset.k) dir = -dir; else { sort = th.dataset.k; dir = ['name', 'user', 'status', 'level'].includes(sort) ? 1 : -1; }
    drawHead(); draw();
  });
  $('q').addEventListener('input', draw);
  drawHead();
  const restart = poll(async () => { rows = await api('/api/processes'); draw(); }, 2000);
  $('rate').addEventListener('change', e => restart(+e.target.value));
}

/* ===== Change priority ===== */
function initPriority() {
  $('app').innerHTML = `
    <header class="head"><h1>Change priority</h1><p class="lead">Give a process more or less CPU attention. A higher priority means the operating system schedules it ahead of lower-priority work.</p></header>
    <div id="note"></div>
    <div class="two">
      <section class="panel"><h2>Choose a process</h2>
        <input id="q" type="search" placeholder="Search by name or PID" aria-label="Search processes">
        <div class="pick" id="pick"></div></section>
      <section class="panel" id="detail"><h2>Selected process</h2><p class="muted">Pick a process from the list to change it.</p></section>
    </div>
    <section style="margin-top:30px"><h2>Recent changes</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Time</th><th>PID</th><th>Process</th><th>Action</th><th>Result</th></tr></thead><tbody id="log"></tbody></table></div></section>`;

  const params = new URLSearchParams(location.search);
  let selected = params.get('pid') ? +params.get('pid') : null;
  let rows = [], chosen = null, sys = null;

  const levelHint = l => (sys && sys.platform !== 'Windows' && sys.levels ? `nice ${sys.levels[l]}` : '');

  function drawPick() {
    const q = $('q').value.trim().toLowerCase();
    const list = rows.filter(p => !q || p.name.toLowerCase().includes(q) || String(p.pid).startsWith(q))
      .sort((a, b) => b.cpu - a.cpu).slice(0, 150);
    $('pick').innerHTML = list.map(p => `<button data-pid="${p.pid}" aria-pressed="${p.pid === selected}"><span class="pid">${p.pid}</span><span>${esc(p.name)}</span>${levelTag(p.level)}</button>`).join('') ||
      '<p class="muted" style="padding:12px">No process matches that search.</p>';
  }

  let drawnPid = null;
  const curLine = p => `Current priority: ${levelTag(p.level)} &nbsp; CPU ${p.cpu}% &nbsp; Memory ${p.mem}% &nbsp; State ${esc(p.status)}`;

  function drawDetail(keepChoice) {
    const p = rows.find(r => r.pid === selected);
    const box = $('detail');
    if (selected === null) return;
    if (!p) { drawnPid = null; box.innerHTML = `<h2>Selected process</h2><p class="muted">Process ${selected} is not running any more. Pick another one.</p>`; return; }
    const idx = LEVEL_ORDER.indexOf(p.level);
    if (keepChoice && drawnPid === p.pid) {
      // Same process still shown: update the numbers without rebuilding the controls (keeps focus).
      $('cur').innerHTML = curLine(p);
      $('raise').disabled = idx < 0 || idx === 4;
      $('lower').disabled = idx < 0 || idx === 0;
      return;
    }
    drawnPid = p.pid;
    if (!keepChoice || chosen === null) chosen = LEVEL_ORDER.includes(p.level) ? p.level : 'normal';
    box.innerHTML = `
      <h2>${esc(p.name)} <span class="muted" style="font-weight:400">PID ${p.pid}</span></h2>
      <p class="muted" id="cur" style="margin:0 0 4px">${curLine(p)}</p>
      <div class="levels" role="radiogroup" aria-label="New priority">
        ${[...LEVEL_ORDER].reverse().map(l => `<label class="level"><input type="radio" name="lvl" value="${l}" ${l === chosen ? 'checked' : ''}> ${LEVEL_LABEL[l]}<small>${levelHint(l)}</small></label>`).join('')}
      </div>
      <div class="row gap">
        <button class="btn" id="apply">Apply priority</button>
        <button class="btn ghost" id="raise" ${idx < 0 || idx === 4 ? 'disabled' : ''}>Raise one level</button>
        <button class="btn ghost" id="lower" ${idx < 0 || idx === 0 ? 'disabled' : ''}>Lower one level</button>
      </div>
      <h3 style="margin-top:22px">Other controls</h3>
      <div class="row gap" style="margin-top:8px">
        <button class="btn ghost" id="suspend">Suspend</button>
        <button class="btn ghost" id="resume">Resume</button>
        <button class="btn danger" id="terminate">Terminate</button>
      </div>
      <p class="status" id="status" role="status"></p>`;
  }

  async function send(body, okText) {
    const st = $('status');
    try {
      const r = await api('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      st.className = 'status'; st.style.color = 'var(--ok)'; st.textContent = r.message || okText;
    } catch (e) {
      st.className = 'status'; st.style.color = 'var(--bad)'; st.textContent = e.message;
    }
    await refresh(true); loadLog();
  }

  $('pick').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    selected = +b.dataset.pid; chosen = null; drawPick(); drawDetail(false);
  });
  $('q').addEventListener('input', drawPick);
  $('detail').addEventListener('change', e => { if (e.target.name === 'lvl') chosen = e.target.value; });
  $('detail').addEventListener('click', e => {
    const id = e.target.id; if (!id) return;
    const p = rows.find(r => r.pid === selected); if (!p) return;
    if (id === 'apply') send({ pid: p.pid, action: 'priority', level: chosen });
    if (id === 'raise') send({ pid: p.pid, action: 'priority', level: LEVEL_ORDER[LEVEL_ORDER.indexOf(p.level) + 1] });
    if (id === 'lower') send({ pid: p.pid, action: 'priority', level: LEVEL_ORDER[LEVEL_ORDER.indexOf(p.level) - 1] });
    if (id === 'suspend') send({ pid: p.pid, action: 'suspend' });
    if (id === 'resume') send({ pid: p.pid, action: 'resume' });
    if (id === 'terminate' && confirm(`Terminate ${p.name} (PID ${p.pid})? Unsaved work in that program will be lost.`)) send({ pid: p.pid, action: 'terminate' });
  });

  async function refresh(keepChoice) {
    rows = await api('/api/processes');
    drawPick();
    drawDetail(keepChoice);
  }
  async function loadLog() {
    const l = await api('/api/log');
    $('log').innerHTML = l.length ? l.map(x => `<tr><td class="n">${x.time}</td><td class="n">${x.pid}</td><td>${esc(x.name)}</td><td>${esc(x.action)}</td><td>${esc(x.result)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="muted">No changes yet. Changes you make here will be listed.</td></tr>';
  }

  api('/api/system').then(s => {
    sys = s;
    if (!s.elevated) {
      $('note').innerHTML = `<div class="banner warn">The server is not running as ${s.platform === 'Windows' ? 'Administrator' : 'root'}. Lowering a priority usually works, but raising one or changing other users' processes will be refused. Restart <code>app.py</code> with ${s.platform === 'Windows' ? 'an elevated terminal' : '<code>sudo</code>'} to allow it.</div>`;
    }
  }).catch(() => {});
  poll(async () => { await refresh(true); }, 3000);
  loadLog().catch(() => {});
}

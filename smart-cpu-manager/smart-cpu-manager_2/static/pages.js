/* Page builders for the scheduling pages. */
const ALGO_PAGE = {
  fcfs: 'fcfs.html', sjf: 'sjf.html', srtf: 'srtf.html',
  priority: 'priority-scheduling.html', rr: 'round-robin.html', mlfq: 'multilevel.html',
};

const ALGOS = {
  fcfs: {
    title: 'First Come First Served',
    lead: 'Processes run in the order they arrive. Once a process has the CPU, it keeps it until it finishes.',
    good: 'Simple to implement, adds no switching overhead, and no process can starve.',
    bad: 'One long job at the front makes every job behind it wait (the convoy effect), so average waiting time is often high.',
  },
  sjf: {
    title: 'Shortest Job First',
    lead: 'Whenever the CPU becomes free, the ready process with the smallest burst time runs next. A running process is never interrupted.',
    good: 'Gives the lowest average waiting time of any non-preemptive algorithm.',
    bad: 'Long jobs can wait forever if short ones keep arriving, and the OS must know or estimate burst times in advance.',
  },
  srtf: {
    title: 'Shortest Remaining Time First',
    lead: 'The preemptive version of Shortest Job First. The CPU always goes to the ready process with the least time left, so a short newcomer can take over a running job.',
    good: 'Gives the lowest average waiting time of the classic algorithms.',
    bad: 'More context switches than SJF, long jobs can starve, and burst times must be estimated.',
  },
  priority: {
    title: 'Priority scheduling',
    lead: 'Each process has a priority number and the lowest number runs first. Choose whether a higher-priority arrival may interrupt the running process.',
    good: 'Important work goes first, which suits systems with clear levels of urgency.',
    bad: 'Low-priority processes can starve. Real systems fix this with aging, which slowly raises the priority of waiting processes.',
  },
  rr: {
    title: 'Round Robin',
    lead: 'Each process gets the CPU for at most one time quantum, then moves to the back of the queue. This repeats until every process is done.',
    good: 'Fair to every process and keeps response time short, which suits interactive systems.',
    bad: 'A tiny quantum wastes time on context switches, and a huge quantum behaves like First Come First Served.',
  },
  mlfq: {
    title: 'Multilevel feedback queue',
    lead: 'Three queues. New processes start in queue 0 with a short quantum. A process that uses its whole quantum drops one queue down, and queue 2 runs First Come First Served. A higher queue always runs before a lower one.',
    good: 'Short and interactive jobs finish quickly without the OS knowing burst times in advance.',
    bad: 'Needs tuning (number of queues, quantum sizes), and long jobs wait while short ones keep arriving.',
  },
};

function paramsHTML(key) {
  if (key === 'rr') return '<label class="field">Time quantum <input id="q" type="number" min="1" step="1" value="4"></label>';
  if (key === 'priority') return '<label class="field"><input id="pre" type="checkbox"> Preemptive (a higher-priority arrival interrupts the running process)</label>';
  if (key === 'mlfq') return '<label class="field">Queue 0 quantum <input id="q0" type="number" min="1" step="1" value="4"></label><label class="field">Queue 1 quantum <input id="q1" type="number" min="1" step="1" value="8"></label>';
  return '';
}

function readOpts() {
  const v = id => ($(id) ? $(id).valueAsNumber : undefined);
  return { preemptive: $('pre') ? $('pre').checked : false, quantum: v('q'), q0: v('q0'), q1: v('q1') };
}

function badQuanta(o) {
  for (const k of ['quantum', 'q0', 'q1']) {
    if (o[k] !== undefined && (!Number.isInteger(o[k]) || o[k] < 1)) return 'Time quantum must be a whole number, 1 or more.';
  }
  return '';
}

/* ----- One page per algorithm ----- */
function initAlgoPage(key) {
  const A = ALGOS[key];
  $('app').innerHTML = `
    <header class="head"><h1>${A.title}</h1><p class="lead">${A.lead}</p></header>
    <section class="panel"><h2>Workload</h2>${paramsHTML(key)}<div id="wl"></div></section>
    <section id="out" aria-live="polite"></section>
    <section class="notes"><div><h3>Strengths</h3><p>${A.good}</p></div><div><h3>Trade-offs</h3><p>${A.bad}</p></div></section>`;

  const wl = mountWorkload($('wl'), { priority: key === 'priority', onChange: run });
  document.querySelectorAll('#app .field input').forEach(i => i.addEventListener('input', run));

  function run() {
    const out = $('out'), ps = wl.get();
    if (!ps) { out.innerHTML = ''; return; }
    const opt = readOpts(), bad = badQuanta(opt);
    if (bad) { out.innerHTML = `<p class="err">${bad}</p>`; return; }
    const r = Sched.run(key, ps, opt), order = ps.map(p => p.pid);
    out.innerHTML = '<h2>Gantt chart</h2><div id="g"></div><h2>Results</h2><div id="s"></div><div id="t"></div>';
    renderGantt($('g'), r.gantt, order);
    renderStats($('s'), r);
    renderMetrics($('t'), r, key === 'priority');
  }
  run();
}

/* ----- Compare all algorithms on the same workload ----- */
function initComparePage() {
  $('app').innerHTML = `
    <header class="head"><h1>Compare algorithms</h1>
      <p class="lead">Run all six algorithms on the same workload and see which one gives the best waiting, turnaround and response times.</p></header>
    <section class="panel"><h2>Workload and settings</h2>
      <label class="field">Round Robin quantum <input id="q" type="number" min="1" step="1" value="4"></label>
      <label class="field">Queue 0 quantum <input id="q0" type="number" min="1" step="1" value="4"></label>
      <label class="field">Queue 1 quantum <input id="q1" type="number" min="1" step="1" value="8"></label>
      <label class="field"><input id="pre" type="checkbox"> Preemptive priority</label>
      <div id="wl"></div></section>
    <section id="out" aria-live="polite"></section>`;
  const wl = mountWorkload($('wl'), { priority: true, onChange: run });
  document.querySelectorAll('#app .field input').forEach(i => i.addEventListener('input', run));

  function run() {
    const out = $('out'), ps = wl.get();
    if (!ps) { out.innerHTML = ''; return; }
    const opt = readOpts(), bad = badQuanta(opt);
    if (bad) { out.innerHTML = `<p class="err">${bad}</p>`; return; }
    const keys = Object.keys(Sched.NAMES), order = ps.map(p => p.pid);
    const res = {}; keys.forEach(k => { res[k] = Sched.run(k, ps, opt); });
    const cols = [
      ['waiting', 'Avg waiting', r => r.avg.waiting], ['turnaround', 'Avg turnaround', r => r.avg.turnaround],
      ['response', 'Avg response', r => r.avg.response], ['ctx', 'Context switches', r => r.ctx],
    ];
    const best = {}; cols.forEach(([c, , f]) => { best[c] = Math.min(...keys.map(k => f(res[k]))); });
    const maxWait = Math.max(...keys.map(k => res[k].avg.waiting), 1);
    out.innerHTML = `
      <h2>Summary</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Algorithm</th>${cols.map(c => `<th class="n">${c[1]}</th>`).join('')}<th class="n">CPU utilisation</th></tr></thead>
        <tbody>${keys.map(k => `<tr><td><a href="${ALGO_PAGE[k]}">${Sched.NAMES[k]}</a></td>
          ${cols.map(([c, , f]) => { const v = f(res[k]); return `<td class="n${v === best[c] ? ' hit' : ''}">${num(v)}</td>`; }).join('')}
          <td class="n">${num(res[k].cpuUtil)}%</td></tr>`).join('')}</tbody></table></div>
      <p class="muted">Green marks the lowest value in each column.</p>
      <h2>Average waiting time</h2>
      <div>${keys.map(k => `<div class="hbar"><span>${Sched.NAMES[k]}</span><div><i style="width:${res[k].avg.waiting / maxWait * 100}%"></i></div><span>${num(res[k].avg.waiting)}</span></div>`).join('')}</div>
      <h2 style="margin-top:28px">Gantt charts</h2>
      ${keys.map(k => `<div id="g-${k}"></div>`).join('')}`;
    keys.forEach(k => renderGantt($('g-' + k), res[k].gantt, order, Sched.NAMES[k]));
  }
  run();
}

/* ----- Rule-based recommender ----- */
function initRecommenderPage() {
  $('app').innerHTML = `
    <header class="head"><h1>Scheduling recommender</h1>
      <p class="lead">Describe your workload and what matters most. Simple rules about the workload pick an algorithm, then a real simulation checks the result.</p></header>
    <section class="panel"><h2>Workload and goal</h2>
      <label class="field">Most important goal
        <select id="goal">
          <option value="waiting">Lowest waiting time</option>
          <option value="response">Fast response</option>
          <option value="fairness">Fairness</option>
          <option value="priorities">Respect priorities</option>
        </select></label>
      <div id="wl"></div></section>
    <section id="out" aria-live="polite"></section>`;
  const wl = mountWorkload($('wl'), { priority: true, onChange: run });
  $('goal').addEventListener('change', run);

  function run() {
    const out = $('out'), ps = wl.get();
    if (!ps) { out.innerHTML = ''; return; }
    const rec = Sched.recommend(ps, $('goal').value);
    const f = rec.features, top = rec.top;
    const differs = rec.bestMeasured.algo !== top.algo;
    out.innerHTML = `
      <h2>Recommendation</h2>
      <div class="panel">
        <p class="big-pick"><a href="${ALGO_PAGE[top.algo]}" style="color:inherit">${top.name}</a></p>
        ${top.reasons.length ? `<ul class="reasons">${top.reasons.map(r => `<li>${r}</li>`).join('')}</ul>` : '<p class="muted">No rule stood out for this workload, so this choice comes from the simulated waiting times below.</p>'}
        ${differs ? `<p class="banner warn" style="margin:14px 0 0">On this exact workload, ${rec.bestMeasured.name} actually gives the lowest average waiting time (${num(rec.bestMeasured.result.avg.waiting)} against ${num(top.result.avg.waiting)}). Your goal is not only waiting time, so check both.</p>` : ''}
      </div>
      <h2 style="margin-top:28px">What the rules saw</h2>
      <div class="stats">
        <div class="stat"><b>${f.n}</b><span>Processes</span></div>
        <div class="stat"><b>${num(f.mean)}</b><span>Mean burst time</span></div>
        <div class="stat"><b>${num(f.cv)}</b><span>Burst variation (std dev / mean)</span></div>
        <div class="stat"><b>${num(f.ratio)}x</b><span>Longest to shortest burst</span></div>
        <div class="stat"><b>${f.spread}</b><span>Arrival spread</span></div>
        <div class="stat"><b>${f.distinctPriorities}</b><span>Distinct priorities</span></div>
      </div>
      <h2 style="margin-top:28px">All algorithms, ranked</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Algorithm</th><th class="n">Rule score</th><th class="n">Avg waiting</th><th class="n">Avg turnaround</th><th class="n">Avg response</th></tr></thead>
        <tbody>${rec.ranking.map((x, i) => `<tr class="${i === 0 ? 'sel' : ''}"><td><a href="${ALGO_PAGE[x.algo]}">${x.name}</a></td><td class="n">${x.score}</td>
          <td class="n">${num(x.result.avg.waiting)}</td><td class="n">${num(x.result.avg.turnaround)}</td><td class="n">${num(x.result.avg.response)}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted">Round Robin uses a quantum of ${rec.quantum} (the median burst) and the feedback queue uses ${rec.quantum} and ${rec.quantum * 2}.</p>`;
  }
  run();
}

/* CPU scheduling algorithms. Every algorithm takes
   ps = [{pid, arrival, burst, priority}] and returns
   {gantt, rows, avg, cpuUtil, throughput, makespan, ctx}.
   A gantt segment is {pid, start, end, q}; pid === null means the CPU was idle. */
const Sched = (() => {
  const clone = ps => ps.map((p, i) => ({
    pid: p.pid, arrival: p.arrival, burst: p.burst,
    priority: p.priority ?? 0, rem: p.burst, idx: i, done: false,
  }));

  function addSeg(segs, pid, start, end, q) {
    if (end <= start) return;
    const last = segs[segs.length - 1];
    if (last && last.pid === pid && last.end === start && last.q === q) last.end = end;
    else segs.push({ pid, start, end, q });
  }

  function finalize(ps, segs) {
    const first = {}, comp = {};
    segs.forEach(s => {
      if (s.pid === null) return;
      if (!(s.pid in first)) first[s.pid] = s.start;
      comp[s.pid] = s.end;
    });
    const rows = ps.map(p => {
      const c = comp[p.pid], tat = c - p.arrival;
      return {
        pid: p.pid, arrival: p.arrival, burst: p.burst, priority: p.priority,
        completion: c, turnaround: tat, waiting: tat - p.burst,
        response: first[p.pid] - p.arrival,
      };
    });
    const n = rows.length;
    const avg = k => rows.reduce((a, r) => a + r[k], 0) / n;
    const end = segs.length ? segs[segs.length - 1].end : 0;
    const real = segs.filter(s => s.pid !== null);
    const busy = real.reduce((a, s) => a + s.end - s.start, 0);
    let ctx = 0;
    for (let i = 1; i < real.length; i++) if (real[i].pid !== real[i - 1].pid) ctx++;
    return {
      gantt: segs, rows,
      avg: { waiting: avg('waiting'), turnaround: avg('turnaround'), response: avg('response') },
      cpuUtil: end ? busy / end * 100 : 0,
      throughput: end ? n / end : 0,
      makespan: end, ctx,
    };
  }

  const byKeys = keys => (a, b) => {
    for (const k of keys) { const d = k(a) - k(b); if (d) return d; }
    return 0;
  };

  // Non-preemptive: FCFS, SJF, Priority. `keys` decide who runs next.
  function nonPreemptive(ps, keys) {
    const L = clone(ps), segs = [];
    let t = 0, done = 0;
    while (done < L.length) {
      const ready = L.filter(p => !p.done && p.arrival <= t);
      if (!ready.length) {
        const nx = Math.min(...L.filter(p => !p.done).map(p => p.arrival));
        addSeg(segs, null, t, nx); t = nx; continue;
      }
      ready.sort(byKeys(keys));
      const p = ready[0];
      addSeg(segs, p.pid, t, t + p.burst);
      t += p.burst; p.done = true; done++;
    }
    return finalize(ps, segs);
  }

  // Preemptive: SRTF and preemptive Priority. Decisions only change when a
  // process arrives or finishes, so we jump from event to event.
  function preemptive(ps, keys) {
    const L = clone(ps), segs = [];
    let t = 0, done = 0, cur = null;
    while (done < L.length) {
      const ready = L.filter(p => !p.done && p.arrival <= t);
      if (!ready.length) {
        const nx = Math.min(...L.filter(p => !p.done).map(p => p.arrival));
        addSeg(segs, null, t, nx); t = nx; cur = null; continue;
      }
      const base = byKeys(keys);
      ready.sort((a, b) => {
        const d = base(a, b); if (d) return d;
        if (a === cur) return -1; if (b === cur) return 1;       // ties: keep the runner
        return a.arrival - b.arrival || a.idx - b.idx;
      });
      const p = ready[0];
      const future = L.filter(x => !x.done && x.arrival > t).map(x => x.arrival);
      const nextArrival = future.length ? Math.min(...future) : Infinity;
      const dt = Math.min(p.rem, nextArrival - t);
      addSeg(segs, p.pid, t, t + dt);
      t += dt; p.rem -= dt; cur = p;
      if (p.rem === 0) { p.done = true; done++; cur = null; }
    }
    return finalize(ps, segs);
  }

  function roundRobin(ps, quantum) {
    const L = clone(ps).sort((a, b) => a.arrival - b.arrival || a.idx - b.idx);
    const queue = [], segs = [];
    let t = 0, i = 0, done = 0;
    const admit = () => { while (i < L.length && L[i].arrival <= t) queue.push(L[i++]); };
    while (done < L.length) {
      admit();
      if (!queue.length) {
        const nx = L[i].arrival;
        addSeg(segs, null, t, nx); t = nx; continue;
      }
      const p = queue.shift();
      const run = Math.min(quantum, p.rem);
      addSeg(segs, p.pid, t, t + run);
      t += run; p.rem -= run;
      admit();                       // arrivals during the slice queue up first
      if (p.rem > 0) queue.push(p); else done++;
    }
    return finalize(ps, segs);
  }

  // Three queues. Q0 and Q1 are Round Robin, Q2 is FCFS. A process that uses
  // its whole quantum moves down one queue. A higher queue always runs first.
  function mlfq(ps, q0, q1) {
    const L = clone(ps).sort((a, b) => a.arrival - b.arrival || a.idx - b.idx);
    const Q = [[], [], []], quanta = [q0, q1, Infinity], segs = [];
    let t = 0, i = 0, done = 0, cur = null, lvl = 0, used = 0;
    const admit = () => { while (i < L.length && L[i].arrival <= t) Q[0].push(L[i++]); };
    while (done < L.length) {
      admit();
      if (cur) {
        let higher = false;
        for (let k = 0; k < lvl; k++) if (Q[k].length) higher = true;
        if (higher) { Q[lvl].push(cur); cur = null; }
      }
      if (!cur) {
        let k = 0;
        while (k < 3 && !Q[k].length) k++;
        if (k === 3) {
          const nx = L[i].arrival;
          addSeg(segs, null, t, nx); t = nx; continue;
        }
        cur = Q[k].shift(); lvl = k; used = 0;
      }
      addSeg(segs, cur.pid, t, t + 1, lvl);
      t++; cur.rem--; used++;
      admit();
      if (cur.rem === 0) { done++; cur = null; }
      else if (lvl < 2 && used >= quanta[lvl]) { Q[lvl + 1].push(cur); cur = null; }
    }
    return finalize(ps, segs);
  }

  const arr = p => p.arrival, bur = p => p.burst, rem = p => p.rem, pri = p => p.priority, idx = p => p.idx;

  function run(algo, ps, opt = {}) {
    switch (algo) {
      case 'fcfs': return nonPreemptive(ps, [arr, idx]);
      case 'sjf': return nonPreemptive(ps, [bur, arr, idx]);
      case 'srtf': return preemptive(ps, [rem]);
      case 'priority':
        return opt.preemptive ? preemptive(ps, [pri]) : nonPreemptive(ps, [pri, arr, idx]);
      case 'rr': return roundRobin(ps, opt.quantum || 4);
      case 'mlfq': return mlfq(ps, opt.q0 || 4, opt.q1 || 8);
      default: throw new Error('Unknown algorithm: ' + algo);
    }
  }

  /* ---------- Rule-based recommender ---------- */
  function analyze(ps) {
    const n = ps.length, b = ps.map(p => p.burst);
    const mean = b.reduce((a, x) => a + x, 0) / n;
    const sd = Math.sqrt(b.reduce((a, x) => a + (x - mean) ** 2, 0) / n);
    const sorted = [...b].sort((x, y) => x - y);
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const arrivals = ps.map(p => p.arrival);
    return {
      n, mean, cv: mean ? sd / mean : 0, median,
      min: sorted[0], max: sorted[n - 1], ratio: sorted[n - 1] / sorted[0],
      spread: Math.max(...arrivals) - Math.min(...arrivals),
      distinctPriorities: new Set(ps.map(p => p.priority)).size,
      shortShare: b.filter(x => x <= mean * 0.5).length / n,
    };
  }

  const NAMES = {
    fcfs: 'First Come First Served', sjf: 'Shortest Job First', srtf: 'Shortest Remaining Time First',
    priority: 'Priority scheduling', rr: 'Round Robin', mlfq: 'Multilevel feedback queue',
  };

  function recommend(ps, goal = 'waiting', opt = {}) {
    const f = analyze(ps);
    const score = {}, why = {};
    Object.keys(NAMES).forEach(k => { score[k] = 0; why[k] = []; });
    const add = (k, pts, text) => { score[k] += pts; why[k].push(text); };
    const q = Math.max(1, Math.round(f.median));

    if (f.spread === 0 && f.cv > 0.5)
      add('sjf', 3, 'All processes arrive together and burst lengths vary a lot, so running the shortest first cuts average waiting time.');
    if (f.spread > 0 && f.cv > 0.5)
      add('srtf', 3, 'Processes arrive over time with uneven lengths, so letting short newcomers jump ahead cuts average waiting time.');
    if (f.cv <= 0.25)
      add('fcfs', 3, 'Burst lengths are similar, so the order hardly matters and FCFS avoids all switching overhead.');
    if (f.distinctPriorities >= 3)
      add('priority', 2, 'Processes carry several different priorities, which Priority scheduling honours directly.');
    if (f.shortShare >= 0.5 && f.n >= 4)
      add('rr', 2, `At least half the jobs are short, so Round Robin (quantum about ${q}) gets everyone a turn quickly.`);
    if (f.ratio >= 5 && f.spread > 0)
      add('mlfq', 3, 'Short and long jobs are mixed and arrive at different times; the feedback queue favours short jobs and demotes long ones automatically.');

    const goals = {
      waiting: () => { add('sjf', 2, 'You asked for the lowest waiting time, which shortest-first policies minimise.'); add('srtf', 2, 'You asked for the lowest waiting time, which shortest-first policies minimise.'); },
      response: () => { add('rr', 2, 'You asked for fast response, and Round Robin gives every process the CPU within one round.'); add('mlfq', 1, 'New processes start in the top queue, so they respond quickly.'); },
      fairness: () => { add('rr', 2, 'You asked for fairness, and Round Robin gives every process equal CPU slices.'); add('fcfs', 1, 'FCFS never starves anyone.'); },
      priorities: () => add('priority', 3, 'You asked to respect priorities, which is exactly what Priority scheduling does.'),
    };
    (goals[goal] || goals.waiting)();

    const measured = {};
    Object.keys(NAMES).forEach(k => { measured[k] = run(k, ps, { quantum: q, q0: q, q1: q * 2, ...opt }); });

    const ranking = Object.keys(NAMES)
      .map(k => ({ algo: k, name: NAMES[k], score: score[k], reasons: why[k], result: measured[k] }))
      .sort((a, b) => b.score - a.score || a.result.avg.waiting - b.result.avg.waiting);
    const bestMeasured = [...ranking].sort((a, b) => a.result.avg.waiting - b.result.avg.waiting)[0];
    return { features: f, ranking, top: ranking[0], bestMeasured, quantum: q };
  }

  return { run, analyze, recommend, NAMES };
})();

if (typeof module !== 'undefined') module.exports = Sched;

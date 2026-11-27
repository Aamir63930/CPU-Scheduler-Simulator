# Smart CPU Process Manager

Intelligent CPU Process Management and Monitoring System, as a website with one page per function.

## Run it

```
pip install -r requirements.txt
python app.py
```

The browser opens automatically. If it does not, open http://127.0.0.1:5000 yourself. Keep the terminal open while you use the pages.

To raise a process's priority (or change other users' processes), start the server with
`sudo python app.py` on Linux/macOS, or from an Administrator terminal on Windows.
Lowering priority works without it.

## Pages

| Page | What it does | Needs backend |
|---|---|---|
| Dashboard (`index.html`) | Live CPU, memory, per-core load, busiest processes | yes |
| Process monitor (`monitor.html`) | Searchable, sortable list of every process | yes |
| Change priority (`priority-control.html`) | Set priority, raise/lower a level, suspend, resume, terminate, change log | yes |
| First Come First Served (`fcfs.html`) | FCFS simulation, Gantt chart, metrics | no |
| Shortest Job First (`sjf.html`) | Non-preemptive SJF | no |
| Shortest Remaining Time (`srtf.html`) | Preemptive SJF | no |
| Priority scheduling (`priority-scheduling.html`) | Preemptive or non-preemptive | no |
| Round Robin (`round-robin.html`) | Adjustable time quantum | no |
| Multilevel feedback queue (`multilevel.html`) | 3 queues, adjustable quanta | no |
| Compare algorithms (`compare.html`) | All six on one workload, best values highlighted | no |
| Scheduling recommender (`recommender.html`) | Rule-based recommendation checked by simulation | no |

The scheduling pages share one workload (saved in the browser), so you enter it once.
They also work by opening the HTML files directly, without the server.

## Files

- `app.py` - Flask + psutil backend (`/api/system`, `/api/processes`, `/api/action`, `/api/log`)
- `static/scheduler.js` - all scheduling algorithms, metrics and the recommender rules
- `static/common.js`, `pages.js`, `live.js`, `style.css` - shared UI and page logic

## Notes

- A background thread reads the process list every 1.5 seconds and the pages read the saved result, so the pages stay fast even on Windows with 300+ processes.
- "System Idle Process" (PID 0 on Windows) is hidden because it is spare CPU time, not a program.
- The server only listens on 127.0.0.1 because it can change and terminate processes.
- Priority levels map to nice values on Linux/macOS (19, 10, 0, -5, -10) and to priority classes on Windows.
- Conventions: lower priority number = higher priority; arrivals during a Round Robin slice join the queue before the preempted process.

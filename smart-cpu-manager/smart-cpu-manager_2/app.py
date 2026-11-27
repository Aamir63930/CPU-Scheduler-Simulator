"""Smart CPU Process Manager - local backend.

Serves the web pages in ./static and exposes a small JSON API that reads
live process data and changes process priority using psutil.

Run:  python app.py      then open  http://127.0.0.1:5000
"""
import os
import platform
import threading
import time
import webbrowser
from collections import deque

import psutil
from flask import Flask, jsonify, request

app = Flask(__name__, static_folder="static", static_url_path="")

IS_WIN = platform.system() == "Windows"
CORES = psutil.cpu_count(logical=True) or 1
SELF_PID = os.getpid()

# Five user-facing priority levels, lowest to highest.
LEVELS = ["low", "below", "normal", "above", "high"]

if IS_WIN:
    LEVEL_VALUE = {
        "low": psutil.IDLE_PRIORITY_CLASS,
        "below": psutil.BELOW_NORMAL_PRIORITY_CLASS,
        "normal": psutil.NORMAL_PRIORITY_CLASS,
        "above": psutil.ABOVE_NORMAL_PRIORITY_CLASS,
        "high": psutil.HIGH_PRIORITY_CLASS,
    }
    VALUE_LEVEL = {v: k for k, v in LEVEL_VALUE.items()}
else:
    # nice values: higher number = lower priority.
    LEVEL_VALUE = {"low": 19, "below": 10, "normal": 0, "above": -5, "high": -10}


def level_of(raw):
    """Map a raw OS priority value to one of our five levels."""
    if raw is None:
        return None
    if IS_WIN:
        return VALUE_LEVEL.get(raw, "realtime")
    if raw >= 15:
        return "low"
    if raw >= 5:
        return "below"
    if raw > -5:
        return "normal"
    if raw > -10:
        return "above"
    return "high"


def is_elevated():
    try:
        if IS_WIN:
            import ctypes
            return bool(ctypes.windll.shell32.IsUserAnAdmin())
        return os.geteuid() == 0
    except Exception:
        return False


CHANGES = deque(maxlen=50)


def log_change(pid, name, action, result):
    CHANGES.appendleft({
        "time": time.strftime("%H:%M:%S"),
        "pid": pid,
        "name": name,
        "action": action,
        "result": result,
    })


@app.route("/")
def home():
    return app.send_static_file("index.html")


# ---------------------------------------------------------------------------
# Background sampler
# Reading every process is slow on Windows (looking up the owner name alone can
# take seconds for 300 processes), so ONE thread does it on a timer and the API
# just returns the latest result instantly. It also keeps CPU readings accurate,
# because every reading is taken a steady interval after the last one.
# ---------------------------------------------------------------------------
_lock = threading.Lock()
_state = {"system": None, "procs": []}
_ready = threading.Event()
_users = {}          # (pid, create_time) -> owner name, looked up once per process
_started = False
SAMPLE_EVERY = 1.5   # seconds between samples


def build_row(p):
    """Read one process. Returns (row, cache_key)."""
    with p.oneshot():
        try:
            raw = p.nice()
        except psutil.AccessDenied:
            raw = None
        key = (p.pid, p.create_time())
        user = _users.get(key)
        if user is None:
            try:
                user = p.username()
            except (psutil.AccessDenied, KeyError):
                user = "-"
            _users[key] = user
        row = {
            "pid": p.pid,
            "name": p.name(),
            "user": user,
            "status": p.status(),
            # psutil reports per-core %, so divide to match Task Manager.
            "cpu": round(p.cpu_percent(None) / CORES, 1),
            "mem": round(p.memory_percent(), 1),
            "threads": p.num_threads(),
            "level": level_of(raw),
            "nice": raw if not IS_WIN else None,
        }
    return row, key


def sample_processes():
    rows, live = [], set()
    for p in psutil.process_iter():
        if p.pid == 0:       # Windows "System Idle Process" is idle time, not a program
            continue
        try:
            row, key = build_row(p)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
        rows.append(row)
        live.add(key)
    for k in [k for k in _users if k not in live]:
        _users.pop(k, None)
    return rows


def sample_system():
    per_core = psutil.cpu_percent(interval=None, percpu=True)
    mem = psutil.virtual_memory()
    try:
        load = [round(x, 2) for x in os.getloadavg()]
    except (AttributeError, OSError):
        load = None
    return {
        "cpu": round(sum(per_core) / len(per_core), 1) if per_core else 0,
        "per_core": [round(x, 1) for x in per_core],
        "cores": CORES,
        "memory_percent": mem.percent,
        "memory_used_gb": round(mem.used / 1024 ** 3, 2),
        "memory_total_gb": round(mem.total / 1024 ** 3, 2),
        "processes": len(psutil.pids()),
        "load": load,
        "uptime_s": int(time.time() - psutil.boot_time()),
        "platform": platform.system(),
        "elevated": is_elevated(),
        "levels": LEVEL_VALUE if not IS_WIN else {k: k for k in LEVELS},
    }


def sampler():
    psutil.cpu_percent(interval=None, percpu=True)   # prime the counters
    while True:
        t0 = time.time()
        try:
            procs = sample_processes()
            system_info = sample_system()
            with _lock:
                _state["procs"] = procs
                _state["system"] = system_info
            _ready.set()
        except Exception as exc:  # noqa: BLE001 - keep sampling whatever happens
            print("Sampler error:", exc)
        time.sleep(max(0.5, SAMPLE_EVERY - (time.time() - t0)))


def ensure_sampler():
    global _started
    if not _started:
        _started = True
        threading.Thread(target=sampler, daemon=True).start()


@app.before_request
def _start_sampler_once():
    ensure_sampler()


def refresh_one(pid):
    """After a change, update that one process in the cache so the page shows it at once."""
    try:
        p = psutil.Process(pid)
        with p.oneshot():
            try:
                raw = p.nice()
            except psutil.AccessDenied:
                raw = None
            status = p.status()
        fresh = {"status": status, "level": level_of(raw), "nice": raw if not IS_WIN else None}
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        fresh = None
    with _lock:
        if fresh is None:
            _state["procs"] = [r for r in _state["procs"] if r["pid"] != pid]
        else:
            for r in _state["procs"]:
                if r["pid"] == pid:
                    r.update(fresh)


@app.get("/api/system")
def system():
    _ready.wait(15)
    with _lock:
        data = _state["system"]
    if data is None:
        return jsonify(error="Still collecting data. Try again in a moment."), 503
    return jsonify(data)


@app.get("/api/processes")
def processes():
    _ready.wait(15)
    with _lock:
        rows = [dict(r) for r in _state["procs"]]
    return jsonify(rows)


@app.get("/api/log")
def log():
    return jsonify(list(CHANGES))


@app.post("/api/action")
def action():
    data = request.get_json(silent=True) or {}
    try:
        pid = int(data.get("pid"))
    except (TypeError, ValueError):
        return jsonify(error="A numeric pid is required."), 400
    act = data.get("action")
    level = data.get("level")

    if act not in ("priority", "suspend", "resume", "terminate"):
        return jsonify(error="Unknown action."), 400
    if act in ("suspend", "terminate") and (pid in (0, 4) or pid == SELF_PID):
        return jsonify(error="That process is protected and can't be suspended or terminated."), 403
    if act == "priority" and level not in LEVEL_VALUE:
        return jsonify(error="Choose one of: " + ", ".join(LEVELS) + "."), 400

    name = str(pid)
    try:
        proc = psutil.Process(pid)
        name = proc.name()
        if act == "priority":
            proc.nice(LEVEL_VALUE[level])
            msg = f"Priority set to {level}"
        elif act == "suspend":
            proc.suspend()
            msg = "Suspended"
        elif act == "resume":
            proc.resume()
            msg = "Resumed"
        else:
            proc.terminate()
            msg = "Terminate signal sent"
        log_change(pid, name, act, msg)
        refresh_one(pid)
        return jsonify(ok=True, message=f"{msg}: {name} (PID {pid}).")
    except psutil.NoSuchProcess:
        log_change(pid, name, act, "Failed: process ended")
        return jsonify(error="That process no longer exists."), 404
    except psutil.AccessDenied:
        log_change(pid, name, act, "Failed: permission denied")
        how = "Run the server as Administrator" if IS_WIN else "Run the server with sudo"
        return jsonify(error=f"Permission denied for {name} (PID {pid}). {how} to change it."), 403
    except Exception as exc:  # noqa: BLE001 - report anything else to the page
        log_change(pid, name, act, f"Failed: {exc}")
        return jsonify(error=str(exc)), 500


if __name__ == "__main__":
    URL = "http://127.0.0.1:5000"
    # Bound to localhost only: this server can change and kill processes.
    ensure_sampler()
    print("\nSmart CPU Process Manager is running.")
    print(f"Opening {URL} in your browser. If it doesn't open, paste that address into the browser.")
    print("Keep this terminal open while you use the pages. Press Ctrl+C to stop.\n")
    threading.Timer(1.0, lambda: webbrowser.open(URL)).start()
    try:
        app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
    except OSError:
        print("Port 5000 is already in use. Close the other copy of app.py (or the app using port 5000) and run again.")

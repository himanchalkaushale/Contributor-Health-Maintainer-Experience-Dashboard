#!/usr/bin/env python3
"""
Project launcher for the Contributor Analytics Dashboard.

Starts both the FastAPI backend (uvicorn) and the Vite frontend dev server,
streams their combined output, and shuts both down cleanly on Ctrl+C.

Usage:
    python run.py                # start backend + frontend
    python run.py --backend      # start backend only
    python run.py --frontend     # start frontend only
    python run.py --no-reload    # backend without --reload
"""

import argparse
import os
import signal
import subprocess
import sys
import threading
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "backend")
FRONTEND_DIR = os.path.join(ROOT, "frontend")

BACKEND_HOST = "0.0.0.0"
BACKEND_PORT = "8000"
FRONTEND_PORT = "5173"

IS_WINDOWS = os.name == "nt"


def venv_python():
    """Return the backend virtualenv python, falling back to the current one."""
    candidates = [
        os.path.join(BACKEND_DIR, ".venv", "Scripts", "python.exe"),  # Windows
        os.path.join(BACKEND_DIR, ".venv", "bin", "python"),          # POSIX
        os.path.join(ROOT, ".venv", "Scripts", "python.exe"),
        os.path.join(ROOT, ".venv", "bin", "python"),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    print("[run] WARNING: no .venv found, using current interpreter.")
    return sys.executable


def npm_command():
    """npm is a .cmd shim on Windows and must be invoked via the shell name."""
    return "npm.cmd" if IS_WINDOWS else "npm"


def stream_output(proc, label):
    """Prefix and forward a subprocess's stdout to our stdout."""
    for line in iter(proc.stdout.readline, ""):
        if line:
            sys.stdout.write(f"[{label}] {line}")
            sys.stdout.flush()
    proc.stdout.close()


def start_backend(reload=True):
    py = venv_python()
    cmd = [py, "-m", "uvicorn", "app.main:app", "--host", BACKEND_HOST, "--port", BACKEND_PORT]
    if reload:
        cmd.append("--reload")
    print(f"[run] Starting backend: {' '.join(cmd)}")
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1")
    return subprocess.Popen(
        cmd,
        cwd=BACKEND_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env,
    )


def start_frontend():
    cmd = [npm_command(), "run", "dev"]
    print(f"[run] Starting frontend: {' '.join(cmd)}")
    return subprocess.Popen(
        cmd,
        cwd=FRONTEND_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        shell=IS_WINDOWS,  # needed so Windows resolves npm.cmd
    )


def terminate(proc, label):
    if proc is None or proc.poll() is not None:
        return
    print(f"[run] Stopping {label}...")
    try:
        if IS_WINDOWS:
            # Kill the whole process tree so child node/uvicorn workers exit too.
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
    except Exception as exc:
        print(f"[run] Error stopping {label}: {exc}")


def main():
    parser = argparse.ArgumentParser(description="Run the Contributor Analytics Dashboard.")
    parser.add_argument("--backend", action="store_true", help="Run backend only")
    parser.add_argument("--frontend", action="store_true", help="Run frontend only")
    parser.add_argument("--no-reload", action="store_true", help="Disable backend auto-reload")
    args = parser.parse_args()

    run_backend = not args.frontend
    run_frontend = not args.backend

    procs = []
    threads = []

    try:
        if run_backend:
            backend = start_backend(reload=not args.no_reload)
            procs.append(("backend", backend))
            t = threading.Thread(target=stream_output, args=(backend, "backend"), daemon=True)
            t.start()
            threads.append(t)

        if run_frontend:
            # Small stagger so backend logs appear first.
            time.sleep(1)
            frontend = start_frontend()
            procs.append(("frontend", frontend))
            t = threading.Thread(target=stream_output, args=(frontend, "frontend"), daemon=True)
            t.start()
            threads.append(t)

        print("\n[run] Servers starting:")
        if run_backend:
            print(f"[run]   Backend  -> http://localhost:{BACKEND_PORT}")
        if run_frontend:
            print(f"[run]   Frontend -> http://localhost:{FRONTEND_PORT}")
        print("[run] Press Ctrl+C to stop.\n")

        # Wait until any process exits, then tear everything down.
        while True:
            for label, proc in procs:
                code = proc.poll()
                if code is not None:
                    print(f"[run] {label} exited with code {code}. Shutting down.")
                    return
            time.sleep(0.5)

    except KeyboardInterrupt:
        print("\n[run] Received Ctrl+C.")
    finally:
        for label, proc in procs:
            terminate(proc, label)
        print("[run] All processes stopped.")


if __name__ == "__main__":
    main()

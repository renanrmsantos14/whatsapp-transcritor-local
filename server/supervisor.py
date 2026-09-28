from __future__ import annotations
import subprocess, sys, time
from pathlib import Path

if sys.platform == "win32":
    import msvcrt
else:
    import fcntl

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "data" / "supervisor.lock"


def acquire_lock(lock) -> bool:
    try:
        if sys.platform == "win32":
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except (OSError, IOError):
        return False


def main() -> int:
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    with LOCK.open("a+b") as lock:
        if not acquire_lock(lock): return 0
        delay = 1
        while True:
            process = subprocess.Popen([sys.executable, "-m", "server.launcher"], cwd=ROOT, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            code = process.wait()
            if code == 0: return 0
            time.sleep(delay); delay = min(delay * 2, 60)
if __name__ == "__main__": raise SystemExit(main())

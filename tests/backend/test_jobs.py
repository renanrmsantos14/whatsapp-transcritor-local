import queue
import threading

from server.jobs import JobManager


def test_idle_manager_wakes_for_new_job_and_stops(monkeypatch, tmp_path):
    class FakeProcess:
        alive = True

        def is_alive(self): return self.alive
        def terminate(self): self.alive = False
        def join(self, timeout=None): pass
        def kill(self): self.alive = False

    def fake_spawn(manager):
        manager._process = FakeProcess()
        manager._commands = queue.Queue()
        manager._results = queue.Queue()
        commands.append(manager._commands)
        spawned.set()

    commands = []
    spawned = threading.Event()
    monkeypatch.setattr(JobManager, "_spawn_worker_locked", fake_spawn)
    manager = JobManager(tmp_path)
    path = tmp_path / "audio.ogg"
    path.write_bytes(b"OggS")
    try:
        job = manager.create(path, [])
        assert spawned.wait(1)
        command = commands[0].get(timeout=1)
        assert command[0] == job.job_id
    finally:
        manager.stop()
    assert not manager._thread.is_alive()

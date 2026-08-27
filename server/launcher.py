"""Launcher sem console para o backend local do Windows."""

import uvicorn

from .app import app


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765, log_config=None, access_log=False)

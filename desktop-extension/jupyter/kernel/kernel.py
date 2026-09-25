#!/usr/bin/env python3
"""Minimal Jupyter kernel for MAM (Markdown as Module).

On execute_request, writes the cell source to a temporary ``.mam`` file and
shells out to ``mam run <file> --format json`` (from @mam/cli), streaming the
JSON result back as execution output/errors.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

from ipykernel.kernelbase import Kernel

EXTENSION = ".mam"


def _find_cli() -> str:
    env = os.environ.get("MAM_KERNEL_CLI", "")
    if env:
        return env
    return shutil.which("mam") or "mam"


class MamKernel(Kernel):
    implementation = "mam_kernel"
    implementation_version = "0.1.0"
    language = "mam"
    language_version = "0.1.0"
    language_info = {
        "name": "mam",
        "mimetype": "text/x-mam",
        "file_extension": ".mam",
        "codemirror_mode": {"name": "mam", "mime": "text/x-mam"},
        "pygments_lexer": "markdown",
    }
    banner = "MAM kernel - Markdown as Module"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.cli = _find_cli()
        self._lock = __import__("threading").Lock()

    def _write_cell(self, source: str) -> str:
        fd, path = tempfile.mkstemp(suffix=EXTENSION, prefix="mam_cell_")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(source)
        return path

    def _run_mam(self, path: str) -> dict:
        cmd = [self.cli, "run", path, "--format", "json"]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
                cwd=os.getcwd(),
            )
        except subprocess.TimeoutExpired:
            return {
                "ok": False,
                "error": "mam run timed out after 120s",
                "stdout": "",
                "stderr": "",
                "result": None,
            }
        return {
            "ok": proc.returncode == 0,
            "returncode": proc.returncode,
            "stdout": proc.stdout or "",
            "stderr": proc.stderr or "",
            "result": None,
        }

    def _parse_json(self, stdout: str):
        try:
            return json.loads(stdout)
        except (json.JSONDecodeError, ValueError):
            return None

    def do_execute(
        self,
        code,
        silent,
        store_history=True,
        user_expressions=None,
        allow_stdin=False,
        cell_id=None,
    ):
        self._lock.acquire()
        try:
            if not code.strip():
                return {
                    "status": "ok",
                    "execution_count": self.execution_count,
                    "payload": [],
                    "user_expressions": {},
                }

            path = self._write_cell(code)
            try:
                out = self._run_mam(path)
            finally:
                try:
                    os.unlink(path)
                except OSError:
                    pass

            if not silent:
                if out["stdout"]:
                    parsed = self._parse_json(out["stdout"])
                    if parsed is not None and isinstance(parsed, dict):
                        result = parsed.get("result")
                        if result is not None:
                            self.send_response(
                                self.iopub_socket,
                                "execute_result",
                                {
                                    "execution_count": self.execution_count,
                                    "data": {"application/json": result},
                                    "metadata": {},
                                },
                            )
                        summary = parsed.get("summary")
                        if summary:
                            self.send_response(
                                self.iopub_socket,
                                "stream",
                                {"name": "stdout", "text": str(summary) + "\n"},
                            )
                    else:
                        self.send_response(
                            self.iopub_socket,
                            "stream",
                            {"name": "stdout", "text": out["stdout"]},
                        )
                if out["stderr"]:
                    self.send_response(
                        self.iopub_socket,
                        "stream",
                        {"name": "stderr", "text": out["stderr"]},
                    )

            if out["ok"]:
                return {
                    "status": "ok",
                    "execution_count": self.execution_count,
                    "payload": [],
                    "user_expressions": {},
                }

            ename = "MamRunError"
            evalue = (out["stderr"] or out["stdout"] or "mam run failed").strip()
            if not silent:
                self.send_response(
                    self.iopub_socket,
                    "error",
                    {
                        "ename": ename,
                        "evalue": evalue,
                        "traceback": [evalue],
                    },
                )
            return {
                "status": "error",
                "ename": ename,
                "evalue": evalue,
                "traceback": [evalue],
                "execution_count": self.execution_count,
            }
        finally:
            self._lock.release()

    def do_shutdown(self, restart):
        return {"status": "ok", "restart": restart}


def main() -> None:
    parser = argparse.ArgumentParser(description="MAM Jupyter kernel")
    parser.add_argument("-f", "--connection-file", required=True)
    args = parser.parse_args()

    from ipykernel.kernelapp import IPKernelApp

    class MamKernelApp(IPKernelApp):
        name = "mam"
        classes = [MamKernel]
        kernel_class = MamKernel

    app = MamKernelApp.instance(connection_file=args.connection_file)
    app.initialize([])
    app.start()


if __name__ == "__main__":
    main()
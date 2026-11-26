#!/usr/bin/env python3
"""
Lightweight host-side updater daemon for MarcFlow.
Runs on the Azure VM host and accepts authenticated update requests from the
marcflow-app container over the Docker bridge network.
"""

from __future__ import annotations

import hmac
import ipaddress
import json
import os
import subprocess
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional

PROJECT_DIR = Path(os.environ.get("MARCFLOW_PROJECT_DIR", "/home/azureuser/marcflow")).resolve()
STATE_FILE = Path(os.environ.get("UPDATER_STATE_FILE", "/tmp/marcflow-updater-state.json"))
HOST = os.environ.get("UPDATER_HOST", "0.0.0.0")
PORT = int(os.environ.get("UPDATER_PORT", "9898"))
MAX_LOG_LINES = 200

_lock = threading.Lock()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_stamp() -> str:
    return datetime.now().strftime("%H:%M:%S")


def load_secret() -> str:
    env_secret = os.environ.get("SYSTEM_UPDATER_SECRET", "").strip()
    if env_secret:
        return env_secret

    env_file = PROJECT_DIR / ".env"
    if env_file.exists():
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            if key.strip() == "SYSTEM_UPDATER_SECRET":
                return val.strip().strip('"').strip("'")
    return ""


def default_state() -> Dict[str, Any]:
    return {
        "state": "idle",
        "step": "Aguardando",
        "progress": 0,
        "logs": [],
        "targetSha": "",
        "startedAt": None,
        "finishedAt": None,
        "error": None,
    }


def read_state() -> Dict[str, Any]:
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    return default_state()


def write_state(data: Dict[str, Any]) -> None:
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(STATE_FILE)


def update_state(
    *,
    state: Optional[str] = None,
    step: Optional[str] = None,
    progress: Optional[int] = None,
    append_log: Optional[str] = None,
    target_sha: Optional[str] = None,
    started_at: Optional[str] = None,
    finished_at: Optional[str] = None,
    error: Optional[str] = None,
    clear_logs: bool = False,
) -> Dict[str, Any]:
    with _lock:
        current = read_state()
        if clear_logs:
            current["logs"] = []
        if state is not None:
            current["state"] = state
        if step is not None:
            current["step"] = step
        if progress is not None:
            current["progress"] = progress
        if target_sha is not None:
            current["targetSha"] = target_sha
        if started_at is not None:
            current["startedAt"] = started_at
        if finished_at is not None:
            current["finishedAt"] = finished_at
        if error is not None or state == "running":
            current["error"] = error
        if append_log:
            logs: List[str] = current.get("logs") or []
            logs.append(f"[{log_stamp()}] {append_log}")
            current["logs"] = logs[-MAX_LOG_LINES:]
        write_state(current)
        return current


def run_streaming_command(cmd: List[str], start_progress: int, end_progress: int) -> None:
    proc = subprocess.Popen(
        cmd,
        cwd=str(PROJECT_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    lines_seen = 0
    assert proc.stdout is not None
    for raw_line in proc.stdout:
        line = raw_line.rstrip()
        if not line:
            continue
        lines_seen += 1
        pct = min(end_progress, start_progress + min(lines_seen * 2, max(0, end_progress - start_progress)))
        update_state(progress=pct, append_log=line)

    rc = proc.wait()
    if rc != 0:
        raise RuntimeError(f"Comando {' '.join(cmd)} falhou com código {rc}.")


def execute_update(target_sha: str) -> None:
    try:
        update_state(
            state="running",
            step="[1/4] Baixando imagem atualizada do GitHub Container Registry...",
            progress=15,
            append_log="Iniciando docker compose pull app...",
            target_sha=target_sha,
            started_at=utc_now_iso(),
            finished_at=None,
            error=None,
            clear_logs=True,
        )
        run_streaming_command(["docker", "compose", "pull", "app"], 20, 65)

        update_state(
            step="[2/4] Recriando container marcflow-app (sem desligar o MySQL)...",
            progress=72,
            append_log="Executando docker compose up -d --no-build --no-deps app...",
        )
        run_streaming_command(
            ["docker", "compose", "up", "-d", "--no-build", "--no-deps", "app"],
            75,
            88,
        )

        update_state(
            step="[3/4] Limpando imagens antigas da VM...",
            progress=92,
            append_log="Executando docker image prune -f...",
        )
        run_streaming_command(["docker", "image", "prune", "-f"], 93, 97)

        update_state(
            state="succeeded",
            step="[4/4] Atualização aplicada. Aguardando o servidor finalizar o boot...",
            progress=100,
            append_log="Container atualizado com sucesso!",
            finished_at=utc_now_iso(),
            error=None,
        )
    except Exception as exc:
        update_state(
            state="failed",
            step="Falha ao aplicar atualização.",
            progress=100,
            append_log=f"ERRO: {exc}",
            finished_at=utc_now_iso(),
            error=str(exc),
        )


def is_allowed_client(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str)
        return addr.is_loopback or addr.is_private
    except ValueError:
        return False


class UpdaterHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _send_json(self, code: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorize(self) -> bool:
        if not is_allowed_client(self.client_address[0]):
            self._send_json(403, {"error": "Origem não permitida."})
            return False

        expected = load_secret()
        if not expected:
            self._send_json(503, {"error": "SYSTEM_UPDATER_SECRET não configurado no host."})
            return False

        auth_header = self.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            self._send_json(401, {"error": "Token ausente."})
            return False

        provided = auth_header[7:].strip()
        if not hmac.compare_digest(provided, expected):
            self._send_json(401, {"error": "Token inválido."})
            return False
        return True

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send_json(200, {"ok": True, "time": time.time()})
            return

        if not self._authorize():
            return

        if self.path == "/status":
            with _lock:
                state = read_state()
            self._send_json(200, state)
            return

        self._send_json(404, {"error": "Rota não encontrada."})

    def do_POST(self) -> None:
        if not self._authorize():
            return

        if self.path != "/update":
            self._send_json(404, {"error": "Rota não encontrada."})
            return

        length = int(self.headers.get("Content-Length", "0") or 0)
        raw_body = self.rfile.read(length) if length > 0 else b"{}"
        try:
            body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
        except Exception:
            body = {}

        target_sha = str(body.get("targetSha") or "").strip()

        with _lock:
            current = read_state()
            if current.get("state") == "running":
                self._send_json(409, {
                    "error": "Já existe uma atualização em andamento.",
                    **current,
                })
                return

        worker = threading.Thread(target=execute_update, args=(target_sha,), daemon=True)
        worker.start()

        # Pequena espera para garantir que o estado inicial já foi gravado
        time.sleep(0.15)
        with _lock:
            state = read_state()
        self._send_json(202, state)


def main() -> None:
    if not STATE_FILE.exists():
        write_state(default_state())
    server = ThreadingHTTPServer((HOST, PORT), UpdaterHandler)
    print(f"MarcFlow host updater listening on {HOST}:{PORT} for {PROJECT_DIR}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

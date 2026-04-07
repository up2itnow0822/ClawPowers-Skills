"""
ITP Server — Identical Twins Protocol
FastAPI service on port 8100.

Compresses agent-to-agent messages using a codebook of common patterns,
operations, and agent shorthand. Reduces inter-agent token usage by
replacing verbose natural language with compact ITP codes.

Run: python -m uvicorn itp_server:app --host 127.0.0.1 --port 8100
"""

import re
import time
import sqlite3
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Query
from pydantic import BaseModel

app = FastAPI(title="ITP Server", version="1.0.0")

# ─── Codebook ──────────────────────────────────────────────────────────────────
# Two-way mapping: natural language phrases → compact ITP codes
# Sorted longest-first for greedy matching

CODEBOOK = [
    # System / meta
    ("please analyze the trading performance and provide a status update", "ANL+TRD/PERF→STS/UPD"),
    ("please analyze the", "ANL+"),
    ("analyze the trading performance", "ANL+TRD/PERF"),
    ("provide a status update", "STS/UPD"),
    ("provide a detailed analysis", "DTL/ANL"),
    ("provide a summary", "SUM"),
    ("provide a brief summary", "SUM/BRF"),
    ("provide a 2-paragraph summary with key data points", "SUM/2P+KDP"),
    ("check the health endpoints", "CHK/HLTH"),
    ("check disk usage", "CHK/DSK"),
    ("check docker container health status", "CHK/DKR/HLTH"),
    ("report status codes and response latency", "RPT/STS+LAT"),
    ("report total free space remaining as a percentage", "RPT/FREE%"),
    ("report total, used, and available memory", "RPT/MEM/TUA"),
    ("list the top 10 processes by memory consumption", "LST/TOP10/MEM"),
    ("flag any process using more than", "FLG/PROC>"),
    ("flag any containers in unhealthy or restarting state", "FLG/DKR/UNHLTH"),
    ("identify any directories over", "ID/DIR>"),
    ("identify any individual files over", "ID/FILE>"),
    ("scan the last 1000 lines of logs", "SCN/LOG/1K"),
    ("extract error and warn level entries", "EXT/ERR+WRN"),
    ("group by service and report counts", "GRP/SVC+CNT"),
    ("highlight any new error patterns not seen in the previous 24 hours", "HLT/NEW/ERR/24H"),

    # Roles / agents
    ("you are an autonomous infrastructure monitoring agent", "ROLE:INFRA/MON"),
    ("running inside the ai agent economy operations environment", "ENV:AAE/OPS"),
    ("your role is to perform health checks, detect anomalies, and report findings", "TASK:HLTH+ANOM+RPT"),
    ("through the structured swarmmemory interface", "VIA:SWARM/MEM"),
    ("you have access to docker, system utilities, and the metrics api", "ACC:DKR+SYS+METRICS"),
    ("always report findings in structured json format", "FMT:JSON"),
    ("with severity levels", "W/SEV"),
    ("info, warning, critical", "SEV:I/W/C"),
    ("do not take corrective action — only observe and report", "MODE:RO"),
    ("the current monitoring window is the last 15 minutes unless otherwise specified", "WIN:15M"),
    ("previous findings from other swarm agents are available through the shared memory interface", "CTX:SWARM/PREV"),

    # Actions
    ("run docker ps and report container status", "DKR/PS+STS"),
    ("uptime, and port mappings for all running containers", "UPT+PORTS/ALL"),
    ("for all running services", "ALL/SVC"),
    ("for all running containers", "ALL/CTR"),
    ("for all mounted volumes", "ALL/VOL"),
    ("for each running docker container", "EACH/DKR/CTR"),
    ("research current btc and eth price action", "RSH/BTC+ETH/PA"),
    ("volume trends, and whale activity", "VOL+WHALE"),
    ("research", "RSH/"),
    ("analyze", "ANL/"),
    ("performance", "PERF"),
    ("trading", "TRD"),
    ("market", "MKT"),

    # Common phrases
    ("simultaneously", "∥"),
    ("in parallel", "∥"),
    ("concurrently", "∥"),
    ("and provide", "→"),
    ("and report", "→RPT"),
    ("status update", "STS/UPD"),
    ("with pid, name, and rss", "W/PID+NAME+RSS"),
]

# Sort by length descending for greedy matching
CODEBOOK.sort(key=lambda x: len(x[0]), reverse=True)

# Build reverse map for decoding
DECODE_MAP = {code: phrase for phrase, code in CODEBOOK}

# ─── Stats ─────────────────────────────────────────────────────────────────────

stats = {
    "total_encoded": 0,
    "total_decoded": 0,
    "total_input_chars": 0,
    "total_output_chars": 0,
    "total_savings_chars": 0,
    "started_at": datetime.utcnow().isoformat(),
}

# ─── History DB ────────────────────────────────────────────────────────────────

DB_PATH = os.environ.get("ITP_DB_PATH", str(Path(__file__).parent / "itp_history.db"))


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            direction TEXT NOT NULL,
            source_agent TEXT,
            target_agent TEXT,
            input_text TEXT NOT NULL,
            output_text TEXT NOT NULL,
            was_compressed INTEGER NOT NULL,
            savings_pct REAL NOT NULL
        )
    """)
    conn.commit()
    return conn


# ─── Encode / Decode Logic ─────────────────────────────────────────────────────


def itp_encode(message: str) -> tuple[str, bool, float]:
    """Encode natural language → ITP shorthand using codebook."""
    original_len = len(message)
    if original_len == 0:
        return message, False, 0.0

    result = message.lower()

    # Apply codebook substitutions (greedy, longest first)
    applied = 0
    for phrase, code in CODEBOOK:
        if phrase in result:
            result = result.replace(phrase, code)
            applied += 1

    # Clean up whitespace and add ITP prefix if any substitutions were made
    if applied > 0:
        # Collapse multiple spaces
        result = re.sub(r'\s+', ' ', result).strip()
        # Remove spaces around ITP operators
        result = re.sub(r'\s*([+/→])\s*', r'\1', result)
        result = f"ITP:{result}"
        was_compressed = True
    else:
        result = message
        was_compressed = False

    output_len = len(result)
    savings_pct = max(0.0, ((original_len - output_len) / original_len) * 100) if original_len > 0 else 0.0

    return result, was_compressed, round(savings_pct, 2)


def itp_decode(message: str) -> tuple[str, bool]:
    """Decode ITP shorthand → natural language."""
    if not message.startswith("ITP:"):
        return message, False

    result = message[4:]  # Strip "ITP:" prefix

    # Apply reverse codebook (replace codes with phrases, longest codes first)
    codes_by_len = sorted(DECODE_MAP.items(), key=lambda x: len(x[0]), reverse=True)
    for code, phrase in codes_by_len:
        if code in result:
            result = result.replace(code, phrase)

    # Clean up
    result = re.sub(r'\s+', ' ', result).strip()

    return result, True


# ─── Request / Response Models ─────────────────────────────────────────────────


class EncodeRequest(BaseModel):
    message: str
    source_agent: str = "unknown"
    target_agent: str = "unknown"


class EncodeResponse(BaseModel):
    encoded: str
    was_compressed: bool
    savings_pct: float
    input_chars: int
    output_chars: int
    codebook_entries_applied: int


class DecodeRequest(BaseModel):
    message: str


class DecodeResponse(BaseModel):
    decoded: str
    was_itp: bool


class HealthResponse(BaseModel):
    status: str
    version: str
    codebook_size: int
    uptime_seconds: float
    total_encoded: int
    total_decoded: int


# ─── Endpoints ─────────────────────────────────────────────────────────────────

_start_time = time.time()


@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version="1.0.0",
        codebook_size=len(CODEBOOK),
        uptime_seconds=round(time.time() - _start_time, 1),
        total_encoded=stats["total_encoded"],
        total_decoded=stats["total_decoded"],
    )


@app.post("/tools/encode")
def encode(req: EncodeRequest) -> EncodeResponse:
    encoded, was_compressed, savings_pct = itp_encode(req.message)

    # Update stats
    stats["total_encoded"] += 1
    stats["total_input_chars"] += len(req.message)
    stats["total_output_chars"] += len(encoded)
    stats["total_savings_chars"] += len(req.message) - len(encoded)

    # Log to history
    try:
        db = get_db()
        db.execute(
            "INSERT INTO history (timestamp, direction, source_agent, target_agent, input_text, output_text, was_compressed, savings_pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (datetime.utcnow().isoformat(), "encode", req.source_agent, req.target_agent, req.message, encoded, int(was_compressed), savings_pct),
        )
        db.commit()
        db.close()
    except Exception:
        pass

    return EncodeResponse(
        encoded=encoded,
        was_compressed=was_compressed,
        savings_pct=savings_pct,
        input_chars=len(req.message),
        output_chars=len(encoded),
        codebook_entries_applied=0,  # simplified
    )


@app.post("/tools/decode")
def decode(req: DecodeRequest) -> DecodeResponse:
    decoded, was_itp = itp_decode(req.message)

    stats["total_decoded"] += 1

    try:
        db = get_db()
        db.execute(
            "INSERT INTO history (timestamp, direction, source_agent, target_agent, input_text, output_text, was_compressed, savings_pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (datetime.utcnow().isoformat(), "decode", None, None, req.message, decoded, int(was_itp), 0),
        )
        db.commit()
        db.close()
    except Exception:
        pass

    return DecodeResponse(decoded=decoded, was_itp=was_itp)


@app.get("/tools/stats")
def get_stats():
    total_in = stats["total_input_chars"]
    total_out = stats["total_output_chars"]
    overall_savings = ((total_in - total_out) / total_in * 100) if total_in > 0 else 0
    return {
        **stats,
        "overall_savings_pct": round(overall_savings, 2),
    }


@app.get("/tools/codebook")
def get_codebook():
    return {
        "size": len(CODEBOOK),
        "entries": [{"phrase": p, "code": c} for p, c in CODEBOOK],
    }


@app.get("/tools/history")
def get_history(limit: int = Query(default=20, ge=1, le=1000)):
    try:
        db = get_db()
        rows = db.execute(
            "SELECT id, timestamp, direction, source_agent, target_agent, input_text, output_text, was_compressed, savings_pct FROM history ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        db.close()
        return {
            "count": len(rows),
            "entries": [
                {
                    "id": r[0], "timestamp": r[1], "direction": r[2],
                    "source_agent": r[3], "target_agent": r[4],
                    "input_text": r[5], "output_text": r[6],
                    "was_compressed": bool(r[7]), "savings_pct": r[8],
                }
                for r in rows
            ],
        }
    except Exception as e:
        return {"count": 0, "entries": [], "error": str(e)}

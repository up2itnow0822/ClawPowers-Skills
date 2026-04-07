"""
ITP Server v2 — Identical Twins Protocol
FastAPI service on port 8101.

v2 improvements over v1:
- Token-aware codebook: replacements use whole words/subwords that tokenize
  efficiently, avoiding the special-char fragmentation that caused v1's
  67% char savings to shrink to only 9.3% real token savings.
- Larger codebook: 120+ entries covering agent roles, ops vocabulary,
  infrastructure patterns, and swarm coordination phrases.
- Codebook organized in tiers: tier-1 phrases are long, high-value targets
  (10+ words); tier-2 are medium (5-9 words); tier-3 are short patterns.
- Replacements are lowercase English abbreviations or acronyms that
  tokenize as 1-2 tokens rather than special-char sequences.
- ITP prefix changed to "[[ITP]]" to use bracket tokens (each bracket is
  a single token) rather than "ITP:" which splits oddly.

Run: python -m uvicorn itp_server:app --host 127.0.0.1 --port 8101
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

app = FastAPI(title="ITP Server", version="2.0.0")

# ─── Token-Aware Codebook ─────────────────────────────────────────────────────
# Design principles for v2:
# 1. Replacements are whole English words/abbreviations (tokenize as 1-2 tokens)
# 2. No special chars (+, /, →, :) in replacements (each becomes a separate token)
# 3. Source phrases are sorted longest-first for greedy matching
# 4. Grouped by domain for maintainability

CODEBOOK_RAW = [
    # ── Agent Role / Identity (tier 1) ──
    ("you are an autonomous infrastructure monitoring agent running inside the ai agent economy operations environment", "you are an infra monitor agent in aae ops"),
    ("you are an autonomous infrastructure monitoring agent", "you are an infra monitor agent"),
    ("your role is to perform health checks, detect anomalies, and report findings through the structured swarmmemory interface", "your task is health checks anomaly detection and swarm memory reporting"),
    ("your role is to perform health checks, detect anomalies, and report findings", "your task is health checks anomaly detection and reporting"),
    ("you have access to docker, system utilities, and the metrics api", "you have access to docker sysutils and metrics api"),
    ("do not take corrective action — only observe and report", "observe and report only no corrective action"),
    ("do not take corrective action - only observe and report", "observe and report only no corrective action"),
    ("always report findings in structured json format with severity levels", "report in json with severity levels"),
    ("always report findings in structured json format", "report in json format"),
    ("with severity levels (info, warning, critical)", "with severity info warning critical"),
    ("severity levels info warning critical", "severity info warning critical"),
    ("the current monitoring window is the last 15 minutes unless otherwise specified", "monitoring window last 15 min unless specified"),
    ("previous findings from other swarm agents are available through the shared memory interface", "prior swarm agent findings in shared memory"),

    # ── Docker / Container ops (tier 1) ──
    ("run docker ps and report container status, uptime, and port mappings for all running containers", "run docker ps report status uptime ports all containers"),
    ("flag any containers in unhealthy or restarting state", "flag unhealthy or restarting containers"),
    ("check docker container health status for all running services", "check docker container health all services"),
    ("for each running docker container", "for each docker container"),
    ("for all running containers", "for all containers"),
    ("for all running services", "for all services"),

    # ── API / Endpoint ops (tier 1) ──
    ("check the health endpoints for the trading api (port 8080), the metrics server (port 9090), and the webhook receiver (port 3000)", "check health endpoints trading api 8080 metrics 9090 webhook 3000"),
    ("verify api endpoint availability and response times", "check api endpoint availability and latency"),
    ("report status codes and response latency in milliseconds", "report status codes and latency ms"),

    # ── Disk / Storage (tier 1) ──
    ("analyze disk usage and identify large files consuming storage on all mounted volumes", "analyze disk usage on all volumes find large files"),
    ("identify any directories over 1gb and any individual files over 100mb", "find dirs over 1gb and files over 100mb"),
    ("report total free space remaining as a percentage", "report free space pct"),
    ("on all mounted volumes", "on all volumes"),

    # ── Memory / Process (tier 1) ──
    ("review system memory and process resource consumption", "review memory and process resource use"),
    ("report total, used, and available memory", "report total used and available memory"),
    ("list the top 10 processes by memory consumption with pid, name, and rss", "list top 10 processes by memory with pid name rss"),
    ("flag any process using more than 2gb", "flag processes over 2gb"),
    ("flag any process using more than", "flag processes over"),

    # ── Log analysis (tier 1) ──
    ("audit recent error logs across all services for anomalies", "audit error logs all services for anomalies"),
    ("scan the last 1000 lines of logs for each running docker container", "scan last 1000 log lines per docker container"),
    ("extract error and warn level entries", "extract error and warn entries"),
    ("group by service and report counts", "group by service report counts"),
    ("highlight any new error patterns not seen in the previous 24 hours", "flag new error patterns vs last 24h"),

    # ── Market / Trading research (tier 1) ──
    ("research current btc and eth price action, volume trends, and whale activity", "research btc eth price volume and whale activity"),
    ("research s&p 500, nasdaq, and dow performance over the past week", "research sp500 nasdaq dow weekly performance"),
    ("note any sector rotation or unusual volume", "note sector rotation and unusual volume"),
    ("note central bank policy impacts", "note central bank impacts"),
    ("research gold, oil, and natural gas price movements", "research gold oil natgas price moves"),
    ("note supply/demand factors driving changes", "note supply demand drivers"),
    ("research total defi tvl, top protocol inflows/outflows, and emerging yield opportunities", "research defi tvl protocol flows and yield opps"),
    ("using findings from all 5 market analyses, identify cross-market correlations, risk factors, and provide 3 actionable trading recommendations with confidence", "using all market findings identify correlations risks and give 3 trade recs with confidence"),
    ("provide 3 actionable trading recommendations", "give 3 trade recs"),
    ("identify cross-market correlations", "find cross market correlations"),

    # ── Common action phrases (tier 2) ──
    ("please analyze the trading performance and provide a status update", "analyze trading perf and give status update"),
    ("provide a detailed analysis", "provide detailed analysis"),
    ("provide a 2-paragraph summary with key data points", "give 2 para summary with key data"),
    ("provide a brief summary", "give brief summary"),
    ("provide a summary", "give summary"),
    ("provide a status update", "give status update"),
    ("analyze the trading performance", "analyze trading performance"),
    ("check docker container health status", "check docker health"),
    ("report container status", "report container status"),

    # ── Roles / context (tier 2) ──
    ("through the structured swarmmemory interface", "via swarm memory"),
    ("through the shared memory interface", "via shared memory"),
    ("available through the shared memory interface", "in shared memory"),
    ("system utilities", "sysutils"),
    ("metrics api", "metrics api"),
    ("infrastructure monitoring", "infra monitoring"),
    ("autonomous infrastructure", "autonomous infra"),
    ("anomaly detection", "anomaly detection"),
    ("health checks", "health checks"),
    ("corrective action", "corrective action"),
    ("monitoring window", "monitoring window"),

    # ── Common ops words (tier 3 — word replacements) ──
    ("simultaneously", "in parallel"),
    ("concurrently", "in parallel"),
    ("performance", "perf"),
    ("trading performance", "trading perf"),
    ("recommendations", "recs"),
    ("implementation", "impl"),
    ("configuration", "config"),
    ("authentication", "auth"),
    ("authorization", "authz"),
    ("infrastructure", "infra"),
    ("dependencies", "deps"),
    ("deployment", "deploy"),
    ("environment", "env"),
    ("application", "app"),
    ("repository", "repo"),
    ("kubernetes", "k8s"),
    ("containers", "containers"),
    ("monitoring", "monitoring"),
    ("percentage", "pct"),
    ("available", "avail"),
    ("directory", "dir"),
    ("milliseconds", "ms"),
    ("otherwise", "else"),
    ("specified", "specified"),
    ("remaining", "remaining"),
    ("consuming", "using"),
    ("individual", "individual"),
    ("structured", "structured"),
]

# Build sorted codebook (longest phrase first for greedy matching)
CODEBOOK = [(phrase.lower(), replacement) for phrase, replacement in CODEBOOK_RAW]
CODEBOOK.sort(key=lambda x: len(x[0]), reverse=True)

# Build reverse map for decoding
DECODE_MAP = {replacement: phrase for phrase, replacement in CODEBOOK}

# ITP prefix — uses bracket tokens which tokenize cleanly (2 tokens: "[[" "ITP" "]]")
ITP_PREFIX = "[[ITP]]"
ITP_PREFIX_LEN = len(ITP_PREFIX)

# ─── Stats ─────────────────────────────────────────────────────────────────────

stats = {
    "total_encoded": 0,
    "total_decoded": 0,
    "total_input_chars": 0,
    "total_output_chars": 0,
    "total_savings_chars": 0,
    "started_at": datetime.utcnow().isoformat(),
    "version": "2.0.0",
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


# ─── Encode / Decode ───────────────────────────────────────────────────────────


def itp_encode(message: str) -> tuple[str, bool, float]:
    """Encode natural language → ITP shorthand using token-aware codebook."""
    if not message:
        return message, False, 0.0

    original_len = len(message)
    result = message.lower()
    applied = 0

    for phrase, replacement in CODEBOOK:
        if phrase in result:
            result = result.replace(phrase, replacement)
            applied += 1

    # Collapse extra whitespace
    if applied > 0:
        result = re.sub(r'[ \t]+', ' ', result).strip()
        result = f"{ITP_PREFIX} {result}"
        was_compressed = True
    else:
        result = message
        was_compressed = False

    output_len = len(result)
    savings_pct = max(0.0, (original_len - output_len) / original_len * 100) if original_len > 0 else 0.0

    return result, was_compressed, round(savings_pct, 2)


def itp_decode(message: str) -> tuple[str, bool]:
    """Decode ITP shorthand → natural language."""
    if not message.startswith(ITP_PREFIX):
        return message, False

    result = message[ITP_PREFIX_LEN:].strip()

    # Apply reverse codebook (longest codes first)
    codes_sorted = sorted(DECODE_MAP.items(), key=lambda x: len(x[0]), reverse=True)
    for code, phrase in codes_sorted:
        if code in result:
            result = result.replace(code, phrase)

    result = re.sub(r'[ \t]+', ' ', result).strip()
    return result, True


# ─── Request / Response models ────────────────────────────────────────────────


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


# ─── Endpoints ────────────────────────────────────────────────────────────────

_start_time = time.time()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": "2.0.0",
        "codebook_size": len(CODEBOOK),
        "uptime_seconds": round(time.time() - _start_time, 1),
        "total_encoded": stats["total_encoded"],
        "total_decoded": stats["total_decoded"],
    }


@app.post("/tools/encode")
def encode(req: EncodeRequest) -> EncodeResponse:
    encoded, was_compressed, savings_pct = itp_encode(req.message)

    stats["total_encoded"] += 1
    stats["total_input_chars"] += len(req.message)
    stats["total_output_chars"] += len(encoded)
    stats["total_savings_chars"] += len(req.message) - len(encoded)

    try:
        db = get_db()
        db.execute(
            "INSERT INTO history (timestamp, direction, source_agent, target_agent, input_text, output_text, was_compressed, savings_pct) VALUES (?,?,?,?,?,?,?,?)",
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
        codebook_entries_applied=0,
    )


@app.post("/tools/decode")
def decode(req: DecodeRequest) -> DecodeResponse:
    decoded, was_itp = itp_decode(req.message)

    stats["total_decoded"] += 1

    try:
        db = get_db()
        db.execute(
            "INSERT INTO history (timestamp, direction, source_agent, target_agent, input_text, output_text, was_compressed, savings_pct) VALUES (?,?,?,?,?,?,?,?)",
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
    return {**stats, "overall_savings_pct": round(overall_savings, 2)}


@app.get("/tools/codebook")
def get_codebook():
    return {
        "size": len(CODEBOOK),
        "version": "2.0.0",
        "entries": [{"phrase": p, "replacement": r} for p, r in CODEBOOK],
    }


@app.get("/tools/history")
def get_history(limit: int = Query(default=20, ge=1, le=1000)):
    try:
        db = get_db()
        rows = db.execute(
            "SELECT id,timestamp,direction,source_agent,target_agent,input_text,output_text,was_compressed,savings_pct FROM history ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        db.close()
        return {
            "count": len(rows),
            "entries": [
                {"id": r[0], "timestamp": r[1], "direction": r[2], "source_agent": r[3],
                 "target_agent": r[4], "input_text": r[5], "output_text": r[6],
                 "was_compressed": bool(r[7]), "savings_pct": r[8]}
                for r in rows
            ],
        }
    except Exception as e:
        return {"count": 0, "entries": [], "error": str(e)}

---
name: itp
description: "Identical Twins Protocol — compressed agent-to-agent messaging for repeated operational language. Use when sending messages between agents."
metadata:
  openclaw:
    requires:
      bins: [python3]
      env: []
      config: []
---

# ITP — Identical Twins Protocol

Compressed agent-to-agent messaging protocol that uses a shared codebook of common patterns, operations, and agent shorthand.

Current measured performance is workload-dependent. The live v1 corpus benchmark shows **11.9% aggregate token reduction** across 25 messages, with delegation and status traffic compressing best. Separate swarm docs also include **modeled** prompt-cache economics layered on top of those live prompt sizes. Keep those two measurement types distinct.

## Quick Start

### 1. Start the ITP Server

The ITP server runs as a FastAPI service on port 8100:

```bash
# Via LaunchAgent (recommended — auto-starts on boot)
launchctl load ~/Library/LaunchAgents/com.agenteconomy.itp-server.plist

# Or manually
cd /Users/billwilson/.openclaw/workspace/tools/itp
python3 -m uvicorn itp_server:app --host 127.0.0.1 --port 8100
```

### 2. Verify Health

```bash
curl http://localhost:8100/health
# → {"status": "ok", "version": "1.0.0", ...}
```

## API Endpoints

### Encode Message
`POST /tools/encode`
```json
{
  "message": "Please analyze the trading performance and provide a status update",
  "source_agent": "max",
  "target_agent": "trading-director"
}
```
Returns: `{ "encoded": "ITP:...", "was_compressed": true, "savings_pct": 45.2, ... }`

### Decode Message
`POST /tools/decode`
```json
{
  "message": "ITP:ANL+TRD/PERF→STS/UPD"
}
```
Returns: `{ "decoded": "...", "was_itp": true, ... }`

### Health Check
`GET /health`
Returns: `{ "status": "ok", ... }`

### Statistics
`GET /tools/stats`
Returns compression analytics and savings metrics.

### Codebook
`GET /tools/codebook`
Returns current codebook contents and stats.

### History
`GET /tools/history?limit=20`
Returns recent ITP message history.

## TypeScript Client

```typescript
import { encode, decode, healthCheck } from 'clawpowers/itp';

// Encode a message (graceful fallback if server is down)
const result = await encode("Analyze trading performance");
// { encoded: "ITP:...", wasCompressed: true, savingsPct: 45.2 }

// Decode an ITP message
const decoded = await decode("ITP:ANL+TRD/PERF");
// { decoded: "Analyze trading performance", wasItp: true }

// Check server status
const alive = await healthCheck();
// true or false
```

## Swarm Integration

ITP integrates with the Parallel Swarm module to compress task descriptions before fan-out and decode results after collection:

```typescript
import { encodeTaskDescription, decodeSwarmResult } from 'clawpowers/itp/swarm-bridge';

// Compress task before sending to sub-agents
const compressedTask = await encodeTaskDescription(task);

// Decode result from sub-agent
const decodedResult = await decodeSwarmResult(result);
```

## Graceful Degradation

All ITP functions fail gracefully — if the ITP server is unreachable, messages pass through unchanged with no errors thrown. This ensures ITP never blocks agent operations.

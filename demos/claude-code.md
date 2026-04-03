# ClawPowers × Claude Code Integration

Add this to your `CLAUDE.md` to wire ClawPowers capabilities into Claude Code sessions.

## CLAUDE.md Snippet

```markdown
## ClawPowers Skills Library

This project uses `clawpowers` for payments, memory, and RSI capabilities.

### Payment Flow (x402)

When you encounter an HTTP 402 response:
1. Parse the x402 headers using `detect402()` from `clawpowers`
2. Check spending policy with `SpendingPolicy.checkTransaction()`
3. Execute payment via `PaymentExecutor.executePayment()`
4. Never auto-retry failed payments

### Memory System

- **Working Memory:** In-process context with token budget (`WorkingMemoryManager`)
- **Episodic Memory:** JSONL task history at `~/.clawpowers/memory/episodic.jsonl`
- **Procedural Memory:** Skill effectiveness tracking at `~/.clawpowers/memory/procedural.json`
- **Checkpoints:** Crash recovery at `~/.clawpowers/state/checkpoints/`

### RSI (Recursive Self-Improvement)

Tiers:
- T1 (auto): Parameter tuning — retry counts, timeouts
- T2 (auto): Strategy changes — skill selection order
- T3 (ask): Skill composition — new chains
- T4 (ask): Architecture proposals — ALWAYS requires human approval

### Usage Patterns

```typescript
import {
  SpendingPolicy, PaymentExecutor,
  EpisodicMemory, ProceduralMemory,
  MetricsCollector, HypothesisEngine,
} from 'clawpowers';

// Initialize memory
const episodic = new EpisodicMemory('~/.clawpowers/memory/episodic.jsonl');
const procedural = new ProceduralMemory('~/.clawpowers/memory/procedural.json');

// Record task outcomes
await episodic.append({
  taskId: 'task-123',
  timestamp: new Date().toISOString(),
  description: 'Built auth module',
  outcome: 'success',
  lessonsLearned: ['Always test edge cases'],
  skillsUsed: ['tdd', 'code-review'],
  durationMs: 5000,
  tags: ['auth'],
});

// Track skill effectiveness
await procedural.update('tdd', {
  succeeded: true,
  durationMs: 5000,
  taskId: 'task-123',
});
```

### Safety Rules
- Spending limits are safety invariants — RSI cannot modify them
- T4 can NEVER be set to "auto"
- Failed payments are NEVER auto-retried
```

## Setup

```bash
# Install in your project
npm install clawpowers

# Initialize config
node -e "import('clawpowers').then(c => c.initConfig())"
```

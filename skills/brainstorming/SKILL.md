---
name: brainstorming
description: Structured ideation with convergence protocol. Activate when exploring solutions, designing architecture, or choosing between approaches.
version: 1.0.0
requires:
  tools: []
  runtime: false
metrics:
  tracks: [ideas_generated, ideas_pursued, convergence_time, decision_quality]
  improves: [ideation_breadth, convergence_threshold, idea_linking]
---

# Brainstorming

## When to Use

Apply this skill when:

- A problem has multiple valid solution approaches and you need to choose
- You're designing architecture and haven't committed to a direction
- Someone asks "what should we do?" or "what are our options?"
- You've been executing in one direction and need to verify it's still the right one
- A constraint has changed and the previous approach may no longer be optimal
- Creative solutions are needed (not just standard patterns)

**Skip when:**
- The solution is already determined and execution is what's needed
- There's only one viable approach given the constraints
- You need to converge immediately — brainstorming requires divergence time

**Decision tree:**
```
Is the right approach known?
├── Yes → execute it
└── No  → Is this a known problem pattern?
          ├── Yes → Apply known solution, validate fit with constraints
          └── No  → brainstorming ← YOU ARE HERE
```

## Core Methodology

Brainstorming has two phases: **diverge** (generate many ideas without judgment) and **converge** (evaluate, select, refine). Never mix them — evaluating during generation kills ideas before they can combine into something better.

### Phase 1: Diverge

**Rule:** No evaluation during divergence. Every idea is noted, even obviously bad ones.

**Seed the space with different lenses:**

1. **First-principles lens** — "If we built this from scratch knowing only the requirements, what would we build?"
2. **Constraint-removal lens** — "If [constraint] didn't exist, what's the best solution? Now how do we get closer to it?"
3. **Analogy lens** — "How does [analogous problem domain] solve this?"
4. **Inversion lens** — "What would make this maximally bad? Now invert each item."
5. **Extreme lens** — "What's the simplest possible approach? What's the most powerful?"
6. **Time lens** — "What solution would we regret not choosing in 2 years?"

**Target:** 6-12 distinct ideas before evaluation. If you have fewer than 5, you've stopped too early.

**Divergence output format:**

```markdown
## Idea 1: [Name]
[2-3 sentences: what it is, how it works, why it might be good]
Rough feasibility: [High/Medium/Low]

## Idea 2: [Name]
...
```

### Phase 2: Rapid Pre-Filter

After divergence, apply a quick filter before full evaluation:

**Pre-filter criteria:**
- Feasible within current constraints? (Hard blocker: eliminate)
- Reversible if wrong? (Irreversible = higher bar to choose)
- Team can execute? (Skill gap = risk, not elimination)

Eliminate only ideas that fail hard feasibility. Keep everything else — your "bad" ideas might combine with your "good" ones.

### Phase 3: Evaluate Remaining Ideas

For each surviving idea, score on:

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Correctness | 30% | Solves the actual problem completely |
| Maintainability | 20% | Team can reason about and change it |
| Performance | 15% | Meets performance requirements |
| Reversibility | 15% | Can be undone if wrong |
| Time to implement | 10% | Fits within timeline constraint |
| Risk | 10% | Known unknowns and failure modes |

**Scoring:** 1-5 per criterion. Weighted total = decision score.

This scoring is a forcing function, not a formula. If the scores conflict with your gut, investigate the gut feeling — it may be capturing a criterion you haven't named.

### Phase 4: Convergence Decision

**Select the highest-scoring idea** unless:
- The second-highest is within 10% and significantly more reversible
- The highest-scoring idea has an unmitigated risk that could invalidate the entire effort
- The team has strong capability gaps that make the highest-scoring idea genuinely infeasible

**Convergence output:**

```markdown
## Decision: [Idea Name]

**Rationale:** [Why this over the alternatives]
**Key trade-off accepted:** [What we're giving up and why that's okay]
**Reversibility:** [Can we change this later? At what cost?]
**Risk mitigations:**
- [Risk 1]: [Mitigation]
- [Risk 2]: [Mitigation]

## Discarded Alternatives
- [Idea N]: Eliminated because [specific reason]
```

The discarded alternatives section is important — it prevents re-litigating the same options in future discussions.

### Phase 5: Spike Plan (if needed)

If the winning idea has a technical unknown, plan a spike (time-boxed experiment):

```markdown
## Spike: Validate [unknown assumption]

**Question:** [Specific question this spike answers]
**Method:** [How to test it]
**Time box:** [Maximum time, then decide based on results]
**Pass criteria:** [What result confirms the approach is viable]
**Fail criteria:** [What result means we choose the fallback]
**Fallback:** [Idea #2 from the evaluation]
```

Spikes that don't have a fallback are bets, not spikes.

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Cross-Session Idea Persistence:**

Ideas don't disappear when the session ends:

```bash
# Save ideas from session
bash runtime/persistence/store.sh set "brainstorm:auth-rate-limiting:idea1" "Token bucket with Redis"
bash runtime/persistence/store.sh set "brainstorm:auth-rate-limiting:idea2" "Fixed window with DB"
bash runtime/persistence/store.sh set "brainstorm:auth-rate-limiting:decision" "Token bucket with Redis"
bash runtime/persistence/store.sh set "brainstorm:auth-rate-limiting:discarded" "Fixed window: stale at window boundary"

# Recall in future session
bash runtime/persistence/store.sh list "brainstorm:auth-rate-limiting:*"
```

This prevents re-debating decisions already made and provides context when the approach needs revisiting.

**Pattern Linking:**

After 10+ brainstorming sessions, `runtime/feedback/analyze.sh` identifies:
- Which lenses generate the most pursued ideas (your most productive divergence strategies)
- Common discarded idea reasons (helps pre-filter faster)
- Idea-to-outcome correlation (were your decisions good?)

**Idea Quality Tracking:**

```bash
bash runtime/metrics/collector.sh record \
  --skill brainstorming \
  --outcome success \
  --notes "rate-limiting: 7 ideas, 1 spike, decision in 25 min"
```

After execution, mark whether the brainstorming decision held up:
```bash
bash runtime/persistence/store.sh set "brainstorm:auth-rate-limiting:outcome" "decision_held"
# or
bash runtime/persistence/store.sh set "brainstorm:auth-rate-limiting:outcome" "pivoted:reason"
```

This feeds the RSI loop — which ideas look good in brainstorming but fail in practice?

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Evaluating during divergence | Kills combination ideas before they form | Strict phase separation |
| Stopping at 2-3 ideas | First ideas are obvious; breakthroughs are later | Force 6-12 before evaluating |
| Skipping the spike | Unknown assumption bites you mid-implementation | Spike anything technically uncertain |
| No fallback on spike | If spike fails, you're stuck | Always name the fallback before spiking |
| Consensus brainstorming | Group thinks converges to average | Diverge individually, converge together |
| Re-opening decided questions | Litigating old decisions halts progress | Document discarded alternatives with reasons |
| Brainstorming without constraints | Unconstrained ideas aren't implementable | State constraints at the start of divergence |

## Examples

### Example 1: Architecture Decision

**Question:** How should we handle cross-service communication?

**Divergence:**
1. REST HTTP calls (synchronous, direct)
2. Message queue (async, decoupled) — Kafka, RabbitMQ, Redis Streams
3. gRPC (typed, fast, binary protocol)
4. GraphQL federation
5. Event sourcing + event bus
6. Shared database (anti-pattern but option)
7. Service mesh with mTLS (Istio)

**Pre-filter:** Option 6 (shared DB) eliminated — violates service isolation. All others survive.

**Evaluation scores:** REST: 72pts | Message queue: 85pts | gRPC: 78pts | Others < 70pts

**Decision:** Message queue (Kafka) — highest score, fully decoupled, reversible per service.

**Spike:** Can our team operate Kafka? → 2-hour spike → yes, managed Confluent resolves ops burden.

### Example 2: Feature Design

**Question:** How should users specify recurring events?

**Divergence (constraint-removal):**
1. cron syntax (powerful, opaque to non-technical users)
2. Natural language parser ("every Monday at 9am")
3. Visual calendar picker (intuitive, limited power)
4. RRULE (RFC 5545 standard, complex)
5. Predefined presets + custom exception
6. Wizard with structured questions

**Convergence:** Option 5 (presets + exceptions) — covers 90% of cases simply, 10% with power.

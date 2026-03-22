---
name: economic-code-optimization
description: Autonomously allocate micro-budgets to improve code quality - premium models, cloud compute, expert reviews, specialized tools. ROI-tracked spending that compounds agent performance over time.
version: 1.0.0
requires:
  tools: []
  runtime: true
  skills: [agent-payments]
metrics:
  tracks: [spend_decisions, amount_spent, roi_ratio, quality_delta, upgrades_purchased]
  improves: [spend_efficiency, roi_accuracy, tier_selection, budget_utilization]
---

# Economic Code Optimization

## When to Use

Apply this skill when:

- A task is complex enough (estimated 2+ hours) that premium resources would meaningfully improve quality or speed
- Confidence is low on a critical PR and a paid expert review would catch issues you'd miss
- Mutation testing or formal verification needs more compute than the local machine provides
- An external API or tool (static analyzer, security scanner, profiler) would produce better results than manual inspection
- The task has high business value and the cost of a bug outweighs the cost of premium resources

Do NOT use when:
- The task is routine (simple CRUD, config changes, docs updates)
- The owner hasn't configured spending limits in `~/.clawpowers/config.json`
- The wallet balance is below the minimum threshold
- The task value doesn't justify any spend (ROI would be negative)

## Background: Why Agents Should Spend Money on Code

Static frameworks assume all resources are equal. They're not.

A $0.003 API call to a premium static analyzer catches bugs that 200 lines of manual review miss. A $0.10 GPU burst runs 10,000 mutation tests in 30 seconds instead of 20 minutes locally. A $2.00 expert review on a security-critical PR prevents a $200,000 vulnerability.

The question isn't whether to spend. It's how much, on what, and whether the ROI justifies it. This skill makes that decision automatically, within hard limits the owner controls.

## Setup

### Configure Spending Limits

Create or update `~/.clawpowers/config.json`:

```json
{
  "economic_optimization": {
    "enabled": true,
    "global_daily_limit_usd": 5.00,
    "per_task_max_usd": 1.00,
    "min_task_value_usd": 50.00,
    "auto_approve_below_usd": 0.10,
    "require_owner_approval_above_usd": 2.00,
    "allowed_categories": ["premium_model", "compute", "static_analysis", "security_scan", "expert_review"]
  }
}
```

If no config exists, the skill operates in dry-run mode - it calculates what it would spend and logs the decision, but doesn't execute any payments.

### Verify Prerequisites

```bash
# Check that agent-payments skill is available
npx clawpowers store get "skill:agent-payments:configured"

# Check wallet balance (if configured)
npx clawpowers store get "wallet:balance:usd"
```

## Core Methodology

### Step 1: Task Value Assessment

Before any spend decision, estimate the task's business value. Be conservative.

**Value heuristics:**

| Task Type | Estimated Value | Rationale |
|-----------|----------------|-----------|
| Security-critical fix | $500-5,000 | Vulnerability cost if shipped |
| Core business logic | $200-1,000 | Revenue impact of bugs |
| Public API change | $100-500 | Breaking changes affect users |
| Performance optimization | $50-200 | Compute savings over time |
| Internal tooling | $20-100 | Developer time savings |
| Docs/config changes | $5-20 | Low risk, low impact |

Record the assessment:

```bash
npx clawpowers store set "eco:${TASK_ID}:estimated_value" "500"
npx clawpowers store set "eco:${TASK_ID}:task_type" "security-critical"
```

### Step 2: Spend Tier Calculation

Calculate the optimal spend as a percentage of task value:

```
spend_budget = min(task_value * spend_ratio, per_task_max)

Spend ratios by complexity:
  Simple (1-3):   0% - no spend needed
  Medium (4-6):   0.5% of task value
  Complex (7-8):  2% of task value  
  Critical (9-10): 5% of task value
```

**Decision tree:**

1. Is `economic_optimization.enabled` true? If no, stop.
2. Is `estimated_value >= min_task_value_usd`? If no, stop - task too small to justify spend.
3. Calculate `spend_budget` using complexity ratio.
4. Is `spend_budget < auto_approve_below_usd`? If yes, proceed automatically.
5. Is `spend_budget > require_owner_approval_above_usd`? If yes, queue for approval and continue with base resources.
6. Otherwise, proceed with spend.

Record the decision:

```bash
npx clawpowers store set "eco:${TASK_ID}:spend_tier" "medium"
npx clawpowers store set "eco:${TASK_ID}:budget_usd" "0.50"
npx clawpowers store set "eco:${TASK_ID}:approved" "auto"
```

### Step 3: Resource Allocation

Based on the budget, select upgrades from this priority list:

**Tier 1: Free optimizations (always apply)**
- Use cached results from `cross-project-knowledge` pattern library
- Apply known-good patterns from previous projects
- Run local linters and type checkers

**Tier 2: Micro-spend ($0.01-0.10)**
- Premium static analysis API call (Semgrep Pro, SonarCloud)
- Extended mutation testing run (2x-5x normal iterations)
- Dependency vulnerability deep scan

**Tier 3: Small spend ($0.10-1.00)**
- Cloud GPU burst for heavy formal verification (1000+ property tests)
- Premium model API call for complex code review (Claude Opus, GPT-4o)
- Performance profiling service for optimization tasks

**Tier 4: Significant spend ($1.00-5.00)**
- Paid expert review routing for security-critical PRs
- Multi-model consensus (run 3 premium models, majority vote on approach)
- Extended cloud compute for exhaustive test generation

Record allocations:

```bash
npx clawpowers store set "eco:${TASK_ID}:allocations" "premium_model,mutation_testing_5x"
```

### Step 4: Execute Spend

Use the `agent-payments` skill for all financial transactions. Never bypass spending limits.

```bash
# Record the spend decision
npx clawpowers metrics record \
  --skill economic-code-optimization \
  --outcome success \
  --duration 0 \
  --notes "Allocated $0.50: premium model ($0.30) + extended mutation testing ($0.20) for task ${TASK_ID}"
```

For each purchased resource, track what was bought and the immediate result:

```bash
npx clawpowers store set "eco:${TASK_ID}:purchase:premium_model:cost" "0.30"
npx clawpowers store set "eco:${TASK_ID}:purchase:premium_model:result" "3 additional edge cases identified"
npx clawpowers store set "eco:${TASK_ID}:purchase:mutation_5x:cost" "0.20"
npx clawpowers store set "eco:${TASK_ID}:purchase:mutation_5x:result" "mutation score 72% -> 91%"
```

### Step 5: Measure ROI

After the task completes, calculate actual return on investment:

```
roi = (quality_improvement_value + time_saved_value) / amount_spent

Quality improvement value:
  - Bugs caught before merge × estimated bug cost = quality value
  - Mutation score improvement × coverage confidence factor

Time saved value:
  - Hours saved by premium resources × hourly rate
```

Record ROI:

```bash
npx clawpowers store set "eco:${TASK_ID}:roi" "4.2"
npx clawpowers store set "eco:${TASK_ID}:bugs_caught" "3"
npx clawpowers store set "eco:${TASK_ID}:time_saved_min" "45"

npx clawpowers metrics record \
  --skill economic-code-optimization \
  --outcome success \
  --duration 2700 \
  --notes "ROI 4.2x: spent $0.50, saved ~$2.10 (3 bugs caught pre-merge, 45 min saved)"
```

### Step 6: Feed Back to Meta-Skill-Evolution

After 10+ economic optimization cycles, patterns emerge:

- Which spend categories produce the highest ROI?
- What's the optimal spend ratio for each task complexity level?
- Are certain tools/services consistently worth their cost?
- Where is the agent over-spending or under-spending?

The `meta-skill-evolution` skill picks up these patterns and adjusts the spend ratios automatically. After 50 cycles, the agent's spending becomes highly efficient - it knows exactly when premium resources pay for themselves.

```bash
# The meta-skill-evolution cycle reads this data automatically
npx clawpowers store list "eco:" | head -20
```

## ClawPowers Enhancement

This skill requires runtime persistence. Without `~/.clawpowers/`:
- Spend decisions can't reference historical ROI
- The agent can't learn which purchases are worthwhile
- Budget tracking across sessions is impossible

With runtime:
- Full spend history with ROI tracking
- Automatic spend ratio optimization over time
- Cross-project spend intelligence (some tools are worth it for all projects)
- Budget compliance verification

## Anti-Patterns

1. **Spending on every task.** Most tasks don't need premium resources. The skill should result in $0 spend on 70%+ of tasks.

2. **Ignoring ROI data.** If a spend category consistently produces ROI < 1.0, stop spending on it. The data is there - use it.

3. **Over-spending on low-value tasks.** A $2 expert review on a README typo fix is waste. The `min_task_value_usd` threshold exists for a reason.

4. **Bypassing spending limits.** Never modify `config.json` programmatically to increase limits. Only the owner adjusts caps.

5. **Spending without tracking.** Every cent spent must be recorded with task ID, category, amount, and result. Untracked spend is unaccountable spend.

6. **Assuming spend equals quality.** Premium resources help, but they don't replace good methodology. Always apply free optimizations (Tier 1) first. Spend only when free options are insufficient.

## Dry-Run Mode

When `economic_optimization.enabled` is false or the config doesn't exist, the skill runs in observation mode:

- Calculates what it would spend on each task
- Logs hypothetical ROI based on task outcomes
- After 20+ dry-run cycles, the agent can show the owner: "Here's what I would have spent and the estimated ROI"
- Owner can then enable with confidence, knowing the agent's spending judgment is calibrated

## References

- `agent-payments` skill: payment execution and wallet interaction
- `meta-skill-evolution` skill: automatic spend ratio optimization
- `agentwallet-sdk` v6.0: non-custodial wallets, spending policies, x402 protocol
- ERC-6551: token-bound accounts with smart-contract spending enforcement

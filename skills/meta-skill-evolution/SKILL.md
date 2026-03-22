---
name: meta-skill-evolution
description: RSI for coding methodology itself. After every 50 completed tasks, analyze outcome patterns, identify the weakest skill, surgically improve it, and commit the evolution. Agents that literally improve their own methodology over time.
version: 1.0.0
requires:
  tools: [bash, git, node]
  runtime: true
metrics:
  tracks: [evolutions_triggered, skills_improved, success_rate_delta, version_bumps, evolution_duration]
  improves: [skill_selection_accuracy, weakest_skill_identification, surgical_edit_quality]
---

# Meta-Skill Evolution

## When to Use

Apply this skill when:

- The task counter reaches a multiple of 50 (tracked in `~/.clawpowers/state/task-counter.json`)
- A skill consistently shows < 70% success rate over the last 20 uses
- `runtime/feedback/analyze.sh` surfaces a skill with declining trend
- Bill explicitly requests "evolve the skills" or "improve methodology"
- A cluster of related task failures points to a methodology gap

**Skip when:**
- Fewer than 50 total tasks have been completed (insufficient signal)
- The runtime directory `~/.clawpowers/` doesn't exist (static mode)
- A previous evolution cycle completed within the last 10 tasks (cooling period)

**Decision tree:**
```
Has task counter hit a multiple of 50?
├── No  → continue working; check counter at next task completion
└── Yes → Run evolution cycle
          └── Does weakest skill have < 80% success rate?
              ├── No  → log "all skills healthy", increment counter, skip
              └── Yes → identify weakest section → surgical edit → version bump → commit
```

## Core Methodology

### Step 1: Trigger and Task Counter

Every completed task increments a persistent counter. After each task:

```bash
# Increment task counter
COUNTER_FILE=~/.clawpowers/state/task-counter.json
CURRENT=$(cat "$COUNTER_FILE" 2>/dev/null | node -e "const d=require('/dev/stdin');console.log(d.count||0)" 2>/dev/null || echo 0)
NEXT=$((CURRENT + 1))
echo "{\"count\": $NEXT, \"last_updated\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$COUNTER_FILE"

# Check if evolution cycle is due
if (( NEXT % 50 == 0 )); then
  echo "Evolution cycle triggered at task $NEXT"
  # → proceed to Step 2
fi
```

**Recording task completion (run this after every task):**
```bash
bash runtime/metrics/collector.sh record \
  --skill <active-skill-name> \
  --outcome success|failure \
  --duration <seconds> \
  --notes "<brief description>"
```

### Step 2: Outcome Pattern Analysis

Pull the last 50 task records and compute per-skill success rates:

```bash
# Analyze outcomes for the last 50 tasks
METRICS_FILE=~/.clawpowers/metrics/outcomes.jsonl

# Per-skill success rate (requires jq or node)
node - <<'EOF'
const fs = require('fs');
const lines = fs.readFileSync(process.env.HOME + '/.clawpowers/metrics/outcomes.jsonl', 'utf8')
  .trim().split('\n').filter(Boolean).slice(-50)
  .map(l => JSON.parse(l));

const stats = {};
for (const rec of lines) {
  const s = rec.skill || 'unknown';
  if (!stats[s]) stats[s] = { success: 0, failure: 0, durations: [] };
  stats[s][rec.outcome === 'success' ? 'success' : 'failure']++;
  if (rec.duration) stats[s].durations.push(rec.duration);
}

const report = Object.entries(stats).map(([skill, d]) => {
  const total = d.success + d.failure;
  const rate = total > 0 ? (d.success / total) : null;
  const avgDuration = d.durations.length > 0
    ? Math.round(d.durations.reduce((a,b)=>a+b,0) / d.durations.length)
    : null;
  return { skill, success_rate: rate, total_tasks: total, avg_duration_s: avgDuration };
}).sort((a, b) => (a.success_rate ?? 1) - (b.success_rate ?? 1));

console.log(JSON.stringify(report, null, 2));
EOF
```

**What to look for:**
- Lowest `success_rate` → weakest skill candidate
- Rising `avg_duration_s` → methodology is too slow or unclear
- High failure count on a single skill → systemic gap, not random noise

### Step 3: Identify the Weakest Skill

```bash
# Get weakest skill (lowest success rate with ≥ 3 data points)
WEAKEST=$(node - <<'EOF'
const fs = require('fs');
const lines = fs.readFileSync(process.env.HOME + '/.clawpowers/metrics/outcomes.jsonl', 'utf8')
  .trim().split('\n').filter(Boolean).slice(-50).map(l => JSON.parse(l));
const stats = {};
for (const rec of lines) {
  const s = rec.skill || 'unknown';
  if (!stats[s]) stats[s] = { success: 0, failure: 0 };
  stats[s][rec.outcome === 'success' ? 'success' : 'failure']++;
}
const ranked = Object.entries(stats)
  .filter(([_, d]) => (d.success + d.failure) >= 3)
  .map(([skill, d]) => ({ skill, rate: d.success / (d.success + d.failure) }))
  .sort((a, b) => a.rate - b.rate);
console.log(ranked[0]?.skill || '');
EOF
)

echo "Weakest skill: $WEAKEST"

# Read the skill file
SKILL_FILE="skills/$WEAKEST/SKILL.md"
if [[ ! -f "$SKILL_FILE" ]]; then
  echo "Skill file not found: $SKILL_FILE — skipping evolution"
  exit 0
fi
```

### Step 4: Diagnose the Specific Weakness

Before editing, analyze *why* the skill is failing. Read the failure notes:

```bash
# Extract failure notes for the weakest skill
node - <<EOF
const fs = require('fs');
const skill = '$WEAKEST';
const lines = fs.readFileSync(process.env.HOME + '/.clawpowers/metrics/outcomes.jsonl', 'utf8')
  .trim().split('\n').filter(Boolean).slice(-50)
  .map(l => JSON.parse(l))
  .filter(r => r.skill === skill && r.outcome === 'failure' && r.notes);
lines.forEach(r => console.log(r.timestamp, '|', r.notes));
EOF
```

**Diagnosis patterns:**

| Failure note pattern | Likely weak section | Fix strategy |
|---------------------|-------------------|-------------|
| "step X was unclear" | Core Methodology step X | Add concrete example, remove ambiguity |
| "forgot to check Y" | Anti-Patterns table | Add the missed check as an explicit anti-pattern |
| "didn't know when to apply" | When to Use decision tree | Sharpen the decision tree with new branch |
| "ClawPowers commands failed" | ClawPowers Enhancement | Fix command syntax or add error handling |
| "took too long on Z" | Core Methodology step Z | Add shortcut or restructure step ordering |

### Step 5: Surgical Edit (Not Wholesale Replacement)

**Critical rule:** Edit specific sections, not the entire file. Wholesale rewrites lose working methodology.

```bash
# Read the current skill version
CURRENT_VERSION=$(grep '^version:' "$SKILL_FILE" | head -1 | awk '{print $2}' | tr -d '"')
MAJOR=$(echo $CURRENT_VERSION | cut -d. -f1)
MINOR=$(echo $CURRENT_VERSION | cut -d. -f2)
PATCH=$(echo $CURRENT_VERSION | cut -d. -f3)
NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"

echo "Evolving $WEAKEST from v$CURRENT_VERSION → v$NEW_VERSION"
```

**Surgical edit guidelines:**
- If the "When to Use" decision tree is wrong → edit only that block
- If a Core Methodology step is incomplete → add one concrete example under that step
- If an Anti-Pattern is missing → append one row to the table
- If ClawPowers commands are broken → fix only the broken command block
- Never touch sections that aren't implicated in the failures
- Max lines changed per evolution cycle: 30 (forces focus)

**Apply the edit and bump version:**
```bash
# After making the targeted edit in SKILL_FILE:
sed -i "s/^version: $CURRENT_VERSION/version: $NEW_VERSION/" "$SKILL_FILE"
```

### Step 6: Commit the Evolution

```bash
# Stage and commit
git add "$SKILL_FILE"
git commit -m "skill-evolution: $WEAKEST v$CURRENT_VERSION → v$NEW_VERSION

Triggered at task $TASK_COUNT. Success rate was $RATE%.
Section edited: $SECTION_EDITED
Root cause: $ROOT_CAUSE

[meta-skill-evolution]"

# Copy evolved skill to ~/.clawpowers/skills/ if exists
MANAGED_SKILLS_DIR=~/.clawpowers/skills
if [[ -d "$MANAGED_SKILLS_DIR" ]]; then
  mkdir -p "$MANAGED_SKILLS_DIR/$WEAKEST"
  cp "$SKILL_FILE" "$MANAGED_SKILLS_DIR/$WEAKEST/SKILL.md"
fi
```

### Step 7: Log Evolution History

Every evolution is appended to a persistent log:

```bash
EVOLUTION_LOG=~/.clawpowers/feedback/evolution-log.jsonl
mkdir -p "$(dirname $EVOLUTION_LOG)"

cat >> "$EVOLUTION_LOG" <<EOF
{"timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","task_count":$TASK_COUNT,"skill":"$WEAKEST","version_from":"$CURRENT_VERSION","version_to":"$NEW_VERSION","success_rate_before":$RATE,"section_edited":"$SECTION_EDITED","root_cause":"$ROOT_CAUSE","commit":"$(git rev-parse --short HEAD)"}
EOF
```

**Review evolution history:**
```bash
# See all past evolutions
cat ~/.clawpowers/feedback/evolution-log.jsonl | node -e "
const lines = require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').map(JSON.parse);
lines.forEach(e => console.log(e.timestamp.slice(0,10), e.skill, e.version_from, '→', e.version_to, 'rate:', (e.success_rate_before*100).toFixed(0)+'%'));
"

# Check if an evolution helped (compare rate before vs after)
# Re-run outcome analysis after 10 more tasks to measure improvement
```

### Step 8: Validate the Evolution

After 10 more tasks using the evolved skill, check if the success rate improved:

```bash
# Post-evolution check (run after 10+ tasks)
NEW_RATE=$(node -e "
const fs = require('fs');
const lines = fs.readFileSync(process.env.HOME + '/.clawpowers/metrics/outcomes.jsonl','utf8')
  .trim().split('\n').filter(Boolean).slice(-10)
  .map(l => JSON.parse(l))
  .filter(r => r.skill === '$WEAKEST');
const success = lines.filter(r => r.outcome === 'success').length;
console.log((success/lines.length).toFixed(2));
")
echo "Post-evolution success rate for $WEAKEST: $NEW_RATE"

# If rate dropped: revert the evolution
if node -e "process.exit(parseFloat('$NEW_RATE') < parseFloat('$RATE') ? 1 : 0)"; then
  echo "Evolution improved the skill. Rate: $RATE → $NEW_RATE"
else
  echo "WARNING: Evolution did not help. Consider reverting."
  git revert HEAD --no-edit
fi
```

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Full evolution pipeline:**

```bash
# Store evolution state for resumability
bash runtime/persistence/store.sh set "meta-evolution:current:task_count" "$TASK_COUNT"
bash runtime/persistence/store.sh set "meta-evolution:current:weakest_skill" "$WEAKEST"
bash runtime/persistence/store.sh set "meta-evolution:current:phase" "diagnosis|editing|committed|validated"

# Record the evolution outcome
bash runtime/metrics/collector.sh record \
  --skill meta-skill-evolution \
  --outcome success \
  --duration "$DURATION" \
  --notes "$WEAKEST v$CURRENT_VERSION→v$NEW_VERSION rate:$RATE→$NEW_RATE"
```

**Analyze evolution effectiveness over time:**

```bash
bash runtime/feedback/analyze.sh --filter meta-skill-evolution
# Shows: how many evolutions triggered, average rate improvement per evolution,
# which skills have been evolved most, correlation between evolution and task success
```

**Track cumulative improvement:**
```bash
# Evolution impact report
cat ~/.clawpowers/feedback/evolution-log.jsonl | node -e "
const lines = require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').map(JSON.parse);
const bySkill = {};
lines.forEach(e => {
  if (!bySkill[e.skill]) bySkill[e.skill] = [];
  bySkill[e.skill].push(e);
});
Object.entries(bySkill).forEach(([skill, evos]) => {
  console.log(skill + ': ' + evos.length + ' evolutions, versions: ' + evos.map(e=>e.version_to).join(', '));
});
"
```

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Rewrite the whole skill | Destroys working methodology, no signal on what improved | Surgical edits only — max 30 lines changed |
| Evolve based on < 3 data points | Statistical noise triggers false evolution | Require ≥ 3 uses before a skill is eligible |
| Evolve on a cooling period | Too-frequent changes create instability | Enforce 10-task cooldown between evolutions |
| Skip the validation step | Bad evolutions compound over time | Always measure rate before vs after |
| Edit non-implicated sections | Changes unrelated things, pollutes signal | Only edit sections linked to failure notes |
| Forget to bump version | Can't track evolution history | Version bump is mandatory before commit |
| No evolution log entry | History is lost; can't audit what improved | Always append to evolution-log.jsonl |
| Evolve the meta-skill-evolution skill first | Circular improvement without baseline | Evolve leaf skills first; evolve this skill only after 5+ other evolutions |

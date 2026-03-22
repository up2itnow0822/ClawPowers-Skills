---
name: cross-project-knowledge
description: Persistent knowledge base across all projects. Extract patterns after every fix or architecture decision; search before starting any task. Work on Project B benefits from everything learned on Projects A, C, D.
version: 1.0.0
requires:
  tools: [bash, node]
  runtime: true
metrics:
  tracks: [patterns_stored, patterns_retrieved, cross_project_hits, success_count_increments, search_latency_ms]
  improves: [search_relevance, pattern_categorization_accuracy, retrieval_recall]
---

# Cross-Project Knowledge

## When to Use

**Store a pattern after:**
- Successfully fixing a bug (store the root cause + fix)
- Making a significant architecture decision (store the decision + rationale)
- Discovering a performance optimization
- Completing a security fix or identifying a security pattern
- Writing a test strategy that proved effective

**Search before:**
- Starting any new task (30-second search to avoid re-solving known problems)
- Encountering an error message you haven't seen in this project
- Designing a new component or API
- Choosing between two implementation approaches

**Skip when:**
- The task is purely mechanical (rename a file, update a config value)
- The runtime directory `~/.clawpowers/` doesn't exist (no persistence available)
- The pattern is too project-specific to generalize (e.g., a business rule for one client)

**Decision tree:**
```
Starting a new task?
└── Yes → Search knowledge base first (30 seconds)
          ├── Hit found → apply known solution, update success_count
          └── No hit → proceed with fresh investigation
                        └── After solving: store the pattern
```

## Core Methodology

### Knowledge Base Structure

All patterns live in `~/.clawpowers/memory/patterns.jsonl`. Each line is a JSON record:

```json
{
  "pattern_id": "bp-2024-auth-jwt-expiry",
  "category": "bug-fix",
  "description": "JWT tokens accepted after expiry when clock skew > 0",
  "context": "Node.js + jsonwebtoken library, any project using JWT auth",
  "solution": "Add clockTolerance: 0 to verify() options, or explicitly check exp claim",
  "code_example": "jwt.verify(token, secret, { clockTolerance: 0 })",
  "projects_used_in": ["auth-service", "api-gateway"],
  "success_count": 3,
  "tags": ["jwt", "auth", "expiry", "clock-skew"],
  "created_at": "2024-03-15T10:00:00Z",
  "last_used": "2024-11-02T14:30:00Z"
}
```

**Categories:**
- `bug-fix` — root cause + fix for a recurring class of bug
- `architecture` — structural patterns, component boundaries, integration decisions
- `performance` — optimizations with measured impact
- `security` — vulnerability patterns and mitigations
- `testing` — test strategies, fixture patterns, effective test designs

### Step 1: Search Before Starting

Before any non-trivial task, run a 30-second search:

```bash
# Text search by keyword
PATTERNS_FILE=~/.clawpowers/memory/patterns.jsonl

search_patterns() {
  local query="$1"
  local category="$2"  # optional filter

  if [[ ! -f "$PATTERNS_FILE" ]]; then
    echo "No knowledge base found. Initialize with: mkdir -p ~/.clawpowers/memory && touch ~/.clawpowers/memory/patterns.jsonl"
    return
  fi

  node - <<EOF
const fs = require('fs');
const query = '${query}'.toLowerCase();
const category = '${category}';
const lines = fs.readFileSync(process.env.HOME + '/.clawpowers/memory/patterns.jsonl', 'utf8')
  .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

const results = lines.filter(p => {
  const matchCat = !category || p.category === category;
  const text = [p.description, p.context, p.solution, ...(p.tags||[])].join(' ').toLowerCase();
  const matchQuery = query.split(' ').every(word => text.includes(word));
  return matchCat && matchQuery;
}).sort((a, b) => b.success_count - a.success_count);

if (results.length === 0) {
  console.log('No matching patterns found.');
} else {
  results.slice(0, 5).forEach((p, i) => {
    console.log(\`[\${i+1}] [\${p.category}] \${p.description}\`);
    console.log(\`    Solution: \${p.solution}\`);
    if (p.code_example) console.log(\`    Example: \${p.code_example}\`);
    console.log(\`    Used in: \${(p.projects_used_in||[]).join(', ')} | Success count: \${p.success_count}\`);
    console.log('');
  });
}
EOF
}

# Usage examples:
search_patterns "jwt expiry"
search_patterns "connection pool" "bug-fix"
search_patterns "react infinite render" "bug-fix"
search_patterns "database index" "performance"
```

**What to do with search results:**
- **Hit with high success_count (≥3):** Apply the documented solution directly. Update `success_count` and `last_used`.
- **Hit with low success_count (1-2):** Use as a starting hypothesis, not a guaranteed fix. Verify it applies.
- **No hit:** Proceed with fresh investigation. After solving, store the pattern.

### Step 2: Store a Pattern After Solving

After fixing a bug, making an architecture decision, or discovering a useful pattern:

```bash
store_pattern() {
  local category="$1"      # bug-fix|architecture|performance|security|testing
  local description="$2"   # what problem this solves (1 sentence)
  local context="$3"        # when/where this pattern applies
  local solution="$4"       # the fix or decision
  local code_example="$5"  # optional code snippet
  local tags="$6"           # comma-separated keywords

  local pattern_id="${category:0:2}-$(date +%Y%m%d)-$(echo "$description" | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | cut -c1-30)"
  local project=$(basename $(git rev-parse --show-toplevel 2>/dev/null) 2>/dev/null || echo "unknown")

  mkdir -p ~/.clawpowers/memory

  # Build JSON record
  node - <<EOF >> "$PATTERNS_FILE"
console.log(JSON.stringify({
  pattern_id: '$pattern_id',
  category: '$category',
  description: '$description',
  context: '$context',
  solution: '$solution',
  code_example: '$code_example',
  projects_used_in: ['$project'],
  success_count: 1,
  tags: '$tags'.split(',').map(t=>t.trim()).filter(Boolean),
  created_at: new Date().toISOString(),
  last_used: new Date().toISOString()
}));
EOF
  echo "Pattern stored: $pattern_id"
}
```

**Store after these events (mandatory):**

| Event | Category | What to store |
|-------|---------|--------------|
| Bug fixed | `bug-fix` | Root cause + exact fix + how to detect this bug |
| Architecture decision made | `architecture` | Decision + alternatives considered + rationale |
| Performance improvement measured | `performance` | Optimization + measured delta (e.g., "50% latency reduction") |
| Security issue found/fixed | `security` | Vulnerability pattern + mitigation |
| Test strategy validated | `testing` | Test approach + what it caught that unit tests missed |

**Example stores:**

```bash
# After fixing a React infinite re-render
store_pattern "bug-fix" \
  "useEffect with object dependency causes infinite re-render" \
  "React functional components, useEffect with object/array deps" \
  "Memoize the object with useMemo or extract stable primitive values as deps" \
  "const stableRef = useMemo(() => ({ id: user.id }), [user.id])" \
  "react,useEffect,infinite-render,memoization"

# After an architecture decision
store_pattern "architecture" \
  "Event sourcing for audit log instead of mutable records" \
  "Any service requiring immutable audit trail, compliance requirements" \
  "Append-only event log; derive current state by replaying events; never update in-place" \
  "" \
  "event-sourcing,audit-log,cqrs,immutable"

# After a performance fix
store_pattern "performance" \
  "N+1 query on user.posts relation reduced latency from 800ms to 45ms" \
  "ORM with lazy loading, list views fetching related records" \
  "Use eager loading: User.includes(:posts) or SQL JOIN instead of per-row query" \
  "User.includes(:posts).where(...)" \
  "n+1,orm,eager-loading,sql,latency"
```

### Step 3: Update on Reuse

When a retrieved pattern successfully solves a new problem, increment its signal:

```bash
update_pattern_success() {
  local pattern_id="$1"
  local project=$(basename $(git rev-parse --show-toplevel 2>/dev/null) 2>/dev/null || echo "unknown")

  node - <<EOF > /tmp/patterns-updated.jsonl
const fs = require('fs');
const lines = fs.readFileSync(process.env.HOME + '/.clawpowers/memory/patterns.jsonl', 'utf8')
  .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const now = new Date().toISOString();
const updated = lines.map(p => {
  if (p.pattern_id === '$pattern_id') {
    const projects = Array.from(new Set([...(p.projects_used_in||[]), '$project']));
    return { ...p, success_count: (p.success_count||0) + 1, last_used: now, projects_used_in: projects };
  }
  return p;
});
updated.forEach(p => console.log(JSON.stringify(p)));
EOF
  mv /tmp/patterns-updated.jsonl "$PATTERNS_FILE"
  echo "Updated success_count for $pattern_id"
}
```

### Step 4: Periodic Knowledge Base Maintenance

Every 100 patterns or monthly, prune and consolidate:

```bash
# Knowledge base health report
node - <<'EOF'
const fs = require('fs');
const lines = fs.readFileSync(process.env.HOME + '/.clawpowers/memory/patterns.jsonl', 'utf8')
  .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

// Count by category
const byCat = {};
lines.forEach(p => { byCat[p.category] = (byCat[p.category]||0) + 1; });

// High-value patterns (success_count ≥ 3)
const highValue = lines.filter(p => p.success_count >= 3).length;

// Stale patterns (not used in 6 months)
const sixMonthsAgo = new Date(Date.now() - 6*30*24*60*60*1000).toISOString();
const stale = lines.filter(p => (p.last_used||p.created_at) < sixMonthsAgo).length;

console.log('Knowledge Base Health:');
console.log('  Total patterns:', lines.length);
console.log('  By category:', JSON.stringify(byCat));
console.log('  High-value (≥3 successes):', highValue);
console.log('  Stale (>6 months unused):', stale);
console.log('  Cross-project patterns (≥2 projects):', lines.filter(p => (p.projects_used_in||[]).length >= 2).length);
EOF
```

### Step 5: Cross-Project Knowledge Transfer

When starting a project in a domain you've worked in before:

```bash
# Before starting on a new auth service
search_patterns "auth jwt token" "security"
search_patterns "auth session" "architecture"
search_patterns "auth rate limit" "security"

# Before debugging a Node.js memory issue
search_patterns "memory leak node" "bug-fix"
search_patterns "garbage collection" "performance"
search_patterns "heap snapshot" "bug-fix"
```

**The power:** An agent working on `project-d` that has seen the JWT clock skew bug on `project-a` will solve it in seconds on `project-d` — not hours.

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Full pipeline integration:**

```bash
# At the start of any task
bash runtime/persistence/store.sh set "knowledge:current-task:search-done" "false"

# Search step (always first)
RESULTS=$(node -e "/* search logic above */" 2>/dev/null)
bash runtime/persistence/store.sh set "knowledge:current-task:search-done" "true"
bash runtime/persistence/store.sh set "knowledge:current-task:search-results" "$RESULTS"

# After task completion — store if new pattern discovered
if [[ "$NEW_PATTERN_FOUND" == "true" ]]; then
  store_pattern "$CATEGORY" "$DESCRIPTION" "$CONTEXT" "$SOLUTION" "$CODE_EXAMPLE" "$TAGS"
fi

# Record metrics
bash runtime/metrics/collector.sh record \
  --skill cross-project-knowledge \
  --outcome success \
  --notes "search: $SEARCH_HITS hits, stored: $STORED_PATTERNS new patterns"
```

**Analyze knowledge base effectiveness:**

```bash
bash runtime/feedback/analyze.sh --filter cross-project-knowledge
# Reports: search hit rate, most-used patterns, cross-project transfer count,
# average time saved vs. fresh investigation
```

**Export / import for team sharing:**
```bash
# Export your knowledge base (redact sensitive data)
cat ~/.clawpowers/memory/patterns.jsonl | \
  node -e "
const lines = require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').map(JSON.parse);
// Keep only high-value, generic patterns
const shareable = lines.filter(p => p.success_count >= 2 && !p.tags?.includes('internal'));
shareable.forEach(p => console.log(JSON.stringify(p)));
" > shared-patterns.jsonl

# Import from a teammate's export
cat shared-patterns.jsonl >> ~/.clawpowers/memory/patterns.jsonl
echo "Imported $(wc -l < shared-patterns.jsonl) patterns"
```

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Skip pre-task search | Re-solve known problems; waste time | Always search first, even if you think you know the answer |
| Store patterns too specifically | Pattern only matches one exact situation | Generalize: describe the class of problem, not the instance |
| Store without code_example | Pattern is hard to apply without template | Always include a minimal code example |
| Forget to update success_count | High-value patterns look the same as single-use | Update every time a pattern is successfully applied |
| Store negative results ("this didn't work") | Pollutes the knowledge base with noise | Only store successful patterns; capture failures in debugging logs |
| Never prune stale patterns | Old patterns may suggest deprecated approaches | Monthly maintenance pass; archive patterns unused for 6+ months |
| Search with overly broad terms | Too many irrelevant hits; signal buried | Search with 2-3 specific keywords from the error or domain |
| Treat cross-project patterns as gospel | Context differs; blind application fails | Use as a strong starting hypothesis, then verify it fits |

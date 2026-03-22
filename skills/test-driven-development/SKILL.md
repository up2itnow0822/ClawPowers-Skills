---
name: test-driven-development
description: Enforce RED-GREEN-REFACTOR with mandatory failure witness. Activate whenever writing new code, implementing a feature, or fixing a bug with a reproducible test case.
version: 1.0.0
requires:
  tools: [bash]
  runtime: false
metrics:
  tracks: [red_witnessed, green_achieved, refactor_cycles, mutation_score, test_effectiveness]
  improves: [test_granularity, refactor_threshold, mutation_analysis_frequency]
---

# Test-Driven Development

## When to Use

Apply this skill when:

- Implementing any new feature or function
- Fixing a bug that has a reproducible failure condition
- Refactoring code where behavior must be preserved
- Building an API endpoint, utility function, or module
- Implementing a specification with defined inputs and outputs

**Skip when:**
- Exploratory prototyping where the interface isn't known yet (write the prototype, then TDD the real implementation)
- One-off scripts with no production path
- Pure configuration changes (infrastructure, env vars, YAML)

**Decision tree:**
```
Do you know what correct behavior looks like?
├── No  → Explore/prototype first, then TDD the real version
└── Yes → Do you have a reproducible failure condition?
          ├── Yes (bug fix) → TDD from the failing test
          └── No (new feature) → TDD from the spec → RED-GREEN-REFACTOR
```

## Core Methodology

### The Laws of TDD

1. You may not write production code unless it is to make a failing test pass.
2. You may not write more of a unit test than is sufficient to fail (compilation failures count as failures).
3. You may not write more production code than is sufficient to pass the currently failing test.

These are not suggestions. Violations produce code that is tested after the fact — which is not TDD.

### The RED Phase

**Objective:** Write a test that fails for the right reason.

```
Step 1: Write the test before any production code exists
Step 2: Run the test suite
Step 3: WITNESS the failure — read the actual error message
Step 4: Confirm the failure is the expected one (not a compile error, not a wrong import)
```

**Failure witness requirement:** You must see the test runner output showing failure. Copy-pasting the expected error is not sufficient — run it.

**Example (Python):**
```python
# test_auth.py — write this FIRST
def test_jwt_issue_returns_token_with_expiry():
    auth = AuthService(secret="test-secret")
    result = auth.issue(user_id="u123", ttl_seconds=3600)
    
    assert result["token"] is not None
    assert result["expires_at"] > time.time()
    assert result["user_id"] == "u123"

# Run and witness:
# pytest test_auth.py::test_jwt_issue_returns_token_with_expiry
# FAILED: ImportError: cannot import name 'AuthService' from 'auth'
# ← This is the expected RED failure. Correct.
```

**What a bad RED looks like:**
```
# WRONG: Writing AuthService first, then the test
# WRONG: Test passes on first run (you tested nothing)
# WRONG: Test fails with wrong error (syntax error in test, not missing implementation)
```

### The GREEN Phase

**Objective:** Write the minimum production code to make the test pass.

```
Step 1: Write only what the test requires — nothing more
Step 2: No edge case handling beyond what the test covers
Step 3: Run the test suite
Step 4: WITNESS the green — all targeted tests pass
Step 5: If other tests broke, fix them (don't disable them)
```

**Minimum code principle:** If the test only checks that `add(2, 3)` returns `5`, write `return 5` if that makes it green. The next test will force generalization.

**Example:**
```python
# auth.py — write this AFTER the test fails
import jwt
import time

class AuthService:
    def __init__(self, secret: str):
        self.secret = secret
    
    def issue(self, user_id: str, ttl_seconds: int) -> dict:
        now = time.time()
        payload = {"sub": user_id, "iat": now, "exp": now + ttl_seconds}
        token = jwt.encode(payload, self.secret, algorithm="HS256")
        return {"token": token, "expires_at": now + ttl_seconds, "user_id": user_id}

# Run and witness:
# pytest test_auth.py::test_jwt_issue_returns_token_with_expiry
# PASSED
```

### The REFACTOR Phase

**Objective:** Improve code structure without changing behavior.

```
Step 1: All tests must be green BEFORE refactoring begins
Step 2: Identify: duplication, poor naming, complex conditionals, missing abstractions
Step 3: Refactor ONE thing at a time
Step 4: Run full test suite after each change
Step 5: If tests break, revert immediately (don't debug during refactor)
Step 6: Refactor test code too — tests are first-class code
```

**What belongs in REFACTOR:**
- Extract repeated logic into helper functions
- Rename variables/functions for clarity
- Simplify nested conditionals
- Add type annotations
- Break long functions into smaller ones
- Move related code into a class

**What does NOT belong in REFACTOR:**
- New functionality (that's the next RED phase)
- Performance optimization (benchmark first, optimize second)
- Changing behavior "while you're in there"

### The Cycle

```
RED (5-15 min) → GREEN (5-30 min) → REFACTOR (5-20 min) → RED...
```

Each cycle covers ONE behavior. Not a feature — one behavior of a feature.

For `AuthService`, the full TDD cycle would be:
1. RED/GREEN/REFACTOR: `issue()` returns token
2. RED/GREEN/REFACTOR: `issue()` handles invalid user_id
3. RED/GREEN/REFACTOR: `validate()` returns valid for good token
4. RED/GREEN/REFACTOR: `validate()` returns invalid for expired token
5. RED/GREEN/REFACTOR: `validate()` returns invalid for tampered token
6. RED/GREEN/REFACTOR: `issue()` and `validate()` work end-to-end

### Test Naming Convention

Tests are documentation. Name them:
```
test_[unit]_[action]_[expected_result]
test_jwt_issue_with_negative_ttl_raises_value_error()
test_jwt_validate_expired_token_returns_invalid_with_reason()
test_jwt_validate_tampered_token_returns_invalid_with_reason()
```

Not:
```
test_1()
test_auth()
test_jwt_token_stuff()
```

### Testing Layers

| Layer | What It Tests | Tool |
|-------|-------------|------|
| Unit | Single function, isolated | pytest, jest, go test |
| Integration | Multiple units together | pytest with real DB |
| Contract | API interface compliance | pact, dredd |
| E2E | Full system path | playwright, cypress |

TDD applies at all layers. Start with unit. Add integration when units pass.

### Autonomous Mutation Testing

After the REFACTOR phase is complete and all tests are green, run autonomous mutation testing to verify your tests actually catch bugs — not just pass on correct code.

**The mutation testing loop:**

```
GREEN tests → generate mutants → run suite against each → calculate score → fix gaps → re-run
```

**Step 1: Generate mutants**

Mutation tools automatically modify your production code in small ways to simulate bugs:

| Mutation type | Example | What it tests |
|--------------|---------|-------------|
| Operator swap | `a > b` → `a >= b` | Off-by-one detection |
| Condition removal | `if (valid && active)` → `if (active)` | Guard clause tests |
| Return value swap | `return true` → `return false` | Output assertion coverage |
| Constant mutation | `ttl = 3600` → `ttl = 0` | Boundary value tests |
| Statement deletion | Remove a line entirely | Whether tests catch missing logic |

**Step 2: Run mutation tools**

```bash
# Python: mutmut
pip install mutmut
mutmut run --paths-to-mutate src/ --tests-dir tests/
mutmut results  # shows surviving (undetected) mutants

# JavaScript/TypeScript: Stryker
npx stryker run
# Stryker generates a detailed HTML report with surviving mutants

# Go: go-mutesting
go install github.com/zimmski/go-mutesting/cmd/go-mutesting@latest
go-mutesting ./...

# Java: PIT
mvn org.pitest:pitest-maven:mutationCoverage
```

**Step 3: Calculate and interpret the mutation score**

```
mutation score = (killed mutants / total mutants) × 100
```

| Score | Assessment | Action |
|-------|-----------|--------|
| ≥ 90% | Excellent | No action needed |
| 80–89% | Good | Review surviving mutants; add 1-2 targeted tests |
| 70–79% | Marginal | Systematic gap; add boundary and error-path tests |
| < 70% | Poor | Tests exist but don't assert enough; add failing-case coverage |

**Step 4: Kill surviving mutants**

For each surviving mutant, the tool shows what change it made. Write a test that would catch that bug:

```python
# Stryker report shows this mutant survived:
# Original:  if score >= passing_threshold:
# Mutant:    if score > passing_threshold:

# Write a test that detects the off-by-one:
def test_score_at_exact_threshold_passes():
    # This test kills the >= vs > mutant
    assert grade(score=passing_threshold) == "pass"
    assert grade(score=passing_threshold - 1) == "fail"
```

```typescript
// Stryker shows this mutant survived:
// Original:  return { token, expiresAt, userId }
// Mutant:    return { token, expiresAt, userId: "" }

// Write a test that kills it:
test('issue() returns correct userId in payload', () => {
  const result = auth.issue('user-abc', 3600);
  expect(result.userId).toBe('user-abc');  // was not previously asserted!
});
```

**Step 5: Iterate until score ≥ 80%**

```bash
# After adding new tests, re-run to measure improvement
mutmut run --paths-to-mutate src/ --tests-dir tests/
NEW_SCORE=$(mutmut results | grep "Killed" | awk '{print $2/$4 * 100}')
echo "Mutation score: $NEW_SCORE%"
```

**Tracking mutation scores over time:**

```bash
# Record in ClawPowers metrics after each TDD cycle
MUTATION_SCORE=87
bash runtime/metrics/collector.sh record \
  --skill test-driven-development \
  --outcome success \
  --notes "AuthService: RED×6 witnessed, mutation_score=$MUTATION_SCORE%, 0 surviving mutants after 2 additions"
```

The TDD cycle with mutation testing:

```
RED → GREEN → REFACTOR → MUTATE → [score < 80%? → KILL SURVIVORS → RE-MUTATE] → done
```

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Mutation Score History:**

```bash
# Query historical mutation scores
bash runtime/persistence/store.sh list "tdd:mutation:*" | sort
# Shows trend: if scores are declining, tests are growing but not keeping up with code complexity
```

**Mutation Analysis Integration:**

After the GREEN phase, optionally run mutation analysis to verify your tests actually catch bugs — not just pass on correct code:

```bash
# Python: mutmut
pip install mutmut
mutmut run --paths-to-mutate src/auth.py --tests-dir tests/

# JavaScript: Stryker
npx stryker run

# Go: go-mutesting
go-mutesting ./...
```

Mutation score target: ≥ 80%. Below 70% means your tests would miss real bugs.

**Test Portfolio Lifecycle Tracking:**

```bash
bash runtime/metrics/collector.sh record \
  --skill test-driven-development \
  --outcome success \
  --notes "AuthService: 6 behaviors, mutation score 87%, 0 stubs"
```

**Effectiveness Scoring:**

`runtime/feedback/analyze.sh` computes per-feature test effectiveness based on:
- Mutation score
- Number of RED phases witnessed (vs skipped)
- Time from RED to GREEN (indicates test complexity)
- Defect rate post-merge (bugs found in production = test misses)

Skills with declining effectiveness scores trigger recommendations:
- If mutation score < 70%: add boundary and error case tests
- If RED skipped: review test authoring process
- If GREEN > 60 min: tests are too coarse, decompose

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Write tests after code | Tests are biased toward existing implementation | Tests must be written first — that's the definition |
| Skip the failure witness | Tests may pass vacuously (wrong assertion, wrong import) | Run the suite, read the failure message |
| Test implementation details | Tests break on refactor | Test behavior/interface, not internal state |
| One giant test | Hard to diagnose failures | One test per behavior |
| Mocking everything | Tests pass but real system fails | Mock only at true system boundaries (network, DB, time) |
| Skip REFACTOR | Technical debt accumulates | REFACTOR is mandatory, not optional |
| Write all tests upfront | Spec changes invalidate all tests | Write tests incrementally, one behavior at a time |
| Disable failing tests | Silences real bugs | Fix the code, never disable the test |

## Examples

### Example 1: Pure Function (simplest case)

```python
# RED
def test_celsius_to_fahrenheit_converts_correctly():
    assert convert_temp(0, "celsius", "fahrenheit") == 32.0
    assert convert_temp(100, "celsius", "fahrenheit") == 212.0

# GREEN
def convert_temp(value, from_unit, to_unit):
    if from_unit == "celsius" and to_unit == "fahrenheit":
        return value * 9/5 + 32
    raise ValueError(f"Unsupported conversion: {from_unit} → {to_unit}")

# REFACTOR → add UNIT_CONVERTERS dict, extract conversion logic
```

### Example 2: Side-effecting Code

```python
# RED — test the effect, not the implementation
def test_user_created_event_emitted_on_signup(event_bus):
    service = UserService(db=FakeDB(), events=event_bus)
    service.signup(email="a@b.com", password="secure123")
    
    assert event_bus.has_event("user.created")
    assert event_bus.last_event("user.created")["email"] == "a@b.com"

# Note: FakeDB is a test double for the DB boundary
# event_bus is a test double for the event system boundary
# The UserService logic itself is real — no mocking of it
```

### Example 3: Bug Fix

```python
# Reproduce the bug first
def test_cart_total_with_discount_code_not_negative():
    cart = Cart()
    cart.add_item(price=10.00, qty=1)
    cart.apply_discount(code="HALF_OFF")
    cart.apply_discount(code="HALF_OFF")  # applying twice — the bug
    
    assert cart.total() >= 0.0  # was returning -5.00

# Run → FAIL (reproduces the bug)
# Fix the bug
# Run → PASS
# Now the bug is regression-protected
```

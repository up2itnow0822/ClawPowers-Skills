---
name: formal-verification-lite
description: Goes beyond unit tests with property-based testing. Generate invariant properties for functions, write tests with fast-check/Hypothesis/QuickCheck, run 1000+ examples per property, and track edge cases found. Integrates with TDD after GREEN phase.
version: 1.0.0
requires:
  tools: [bash, node]
  runtime: false
metrics:
  tracks: [properties_discovered, edge_cases_found, false_positive_rate, properties_per_function, shrink_examples_count]
  improves: [property_coverage, edge_case_detection_rate, false_positive_threshold]
---

# Formal Verification Lite

## When to Use

Apply this skill when:

- The TDD GREEN phase is complete and you have passing unit tests
- Implementing pure functions with mathematical properties (sort, serialize, parse, encrypt)
- Building data transformation pipelines where correctness matters at scale
- Implementing state machines, parsers, or any function where "all inputs" behavior matters
- A bug report mentions an edge case that unit tests didn't cover
- Before shipping code to production that handles external/untrusted input

**Skip when:**
- Functions have no invariant properties (e.g., a function that sends an email — pure I/O)
- Tests require real external services (use integration tests instead)
- The function is pure configuration or pure UI rendering
- You're still in RED phase — finish TDD first, then apply this skill

**Decision tree:**
```
Does the function have any of these properties?
├── Roundtrip: encode/decode, serialize/deserialize → apply roundtrip pattern
├── Idempotence: f(f(x)) == f(x) → apply idempotence pattern
├── Commutativity: f(a,b) == f(b,a) → apply commutativity pattern
├── Monotonicity: if a ≤ b then f(a) ≤ f(b) → apply monotone pattern
├── Length preservation: output.length == input.length → apply structural pattern
└── None of these → unit tests are sufficient; skip this skill
```

## Core Methodology

### The Property-Based Testing Mindset

Unit tests check specific examples: `sort([3,1,2]) === [1,2,3]`.
Property tests check **universal invariants**: `∀ array: sort(array).length === array.length`.

The difference:
- Unit test: verifies 1 input
- Property test with 1000 iterations: verifies 1000 randomly-generated inputs, including edge cases the developer never thought of

**The property you write describes what must ALWAYS be true.** The framework finds inputs that break it.

### Step 1: Identify Properties

Before writing code, list the mathematical properties of your function. Use this taxonomy:

**Roundtrip (parse/serialize inverse pairs):**
```
parse(serialize(x)) == x
deserialize(serialize(x)) == x
decode(encode(x)) == x
```

**Idempotence (applying twice = applying once):**
```
normalize(normalize(x)) == normalize(x)
deduplicate(deduplicate(x)) == deduplicate(x)
trim(trim(x)) == trim(x)
```

**Commutativity (order doesn't matter):**
```
merge(a, b) == merge(b, a)
add(a, b) == add(b, a)
union(setA, setB) == union(setB, setA)
```

**Monotonicity (order-preserving):**
```
if a <= b then score(a) <= score(b)
if input.length increases then output.length >= previous output.length
```

**Structural invariants:**
```
sort(arr).length == arr.length
sort(arr) contains same elements as arr
filter(arr, pred).every(pred)
map(arr, f).length == arr.length
```

**Conservation laws:**
```
sum(split(total, n)) == total
partition(arr).flatMap(x=>x).length == arr.length
```

### Step 2: Write Property Tests

#### JavaScript / TypeScript — fast-check

```bash
npm install --save-dev fast-check
```

```typescript
import * as fc from 'fast-check';
import { serialize, deserialize } from './serializer';
import { sort } from './sort';
import { merge } from './merge';

// === Roundtrip property ===
test('serialize/deserialize roundtrip', () => {
  fc.assert(
    fc.property(
      fc.record({                           // generate random records
        id: fc.uuid(),
        name: fc.string({ minLength: 1 }),
        age: fc.integer({ min: 0, max: 150 }),
        tags: fc.array(fc.string()),
      }),
      (obj) => {
        const result = deserialize(serialize(obj));
        expect(result).toEqual(obj);        // must roundtrip perfectly
      }
    ),
    { numRuns: 1000 }                       // run 1000 random examples
  );
});

// === Structural invariant ===
test('sort preserves length and elements', () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer()),
      (arr) => {
        const sorted = sort(arr);
        // Property 1: length preserved
        expect(sorted.length).toBe(arr.length);
        // Property 2: elements preserved (multiset equality)
        expect(sorted.slice().sort()).toEqual(arr.slice().sort());
        // Property 3: monotone increasing
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i]).toBeGreaterThanOrEqual(sorted[i-1]);
        }
      }
    ),
    { numRuns: 1000 }
  );
});

// === Commutativity ===
test('merge is commutative', () => {
  fc.assert(
    fc.property(
      fc.record({ a: fc.integer(), b: fc.string() }),
      fc.record({ a: fc.integer(), b: fc.string() }),
      (objA, objB) => {
        expect(merge(objA, objB)).toEqual(merge(objB, objA));
      }
    ),
    { numRuns: 500 }
  );
});

// === Idempotence ===
test('normalize is idempotent', () => {
  fc.assert(
    fc.property(
      fc.string(),
      (str) => {
        const once = normalize(str);
        const twice = normalize(normalize(str));
        expect(once).toEqual(twice);
      }
    ),
    { numRuns: 1000 }
  );
});
```

#### Python — Hypothesis

```bash
pip install hypothesis
```

```python
from hypothesis import given, settings, strategies as st
from hypothesis import HealthCheck
from mymodule import serialize, deserialize, sort_items, merge_dicts

# === Roundtrip property ===
@given(st.fixed_dictionaries({
    'id': st.uuids().map(str),
    'name': st.text(min_size=1, max_size=100),
    'age': st.integers(min_value=0, max_value=150),
    'tags': st.lists(st.text()),
}))
@settings(max_examples=1000)
def test_serialize_deserialize_roundtrip(obj):
    assert deserialize(serialize(obj)) == obj

# === Structural invariant ===
@given(st.lists(st.integers()))
@settings(max_examples=1000)
def test_sort_preserves_structure(arr):
    sorted_arr = sort_items(arr)
    assert len(sorted_arr) == len(arr)              # length preserved
    assert sorted(sorted_arr) == sorted(arr)        # elements preserved
    for i in range(1, len(sorted_arr)):             # monotone
        assert sorted_arr[i] >= sorted_arr[i-1]

# === Commutativity ===
@given(
    st.dictionaries(st.text(), st.integers()),
    st.dictionaries(st.text(), st.integers()),
)
@settings(max_examples=500)
def test_merge_commutative(dict_a, dict_b):
    assert merge_dicts(dict_a, dict_b) == merge_dicts(dict_b, dict_a)

# === Conservation law ===
@given(st.integers(min_value=1, max_value=10000), st.integers(min_value=2, max_value=10))
@settings(max_examples=500)
def test_split_sum_conserved(total, n):
    parts = split(total, n)
    assert sum(parts) == total
    assert len(parts) == n
```

#### Go — testing/quick or gopter

```go
import (
    "testing"
    "testing/quick"
    "reflect"
)

// Roundtrip property
func TestSerializeRoundtrip(t *testing.T) {
    f := func(data Record) bool {
        serialized := Serialize(data)
        deserialized, err := Deserialize(serialized)
        return err == nil && reflect.DeepEqual(data, deserialized)
    }
    if err := quick.Check(f, &quick.Config{MaxCount: 1000}); err != nil {
        t.Error(err)
    }
}

// Sort structural invariant
func TestSortInvariant(t *testing.T) {
    f := func(arr []int) bool {
        sorted := Sort(append([]int{}, arr...))
        if len(sorted) != len(arr) { return false }
        for i := 1; i < len(sorted); i++ {
            if sorted[i] < sorted[i-1] { return false }
        }
        return true
    }
    quick.Check(f, &quick.Config{MaxCount: 1000})
}
```

### Step 3: Run with High Iteration Count

Default settings in most frameworks are too low (100 examples). Always override:

```bash
# fast-check: numRuns: 1000+ per property
# Hypothesis: max_examples=1000 per test
# QuickCheck: maxSuccess 1000

# Run with seed for reproducibility on failure
npx jest --testNamePattern="property"
# If a failure occurs, fast-check outputs the seed and minimal counterexample

# Python Hypothesis with verbose output
pytest --hypothesis-show-statistics tests/test_properties.py
```

**When a property fails:**

fast-check and Hypothesis both **shrink** the counterexample — they find the *smallest* failing input. This is the key advantage over manual testing:

```
Property failed after 47 examples:
Counterexample: { id: "", name: "a", age: 0, tags: [] }
          ↕ shrunk from: { id: "abc-xyz-...", name: "hello world", age: 42, tags: ["x","y"] }
```

The shrunk example directly points to the bug: empty string `id` breaks the serializer.

### Step 4: Track Properties and Edge Cases

After each property-testing run, record what was discovered:

```bash
# Record properties found and edge cases surfaced
cat >> ~/.clawpowers/memory/property-log.jsonl <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "function": "$FUNCTION_NAME",
  "project": "$(basename $(git rev-parse --show-toplevel))",
  "properties_tested": $PROPERTIES_COUNT,
  "iterations": $TOTAL_ITERATIONS,
  "edge_cases_found": $EDGE_CASES,
  "counterexamples": $COUNTEREXAMPLES_JSON,
  "false_positives": $FALSE_POSITIVES
}
EOF
```

**False positive tracking:** If a property test fails because the property was wrong (not the implementation), that's a false positive. Track these — high false positive rate means your properties need tightening.

### Step 5: Integration with TDD

After the GREEN phase, add property tests before entering REFACTOR:

```
RED → GREEN → [formal-verification-lite] → REFACTOR
```

**Integration flow:**
1. TDD GREEN: unit tests pass for specific examples
2. formal-verification-lite: identify properties → write property tests → run 1000 iterations
3. If property tests surface a bug: go back to GREEN to fix
4. If all property tests pass: enter REFACTOR with confidence that behavior is correct for all inputs

```python
# After unit tests pass:
# test_auth.py — unit tests (specific examples)
def test_jwt_issue_returns_token():
    auth = AuthService(secret="test")
    result = auth.issue("u123", 3600)
    assert result["token"] is not None

# test_auth_properties.py — property tests (universal)
@given(
    user_id=st.text(min_size=1, max_size=100),
    ttl=st.integers(min_value=1, max_value=86400)
)
@settings(max_examples=500)
def test_jwt_roundtrip(user_id, ttl):
    auth = AuthService(secret="test")
    token_data = auth.issue(user_id, ttl)
    validated = auth.validate(token_data["token"])
    assert validated["user_id"] == user_id
    assert validated["valid"] == True
```

### Common Property Templates

```typescript
// Template 1: Roundtrip
fc.assert(fc.property(arbitraryInput, (x) => {
  expect(decode(encode(x))).toEqual(x);
}), { numRuns: 1000 });

// Template 2: Idempotence
fc.assert(fc.property(arbitraryInput, (x) => {
  expect(f(f(x))).toEqual(f(x));
}), { numRuns: 1000 });

// Template 3: Commutativity
fc.assert(fc.property(arbitraryA, arbitraryB, (a, b) => {
  expect(f(a, b)).toEqual(f(b, a));
}), { numRuns: 500 });

// Template 4: Monotonicity
fc.assert(fc.property(fc.tuple(arbitraryNum, arbitraryNum), ([a, b]) => {
  fc.pre(a <= b);  // pre-condition
  expect(score(a)).toBeLessThanOrEqual(score(b));
}), { numRuns: 500 });

// Template 5: Conservation
fc.assert(fc.property(arbitraryArray, (arr) => {
  const parts = partition(arr);
  expect(parts.flat()).toEqual(expect.arrayContaining(arr));
  expect(parts.flat().length).toBe(arr.length);
}), { numRuns: 1000 });
```

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Track property discovery over time:**

```bash
bash runtime/persistence/store.sh set "fvl:$PROJECT:$FUNCTION:properties_count" "$PROPERTIES_COUNT"
bash runtime/persistence/store.sh set "fvl:$PROJECT:$FUNCTION:edge_cases_found" "$EDGE_CASES"
bash runtime/persistence/store.sh set "fvl:$PROJECT:last_run" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

**Metrics recording:**

```bash
bash runtime/metrics/collector.sh record \
  --skill formal-verification-lite \
  --outcome success \
  --notes "function: $FUNCTION_NAME, properties: $PROPERTIES_COUNT, iterations: $TOTAL_ITERATIONS, edge cases: $EDGE_CASES"
```

**Analyze property-testing effectiveness:**

```bash
bash runtime/feedback/analyze.sh --filter formal-verification-lite
# Reports: edge cases found per 1000 iterations, functions with most property failures,
# false positive rate trend, which property patterns are most productive
```

**Cross-project property library:**
```bash
# Store a reusable property template in knowledge base
search_patterns "roundtrip property" "testing"
store_pattern "testing" \
  "Roundtrip property for JSON-serializable data structures" \
  "Any function pair encode/decode or serialize/deserialize" \
  "Property: decode(encode(x)) == x with 1000 iterations" \
  "fc.assert(fc.property(fc.jsonValue(), x => expect(decode(encode(x))).toEqual(x)), {numRuns:1000})" \
  "property-based,roundtrip,fast-check,hypothesis"
```

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Run with default iteration count (< 100) | Edge cases aren't found; same as unit tests | Always set numRuns/max_examples ≥ 1000 |
| Write tautological properties | Property always passes, catches nothing | `expect(sort(arr).length >= 0)` is useless; test real invariants |
| Use property tests instead of unit tests | Harder to debug specific examples | Use both: unit tests for known examples, property tests for invariants |
| Skip shrinking | Large counterexamples are hard to debug | Let the framework shrink; always look at the minimal counterexample |
| Write properties before GREEN phase | Tests fail for wrong reasons | Complete TDD GREEN first, then add property tests |
| Test implementation details in properties | Properties break on refactor | Test mathematical relationships, not internal state |
| High false positive rate (> 10%) | Wastes time on wrong property definitions | Tighten pre-conditions with `fc.pre()` or `assume()` |
| Apply to I/O-heavy functions | Property tests of side effects are flaky | Property tests are for pure functions only |

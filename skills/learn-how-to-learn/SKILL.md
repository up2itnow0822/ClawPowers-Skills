---
name: learn-how-to-learn
description: Metacognitive learning protocol — 5-layer learning stack, 14 cognitive failure modes, confidence calibration, and common sense validation. Activate when approaching an unfamiliar domain, debugging a persistent misconception, or teaching a concept.
version: 1.0.0
requires:
  tools: []
  runtime: false
metrics:
  tracks: [concepts_learned, misconceptions_corrected, confidence_calibration_error, retention_rate]
  improves: [layer_selection, anti_pattern_detection_speed, confidence_threshold]
---

# Learn How to Learn

## When to Use

Apply this skill when:

- Encountering a domain, library, or concept for the first time
- A debugging session reveals a fundamental misunderstanding
- You've made the same type of error 3+ times
- You're about to teach or explain something to someone else
- Your confidence in a concept doesn't match your actual accuracy
- You've been stuck on the same problem for more than 30 minutes

**Skip when:**
- You genuinely know the domain well (Dunning-Kruger inverse — don't slow down real expertise)
- The task requires doing, not understanding (sometimes you learn by doing)
- The knowledge gap is trivial (syntax error, quick API lookup)

## Core Methodology: The 5-Layer Learning Stack

Learning has 5 layers. Most people stop at Layer 2 and wonder why they can't apply knowledge reliably. Work all 5 layers for durable understanding.

### Layer 1: Vocabulary (What are we talking about?)

Before anything else, establish precise definitions for key terms. Imprecise vocabulary causes compounding confusion — you can't think clearly about something you can't name accurately.

**Protocol:**
1. List the 5-10 most important terms in the domain
2. Find the authoritative definition (official docs, original paper, RFC)
3. In your own words: "A [X] is a [category] that [defining characteristic] and differs from [similar concept] because [key distinction]"
4. Find one concrete example and one counterexample

**Example — learning "idempotent":**
> Authoritative: "An operation is idempotent if applying it multiple times produces the same result as applying it once."
> Own words: "Idempotent means repeating the operation is safe — running it 10 times = running it 1 time."
> Example: HTTP PUT, DELETE. Setting a flag to true.
> Counterexample: HTTP POST (creates a new resource each time). Incrementing a counter.

If you can't produce the example and counterexample, you don't have Layer 1 yet.

### Layer 2: Facts (What is true?)

Acquire the key facts of the domain — what exists, what properties it has, what the system guarantees.

**Protocol:**
1. Read the official documentation (not a tutorial — the docs)
2. Note facts you're confident about vs. facts you're inferring
3. Verify inferred facts with a minimal test or authoritative source
4. Distinguish guaranteed behavior from typical behavior from implementation detail

**Common Layer 2 failures:**
- Treating a blog post as authoritative (verify against official source)
- Assuming behavior that's actually version-specific
- Confusing "common practice" with "guaranteed by spec"

### Layer 3: Mental Model (How does it work?)

Build a conceptual model that explains WHY facts are true, not just WHAT they are.

**Protocol:**
1. Draw or describe the internal mechanism (what components, how they interact)
2. Use analogies — what familiar system behaves similarly?
3. Predict behavior from the model: "Given my model, if X, then Y should happen"
4. Test predictions with experiments: does Y actually happen?
5. When prediction fails, update the model (not the experiment result)

**Mental model quality test:**
- Can you predict the behavior of a new, unseen scenario?
- Can you explain WHY an error occurs from first principles?
- Can you explain it in plain English to someone with no domain knowledge?

If you can't predict, diagnose, and explain — you have facts but not a model.

### Layer 4: Application (Can I use it?)

Mental models only prove themselves under actual use. Deliberate practice builds the pattern recognition that makes expertise feel intuitive.

**Protocol:**
1. Apply the concept in a controlled context (tutorial problem, toy example)
2. Deliberately seek the edge cases that break naive applications
3. Identify the decision criteria: "When should I use X vs Y?"
4. Make mistakes intentionally — apply the wrong thing and observe what breaks
5. Build from 80% mastery cases to the 20% edge cases

**Application anti-patterns:**
- Only doing examples from tutorials (they're designed to work)
- Avoiding the edge cases (that's where the real knowledge is)
- Moving to the next concept before achieving reliable application of this one

### Layer 5: Teaching (Do I really understand it?)

Teaching is the highest-fidelity test of understanding. Gaps that survive Layers 1-4 get exposed when you try to explain.

**Protocol:**
1. Explain the concept to someone unfamiliar with it (or write the explanation)
2. Identify where your explanation becomes hand-wavy or uses circular definitions
3. Where you hand-wave = where your model has holes → return to Layer 3

**The Feynman Technique:**
> "If you can't explain it simply, you don't understand it well enough."

When your explanation requires specialized vocabulary the listener doesn't have — translate. If you can't translate, you have vocabulary without understanding.

## The 14 Cognitive Failure Modes

These are the specific ways learning goes wrong. Recognize them in yourself:

1. **Premature closure** — Stopping when it "feels" understood rather than when it's verified
2. **Confirmation bias** — Seeking examples that confirm your mental model, ignoring contradictions
3. **Vocabulary mimicry** — Using terms correctly in sentences without understanding the concepts
4. **Tutorial tunnel** — Only learning happy paths, never the failure modes
5. **Abstraction aversion** — Refusing to engage with theory, only "practical" examples (theory predicts edge cases)
6. **Authority substitution** — Trusting a source because it's popular, not because it's accurate
7. **Analogy overextension** — Applying an analogy beyond where it holds, making wrong predictions
8. **Example generalization** — Concluding from 1-2 examples that a rule is universal
9. **Dunning-Kruger stall** — Maximum confidence at minimum knowledge; learning feels complete before it is
10. **Context collapse** — Applying knowledge correct in one context to a different context where it's wrong
11. **False equivalence** — "I know Python, so I know JavaScript" — mapping one domain's rules onto another
12. **Memorization substitution** — Memorizing procedures without understanding why they work
13. **Distraction inflation** — Treating breadth (knowing many things shallowly) as equivalent to depth
14. **Curse of knowledge** — Once you understand something, it's hard to remember what confusion felt like (prevents effective teaching)

## Confidence Calibration

Uncalibrated confidence is more dangerous than low confidence — you don't know what you don't know.

**Calibration protocol:**
1. Before testing your knowledge: estimate your confidence (0-100%)
2. Test your knowledge (take a quiz, apply the concept, explain it)
3. Measure actual accuracy
4. Gap between confidence and accuracy = calibration error

**Calibration targets:**
- If you say 90% confident: should be right 90% of the time
- Consistently overconfident (90% → 60% accuracy): slow down, go deeper
- Consistently underconfident (40% → 80% accuracy): apply more boldly

**Calibration exercise for technical concepts:**
```
"I'm [X]% sure that [specific claim about the concept]"
→ Test the claim
→ Was it correct?
→ Record: claimed confidence vs. actual result
→ Trend over N claims: are you calibrated?
```

## Common Sense Checks

Before applying learned knowledge in production:

**The 5 Common Sense Gates:**
1. **Sanity check** — Does this result make intuitive sense? If not, verify before acting.
2. **Order of magnitude** — Is the magnitude of the output in a reasonable range?
3. **Edge case check** — What happens with empty input? Null? Maximum value? Zero?
4. **Error behavior** — What fails gracefully vs. catastrophically?
5. **Reversibility** — Can you undo this action if the knowledge was wrong?

**Applied to new code:**
```python
# Before using a new library function, ask:
result = library.process(data)

# Sanity check: is this shape/type what I expected?
assert isinstance(result, expected_type), f"Got {type(result)}, expected {expected_type}"

# Order of magnitude: is this result reasonable?
assert 0 < len(result) < MAX_EXPECTED_SIZE, f"Unexpected size: {len(result)}"

# Edge case: what if data is empty?
empty_result = library.process([])
# → Does it raise? Return empty? Return None?
```

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Learning State Persistence:**

Track what you've learned, at what layer, with what confidence:

```bash
bash runtime/persistence/store.sh set "learning:jwt:layer" "3"  # Mental model stage
bash runtime/persistence/store.sh set "learning:jwt:confidence" "75"
bash runtime/persistence/store.sh set "learning:jwt:last_tested" "$(date +%Y-%m-%d)"
bash runtime/persistence/store.sh set "learning:jwt:misconceptions" "HS256 is not weaker than RS256 by default — depends on key management"
```

**Misconception Log:**

Persistent record of corrected misconceptions prevents rediscovery:
```bash
bash runtime/persistence/store.sh set "misconception:python-copy" \
  "list.copy() is shallow — nested objects are shared, not copied"
bash runtime/persistence/store.sh set "misconception:js-closure" \
  "Closure captures variable, not value — var in loop shares one variable"
```

**Confidence Calibration History:**

```bash
bash runtime/metrics/collector.sh record \
  --skill learn-how-to-learn \
  --outcome success \
  --notes "jwt: 5-layer complete, calibration 82% claimed / 78% actual — well calibrated"
```

After N records, `runtime/feedback/analyze.sh` identifies:
- Systematic overconfidence domains (where you reliably think you know more than you do)
- Fast-learning domains (fewer iterations to Layer 5)
- Misconception clusters (failure modes that tend to co-occur)

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Stopping at Layer 1 (vocabulary) | Can use terms, can't apply concepts | Work all 5 layers |
| Skipping Layer 3 (mental model) | Can't predict behavior of unseen scenarios | Build the mechanism model first |
| Treating tutorials as authoritative | Tutorials skip edge cases by design | Use tutorials to start; read docs to finish |
| High confidence without calibration check | Makes confident wrong decisions | Explicit confidence estimation + testing |
| Learning breadth over depth | Surface knowledge fails under real conditions | Depth first in the critical domain |
| Never teaching / explaining | Gaps survive unchallenged | Explain it to verify it |
| Ignoring contradiction evidence | Mental model stays broken | Update model when prediction fails |

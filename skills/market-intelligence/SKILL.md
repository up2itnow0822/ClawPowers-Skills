---
name: market-intelligence
description: Competitive analysis, trend detection, and opportunity scoring through systematic web research, source validation, and insight extraction. Activate when you need to understand a market, competitor, or emerging technology.
version: 1.0.0
requires:
  tools: [bash, curl]
  runtime: false
metrics:
  tracks: [signals_collected, opportunities_identified, accuracy_rate, decision_impact]
  improves: [source_selection, signal_filtering, opportunity_scoring]
---

# Market Intelligence

## When to Use

Apply this skill when:

- Evaluating whether to build a feature vs. buy/use existing solution
- Competitive analysis before a launch or product decision
- Tracking emerging technologies that could impact your stack
- Identifying market opportunities in adjacent spaces
- Evaluating a new tool, framework, or vendor
- Pre-sale research on a prospect's technology environment

**Skip when:**
- You need operational data (use actual analytics, not research)
- The decision is already made (research → decision, not post-hoc justification)
- You need expert analysis (research surfaces raw intelligence; you still interpret it)

## Core Methodology

### Phase 1: Define Intelligence Requirements

Before researching, be specific about what you need to know:

```markdown
## Intelligence Brief

**Decision to be informed:** [What decision does this research support?]
**Key questions:** (3-5 maximum)
1. [Specific question that research can answer]
2. [Specific question that research can answer]

**Scope:**
- Industry/domain: [specific]
- Geography: [specific or global]
- Time horizon: [emerging now, 1yr, 3yr, 5yr]

**Sources to prioritize:**
- [ ] GitHub activity (stars, forks, contributors, issue velocity)
- [ ] HN / reddit / dev communities (practitioner opinions)
- [ ] Official announcements and changelogs
- [ ] Job postings (proxy for investment direction)
- [ ] Academic / research papers (early signals)
- [ ] Analyst reports (if accessible)

**What would change the decision:** [Pre-commit to decision criteria]
```

This prevents the most common intelligence failure: collecting interesting facts that don't answer the actual question.

### Phase 2: Competitor Mapping

For competitive analysis, build a structured competitor map:

**Tier Classification:**
- **Tier 1 (Direct):** Same problem, same target customer, similar approach
- **Tier 2 (Adjacent):** Same problem, different approach OR different customer segment
- **Tier 3 (Emerging):** Different problem today, but could expand into yours

**Data collection per competitor:**
```markdown
## [Competitor Name]

**Tier:** [1/2/3]
**Founded / launched:** [year]
**Team size (estimate):** [from LinkedIn/job postings]

### Product
- **Core offering:** [what problem it solves]
- **Technical approach:** [how it solves it]
- **Key differentiators:** [what they emphasize]
- **Limitations:** [what users complain about — from reviews, GitHub issues, reddit]

### Traction
- GitHub: [stars / forks / contributors / issue velocity]
- npm/PyPI downloads: [weekly download count if available]
- App store ratings: [if applicable]
- Pricing: [public pricing if available]

### Strategy signals
- Recent announcements: [product releases, partnerships, funding]
- Job postings: [what roles? hints at investment direction]
- Content: [what are they publishing? what's the message?]

### Comparison to us
**Advantages over us:** [be honest]
**Our advantages:** [be honest]
**Where they're headed:** [based on signals]
```

### Phase 3: Trend Detection

Identify trends before they become obvious:

**Signal Sources and How to Read Them:**

**GitHub activity:**
```bash
# Stars over time (use GitHub API)
curl -s "https://api.github.com/repos/OWNER/REPO" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Stars: {d[\"stargazers_count\"]}, Forks: {d[\"forks_count\"]}, Open issues: {d[\"open_issues_count\"]}')"

# New repositories in a category (weekly new repo count)
curl -s "https://api.github.com/search/repositories?q=topic:YOUR_TOPIC&sort=stars&order=desc&per_page=10" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Repos: {d[\"total_count\"]}')"
```

**npm/PyPI download trends:**
```bash
# npm weekly downloads
curl -s "https://api.npmjs.org/downloads/point/last-week/PACKAGE_NAME" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Downloads: {d[\"downloads\"]}')"

# Compare week-over-week
curl -s "https://api.npmjs.org/downloads/range/2026-02-01:2026-03-21/PACKAGE_NAME"
```

**Job posting proxy analysis:**
```
High-signal job posting queries (for LinkedIn/Indeed/Hacker News Who's Hiring):
- "Senior [technology]" → investment in scale, not exploration
- "[technology] engineer" count over 6 months → adoption curve position
- Startups posting [technology] roles → early adopter signal
```

**Hacker News trend analysis:**
```bash
# Search HN for discussion volume over time
curl -s "https://hn.algolia.com/api/v1/search?query=YOUR_TOPIC&dateRange=last_month&hitsPerPage=100" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(f'HN posts (30d): {d[\"nbHits\"]}')"
```

### Phase 4: Opportunity Scoring

Score identified opportunities on 4 dimensions:

```markdown
## Opportunity: [Name]

### Scoring (1-5 each)

| Dimension | Score | Evidence |
|-----------|-------|---------|
| **Market size** | [1-5] | [number of companies/users affected] |
| **Pain severity** | [1-5] | [how bad is the problem today?] |
| **Competitive gap** | [1-5] | [how well do existing solutions address this?] |
| **Feasibility** | [1-5] | [can we address this given current resources?] |
| **Strategic fit** | [1-5] | [alignment with current direction?] |

**Total score:** [X/25]

### Evidence
- [Source 1]: [what it signals]
- [Source 2]: [what it signals]

### Risk factors
- [Risk]: [probability × impact]

### Recommended action
- Score > 18: Prioritize for immediate investigation
- Score 12-18: Monitor, consider if resources available
- Score < 12: Log, revisit in 6 months
```

### Phase 5: Intelligence Report

```markdown
# Market Intelligence Report

**Date:** [timestamp]
**Analyst:** [agent]
**Subject:** [specific topic]

## Key Findings

1. **[Finding 1 — most important]**
   [Evidence + implication]

2. **[Finding 2]**
   [Evidence + implication]

3. **[Finding 3]**
   [Evidence + implication]

## Competitive Landscape

[Competitor map summary + tier table]

## Emerging Trends

| Trend | Confidence | Time horizon | Evidence |
|-------|-----------|-------------|---------|
| [Trend 1] | High | 6-12 months | [source] |
| [Trend 2] | Medium | 12-18 months | [source] |

## Opportunities

| Opportunity | Score | Recommended Action |
|-------------|-------|-------------------|
| [Opp 1] | 21/25 | Investigate immediately |
| [Opp 2] | 14/25 | Monitor |

## Recommendations

1. [Concrete recommendation based on research]
2. [Concrete recommendation]

## Sources

[List all sources with access dates]
```

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Persistent Competitive Tracking:**

```bash
# Store competitor snapshots over time
bash runtime/persistence/store.sh set "competitor:superpowers:stars:2026-03-21" "103000"
bash runtime/persistence/store.sh set "competitor:superpowers:npm_weekly:2026-03-21" "12400"

# Next week: compare
bash runtime/persistence/store.sh get "competitor:superpowers:stars:2026-03-14"
# → 102100 last week → 900 new stars (trend: 0.87% weekly growth)
```

**Trend Tracking Over Time:**

`runtime/feedback/analyze.sh` computes:
- Week-over-week GitHub star velocity per tracked competitor
- npm download trends
- HN mention frequency trends

**Intelligence Accuracy Tracking:**

After predictions mature, record accuracy:
```bash
bash runtime/persistence/store.sh set "prediction:x402-adoption:made" "2026-03"
bash runtime/persistence/store.sh set "prediction:x402-adoption:forecast" "mainstream within 18 months"
# Later:
bash runtime/persistence/store.sh set "prediction:x402-adoption:actual" "2027-06:mainstream"
bash runtime/persistence/store.sh set "prediction:x402-adoption:accuracy" "hit"
```

```bash
bash runtime/metrics/collector.sh record \
  --skill market-intelligence \
  --outcome success \
  --notes "skills-framework: 3 competitors mapped, 2 opportunities scored >18, 4 trends identified"
```

## Source Validation

Not all sources are equal. Apply these quality checks:

| Source type | Strength | Weakness | How to use |
|-------------|---------|---------|-----------|
| GitHub stats | Objective, real-time | Stars ≠ production use | Trend over time, not absolute |
| Download numbers | Objective, real | Includes bots/CI | Growth rate more than absolute |
| Community reviews (Reddit, HN) | Unfiltered practitioner opinion | Selection bias (frustrated users more vocal) | Cluster analysis, not individual comments |
| Job postings | Investment proxy | Lags reality by 6-12 months | Directional signal only |
| Vendor blog posts | First-hand | Marketing material | Verify claims independently |
| Academic papers | Early signal | Abstract from production reality | Note publication date, verify in practice |

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Collecting facts without questions | Interesting but not actionable | Define intelligence requirements first |
| One-time snapshot | Markets move; snapshots go stale | Build tracking over time |
| Trusting vendor-written comparisons | Self-serving bias | Primary source research + practitioner forums |
| Correlation as causation | "Company X grew as they adopted Y" ≠ Y caused growth | Control for confounders |
| Ignoring negative signals | Confirmation bias toward preferred outcome | Actively seek contradicting evidence |
| No scoring system | Opportunities can't be prioritized | Explicit multi-dimension scoring |

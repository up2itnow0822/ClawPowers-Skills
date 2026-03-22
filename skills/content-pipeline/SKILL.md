---
name: content-pipeline
description: Write technical content, humanize it for natural voice, format for the target platform, and publish. Activate when creating blog posts, documentation, social media content, or newsletters.
version: 1.0.0
requires:
  tools: [bash, curl]
  runtime: false
metrics:
  tracks: [content_pieces_published, engagement_scores, revision_cycles, publish_time]
  improves: [humanization_quality, platform_formatting, tone_calibration]
---

# Content Pipeline

## When to Use

Apply this skill when:

- Writing technical blog posts or articles
- Creating documentation for public consumption
- Drafting social media content (Twitter/X, LinkedIn, Hacker News)
- Writing newsletters or announcements
- Creating README files for public repositories
- Producing technical tutorials or guides

**Skip when:**
- Writing internal docs (no humanization step needed)
- Pure code comments (different register entirely)
- Short Slack/Teams messages (too much overhead for too little output)

## Core Methodology

### Stage 1: Write (Technical Draft)

Write for accuracy first, voice second. The technical draft should be:

- **Complete** — all required information is present
- **Accurate** — facts, code samples, and commands are verified
- **Structured** — uses headers, lists, and code blocks appropriately
- **Dense** — every sentence carries information; no filler

**Technical draft goals:**
- Code examples compile and run
- Commands produce the described output
- Version numbers and API names are current and accurate
- Links work

**Structure template for technical blog post:**
```markdown
# [Concrete, specific title — no clickbait]

## The Problem
[What pain does the reader have? Why does this matter?]

## The Solution
[What you built/discovered/solved — the payoff]

## How It Works
[Technical explanation with code examples]

## [Additional Implementation Sections]
[Step-by-step if it's a tutorial; depth if it's an analysis]

## Conclusion
[1-2 sentences: what the reader can do now that they couldn't before]
```

**Structure template for documentation:**
```markdown
# [Feature/Component Name]

## Overview
[One paragraph: what this is and when to use it]

## Quick Start
[Minimal working example — 5 lines max]

## Configuration
[All options, with types, defaults, and descriptions]

## Examples
[2-3 realistic use cases with full code]

## Reference
[Complete API/parameter reference]

## Troubleshooting
[Common errors and their solutions]
```

### Stage 2: Humanize

The technical draft sounds like documentation. Published content must sound like a person.

**The problem:** LLM-generated text has a recognizable voice: over-hedged, passive, verbose, and full of transition phrases that signal nothing.

**Banned patterns (remove every instance):**
```
"Delve into"
"It's worth noting that"
"In the realm of"
"Let's explore"
"Dive deep"
"In conclusion"
"In summary"
"Seamlessly"
"Leverage" (when "use" works)
"Game-changer"
"Groundbreaking"
"Revolutionary"
"Powerful" (unqualified)
"Robust" (unqualified)
"Ultimately"
"Furthermore"
"Moreover"
"That being said"
"At the end of the day"
"It's important to note"
```

**Humanization checklist:**
- [ ] Active voice: "The function returns X" not "X is returned by the function"
- [ ] Specific claims: "37% faster" not "significantly faster"
- [ ] No filler intros: Start with the substance, not "In this post, we will..."
- [ ] Conversational where appropriate: Short sentences. Fragments when they land better.
- [ ] Concrete examples from real use, not "imagine a world where..."
- [ ] First person when sharing genuine perspective ("I spent 3 days debugging this")
- [ ] No over-qualified hedging: "This may potentially help some users" → "This solves X"

**Humanization transform examples:**

Before:
> "In this article, we will delve into the powerful features of the ClawPowers framework and explore how it can be leveraged to enhance your agent's capabilities in a seamless manner."

After:
> "ClawPowers gives your coding agent 20 skills. Here's how each one works and when to use it."

Before:
> "It's worth noting that the runtime layer provides significant performance improvements."

After:
> "The runtime layer cuts task time by 40% on average. Here's the data."

### Stage 3: Platform Formatting

Different platforms have different requirements:

**Technical blog (dev.to, Hashnode, personal blog):**
- Length: 1500-3000 words (comprehensive guides: up to 5000)
- Code blocks with language hints
- Headers for navigation (H2, H3 — not H4+)
- Images optional but useful for architecture diagrams
- Tags: 3-5, technical and specific

**Twitter/X thread:**
- Thread format: lead tweet → detail tweets → conclusion
- Lead: hook + value proposition in 280 chars
- Each tweet: one idea, can stand alone
- No jargon in the lead tweet (hook a broader audience)
- End with CTA (link, follow, reply)
- Example thread structure:
  ```
  Tweet 1: Hook (the problem or the surprising result)
  Tweet 2-3: Setup/context
  Tweet 4-7: The substance (one idea per tweet)
  Tweet 8: The takeaway
  Tweet 9: CTA + link
  ```

**LinkedIn:**
- Length: 150-300 words (longer performs worse)
- Line breaks every 1-3 sentences (LinkedIn's UI favors scannable text)
- First 2 lines must hook (everything else is hidden behind "see more")
- Professional but human tone
- End with a question to drive comments

**Hacker News (Show HN / Ask HN):**
- Title: factual, specific, no marketing language
- Top comment: author context, what problem it solves, technical details
- Avoid superlatives — community is allergic to hype
- "I built X to solve Y problem" not "Revolutionary new tool transforms..."

**GitHub README:**
- Badge line first (CI status, npm version, license)
- 3-sentence description: what, who, why
- Quick start must work with copy-paste
- Architecture diagram for complex projects
- License and contributing section at bottom

**Newsletter:**
- Subject line: specific, implies value ("How we cut our test suite from 8min to 47sec")
- Preheader: complements subject, not a repeat
- Opening: straight to value — no "Hey, it's [name]!"
- Sections: use headers, keep scannable
- CTA: one primary action, at the bottom

### Stage 4: Pre-Publish Review

Before publishing:

- [ ] All code samples verified (copy-paste and run)
- [ ] All links work
- [ ] No confidential information (internal URLs, customer names, private configs)
- [ ] Humanization complete (banned phrases removed)
- [ ] Platform format applied
- [ ] Title is accurate and specific
- [ ] Tags/categories are correct

### Stage 5: Publish

**Blog platforms (API publishing):**

```bash
# dev.to API
curl -X POST "https://dev.to/api/articles" \
  -H "api-key: $DEV_TO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "article": {
      "title": "Your Article Title",
      "body_markdown": "'"$(cat article.md)"'",
      "published": true,
      "tags": ["programming", "ai", "tools"]
    }
  }'
```

**GitHub (documentation):**
```bash
# Update docs in repo
git add docs/new-feature.md
git commit -m "docs: add [feature] guide"
git push
```

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Publication Tracking:**

```bash
bash runtime/persistence/store.sh set "content:clawpowers-intro:platform" "dev.to"
bash runtime/persistence/store.sh set "content:clawpowers-intro:published_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
bash runtime/persistence/store.sh set "content:clawpowers-intro:url" "https://dev.to/..."
```

**Engagement Tracking:**

After 24-48 hours, update with engagement metrics:
```bash
bash runtime/persistence/store.sh set "content:clawpowers-intro:views" "847"
bash runtime/persistence/store.sh set "content:clawpowers-intro:reactions" "34"
bash runtime/persistence/store.sh set "content:clawpowers-intro:comments" "7"
```

**Content Performance Analysis:**

`runtime/feedback/analyze.sh` identifies:
- Best-performing title patterns
- Optimal content length per platform
- Highest-engagement topic areas
- Time-of-publish correlation with reach

```bash
bash runtime/metrics/collector.sh record \
  --skill content-pipeline \
  --outcome success \
  --notes "clawpowers-intro: 1800 words, dev.to + twitter thread, published"
```

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Publishing technical draft directly | Reads like documentation, not content | Always run humanization step |
| Same text on all platforms | Each platform has different format requirements | Platform-specific formatting per Stage 3 |
| Unverified code samples | Readers can't reproduce, damages credibility | Run every code sample before publishing |
| Superlative titles ("The BEST guide to...") | Algorithms deprioritize, readers distrust | Specific, factual titles |
| Buried lede | Readers don't reach the value | Lead with the most interesting thing |
| Publishing without review | Errors in published content are permanent | Pre-publish checklist, always |
| No CTA | Content doesn't drive the desired outcome | One clear CTA per piece |

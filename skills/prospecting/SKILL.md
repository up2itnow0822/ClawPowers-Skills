---
name: prospecting
description: Lead generation workflow — define ICP, find companies, enrich contacts, and prepare outreach. Activate when you need to build a qualified prospect list.
version: 1.0.0
requires:
  tools: [bash, curl]
  runtime: true
metrics:
  tracks: [prospects_found, qualification_rate, enrichment_rate, outreach_response_rate]
  improves: [icp_precision, search_query_effectiveness, enrichment_source_selection]
---

# Prospecting

## When to Use

Apply this skill when:

- Building a list of potential customers for a product or service
- Researching companies before a sales call or outreach
- Finding decision-makers at target companies
- Validating that a market segment is large enough to pursue
- Preparing personalized outreach at scale

**Skip when:**
- You already have qualified prospects — move to outreach preparation
- The ICP (Ideal Customer Profile) isn't defined — define it first
- You need > 500 prospects (use dedicated sales intelligence platforms)

**Relationship to market-intelligence:**
```
market-intelligence: understand the market (TAM, trends, positioning)
prospecting: find specific companies and contacts within the market
```

## Core Methodology

### Phase 1: ICP Definition

Every prospecting campaign starts with a precise Ideal Customer Profile. Vague ICPs produce low-quality lists.

**ICP template:**

```markdown
## Ideal Customer Profile

### Company Attributes
- **Industry:** [specific vertical(s) — e.g., "fintech SaaS" not "software"]
- **Company size:** [employees: 50-500, or ARR: $5M-$50M]
- **Stage:** [Series A/B/C, bootstrapped, public — funding is proxy for budget authority]
- **Tech stack:** [if relevant — e.g., uses Python, AWS, GitHub Actions]
- **Geography:** [US/EU/APAC — where procurement decisions are made]
- **Signals:** [hiring patterns, job postings, tech adoption signals]

### Contact Attributes  
- **Title:** [VP Engineering, Director of DevOps, CTO — who FEELS the pain]
- **Department:** [Engineering, Product, Security]
- **Seniority:** [IC, Manager, Director, VP, C-Suite — who has BUDGET]
- **Pain signal:** [recent role change, company event, content they've published]

### Negative ICP (Disqualifiers)
- **Company:** [too small, regulated industry if compliance blocks you, bootstrapped with no budget]
- **Contact:** [non-technical roles, no budget authority, different pain set]

### Qualification Criteria (rank in this order)
1. [Must-have criterion — no exceptions]
2. [Must-have criterion — no exceptions]
3. [Strong signal — weight heavily]
4. [Good signal — weight moderately]
```

### Phase 2: Company Discovery

**Search Strategies:**

**GitHub-based discovery (for developer tools):**
```bash
# Find companies using a specific technology
curl -s "https://api.github.com/search/repositories?q=TECHNOLOGY+in:readme&sort=stars&per_page=30" | \
  python3 -c "
import json, sys
data = json.load(sys.stdin)
for item in data['items']:
    if item['owner']['type'] == 'Organization':
        print(f\"{item['owner']['login']}: {item['full_name']} ({item['stargazers_count']} stars)\")
"
```

**LinkedIn company search:**

Build search queries using Boolean operators:
```
"(VP Engineering OR Director Engineering OR CTO) AND (Python OR TypeScript) AND (Series B OR Series C)"
Location: United States
Industry: Computer Software
Company size: 51-500 employees
```

**Exa/Perplexity for intent signals:**
```bash
# Find companies recently discussing a pain point you solve
curl -X POST "https://api.exa.ai/search" \
  -H "x-api-key: $EXA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "engineering team struggling with test coverage deployment velocity",
    "type": "neural",
    "numResults": 10,
    "includeDomains": ["linkedin.com", "dev.to", "medium.com"],
    "startPublishedDate": "2026-01-01"
  }'
```

**Apollo.io for direct prospecting:**
```bash
# Search for people matching ICP
curl -X POST "https://api.apollo.io/v1/mixed_people/search" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $APOLLO_API_KEY" \
  -d '{
    "person_titles": ["VP Engineering", "Director of Engineering", "CTO"],
    "organization_num_employees_ranges": ["51,500"],
    "page": 1,
    "per_page": 25
  }'
```

### Phase 3: Qualification

For each company found, score against your ICP:

```markdown
## Company: [Name]

**URL:** [company.com]
**Size:** [employees]
**Stage:** [funding round]
**Tech signals:** [GitHub org, job postings for relevant tech]

### ICP Score
| Criterion | Met? | Evidence |
|-----------|------|---------|
| [Must-have 1] | ✅/❌ | [source] |
| [Must-have 2] | ✅/❌ | [source] |
| [Signal 1] | ✅/❌/? | [source] |
| [Signal 2] | ✅/❌/? | [source] |

**Status:** Qualified / Disqualified / Research needed
**Reason for disqualification:** [if applicable]
```

**Qualification protocol:**
- Must-have criterion fail → immediate disqualification, no enrichment
- 2+ strong signals + no disqualifiers → high-priority prospect
- Unclear signals → brief additional research, then decide

### Phase 4: Contact Enrichment

For qualified companies, find the right contacts:

**LinkedIn-based enrichment:**

Use LinkedIn's company page to find decision-makers:
```
company.com/about/leadership → C-suite
LinkedIn search: [Company Name] + [Target Title]
```

**Hunter.io for email discovery:**
```bash
# Find email pattern for a domain
curl -s "https://api.hunter.io/v2/domain-search?domain=company.com&api_key=$HUNTER_API_KEY" | \
  python3 -c "
import json, sys
data = json.load(sys.stdin)
print(f'Email pattern: {data[\"data\"][\"pattern\"]}')
for email in data['data']['emails'][:5]:
    print(f'{email[\"value\"]}: {email[\"first_name\"]} {email[\"last_name\"]} ({email[\"position\"]})')
"

# Verify a specific email
curl -s "https://api.hunter.io/v2/email-verifier?email=john@company.com&api_key=$HUNTER_API_KEY"
```

**Enriched contact record:**
```markdown
## Contact: [First Last]

**Company:** [Company Name]
**Title:** [Exact current title]
**Email:** [email@company.com] (confidence: High/Medium)
**LinkedIn:** [URL]
**GitHub:** [username if found]

### Personalization hooks
- **Recent activity:** [blog post, conference talk, job change, company announcement]
- **Shared connections:** [mutual contacts]
- **Pain signals:** [job posting for their team, content they've published]
- **Tech interest:** [repos they've starred, tools they've written about]

### Outreach priority
[High / Medium / Low] — [reason]
```

### Phase 5: Outreach Preparation

Prepare personalized outreach for high-priority contacts:

**Outreach template principles:**
- Short: 3-4 sentences max (first touch)
- Specific: One concrete observation about their situation
- Relevant: Clear connection between their pain and your solution
- Easy: Lowest-friction next step ("5-minute call" not "let's do a demo")

**Template structure:**
```
[Personalized opener — specific observation about them or their company]
[What you do — one sentence, focused on the problem you solve]
[Why relevant to them — connect their signal to your solution]
[Low-friction CTA — open-ended question or easy next step]
```

**Example (developer tools):**
```
Hi [Name],

Saw [Company] is hiring 3 senior engineers right now — congrats on the growth. 
We built ClawPowers to help engineering teams like yours ship faster by giving 
AI coding agents persistent memory and self-improvement — instead of re-explaining 
context every session.

Would it be worth 10 minutes to see if it fits your current workflow?
```

**What to avoid:**
- "I hope this finds you well"
- "I came across your profile"
- Feature lists in the first touch
- Asking for 30-60 minute meetings
- CC'ing multiple people without introduction

### Phase 6: CRM Output

Export qualified, enriched prospects to your CRM:

```bash
# Build CSV for CRM import
cat > prospects.csv << 'EOF'
company,first_name,last_name,title,email,linkedin,priority,notes
Acme Corp,Jane,Smith,VP Engineering,jane@acme.com,linkedin.com/in/jsmith,High,"Hiring 3 engineers; OSS contributor"
EOF

# Or output JSON for API import
python3 -c "
import json
prospects = [
    {
        'company': 'Acme Corp',
        'contact': {'first': 'Jane', 'last': 'Smith', 'title': 'VP Engineering'},
        'email': 'jane@acme.com',
        'priority': 'high',
        'personalization': 'Hiring 3 engineers; active OSS contributor'
    }
]
print(json.dumps(prospects, indent=2))
"
```

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Prospect Database:**

All prospects, enrichment, and outreach outcomes are stored:
```bash
bash runtime/persistence/store.sh set "prospect:acme-jane-smith:status" "outreach_sent"
bash runtime/persistence/store.sh set "prospect:acme-jane-smith:email_sent_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
bash runtime/persistence/store.sh set "prospect:acme-jane-smith:response" "interested"
bash runtime/persistence/store.sh set "prospect:acme-jane-smith:response_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

**ICP Refinement:**

Response rates feed back into ICP scoring:
```bash
bash runtime/feedback/analyze.sh --skill prospecting
# Output:
# ICP criterion effectiveness:
# - "hiring 3+ engineers" signal → 34% response rate (high signal)
# - "Series B" signal → 12% response rate (weak signal)
# - "Python OR TypeScript in job postings" → 28% response rate (medium signal)
# Recommendation: weight hiring signal 3x vs. funding stage
```

```bash
bash runtime/metrics/collector.sh record \
  --skill prospecting \
  --outcome success \
  --notes "devtools-campaign: 25 companies qualified, 18 contacts enriched, 18 outreach prepared"
```

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Spray-and-pray outreach | Low response rate, damages brand | Qualify before enriching, enrich before outreach |
| Contacting every person at a company | Creates noise, damages company relationship | One contact per company (initial touch) |
| Generic outreach without personalization | Reads as spam | Specific, researched opener per contact |
| Not disqualifying early | Wasted enrichment and outreach effort | Score ICP criteria before enrichment |
| Storing prospects without follow-up system | Prospects go cold | CRM entry with follow-up date at enrichment time |
| Asking for a demo in first touch | Friction too high for cold contact | Low-friction first step (quick call, question) |
| Not tracking response rates per ICP signal | Can't improve ICP over time | Log which signals correlated with responses |

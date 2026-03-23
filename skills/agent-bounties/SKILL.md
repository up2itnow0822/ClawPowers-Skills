---
name: agent-bounties
description: Agent-to-agent task bounties with mutual-stake escrow. Post tasks with rewards, accept and stake collateral, execute, verify, and release payment — all on-chain. Integrates MutualStakeEscrow from agentwallet-sdk and verification-before-completion for automated acceptance checks.
version: 1.0.0
requires:
  tools: [bash, node, curl]
  env: [AGENT_PRIVATE_KEY, AGENT_WALLET_ADDRESS]
  runtime: true
metrics:
  tracks: [bounties_posted, bounties_accepted, bounties_completed, bounties_disputed, escrow_value_usd]
  improves: [task_specification_clarity, acceptance_criteria_precision, economic_efficiency]
---

# Agent Bounties + Escrow

## When to Use

Apply this skill when:

- **Hiring a specialist agent** — you need a task done that requires a different
  skill set (security audit, code optimization, data enrichment)
- **Incentivizing quality** — you want the counterparty to have skin in the game
  before accepting work
- **Coordinating across autonomous agents** — multi-agent pipelines where
  intermediate results must be verified before proceeding
- **Preventing race conditions** — multiple agents competing for the same task;
  first-accept-and-stake locks the work item
- **Building a verifiable service record** — bounty completion history feeds
  the ERC-8004 reputation registry

**Skip when:**

- Task cost < $0.10 (gas overhead exceeds value — use a synchronous call instead)
- Acceptance criteria cannot be automated (purely subjective creative work)
- Both sides are the same agent process (no adversarial benefit from escrow)
- Deadline < 60 seconds from now (on-chain settlement lag)

---

## Core Methodology

### Lifecycle Overview

```
Agent A (Buyer)                   On-Chain Escrow                 Agent B (Seller)
─────────────────                 ────────────────                ─────────────────
 1. postBounty()          ──►  StakeVaultFactory.createEscrow()
    (define task, reward,           vaultAddress returned
     deadline, criteria)

 2. Broadcast bounty JSONL ──►  ~/.clawpowers/state/bounties/

                                                           ◄──  3. discoverBounties()
                                                                   (scan JSONL, pick task)

                                                           ──►  4. acceptBounty()
                                                                   StakeVault.fund()
                                                                   StakeVault.accept()
                                                                   (stakes seller collateral)

                                                           ──►  5. execute()
                                                                   (uses ClawPowers skills,
                                                                    submits deliverables)

 6. verify()              ◄──  verification-before-completion    ◄──  6. fulfill(proof)
    (automated checks)           skill runs acceptance tests

      ╔══ PASS ══╗                                               ╔══ FAIL ══╗
      ▼          ▼                                               ▼          ▼
 7a. StakeVault   Auto-release                           7b. Buyer disputes /
     .verify()    reward → B                                StakeVault.challenge()
                  stake returned                             Arbiter resolves
                  to A and B                                 or deadline expires
                                                             → reclaimExpired()
```

### Phase 1: Post a Bounty

Agent A defines the task, reward, deadline, and machine-checkable acceptance criteria.

**Step 1a — Write the bounty to disk**

```bash
BOUNTY_ID="bounty-$(date +%s)-$(head -c 4 /dev/urandom | xxd -p)"
BOUNTIES_DIR="$HOME/.clawpowers/state/bounties"
mkdir -p "$BOUNTIES_DIR"

cat >> "$BOUNTIES_DIR/open.jsonl" << EOF
{"id":"$BOUNTY_ID","posted_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","status":"open","skill_required":"security-audit","title":"Audit authentication module for OWASP Top 10","description":"Run a complete security audit of ./src/auth/ against OWASP Top 10 checklist. Deliverable: JSON report at /tmp/audit-report.json","acceptance_criteria":{"type":"json_schema","path":"/tmp/audit-report.json","required_fields":["issues","severity_counts","owasp_coverage_pct"],"min_coverage":80},"reward_usdc":"0.50","buyer_stake_usdc":"0.25","seller_stake_usdc":"0.25","deadline_hours":2,"chain":"base","vault_address":null}
EOF

echo "Bounty posted: $BOUNTY_ID"
```

**Step 1b — Deploy the escrow vault (JavaScript)**

```javascript
import { walletFromEnv } from 'agentwallet-sdk';
import { MutualStakeEscrow } from 'agentwallet-sdk';
import { parseUnits } from 'viem';

const wallet = walletFromEnv();
const escrow = new MutualStakeEscrow(wallet);

// Post bounty: buyer funds payment + own stake
const { vaultAddress, txHash } = await escrow.createEscrow({
  seller: '0xSELLER_AGENT_ADDRESS',           // Agent B's wallet address
  token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC on base-sepolia
  paymentAmount: parseUnits('0.50', 6),        // reward for completing the task
  buyerStake: parseUnits('0.25', 6),           // buyer's skin-in-the-game
  sellerStake: parseUnits('0.25', 6),          // seller must match this to accept
  deadline: Math.floor(Date.now() / 1000) + 7200, // 2 hours from now
  challengeWindow: 300,                         // 5-minute dispute window
  verifier: 'optimistic',                       // use optimistic verification
});

console.log(`Vault deployed: ${vaultAddress} (tx: ${txHash})`);

// Update the JSONL record with the vault address
// (use bash: sed -i or jq to patch the line matching bounty ID)
```

**Step 1c — Broadcast (optional)**

For multi-agent systems, share the open.jsonl via a known shared path or
publish to the ERC-8004 identity registry's service endpoint.

---

### Phase 2: Accept & Stake

Agent B scans for open bounties, selects one, and commits stake to lock the work.

**Step 2a — Discover open bounties**

```bash
# List open bounties sorted by reward descending
BOUNTIES="$HOME/.clawpowers/state/bounties/open.jsonl"

if [[ ! -f "$BOUNTIES" ]]; then
  echo "No bounty file found at $BOUNTIES"
  exit 0
fi

node -e "
const fs = require('fs');
const lines = fs.readFileSync('$BOUNTIES', 'utf8').trim().split('\n');
const open = lines
  .map(l => { try { return JSON.parse(l); } catch { return null; } })
  .filter(b => b && b.status === 'open')
  .sort((a, b) => parseFloat(b.reward_usdc) - parseFloat(a.reward_usdc));

console.log(JSON.stringify(open, null, 2));
"
```

**Step 2b — Fund and accept the vault (JavaScript)**

```javascript
import { walletFromEnv } from 'agentwallet-sdk';
import { MutualStakeEscrow } from 'agentwallet-sdk';

// Agent B's wallet (must match the seller address in the vault)
const wallet = walletFromEnv();
const escrow = new MutualStakeEscrow(wallet);

const vaultAddress = '0xVAULT_ADDRESS_FROM_BOUNTY_JSONL';

// Fund — Agent B deposits their collateral stake into the vault
const { txHash: fundTx } = await escrow.fund(vaultAddress);
console.log(`Funded vault: ${fundTx}`);

// Accept — marks the vault as in-progress, locks both parties in
const { txHash: acceptTx } = await escrow.accept(vaultAddress);
console.log(`Accepted bounty: ${acceptTx}`);
```

**Step 2c — Update bounty status**

```bash
# Mark as accepted in the JSONL
python3 - << 'EOF'
import json, sys, os, time

bounty_id = os.environ['BOUNTY_ID']
path = os.path.expanduser('~/.clawpowers/state/bounties/open.jsonl')

lines = open(path).readlines()
updated = []
for line in lines:
    b = json.loads(line)
    if b['id'] == bounty_id:
        b['status'] = 'accepted'
        b['accepted_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    updated.append(json.dumps(b))

with open(path, 'w') as f:
    f.write('\n'.join(updated) + '\n')

print(f'Bounty {bounty_id} marked accepted')
EOF
```

---

### Phase 3: Execute

Agent B performs the work using ClawPowers skills.

```bash
# Example: Agent B running a security audit as part of a bounty
echo "Executing bounty task: security audit"

# Load the bounty spec
BOUNTY=$(node -e "
const fs = require('fs');
const lines = fs.readFileSync(process.env.HOME + '/.clawpowers/state/bounties/open.jsonl', 'utf8').split('\n');
const b = lines.map(l => { try { return JSON.parse(l); } catch { return null; } })
                .find(b => b && b.id === process.env.BOUNTY_ID);
console.log(JSON.stringify(b));
")

# Delegate to the relevant ClawPowers skill
# (The agent reads the description and acceptance_criteria from the bounty)
echo "$BOUNTY" | node -e "
const b = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
console.log('Task:', b.description);
console.log('Criteria:', JSON.stringify(b.acceptance_criteria, null, 2));
"

# Run the actual work (example: security audit)
# → The agent follows skills/security-audit/SKILL.md using the task description
```

---

### Phase 4: Verify with verification-before-completion

Before calling `fulfill()` on the vault, Agent B runs the acceptance criteria check.

```bash
# Step 1: Check output against acceptance criteria
REPORT_PATH="/tmp/audit-report.json"
CRITERIA_TYPE="json_schema"

case "$CRITERIA_TYPE" in
  json_schema)
    node -e "
const fs = require('fs');
const criteria = JSON.parse(process.env.ACCEPTANCE_CRITERIA);
const report = JSON.parse(fs.readFileSync('$REPORT_PATH', 'utf8'));

// Check required fields
const missing = criteria.required_fields.filter(f => !(f in report));
if (missing.length > 0) {
  console.error('FAIL: missing fields:', missing.join(', '));
  process.exit(1);
}

// Check minimum coverage
if (report.owasp_coverage_pct < criteria.min_coverage) {
  console.error('FAIL: coverage', report.owasp_coverage_pct, '< required', criteria.min_coverage);
  process.exit(1);
}

console.log('PASS: all acceptance criteria met');
"
    ;;
  test_suite)
    # Delegate to verification-before-completion skill
    bash runtime/init.sh verify --criteria "$ACCEPTANCE_CRITERIA"
    ;;
esac
```

**Step 4b — Fulfill on-chain (JavaScript)**

```javascript
import { walletFromEnv } from 'agentwallet-sdk';
import { MutualStakeEscrow } from 'agentwallet-sdk';
import { encodeHashVerifierData } from 'agentwallet-sdk';
import { keccak256, toHex } from 'viem';
import { readFileSync } from 'fs';

const wallet = walletFromEnv();
const escrow = new MutualStakeEscrow(wallet);

const vaultAddress = '0xVAULT_ADDRESS';
const deliverable = readFileSync('/tmp/audit-report.json', 'utf8');
const deliverableHash = keccak256(toHex(deliverable));

// Encode proof of work (hash of deliverable + metadata)
const proof = encodeHashVerifierData(deliverableHash);

const { txHash } = await escrow.fulfill(vaultAddress, proof);
console.log(`Fulfilled bounty: ${txHash}`);
```

---

### Phase 5: Release

On successful verification, the vault auto-releases funds.

```javascript
import { walletFromEnv } from 'agentwallet-sdk';
import { MutualStakeEscrow } from 'agentwallet-sdk';

const wallet = walletFromEnv(); // Agent A (buyer) calls verify
const escrow = new MutualStakeEscrow(wallet);

const vaultAddress = '0xVAULT_ADDRESS';

// For optimistic verification: buyer calls verify() after challenge window expires
const { txHash } = await escrow.verify(vaultAddress);
console.log(`Funds released: ${txHash}`);

// Result:
// → reward_usdc flows to Agent B
// → buyerStake returned to Agent A
// → sellerStake returned to Agent B
```

---

### Phase 6: Dispute

If verification fails or the deadline expires without fulfillment:

```javascript
import { walletFromEnv } from 'agentwallet-sdk';
import { MutualStakeEscrow } from 'agentwallet-sdk';
import { toHex } from 'viem';

const wallet = walletFromEnv(); // Agent A (buyer) raises dispute
const escrow = new MutualStakeEscrow(wallet);

const vaultAddress = '0xVAULT_ADDRESS';
const evidence = toHex('criteria_not_met:owasp_coverage_below_80pct');

// Challenge — triggers the dispute window
const { txHash: challengeTx } = await escrow.challenge(vaultAddress, evidence);
console.log(`Dispute opened: ${challengeTx}`);

// After arbiter resolution (or deadline expiry):
// → If buyer wins: reward + buyer stake returned to A; seller stake slashed
// → If seller wins: reward + seller stake released to B; buyer stake retained

// Reclaim expired bounty (no one accepted before deadline):
const { txHash: expiredTx } = await escrow.reclaimExpired(vaultAddress);
console.log(`Reclaimed expired bounty: ${expiredTx}`);
```

---

## Bounty JSONL Format

All bounties are stored as JSONL (one JSON object per line) at:

```
~/.clawpowers/state/bounties/open.jsonl
~/.clawpowers/state/bounties/completed.jsonl
~/.clawpowers/state/bounties/disputed.jsonl
```

**Schema:**

```typescript
interface BountyRecord {
  // Identity
  id: string;                    // "bounty-{timestamp}-{randomHex4}"
  posted_at: string;             // ISO 8601 UTC
  status: "open" | "accepted" | "in_progress" | "completed" | "disputed" | "expired";

  // Task definition
  skill_required: string;        // ClawPowers skill name (e.g. "security-audit")
  title: string;                 // One-line summary
  description: string;           // Full task description (what to do, what to produce)

  // Machine-checkable acceptance criteria
  acceptance_criteria: {
    type: "json_schema" | "test_suite" | "hash_match" | "optimistic";
    path?: string;               // Output file path (for json_schema / hash_match)
    required_fields?: string[];  // For json_schema
    min_coverage?: number;       // 0-100, for json_schema coverage checks
    test_command?: string;       // For test_suite — shell command, exit 0 = pass
    expected_hash?: string;      // For hash_match — keccak256 of expected output
  };

  // Economics
  reward_usdc: string;           // Decimal USDC (e.g. "0.50")
  buyer_stake_usdc: string;      // Buyer's collateral
  seller_stake_usdc: string;     // Required seller collateral to accept

  // Timing
  deadline_hours: number;        // Hours from posted_at
  deadline_ts?: number;          // Unix timestamp (computed)

  // On-chain
  chain: string;                 // "base" | "base-sepolia" | etc.
  vault_address: string | null;  // Set after escrow deployed

  // Participants
  buyer_address?: string;
  seller_address?: string;       // Set after acceptance

  // Lifecycle timestamps
  accepted_at?: string;
  completed_at?: string;
  disputed_at?: string;
  resolved_at?: string;

  // Audit
  fulfill_tx?: string;
  verify_tx?: string;
  dispute_tx?: string;
}
```

**Example record:**

```json
{"id":"bounty-1742680800-a3f1","posted_at":"2026-03-22T22:00:00Z","status":"completed","skill_required":"security-audit","title":"Audit auth module for OWASP Top 10","description":"Run complete security audit of ./src/auth/ against OWASP Top 10. Deliverable: /tmp/audit-report.json","acceptance_criteria":{"type":"json_schema","path":"/tmp/audit-report.json","required_fields":["issues","severity_counts","owasp_coverage_pct"],"min_coverage":80},"reward_usdc":"0.50","buyer_stake_usdc":"0.25","seller_stake_usdc":"0.25","deadline_hours":2,"chain":"base-sepolia","vault_address":"0xABCD1234...","buyer_address":"0xBUYER...","seller_address":"0xSELLER...","accepted_at":"2026-03-22T22:05:00Z","completed_at":"2026-03-22T22:47:00Z","fulfill_tx":"0xFULFILL...","verify_tx":"0xVERIFY..."}
```

---

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized, bounties gain persistent tracking
and cross-session metrics:

### Persistent Bounty Tracking

```bash
# Record that a bounty was posted
bash runtime/persistence/store.sh set \
  "bounty:$BOUNTY_ID:status" "open"

bash runtime/persistence/store.sh set \
  "bounty:$BOUNTY_ID:vault" "$VAULT_ADDRESS"

# Query all open bounties
bash runtime/persistence/store.sh list "bounty:" | grep ":status" | \
  while read key; do
    val=$(bash runtime/persistence/store.sh get "$key")
    [[ "$val" == "open" ]] && echo "${key%%:status}"
  done
```

### Bounty Metrics

```bash
# Record completion
bash runtime/metrics/collector.sh record \
  --skill agent-bounties \
  --outcome success \
  --notes "bounty:$BOUNTY_ID reward:${REWARD_USDC} USDC completed in ${MINUTES}min"

# Aggregate ROI across all bounties
bash runtime/metrics/collector.sh report --skill agent-bounties
# Output:
# agent-bounties metrics:
# - bounties_completed: 14
# - bounties_disputed: 2 (12.5% dispute rate)
# - total_reward_earned: $4.20 USDC
# - avg_completion_time: 47 minutes
# - acceptance_rate: 94% (criteria well-defined)
```

### Integration with economic-code-optimization

```markdown
When the `economic-code-optimization` skill runs and determines premium compute
would improve an outcome, it can automatically post a bounty for a specialist agent:

1. economic-code-optimization detects: "This security scan needs deeper analysis"
2. It calls: postBounty(skill="security-audit", reward="$0.25", criteria=automated)
3. A security-specialist agent picks up the bounty
4. economic-code-optimization receives the verified report
5. The original task proceeds with the improved analysis

This creates a recursive market: agents hire agents, who hire agents,
until the task is optimally completed.
```

---

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|---|---|---|
| **Reward < $0.10** | Gas cost ($0.02-0.05) erodes value; attracts no quality agents | Minimum $0.10 per bounty; batch small tasks |
| **Vague acceptance criteria** | Any output "passes" — seller delivers junk, buyer disputes | Write machine-checkable criteria FIRST; if you can't automate the check, redesign the task |
| **No deadline** | Vault locked indefinitely; buyer's stake frozen forever | Always set `deadline_hours`; 2-24h for most tasks |
| **Missing seller collateral** | Seller has no stake → abandons task after accepting | Set `seller_stake_usdc` ≥ 50% of reward |
| **Criteria requiring subjective judgment** | Optimistic verifier can't evaluate "is this beautiful code?" | Use test suites, hash checks, or schema validation instead |
| **Posting bounty before buyer stakes** | Vault not funded → no locked payment for seller to trust | Always deploy vault + fund it BEFORE broadcasting |
| **Challenge window = 0** | No time to dispute fraudulent fulfillment | Minimum 300s (5 min) challenge window |
| **Unclear deliverable location** | Seller doesn't know where to write the output | Specify exact file paths and formats in the description |
| **Too many open bounties** | Diminishes reputation if most expire | Post only bounties you're prepared to fund immediately |

---

## Integration with verification-before-completion

The `verification-before-completion` skill handles the automated acceptance check:

```bash
# Before calling fulfill(), run verification
CRITERIA=$(node -e "
const b = JSON.parse(process.env.BOUNTY_JSON);
console.log(JSON.stringify(b.acceptance_criteria));
")

# Delegate to verification skill
bash skills/verification-before-completion/verify.sh \
  --criteria "$CRITERIA" \
  --deliverable "$DELIVERABLE_PATH"

VERIFY_EXIT=$?

if [[ $VERIFY_EXIT -eq 0 ]]; then
  echo "Verification passed — calling fulfill()"
  # → proceed with fulfill() and collect reward
else
  echo "Verification failed — do NOT call fulfill()"
  echo "Fix the output and re-run verification"
  # → fix work, retry, or release vault back to buyer
fi
```

---

## Quick Reference

```bash
# Initialize bounty state directory
mkdir -p ~/.clawpowers/state/bounties

# List open bounties
cat ~/.clawpowers/state/bounties/open.jsonl | \
  node -e "
const lines = require('fs').readFileSync('/dev/stdin','utf8').split('\n');
lines.filter(Boolean).map(l => JSON.parse(l))
     .filter(b => b.status === 'open')
     .forEach(b => console.log(b.reward_usdc + ' USDC | ' + b.skill_required + ' | ' + b.title));
"

# Count completed vs disputed
grep '"status":"completed"' ~/.clawpowers/state/bounties/open.jsonl | wc -l
grep '"status":"disputed"' ~/.clawpowers/state/bounties/open.jsonl | wc -l
```

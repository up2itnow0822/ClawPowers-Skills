# ClawPowers skills for Hermes

This directory is the **Hermes-supported surface** for this branch.

Only skills placed here are in scope for the branch's Hermes compatibility claim.

## Current validated skills

- `itp`

## Install shape

Hermes expects skills like:

```text
~/.hermes/skills/<skill-name>/SKILL.md
```

Example:

```bash
mkdir -p ~/.hermes/skills/itp
cp skills/itp/SKILL.md ~/.hermes/skills/itp/SKILL.md
```

Then validate with Hermes' own skill tooling.

## Important boundary

Do not assume the broader `clawpowers` npm library is a native Hermes package just because a skill bundle in this directory works.

This branch separates:

- **Hermes-compatible skill bundles** under `skills/`
- **non-Hermes-native library/runtime surfaces** elsewhere in the repo

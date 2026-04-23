# ClawPowers skills for Hermes

This directory is the **Hermes-supported surface** for this branch.

Only skills placed here are in scope for the branch's Hermes compatibility claim.

## Current exported skills

- Total exported skills: 67
- Hand-authored validated wedge: `itp`
- Remaining 66 exported skills are catalog-derived Hermes `SKILL.md` wrappers generated from `src/skills/catalog.ts` so Hermes can discover and load the full ClawPowers skill surface on this branch.

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

This branch now exports the full ClawPowers catalog as Hermes-loadable skill bundles, but that does **not** automatically mean every broader `clawpowers` runtime/library module is a native Hermes package surface.

This branch separates:

- **Hermes-compatible skill bundles** under `skills/`
- **non-Hermes-native library/runtime surfaces** elsewhere in the repo

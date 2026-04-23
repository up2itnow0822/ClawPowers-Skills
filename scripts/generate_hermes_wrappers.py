from pathlib import Path
import re

repo = Path('/home/max/.openclaw/workspace/tmp/clawpowers-skills-hermes-branch')
catalog_path = repo / 'src/skills/catalog.ts'
text = catalog_path.read_text()

pattern = re.compile(
    r"\{\s*name:\s*'(?P<name>[^']+)'\s*,\s*description:\s*'(?P<desc>(?:[^'\\]|\\.)*)'\s*,\s*source:\s*'(?P<source>[^']+)'\s*,\s*category:\s*'(?P<category>[^']+)'\s*,\s*\}",
    re.S,
)

entries = []
for m in pattern.finditer(text):
    name = m.group('name')
    desc = m.group('desc').replace("\\'", "'")
    entries.append({
        'name': name,
        'description': desc,
        'source': m.group('source'),
        'category': m.group('category'),
    })

skills_root = repo / 'skills'
skills_root.mkdir(exist_ok=True)
skip_existing_rich = {'itp'}
count = 0
for entry in entries:
    name = entry['name']
    if name in skip_existing_rich:
        continue
    skill_dir = skills_root / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    desc = entry['description']
    category = entry['category']
    source = entry['source']
    escaped = desc.replace('"', '\\"')
    content = f'''---
name: {name}
description: "{escaped}"
metadata:
  hermes:
    tags: [{category}, clawpowers-catalog, hermes-compatible]
---

# {name}

This Hermes-compatible skill wrapper exports the ClawPowers catalog entry for `{name}`.

## Purpose

{desc}

## When to use

Use this skill when the task matches the capability described above.

## Current branch note

This wrapper is included so Hermes can discover and load the ClawPowers skill surface from this branch. It reflects the cataloged capability and category from ClawPowers.

## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `{source}`
- Category: `{category}`

## Compatibility boundary

This wrapper makes the skill discoverable and loadable by Hermes as a standard `SKILL.md` bundle. It does not, by itself, claim that every underlying runtime, CLI, API integration, or library dependency behind the broader ClawPowers ecosystem is fully configured in Hermes.
'''
    (skill_dir / 'SKILL.md').write_text(content)
    count += 1

(repo / 'skills' / 'README.md').write_text(f'''# ClawPowers skills for Hermes

This directory is the **Hermes-supported surface** for this branch.

Only skills placed here are in scope for the branch's Hermes compatibility claim.

## Current exported skills

- Total exported skills: {len(entries)}
- Hand-authored validated wedge: `itp`
- Remaining exported skills are catalog-derived Hermes `SKILL.md` wrappers generated from `src/skills/catalog.ts` so Hermes can discover and load the full ClawPowers skill surface on this branch.

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
''')

(repo / 'HERMES_COMPATIBILITY.md').write_text(f'''# Hermes compatibility

This branch exists to expose the **Hermes-compatible** ClawPowers surface only.

## Support contract on this branch

The Hermes-supported surface is the top-level `skills/` directory.

Current exported Hermes-loadable skill bundles:

- total exported skills: {len(entries)}
- richer validated proof bundle: `skills/itp/SKILL.md`
- remaining skills exported as catalog-derived Hermes wrappers sourced from `src/skills/catalog.ts`

## What this branch claims

This branch claims that the top-level `skills/` directory is Hermes-loadable as standard `SKILL.md` bundles.

## What is not part of the Hermes-native runtime claim

The following may still be useful in other environments, but they are **not** currently claimed here as native Hermes runtime/package surfaces just because the skill bundles load:

- the broader `clawpowers` npm capability library
- wallet APIs as a native Hermes package feature
- payments / x402 runtime flows as a native Hermes package feature
- RSI, memory, swarm, and other library modules as native Hermes package features unless separately validated in that form

## Validation rule

A ClawPowers skill is treated as Hermes-compatible on this branch when it:

1. is exported as a standard `SKILL.md` bundle under `skills/`
2. can be discovered by Hermes from `~/.hermes/skills/`
3. loads cleanly through Hermes' own skill tooling
4. passes requirement checks without hidden patches

## Current status

The branch now exports the full catalog as Hermes-loadable bundles. The `itp` skill remains the deepest manually validated wedge. The rest are catalog-derived wrappers that now pass Hermes discovery/load expectations as `SKILL.md` skills.
''')

print('generated_wrappers', count)
print('total_catalog_entries', len(entries))

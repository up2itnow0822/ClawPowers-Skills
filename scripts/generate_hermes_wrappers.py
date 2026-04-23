from __future__ import annotations

import json
import re
from pathlib import Path

repo = Path('/home/max/.openclaw/workspace/tmp/clawpowers-skills-hermes-branch')
catalog_path = repo / 'src/skills/catalog.ts'
overrides_path = repo / 'scripts/hermes_wrapper_overrides.json'
text = catalog_path.read_text()
overrides = json.loads(overrides_path.read_text()) if overrides_path.exists() else {}

pattern = re.compile(
    r"\{\s*name:\s*'(?P<name>[^']+)'\s*,\s*description:\s*'(?P<desc>(?:[^'\\]|\\.)*)'\s*,\s*source:\s*'(?P<source>[^']+)'\s*,\s*category:\s*'(?P<category>[^']+)'\s*,\s*\}",
    re.S,
)


def bullet_block(title: str, items: list[str]) -> str:
    if not items:
        return ''
    lines = [f'## {title}', '']
    lines.extend(f'- {item}' for item in items)
    lines.append('')
    return '\n'.join(lines)


entries = []
for m in pattern.finditer(text):
    name = m.group('name')
    desc = m.group('desc').replace("\\'", "'")
    entries.append(
        {
            'name': name,
            'description': desc,
            'source': m.group('source'),
            'category': m.group('category'),
        }
    )

skills_root = repo / 'skills'
skills_root.mkdir(exist_ok=True)
manual_skills = {'itp'}
generated_count = 0
rich_count = 0

for entry in entries:
    name = entry['name']
    if name in manual_skills:
        continue

    skill_dir = skills_root / name
    skill_dir.mkdir(parents=True, exist_ok=True)

    desc = entry['description']
    category = entry['category']
    source = entry['source']
    escaped = desc.replace('"', '\\"')
    override = overrides.get(name, {})

    title = override.get('title', name)
    summary = override.get(
        'summary',
        f'This Hermes-compatible skill wrapper exports the ClawPowers catalog entry for `{name}`.',
    )
    when_to_use = override.get('when_to_use', ['use this skill when the task matches the capability described above'])
    quickstart = override.get('quickstart', [])
    notes = override.get(
        'notes',
        [
            'This wrapper makes the skill discoverable and loadable by Hermes as a standard `SKILL.md` bundle.',
            'It does not, by itself, claim that every underlying runtime, CLI, API integration, or library dependency behind the broader ClawPowers ecosystem is fully configured in Hermes.',
        ],
    )

    content = (
        f"---\n"
        f"name: {name}\n"
        f"description: \"{escaped}\"\n"
        f"metadata:\n"
        f"  hermes:\n"
        f"    tags: [{category}, clawpowers-catalog, hermes-compatible]\n"
        f"---\n\n"
        f"<!-- generated-by: scripts/generate_hermes_wrappers.py -->\n\n"
        f"# {title}\n\n"
        f"{summary}\n\n"
        f"## Purpose\n\n"
        f"{desc}\n\n"
        f"{bullet_block('When to use', when_to_use)}"
        f"{bullet_block('Quickstart', quickstart)}"
        f"## Source of truth\n\n"
        f"- Catalog source: `src/skills/catalog.ts`\n"
        f"- Catalog entry source class: `{source}`\n"
        f"- Category: `{category}`\n\n"
        f"{bullet_block('Notes', notes)}"
        f"## Compatibility boundary\n\n"
        f"This file is part of the Hermes-compatible top-level `skills/` surface for this branch. It should be read as a discoverable skill bundle, not as a blanket claim that the wider `clawpowers` library/runtime surface is fully configured inside Hermes.\n"
    )

    (skill_dir / 'SKILL.md').write_text(content)
    generated_count += 1
    if override:
        rich_count += 1


total_exported = generated_count + len(manual_skills)

(repo / 'skills' / 'README.md').write_text(
    f'''# ClawPowers skills for Hermes

This directory is the **Hermes-supported surface** for this branch.

Only skills placed here are in scope for the branch's Hermes compatibility claim.

## Current exported skills

- Total exported skills: {total_exported}
- Hand-authored validated wedge: `itp`
- Catalog-derived wrappers: {generated_count}
- Richer generated wrappers with override guidance: {rich_count}

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

## Fast verification

```bash
python3 scripts/verify_hermes_wrappers.py
```

Then validate with Hermes' own skill tooling.

## Important boundary

This branch now exports the full ClawPowers catalog as Hermes-loadable skill bundles, but that does **not** automatically mean every broader `clawpowers` runtime/library module is a native Hermes package surface.

This branch separates:

- **Hermes-compatible skill bundles** under `skills/`
- **non-Hermes-native library/runtime surfaces** elsewhere in the repo
'''
)

(repo / 'HERMES_COMPATIBILITY.md').write_text(
    f'''# Hermes compatibility

This branch exists to expose the **Hermes-compatible** ClawPowers surface only.

## Support contract on this branch

The Hermes-supported surface is the top-level `skills/` directory.

Current exported Hermes-loadable skill bundles:

- total exported skills: {total_exported}
- richer validated proof bundle: `skills/itp/SKILL.md`
- catalog-derived wrappers: {generated_count}
- richer generated wrappers with extra operator guidance: {rich_count}

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

## Fast verification

Run:

```bash
python3 scripts/verify_hermes_wrappers.py
```

## Current status

The branch exports the full catalog as Hermes-loadable bundles. The `itp` skill remains the deepest manually validated wedge. A small set of high-value skills now also gets richer generated guidance from curated overrides while preserving the same Hermes compatibility boundary.
'''
)

print('generated_wrappers', generated_count)
print('manual_wrappers', len(manual_skills))
print('rich_wrappers', rich_count)
print('total_exported_skills', total_exported)

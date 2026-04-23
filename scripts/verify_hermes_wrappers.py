from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

DEFAULT_SAMPLES = [
    'itp',
    'github',
    'content-writer',
    'webmcp-payments',
    'prospector',
    'security',
    'business-strategy',
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Verify Hermes-loadable skill wrappers in this repo.')
    parser.add_argument('--repo', default='/home/max/.openclaw/workspace/tmp/clawpowers-skills-hermes-branch')
    parser.add_argument('--hermes-agent', default='/home/max/.openclaw/workspace/tmp/hermes-agent')
    parser.add_argument('--sample', action='append', dest='samples', default=[])
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo = Path(args.repo)
    skills_src = repo / 'skills'
    hermes_agent = Path(args.hermes_agent)

    if not skills_src.exists():
        raise SystemExit(f'Missing skills directory: {skills_src}')
    if not hermes_agent.exists():
        raise SystemExit(f'Missing Hermes agent checkout: {hermes_agent}')

    expected = sorted(path.name for path in skills_src.iterdir() if path.is_dir())

    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix='hermes-skill-verify-') as tmpdir:
        tmp_home = Path(tmpdir)
        shutil.copytree(skills_src, tmp_home / 'skills')
        os.environ['HERMES_HOME'] = str(tmp_home)
        sys.path.insert(0, str(hermes_agent))

        from tools.skills_tool import skills_list, skill_view, check_skills_requirements  # type: ignore

        listing = json.loads(skills_list())
        discovered = sorted(skill['name'] for skill in listing['skills'])
        if discovered != expected:
            missing = sorted(set(expected) - set(discovered))
            extra = sorted(set(discovered) - set(expected))
            raise SystemExit(
                f'Skill discovery mismatch. Missing={missing} Extra={extra}'
            )

        samples = args.samples or DEFAULT_SAMPLES
        sample_results = []
        for name in samples:
            viewed = json.loads(skill_view(name))
            if not viewed.get('success'):
                raise SystemExit(f'skill_view failed for {name}: {viewed}')
            sample_results.append(name)

        requirements_ok = check_skills_requirements()
        duration_ms = round((time.perf_counter() - started) * 1000, 1)

    result = {
        'count': len(discovered),
        'samples_checked': sample_results,
        'requirements_ok': requirements_ok,
        'duration_ms': duration_ms,
    }
    print(json.dumps(result, indent=2))
    return 0 if requirements_ok else 1


if __name__ == '__main__':
    raise SystemExit(main())

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

DEFAULT_HERMES_REPO = 'https://github.com/NousResearch/hermes-agent.git'
DEFAULT_HERMES_REF = 'main'
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
    parser.add_argument(
        '--repo',
        default=str(Path.cwd()),
        help='Path to the ClawPowers-Skills checkout. Defaults to the current working directory.',
    )
    parser.add_argument(
        '--hermes-agent',
        default=os.environ.get('HERMES_AGENT_CHECKOUT', ''),
        help=(
            'Path to a Hermes agent checkout. Can also be set with HERMES_AGENT_CHECKOUT. '
            'When omitted, the verifier clones NousResearch/hermes-agent at --hermes-ref into a temp directory.'
        ),
    )
    parser.add_argument(
        '--hermes-repo',
        default=os.environ.get('HERMES_AGENT_REPO', DEFAULT_HERMES_REPO),
        help='Git URL used when --hermes-agent/HERMES_AGENT_CHECKOUT is not provided.',
    )
    parser.add_argument(
        '--hermes-ref',
        default=os.environ.get('HERMES_AGENT_REF', DEFAULT_HERMES_REF),
        help='Hermes git ref used for the temporary checkout when --hermes-agent is omitted.',
    )
    parser.add_argument('--sample', action='append', dest='samples', default=[])
    return parser.parse_args()


def _run(cmd: list[str], cwd: Path | None = None) -> None:
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def resolve_hermes_agent(args: argparse.Namespace, tmp_root: Path) -> tuple[Path, str]:
    if args.hermes_agent:
        hermes_agent = Path(args.hermes_agent).expanduser().resolve()
        source = f'local:{hermes_agent}'
    else:
        hermes_agent = tmp_root / 'hermes-agent'
        clone_cmd = [
            'git',
            'clone',
            '--depth',
            '1',
            '--branch',
            args.hermes_ref,
            args.hermes_repo,
            str(hermes_agent),
        ]
        try:
            _run(clone_cmd)
        except subprocess.CalledProcessError:
            _run(['git', 'clone', '--depth', '1', args.hermes_repo, str(hermes_agent)])
            _run(['git', 'fetch', '--depth', '1', 'origin', args.hermes_ref], cwd=hermes_agent)
            _run(['git', 'checkout', 'FETCH_HEAD'], cwd=hermes_agent)
        source = f'git:{args.hermes_repo}@{args.hermes_ref}'

    if not hermes_agent.exists():
        raise SystemExit(f'Missing Hermes agent checkout: {hermes_agent}')

    tools_module = hermes_agent / 'tools' / 'skills_tool.py'
    if not tools_module.exists():
        raise SystemExit(f'Missing Hermes skills tool module: {tools_module}')

    return hermes_agent, source


def main() -> int:
    args = parse_args()
    repo = Path(args.repo).expanduser().resolve()
    skills_src = repo / 'skills'

    if not skills_src.exists():
        raise SystemExit(
            f'Missing skills directory: {skills_src}. Run this from the ClawPowers-Skills repo root or pass --repo.'
        )

    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix='hermes-compat-') as compat_tmpdir:
        compat_tmp = Path(compat_tmpdir)
        hermes_agent, hermes_source = resolve_hermes_agent(args, compat_tmp)
        expected = sorted(path.name for path in skills_src.iterdir() if path.is_dir())

        with tempfile.TemporaryDirectory(prefix='hermes-skill-verify-') as hermes_home_tmpdir:
            tmp_home = Path(hermes_home_tmpdir)
            shutil.copytree(skills_src, tmp_home / 'skills')
            os.environ['HERMES_HOME'] = str(tmp_home)
            sys.path.insert(0, str(hermes_agent))

            from tools.skills_tool import skills_list, skill_view, check_skills_requirements  # type: ignore

            listing = json.loads(skills_list())
            if not listing.get('success'):
                raise SystemExit(f'skills_list failed: {listing}')

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
        'repo': str(repo),
        'hermes_source': hermes_source,
        'hermes_agent': str(hermes_agent),
        'count': len(discovered),
        'samples_checked': sample_results,
        'requirements_ok': requirements_ok,
        'duration_ms': duration_ms,
    }
    print(json.dumps(result, indent=2))
    return 0 if requirements_ok else 1


if __name__ == '__main__':
    raise SystemExit(main())

/**
 * ClawPowers Agent — Skill Loader
 * Discovers skills from skill directories, validates SKILL.md frontmatter.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillManifest, SkillRequirements, Profile } from '../types.js';

// ─── YAML Frontmatter Parser ──────────────────────────────────────────────────

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  metadata?: {
    openclaw?: {
      requires?: {
        bins?: string[];
        env?: string[];
        config?: string[];
      };
    };
  };
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function splitYamlKeyValue(line: string): { key: string; value: string } | null {
  const colonIndex = line.indexOf(':');
  if (colonIndex <= 0) {
    return null;
  }

  const key = line.slice(0, colonIndex).trim();
  if (!key) {
    return null;
  }

  for (const char of key) {
    const isAlphaNum =
      (char >= 'a' && char <= 'z')
      || (char >= 'A' && char <= 'Z')
      || (char >= '0' && char <= '9')
      || char === '_';
    if (!isAlphaNum) {
      return null;
    }
  }

  return {
    key,
    value: line.slice(colonIndex + 1).trim(),
  };
}

function parseInlineArray(value: string): string[] | null {
  if (!value.startsWith('[') || !value.endsWith(']')) {
    return null;
  }

  const inner = value.slice(1, -1).trim();
  if (!inner) {
    return [];
  }

  return inner.split(',').map(item => stripQuotes(item.trim())).filter(Boolean);
}

function parseListItem(line: string): string | null {
  if (!line.startsWith('-')) {
    return null;
  }

  const value = line.slice(1).trim();
  if (!value) {
    return null;
  }

  return stripQuotes(value);
}

/**
 * Parse YAML frontmatter from a SKILL.md file content.
 * Expects format: ---\n<yaml>\n---\n<content>
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith('---\n')) {
    return {};
  }

  const endIndex = content.indexOf('\n---', 4);
  if (endIndex === -1) {
    return {};
  }

  const yamlText = content.slice(4, endIndex);
  const result: ParsedFrontmatter = {};

  // Simple YAML parser for our known structure
  const lines = yamlText.split('\n');
  let currentKey = '';
  let inRequires = false;
  let requiresKey = '';
  const requires: { bins?: string[]; env?: string[]; config?: string[] } = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Top-level keys
    const topLevel = line === trimmed ? splitYamlKeyValue(trimmed) : null;
    if (topLevel) {
      currentKey = topLevel.key;
      const val = stripQuotes(topLevel.value);
      if (currentKey === 'name' && val) result.name = val;
      if (currentKey === 'description' && val) result.description = val;
      inRequires = false;
      continue;
    }

    // metadata.openclaw.requires detection
    if (trimmed === 'openclaw:') continue;
    if (trimmed === 'requires:') {
      inRequires = true;
      continue;
    }

    if (inRequires) {
      const reqKey = splitYamlKeyValue(trimmed);
      if (reqKey) {
        requiresKey = reqKey.key;
        // Inline array: bins: ["node", "git"]
        const items = parseInlineArray(reqKey.value);
        if (items) {
          if (requiresKey === 'bins') requires.bins = items;
          if (requiresKey === 'env') requires.env = items;
          if (requiresKey === 'config') requires.config = items;
        }
        continue;
      }
      // List item under requires key
      const listItem = parseListItem(trimmed);
      if (listItem && requiresKey) {
        if (requiresKey === 'bins') {
          requires.bins = requires.bins ?? [];
          requires.bins.push(listItem);
        }
        if (requiresKey === 'env') {
          requires.env = requires.env ?? [];
          requires.env.push(listItem);
        }
        if (requiresKey === 'config') {
          requires.config = requires.config ?? [];
          requires.config.push(listItem);
        }
      }
    }
  }

  if (Object.keys(requires).length > 0) {
    result.metadata = { openclaw: { requires } };
  }

  return result;
}

// ─── Skill Discovery ──────────────────────────────────────────────────────────

/**
 * Load a single skill manifest from a directory containing SKILL.md
 */
export function loadSkillManifest(skillDir: string): SkillManifest | null {
  const skillMdPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMdPath)) {
    return null;
  }

  const content = readFileSync(skillMdPath, 'utf-8');
  const frontmatter = parseFrontmatter(content);

  if (!frontmatter.name || !frontmatter.description) {
    return null;
  }

  let requirements: SkillRequirements | null = null;
  const req = frontmatter.metadata?.openclaw?.requires;
  if (req) {
    requirements = {
      bins: req.bins ?? [],
      env: req.env ?? [],
      config: req.config ?? [],
    };
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    path: skillDir,
    requirements,
  };
}

/**
 * Discover all skills in a directory. Each subdirectory with a valid SKILL.md
 * becomes a skill manifest.
 */
export function discoverSkills(skillsDir: string): SkillManifest[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const entries = readdirSync(skillsDir);
  const manifests: SkillManifest[] = [];

  for (const entry of entries) {
    const fullPath = join(skillsDir, entry);
    if (!statSync(fullPath).isDirectory()) continue;

    const manifest = loadSkillManifest(fullPath);
    if (manifest) {
      manifests.push(manifest);
    }
  }

  return manifests.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Filter skills based on active profile.
 * Returns only skills that are listed in the profile's skill list.
 */
export function getActiveSkills(
  allSkills: SkillManifest[],
  profile: Profile
): SkillManifest[] {
  const profileSkillSet = new Set(profile.skills);
  return allSkills.filter(skill => profileSkillSet.has(skill.name));
}

/**
 * List skills with their active/inactive status for a given profile.
 */
export function listSkillsWithStatus(
  allSkills: SkillManifest[],
  profile: Profile
): Array<{ skill: SkillManifest; active: boolean }> {
  const profileSkillSet = new Set(profile.skills);
  return allSkills.map(skill => ({
    skill,
    active: profileSkillSet.has(skill.name),
  }));
}

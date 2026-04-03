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

/**
 * Parse YAML frontmatter from a SKILL.md file content.
 * Expects format: ---\n<yaml>\n---\n<content>
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) {
    return {};
  }

  const yamlText = match[1];
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
    const topLevel = line.match(/^(\w+):\s*(.*)$/);
    if (topLevel?.[1]) {
      currentKey = topLevel[1];
      const val = topLevel[2]?.trim().replace(/^["']|["']$/g, '') ?? '';
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
      const reqKey = trimmed.match(/^(\w+):\s*(.*)$/);
      if (reqKey?.[1]) {
        requiresKey = reqKey[1];
        // Inline array: bins: ["node", "git"]
        const inlineArr = reqKey[2]?.match(/\[(.*)\]/);
        if (inlineArr?.[1]) {
          const items = inlineArr[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
          if (requiresKey === 'bins') requires.bins = items;
          if (requiresKey === 'env') requires.env = items;
          if (requiresKey === 'config') requires.config = items;
        }
        continue;
      }
      // List item under requires key
      const listItem = trimmed.match(/^-\s*["']?(.+?)["']?$/);
      if (listItem?.[1] && requiresKey) {
        if (requiresKey === 'bins') {
          requires.bins = requires.bins ?? [];
          requires.bins.push(listItem[1]);
        }
        if (requiresKey === 'env') {
          requires.env = requires.env ?? [];
          requires.env.push(listItem[1]);
        }
        if (requiresKey === 'config') {
          requires.config = requires.config ?? [];
          requires.config.push(listItem[1]);
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

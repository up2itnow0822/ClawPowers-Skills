import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../src/skills/loader.js';

describe('skill loader', () => {
  it('parses SKILL.md frontmatter with LF line endings', () => {
    const manifest = parseFrontmatter('---\nname: example\ndescription: Example skill\n---\nBody');
    expect(manifest.name).toBe('example');
    expect(manifest.description).toBe('Example skill');
  });

  it('parses SKILL.md frontmatter with CRLF line endings from npm tarballs on Windows', () => {
    const manifest = parseFrontmatter('---\r\nname: windows-example\r\ndescription: Windows example skill\r\n---\r\nBody');
    expect(manifest.name).toBe('windows-example');
    expect(manifest.description).toBe('Windows example skill');
  });
});

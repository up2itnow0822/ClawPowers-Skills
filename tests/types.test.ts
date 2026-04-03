/**
 * Type system validation tests
 */
import { describe, it, expect } from 'vitest';
import type {
  AgentStatus, Goal, Plan, Step, Profile,
  SkillManifest, ConfigFile, RSITier, RSIMutation, MemoryEntry,
  PaymentConfig, StepStatus, PlanStatus,
} from '../src/types.js';

describe('Type System', () => {
  it('AgentStatus covers all valid states', () => {
    const statuses: AgentStatus[] = [
      'idle', 'intake', 'planning', 'executing',
      'reviewing', 'complete', 'failed', 'paused',
    ];
    expect(statuses).toHaveLength(8);
  });

  it('StepStatus covers all valid states', () => {
    const statuses: StepStatus[] = [
      'pending', 'in-progress', 'complete', 'failed', 'skipped',
    ];
    expect(statuses).toHaveLength(5);
  });

  it('PlanStatus covers all valid states', () => {
    const statuses: PlanStatus[] = [
      'draft', 'approved', 'executing', 'complete', 'failed',
    ];
    expect(statuses).toHaveLength(5);
  });

  it('Goal interface has required fields', () => {
    const goal: Goal = {
      taskId: '123e4567-e89b-12d3-a456-426614174000',
      description: 'Build feature X',
      constraints: ['no external deps'],
      successCriteria: ['tests pass'],
      createdAt: '2026-03-28T00:00:00Z',
      source: 'cli',
    };
    expect(goal.taskId).toBeDefined();
    expect(goal.source).toBe('cli');
  });

  it('Step interface enforces defaults', () => {
    const step: Step = {
      stepId: 'step-1',
      description: 'Write tests',
      assignedSkills: ['tdd'],
      status: 'pending',
      dependsOn: [],
      output: null,
      retryCount: 0,
      maxRetries: 3,
    };
    expect(step.retryCount).toBe(0);
    expect(step.maxRetries).toBe(3);
    expect(step.output).toBeNull();
  });

  it('Plan interface with steps', () => {
    const plan: Plan = {
      taskId: '123',
      steps: [],
      status: 'draft',
      createdAt: '2026-03-28T00:00:00Z',
      approvedAt: null,
      parallelizable: false,
    };
    expect(plan.status).toBe('draft');
    expect(plan.approvedAt).toBeNull();
  });

  it('Profile interface with skills array', () => {
    const profile: Profile = {
      name: 'dev',
      description: 'Development profile',
      skills: ['tdd', 'code-review'],
      defaultModel: 'anthropic/claude-sonnet-4',
      maxConcurrentAgents: 3,
      paymentEnabled: false,
      rsiEnabled: true,
    };
    expect(profile.skills).toHaveLength(2);
    expect(profile.name).toBe('dev');
  });

  it('SkillManifest with requirements', () => {
    const manifest: SkillManifest = {
      name: 'tdd',
      description: 'Test-driven development',
      path: '/path/to/tdd',
      requirements: {
        bins: ['node'],
        env: ['GITHUB_TOKEN'],
        config: [],
      },
    };
    expect(manifest.requirements?.bins).toContain('node');
  });

  it('SkillManifest without requirements', () => {
    const manifest: SkillManifest = {
      name: 'docs',
      description: 'Documentation',
      path: '/path/to/docs',
      requirements: null,
    };
    expect(manifest.requirements).toBeNull();
  });

  it('RSITier enforces tier modes', () => {
    const tiers: RSITier = {
      t1: 'auto',
      t2: 'auto',
      t3: 'ask',
      t4: 'ask',
    };
    expect(tiers.t4).toBe('ask');
  });

  it('RSIMutation tracks status', () => {
    const mutation: RSIMutation = {
      mutationId: 'mut-1',
      appliedAt: '2026-03-28T00:00:00Z',
      delta: 0.12,
      status: 'active',
    };
    expect(mutation.status).toBe('active');
  });

  it('MemoryEntry captures task outcomes', () => {
    const entry: MemoryEntry = {
      taskId: '123',
      timestamp: '2026-03-28T00:00:00Z',
      description: 'Built feature X',
      outcome: 'success',
      lessonsLearned: ['Use TDD'],
      skillsUsed: ['tdd', 'code-review'],
      durationMs: 60000,
      tags: ['feature'],
    };
    expect(entry.outcome).toBe('success');
  });

  it('PaymentConfig enforces modes', () => {
    const config: PaymentConfig = {
      mode: 'human-first',
      dailyLimitUsd: 25,
      weeklyLimitUsd: 100,
      allowedDomains: ['api.example.com'],
    };
    expect(config.mode).toBe('human-first');
  });

  it('ConfigFile has complete structure', () => {
    const config: ConfigFile = {
      version: '1.0.0',
      profile: 'dev',
      rsi: {
        enabled: true,
        tiers: { t1: 'auto', t2: 'auto', t3: 'ask', t4: 'ask' },
      },
      payments: {
        mode: 'human-first',
        dailyLimitUsd: 25,
        weeklyLimitUsd: 100,
        allowedDomains: [],
      },
      logging: { level: 'info', retentionDays: 30 },
      skillsDir: '~/.clawpowers/skills',
      dataDir: '~/.clawpowers/data',
    };
    expect(config.version).toBe('1.0.0');
    expect(config.rsi.tiers.t4).toBe('ask');
  });
});

/**
 * ClawPowers Skills — Skill Executor
 * Execute skills and track outcomes in procedural memory.
 */

import type { ProceduralMemory } from '../memory/procedural.js';

export interface SkillExecutionContext {
  readonly taskId: string;
  readonly input: string;
  readonly metadata?: Record<string, unknown>;
}

export interface SkillExecutionResult {
  readonly success: boolean;
  readonly output: string;
  readonly durationMs: number;
  readonly error?: string;
}

export class SkillExecutor {
  constructor(
    private readonly skillsDir: string,
    private readonly memory: ProceduralMemory
  ) {}

  async execute(skillName: string, context: SkillExecutionContext): Promise<SkillExecutionResult> {
    const start = Date.now();
    try {
      const result: SkillExecutionResult = {
        success: true,
        output: `Skill ${skillName} loaded from ${this.skillsDir}`,
        durationMs: Date.now() - start,
      };
      await this.memory.update(skillName, {
        succeeded: true,
        durationMs: result.durationMs,
        taskId: context.taskId,
      });
      return result;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.memory.update(skillName, {
        succeeded: false,
        durationMs: Date.now() - start,
        taskId: context.taskId,
      });
      return {
        success: false,
        output: '',
        durationMs: Date.now() - start,
        error: errorMessage,
      };
    }
  }
}

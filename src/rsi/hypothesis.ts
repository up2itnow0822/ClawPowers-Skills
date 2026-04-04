/**
 * ClawPowers Agent — RSI Hypothesis Engine
 * Analyzes skill stats and task history to generate improvement hypotheses.
 */

import { randomUUID } from 'node:crypto';
import type { SkillAggregateStats, TaskMetrics, RSIHypothesis, RSITierLabel } from '../types.js';

const MIN_DATA_POINTS = 10;
const LOW_SUCCESS_THRESHOLD = 0.6;
const SLOW_SKILL_PERCENTILE = 0.75;

export class HypothesisEngine {
  analyze(
    skillStats: readonly SkillAggregateStats[],
    taskHistory: readonly TaskMetrics[]
  ): RSIHypothesis[] {
    if (taskHistory.length < MIN_DATA_POINTS) {
      return [];
    }

    const hypotheses: RSIHypothesis[] = [];

    hypotheses.push(...this.detectLowSuccessRate(skillStats));
    hypotheses.push(...this.detectSlowSkills(skillStats));
    hypotheses.push(...this.detectFrequentlyPairedSkills(taskHistory));
    hypotheses.push(...this.detectUnusedInSuccessful(skillStats, taskHistory));

    return hypotheses;
  }

  private detectLowSuccessRate(stats: readonly SkillAggregateStats[]): RSIHypothesis[] {
    const hypotheses: RSIHypothesis[] = [];

    for (const skill of stats) {
      if (skill.totalInvocations >= 5 && skill.successRate < LOW_SUCCESS_THRESHOLD) {
        const expectedImprovement = Math.round((LOW_SUCCESS_THRESHOLD - skill.successRate) * 100);
        hypotheses.push({
          hypothesisId: randomUUID(),
          skillName: skill.skillName,
          description: `Adjusting retry count for ${skill.skillName} may improve success by ${expectedImprovement}%`,
          expectedImprovement,
          tier: 'T1' as RSITierLabel,
          confidence: Math.min(0.9, skill.totalInvocations / 20),
          evidence: [
            `Current success rate: ${Math.round(skill.successRate * 100)}%`,
            `Total invocations: ${skill.totalInvocations}`,
            `Trend: ${skill.trendDirection}`,
          ],
        });
      }
    }

    return hypotheses;
  }

  private detectSlowSkills(stats: readonly SkillAggregateStats[]): RSIHypothesis[] {
    const hypotheses: RSIHypothesis[] = [];
    const withInvocations = stats.filter(s => s.totalInvocations >= 5);

    if (withInvocations.length < 2) return hypotheses;

    const durations = withInvocations.map(s => s.avgDurationMs).sort((a, b) => a - b);
    const percentileIdx = Math.max(0, Math.floor(durations.length * SLOW_SKILL_PERCENTILE) - 1);
    const threshold = durations[percentileIdx] ?? Infinity;

    for (const skill of withInvocations) {
      if (skill.avgDurationMs > threshold) {
        const expectedImprovement = Math.round(
          ((skill.avgDurationMs - threshold) / skill.avgDurationMs) * 100
        );
        hypotheses.push({
          hypothesisId: randomUUID(),
          skillName: skill.skillName,
          description: `Increasing timeout for ${skill.skillName} may reduce failures by ${expectedImprovement}%`,
          expectedImprovement,
          tier: 'T1' as RSITierLabel,
          confidence: Math.min(0.8, skill.totalInvocations / 25),
          evidence: [
            `Avg duration: ${Math.round(skill.avgDurationMs)}ms`,
            `75th percentile threshold: ${Math.round(threshold)}ms`,
          ],
        });
      }
    }

    return hypotheses;
  }

  private detectFrequentlyPairedSkills(taskHistory: readonly TaskMetrics[]): RSIHypothesis[] {
    const hypotheses: RSIHypothesis[] = [];
    const pairCounts = new Map<string, number>();

    for (const task of taskHistory) {
      const skills = task.skillsUsed;
      for (let i = 0; i < skills.length; i++) {
        for (let j = i + 1; j < skills.length; j++) {
          const pair = [skills[i]!, skills[j]!].sort().join('+');
          pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
        }
      }
    }

    for (const [pair, count] of pairCounts) {
      if (count >= 5) {
        const [skillA, skillB] = pair.split('+') as [string, string];
        hypotheses.push({
          hypothesisId: randomUUID(),
          skillName: `${skillA}+${skillB}`,
          description: `Creating a chain of ${skillA}+${skillB} may improve efficiency`,
          expectedImprovement: Math.round((count / taskHistory.length) * 30),
          tier: 'T3' as RSITierLabel,
          confidence: Math.min(0.7, count / 15),
          evidence: [
            `Co-occurrence: ${count}/${taskHistory.length} tasks`,
          ],
        });
      }
    }

    return hypotheses;
  }

  private detectUnusedInSuccessful(
    stats: readonly SkillAggregateStats[],
    taskHistory: readonly TaskMetrics[]
  ): RSIHypothesis[] {
    const hypotheses: RSIHypothesis[] = [];
    const successfulTasks = taskHistory.filter(t => t.outcome === 'success');

    if (successfulTasks.length < 5) return hypotheses;

    const successfulSkills = new Set<string>();
    for (const task of successfulTasks) {
      for (const skill of task.skillsUsed) {
        successfulSkills.add(skill);
      }
    }

    for (const skill of stats) {
      if (
        skill.totalInvocations >= 5 &&
        !successfulSkills.has(skill.skillName) &&
        skill.successRate < 0.5
      ) {
        hypotheses.push({
          hypothesisId: randomUUID(),
          skillName: skill.skillName,
          description: `Deprioritizing ${skill.skillName} for current task types`,
          expectedImprovement: 10,
          tier: 'T2' as RSITierLabel,
          confidence: 0.5,
          evidence: [
            `Not used in any of ${successfulTasks.length} successful tasks`,
            `Success rate: ${Math.round(skill.successRate * 100)}%`,
          ],
        });
      }
    }

    return hypotheses;
  }
}

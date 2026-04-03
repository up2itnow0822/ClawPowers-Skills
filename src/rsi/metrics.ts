/**
 * ClawPowers Agent — RSI Metrics Collector
 * Per-task and per-skill metric collection in JSONL format.
 */

import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TaskMetrics, SkillMetrics, SkillAggregateStats, TrendDirection } from '../types.js';

export class MetricsCollector {
  private readonly taskMetricsPath: string;
  private readonly skillMetricsPath: string;

  constructor(taskMetricsPath: string, skillMetricsPath: string) {
    this.taskMetricsPath = taskMetricsPath;
    this.skillMetricsPath = skillMetricsPath;
  }

  private async ensureDir(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  async recordTaskMetrics(task: TaskMetrics): Promise<void> {
    await this.ensureDir(this.taskMetricsPath);
    const line = JSON.stringify(task) + '\n';
    await appendFile(this.taskMetricsPath, line, 'utf-8');
  }

  async recordSkillMetrics(skill: SkillMetrics): Promise<void> {
    await this.ensureDir(this.skillMetricsPath);
    const line = JSON.stringify(skill) + '\n';
    await appendFile(this.skillMetricsPath, line, 'utf-8');
  }

  async getTaskHistory(limit?: number): Promise<TaskMetrics[]> {
    const entries = await this.readJsonl<TaskMetrics>(this.taskMetricsPath);
    if (limit !== undefined) {
      return entries.slice(-limit);
    }
    return entries;
  }

  async getSkillHistory(skillName: string, limit?: number): Promise<SkillMetrics[]> {
    const all = await this.readJsonl<SkillMetrics>(this.skillMetricsPath);
    const filtered = all.filter(s => s.skillName === skillName);
    if (limit !== undefined) {
      return filtered.slice(-limit);
    }
    return filtered;
  }

  async getAggregatedSkillStats(skillName: string): Promise<SkillAggregateStats> {
    const history = await this.getSkillHistory(skillName);

    if (history.length === 0) {
      return {
        skillName,
        totalInvocations: 0,
        successRate: 0,
        avgDurationMs: 0,
        trendDirection: 'stable',
      };
    }

    const invokedEntries = history.filter(h => h.invoked);
    const totalInvocations = invokedEntries.length;
    const successCount = invokedEntries.filter(h => h.succeeded).length;
    const successRate = totalInvocations > 0 ? successCount / totalInvocations : 0;
    const avgDurationMs =
      totalInvocations > 0
        ? invokedEntries.reduce((sum, h) => sum + h.durationMs, 0) / totalInvocations
        : 0;

    const trendDirection = this.calculateTrend(invokedEntries);

    return {
      skillName,
      totalInvocations,
      successRate,
      avgDurationMs,
      trendDirection,
    };
  }

  private calculateTrend(entries: readonly SkillMetrics[]): TrendDirection {
    if (entries.length < 4) {
      return 'stable';
    }

    const mid = Math.floor(entries.length / 2);
    const firstHalf = entries.slice(0, mid);
    const secondHalf = entries.slice(mid);

    const firstRate = firstHalf.filter(e => e.succeeded).length / firstHalf.length;
    const secondRate = secondHalf.filter(e => e.succeeded).length / secondHalf.length;

    const diff = secondRate - firstRate;
    if (diff > 0.1) return 'improving';
    if (diff < -0.1) return 'declining';
    return 'stable';
  }

  private async readJsonl<T>(filePath: string): Promise<T[]> {
    if (!existsSync(filePath)) {
      return [];
    }
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    const results: T[] = [];
    for (const line of lines) {
      try {
        results.push(JSON.parse(line) as T);
      } catch {
        // Skip malformed lines
      }
    }
    return results;
  }
}

/**
 * ITP ↔ Swarm Integration Bridge
 *
 * Compresses SwarmTask descriptions before fan-out and
 * decodes SwarmResult content after collection.
 * Graceful fallback — if ITP is unavailable, tasks/results pass through unchanged.
 */

import type { SwarmTask, SwarmResult } from '../swarm/types.js';
import { encode, decode } from './index.js';

/**
 * Encode the task description and message before fan-out to sub-agents.
 * Returns a new SwarmTask with compressed fields (original task is not mutated).
 */
export async function encodeTaskDescription(task: SwarmTask): Promise<SwarmTask> {
  try {
    const [descResult, msgResult] = await Promise.all([
      encode(task.description, 'swarm-orchestrator'),
      encode(task.message, 'swarm-orchestrator'),
    ]);

    return {
      ...task,
      description: descResult.encoded,
      message: msgResult.encoded,
    };
  } catch {
    // Graceful fallback — return task unchanged
    return task;
  }
}

/**
 * Decode the result content returned from a sub-agent.
 * Returns a new SwarmResult with decoded fields (original result is not mutated).
 */
export async function decodeSwarmResult(result: SwarmResult): Promise<SwarmResult> {
  try {
    if (result.result === null) {
      return result;
    }

    const decoded = await decode(result.result);

    return {
      ...result,
      result: decoded.decoded,
    };
  } catch {
    // Graceful fallback — return result unchanged
    return result;
  }
}

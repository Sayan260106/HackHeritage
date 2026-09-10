import { getRunnableTasks, OrcaPlan, OrcaTask, replanAfterFailure } from './agenticPlanner.ts';

export type OrcaTaskHandler = (task: OrcaTask) => Promise<void>;

export interface OrcaExecutorOptions {
  onTaskStart?: (task: OrcaTask) => void;
  onTaskComplete?: (task: OrcaTask) => void;
  onTaskFailure?: (task: OrcaTask, error: Error) => void;
  maxReplans?: number;
}

export interface OrcaExecutionResult {
  plan: OrcaPlan;
  replans: number;
  failures: Array<{ taskId: string; reason: string }>;
}

function dependencyBlocked(plan: OrcaPlan, task: OrcaTask): boolean {
  return task.dependsOn.some(depId => {
    const dep = plan.tasks.find(candidate => candidate.id === depId);
    return Boolean(dep && (dep.status === 'failed' || dep.status === 'skipped') && dep.required);
  });
}

function markBlockedTasks(plan: OrcaPlan): boolean {
  let changed = false;
  for (const task of plan.tasks) {
    if (!task.enabled || task.status !== 'pending') continue;
    if (dependencyBlocked(plan, task)) {
      task.status = 'skipped';
      task.enabled = false;
      task.reason = 'Skipped because a required dependency failed.';
      changed = true;
    }
  }
  return changed;
}

/**
 * Executes a planner-produced DAG. Every ready branch starts together, while
 * dependency edges are enforced between waves. Optional connector failures
 * trigger deterministic replanning instead of poisoning the whole request.
 */
export async function executeOrcaPlan(
  initialPlan: OrcaPlan,
  handlers: Partial<Record<OrcaTask['id'], OrcaTaskHandler>>,
  options: OrcaExecutorOptions = {},
): Promise<OrcaExecutionResult> {
  let plan = structuredClone(initialPlan) as OrcaPlan;
  const failures: Array<{ taskId: string; reason: string }> = [];
  let replans = 0;
  const maxReplans = options.maxReplans ?? 3;

  while (true) {
    markBlockedTasks(plan);
    const runnable = getRunnableTasks(plan);
    if (runnable.length === 0) break;

    await Promise.all(runnable.map(async task => {
      task.status = 'running';
      options.onTaskStart?.(task);
      const handler = handlers[task.id];
      if (!handler) {
        const error = new Error(`No executor handler registered for task ${task.id}`);
        task.status = 'failed';
        task.enabled = false;
        task.reason = error.message;
        failures.push({ taskId: task.id, reason: error.message });
        options.onTaskFailure?.(task, error);
        return;
      }

      try {
        await handler(task);
        task.status = 'completed';
        options.onTaskComplete?.(task);
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        task.status = 'failed';
        task.reason = `${task.reason} Failed: ${error.message}`;
        task.enabled = false;
        failures.push({ taskId: task.id, reason: error.message });
        options.onTaskFailure?.(task, error);
      }
    }));

    // Only inspect failures from the wave that just executed. Replanned
    // optional failures are disabled by replanAfterFailure, so scanning the
    // whole plan here would repeatedly replan the same failed task.
    const failedOptional = runnable.find(task => task.status === 'failed' && !task.required);
    if (failedOptional && replans < maxReplans) {
      const failure = failures.find(entry => entry.taskId === failedOptional.id);
      plan = replanAfterFailure({
        plan,
        failedTask: failedOptional.id,
        reason: failure?.reason || failedOptional.reason,
      });
      replans += 1;
      continue;
    }

    if (!plan.tasks.some(task => task.enabled && task.status === 'pending')) break;
  }

  // A task that is still pending can only be unresolved because its required
  // dependency failed. Mark it explicitly so the response exposes the reason.
  markBlockedTasks(plan);
  return { plan, replans, failures };
}

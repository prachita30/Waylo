import type { AppContext } from '../context';

export interface Job {
  name: string;
  everyMs: number;
  run: (ctx: AppContext) => Promise<number | void>;
}

/**
 * Minimal in-process scheduler. Each job runs sequentially (never overlapping itself) and
 * failures are logged, not thrown. With several API instances, move these to a queue
 * (e.g. BullMQ) or guard them with a Postgres advisory lock.
 */
export function startJobs(ctx: AppContext, jobs: Job[]): () => void {
  const timers = jobs.map((job) => {
    let running = false;
    return setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const n = await job.run(ctx);
        if (n) ctx.logger.info({ job: job.name, processed: n }, 'job ran');
      } catch (err) {
        ctx.logger.error({ err, job: job.name }, 'job failed');
      } finally {
        running = false;
      }
    }, job.everyMs);
  });
  return () => timers.forEach(clearInterval);
}

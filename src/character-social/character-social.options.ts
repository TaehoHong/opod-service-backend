export type CharacterSocialWorkerOptions = {
  enabled: boolean;
  pollIntervalMs: number;
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  retryBackoffMs: number;
  postsPerRun: number;
  minDistinctLikedPostsToFollow: number;
};

type WorkerEnv = Record<string, string | undefined>;

const positive = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const timerDelay = (value: string | undefined, fallback: number) =>
  Math.min(2_147_483_647, positive(value, fallback));

export const CHARACTER_SOCIAL_WORKER_OPTIONS = Symbol(
  "CHARACTER_SOCIAL_WORKER_OPTIONS",
);

export function characterSocialWorkerOptions(
  env: WorkerEnv = process.env,
): CharacterSocialWorkerOptions {
  return {
    enabled: env.CHARACTER_SOCIAL_WORKER_ENABLED === "true",
    pollIntervalMs: timerDelay(env.CHARACTER_SOCIAL_POLL_INTERVAL_MS, 5_000),
    batchSize: positive(env.CHARACTER_SOCIAL_BATCH_SIZE, 20),
    maxAttempts: positive(env.CHARACTER_SOCIAL_MAX_ATTEMPTS, 3),
    leaseMs: positive(env.CHARACTER_SOCIAL_LEASE_MS, 60_000),
    retryBackoffMs: positive(env.CHARACTER_SOCIAL_RETRY_BACKOFF_MS, 5_000),
    postsPerRun: positive(env.CHARACTER_SOCIAL_POSTS_PER_RUN, 5),
    minDistinctLikedPostsToFollow: positive(
      env.CHARACTER_SOCIAL_MIN_LIKED_POSTS_TO_FOLLOW,
      3,
    ),
  };
}

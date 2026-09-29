import { randomUUID } from "node:crypto";
import { Test, TestingModule } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../src/core/database/database.service";
import { DatabaseTransactionContext } from "../src/core/database/database-transaction-context";
import { CharacterService } from "../src/characters/character.service";
import {
  characters,
  characterSocialActivityPolicies,
  characterPostViews,
  hashtags,
  posts,
  postHashtags,
  postReactions,
} from "../src/core/database/schema";
import { CharacterSocialActivityApplicationService } from "../src/character-social/character-social-activity-application.service";
import { CharacterSocialActivityJobService } from "../src/character-social/character-social-activity-job.service";
import { CharacterPostViewService } from "../src/character-social/character-post-view.service";
import { CharacterSocialModule } from "../src/character-social/character-social.module";
import {
  CHARACTER_SOCIAL_WORKER_OPTIONS,
  CharacterSocialWorker,
  characterSocialWorkerOptions,
} from "../src/character-social/character-social.worker";

describe("character social activity runtime", () => {
  let database: DatabaseService;
  let module: TestingModule;
  let application: CharacterSocialActivityApplicationService;
  let jobs: CharacterSocialActivityJobService;
  let charactersService: CharacterService;
  let transactionContext: DatabaseTransactionContext;
  let viewsService: CharacterPostViewService;
  let worker: CharacterSocialWorker;
  let actorId: string;
  let authorId: string;
  let tagId: string;
  const now = new Date("2026-09-22T03:00:00Z");

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [CharacterSocialModule],
    })
      .overrideProvider(CHARACTER_SOCIAL_WORKER_OPTIONS)
      .useValue(characterSocialWorkerOptions({}))
      .compile();
    database = module.get(DatabaseService);
    application = module.get(CharacterSocialActivityApplicationService);
    jobs = module.get(CharacterSocialActivityJobService);
    charactersService = module.get(CharacterService);
    transactionContext = module.get(DatabaseTransactionContext);
    viewsService = module.get(CharacterPostViewService);
    worker = module.get(CharacterSocialWorker);
  });

  afterAll(() => module.close());

  beforeEach(async () => {
    const interest = `social-${randomUUID()}`;
    const [actor, author] = await database.client
      .insert(characters)
      .values([
        {
          publicId: randomUUID(),
          displayName: "Actor",
          bio: "",
          timezone: "Asia/Seoul",
          interests: [` #${interest.toUpperCase()} `],
        },
        { publicId: randomUUID(), displayName: "Author", bio: "" },
      ])
      .returning();
    actorId = actor.id;
    authorId = author.id;
    const [tag] = await database.client
      .insert(hashtags)
      .values({ name: interest })
      .returning();
    tagId = tag.id;
    await database.client.insert(characterSocialActivityPolicies).values({
      characterId: actorId,
      enabled: true,
      activeStartLocalTime: "00:00:00",
      activeEndLocalTime: "23:59:59",
      activityIntervalMinutes: 10,
      maxDailyPostViews: 20,
      maxDailyPostLikes: 20,
      maxDailyFollows: 3,
      postLikeProbability: "1.000",
      nextActivityAt: now,
    });
  });

  afterEach(async () => {
    await database.client
      .update(characterSocialActivityPolicies)
      .set({ enabled: false })
      .where(eq(characterSocialActivityPolicies.characterId, actorId));
  });

  async function createPost(
    input: { author?: string; tagged?: boolean; at?: Date } = {},
  ) {
    const [post] = await database.client
      .insert(posts)
      .values({
        characterId: input.author ?? authorId,
        content: "social runtime fixture",
        createdAt: input.at ?? new Date("2026-01-01T00:00:00Z"),
      })
      .returning();
    if (input.tagged !== false) {
      await database.client
        .insert(postHashtags)
        .values({ postId: post.id, hashtagId: tagId });
    }
    return post.id;
  }

  async function state() {
    const result = await database.pool.query(
      `SELECT
       (SELECT count(*)::int FROM opod.character_post_views WHERE viewer_character_id=$1) AS views,
       (SELECT count(*)::int FROM opod.post_reactions WHERE character_id=$1 AND reaction_type='like') AS likes,
       (SELECT count(*)::int FROM opod.character_follows WHERE follower_character_id=$1) AS follows`,
      [actorId],
    );
    return result.rows[0] as { views: number; likes: number; follows: number };
  }

  async function policy(
    values: Partial<typeof characterSocialActivityPolicies.$inferInsert>,
  ) {
    await database.client
      .update(characterSocialActivityPolicies)
      .set(values)
      .where(eq(characterSocialActivityPolicies.characterId, actorId));
  }

  it("processes only matching unseen posts, five per run, and follows after three distinct likes", async () => {
    const matching: string[] = [];
    for (let i = 0; i < 7; i++) matching.push(await createPost());
    await createPost({ tagged: false });
    await createPost({ author: actorId });
    await createPost({ at: new Date("2027-01-01T00:00:00Z") });
    const [inactive] = await database.client
      .insert(characters)
      .values({
        publicId: randomUUID(),
        displayName: "Inactive",
        bio: "",
        status: "inactive",
      })
      .returning();
    await createPost({ author: inactive.id });

    await worker.runOnce(now);
    expect(await state()).toEqual({ views: 5, likes: 5, follows: 1 });
    await worker.runOnce(new Date(now.getTime() + 10 * 60_000));
    expect(await state()).toEqual({ views: 7, likes: 7, follows: 1 });
    const viewed = await database.client
      .select()
      .from(characterPostViews)
      .where(eq(characterPostViews.viewerCharacterId, actorId));
    expect(viewed.map((row) => row.postId).sort()).toEqual(matching.sort());
  });

  it("enforces separate daily quotas and resets them at local midnight", async () => {
    for (let i = 0; i < 5; i++) await createPost();
    await policy({
      maxDailyPostViews: 2,
      maxDailyPostLikes: 1,
      maxDailyFollows: 0,
    });
    await worker.runOnce(now);
    await worker.runOnce(new Date(now.getTime() + 10 * 60_000));
    expect(await state()).toEqual({ views: 2, likes: 1, follows: 0 });
    await worker.runOnce(new Date("2026-09-22T15:00:00Z"));
    expect(await state()).toEqual({ views: 4, likes: 2, follows: 0 });
  });

  it("records views without likes when the probability is zero", async () => {
    await createPost();
    await policy({ postLikeProbability: "0.000" });
    await worker.runOnce(now);
    expect(await state()).toEqual({ views: 1, likes: 0, follows: 0 });
  });

  it("includes existing manual likes in the daily limit and still records a newly viewed post", async () => {
    const postId = await createPost();
    await database.client.insert(postReactions).values({
      postId,
      characterId: actorId,
      reactionType: "like",
      createdAt: now,
    });
    await createPost();
    await policy({ maxDailyPostLikes: 1 });
    await worker.runOnce(now);
    expect(await state()).toEqual({ views: 2, likes: 1, follows: 0 });
  });

  it("limits follows independently when multiple authors meet the threshold", async () => {
    const [otherAuthor] = await database.client
      .insert(characters)
      .values({ publicId: randomUUID(), displayName: "Other", bio: "" })
      .returning();
    for (const author of [authorId, otherAuthor.id]) {
      for (let i = 0; i < 3; i++) {
        const postId = await createPost({ author });
        await database.client.insert(postReactions).values({
          postId,
          characterId: actorId,
          reactionType: "like",
          createdAt: new Date("2026-01-02T00:00:00Z"),
        });
      }
    }
    await policy({ maxDailyFollows: 1, postLikeProbability: "0" });
    await worker.runOnce(now);
    await worker.runOnce(new Date(now.getTime() + 10 * 60_000));
    expect((await state()).follows).toBe(1);
    await worker.runOnce(new Date("2026-09-22T15:00:00Z"));
    expect((await state()).follows).toBe(2);
  });

  it("continues bounded follow scans past an ineligible first page", async () => {
    const authors = await database.client
      .insert(characters)
      .values(
        Array.from({ length: 102 }, (_, index) => ({
          publicId: randomUUID(),
          displayName: `Paged Author ${index}`,
          bio: "",
          status: "inactive" as const,
        })),
      )
      .returning();
    const activeAuthorId = authors
      .map((author) => author.id)
      .sort()
      .at(-1)!;
    await database.client
      .update(characters)
      .set({ status: "active" })
      .where(eq(characters.id, activeAuthorId));
    const likedPosts = await database.client
      .insert(posts)
      .values(
        authors.flatMap((author) =>
          Array.from({ length: 3 }, () => ({
            characterId: author.id,
            content: "paged follow fixture",
            createdAt: new Date("2026-01-01T00:00:00Z"),
          })),
        ),
      )
      .returning();
    await database.client.insert(postReactions).values(
      likedPosts.map((post) => ({
        postId: post.id,
        characterId: actorId,
        reactionType: "like" as const,
        createdAt: new Date("2026-01-02T00:00:00Z"),
      })),
    );
    await policy({
      maxDailyPostViews: 0,
      maxDailyPostLikes: 200,
      maxDailyFollows: 1,
      postLikeProbability: "0",
    });

    await worker.runOnce(now);

    const followed = await database.pool.query(
      `SELECT followed_character_id FROM opod.character_follows
       WHERE follower_character_id=$1`,
      [actorId],
    );
    expect(followed.rows).toEqual([{ followed_character_id: activeAuthorId }]);
  });

  it("serializes concurrent schedulers and workers for one actor", async () => {
    for (let i = 0; i < 6; i++) await createPost();
    await policy({ maxDailyPostViews: 2, maxDailyPostLikes: 2 });
    const other = new CharacterSocialWorker(
      application,
      characterSocialWorkerOptions({}),
    );
    await Promise.all([worker.runOnce(now), other.runOnce(now)]);
    expect(await state()).toEqual({ views: 2, likes: 2, follows: 0 });
    const jobs = await database.pool.query(
      "SELECT processing_status FROM opod.character_social_activity_jobs WHERE character_id=$1",
      [actorId],
    );
    expect(jobs.rows).toEqual([{ processing_status: "completed" }]);
  });

  it("rejects closed and cross-actor nested transaction scopes", async () => {
    const postId = await createPost();
    let releaseEscaped!: () => void;
    const escapedGate = new Promise<void>((resolve) => {
      releaseEscaped = resolve;
    });
    let escapedRequire!: Promise<void>;
    let escapedEntry!: Promise<string[]>;

    await expect(
      charactersService.withActivityTransaction(actorId, async () => {
        await charactersService.withActivityTransaction(actorId, async () => {
          await viewsService.record(actorId, [postId], now);
        });
        throw new Error("force outer rollback");
      }),
    ).rejects.toThrow("force outer rollback");
    expect((await state()).views).toBe(0);

    await charactersService.withActivityTransaction(actorId, async () => {
      await expect(
        charactersService.withActivityTransaction(authorId, async () => true),
      ).rejects.toThrow(
        "nested character activity transactions must use the same character",
      );
      escapedRequire = (async () => {
        await escapedGate;
        transactionContext.require();
      })();
      escapedEntry = (async () => {
        await escapedGate;
        return charactersService.withActivityTransaction(actorId, () =>
          viewsService.record(actorId, [postId], now),
        );
      })();
    });

    releaseEscaped();
    await expect(escapedRequire).rejects.toThrow(
      "database transaction scope has already closed",
    );
    await expect(escapedEntry).rejects.toThrow(
      "database transaction scope has already closed",
    );
    expect((await state()).views).toBe(0);

    const contexts = await Promise.all([
      charactersService.withActivityTransaction(
        actorId,
        async () => transactionContext.current()?.characterId,
      ),
      charactersService.withActivityTransaction(
        authorId,
        async () => transactionContext.current()?.characterId,
      ),
    ]);
    expect(contexts).toEqual([actorId, authorId]);
  });

  it("respects midnight-wrapping windows, including the exclusive end", async () => {
    await createPost();
    await policy({
      activeStartLocalTime: "22:00:00",
      activeEndLocalTime: "06:00:00",
    });
    await worker.runOnce(now); // noon Seoul
    expect((await state()).views).toBe(0);
    await worker.runOnce(new Date("2026-09-22T13:00:00Z")); // 22:00 Seoul
    expect((await state()).views).toBe(1);
    await createPost();
    await worker.runOnce(new Date("2026-09-22T21:00:00Z")); // 06:00 Seoul
    expect((await state()).views).toBe(1);
  });

  it.each([null, "Invalid/Timezone"])(
    "skips timezone %s without emitting activity",
    async (timezone) => {
      await createPost();
      await database.client
        .update(characters)
        .set({ timezone })
        .where(eq(characters.id, actorId));
      await worker.runOnce(now);
      expect(await state()).toEqual({ views: 0, likes: 0, follows: 0 });
    },
  );

  it.each([
    {
      label: "23-hour spring day",
      at: "2026-03-09T03:30:00Z",
      seeds: [
        "2026-03-08T04:59:59Z",
        "2026-03-08T05:00:00Z",
        "2026-03-09T04:00:00Z",
      ],
      added: 1,
    },
    {
      label: "25-hour autumn day",
      at: "2026-11-02T04:30:00Z",
      seeds: [
        "2026-11-01T03:59:59Z",
        "2026-11-01T04:00:00Z",
        "2026-11-02T04:00:00Z",
      ],
      added: 0,
    },
  ])(
    "counts the entire $label instead of 24 elapsed hours",
    async ({ at, seeds, added }) => {
      await database.client
        .update(characters)
        .set({ timezone: "America/New_York" })
        .where(eq(characters.id, actorId));
      const instant = new Date(at);
      await policy({
        nextActivityAt: instant,
        maxDailyPostViews: 2,
        postLikeProbability: "0",
      });
      for (const seed of seeds) {
        const postId = await createPost();
        await database.client.insert(characterPostViews).values({
          viewerCharacterId: actorId,
          postId,
          firstViewedAt: new Date(seed),
        });
      }
      await createPost();
      await worker.runOnce(instant);
      expect((await state()).views).toBe(seeds.length + added);
    },
  );

  it("recovers an expired lease and fences the original owner from writes and failure updates", async () => {
    await createPost();
    await application.scheduleDueActivities(now);
    const original = await jobs.claimNext(now);
    expect(original).not.toBeNull();
    const recoveredAt = new Date(now.getTime() + 60_001);
    const recovered = await jobs.claimNext(recoveredAt);
    expect(recovered).toMatchObject({ id: original!.id, attemptCount: 2 });
    expect(recovered!.leaseToken).not.toBe(original!.leaseToken);
    await expect(
      application.processClaimedActivity(original!, recoveredAt),
    ).resolves.toBe(false);
    await expect(
      jobs.failJob(original!, recoveredAt, new Error("stale failure")),
    ).resolves.toBe(false);
    expect((await state()).views).toBe(0);
    await expect(
      application.processClaimedActivity(recovered!, recoveredAt),
    ).resolves.toBe(true);
    expect(await state()).toEqual({ views: 1, likes: 1, follows: 0 });
  });

  it("waits for retry backoff and stops after the maximum number of crashed attempts", async () => {
    await createPost();
    await application.scheduleDueActivities(now);
    const first = await jobs.claimNext(now);
    await jobs.failJob(first!, now, new Error("transient write failure"));
    await expect(
      jobs.claimNext(new Date(now.getTime() + 4_999)),
    ).resolves.toBeNull();
    const secondAt = new Date(now.getTime() + 5_000);
    const second = await jobs.claimNext(secondAt);
    expect(second!.attemptCount).toBe(2);
    const thirdAt = new Date(secondAt.getTime() + 60_001);
    const third = await jobs.claimNext(thirdAt);
    expect(third!.attemptCount).toBe(3);
    await expect(
      jobs.claimNext(new Date(thirdAt.getTime() + 60_001)),
    ).resolves.toBeNull();
    const result = await database.pool.query(
      "SELECT processing_status,finished_at,processing_lease_token FROM opod.character_social_activity_jobs WHERE id=$1",
      [first!.id.toString()],
    );
    expect(result.rows[0]).toMatchObject({
      processing_status: "failed",
      finished_at: expect.any(Date),
      processing_lease_token: null,
    });
    expect((await state()).views).toBe(0);
  });

  it("rolls back every activity if the lease expires while its transaction is blocked", async () => {
    await createPost();
    const liveNow = new Date();
    await policy({ nextActivityAt: liveNow });
    const liveModule = await Test.createTestingModule({
      imports: [CharacterSocialModule],
    })
      .overrideProvider(CHARACTER_SOCIAL_WORKER_OPTIONS)
      .useValue({ ...characterSocialWorkerOptions({}), leaseMs: 1_000 })
      .compile();
    const liveApplication = liveModule.get(
      CharacterSocialActivityApplicationService,
    );
    const liveJobs = liveModule.get(CharacterSocialActivityJobService);
    await liveApplication.scheduleDueActivities();
    const claim = await liveJobs.claimNext();
    expect(claim).not.toBeNull();
    const blocker = await database.pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE opod.character_post_views IN SHARE MODE");
    const execution = liveApplication.processClaimedActivity(claim!).then(
      () => null,
      (error: unknown) => error,
    );
    try {
      // Wait for the actual write to block, rather than assuming a timer has
      // allowed the worker to reach the transaction's mutation boundary.
      const deadline = Date.now() + 3_000;
      let blocked = false;
      while (!blocked && Date.now() < deadline) {
        const waiting = await database.pool.query(
          `SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock'
           AND query LIKE '%INSERT INTO opod.character_post_views%'`,
        );
        blocked = waiting.rows.length > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      const expiry = await database.pool.query(
        "SELECT processing_lease_expires_at FROM opod.character_social_activity_jobs WHERE id=$1",
        [claim!.id.toString()],
      );
      const remaining =
        new Date(expiry.rows[0].processing_lease_expires_at as Date).getTime() -
        Date.now();
      if (remaining > 0)
        await new Promise((resolve) => setTimeout(resolve, remaining + 20));
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    expect(await execution).toEqual(
      expect.objectContaining({
        message: "character social lease expired before completion",
      }),
    );
    expect(await state()).toEqual({ views: 0, likes: 0, follows: 0 });
    await liveModule.close();
  });

  it.each(["disabled", "inactive", "outside window"])(
    "rechecks %s eligibility after claiming",
    async (reason) => {
      await createPost();
      await application.scheduleDueActivities(now);
      const claim = await jobs.claimNext(now);
      if (reason === "disabled") await policy({ enabled: false });
      if (reason === "inactive")
        await database.client
          .update(characters)
          .set({ status: "inactive" })
          .where(eq(characters.id, actorId));
      if (reason === "outside window")
        await policy({
          activeStartLocalTime: "13:00:00",
          activeEndLocalTime: "14:00:00",
        });
      await application.processClaimedActivity(claim!, now);
      expect(await state()).toEqual({ views: 0, likes: 0, follows: 0 });
      const result = await database.pool.query(
        "SELECT processing_status FROM opod.character_social_activity_jobs WHERE id=$1",
        [claim!.id.toString()],
      );
      expect(result.rows[0].processing_status).toBe("cancelled");
    },
  );
});

import { randomUUID } from "node:crypto";
import { Client } from "pg";

describe("character social schema", () => {
  let client: Client;
  let authorId: string;
  let actorId: string;
  let postId: string;
  let userId: string;

  beforeEach(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("BEGIN");
    authorId = randomUUID();
    actorId = randomUUID();
    postId = randomUUID();
    userId = randomUUID();
    await client.query(
      `INSERT INTO opod.characters(id,public_id,display_name,bio,updated_at)
       VALUES ($1,$2,'Author','',now()),($3,$4,'Actor','',now())`,
      [authorId, `social-${authorId}`, actorId, `social-${actorId}`],
    );
    await client.query(
      "INSERT INTO opod.posts(id,character_id,content) VALUES($1,$2,'fixture')",
      [postId, authorId],
    );
    await client.query(
      "INSERT INTO opod.users(id,display_name) VALUES($1,'Reader')",
      [userId],
    );
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
    await client.end();
  });

  async function expectConstraint(
    query: string,
    values: unknown[],
    constraint?: string,
  ) {
    await client.query("SAVEPOINT invalid_social_row");
    await expect(client.query(query, values)).rejects.toMatchObject({
      code: expect.stringMatching(/^23/),
      ...(constraint ? { constraint } : {}),
    });
    await client.query("ROLLBACK TO SAVEPOINT invalid_social_row");
  }

  it("keeps legacy timezones nullable and enforces policy scheduling boundaries", async () => {
    expect(
      (
        await client.query("SELECT timezone FROM opod.characters WHERE id=$1", [
          authorId,
        ])
      ).rows,
    ).toEqual([{ timezone: null }]);
    await expectConstraint(
      "UPDATE opod.characters SET timezone=$2 WHERE id=$1",
      [authorId, " Asia/Seoul "],
    );
    await client.query(
      "UPDATE opod.characters SET timezone='Asia/Seoul' WHERE id=$1",
      [authorId],
    );

    await client.query(
      `INSERT INTO opod.character_social_activity_policies
       (character_id,active_start_local_time,active_end_local_time,activity_interval_minutes,
        max_daily_post_views,max_daily_post_likes,max_daily_follows,post_like_probability,updated_at)
       VALUES($1,'22:00','06:00',15,20,10,3,0.250,now())`,
      [authorId],
    );
    for (const [assignment, constraint] of [
      [
        "active_end_local_time='22:00'",
        "character_social_activity_policies_active_time_check",
      ],
      [
        "active_start_local_time='24:00'",
        "character_social_activity_policies_active_time_check",
      ],
      [
        "activity_interval_minutes=0",
        "character_social_activity_policies_interval_check",
      ],
      [
        "max_daily_post_views=-1",
        "character_social_activity_policies_daily_limits_check",
      ],
      [
        "post_like_probability=1.001",
        "character_social_activity_policies_like_probability_check",
      ],
      [
        "enabled=true,next_activity_at=NULL",
        "character_social_activity_policies_enabled_schedule_check",
      ],
    ]) {
      await expectConstraint(
        `UPDATE opod.character_social_activity_policies SET ${assignment} WHERE character_id=$1`,
        [authorId],
        constraint,
      );
    }
  });

  it("deduplicates views and follows and rejects self-follows", async () => {
    await client.query(
      "INSERT INTO opod.character_post_views(viewer_character_id,post_id) VALUES($1,$2)",
      [actorId, postId],
    );
    await expectConstraint(
      "INSERT INTO opod.character_post_views(viewer_character_id,post_id) VALUES($1,$2)",
      [actorId, postId],
    );
    await client.query(
      "INSERT INTO opod.character_follows(follower_character_id,followed_character_id) VALUES($1,$2)",
      [actorId, authorId],
    );
    await expectConstraint(
      "INSERT INTO opod.character_follows(follower_character_id,followed_character_id) VALUES($1,$2)",
      [actorId, authorId],
      "character_follows_pkey",
    );
    await expectConstraint(
      "INSERT INTO opod.character_follows(follower_character_id,followed_character_id) VALUES($1,$1)",
      [actorId],
      "character_follows_no_self_check",
    );
  });

  it("enforces durable job identity, state, lease, and active-job uniqueness", async () => {
    const inserted = await client.query(
      `INSERT INTO opod.character_social_activity_jobs(character_id,scheduled_at,next_attempt_at)
       VALUES($1,now(),now()) RETURNING id,processing_status,attempt_count`,
      [actorId],
    );
    expect(inserted.rows).toEqual([
      { id: expect.any(String), processing_status: "queued", attempt_count: 0 },
    ]);
    expect(BigInt(inserted.rows[0].id)).toBeGreaterThan(0n);
    await client.query("SAVEPOINT explicit_identity");
    await expect(
      client.query(
        `INSERT INTO opod.character_social_activity_jobs(id,character_id,scheduled_at,next_attempt_at)
         VALUES(9001,$1,now()+interval '10 minute',now())`,
        [authorId],
      ),
    ).rejects.toMatchObject({ code: "428C9" });
    await client.query("ROLLBACK TO SAVEPOINT explicit_identity");
    await expectConstraint(
      `INSERT INTO opod.character_social_activity_jobs(character_id,scheduled_at,next_attempt_at)
       VALUES($1,now()+interval '1 minute',now())`,
      [actorId],
      "character_social_activity_jobs_active_character_key",
    );
    await client.query(
      `UPDATE opod.character_social_activity_jobs
       SET processing_status='running',processing_lease_token=$2,
           processing_lease_expires_at=now()+interval '1 minute'
       WHERE id=$1`,
      [inserted.rows[0].id, randomUUID()],
    );
    await client.query(
      `UPDATE opod.character_social_activity_jobs
       SET processing_status='completed',processing_lease_token=NULL,
           processing_lease_expires_at=NULL,finished_at=now() WHERE id=$1`,
      [inserted.rows[0].id],
    );
    await expectConstraint(
      `INSERT INTO opod.character_social_activity_jobs
       (character_id,scheduled_at,next_attempt_at)
       SELECT character_id,scheduled_at,now() FROM opod.character_social_activity_jobs WHERE id=$1`,
      [inserted.rows[0].id],
      "character_social_activity_jobs_character_scheduled_key",
    );
    const next = await client.query(
      `INSERT INTO opod.character_social_activity_jobs(character_id,scheduled_at,next_attempt_at)
       VALUES($1,now()+interval '2 minute',now()) RETURNING id`,
      [actorId],
    );
    expect(BigInt(next.rows[0].id)).toBeGreaterThan(
      BigInt(inserted.rows[0].id),
    );
    await expectConstraint(
      `UPDATE opod.character_social_activity_jobs
       SET finished_at=now() WHERE id=$1`,
      [next.rows[0].id],
      "character_social_activity_jobs_finished_at_check",
    );
    await expectConstraint(
      `UPDATE opod.character_social_activity_jobs
       SET processing_status='completed' WHERE id=$1`,
      [next.rows[0].id],
      "character_social_activity_jobs_finished_at_check",
    );
    await expectConstraint(
      `UPDATE opod.character_social_activity_jobs
       SET processing_status='running' WHERE id=$1`,
      [next.rows[0].id],
      "character_social_activity_jobs_lease_check",
    );
  });

  it("preserves nullable actors while blocking duplicate character and mixed-actor reactions", async () => {
    await client.query(
      `INSERT INTO opod.post_reactions(id,post_id,character_id,reaction_type)
       VALUES($1,$2,$3,'like')`,
      [randomUUID(), postId, actorId],
    );
    await expectConstraint(
      `INSERT INTO opod.post_reactions(id,post_id,character_id,reaction_type)
       VALUES($1,$2,$3,'like')`,
      [randomUUID(), postId, actorId],
    );
    await expectConstraint(
      `INSERT INTO opod.post_reactions(id,post_id,user_id,character_id,reaction_type)
       VALUES($1,$2,$3,$4,'bookmark')`,
      [randomUUID(), postId, userId, actorId],
      "post_reactions_single_actor_check",
    );
    await client.query(
      `INSERT INTO opod.post_reactions(id,post_id,reaction_type)
       VALUES($1,$2,'legacy-null-actor')`,
      [randomUUID(), postId],
    );
  });
});

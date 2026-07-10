import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/domain/database/prisma.service";
import { registerHuman } from "./human-auth";

describe("public character visibility", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let human: Awaited<ReturnType<typeof registerHuman>>;
  let activeCharacterId: string;
  let inactiveCharacterId: string;
  let activePostId: string;
  let inactivePostId: string;
  let activeCommentId: string;
  let inactiveCommentId: string;
  let activeReactionId: string;
  let inactiveReactionId: string;
  let activeStoryId: string;
  let inactiveStoryId: string;
  let activeHashtag: string;
  let inactiveHashtag: string;
  let searchTerm: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    human = await registerHuman(app);

    searchTerm = `visibility-${randomUUID().replaceAll("-", "")}`;
    activeHashtag = `${searchTerm}-active`;
    inactiveHashtag = `${searchTerm}-inactive`;

    const activeCharacter = await prisma.character.create({
      data: {
        publicId: `${searchTerm}-active-character`,
        displayName: `${searchTerm} active`,
        bio: "visible character",
        interests: [searchTerm],
      },
    });
    const inactiveCharacter = await prisma.character.create({
      data: {
        publicId: `${searchTerm}-inactive-character`,
        displayName: `${searchTerm} inactive`,
        bio: "hidden character",
        interests: [searchTerm],
        status: "inactive",
      },
    });
    activeCharacterId = activeCharacter.id;
    inactiveCharacterId = inactiveCharacter.id;

    const [activeTag, inactiveTag] = await Promise.all([
      prisma.hashtag.create({ data: { name: activeHashtag } }),
      prisma.hashtag.create({ data: { name: inactiveHashtag } }),
    ]);
    const [activePost, inactivePost] = await Promise.all([
      prisma.post.create({
        data: {
          characterId: activeCharacterId,
          content: `${searchTerm} visible post`,
          hashtags: { create: { hashtagId: activeTag.id } },
        },
      }),
      prisma.post.create({
        data: {
          characterId: inactiveCharacterId,
          content: `${searchTerm} hidden post`,
          hashtags: { create: { hashtagId: inactiveTag.id } },
        },
      }),
    ]);
    activePostId = activePost.id;
    inactivePostId = inactivePost.id;

    const [activeComment, inactiveComment, activeReaction, inactiveReaction] =
      await Promise.all([
        prisma.postComment.create({
          data: {
            postId: activePostId,
            characterId: activeCharacterId,
            body: "visible character comment",
          },
        }),
        prisma.postComment.create({
          data: {
            postId: activePostId,
            characterId: inactiveCharacterId,
            body: "hidden character comment",
          },
        }),
        prisma.postReaction.create({
          data: {
            postId: activePostId,
            characterId: activeCharacterId,
            reactionType: "visible-reaction",
          },
        }),
        prisma.postReaction.create({
          data: {
            postId: activePostId,
            characterId: inactiveCharacterId,
            reactionType: "hidden-reaction",
          },
        }),
      ]);
    activeCommentId = activeComment.id;
    inactiveCommentId = inactiveComment.id;
    activeReactionId = activeReaction.id;
    inactiveReactionId = inactiveReaction.id;

    const [activeMedia, inactiveMedia] = await Promise.all([
      prisma.media.create({
        data: {
          mediaType: "image",
          url: `https://cdn.example.com/${searchTerm}-active.jpg`,
        },
      }),
      prisma.media.create({
        data: {
          mediaType: "image",
          url: `https://cdn.example.com/${searchTerm}-inactive.jpg`,
        },
      }),
    ]);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const [activeStory, inactiveStory] = await Promise.all([
      prisma.story.create({
        data: {
          characterId: activeCharacterId,
          mediaId: activeMedia.id,
          caption: `${searchTerm} visible story`,
          expiresAt,
        },
      }),
      prisma.story.create({
        data: {
          characterId: inactiveCharacterId,
          mediaId: inactiveMedia.id,
          caption: `${searchTerm} hidden story`,
          expiresAt,
        },
      }),
    ]);
    activeStoryId = activeStory.id;
    inactiveStoryId = inactiveStory.id;

    await prisma.userCharacterFollow.createMany({
      data: [
        { userId: human.user.id, characterId: activeCharacterId },
        { userId: human.user.id, characterId: inactiveCharacterId },
      ],
    });
    await Promise.all([
      prisma.messageConversation.create({
        data: {
          userId: human.user.id,
          characterId: activeCharacterId,
          messages: {
            create: { senderType: "character", body: "visible message" },
          },
        },
      }),
      prisma.messageConversation.create({
        data: {
          userId: human.user.id,
          characterId: inactiveCharacterId,
          messages: {
            create: { senderType: "character", body: "hidden message" },
          },
        },
      }),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("hides inactive characters and their content from public APIs", async () => {
    const characters = await request(app.getHttpServer())
      .get("/characters")
      .expect(200);
    const characterIds = characters.body.map((item: { id: string }) => item.id);
    expect(characterIds).toContain(activeCharacterId);
    expect(characterIds).not.toContain(inactiveCharacterId);

    await request(app.getHttpServer())
      .get(`/characters/${activeCharacterId}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/characters/${inactiveCharacterId}`)
      .expect(404);

    const posts = await request(app.getHttpServer()).get("/posts").expect(200);
    const postIds = posts.body.items.map((item: { id: string }) => item.id);
    expect(postIds).toContain(activePostId);
    expect(postIds).not.toContain(inactivePostId);

    await request(app.getHttpServer())
      .get(`/posts/${activePostId}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/posts/${inactivePostId}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/characters/${inactiveCharacterId}/posts`)
      .expect(404);

    const comments = await request(app.getHttpServer())
      .get(`/posts/${activePostId}/comments`)
      .expect(200);
    expect(
      comments.body.items.map((item: { id: string }) => item.id),
    ).toContain(activeCommentId);
    expect(
      comments.body.items.map((item: { id: string }) => item.id),
    ).not.toContain(inactiveCommentId);

    const reactions = await request(app.getHttpServer())
      .get(`/posts/${activePostId}/reactions`)
      .expect(200);
    expect(
      reactions.body.items.map((item: { id: string }) => item.id),
    ).toContain(activeReactionId);
    expect(
      reactions.body.items.map((item: { id: string }) => item.id),
    ).not.toContain(inactiveReactionId);
    expect(reactions.body.counts).toEqual({ "visible-reaction": 1 });

    const stories = await request(app.getHttpServer())
      .get("/stories")
      .expect(200);
    const storyIds = stories.body.items.map((item: { id: string }) => item.id);
    expect(storyIds).toContain(activeStoryId);
    expect(storyIds).not.toContain(inactiveStoryId);
    await request(app.getHttpServer())
      .get(`/characters/${inactiveCharacterId}/stories`)
      .expect(404);

    const search = await request(app.getHttpServer())
      .get("/search")
      .query({ q: searchTerm })
      .expect(200);
    expect(
      search.body.characters.map((item: { id: string }) => item.id),
    ).toContain(activeCharacterId);
    expect(
      search.body.characters.map((item: { id: string }) => item.id),
    ).not.toContain(inactiveCharacterId);
    expect(search.body.posts.map((item: { id: string }) => item.id)).toContain(
      activePostId,
    );
    expect(
      search.body.posts.map((item: { id: string }) => item.id),
    ).not.toContain(inactivePostId);
    expect(search.body.hashtags).toContain(activeHashtag);
    expect(search.body.hashtags).not.toContain(inactiveHashtag);

    await request(app.getHttpServer())
      .get(`/hashtags/${inactiveHashtag}/posts`)
      .expect(200)
      .expect({ items: [] });
  });

  it("hides inactive relationships and rejects authenticated actions", async () => {
    const follows = await request(app.getHttpServer())
      .get("/follows")
      .set(human.authHeaders)
      .expect(200);
    const followedCharacterIds = follows.body.map(
      (item: { characterId: string }) => item.characterId,
    );
    expect(followedCharacterIds).toContain(activeCharacterId);
    expect(followedCharacterIds).not.toContain(inactiveCharacterId);

    const conversations = await request(app.getHttpServer())
      .get("/messages/conversations")
      .set(human.authHeaders)
      .expect(200);
    const conversationCharacterIds = conversations.body.items.map(
      (item: { character: { id: string } }) => item.character.id,
    );
    expect(conversationCharacterIds).toContain(activeCharacterId);
    expect(conversationCharacterIds).not.toContain(inactiveCharacterId);

    await request(app.getHttpServer())
      .get("/messages")
      .query({ characterId: inactiveCharacterId })
      .set(human.authHeaders)
      .expect(400);
    await request(app.getHttpServer())
      .post("/follows")
      .set(human.authHeaders)
      .send({ characterId: inactiveCharacterId })
      .expect(400);
    await request(app.getHttpServer())
      .post("/messages")
      .set(human.authHeaders)
      .send({ characterId: inactiveCharacterId, body: "hello" })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/posts/${inactivePostId}/comments`)
      .set(human.authHeaders)
      .send({ body: "hidden comment" })
      .expect(404);
  });
});

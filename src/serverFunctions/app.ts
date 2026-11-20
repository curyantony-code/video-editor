// Every server function the pages call. Each runs behind
// ensureUserMiddleware and turns the Gateway's user into an Actor first.
import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";
import { z } from "zod";
import { actorOf, NotFound } from "@/server/access";
import * as agent from "@/server/agent";
import { aiIsOff, withAi } from "@/server/ai";
import * as comments from "@/server/comments";
import * as exportsQ from "@/server/exports";
import * as mediaQ from "@/server/media";
import * as projects from "@/server/projects";
import { announce } from "@/server/room";
import * as script from "@/server/script";
import * as shots from "@/server/shots";
import * as timeline from "@/server/timeline";

const parse = <T extends z.ZodTypeAny>(schema: T) => (data: unknown) => schema.parse(data) as z.infer<T>;

/** A missing or private project is a not-found page, never an error. */
async function orNotFound<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NotFound) throw notFound();
    throw error;
  }
}

// ---- Projects ----

export const getProjects = createServerFn({ method: "GET" }).middleware([ensureUserMiddleware]).handler(async ({ context }) => {
  const actor = await actorOf(context.user);
  return { projects: await projects.listProjects(actor), org: await projects.listOrgProjects(actor) };
});

export const createProject = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(projects.createProjectInput))
  .handler(async ({ data, context }) => projects.createProject(await actorOf(context.user), data));

export const getProject = createServerFn({ method: "GET" }).middleware([ensureUserMiddleware])
  .validator(parse(projects.projectIdInput))
  .handler(async ({ data, context }) => {
    const actor = await actorOf(context.user);
    return orNotFound(async () => ({ ...(await projects.getProject(actor, data.projectId)), me: actor.email }));
  });

export const renameProject = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(projects.renameProjectInput))
  .handler(async ({ data, context }) => projects.renameProject(await actorOf(context.user), data));

export const deleteProject = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(projects.projectIdInput))
  .handler(async ({ data, context }) => projects.deleteProject(await actorOf(context.user), data.projectId, env.media));

export const getSharing = createServerFn({ method: "GET" }).middleware([ensureUserMiddleware])
  .validator(parse(projects.projectIdInput))
  .handler(async ({ data, context }) => {
    const actor = await actorOf(context.user);
    return orNotFound(async () => {
      const project = await projects.getProject(actor, data.projectId);
      const owner = project.role === "owner";
      return {
        shares: owner ? await projects.listShares(actor, data.projectId) : [],
        reviewLinks: owner ? await comments.listReviewLinks(actor, data.projectId) : [],
      };
    });
  });

export const shareProject = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(projects.shareInput))
  .handler(async ({ data, context }) => projects.share(await actorOf(context.user), data));

export const unshareProject = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(projects.unshareInput))
  .handler(async ({ data, context }) => projects.unshare(await actorOf(context.user), data));

// ---- Media ----

export const getMedia = createServerFn({ method: "GET" }).middleware([ensureUserMiddleware])
  .validator(parse(mediaQ.listMediaInput))
  .handler(async ({ data, context }) => {
    const actor = await actorOf(context.user);
    return orNotFound(async () => ({ media: await mediaQ.listMedia(actor, data.projectId, data.search), aiOff: await aiIsOff(actor) }));
  });

export const setMediaNote = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(mediaQ.noteInput))
  .handler(async ({ data, context }) => mediaQ.setNote(await actorOf(context.user), data));

export const draftMediaNote = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(agent.draftNoteInput))
  .handler(async ({ data, context }) => {
    const actor = await actorOf(context.user);
    return withAi(() => agent.draftNote(actor, data));
  });

export const deleteMedia = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(mediaQ.deleteMediaInput))
  .handler(async ({ data, context }) => {
    const result = await mediaQ.deleteMedia(await actorOf(context.user), data, env.media);
    if (result.timelineChanged) await announce(env, data.projectId, { what: "timeline" });
    return result;
  });

// ---- Timeline and agent ----

export const getEditor = createServerFn({ method: "GET" }).middleware([ensureUserMiddleware])
  .validator(parse(projects.projectIdInput))
  .handler(async ({ data, context }) => {
    const actor = await actorOf(context.user);
    return orNotFound(async () => ({
      ...(await timeline.getTimeline(actor, data.projectId)),
      media: await mediaQ.listMedia(actor, data.projectId),
      messages: await agent.listAgentMessages(actor, data.projectId),
      comments: await comments.listComments(actor, data.projectId),
      aiOff: await aiIsOff(actor),
    }));
  });

export const saveTimeline = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(timeline.saveTimelineInput))
  .handler(async ({ data, context }) => {
    const result = await timeline.saveTimeline(await actorOf(context.user), data);
    await announce(env, data.projectId, { what: "timeline", revision: result.revision });
    return result;
  });

export const undoTimeline = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(timeline.undoInput))
  .handler(async ({ data, context }) => {
    const result = await timeline.undoTimeline(await actorOf(context.user), data);
    await announce(env, data.projectId, { what: "timeline", revision: result.revision });
    return result;
  });

export const runAgent = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(agent.agentInput))
  .handler(async ({ data, context }) => {
    const actor = await actorOf(context.user);
    const result = await withAi(() => agent.runAgent(actor, data));
    if (!result.off) await announce(env, data.projectId, { what: "timeline", revision: result.result.revision });
    return result;
  });

export const revertAgent = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(agent.revertInput))
  .handler(async ({ data, context }) => {
    const result = await agent.revertAgent(await actorOf(context.user), data);
    await announce(env, data.projectId, { what: "timeline", revision: result.revision });
    return result;
  });

// ---- Comments and review links ----

export const addComment = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(comments.addCommentInput))
  .handler(async ({ data, context }) => {
    const result = await comments.addComment(await actorOf(context.user), data);
    await announce(env, data.projectId, { what: "comments" });
    return result;
  });

export const resolveComment = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(comments.resolveInput))
  .handler(async ({ data, context }) => {
    const result = await comments.resolveComment(await actorOf(context.user), data);
    await announce(env, data.projectId, { what: "comments" });
    return result;
  });

export const createReviewLink = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(projects.projectIdInput))
  .handler(async ({ data, context }) => comments.createReviewLink(await actorOf(context.user), data.projectId));

export const revokeReviewLink = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(comments.revokeInput))
  .handler(async ({ data, context }) => comments.revokeReviewLink(await actorOf(context.user), data));

// ---- Script ----

export const getScript = createServerFn({ method: "GET" }).middleware([ensureUserMiddleware])
  .validator(parse(projects.projectIdInput))
  .handler(async ({ data, context }) => {
    const actor = await actorOf(context.user);
    return orNotFound(async () => ({ ...(await script.getScript(actor, data.projectId)), aiOff: await aiIsOff(actor) }));
  });

export const saveScript = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(script.saveScriptInput))
  .handler(async ({ data, context }) => script.saveScript(await actorOf(context.user), data));

export const draftScript = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(script.draftScriptInput))
  .handler(async ({ data, context }) => {
    const actor = await actorOf(context.user);
    return withAi(() => script.draftScript(actor, data));
  });

export const rewriteScene = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(script.rewriteSceneInput))
  .handler(async ({ data, context }) => {
    const actor = await actorOf(context.user);
    return withAi(() => script.rewriteScene(actor, data));
  });

// ---- Storyboard ----

export const getStoryboard = createServerFn({ method: "GET" }).middleware([ensureUserMiddleware])
  .validator(parse(projects.projectIdInput))
  .handler(async ({ data, context }) => {
    const actor = await actorOf(context.user);
    return orNotFound(async () => ({
      shots: await shots.listShots(actor, data.projectId),
      scenes: (await script.getScript(actor, data.projectId)).scenes,
      aiOff: await aiIsOff(actor),
    }));
  });

export const saveShot = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(shots.saveShotInput))
  .handler(async ({ data, context }) => shots.saveShot(await actorOf(context.user), data));

export const reorderShots = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(shots.reorderShotsInput))
  .handler(async ({ data, context }) => shots.reorderShots(await actorOf(context.user), data));

export const deleteShot = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(shots.shotIdInput))
  .handler(async ({ data, context }) => shots.deleteShot(await actorOf(context.user), data, env.media));

export const breakdownScript = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(shots.breakdownInput))
  .handler(async ({ data, context }) => {
    const actor = await actorOf(context.user);
    return withAi(() => shots.breakdown(actor, data));
  });

export const saveBreakdown = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(shots.saveBreakdownInput))
  .handler(async ({ data, context }) => shots.saveBreakdown(await actorOf(context.user), data));

export const sendToTimeline = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(shots.breakdownInput))
  .handler(async ({ data, context }) => {
    const result = await shots.sendToTimeline(await actorOf(context.user), data);
    await announce(env, data.projectId, { what: "timeline", revision: result.revision });
    return result;
  });

// ---- Exports ----

export const getExports = createServerFn({ method: "GET" }).middleware([ensureUserMiddleware])
  .validator(parse(projects.projectIdInput))
  .handler(async ({ data, context }) => {
    const actor = await actorOf(context.user);
    return orNotFound(async () => ({
      exports: await exportsQ.listExports(actor, data.projectId),
      ...(await timeline.getTimeline(actor, data.projectId)),
      media: await mediaQ.listMedia(actor, data.projectId),
    }));
  });

export const deleteExport = createServerFn({ method: "POST" }).middleware([ensureUserMiddleware])
  .validator(parse(exportsQ.deleteExportInput))
  .handler(async ({ data, context }) => exportsQ.deleteExport(await actorOf(context.user), data, env.media));

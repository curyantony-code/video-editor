import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,

  index,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`);

/** People the app has seen, keyed by the Gateway's user id. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email").notNull(),
  createdAt: createdAt(),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    aspect: text("aspect").notNull(),
    fps: integer("fps").notNull(),
    revision: integer("revision").notNull().default(0),
    scriptTitle: text("script_title").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("projects_owner").on(t.ownerId)],
);

/** Who a project is shared with. userId is null until that person first opens the app. */
export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: text("project_id").notNull(),
    email: text("email").notNull(),
    userId: text("user_id"),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.email] }),
    index("members_user").on(t.userId),
  ],
);

export const media = sqliteTable(
  "media",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    duration: real("duration"),
    width: integer("width"),
    height: integer("height"),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("media_project").on(t.projectId)],
);

/** Every saved state of a project's timeline. The newest is the timeline. */
export const revisions = sqliteTable(
  "timeline_revisions",
  {
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(),
    timeline: text("timeline").notNull(),
    source: text("source").notNull(),
    authorId: text("author_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.number] })],
);

export const agentMessages = sqliteTable(
  "agent_messages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    operations: text("operations"),
    revision: integer("revision"),
    createdAt: createdAt(),
  },
  (t) => [index("agent_project").on(t.projectId)],
);

export const scenes = sqliteTable(
  "script_scenes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    position: integer("position").notNull(),
    heading: text("heading").notNull(),
    action: text("action").notNull(),
    dialogue: text("dialogue").notNull(),
  },
  (t) => [index("scenes_project").on(t.projectId)],
);

export const shots = sqliteTable(
  "shots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    position: integer("position").notNull(),
    sceneId: text("scene_id"),
    description: text("description").notNull(),
    framing: text("framing").notNull(),
    move: text("move").notNull(),
    duration: real("duration").notNull(),
    hasImage: integer("has_image", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("shots_project").on(t.projectId)],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    parentId: text("parent_id"),
    time: real("time").notNull(),
    body: text("body").notNull(),
    authorId: text("author_id"),
    authorName: text("author_name").notNull(),
    fromReview: integer("from_review", { mode: "boolean" }).notNull().default(false),
    resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("comments_project").on(t.projectId)],
);

export const reviewLinks = sqliteTable(
  "review_links",
  {
    token: text("token").primaryKey(),
    projectId: text("project_id").notNull(),
    createdBy: text("created_by").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("review_project").on(t.projectId)],
);

export const exportsTable = sqliteTable(
  "exports",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    size: integer("size").notNull(),
    duration: real("duration").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("exports_project").on(t.projectId)],
);

/** Whether the organization's AI provider answered last time. */
export const aiState = sqliteTable("ai_state", {
  orgId: text("org_id").primaryKey(),
  off: integer("off", { mode: "boolean" }).notNull(),
  checkedAt: createdAt(),
});


CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`operations` text,
	`revision` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_project` ON `agent_messages` (`project_id`);--> statement-breakpoint
CREATE TABLE `ai_state` (
	`org_id` text PRIMARY KEY NOT NULL,
	`off` integer NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`parent_id` text,
	`time` real NOT NULL,
	`body` text NOT NULL,
	`author_id` text,
	`author_name` text NOT NULL,
	`from_review` integer DEFAULT false NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `comments_project` ON `comments` (`project_id`);--> statement-breakpoint
CREATE TABLE `exports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`size` integer NOT NULL,
	`duration` real NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exports_project` ON `exports` (`project_id`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`duration` real,
	`width` integer,
	`height` integer,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `media_project` ON `media` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` text NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`role` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`project_id`, `email`)
);
--> statement-breakpoint
CREATE INDEX `members_user` ON `project_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`aspect` text NOT NULL,
	`fps` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`script_title` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_owner` ON `projects` (`owner_id`);--> statement-breakpoint
CREATE TABLE `review_links` (
	`token` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`created_by` text NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `review_project` ON `review_links` (`project_id`);--> statement-breakpoint
CREATE TABLE `timeline_revisions` (
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`timeline` text NOT NULL,
	`source` text NOT NULL,
	`author_id` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`project_id`, `number`)
);
--> statement-breakpoint
CREATE TABLE `script_scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`position` integer NOT NULL,
	`heading` text NOT NULL,
	`action` text NOT NULL,
	`dialogue` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scenes_project` ON `script_scenes` (`project_id`);--> statement-breakpoint
CREATE TABLE `shots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`position` integer NOT NULL,
	`scene_id` text,
	`description` text NOT NULL,
	`framing` text NOT NULL,
	`move` text NOT NULL,
	`duration` real NOT NULL,
	`has_image` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shots_project` ON `shots` (`project_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);

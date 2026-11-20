// The app's tools for AI clients, served by the Gateway at /mcp.
import { ToolError, defineTools } from "@every-app/sdk/server";
import { z } from "zod";
import { actorOf, NotFound } from "@/server/access";
import * as projects from "@/server/projects";
import * as timeline from "@/server/timeline";

export const tools = defineTools({
  list_projects: {
    description: "List the video projects the user owns or that are shared with them.",
    risk: "read",
    input: z.object({}).strict(),
    handler: async (_input, { user }) => projects.listProjects(await actorOf(user)),
  },
  get_timeline: {
    description: "Read a project's current timeline: tracks and clips, with times in frames.",
    risk: "read",
    input: projects.projectIdInput,
    handler: async (input, { user }) => {
      try {
        return await timeline.getTimeline(await actorOf(user), input.projectId);
      } catch (error) {
        if (error instanceof NotFound) throw new ToolError("No project with that id");
        throw error;
      }
    },
  },
});

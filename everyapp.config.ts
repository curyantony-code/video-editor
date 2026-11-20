import { defineEveryApp } from "@every-app/sdk";

export default defineEveryApp({
  id: "video-editor",
  name: "Video Editor",
  description:
    "Edit videos together in the browser: upload footage, cut it on a multitrack timeline, plan it with a script and storyboard, and export MP4s.",
  icon: "/icon.svg",
  access: "everyone",
  resources: {
    d1: ["DB"],
    r2: ["media"],
    // One ProjectRoom per project: the WebSockets of its open editors.
    durableObjects: [{ name: "ROOMS", className: "ProjectRoom" }],
  },
  providers: [
    {
      id: "openrouter",
      why: "The editing agent, the script co-writer, storyboard breakdowns and media notes.",
      docs: "https://openrouter.ai/keys",
    },
  ],
  features: {
    ai: {
      name: "AI help",
      why: "Edits from plain-language requests, script drafts and rewrites, shot breakdowns and media notes.",
      providers: ["openrouter"],
    },
  },
  // Review links: people outside the organization watch the newest export
  // and leave comments. Each route checks its token itself.
  public: [
    { path: "/r/:token", methods: ["GET"] },
    { path: "/r/:token/video", methods: ["GET"] },
    { path: "/r/:token/comments", methods: ["POST"] },
  ],
  // The scripts and styles the review page loads.
  publicAssets: ["/assets/**", "/icon.svg"],
});

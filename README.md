# Video Editor

A shared video editor for your organization: upload footage, cut it on a multitrack timeline, plan it with a script and storyboard, and export MP4s, all in the browser.

Inspired by https://invideo.io

Built with [oss.new](https://oss.new) for [EveryApp](https://github.com/every-app/every-app).

## Features

- Create video projects in 16:9, 9:16 or 1:1 and upload video, audio and images to each one's media library.
- Cut on a multitrack timeline: place, move, trim, split and delete clips, add text, set volume, preview, and undo.
- Ask an editing agent for changes in plain words, revert its edits, and search media by notes it can draft.
- Write a script scene by scene, with an AI co-writer that drafts or rewrites scenes for you to accept.
- Plan shots on a storyboard with framing, camera move, duration and a reference image, and send it to the timeline.
- Share a project with members as editor or viewer, see who is in it, watch edits arrive live, and comment at a time; outside reviewers comment through a review link.
- Export an H.264 MP4, or the timeline as OpenTimelineIO or FCP7 XML, alone or zipped with its media.

Left out: accounts and sign-in, which your Gateway handles; generated video, images, voices and avatars; stock footage; custom and external agents; colour, 3D and effects tools, timeline branches and session replays; templates and marketing tools; audio-only and still-frame exports.

## Setup

- Install: `pnpm install`.
- Run locally: `pnpm dev`.
- Test: `pnpm test` for the timeline rules; `checks/` holds the end-to-end suites run against a packaged release.
- Deploy: `pnpm run deploy` to your EveryApp Gateway. It creates the D1 database, the R2 bucket (R2 must be enabled on the Cloudflare account) and the Durable Object for live editing.
- AI help (optional): add an OpenRouter key to the Gateway with `pnpm everyapp provider add openrouter`. Without it the agent, co-writer, shot breakdown and note drafts show as off; everything else works.

There are no secrets or settings to fill in.

## Limitations

- Rendering happens in the browser and needs WebCodecs H.264 support (current Chrome, Edge or Safari); long timelines take a while and the tab must stay open.
- Uploads are limited to 500 MB per file.
- The preview plays the topmost video clip with text and audio on top; there are no transitions or effects.
- Review links play only the newest export, and only once one exists.
- The OpenRouter calls use `openai/gpt-4o-mini` and are billed to your OpenRouter account.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { type Actor, projectAccess } from "./access";
import { toFcp7Xml, toOtio } from "./projectFile";
import { attachment } from "./route";
import { readTimeline } from "./timeline";

export async function projectFile(actor: Actor, projectId: string, kind: "otio" | "xml") {
  const { project } = await projectAccess(actor, projectId);
  const timeline = await readTimeline(project);
  const items = await db
    .select({ id: media.id, name: media.name, kind: media.kind, duration: media.duration, width: media.width, height: media.height })
    .from(media)
    .where(eq(media.projectId, projectId));
  if (kind === "otio")
    return new Response(JSON.stringify(toOtio(project.title, project.fps, timeline, items), null, 2), {
      headers: { "content-type": "application/json", "content-disposition": attachment(`${project.title}.otio`) },
    });
  return new Response(toFcp7Xml(project.title, project.fps, project.aspect, timeline, items), {
    headers: { "content-type": "application/xml", "content-disposition": attachment(`${project.title}.xml`) },
  });
}

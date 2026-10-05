import {
  assert,
  rateLimit,
  session,
  sameOrigin,
  digest,
} from "./department-security.js";
import { saveAssignmentForStaff } from "../lib/endepth-db.js";
export async function createDepthTest(sql, staff) {
  assert(staff.teacherId, 400, "Use your teacher account for testing.");
  await rateLimit(sql, "depth-sandbox:" + staff.teacherId, 5, 3600);
  const assignment = await saveAssignmentForStaff(staff, {
    teacherId: staff.teacherId,
    title: "EXAMPLE: fictional EnDepth test",
    course: "EXAMPLE course",
    section: "EXAMPLE section",
    date: "Testing only",
    prompt: "How does a fictional garden change a community?",
    sourceTitle: "Fictional garden passage",
    passage:
      "The garden gave neighbors a shared responsibility, but they disagreed about how to use the space.",
    directions: "Develop your own interpretation and a question.",
    evidenceRequirement: "Use the fictional passage.",
    coachingFocus: "Balanced preparation",
    status: "open",
  });
  await sql`UPDATE endepth_assignments SET sandbox=TRUE WHERE assignment_id=${assignment.assignmentId} AND teacher_id=${staff.teacherId}`;
  return { studentPath: `/?assignment=${assignment.publicSlug}` };
}
// Staff cookies authorize only their own explicitly designated test assignments.
// Ordinary student assignments retain the existing class-code flow.
export async function ownsDepthSandbox(request, assignmentId) {
  try {
    sameOrigin(request);
    const staff = await session(request);
    const { database } = await import("./department-security.js");
    const sql = await database();
    const rows =
      await sql`SELECT assignment_id FROM endepth_assignments WHERE assignment_id=${assignmentId} AND sandbox=TRUE AND teacher_id=${staff.teacherId}`;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function depthTestIdentity(request, assignmentId) {
  const { database } = await import("./department-security.js");
  const sql = await database();
  const rows =
    await sql`SELECT sandbox,teacher_id FROM endepth_assignments WHERE assignment_id=${assignmentId}`;
  if (!rows[0]?.sandbox) return null;
  assert(
    await ownsDepthSandbox(request, assignmentId),
    403,
    "Only the teacher who owns this test can use it.",
  );
  return digest("teacher-test:" + rows[0].teacher_id);
}

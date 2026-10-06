export async function post(action, body = {}, path = "/api/department") {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Request failed.");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}
export function safeCsv(rows) {
  const cell = (v) =>
    '"' +
    String(v ?? "")
      .replace(/^[\s]*[=+@-]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
export function downloadRecords(students) {
  const csv = safeCsv([
    [
      "First name",
      "Last name",
      "Email",
      "Original",
      "Working/final",
      "Reflection",
      "Submission status",
      "Revision history",
      "Coaching history",
    ],
    ...students.map((s) => [
      s.firstName,
      s.lastName,
      s.email,
      s.original,
      s.working,
      s.reflection,
      s.submittedAt || "Not submitted",
      JSON.stringify(s.revisions),
      JSON.stringify(s.checks),
    ]),
  ]);
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "enscribe-records.csv";
  a.click();
  URL.revokeObjectURL(url);
}

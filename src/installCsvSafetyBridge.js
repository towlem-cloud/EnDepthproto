function neutralizeCsvFormulas(value) {
  const csv = String(value || "");

  // EnDepth quotes every exported cell. Prefix an apostrophe inside any cell
  // whose first meaningful character could be interpreted as a spreadsheet
  // formula. The apostrophe is displayed as a literal-text marker by common
  // spreadsheet applications and prevents formula/DDE execution.
  return csv.replace(
    /(^|[,\n])"((?:[ \t\r]*[=+\-@])|[\t\r])/g,
    (_match, boundary, dangerousStart) => `${boundary}"'${dangerousStart}`
  );
}

/**
 * Adds a final defense at the CSV Blob boundary. This protects every current
 * and future CSV export, including raw student names, email, and written work,
 * without changing non-CSV downloads.
 */
export function installCsvSafetyBridge() {
  if (typeof window === "undefined" || window.__endepthCsvSafetyBridge) return;
  window.__endepthCsvSafetyBridge = true;

  const NativeBlob = window.Blob;

  class SafeCsvBlob extends NativeBlob {
    constructor(parts = [], options = {}) {
      const isCsv = String(options?.type || "")
        .toLowerCase()
        .startsWith("text/csv");
      const safeParts = isCsv
        ? parts.map((part) =>
            typeof part === "string" ? neutralizeCsvFormulas(part) : part
          )
        : parts;
      super(safeParts, options);
    }
  }

  Object.setPrototypeOf(SafeCsvBlob, NativeBlob);
  window.Blob = SafeCsvBlob;
}

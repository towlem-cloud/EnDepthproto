// Split audited PostgreSQL DDL without splitting semicolons inside function bodies.
export function statements(source) {
  const result = [];
  let start = 0,
    quote = null,
    dollar = null,
    lineComment = false,
    blockComment = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i],
      next = source[i + 1];
    if (lineComment) {
      if (c === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (dollar) {
      if (source.startsWith(dollar, i)) {
        i += dollar.length - 1;
        dollar = null;
      }
      continue;
    }
    if (quote) {
      if (c === quote) {
        if (next === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (c === "-" && next === "-") {
      lineComment = true;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "$") {
      const match = source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) {
        dollar = match[0];
        i += dollar.length - 1;
        continue;
      }
    }
    if (c === ";") {
      const statement = source.slice(start, i + 1).trim();
      if (statement) result.push(statement);
      start = i + 1;
    }
  }
  const last = source.slice(start).trim();
  if (last) result.push(last);
  if (quote || dollar || blockComment)
    throw new Error("Unterminated SQL literal.");
  return result;
}

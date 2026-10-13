export const MIN_INITIAL_RESPONSE_WORDS = 40;

export function initialResponseMeetsMinimum(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return Boolean(text) && text.split(/\s+/).length >= MIN_INITIAL_RESPONSE_WORDS;
}

/**
 * Parses JSON returned by an LLM.
 *
 * Even with JSON mode enabled, models occasionally wrap their answer in
 * ```json fences or add a sentence before/after the object. This strips that
 * noise and falls back to extracting the outermost {...} or [...] block.
 */
export const parseAiJson = (raw) => {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("AI returned an empty response.");
  }

  let text = raw.trim();

  // Strip ```json ... ``` / ``` ... ``` fences
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    text = fenced[1].trim();
  }

  try {
    return JSON.parse(text);
  } catch {
    // Fall back to the first balanced-looking JSON block in the text
    const start = text.search(/[{[]/);
    const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));

    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // fall through
      }
    }

    throw new Error("AI returned a response that was not valid JSON.");
  }
};

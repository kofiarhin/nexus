/**
 * Maps `[S1]`-style markers in generated text back onto the context manifest.
 * Kept separate from the provider so streamed and non-streamed replies cite
 * sources identically.
 */
export function mapCitations(text, sources = []) {
  const used = new Set();
  for (const match of String(text ?? '').matchAll(/\[S(\d+)\]/g)) {
    const index = Number(match[1]) - 1;
    if (index >= 0 && index < sources.length) used.add(index);
  }
  return [...used]
    .sort((a, b) => a - b)
    .map((index) => ({
      marker: `S${index + 1}`,
      path: sources[index].path,
      sha: sources[index].sha ?? null,
      title: sources[index].title ?? null,
      reason: sources[index].reason ?? null
    }));
}

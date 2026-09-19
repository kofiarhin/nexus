/**
 * Prompt construction for the reasoning provider.
 *
 * Prompts carry only bounded Vault excerpts and safe metadata. Source blocks
 * are numbered so citations can be mapped back deterministically after the
 * model responds.
 */

const BASE_RULES = [
  'You are Nexus, a second brain and business operations assistant for a single owner.',
  'Answer only from the numbered Vault sources provided. Never invent paths, records, or facts.',
  'Cite every claim using the source markers [S1], [S2], and so on.',
  'If the sources do not contain the answer, say so plainly and name what is missing.',
  'Never claim that a change was made, approved, executed, or verified. You may only propose.'
].join('\n');

export function renderSources(sources = []) {
  if (sources.length === 0) return 'No Vault sources were selected for this request.';
  return sources
    .map((source, index) => {
      const header = `[S${index + 1}] path: ${source.path}`
        + (source.title ? ` | title: ${source.title}` : '')
        + (source.reason ? ` | selected because: ${source.reason}` : '');
      return `${header}\n---\n${source.excerpt ?? ''}\n---`;
    })
    .join('\n\n');
}

export function buildAnswerMessages({ messages = [], sources = [], workspaceRules = '' }) {
  const system = [
    BASE_RULES,
    workspaceRules ? `Workspace rules from NEXUS.md:\n${workspaceRules}` : '',
    `Vault sources:\n${renderSources(sources)}`
  ].filter(Boolean).join('\n\n');

  return [
    { role: 'system', content: system },
    ...messages.map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content
    }))
  ];
}

export function buildPlanMessages({ goal, sources = [], facts = {} }) {
  const system = [
    BASE_RULES,
    'Produce a prioritised plan. For each recommendation give: title, reason, and the source markers it rests on.',
    'Rank by deadline risk, blocking impact, and stated priority. Do not change any record.',
    `Deterministic facts already computed by the server (authoritative, do not contradict):\n${JSON.stringify(facts, null, 2)}`,
    `Vault sources:\n${renderSources(sources)}`
  ].join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: goal }
  ];
}

export function buildSummaryMessages({ content, sources = [], instruction }) {
  const system = [
    BASE_RULES,
    'Summarise faithfully. Separate facts from recommendations. Keep it concise.',
    `Vault sources:\n${renderSources(sources)}`
  ].join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: `${instruction ?? 'Summarise the following content.'}\n\n${content}` }
  ];
}

export function buildOperationMessages({ instruction, sources = [], allowedOperations = [], writablePaths = [] }) {
  const system = [
    BASE_RULES,
    'Translate the request into operation proposals over the Vault.',
    `Allowed actions: ${allowedOperations.join(', ') || 'none'}.`,
    `Writable path prefixes: ${writablePaths.join(', ') || 'none'}.`,
    'Respond with JSON only, using this exact shape:',
    '{"answer": "short explanation with [S1] citations", "operations": [{"action": "append", "path": "tasks/TASKS.md", "content": "...", "underHeading": "Open", "reason": "why"}]}',
    'Use an empty operations array when no change is requested or the request is unclear.',
    'The server validates, approves, and executes. You may not approve or execute anything.',
    `Vault sources:\n${renderSources(sources)}`
  ].join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: instruction }
  ];
}

/** Extracts the first balanced JSON object from a model response. */
export function extractJsonObject(text) {
  const value = String(text ?? '');
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : value;
  const start = candidate.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

export { mapCitations } from '../../utils/citations.js';

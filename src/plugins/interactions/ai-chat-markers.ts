import {Marked} from 'marked';
import {lexicalExtension} from '../../renderer/worker-tokenizers';

/** Authored anchors only: code fences, code spans and raw HTML are not link declarations. */
export function aiChatAnchorIds(markdown: string): string[] {
  const marked = new Marked(lexicalExtension('mdxAiChatAnchor'));
  const ids = new Set<string>();
  marked.walkTokens(marked.lexer(markdown), token => {
    if (token.type === 'mdxAiChatAnchor') ids.add((token as unknown as {type: string; anchorId: string}).anchorId);
  });
  return [...ids];
}

/** Exact top-level legacy rows for an explicit migration, excluding fenced code. */
export function legacyAiChatLocations(markdown: string): Array<{from: number; to: number; prompt: string}> {
  const marked = new Marked(lexicalExtension('mdxAiChat')), locations: Array<{from: number; to: number; prompt: string}> = [];
  let cursor = 0;
  for (const token of marked.lexer(markdown)) {
    const from = markdown.indexOf(token.raw, cursor); if (from < 0) continue;
    cursor = from + token.raw.length;
    if (token.type === 'mdxAiChat') locations.push({from, to: cursor, prompt: String(token.prompt ?? '')});
  }
  return locations;
}

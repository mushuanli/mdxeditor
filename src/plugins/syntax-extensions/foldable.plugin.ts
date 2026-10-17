import type { MDxPlugin, PluginContext } from '../../core/types';
import { escapeHTML } from '../../utils/html';

export interface FoldablePluginOptions {
  /** Defaults to true. */
  defaultOpen?: boolean;
  /** Defaults to mdx-editor-foldable. */
  className?: string;
  /** Reserved for task editing; checkboxes are currently disabled. */
  enableTaskCheckbox?: boolean;
}

interface FoldableBlock { label: string; content: string; }
interface FoldableState { blocks: Map<string, FoldableBlock>; }
const stateKey = Symbol('foldableState');

/** Folded fragments inherit the outer parser's extensions and HTML policy. */
export class FoldablePlugin implements MDxPlugin {
  name = 'feature:foldable';
  private options: { defaultOpen: boolean; className: string };
  private cleanupFns: Array<() => void> = [];

  constructor(options: FoldablePluginOptions = {}) {
    this.options = { defaultOpen: options.defaultOpen !== false,
      className: options.className || 'mdx-editor-foldable' };
  }

  private extract(markdown: string, state: FoldableState): string {
    const nonce = Math.random().toString(36).slice(2);
    const pattern = /^::>[^\S\n]*(?:\[([ xX])]\s*)?(.*)\n?((?:^[ \t]{4,}.*\n?|^\s*\n)*)/gm;
    return markdown.replace(pattern, (_match, _checkmark, label: string, content: string) => {
      const placeholder = `MDXFOLDABLE${nonce}BLOCK${state.blocks.size}`;
      state.blocks.set(placeholder, { label: label.trim(), content });
      return `\n\n${placeholder}\n\n`;
    });
  }

  private async renderBlock(context: PluginContext, block: FoldableBlock, options: any): Promise<string> {
    const content = block.content.split('\n').map(line => line.replace(/^[ \t]{0,4}/, '')).join('\n').trim();
    const html = await context.renderMarkdown(content, options);
    const className = escapeHTML(this.options.className);
    return `<details data-mdx-disclosure class="${className}" ${this.options.defaultOpen ? 'open' : ''}>
      <summary class="${className}__summary">${escapeHTML(block.label)}</summary>
      <div class="${className}__content">${html}</div>
    </details>`;
  }

  private async restore(context: PluginContext, html: string, options: any): Promise<{ html: string; options: any }> {
    const state: FoldableState | undefined = options?.[stateKey];
    for (const [placeholder, block] of state?.blocks ?? []) {
      const markup = await this.renderBlock(context, block, options);
      // Replace only the generated paragraph, never literal text elsewhere in the document.
      html = html.replace(`<p>${placeholder}</p>`, () => markup);
    }
    return { html, options };
  }

  install(context: PluginContext): void {
    this.cleanupFns.push(context.on('beforeParse', ({ markdown, options }: { markdown: string; options: any }) => {
      const state: FoldableState = { blocks: new Map() };
      return { markdown: this.extract(markdown, state), options: { ...options, [stateKey]: state } };
    }));
    this.cleanupFns.push(context.on('afterRender', ({ html, options }: { html: string; options: any }) =>
      this.restore(context, html, options)));
  }

  destroy(): void {
    this.cleanupFns.forEach(cleanup => cleanup());
    this.cleanupFns = [];
  }
}

import {lexer} from 'marked';
import type {MDxEditor} from '../../editor/mdx-editor';
import type {PluginContext} from '../../core/types';
import type {AiChatHost} from './ai-chat.contracts';
import {randomUUID} from '../../utils/random';
import {AI_CHAT_ICON} from './ai-chat-icons';

function visibleText(node: ParentNode): string {
  const copy = node.cloneNode(true) as ParentNode;
  copy.querySelectorAll?.('.mdx-ai-chat').forEach(element => element.replaceChildren());
  return copy.textContent ?? '';
}
function topBlock(node: Node, root: HTMLElement): HTMLElement | undefined {
  let element = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement;
  while (element && element.parentElement !== root) element = element.parentElement;
  return element?.parentElement === root ? element : undefined;
}

/** Measure the active selection endpoint, preserving backward selections. */
function selectionCaretRect(selection: Selection, range: Range): DOMRect | undefined {
  if (!selection.focusNode) return;
  const caret = range.cloneRange();
  caret.setStart(selection.focusNode, selection.focusOffset); caret.collapse(true);
  const rect = caret.getBoundingClientRect?.();
  if (rect && rect.height > 0) return rect;
  // Element boundaries may have no caret box; use the endpoint's visual line.
  const rects = Array.from(range.getClientRects?.() ?? []);
  const backward = selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset;
  const line = backward ? rects[0] : rects.at(-1);
  if (line) return new DOMRect(backward ? line.left : line.right, line.top, 0, line.height);
}

/** Match rendered context, then prove an insertion position by rendering a harmless sentinel.
 * Repeated paragraphs use their DOM occurrence; unsupported transforms fail instead of guessing. */
export async function locateAiChatInsertion(markdown: string, range: Range, root: HTMLElement,
  render: (text: string) => Promise<string>): Promise<number> {
  const block = topBlock(range.endContainer, root);
  if (!block || !root.contains(range.startContainer)) throw new Error('请重新选择文档中的文字');
  const element = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer as Element : range.endContainer.parentElement;
  if (element?.closest('pre, code, button, input, textarea, .mdx-ai-chat')) throw new Error('请在普通 Markdown 正文中选择文字');
  const expected = visibleText(block), prefixRange = document.createRange();
  prefixRange.selectNodeContents(block); prefixRange.setEnd(range.endContainer, range.endOffset);
  const prefix = visibleText(prefixRange.cloneContents());
  const occurrence = [...root.children].slice(0, [...root.children].indexOf(block))
    .filter(previous => previous.tagName === block.tagName && visibleText(previous) === expected).length;
  let cursor = 0, matched = 0;
  for (const token of lexer(markdown)) {
    const from = markdown.indexOf(token.raw, cursor); if (from < 0) continue;
    cursor = from + token.raw.length;
    const fragment = document.createElement('div'); fragment.innerHTML = await render(token.raw);
    if (fragment.children.length !== 1 || fragment.firstElementChild?.tagName !== block.tagName
      || visibleText(fragment.firstElementChild) !== expected || matched++ !== occurrence) continue;
    const sentinel = `MDXAIPOS${randomUUID().replaceAll('-', '')}`;
    let insertion: number | undefined;
    for (let offset = 0; offset <= token.raw.length; offset++) {
      const last = token.raw[offset - 1], final = prefix.at(-1);
      if (prefix.length && last !== final && last !== ';' && !/[*_~\])]/.test(last ?? '')) continue;
      fragment.innerHTML = await render(token.raw.slice(0, offset) + sentinel + token.raw.slice(offset));
      const text = visibleText(fragment.firstElementChild ?? fragment), at = text.indexOf(sentinel);
      if (at === prefix.length && text.replace(sentinel, '') === expected) insertion = from + offset;
    }
    if (insertion !== undefined) return insertion;
    break;
  }
  throw new Error('无法准确定位选区的 Markdown 源码，请在普通段落中重新选择');
}

/** One render-only action, provided by the floating selection menu. */
export class AiChatSelectionActions {
  private editor?: MDxEditor;
  private root?: HTMLElement;
  private range?: Range;
  private text = '';
  private busy = false;
  private disposed = false;
  private popup?: HTMLButtonElement;
  private cleanups: Array<() => void> = [];
  constructor(private context: PluginContext, private host: AiChatHost, private signal: () => AbortSignal, private inserted: (source: {anchorId: string; documentPath?: string; defaultPrompt: string}, selection: string) => void) {
    this.cleanups.push(context.on('editorPostInit', ({editor}: {editor: MDxEditor}) => this.mount(editor)));
  }
  private mount(editor: MDxEditor): void {
    this.editor = editor;
    if (!editor.container) return;
    this.root = editor.container.querySelector<HTMLElement>('.mdx-editor-container__render-mode') ?? undefined;
    const popup = this.popup = document.createElement('button'); popup.type = 'button'; popup.hidden = true;
    popup.className = 'mdx-ai-selection'; popup.innerHTML = AI_CHAT_ICON; popup.title = '为选区插入 AI'; popup.setAttribute('aria-label', popup.title);
    document.body.append(popup);
    const preserve = (event: Event) => event.preventDefault();
    popup.addEventListener('pointerdown', preserve);
    popup.onclick = () => {void this.insert();};
    const update = () => this.update(); document.addEventListener('selectionchange', update);
    document.addEventListener('scroll', update, true); window.addEventListener('resize', update);
    const mode = editor.on('modeChanged', update); this.cleanups.push(mode);
    this.cleanups.push(() => document.removeEventListener('selectionchange', update),
      () => document.removeEventListener('scroll', update, true), () => window.removeEventListener('resize', update));
    this.update();
  }
  private update(): void {
    if (this.disposed || !this.editor || !this.root) return;
    const selection = document.getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
    const allowed = !this.busy && !this.editor.config.readOnly && this.editor.getMode() === 'render';
    const valid = allowed && range && !range.collapsed && this.root.contains(range.commonAncestorContainer)
      && !(range.startContainer.parentElement?.closest('.mdx-ai-chat') || range.endContainer.parentElement?.closest('.mdx-ai-chat'));
    this.range = valid ? range.cloneRange() : undefined;
    this.text = valid ? this.editor.getText() : '';
    if (!this.popup) return;
    this.popup.hidden = !this.range;
    if (this.range && selection) {
      const rect = selectionCaretRect(selection, this.range);
      if (!rect) {this.popup.hidden = true; return;}
      this.popup.style.left = `${Math.max(8, Math.min(rect.right, innerWidth - 44))}px`;
      this.popup.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - 44))}px`;
    }
  }
  private async insert(): Promise<void> {
    const range = this.range?.cloneRange(), editor = this.editor, root = this.root, expected = this.text, signal = this.signal();
    if (this.busy || !range || !editor || !root || editor.getMode() !== 'render' || editor.config.readOnly) return;
    this.busy = true; if (this.popup) this.popup.hidden = true;
    const anchorId = randomUUID(), documentPath = this.context.getDocumentPath();
    try {
      const selection = visibleText(range.cloneContents()); if (!selection.trim()) return;
      const at = await locateAiChatInsertion(expected, range, root, text => this.context.renderMarkdown(text));
      signal.throwIfAborted();
      if (editor.getText() !== expected || editor.getMode() !== 'render') throw new Error('文档或模式已改变，请重新选择');
      const source = {anchorId, documentPath, defaultPrompt: selection};
      await this.host.createAnchor!({source, selection, signal});
      signal.throwIfAborted();
      if (editor.getMode() !== 'render') throw new Error('模式已改变，请重新选择');
      this.inserted(source, selection);
      if (!editor.applySourceEdit(at, at, `::@${anchorId}@`, expected)) throw new Error('文档已改变，请重新选择');
      document.getSelection()?.removeAllRanges();
    } catch (error) {
      if (!signal.aborted) this.context.notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {this.busy = false; this.update();}
  }
  destroy(): void {this.disposed = true; this.cleanups.splice(0).forEach(close => close()); this.popup?.remove();}
}

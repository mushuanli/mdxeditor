// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {AiChatSelectionActions} from '../src/plugins/interactions/ai-chat-selection';
import type {PluginContext} from '../src/core/types';
import type {MDxEditor} from '../src/editor/mdx-editor';

let actions: AiChatSelectionActions | undefined;
afterEach(() => {
  actions?.destroy(); document.getSelection()?.removeAllRanges();
  document.body.replaceChildren(); vi.restoreAllMocks();
});

function mount(backward = false): HTMLButtonElement {
  const container = document.createElement('div');
  container.innerHTML = '<div class="mdx-editor-container__render-mode"><p>First long line</p><p>Short</p></div>';
  document.body.append(container);
  const nodes = container.querySelectorAll('p'), selection = document.getSelection()!;
  selection.setBaseAndExtent(nodes[backward ? 1 : 0].firstChild!, backward ? 3 : 2,
    nodes[backward ? 0 : 1].firstChild!, backward ? 2 : 3);
  let ready: (payload: {editor: MDxEditor}) => void = () => {};
  const context = {on: (_event: string, callback: typeof ready) => {ready = callback; return () => {};}};
  actions = new AiChatSelectionActions(context as unknown as PluginContext,
    {listTargets: () => [], onSubmit: async () => {}}, () => new AbortController().signal, () => {});
  ready({editor: {container, config: {}, getMode: () => 'render', getText: () => 'text', on: () => () => {}} as unknown as MDxEditor});
  return document.querySelector<HTMLButtonElement>('.mdx-ai-selection')!;
}

it.each([false, true])('positions at the active caret across lines (backward=%s)', backward => {
  const measure = vi.fn(function (this: Range) {
    if (!this.collapsed) return new DOMRect(10, 20, 700, 100);
    return this.startContainer.textContent === 'Short' ? new DOMRect(60, 100, 0, 20) : new DOMRect(30, 20, 0, 20);
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {configurable: true, writable: true, value: measure});
  const popup = mount(backward);
  expect(popup.hidden).toBe(false);
  expect(popup.style.left).toBe(backward ? '30px' : '60px');
  expect(popup.style.top).toBe(backward ? '46px' : '126px');
  expect(document.getSelection()!.toString()).toBe('rst long lineSho');
  measure.mockReturnValue(new DOMRect(90, 50, 0, 20));
  document.querySelector('p')!.dispatchEvent(new Event('scroll'));
  expect(popup.style.top).toBe('76px');
  measure.mockReturnValue(new DOMRect(110, 70, 0, 20));
  window.dispatchEvent(new Event('resize'));
  expect(popup.style.left).toBe('110px');
  actions!.destroy(); measure.mockClear(); window.dispatchEvent(new Event('resize'));
  expect(measure).not.toHaveBeenCalled();
});

it.each([false, true])('uses the endpoint line when a caret box is unavailable (backward=%s)', backward => {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {configurable: true, value: () => new DOMRect()});
  Object.defineProperty(Range.prototype, 'getClientRects', {configurable: true,
    value: () => [new DOMRect(30, 20, 600, 20), new DOMRect(10, 100, 50, 20)]});
  const popup = mount(backward);
  expect(popup.style.left).toBe(backward ? '30px' : '60px');
  expect(popup.style.top).toBe(backward ? '46px' : '126px');
});

it('hides the popup when no selection geometry is available', () => {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {configurable: true, value: () => new DOMRect()});
  Object.defineProperty(Range.prototype, 'getClientRects', {configurable: true, value: () => []});
  expect(mount().hidden).toBe(true);
});

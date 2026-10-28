// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {marked} from 'marked';
import {MDxRenderer} from '../src/renderer/mdx-renderer';
import {AiChatPlugin} from '../src/plugins/interactions/ai-chat.plugin';
import {aiChatAnchorIds, legacyAiChatLocations} from '../src/plugins/interactions/ai-chat-markers';
import {builtinTokenizer, workerSyntax, lexicalExtension} from '../src/renderer/worker-tokenizers';
import {locateAiChatInsertion} from '../src/plugins/interactions/ai-chat-selection';

const renderers: MDxRenderer[] = [];
afterEach(() => {renderers.splice(0).forEach(r => r.destroy()); document.body.replaceChildren();});

it('extracts distinct authored anchors while excluding literal code and HTML', () => {
  expect(workerSyntax([lexicalExtension('mdxAiChatAnchor')])).toEqual(['mdxAiChatAnchor']);
  expect(builtinTokenizer('mdxAiChatAnchor')('::@anchor@ text')).toMatchObject({anchorId: 'anchor', raw: '::@anchor@'});
  expect(aiChatAnchorIds('Before ::@a@ and ::@b@ ::@a@\n\n`::@code@`\n\n```md\n::@fence@\n```\n\n<div>\n::@html@\n</div>')).toEqual(['a', 'b']);
  expect(legacyAiChatLocations('::@ ask\n\n```md\n::@ code\n```')).toEqual([{from: 0, to: 9, prompt: 'ask'}]);
});

it('locates rich text selections by source context, including repeated paragraphs', async () => {
  const source = 'Hello **world** again.\n\nHello **world** again.\n';
  const root = document.createElement('div'); root.innerHTML = await marked.parse(source);
  const range = document.createRange(), text = root.querySelectorAll('strong')[1].firstChild!;
  range.setStart(text, 0); range.setEnd(text, 5);
  const at = await locateAiChatInsertion(source, range, root, text => Promise.resolve(marked.parse(text)));
  expect(at).toBe(source.lastIndexOf('world') + 7);
  expect(source.slice(0, at) + '::@id@' + source.slice(at)).toContain('**world**::@id@');
});

it('keeps independent mini icons, previews the initial response and releases observers', async () => {
  const stop = vi.fn(), open = vi.fn(async () => {}), submit = vi.fn(async () => {});
  let markdown = '**Initial**\n\n<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)\n\n::@nested@';
  const observers: Array<() => void> = [];
  const read = vi.fn(async ({includeResponse}: {includeResponse?: boolean}) => ({status: 'bound' as const,
    response: includeResponse ? {id: 'first-reply', markdown} : undefined}));
  const renderer = new MDxRenderer({htmlPolicy: 'literal'}); renderers.push(renderer);
  renderer.usePlugin(new AiChatPlugin({host: {listTargets: () => [{kind: 'agent', id: 'default', label: 'Default'}],
    onSubmit: submit, getAnchor: read, openConversation: open, observeAnchor: (_context, changed) => {observers.push(changed); return stop;}}}));
  const root = document.createElement('div'); document.body.append(root);
  await renderer.render(root, 'One ::@first@ two ::@second@.');
  const panels = root.querySelectorAll<HTMLElement>('.mdx-ai-chat');
  expect(panels).toHaveLength(2);
  expect(read).not.toHaveBeenCalled(); expect(observers).toHaveLength(0);
  expect(panels[0].querySelector('form')!.hidden).toBe(true);
  panels[0].querySelector<HTMLButtonElement>('.mdx-ai-chat__toggle')!.click();
  expect(panels[0].querySelector('form')!.hidden).toBe(false);
  expect(panels[1].querySelector('form')!.hidden).toBe(true);
  const input = panels[0].querySelector('textarea')!; input.value = 'Question\nsecond line'; input.dispatchEvent(new Event('input'));
  panels[0].querySelector('form')!.dispatchEvent(new Event('submit', {cancelable: true}));
  await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
  expect(submit.mock.calls[0][0]).toMatchObject({prompt: 'Question\nsecond line', source: {anchorId: 'first'}});
  await vi.waitFor(() => expect(panels[0].querySelector<HTMLElement>('.mdx-ai-chat__response')!.hidden).toBe(false));
  await vi.waitFor(() => expect(panels[0].querySelector('.mdx-ai-chat__response-body strong')?.textContent).toBe('Initial'));
  const body = panels[0].querySelector('.mdx-ai-chat__response-body')!;
  expect(body.querySelector('script, .mdx-ai-chat')).toBeNull(); expect(body.querySelector('a')?.hasAttribute('href')).toBe(false);
  markdown += '\n\nMore streamed text'; observers[0]();
  await vi.waitFor(() => expect(body.textContent).toContain('More streamed text'));
  expect(body.querySelector('strong')?.textContent).toBe('Initial');
  panels[0].querySelector<HTMLButtonElement>('.mdx-ai-chat__open')!.click();
  expect(open.mock.calls[0][0]).toMatchObject({source: {anchorId: 'first'}});
  renderer.destroy(); expect(stop).toHaveBeenCalledTimes(1);
});

it('inserts through the normal editor transaction only in writable render mode', async () => {
  const {createMDxEditor} = await import('../src/factory');
  Object.defineProperty(Range.prototype, 'getClientRects', {configurable: true, value: () => []});
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {configurable: true, value: () => new DOMRect(0, 0, 0, 20)});
  vi.stubGlobal('matchMedia', () => ({matches: false, addEventListener() {}, removeEventListener() {}}));
  const create = vi.fn(async () => {}), root = document.createElement('div'); document.body.append(root);
  const editor = await createMDxEditor(root, {initialMode: 'render', initialContent: 'Selected **words**.', onSave: async () => {},
    plugins: ['editor:core', 'ui:toolbar', ['interaction:ai-chat', {host: {createAnchor: create,
      listTargets: () => [{kind: 'agent', id: 'default', label: 'Default'}], getAnchor: async () => ({status: 'bound', response: {id: 'first', markdown: 'Reply text'}}), onSubmit: async () => {}}}]]});
  try {
    const text = root.querySelector('.mdx-editor-container__render-mode strong')!.firstChild!;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 5);
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange'));
    const button = document.querySelector<HTMLButtonElement>('.mdx-ai-selection')!; expect(button.hidden).toBe(false); button.click();
    await vi.waitFor(() => expect(editor.getText()).toMatch(/words\*\*::@[\w-]+@/));
    expect(editor.getMode()).toBe('render'); expect(editor.isDirty()).toBe(true); expect(create.mock.calls[0][0]).toMatchObject({selection: 'words'});
    await vi.waitFor(() => expect(root.querySelector('.mdx-ai-chat__toggle')).not.toBeNull());
    expect(root.querySelector<HTMLFormElement>('.mdx-ai-chat form')!.hidden).toBe(false);
    expect(root.querySelector('textarea')!.value).toBe('words');
    expect(document.activeElement).toBe(root.querySelector('textarea'));
    expect(create.mock.calls[0][0]).toMatchObject({source: {defaultPrompt: 'words'}});
    root.querySelector<HTMLButtonElement>('.mdx-ai-chat__preview-toggle')!.click();
    await vi.waitFor(() => expect(root.querySelector('.mdx-ai-chat__response-body p')).not.toBeNull());
    range.selectNodeContents(root.querySelector('.mdx-ai-chat__response-body p')!);
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange'));
    expect(button.hidden).toBe(true);
    await editor.switchToMode('edit'); expect(button.hidden).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-button-id="ai-chat-insert"]')!.hidden).toBe(true);
  } finally {document.getSelection()?.removeAllRanges(); await editor.destroy(); vi.unstubAllGlobals();}
});

it('promotes a legacy row only on send, preserves spacing and retries with the same anchor and operation', async () => {
  const {createMDxEditor} = await import('../src/factory');
  vi.stubGlobal('matchMedia', () => ({matches: false, addEventListener() {}, removeEventListener() {}}));
  const create = vi.fn(async () => {}), submit = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
  const root = document.createElement('div'); document.body.append(root);
  const editor = await createMDxEditor(root, {initialMode: 'render', initialContent: '::@ Ask\n\nNext paragraph.', onSave: async () => {},
    plugins: ['editor:core', ['interaction:ai-chat', {host: {createAnchor: create, listTargets: () => [{kind: 'agent', id: 'default', label: 'Default'}], onSubmit: submit}}]]});
  try {
    expect(create).not.toHaveBeenCalled(); root.querySelector('form')!.dispatchEvent(new Event('submit', {cancelable: true}));
    await vi.waitFor(() => expect(root.textContent).toContain('offline'));
    expect(editor.getMode()).toBe('render');
    const id = submit.mock.calls[0][0].source.anchorId;
    expect(editor.getText()).toBe(`::@${id}@\n\nNext paragraph.`);
    expect(create.mock.calls[0][0]).toMatchObject({selection: '', source: {defaultPrompt: 'Ask'}});
    root.querySelector('form')!.dispatchEvent(new Event('submit', {cancelable: true}));
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][0].operationId).toBe(submit.mock.calls[0][0].operationId);
    expect(submit.mock.calls[1][0].source.anchorId).toBe(id); expect(create).toHaveBeenCalledOnce(); expect(editor.isDirty()).toBe(true);
  } finally {await editor.destroy(); vi.unstubAllGlobals();}
});

it('does not acquire AI targets, anchor data or observers when merely rendering a file', async () => {
  const listTargets = vi.fn(async () => [{kind:'agent' as const,id:'default',label:'Default'}]), getAnchor = vi.fn(async()=>({status:'unbound' as const})), observeAnchor = vi.fn(()=>()=>{});
  const renderer = new MDxRenderer(); renderers.push(renderer);
  renderer.usePlugin(new AiChatPlugin({host:{listTargets,getAnchor,observeAnchor,onSubmit:async()=>{}}}));
  const root = document.createElement('div'); document.body.append(root);
  await renderer.render(root,'Ordinary text ::@a@\n\n::@ default prompt');
  expect(listTargets).not.toHaveBeenCalled(); expect(getAnchor).not.toHaveBeenCalled(); expect(observeAnchor).not.toHaveBeenCalled();
  root.querySelector<HTMLButtonElement>('.mdx-ai-chat__toggle')!.click();
  await vi.waitFor(()=>expect(listTargets).toHaveBeenCalledOnce()); expect(observeAnchor).toHaveBeenCalledOnce();
});


it('auto-expands accepted replies and follows actual generation status through completion or failure', async () => {
  let markdown = '', status: 'pending' | 'completed' | 'failed' = 'pending', operationId: string | undefined;
  let changed = () => {};
  const renderer = new MDxRenderer(); renderers.push(renderer);
  renderer.usePlugin(new AiChatPlugin({host: {
    listTargets: () => [{kind: 'agent', id: 'default', label: 'Default'}],
    onSubmit: async request => {operationId = request.operationId;},
    getAnchor: async ({includeResponse}) => ({status: 'bound', response: includeResponse ? {id: 'initial', markdown: 'Initial response'} : undefined,
      activity: operationId ? {id: 'latest', operationId, status, markdown: includeResponse ? markdown : undefined} : undefined}),
    observeAnchor: (_source, callback) => {changed = callback; return () => {};},
  }}));
  const root = document.createElement('div'); document.body.append(root);
  await renderer.render(root, '::@activity@');
  root.querySelector<HTMLButtonElement>('.mdx-ai-chat__toggle')!.click();
  const input = root.querySelector('textarea')!; input.value = 'Ask'; input.dispatchEvent(new Event('input'));
  root.querySelector('form')!.dispatchEvent(new Event('submit', {cancelable: true}));
  const send = root.querySelector<HTMLButtonElement>('[type="submit"]')!;
  await vi.waitFor(() => expect(send.dataset.state).toBe('waiting'));
  expect(root.querySelector<HTMLElement>('.mdx-ai-chat__response')!.hidden).toBe(false);
  expect(root.textContent).toContain('等待回复');
  markdown = '**Partial** response'; changed();
  await vi.waitFor(() => expect(send.dataset.state).toBe('responding'));
  await vi.waitFor(() => expect(root.querySelector('.mdx-ai-chat__response-body strong')?.textContent).toBe('Partial'));
  status = 'completed'; changed();
  await vi.waitFor(() => expect(send.dataset.state).toBe('completed'));
  expect(root.textContent).toContain('回复完成');
  root.querySelector<HTMLButtonElement>('.mdx-ai-chat__history')!.click();
  await vi.waitFor(() => expect(root.querySelector('.mdx-ai-chat__response-body')?.textContent).toContain('Initial response'));
  status = 'failed'; changed();
  await vi.waitFor(() => expect(send.dataset.state).toBe('failed'));
  expect(root.textContent).toContain('回复失败');
});

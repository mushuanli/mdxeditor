// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { MDxRenderer } from '../src/renderer/mdx-renderer';
import { AiChatPlugin } from '../src/plugins/interactions/ai-chat.plugin';
import type { AiChatHost } from '../src/plugins/interactions/ai-chat.contracts';
import { builtinTokenizer, workerSyntax, lexicalExtension } from '../src/renderer/worker-tokenizers';

const renderers: MDxRenderer[] = [];
afterEach(() => { renderers.splice(0).forEach(renderer => renderer.destroy()); document.body.replaceChildren(); });
const target = { kind: 'flow' as const, id: 'flow-1', label: 'Review' };
function setup(overrides: Partial<AiChatHost> = {}) {
  const onSubmit = vi.fn().mockResolvedValue({ branchId: 'branch-1' });
  const host: AiChatHost = { listTargets: () => [target], onSubmit, ...overrides };
  const renderer = new MDxRenderer({ htmlPolicy: 'literal' });
  renderer.usePlugin(new AiChatPlugin({ host }));
  renderers.push(renderer);
  const root = document.createElement('div'); document.body.append(root);
  return { renderer, root, onSubmit };
}
const input = (root: HTMLElement) => root.querySelector<HTMLInputElement>('.mdx-ai-chat__prompt')!;

async function activate(root: HTMLElement) {
  root.querySelector('textarea')!.dispatchEvent(new Event('focusin', {bubbles: true}));
  await vi.waitFor(() => expect(root.querySelector('form')!.getAttribute('aria-busy')).toBe('false'));
}

function submit(root: HTMLElement) { root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); }

it('recognizes a standalone marker and escapes the default prompt, excluding fences and inline text', async () => {
  const { renderer, root } = setup();
  await renderer.render(root, 'Text\n::@  <img src=x onerror=alert(1)>\nNext\n\n```md\n::@ code\n```\n\ninline ::@ text\n\n::@invalid\n\n::@');
  expect(root.querySelectorAll('form')).toHaveLength(2);
  expect(input(root).value).toBe('<img src=x onerror=alert(1)>');
  expect(root.querySelector('img')).toBeNull();
  expect(root.querySelector('code')!.textContent).toContain('::@ code');
  expect(root.textContent).toContain('Next');
});

it('hands files, target and draft to the host once, with retry after failure', async () => {
  let resolve!: () => void;
  const onSubmit = vi.fn().mockRejectedValueOnce(new Error('Try again'))
    .mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  const file = new File(['hello'], 'note.txt');
  const { renderer, root } = setup({ onSubmit, pickAttachments: async () => [{ kind: 'file', file }] });
  await renderer.render(root, '::@ default');
  input(root).value = 'changed'; input(root).dispatchEvent(new Event('input'));
  root.querySelector<HTMLButtonElement>('.mdx-ai-chat__attach')!.click();
  await vi.waitFor(() => expect(root.textContent).toContain('note.txt'));
  submit(root);
  await vi.waitFor(() => expect(root.textContent).toContain('Try again'));
  submit(root); submit(root);
  expect(onSubmit).toHaveBeenCalledTimes(2);
  expect(onSubmit.mock.calls[1][0]).toMatchObject({ prompt: 'changed', target,
    attachments: [{ kind: 'file', file }], source: { defaultPrompt: 'default' } });
  resolve();
  await vi.waitFor(() => expect(root.textContent).toContain('已发送'));
  expect(root.textContent).not.toContain('note.txt');
  expect(input(root).value).toBe('changed');
});

it('retains independent drafts across streaming updates and aborts host work on destroy', async () => {
  const listTargets = vi.fn().mockResolvedValue([target]);
  const { renderer, root, onSubmit } = setup({ listTargets });
  await renderer.renderStreaming(root, '::@ first\n\n::@ second');
  await activate(root);
  input(root).value = 'draft'; input(root).dispatchEvent(new Event('input'));
  await renderer.renderStreaming(root, '::@ first\n\n::@ second\n\nmore');
  expect(input(root).value).toBe('draft');
  expect(root.querySelectorAll('form')).toHaveLength(2);
  expect(listTargets).toHaveBeenCalledTimes(1);
  submit(root);
  const signal = onSubmit.mock.calls[0][0].signal;
  renderer.destroy();
  expect(signal.aborted).toBe(true);
});

it('handles target errors, empty targets and empty prompts without sending', async () => {
  const { renderer, root, onSubmit } = setup({ listTargets: async () => [] });
  await renderer.render(root, '::@');
  await activate(root); submit(root);
  expect(onSubmit).not.toHaveBeenCalled();
  expect(root.textContent).toContain('没有可用');
  const failed = setup({ listTargets: async () => { throw new Error('offline'); } });
  await failed.renderer.render(failed.root, '::@ hi'); await activate(failed.root);
  expect(failed.root.textContent).toContain('offline');
});

it('registers the same grammar for worker parsing', () => {
  expect(workerSyntax([lexicalExtension('mdxAiChat')])).toEqual(['mdxAiChat']);
  expect(builtinTokenizer('mdxAiChat')('::@ hello\nnext')).toMatchObject({ prompt: 'hello', raw: '::@ hello\n' });
});

it('shows the current target as clickable text, selects another target and keeps its draft', async () => {
  const current = {kind: 'agent' as const, id: 'current', label: 'Current agent'};
  const {renderer, root, onSubmit} = setup({listTargets: () => [target, current],
    getDefaultTarget: () => ({kind: 'agent', id: 'current'})});
  await renderer.render(root, '::@ ask'); await activate(root);
  const picker = root.querySelector<HTMLDetailsElement>('.mdx-ai-chat__target-picker')!;
  expect(root.querySelector('select')).toBeNull();
  expect(picker.querySelector('summary')!.textContent).toBe('Current agent');
  expect(picker.open).toBe(false);
  picker.open = true;
  picker.querySelector<HTMLButtonElement>('button')!.click();
  expect(picker.querySelector('summary')!.textContent).toBe('Review');
  expect(picker.open).toBe(false); expect(input(root).value).toBe('ask');
  submit(root); expect(onSubmit.mock.calls[0][0].target).toEqual(target);
});

it('uses default instead of the first flow when no host preference exists', async () => {
  const agent = {kind: 'agent' as const, id: 'default', label: 'Default'};
  const {renderer, root, onSubmit} = setup({listTargets: () => [target, agent]});
  await renderer.render(root, '::@ ask'); await activate(root); submit(root);
  expect(onSubmit.mock.calls[0][0].target).toEqual(agent);
});

it('accepts pasted images once, retains them on failed submission and leaves text paste native', async () => {
  const onSubmit = vi.fn().mockRejectedValue(new Error('offline'));
  const {renderer, root} = setup({onSubmit}); await renderer.render(root, '::@ ask'); await activate(root);
  const file = new File(['image'], 'clipboard.png', {type: 'image/png'});
  const paste = new Event('paste', {bubbles: true, cancelable: true});
  Object.defineProperty(paste, 'clipboardData', {value: {files: [file], items: [{kind: 'file', getAsFile: () => file}]}});
  input(root).dispatchEvent(paste); expect(paste.defaultPrevented).toBe(true);
  expect(root.textContent).toContain('clipboard.png'); submit(root);
  expect(onSubmit.mock.calls[0][0].attachments).toEqual([{kind: 'file', file}]);
  await vi.waitFor(() => expect(root.textContent).toContain('offline'));
  expect(root.textContent).toContain('clipboard.png');
  const text = new Event('paste', {bubbles: true, cancelable: true});
  Object.defineProperty(text, 'clipboardData', {value: {files: [], items: [{kind: 'string'}]}});
  input(root).dispatchEvent(text); expect(text.defaultPrevented).toBe(false);
  root.querySelector<HTMLButtonElement>('[aria-label="移除附件 clipboard.png"]')!.click();
  expect(root.textContent).not.toContain('clipboard.png');
});

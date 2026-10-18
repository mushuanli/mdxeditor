// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Marked } from 'marked';
import { MDxRenderer } from '../src/renderer/mdx-renderer';
import { PlaygroundPlugin } from '../src/plugins/interactions/playground.plugin';
import { CodeBlockControlsPlugin } from '../src/plugins/interactions/codeblock-controls.plugin';
import { FoldablePlugin } from '../src/plugins/syntax-extensions/foldable.plugin';

const renderers: MDxRenderer[] = [];
afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function setup(controls = false) {
  const renderer = new MDxRenderer({ htmlPolicy: 'literal' });
  renderers.push(renderer);
  if (controls) renderer.usePlugin(new CodeBlockControlsPlugin({ classPrefix: 'custom-code', minLinesThreshold: 1 }));
  renderer.usePlugin(new PlaygroundPlugin({ height: 240 }));
  const root = document.createElement('div');
  document.body.append(root);
  return { renderer, root };
}

const block = (info: string, code: string) => `\`\`\`${info}\n${code}\n\`\`\``;
const panel = (root: HTMLElement) => root.querySelector<HTMLElement>('.mdx-playground')!;
const button = (root: HTMLElement, label: string) => [...panel(root).querySelectorAll('button')]
  .find(button => button.textContent === label)!;
const run = (root: HTMLElement) => button(root, '预览').click();
const rerun = (root: HTMLElement) => button(root, '刷新').click();
const frame = (root: HTMLElement) => root.querySelector<HTMLIFrameElement>('iframe')!;

it('leaves ordinary and unsupported code fences as code', async () => {
  const { renderer, root } = setup();
  const infos = ['html', 'js', 'css', 'js live', 'typescript playground=demo',
    'html playground=', 'html playground=a playground=b', 'html playground="quoted"'];
  await renderer.render(root, infos.map(info => block(info, '<button>source</button>')).join('\n\n'));
  expect(root.querySelectorAll('pre')).toHaveLength(infos.length);
  expect(root.querySelector('.mdx-playground, iframe, button')).toBeNull();
});

it('runs a single marked HTML block only on click, retaining source controls', async () => {
  const { renderer, root } = setup(true);
  const source = '<button id="hello">Hello</button><script>window.example = 1;</script>';
  await renderer.render(root, block('html live', source));
  expect(root.querySelector('script, iframe, #hello')).toBeNull();
  expect(root.querySelector('pre code')!.textContent).toBe(source);
  expect(panel(root).parentElement).toBe(root);
  expect(panel(root).nextElementSibling).toBe(root.querySelector('.custom-code-wrapper'));
  expect(root.querySelector('[title="Copy code"]')).not.toBeNull();
  expect(root.querySelector('.custom-code-controls__button--collapse')).not.toBeNull();
  const sourceElement = root.querySelector('.custom-code-wrapper')!;
  const collapse = root.querySelector('.custom-code-controls__button--collapse');
  const initialClasses = sourceElement.className;
  expect([...panel(root).querySelectorAll('button')].slice(0, 3).map(button => button.textContent))
    .toEqual(['预览', '刷新', '代码']);
  expect(button(root, '刷新').disabled).toBe(true);
  expect(panel(root).querySelectorAll('[data-mdx-code-actions] button')).toHaveLength(3);
  expect(sourceElement.querySelector('[data-mdx-code-actions]')).toBeNull();
  expect(button(root, '代码').getAttribute('aria-pressed')).toBe('true');
  button(root, '代码').click();
  expect(root.querySelector('iframe')).toBeNull();
  run(root);
  const first = frame(root);
  expect(first.srcdoc).toContain(source);
  expect(first.getAttribute('sandbox')).toBe('allow-scripts');
  expect(first.referrerPolicy).toBe('no-referrer');
  expect(first.style.height).toBe('240px');
  expect(first.srcdoc.indexOf('Content-Security-Policy')).toBeLessThan(first.srcdoc.indexOf(source));
  expect(first.srcdoc).toContain("connect-src 'none'");
  expect(first.srcdoc).toContain("base-uri 'none'");
  expect(sourceElement.hasAttribute('data-mdx-playground-hidden')).toBe(true);
  expect(button(root, '预览').getAttribute('aria-pressed')).toBe('true');
  expect(panel(root).querySelector<HTMLElement>('.mdx-playground__actions')!.hidden).toBe(true);
  expect(button(root, '刷新').disabled).toBe(false);
  button(root, '代码').click();
  expect(sourceElement.hasAttribute('data-mdx-playground-hidden')).toBe(false);
  expect(first.hidden).toBe(true);
  expect(panel(root).querySelector<HTMLElement>('.mdx-playground__actions')!.hidden).toBe(false);
  expect(frame(root)).toBe(first);
  expect(sourceElement.className).toBe(initialClasses);
  expect(root.querySelector('.custom-code-controls__button--collapse')).toBe(collapse);
  run(root);
  expect(frame(root)).toBe(first);
  expect(first.hidden).toBe(false);
  rerun(root);
  expect(frame(root)).not.toBe(first);
  expect(first.isConnected).toBe(false);
  button(root, '代码').click();
  expect(frame(root).hidden).toBe(true);
  expect(sourceElement.hasAttribute('data-mdx-playground-hidden')).toBe(false);
  expect(button(root, '代码').getAttribute('aria-pressed')).toBe('true');
  expect(panel(root).querySelector('[role="status"]')!.textContent).toBe('预览已保留');
});

it('combines only matching groups in source order, with independent live examples', async () => {
  const { renderer, root } = setup();
  await renderer.render(root, [
    block('html playground=demo', '<button id="one">One</button>'),
    'An explanation between sources.',
    block('css playground=demo', '#one { color: red; }'),
    block('html playground=other', '<div>Other example</div>'),
    block('javascript playground=demo', 'window.first = 1;'),
    block('js playground=demo', 'window.second = 2;'),
    block('html live', '<p>Standalone A</p>'),
    block('html live', '<p>Standalone B</p>'),
  ].join('\n\n'));
  expect(root.querySelectorAll('.mdx-playground')).toHaveLength(4);
  run(root);
  const doc = frame(root).srcdoc;
  expect(doc).toContain('<button id="one">One</button>');
  expect(doc).toContain('#one { color: red; }');
  expect(doc).toContain('window.first = 1;');
  expect(doc.indexOf('window.first')).toBeLessThan(doc.indexOf('window.second'));
  expect(doc).not.toMatch(/Other example|Standalone/);
});

it('keeps script/style terminators in separate source blocks out of the HTML parser', async () => {
  const { renderer, root } = setup();
  await renderer.render(root, [block('html playground=demo', '<div id="result"></div>'),
    block('js playground=demo', 'document.querySelector("#result").textContent = "</script><img src=x>";'),
    block('css playground=demo', 'div::after { content: "</style><script>bad()</script>"; }'),
  ].join('\n\n'));
  run(root);
  expect(frame(root).srcdoc).toContain('\\u003c/script>');
  expect(frame(root).srcdoc).toContain('\\u003c/style>');
  expect(frame(root).srcdoc).not.toContain('<img src=x>');
  const parsed = new DOMParser().parseFromString(frame(root).srcdoc, 'text/html');
  expect(parsed.querySelectorAll('script')).toHaveLength(2);
  expect(parsed.querySelector('img')).toBeNull();
});

it('resolves grouped fences inside folded fragments under the literal HTML policy', async () => {
  const { renderer, root } = setup();
  renderer.usePlugin(new FoldablePlugin());
  const folded = block('js playground=demo', 'document.querySelector("button").textContent = "Changed";')
    .split('\n').map(line => `    ${line}`).join('\n');
  await renderer.render(root, block('html playground=demo', '<button>Original</button>') +
    '\n\n::> Script\n' + folded + '\n');
  expect(root.querySelectorAll('.mdx-playground')).toHaveLength(1);
  run(root);
  expect(frame(root).srcdoc).toContain('Changed');
  expect(root.querySelector('script')).toBeNull();
});

it('retains a running frame during streaming and marks changed grouped sources stale', async () => {
  const { renderer, root } = setup();
  const html = block('html playground=demo', '<p>Demo</p>');
  const js = block('js playground=demo', 'window.count = 1;');
  await renderer.renderStreaming(root, html + '\n\n' + js);
  run(root);
  const first = frame(root);
  await renderer.renderStreaming(root, html + '\n\n' + block('js playground=demo', 'window.count = 2;'));
  expect(frame(root)).toBe(first);
  expect(first.srcdoc).toContain('window.count = 1;');
  expect(panel(root).querySelector('[role="status"]')!.textContent).toContain('代码已更新');
  rerun(root);
  expect(frame(root).srcdoc).toContain('window.count = 2;');
  expect(root.querySelectorAll('.mdx-playground')).toHaveLength(1);
  await renderer.finishStreaming(root, html + '\n\n' + js);
  expect(first.isConnected).toBe(false);
  expect(root.querySelectorAll('.mdx-playground')).toHaveLength(1);
  expect(root.querySelector('iframe')).toBeNull();
});

it('prunes deleted sources even when streaming truncation has no new DOM hook', async () => {
  const { renderer, root } = setup();
  const html = block('html playground=demo', '<p>Demo</p>');
  await renderer.renderStreaming(root, html + '\n\n' + block('js playground=demo', 'window.extra = true;'));
  run(root);
  const first = frame(root);
  await renderer.renderStreaming(root, html);
  await vi.waitFor(() => expect(panel(root).querySelector('[role="status"]')!.textContent).toContain('代码已更新'));
  expect(frame(root)).toBe(first);
  rerun(root);
  expect(frame(root).srcdoc).not.toContain('window.extra');
  await renderer.renderStreaming(root, '');
  await vi.waitFor(() => expect(root.children).toHaveLength(0));
  await renderer.renderStreaming(root, html);
  expect(root.querySelectorAll('.mdx-playground')).toHaveLength(1);
  expect(root.querySelector('iframe')).toBeNull();
});

it('releases previews and handlers when the plugin is removed', async () => {
  const { renderer, root } = setup();
  await renderer.render(root, block('html live', '<p>Demo</p>'));
  const button = panel(root).querySelector<HTMLButtonElement>('button')!;
  run(root);
  renderer.getPluginManager().unregister('interaction:playground');
  expect(root.querySelector('.mdx-playground, iframe')).toBeNull();
  expect(root.querySelector('.mdx-playground-source, [data-mdx-playground-hidden]')).toBeNull();
  button.click();
  expect(root.querySelector('.mdx-playground, iframe')).toBeNull();
});

it('keeps grouped companion blocks in place while toggling the first block', async () => {
  const { renderer, root } = setup();
  await renderer.render(root, [block('html playground=demo', '<p>Demo</p>'), 'Explanation',
    block('css playground=demo', 'p { color: red; }'),
    block('js playground=demo', 'window.example = true;')].join('\n\n'));
  const sources = root.querySelectorAll('pre');
  run(root);
  expect(sources[0].hasAttribute('data-mdx-playground-hidden')).toBe(true);
  expect(sources[1].hasAttribute('data-mdx-playground-hidden')).toBe(false);
  expect(sources[2].hasAttribute('data-mdx-playground-hidden')).toBe(false);
  expect(panel(root).nextElementSibling).toBe(sources[0]);
  button(root, '代码').click();
  expect([...sources].some(source => source.hasAttribute('data-mdx-playground-hidden'))).toBe(false);
});

it('keeps preview mode when code controls wrap sources in a later animation frame', async () => {
  const { renderer, root } = setup();
  renderer.usePlugin(new CodeBlockControlsPlugin());
  await renderer.render(root, Array.from({ length: 6 }, (_, index) =>
    block('html live', `<p>Example ${index}</p>`)).join('\n\n'));
  run(root);
  const first = frame(root);
  await vi.waitFor(() => expect(root.querySelectorAll('.mdx-code-block-wrapper')).toHaveLength(6));
  const source = root.querySelector('.mdx-code-block-wrapper')!;
  expect(source.hasAttribute('data-mdx-playground-hidden')).toBe(true);
  expect(source.querySelector('pre')!.hasAttribute('data-mdx-playground-hidden')).toBe(false);
  expect(frame(root)).toBe(first);
  expect(panel(root).querySelector('[data-mdx-code-actions]')).not.toBeNull();
  button(root, '代码').click();
  expect(source.hasAttribute('data-mdx-playground-hidden')).toBe(false);
  expect(first.hidden).toBe(true);
});

it('preserves moved collapse handlers and commands, restoring original buttons when removed', async () => {
  const { renderer, root } = setup(true);
  await renderer.render(root, block('html live', '<p>Demo</p>'));
  const source = root.querySelector('.custom-code-wrapper')!;
  const controls = source.querySelector('[data-mdx-code-controls]')!;
  const actions = panel(root).querySelector('[data-mdx-code-actions]')!;
  const collapse = actions.querySelector<HTMLButtonElement>('.custom-code-controls__button--collapse')!;
  collapse.click();
  expect(collapse.getAttribute('aria-expanded')).toBe('true');
  expect(renderer.getPluginManager().getCommand('collapseAllCodeBlocks')!().affectedCount).toBe(1);
  expect(collapse.getAttribute('aria-expanded')).toBe('false');
  expect(renderer.getPluginManager().getCommand('expandAllCodeBlocks')!().affectedCount).toBe(1);
  expect(collapse.getAttribute('aria-expanded')).toBe('true');
  run(root);
  renderer.getPluginManager().unregister('interaction:playground');
  expect(controls.querySelector('[data-mdx-code-actions]')).toBe(actions);
  expect(controls.hasAttribute('data-mdx-code-controls-merged')).toBe(false);
  expect(root.querySelector('[data-mdx-code-controls-merged], .mdx-playground')).toBeNull();
  expect(actions.querySelector('.custom-code-controls__button--collapse')).toBe(collapse);
  collapse.click();
  expect(collapse.getAttribute('aria-expanded')).toBe('false');
});

it('preserves fence metadata through worker lexing for large documents', async () => {
  class Worker {
    onmessage?: (event: any) => void;
    terminate() {}
    postMessage(data: { text: string }) {
      queueMicrotask(() => this.onmessage?.({ data: { tokens: new Marked().lexer(data.text) } }));
    }
  }
  vi.stubGlobal('Worker', Worker);
  const { renderer, root } = setup();
  await renderer.render(root, block('html live', '<p>Large document demo</p>') + '\n\n' + 'paragraph '.repeat(4000));
  expect(root.querySelectorAll('.mdx-playground')).toHaveLength(1);
  run(root);
  expect(frame(root).srcdoc).toContain('Large document demo');
});

it('enables the registered plugin by default and supports explicit factory exclusion', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const { createMDxEditor } = await import('../src/factory');
  for (const disabled of [false, true]) {
    const root = document.createElement('div');
    document.body.append(root);
    const editor = await createMDxEditor(root, { initialMode: 'render', htmlPolicy: 'literal',
      initialContent: block('html live', '<p>Demo</p>'), plugins: disabled ? ['-playground'] : [] });
    try {
      expect(root.querySelectorAll('.mdx-playground')).toHaveLength(disabled ? 0 : 1);
      expect(root.querySelector('iframe')).toBeNull();
    } finally { await editor.destroy(); }
  }
});

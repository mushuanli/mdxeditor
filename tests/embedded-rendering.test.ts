// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createMDxEditor } from '../src/factory';
import { MDxEditor } from '../src/editor/mdx-editor';
import { MDxRenderer } from '../src/renderer/mdx-renderer';
import { revealRenderedContent } from '../src/renderer/reveal-content';
import { FoldablePlugin } from '../src/plugins/syntax-extensions/foldable.plugin';
import { CodeBlockControlsPlugin } from '../src/plugins/interactions/codeblock-controls.plugin';
import type { MDxPlugin } from '../src/core/types';

const renderers: MDxRenderer[] = [];
afterEach(() => { renderers.splice(0).forEach(renderer => renderer.destroy()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup(literal = false) {
    const renderer = new MDxRenderer({ htmlPolicy: literal ? 'literal' : 'allow' });
    renderers.push(renderer);
    return { renderer, root: document.createElement('div') };
}
const fold = '::> Notes\n    **Body**\n';
const code = '```ts\nconst answer = 42;\nconsole.log(answer);\n```';

it('reveals only target ancestors and preserves code disclosure state across rendering', async () => {
    const { renderer, root } = setup();
    renderer.usePlugin(new CodeBlockControlsPlugin({ classPrefix: 'custom-code', minLinesThreshold: 1 }));
    const content = '<details data-mdx-disclosure-key="folded"><summary>Folded</summary>\n\n' + code + '\n\n</details>\n\n' + code;
    await renderer.render(root, content);
    const target = root.querySelector<HTMLElement>('code')!, codes = root.querySelectorAll('pre');
    const details = root.querySelector<HTMLDetailsElement>('details')!;
    revealRenderedContent(target, document.createElement('div'));
    expect(details.open).toBe(false);
    revealRenderedContent(target, root);
    expect(details.open).toBe(true);
    expect(codes[0].style.maxHeight).toBe('none');
    expect(codes[1].style.maxHeight).not.toBe('none');
    await renderer.render(root, content + '\n\nUpdated');
    expect(root.querySelector<HTMLDetailsElement>('details')!.open).toBe(true);
    expect(root.querySelectorAll('pre')[0].style.maxHeight).toBe('none');
    expect(root.querySelectorAll('pre')[1].style.maxHeight).not.toBe('none');
});

it('preserves host classes and editor defaults while opting into host scrolling', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    for (const scrollMode of ['editor', 'host'] as const) {
        const mount = document.createElement('div'); mount.className = 'host-content';
        const editor = await createMDxEditor(mount, { scrollMode, initialMode: 'render',
            initialContent: '<b>Literal</b>', htmlPolicy: 'literal', plugins: ['editor:core'] });
        try {
            expect(mount.classList.contains('host-content')).toBe(true);
            expect(mount.dataset.mdxScroll).toBe(scrollMode);
            expect(mount.querySelector('b')).toBeNull();
            expect(mount.textContent).toContain('<b>Literal</b>');
        } finally { await editor.destroy(); }
    }
});

it('keeps authored HTML literal in headings, inline content and folded fragments', async () => {
    const { renderer, root } = setup(true);
    renderer.usePlugin(new FoldablePlugin());
    await renderer.render(root, '# Title <img src=x>\n\nHello <b>world</b>\n\n::> More\n    <script>raw</script>\n');
    expect(root.querySelector('img, b, script')).toBeNull();
    expect(root.querySelector('h1')?.textContent).toBe('Title <img src=x>');
    expect(root.querySelector('details')?.textContent).toContain('<script>raw</script>');
});

it('retains the default authored HTML policy for normal documents', async () => {
    const { renderer, root } = setup();
    await renderer.render(root, '<b>Normal document</b>');
    expect(root.querySelector('b')?.textContent).toBe('Normal document');
});

it('applies host syntax extensions inside folded fragments', async () => {
    const { renderer, root } = setup(true);
    renderer.usePlugin(new FoldablePlugin()).usePlugin({ name: 'host-code', install(context) {
        context.registerSyntaxExtension({ renderer: { code: token =>
            token.lang === 'note' ? '<span class="host-note">Generated</span>' : false } });
    } });
    await renderer.render(root, '::> Notes\n    ```note\n    body\n    ```\n');
    expect(root.querySelector('details .host-note')?.textContent).toBe('Generated');
});

it('preserves separate states for repeated summaries and across stream finalization', async () => {
    const { renderer, root } = setup(); renderer.usePlugin(new FoldablePlugin({ defaultOpen: false }));
    const markdown = fold + '\n' + fold;
    await renderer.renderStreaming(root, markdown);
    const notes = root.querySelectorAll<HTMLDetailsElement>('details');
    expect(notes).toHaveLength(2); notes[1].open = true;
    await renderer.renderStreaming(root, markdown + '\nTail');
    await renderer.finishStreaming(root, markdown + '\nTail');
    expect([...root.querySelectorAll<HTMLDetailsElement>('details')].map(note => note.open)).toEqual([false, true]);
    root.querySelectorAll<HTMLDetailsElement>('details')[1].open = false;
    await renderer.render(root, markdown);
    expect([...root.querySelectorAll<HTMLDetailsElement>('details')].map(note => note.open)).toEqual([false, false]);
});

it('uses explicit generic keys to preserve disclosure state when content changes', async () => {
    const { renderer, root } = setup(true);
    const host: MDxPlugin = { name: 'host-details', install(context) {
        context.registerSyntaxExtension({ renderer: { code: () =>
            '<details data-mdx-disclosure-key="host:stable"><summary>Host</summary>Body</details>' } });
    } };
    renderer.usePlugin(host); await renderer.render(root, code);
    root.querySelector<HTMLDetailsElement>('details')!.open = true;
    await renderer.renderStreaming(root, code + '\n\nNew content');
    await renderer.finishStreaming(root, code + '\n\nFinal content');
    expect(root.querySelector<HTMLDetailsElement>('details')!.open).toBe(true);
    const other = setup(true); other.renderer.usePlugin(host); await other.renderer.render(other.root, code);
    expect(other.root.querySelector<HTMLDetailsElement>('details')!.open).toBe(false);
});

it('preserves code controls independently for duplicate code and during stream finalization', async () => {
    const { renderer, root } = setup();
    const controls = new CodeBlockControlsPlugin({ minLinesThreshold: 1, defaultCollapsed: true });
    renderer.usePlugin(controls);
    const markdown = code + '\n\n' + code;
    await renderer.renderStreaming(root, markdown);
    root.querySelectorAll<HTMLButtonElement>('.mdx-code-block-controls__button--collapse')[1].click();
    await renderer.finishStreaming(root, markdown + '\n\nTail');
    expect([...root.querySelectorAll('[aria-expanded]')].map(button => button.getAttribute('aria-expanded')))
        .toEqual(['false', 'true']);
    controls.collapseAll(); await renderer.render(root, markdown);
    expect([...root.querySelectorAll('[aria-expanded]')].map(button => button.getAttribute('aria-expanded')))
        .toEqual(['false', 'false']);
    controls.expandAll(); await renderer.render(root, markdown);
    expect([...root.querySelectorAll('[aria-expanded]')].map(button => button.getAttribute('aria-expanded')))
        .toEqual(['true', 'true']);
});

it('captures disclosure toggles made while a replacement is being parsed', async () => {
    const { renderer, root } = setup(); renderer.usePlugin(new FoldablePlugin({ defaultOpen: false }));
    await renderer.render(root, fold);
    let release!: () => void;
    renderer.usePlugin({ name: 'delay', install(context) {
        context.on('beforeParse', async (value: unknown) => {
            await new Promise<void>(resolve => { release = resolve; }); return value;
        });
    } });
    const pending = renderer.render(root, fold + '\nMore');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    root.querySelector<HTMLDetailsElement>('details')!.open = true;
    release(); await pending;
    expect(root.querySelector<HTMLDetailsElement>('details')!.open).toBe(true);
});

it('preserves editor disclosure state through setText without clearing the old DOM first', async () => {
    const mount = document.createElement('div');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const editor = new MDxEditor({ initialMode: 'render' }).use(new FoldablePlugin({ defaultOpen: false }));
    await editor.init(mount, fold);
    try {
        mount.querySelector<HTMLDetailsElement>('details')!.open = true;
        editor.setText(fold + '\nUpdated');
        await vi.waitFor(() => expect(mount.textContent).toContain('Updated'));
        expect(mount.querySelector<HTMLDetailsElement>('details')!.open).toBe(true);
    } finally { await editor.destroy(); }
    expect(errors).not.toHaveBeenCalled();
});

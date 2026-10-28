// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { MDxRenderer } from '../src/renderer/mdx-renderer';
import { CodeBlockControlsPlugin } from '../src/plugins/interactions/codeblock-controls.plugin';

it('toggles each code block independently without changing source and retains state on rerender', async () => {
    const renderer = new MDxRenderer();
    renderer.usePlugin(new CodeBlockControlsPlugin({ wrapText: 'Wrap lines' }));
    const root = document.createElement('div');
    const markdown = '```json\n{"text":"long value"}\n```\n\n```json\n{"other":true}\n```';
    try {
        await renderer.render(root, markdown);
        const original = root.querySelector('pre')!.textContent;
        const buttons = root.querySelectorAll<HTMLButtonElement>('[data-mdx-code-wrap]');
        expect(buttons).toHaveLength(2);
        expect(buttons[0].textContent).toBe('Wrap lines');
        buttons[0].click();
        expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
        expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
        expect(root.querySelector('pre')!.textContent).toBe(original);
        await renderer.render(root, markdown + '\n\nUpdated');
        const button = root.querySelector<HTMLButtonElement>('[data-mdx-code-wrap]')!;
        expect(root.querySelector('pre')!.dataset.mdxWrap).toBe('true');
        button.click();
        expect(button.getAttribute('aria-pressed')).toBe('false');
        expect(root.querySelector('pre')!.dataset.mdxWrap).toBe('false');
        expect(root.querySelector('pre')!.textContent).toBe(original);
    } finally { renderer.destroy(); }
});

it('inherits global wrapping and allows a local override', async () => {
    const renderer = new MDxRenderer();
    renderer.usePlugin(new CodeBlockControlsPlugin());
    const root = document.createElement('div');
    root.classList.add('mdx-editor-renderer--wrap');
    try {
        await renderer.render(root, '```json\n{"value":1}\n```');
        const button = root.querySelector<HTMLButtonElement>('[data-mdx-code-wrap]')!;
        expect(button.getAttribute('aria-pressed')).toBe('true');
        button.click();
        expect(root.querySelector('pre')!.dataset.mdxWrap).toBe('false');
    } finally { renderer.destroy(); }
});

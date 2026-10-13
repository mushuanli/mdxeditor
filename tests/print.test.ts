// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefaultPrintService } from '../src/services/print/print.service';
import { PRINT_STYLES } from '../src/services/print/print.styles';
import { MDxEditor } from '../src/editor/mdx-editor';
import { CoreTitleBarPlugin } from '../src/plugins/ui/titlebar.plugin';

vi.mock('../src/renderer/mdx-renderer', () => ({ MDxRenderer: vi.fn() }));

afterEach(() => {
    window.dispatchEvent(new Event('afterprint'));
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
});

describe('print title', () => {
    it.each(['简历.mind', 'notes.md', 'report.final.txt', '.gitignore'])('prints %s without its file extension', async fileName => {
        vi.useFakeTimers(); document.title = 'Application';
        const expected = fileName === '.gitignore' ? fileName : fileName.slice(0, fileName.lastIndexOf('.'));
        vi.spyOn(window, 'print').mockImplementation(() => {
            expect(document.querySelector('.mdx-print-header__title')?.textContent).toBe(expected);
            expect(document.title).toBe(expected); window.dispatchEvent(new Event('afterprint'));
        });
        const printing = new DefaultPrintService().printFromHtml('<p>Body</p>', { fileName, showHeader: true, fontSize: 'normal' });
        await vi.advanceTimersByTimeAsync(300); await printing;
        expect(document.title).toBe('Application');
    });

    it('allows hiding the file name while retaining explicitly supplied metadata', async () => {
        vi.useFakeTimers(); document.title = 'Application';
        vi.spyOn(window, 'print').mockImplementation(() => {
            expect(document.querySelector('.mdx-print-header__title')).toBeNull();
            expect(document.querySelector('.mdx-print-header__meta')?.textContent).toBe('Author');
            expect(document.title).toBe(''); window.dispatchEvent(new Event('afterprint'));
        });
        const printing = new DefaultPrintService().printFromHtml('<p>Body</p>', {
            fileName: '简历.mind', showFileName: false, showHeader: true, fontSize: 'normal', headerMeta: { author: 'Author' },
        });
        await vi.advanceTimersByTimeAsync(300); await printing;
        expect(document.title).toBe('Application');
    });

    it('offers a checked file-name option and applies its selection to the printed page', async () => {
        vi.useFakeTimers();
        vi.spyOn(window, 'print').mockImplementation(() => {
            expect(document.querySelector('.mdx-print-header')).toBeNull();
            expect(document.querySelector('.mdx-print--no-header')).not.toBeNull();
            window.dispatchEvent(new Event('afterprint'));
        });
        const printing = new DefaultPrintService().printFromHtml('<p>Body</p>', { fileName: '简历.mind', showHeader: true });
        const toggle = document.querySelector<HTMLInputElement>('[data-show-file-name]')!;
        expect(toggle.checked).toBe(true); toggle.click();
        document.querySelector<HTMLButtonElement>('[data-size="normal"]')!.click();
        await vi.advanceTimersByTimeAsync(300); await printing;
        expect(window.print).toHaveBeenCalledOnce();
    });

    it('cancels printing from the localized options dialog', async () => {
        const print = vi.spyOn(window, 'print').mockImplementation(() => {});
        const printing = new DefaultPrintService().printFromHtml('<p>Body</p>', { fileName: 'notes.md', showHeader: true, locale: 'en' });
        expect(document.body.textContent).toContain('Show file name');
        document.querySelector<HTMLButtonElement>('#mdx-print-cancel')!.click();
        await printing;
        expect(print).not.toHaveBeenCalled();
        expect(document.querySelector('[data-show-file-name]')).toBeNull();
    });

    it('passes the editor file name to printing and preserves an explicit custom title', async () => {
        const printFromHtml = vi.fn(async () => {});
        const editor = Object.assign(Object.create(MDxEditor.prototype), {
            config: { title: '简历.mind', documentPath: '/简历.mind' }, printService: { printFromHtml },
            modeManager: { getMode: () => 'render', getRenderContainer: () => ({ innerHTML: '<p>Body</p>' }) },
        });
        await editor.print({ fontSize: 'normal' });
        expect(printFromHtml).toHaveBeenLastCalledWith('<p>Body</p>', expect.objectContaining({ fileName: '简历.mind' }));
        await editor.print({ title: 'Release 1.2', showFileName: false, fontSize: 'normal' });
        expect(printFromHtml).toHaveBeenLastCalledWith('<p>Body</p>', expect.objectContaining({ title: 'Release 1.2', fileName: undefined, showFileName: false }));
    });

    it.each([false, true])('waits for rename before printing (failure: %s)', async (fails) => {
        let finish!: () => void;
        const rename = vi.fn(() => new Promise<void>((resolve, reject) => {
            finish = () => fails ? reject(new Error('rename failed')) : resolve();
        }));
        const events = new Map<string, Function[]>();
        const commands = new Map<string, Function>();
        const buttons: any[] = [];
        const listen = (name: string, callback: Function) => {
            events.set(name, [...(events.get(name) || []), callback]);
            return () => {};
        };
        const emit = (name: string, payload: unknown) => {
            events.get(name)?.forEach(callback => callback(payload));
        };
        const manager = { emit, getTitleBarButtons: () => buttons, getCommand: (name: string) => commands.get(name) };
        const container = document.createElement('div');
        document.body.append(container);
        const editor = Object.assign(Object.create(MDxEditor.prototype), {
            getMode: () => 'edit',
            getLineWrapping: () => true,
            config: { title: 'Old', documentPath: '/Old.md', host: { renameDocument: async () => { await rename(); return { path: '/New.md', title: 'New' }; } } },
            _container: container,
            renderer: { getPluginManager: () => manager },
            updateDocumentPath: vi.fn(),
            print: vi.fn().mockResolvedValue(undefined),
        });
        const context = {
            listen, on: listen,
            registerCommand: (name: string, callback: Function) => commands.set(name, callback),
            registerTitleBarButton: (button: unknown) => buttons.push(button),
            getFileSystem: () => ({ driver: { getNode: async () => ({ metadata: {} }), rename } }),
            getCurrentNodeId: () => '/Old.md',
        };
        const plugin = new CoreTitleBarPlugin();
        plugin.install(context as any);
        emit('editorPostInit', { editor, pluginManager: manager });
        const input = container.querySelector('input')!;
        input.value = 'New';
        input.dispatchEvent(new Event('blur'));
        container.querySelector<HTMLButtonElement>('[data-button-id="print-action"]')!.click();
        await vi.waitFor(() => expect(rename).toHaveBeenCalled());
        expect(editor.print).not.toHaveBeenCalled();
        finish();
        await vi.waitFor(() => expect(editor.print).toHaveBeenCalled());
        const title = fails ? 'Old' : 'New';
        expect(editor.config.title).toBe(title);
        expect(input.value).toBe(title);
        expect(editor.print).toHaveBeenCalledWith(expect.objectContaining({ title }));
        // The default print handler must not inject a date into the header.
        expect(editor.print.mock.calls[0][0]).not.toHaveProperty('headerMeta');
        plugin.destroy();
    });

    it('uses the print title and cleans up when afterprint fires inside print()', async () => {
        vi.useFakeTimers();
        document.title = 'Application';
        vi.spyOn(window, 'print').mockImplementation(() => {
            expect(document.title).toBe('Renamed document');
            expect(document.querySelector('.mdx-print-header__title')?.textContent).toBe('Renamed document');
            // The header shows the title only: no implicit date when headerMeta is omitted.
            expect(document.querySelector('.mdx-print-header__meta')).toBeNull();
            window.dispatchEvent(new Event('afterprint'));
        });
        const printing = new DefaultPrintService().printFromHtml('<p>Body</p>', {
            title: 'Renamed document', showHeader: true, fontSize: 'normal',
        });
        await vi.advanceTimersByTimeAsync(300);
        await printing;
        expect(window.print).toHaveBeenCalledOnce();
        expect(document.title).toBe('Application');
        expect(document.getElementById('mdx-print-overlay-style')).toBeNull();
        expect(document.getElementById('mdx-print-overlay')?.innerHTML).toBe('');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('renders a header date only when the caller provides one', async () => {
        vi.useFakeTimers();
        vi.spyOn(window, 'print').mockImplementation(() => {
            expect(document.querySelector('.mdx-print-header__meta')?.textContent).toBe('2024-01-02');
            window.dispatchEvent(new Event('afterprint'));
        });
        const printing = new DefaultPrintService().printFromHtml('<p>Body</p>', {
            title: 'Dated document', showHeader: true, fontSize: 'normal',
            headerMeta: { date: '2024-01-02' },
        });
        await vi.advanceTimersByTimeAsync(300);
        await printing;
        expect(window.print).toHaveBeenCalledOnce();
    });
});

describe('print lists', () => {
    it('restores list markers after a global CSS reset, including nested and task lists', () => {
        const style = document.createElement('style');
        style.textContent = `ul, ol { list-style: none; } li { display: block; } ${PRINT_STYLES}`;
        document.head.append(style);
        document.body.innerHTML = `<article class="mdx-print"><ul id="bullets"><li id="item">One
            <ul id="nested"><li>Two<ul id="deep"><li>Three</li></ul></li></ul>
            </li><li class="task-list-item" id="task"><input type="checkbox" checked>Done</li></ul>
            <ol id="numbered" start="3"><li>Three<ol id="letters"><li>A</li></ol></li></ol></article>`;
        const css = (id: string) => getComputedStyle(document.getElementById(id)!);
        expect(css('bullets').listStyleType).toBe('disc');
        expect(css('nested').listStyleType).toBe('circle');
        expect(css('deep').listStyleType).toBe('square');
        expect(css('numbered').listStyleType).toBe('decimal');
        expect(css('letters').listStyleType).toBe('lower-alpha');
        expect(css('item').display).toBe('list-item');
        expect(css('task').listStyle).toBe('none');
    });
});

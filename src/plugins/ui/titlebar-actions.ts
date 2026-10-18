import {ACTION_ICONS} from '../../utils/icons';

/** Mount host controls and move existing secondary buttons without replacing their handlers. */
export function mountTitlebarActions(container: HTMLElement, actions: DocumentFragment, options: {
    overflow?: boolean; label: string; mount?: (container: HTMLElement) => (() => void) | void;
}): () => void {
    const lifetime = new AbortController();
    let cleanup: (() => void) | void;
    if (options.mount) {
        const slot = document.createElement('div'); slot.className = 'mdx-editor-titlebar__host-actions'; container.append(slot);
        cleanup = options.mount(slot);
    }
    if (options.overflow && actions.childElementCount) {
        const menu = document.createElement('details'); menu.className = 'mdx-editor-titlebar__menu';
        const summary = document.createElement('summary'); summary.innerHTML = ACTION_ICONS.more;
        summary.title = options.label; summary.setAttribute('aria-label', options.label);
        const panel = document.createElement('div'); panel.className = 'mdx-editor-titlebar__menu-actions'; panel.append(actions);
        menu.append(summary, panel); container.append(menu);
        menu.addEventListener('toggle', () => {
            const rect = summary.getBoundingClientRect(); panel.style.top = `${rect.bottom + 4}px`; panel.style.right = `${Math.max(8, innerWidth - rect.right)}px`;
        });
        panel.onclick = () => {menu.open = false;};
        document.addEventListener('pointerdown', event => {if (!menu.contains(event.target as Node)) menu.open = false;}, {signal: lifetime.signal});
        menu.onkeydown = event => {if (event.key === 'Escape') {menu.open = false; event.stopPropagation(); summary.focus();}};
    } else container.append(actions);
    return () => {lifetime.abort(); cleanup?.();};
}

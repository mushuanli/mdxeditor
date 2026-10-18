export const REVEAL_CONTENT_EVENT = 'mdx:reveal-content';

/** Reveal ancestors without scrolling or changing unrelated disclosures. */
export function revealRenderedContent(element: HTMLElement, root: HTMLElement): void {
    if (element === root || !root.contains(element)) return;
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    element.dispatchEvent(new CustomEvent(REVEAL_CONTENT_EVENT, { bubbles: true }));
}

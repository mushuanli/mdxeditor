const keyAttribute = 'data-mdx-disclosure-key';

function fingerprint(text: string): string {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
    return (hash >>> 0).toString(36);
}

/** Explicit host keys survive content edits; generated keys identify unchanged content and its occurrence. */
export function assignDisclosureKeys(root: HTMLElement, selector: string, namespace: string,
    identity: (element: HTMLElement) => string): void {
    const occurrences = new Map<string, number>();
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
        const base = `${namespace}:${fingerprint(identity(element))}`;
        const occurrence = occurrences.get(base) ?? 0;
        occurrences.set(base, occurrence + 1);
        if (!element.hasAttribute(keyAttribute)) element.setAttribute(keyAttribute, `${base}:${occurrence}`);
    }
}

/** Renderer-local, in-memory interaction state; never reads or writes host storage. */
export class DisclosureState {
    private expanded = new Map<string, boolean>();

    get(key: string): boolean | undefined { return this.expanded.get(key); }
    set(key: string, open: boolean): void { this.expanded.set(key, open); }
    clear(): void { this.expanded.clear(); }

    capture(root: HTMLElement): void {
        for (const details of root.querySelectorAll<HTMLDetailsElement>(`details[${keyAttribute}]`)) {
            this.set(details.getAttribute(keyAttribute)!, details.open);
        }
    }

    restore(root: HTMLElement, scope: HTMLElement = root): void {
        assignDisclosureKeys(root, 'details[data-mdx-disclosure]', 'details',
            element => element.querySelector('summary')?.textContent ?? '');
        for (const details of scope.querySelectorAll<HTMLDetailsElement>(`details[${keyAttribute}]`)) {
            const open = this.get(details.getAttribute(keyAttribute)!);
            if (open !== undefined) details.open = open;
        }
    }
}

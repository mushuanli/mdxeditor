import type { MarkedExtension } from 'marked';
export type WorkerSyntax = 'mdxAiChat' | 'math-display' | 'math-inline' | 'cloze:cloze' | 'mdxLink' | 'mdxTransclusion';
const identities = new WeakMap<Function, WorkerSyntax>();

/** Shared lexical rules: worker tokenization and plugin renderers keep one grammar. */
export function builtinTokenizer(name: WorkerSyntax, nextCloze?: () => number): (src: string) => any {
    let counter = 0;
    const next = nextCloze ?? (() => counter++);
    const tokenize = (src: string): any => {
        if (name === 'mdxAiChat') {
            const match = /^::@(?:[ \t]+([^\r\n]*)|(?=\r?\n|$))(?:\r?\n|$)/.exec(src);
            return match ? { type: name, raw: match[0], prompt: (match[1] ?? '').trim() } : undefined;
        }
        if (name === 'cloze:cloze') {
            const match = src.match(/^--(?:\[([^\]]+)\]\s*)?([\s\S]+?)--(?:\^\^audio:([^^]+)\^\^)?/);
            return match ? { type: name, raw: match[0], locator: match[1] || `auto-${next()}`,
                content: match[2].trim(), audio: match[3]?.trim() } : undefined;
        }
        if (name === 'mdxLink') {
            const match = src.match(/^\[([^\]]+)\]\(mdx:\/\/([^/]+)\/([^)]+)\)/);
            return match ? { type: name, raw: match[0], text: match[1], provider: match[2], id: match[3] } : undefined;
        }
        if (name === 'mdxTransclusion') {
            const match = /^!@(\w+):(\S+)(?:\n|$)/.exec(src);
            return match ? { type: name, raw: match[0], providerKey: match[1], id: match[2] } : undefined;
        }
        const match = src.match(name === 'math-display' ? /^\$\$([\s\S]+?)\$\$/ : /^\$([^\$\n]+?)\$/);
        return match ? { type: name, raw: match[0], text: match[1].trim() } : undefined;
    };
    identities.set(tokenize, name);
    return tokenize;
}

export function workerSyntax(extensions: any[]): WorkerSyntax[] {
    const names: WorkerSyntax[] = [];
    for (const extension of extensions) {
        if (extension.tokenizer || extension.hooks?.provideLexer) throw new Error('Custom lexer requires a worker implementation');
        for (const item of extension.extensions ?? []) {
            if (!item.tokenizer) continue;
            const name = identities.get(item.tokenizer);
            if (!name) throw new Error('Custom tokenizer requires a worker implementation');
            names.push(name);
        }
    }
    return names;
}

export function lexicalExtension(name: WorkerSyntax): MarkedExtension {
    return { extensions: [{ name,
        level: name === 'math-display' || name === 'mdxTransclusion' || name === 'mdxAiChat' ? 'block' : 'inline',
        start: src => name === 'mdxAiChat' ? src.match(/^::@(?=[ \t]|$)/m)?.index
            : name === 'math-display' ? src.match(/^\$\$/)?.index
            : name === 'math-inline' ? src.match(/\$/)?.index : name === 'cloze:cloze' ? src.match(/--/)?.index
            : name === 'mdxLink' ? src.indexOf('](') : src.match(/!@/)?.index,
        tokenizer: builtinTokenizer(name),
    }] };
}

import { expect, it } from 'vitest';
import { resolveDocumentLink } from '../src/editor/document-links';

it('resolves relative references, encoded filenames and fragments in the document namespace', () => {
    expect(resolveDocumentLink('../其他%20文档.md#说明', '/workspace/docs/start.md')).toEqual({ path: '/workspace/其他 文档.md', anchor: '说明' });
    expect(resolveDocumentLink('./nested/../next.md?view=preview#intro', '/docs/start.md')).toEqual({ path: '/docs/next.md', anchor: 'intro' });
    expect(resolveDocumentLink('#intro', '/docs/start.md')).toEqual({ path: '/docs/start.md', anchor: 'intro' });
    expect(resolveDocumentLink('/root.md', '/docs/start.md')?.path).toBe('/root.md');
    for (const href of ['https://example.com/doc.md', '//example.com', 'mailto:me@example.com', '@asset/file.pdf', 'blob:asset', 'mdx://file/a']) expect(resolveDocumentLink(href, '/docs/start.md')).toBeUndefined();
});

import { expect, it } from 'vitest';
import { isLargeDocument } from '../src/editor/document-policy';

it('counts UTF-8 bytes, lines and long individual lines for the source-first budget', () => {
    expect(isLargeDocument('中'.repeat(90_000))).toBe(true);
    expect(isLargeDocument('x\n'.repeat(5000))).toBe(true);
    expect(isLargeDocument('x'.repeat(10_001))).toBe(true);
    expect(isLargeDocument('x'.repeat(10_000) + '\n')).toBe(false);
    expect(isLargeDocument('small')).toBe(false);
});

it('shares an immutable document policy without mutating caller options', async () => {
    const { documentProfile } = await import('../src/editor/document-policy');
    const options = { contentFormat: 'markdown' as const, initialMode: 'render' as const };
    const profile = documentProfile(options, 'line\n'.repeat(5_001));
    expect(profile).toMatchObject({ largeReason: 'lines', initialMode: 'edit',
        enableMarkdown: false, enableLineWrapping: false, showSourceNotice: true });
    expect(Object.isFrozen(profile)).toBe(true);
    expect(options.initialMode).toBe('render');
});

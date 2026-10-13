import { t } from '../../utils/i18n';
import type { PrintOptions } from './print.service';

type Selection = Pick<PrintOptions, 'fontSize' | 'showFileName'>;
type Locale = 'zh-CN' | 'en';

function sizeButtons(locale?: Locale): string {
    return (['small', 'normal', 'large'] as const).map((size, index) =>
        `<button type="button" data-size="${size}" style="flex:1;padding:12px 20px;border:2px solid #d0d5dd;border-radius:8px;background:#fff;cursor:pointer;font-size:14px;">
            <div style="font-weight:600;margin-bottom:4px;">${t('print.' + size, locale)}</div>
            <div style="color:#656d76;font-size:12px;">${12 + index * 2}px</div>
        </button>`).join('');
}

function createOverlay(showFileName: boolean, locale?: Locale): HTMLElement {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);';
    overlay.innerHTML = `<div role="dialog" aria-modal="true" aria-label="${t('print.options', locale)}" style="background:#fff;border-radius:12px;padding:24px;min-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
        <div style="font-size:16px;font-weight:600;margin-bottom:16px;">${t('print.options', locale)}</div>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:14px;">
            <input type="checkbox" data-show-file-name ${showFileName ? 'checked' : ''}>${t('print.showFileName', locale)}
        </label>
        <div style="font-size:14px;margin-bottom:8px;">${t('print.fontSize', locale)}</div>
        <div style="display:flex;gap:12px;margin-bottom:16px;">${sizeButtons(locale)}</div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button type="button" id="mdx-print-cancel" style="padding:8px 16px;border:1px solid #d0d5dd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">${t('print.cancel', locale)}</button>
        </div>
    </div>`;
    return overlay;
}

/** Font buttons confirm both choices; cancel, Escape and backdrop dismiss printing. */
export function showPrintOptionsDialog(showFileName: boolean, locale?: Locale): Promise<Selection | null> {
    return new Promise(resolve => {
        const overlay = createOverlay(showFileName, locale);
        const close = (fontSize?: PrintOptions['fontSize']) => {
            const checked = overlay.querySelector<HTMLInputElement>('[data-show-file-name]')!.checked;
            overlay.remove(); document.removeEventListener('keydown', escape);
            resolve(fontSize ? { fontSize, showFileName: checked } : null);
        };
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
        overlay.addEventListener('click', event => {
            const target = (event.target as Element).closest<HTMLElement>('[data-size],#mdx-print-cancel');
            if (target) close(target.dataset.size as PrintOptions['fontSize']);
            else if (event.target === overlay) close();
        });
        document.addEventListener('keydown', escape);
        document.body.append(overlay);
        overlay.querySelector<HTMLInputElement>('[data-show-file-name]')!.focus();
    });
}

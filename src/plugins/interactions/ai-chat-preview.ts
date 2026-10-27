import {MDxRenderer} from '../../renderer/mdx-renderer';
import type {PluginContext} from '../../core/types';
import type {AiChatSource} from './ai-chat.contracts';

/** A render-only child: no editor, toolbar, selection actions or AI syntax is installed. */
export function createAiChatPreview(context: PluginContext, source: AiChatSource, signal: AbortSignal): MDxRenderer {
  const renderer = new MDxRenderer({htmlPolicy: 'literal', documentPath: source.documentPath, assets: context.getAssets(), signal});
  renderer.usePlugin({name: 'ai-preview:links', install(child) {
    child.on('domUpdated', ({element}: {element: HTMLElement}) => {
      element.querySelectorAll('a[href], img[src]').forEach(node => {
        const attr = node.tagName === 'A' ? 'href' : 'src', value = node.getAttribute(attr) ?? '';
        if (/^(?:javascript|data|vbscript):/i.test(value.replace(/[\u0000-\u0020]/g, ''))) node.removeAttribute(attr);
      });
    });
  }});
  return renderer;
}

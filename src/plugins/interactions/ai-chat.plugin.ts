import type { MDxPlugin, PluginContext } from '../../core/types';
import type { AiChatAttachment, AiChatPluginOptions, AiChatSource, AiChatTarget } from './ai-chat.contracts';
import { lexicalExtension } from '../../renderer/worker-tokenizers';
import { escapeHTML } from '../../utils/html';
import { randomUUID } from '../../utils/random';

interface Draft {
  revision: number;
  submission?: {revision: number; operationId: string};
  prompt: string;
  attachments: AiChatAttachment[];
  target?: AiChatTarget;
  targets: readonly AiChatTarget[];
  busy: boolean;
  loading: boolean;
  status: string;
  refresh?: () => void;
}

/** Opt-in composer in rendered Markdown. Branches and execution are entirely host-owned. */
export class AiChatPlugin implements MDxPlugin {
  name = 'interaction:ai-chat';
  private cleanups: Array<() => void> = [];
  private lifetime = new AbortController();
  private drafts = new Map<string, Draft>();
  private path?: string;

  constructor(private options: AiChatPluginOptions) {}

  install(context: PluginContext): void {
    const extension = lexicalExtension('mdxAiChat');
    extension.extensions!.push({ name: 'mdxAiChat', renderer: token =>
      `<div class="mdx-ai-chat" data-mdx-ai-prompt="${escapeHTML(token.prompt)}"></div>\n` });
    context.registerSyntaxExtension(extension);
    this.cleanups.push(context.on('domUpdated', ({ element, options }: {
      element: HTMLElement; options?: { blockIndex?: number };
    }) => {
      const path = context.getDocumentPath();
      if (path !== this.path) {
        this.lifetime.abort();
        this.lifetime = new AbortController();
        this.drafts.clear();
        this.path = path;
      }
      const occurrences = new Map<string, number>();
      element.querySelectorAll<HTMLElement>('[data-mdx-ai-prompt]').forEach(panel => {
        const defaultPrompt = panel.dataset.mdxAiPrompt!;
        const index = occurrences.get(defaultPrompt) ?? 0;
        occurrences.set(defaultPrompt, index + 1);
        const key = JSON.stringify([path, options?.blockIndex ?? 'document', defaultPrompt, index]);
        if (panel.dataset.mdxAiMounted) return;
        panel.dataset.mdxAiMounted = 'true';
        let draft = this.drafts.get(key);
        if (!draft) {
          draft = { revision: 0, prompt: defaultPrompt, attachments: [], targets: [], busy: false, loading: true, status: '' };
          this.drafts.set(key, draft);
          this.loadTargets(draft, { documentPath: path, defaultPrompt });
        }
        this.mount(panel, draft, { documentPath: path, defaultPrompt });
      });
    }));
  }

  private async loadTargets(draft: Draft, source: AiChatSource): Promise<void> {
    const signal = this.lifetime.signal;
    try {
      const targets = await this.options.host.listTargets({ source, signal });
      if (signal.aborted) return;
      draft.targets = targets;
      draft.target = targets.find(target => target.id === this.options.defaultTarget?.id
        && target.kind === this.options.defaultTarget.kind) ?? targets[0];
      if (!draft.target) draft.status = '没有可用的 agent / flow';
    } catch (error) {
      if (!signal.aborted) draft.status = this.errorMessage(error);
    } finally {
      if (!signal.aborted) { draft.loading = false; draft.refresh?.(); }
    }
  }

  private mount(panel: HTMLElement, draft: Draft, source: AiChatSource): void {
    const signal = this.lifetime.signal;
    panel.innerHTML = `<form class="mdx-ai-chat__form">
      <select aria-label="选择 agent 或 flow"></select>
      <input class="mdx-ai-chat__prompt" aria-label="AI 提示词" placeholder="输入提示词">
      <button type="button" class="mdx-ai-chat__attach" aria-label="添加附件">+</button>
      <button type="submit" aria-label="发送">➤</button>
      <input type="file" multiple hidden>
      <div class="mdx-ai-chat__attachments"></div>
      <span class="mdx-ai-chat__status" role="status" aria-live="polite"></span>
    </form>`;
    const form = panel.querySelector('form')!;
    const select = panel.querySelector('select')!;
    const input = panel.querySelector<HTMLInputElement>('.mdx-ai-chat__prompt')!;
    const attach = panel.querySelector<HTMLButtonElement>('.mdx-ai-chat__attach')!;
    const send = panel.querySelector<HTMLButtonElement>('[type="submit"]')!;
    const files = panel.querySelector<HTMLInputElement>('[type="file"]')!;
    const attachments = panel.querySelector<HTMLElement>('.mdx-ai-chat__attachments')!;
    const status = panel.querySelector<HTMLElement>('[role="status"]')!;
    input.value = draft.prompt;

    const refresh = () => {
      select.replaceChildren(...draft.targets.map((target, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${target.kind}: ${target.label}`;
        option.selected = target === draft.target;
        return option;
      }));
      select.disabled = draft.busy || draft.loading;
      input.disabled = attach.disabled = draft.busy;
      send.disabled = draft.busy || draft.loading || !draft.target || !draft.prompt.trim();
      form.setAttribute('aria-busy', String(draft.busy));
      status.textContent = draft.busy ? '正在提交…' : draft.loading ? '加载 agent / flow…' : draft.status;
      attachments.replaceChildren(...draft.attachments.map((attachment, index) => {
        const remove = document.createElement('button');
        remove.type = 'button';
        const name = attachment.kind === 'file' ? attachment.file.name : attachment.name;
        remove.textContent = `${name} ×`;
        remove.setAttribute('aria-label', `移除附件 ${name}`);
        remove.disabled = draft.busy;
        remove.onclick = () => { draft.attachments.splice(index, 1); draft.revision++; refresh(); };
        return remove;
      }));
    };
    draft.refresh = refresh;
    input.oninput = () => { if (draft.prompt !== input.value) {draft.prompt = input.value; draft.revision++;} refresh(); };
    select.onchange = () => { const target = draft.targets[Number(select.value)];
      if (draft.target !== target) {draft.target = target; draft.revision++;} };
    files.onchange = () => {
      const selected = Array.from(files.files ?? []);
      if (selected.length) {draft.attachments.push(...selected.map(file => ({ kind: 'file' as const, file }))); draft.revision++;}
      files.value = '';
      refresh();
    };
    attach.onclick = async () => {
      if (draft.busy || signal.aborted) return;
      if (!this.options.host.pickAttachments) { files.click(); return; }
      draft.busy = true;
      refresh();
      try {
        const picked = await this.options.host.pickAttachments({ source, attachments: [...draft.attachments], signal });
        if (!signal.aborted && picked.length) {draft.attachments.push(...picked); draft.revision++;}
      } catch (error) {
        if (!signal.aborted) draft.status = this.errorMessage(error);
      } finally {
        if (!signal.aborted) { draft.busy = false; draft.refresh?.(); }
      }
    };
    form.onsubmit = async event => {
      event.preventDefault();
      if (draft.busy || draft.loading || !draft.target || !draft.prompt.trim() || signal.aborted) return;
      draft.busy = true;
      draft.status = '';
      refresh();
      try {
        if (!draft.submission || draft.submission.revision !== draft.revision)
          draft.submission = {revision: draft.revision, operationId: randomUUID()};
        await this.options.host.onSubmit({ operationId: draft.submission.operationId, prompt: draft.prompt, target: { ...draft.target },
          attachments: [...draft.attachments], source: { ...source }, signal });
        if (!signal.aborted) { draft.attachments = []; draft.submission = undefined; draft.revision++; draft.status = '已发送'; }
      } catch (error) {
        if (!signal.aborted) draft.status = this.errorMessage(error);
      } finally {
        if (!signal.aborted) { draft.busy = false; draft.refresh?.(); }
      }
    };
    refresh();
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  destroy(): void {
    this.lifetime.abort();
    this.cleanups.splice(0).forEach(cleanup => cleanup());
    this.drafts.clear();
  }
}

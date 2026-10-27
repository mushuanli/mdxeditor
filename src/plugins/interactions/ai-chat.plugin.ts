import type { MDxPlugin, PluginContext } from '../../core/types';
import type { AiChatAnchorState, AiChatAttachment, AiChatPluginOptions, AiChatSource, AiChatTarget } from './ai-chat.contracts';
import { lexicalExtension } from '../../renderer/worker-tokenizers';
import { escapeHTML } from '../../utils/html';
import {AiChatSelectionActions} from './ai-chat-selection';
import type {MDxEditor} from '../../editor/mdx-editor';
import {legacyAiChatLocations} from './ai-chat-markers';
import {createAiChatPreview} from './ai-chat-preview';
import type {MDxRenderer} from '../../renderer/mdx-renderer';
import {AI_CHAT_ICON, AI_CHAT_CHEVRON, AI_CHAT_SEND, AI_CHAT_SPINNER, AI_CHAT_ERROR} from './ai-chat-icons';
import { randomUUID } from '../../utils/random';

interface Draft {
  expanded: boolean;
  focusOnMount?: boolean;
  followLatest?: boolean;
  previewOpen: boolean;
  anchor?: AiChatAnchorState;
  anchorRead: number;
  anchorStatus?: string;
  stop?: () => void;
  preview?: MDxRenderer;
  revision: number;
  submission?: {revision: number; operationId: string};
  prompt: string;
  attachments: AiChatAttachment[];
  target?: AiChatTarget;
  targets: readonly AiChatTarget[];
  busy: boolean;
  loading: boolean;
  targetsRead?: Promise<void>;
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
  private selectionActions?: AiChatSelectionActions;

  constructor(private options: AiChatPluginOptions) {}

  install(context: PluginContext): void {
    const extension = lexicalExtension('mdxAiChat');
    extension.extensions!.push({ name: 'mdxAiChat', renderer: token =>
      `<div class="mdx-ai-chat" data-mdx-ai-prompt="${escapeHTML(token.prompt)}"></div>\n` });
    context.registerSyntaxExtension(extension);
    const anchors = lexicalExtension('mdxAiChatAnchor');
    anchors.extensions!.push({name: 'mdxAiChatAnchor', renderer: token =>
      `<span class="mdx-ai-chat mdx-ai-chat--anchor" data-mdx-ai-prompt="" data-mdx-ai-id="${escapeHTML(token.anchorId)}"></span>`});
    context.registerSyntaxExtension(anchors);
    if (this.options.host.createAnchor && this.options.selectionActions !== false)
      this.selectionActions = new AiChatSelectionActions(context, this.options.host, () => this.lifetime.signal, (source, selection) => {
        this.drafts.set(JSON.stringify([source.documentPath, 'anchor', source.anchorId]), {...this.newDraft(selection, true), focusOnMount: true});
      });
    this.cleanups.push(context.on('domUpdated', ({ element, options }: {
      element: HTMLElement; options?: { blockIndex?: number };
    }) => {
      const path = context.getDocumentPath();
      if (path !== this.path) {
        this.lifetime.abort();
        this.lifetime = new AbortController();
        this.drafts.forEach(draft => {draft.stop?.(); draft.preview?.destroy();}); this.drafts.clear();
        this.path = path;
      }
      const occurrences = new Map<string, number>();
      element.querySelectorAll<HTMLElement>('[data-mdx-ai-prompt]').forEach(panel => {
        const defaultPrompt = panel.dataset.mdxAiPrompt!, anchorId = panel.dataset.mdxAiId;
        const source = {documentPath: path, defaultPrompt, ...(anchorId ? {anchorId} : {})};
        const index = occurrences.get(defaultPrompt) ?? 0;
        occurrences.set(defaultPrompt, index + 1);
        const key = anchorId ? JSON.stringify([path, 'anchor', anchorId])
          : JSON.stringify([path, options?.blockIndex ?? 'document', defaultPrompt, index]);
        if (panel.dataset.mdxAiMounted) return;
        panel.dataset.mdxAiMounted = 'true';
        let draft = this.drafts.get(key);
        if (!draft) {
          draft = this.newDraft(defaultPrompt, !anchorId);
          this.drafts.set(key, draft);
        }
        this.mount(panel, draft, source, context);
      });
    }));
  }

  private newDraft(prompt: string, expanded: boolean): Draft {
    return {expanded, previewOpen: false, anchorRead: 0, revision: 0, prompt, attachments: [], targets: [], busy: false, loading: false, status: ''};
  }

  private activate(draft: Draft, source: AiChatSource): Promise<void> {
    if (!draft.targetsRead) {
      draft.loading = true;
      draft.targetsRead = this.loadTargets(draft, source);
      draft.refresh?.();
      if (source.anchorId) void this.loadAnchor(draft, source);
    }
    if (source.anchorId && this.options.host.observeAnchor && !draft.stop) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = this.options.host.observeAnchor({source, signal: this.lifetime.signal}, () => {
        if (timer !== undefined) return;
        timer = setTimeout(() => {timer = undefined; if (draft.expanded) void this.loadAnchor(draft, source);}, 150);
      });
      draft.stop = () => {if (timer !== undefined) clearTimeout(timer); stop();};
    }
    return draft.targetsRead;
  }

  private async loadTargets(draft: Draft, source: AiChatSource): Promise<void> {
    const signal = this.lifetime.signal;
    try {
      const [targets, preferred] = await Promise.all([
        this.options.host.listTargets({ source, signal }),
        this.options.host.getDefaultTarget?.({ source, signal }),
      ]);
      if (signal.aborted) return;
      draft.targets = targets;
      const preference = this.options.defaultTarget ?? preferred;
      draft.target = targets.find(target => target.id === preference?.id && target.kind === preference.kind)
        ?? targets.find(target => target.kind === 'agent' && target.id === 'default')
        ?? targets.find(target => target.kind === 'agent') ?? targets[0];
      if (!draft.target) draft.status = '没有可用的 agent / flow';
    } catch (error) {
      if (!signal.aborted) draft.status = this.errorMessage(error);
    } finally {
      if (!signal.aborted) { draft.loading = false; draft.refresh?.(); }
    }
  }

  private async promoteLegacy(panel: HTMLElement, draft: Draft, source: AiChatSource, context: PluginContext): Promise<void> {
    if (source.anchorId || !this.options.host.createAnchor) return;
    const editor = context.pluginManager.editorInstance as MDxEditor | undefined;
    if (!editor || editor.config.readOnly || editor.getMode() !== 'render' || !editor.container) return;
    const expected = editor.getText(), rows = [...editor.container.querySelectorAll<HTMLElement>('[data-mdx-ai-prompt]:not([data-mdx-ai-id])')]
      .filter(element => element.dataset.mdxAiPrompt === source.defaultPrompt);
    const location = legacyAiChatLocations(expected).filter(row => row.prompt === source.defaultPrompt)[rows.indexOf(panel)];
    if (!location) throw new Error('无法定位旧 AI 输入行，请用选区菜单重新插入');
    const anchorId = randomUUID(), signal = this.lifetime.signal;
    await this.options.host.createAnchor({source: {...source, anchorId}, selection: '', signal});
    signal.throwIfAborted();
    if (editor.getText() !== expected || editor.getMode() !== 'render') throw new Error('文档已改变，请重新发送');
    source.anchorId = anchorId;
    for (const [key, value] of this.drafts) if (value === draft) this.drafts.delete(key);
    this.drafts.set(JSON.stringify([source.documentPath, 'anchor', anchorId]), draft);
    const trailing = expected.slice(location.from, location.to).match(/(?:\r?\n[ \t]*)+$/)?.[0] ?? '';
    if (!editor.applySourceEdit(location.from, location.to, `::@${anchorId}@${trailing}`, expected)) throw new Error('文档已改变，请重新发送');
  }

  private async loadAnchor(draft: Draft, source: AiChatSource): Promise<void> {
    if (!source.anchorId || !this.options.host.getAnchor) return;
    const signal = this.lifetime.signal, generation = ++draft.anchorRead;
    try {
      const anchor = await this.options.host.getAnchor({source, signal, includeResponse: draft.previewOpen});
      if (signal.aborted || generation !== draft.anchorRead) return;
      draft.anchor = anchor;
      if (!draft.revision && !draft.prompt && anchor.defaultPrompt) draft.prompt = anchor.defaultPrompt;
      draft.anchorStatus = anchor.status === 'missing' ? '关联的分支已删除；再次发送会创建新分支' : '';
      draft.refresh?.();
    } catch (error) {
      if (!signal.aborted && generation === draft.anchorRead) {draft.anchorStatus = this.errorMessage(error); draft.refresh?.();}
    }
  }

  private mount(panel: HTMLElement, draft: Draft, source: AiChatSource, context: PluginContext): void {
    const signal = this.lifetime.signal;
    draft.preview?.destroy(); draft.preview = undefined;
    panel.innerHTML = `${source.anchorId ? `<button type="button" class="mdx-ai-chat__toggle" aria-label="展开 AI 输入">${AI_CHAT_ICON}</button>` : ''}<form class="mdx-ai-chat__form">
      <details class="mdx-ai-chat__target-picker">
        <summary class="mdx-ai-chat__target" aria-label="选择 agent 或 flow" aria-disabled="true"></summary>
        <div class="mdx-ai-chat__targets" role="group" aria-label="可用的 agent 和 flow"></div>
      </details>
      <textarea rows="1" class="mdx-ai-chat__prompt" aria-label="AI 提示词" placeholder="输入提示词"></textarea>
      <button type="button" class="mdx-ai-chat__attach" aria-label="添加附件">+</button>
      <button type="submit" aria-label="发送">${AI_CHAT_SEND}</button>
      ${this.options.host.getAnchor && source.anchorId ? `<button type="button" class="mdx-ai-chat__preview-toggle" aria-label="展开起始回复">${AI_CHAT_CHEVRON}</button>` : ''}
      <input type="file" multiple hidden>
      <div class="mdx-ai-chat__attachments"></div>
      <span class="mdx-ai-chat__status" role="status" aria-live="polite"></span>
    </form><section class="mdx-ai-chat__response" hidden><p class="mdx-ai-chat__activity" role="status" aria-live="polite"></p><div class="mdx-ai-chat__response-body" tabindex="0"></div>
      <button type="button" class="mdx-ai-chat__history" hidden>起始回复</button><button type="button" class="mdx-ai-chat__open">跳转到分支</button></section>`;
    const form = panel.querySelector('form')!;
    const picker = panel.querySelector<HTMLDetailsElement>('.mdx-ai-chat__target-picker')!;
    const trigger = picker.querySelector<HTMLElement>('summary')!;
    const choices = panel.querySelector<HTMLElement>('.mdx-ai-chat__targets')!;
    const input = panel.querySelector<HTMLTextAreaElement>('.mdx-ai-chat__prompt')!;
    const attach = panel.querySelector<HTMLButtonElement>('.mdx-ai-chat__attach')!;
    const send = panel.querySelector<HTMLButtonElement>('[type="submit"]')!;
    const files = panel.querySelector<HTMLInputElement>('[type="file"]')!;
    const attachments = panel.querySelector<HTMLElement>('.mdx-ai-chat__attachments')!;
    const status = panel.querySelector<HTMLElement>('[role="status"]')!;
    const toggle = panel.querySelector<HTMLButtonElement>('.mdx-ai-chat__toggle');
    const previewToggle = panel.querySelector<HTMLButtonElement>('.mdx-ai-chat__preview-toggle');
    const response = panel.querySelector<HTMLElement>('.mdx-ai-chat__response')!;
    const responseBody = panel.querySelector<HTMLElement>('.mdx-ai-chat__response-body')!;
    const open = panel.querySelector<HTMLButtonElement>('.mdx-ai-chat__open')!;
    const history = panel.querySelector<HTMLButtonElement>('.mdx-ai-chat__history')!;
    const activityStatus = panel.querySelector<HTMLElement>('.mdx-ai-chat__activity')!;
    let rendered: string | undefined | null = null;
    input.value = draft.prompt;
    const resizeInput = () => {input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`;};

    const refresh = () => {
      form.hidden = !draft.expanded;
      panel.classList.toggle('mdx-ai-chat--expanded', draft.expanded);
      toggle?.setAttribute('aria-expanded', String(draft.expanded));
      response.hidden = !draft.expanded || !draft.previewOpen;
      previewToggle?.setAttribute('aria-expanded', String(draft.previewOpen));
      open.hidden = !this.options.host.openConversation || draft.anchor?.status !== 'bound';
      if (input.value !== draft.prompt) input.value = draft.prompt;
      resizeInput();
      const activity = draft.anchor?.activity;
      const markdown = draft.followLatest && activity ? activity.markdown : draft.anchor?.response?.markdown;
      const state = draft.busy ? 'submitting' : activity?.status === 'pending' ? activity.markdown ? 'responding' : 'waiting' : activity?.status ?? 'ready';
      const label = state === 'submitting' ? '正在提交…' : state === 'waiting' ? '等待回复…' : state === 'responding' ? '正在回复…' : state === 'completed' ? '回复完成' : state === 'failed' ? '回复失败，请打开分支查看' : '';
      send.dataset.state = state; send.title = label || '发送';
      send.innerHTML = ['submitting', 'waiting', 'responding'].includes(state) ? AI_CHAT_SPINNER : state === 'failed' ? AI_CHAT_ERROR : AI_CHAT_SEND;
      activityStatus.textContent = label;
      history.hidden = !activity || !draft.anchor?.response || activity.id === draft.anchor.response.id;
      history.textContent = draft.followLatest ? '查看起始回复' : '查看最新回复';
      previewToggle?.setAttribute('aria-label', draft.previewOpen ? '收起回复' : '展开回复');
      if (draft.previewOpen && markdown === undefined) {
        draft.preview?.destroy(); draft.preview = undefined;
        responseBody.textContent = draft.anchor?.status === 'bound' ? '等待起始回复…' : '尚未关联分支';
      }
      if (draft.previewOpen && markdown !== rendered) {
        rendered = markdown;
        if (markdown !== undefined) {
          if (!draft.preview) responseBody.textContent = '正在渲染…';
          const preview = draft.preview ??= createAiChatPreview(context, source, signal);
          void preview.renderStreaming(responseBody, markdown).catch(error => {
            if (!signal.aborted && rendered === markdown && error?.name !== 'AbortError') responseBody.textContent = this.errorMessage(error);
          });
        }
      }
      trigger.textContent = draft.target?.label ?? (draft.loading ? '选择…' : '选择 agent / flow');
      trigger.title = draft.target ? `${draft.target.kind}: ${draft.target.label}` : '选择 agent 或 flow';
      trigger.setAttribute('aria-disabled', String(draft.busy || draft.loading));
      if (draft.busy || draft.loading) picker.open = false;
      choices.replaceChildren(...draft.targets.map(target => {
        const option = document.createElement('button');
        option.type = 'button';
        option.textContent = `${target.kind === 'flow' ? 'Flow · ' : ''}${target.label}`;
        option.setAttribute('aria-pressed', String(target === draft.target));
        option.disabled = draft.busy || draft.loading;
        option.onclick = () => {
          if (signal.aborted || draft.busy || draft.loading) return;
          if (draft.target !== target) {draft.target = target; draft.revision++;}
          picker.open = false; refresh(); trigger.focus();
        };
        return option;
      }));
      input.disabled = attach.disabled = draft.busy;
      send.disabled = draft.busy || draft.loading || !draft.target || !draft.prompt.trim();
      form.setAttribute('aria-busy', String(draft.busy));
      status.textContent = draft.busy ? '正在提交…' : draft.loading ? '加载 agent / flow…' : draft.anchorStatus || draft.status;
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
    if (toggle) toggle.onclick = () => {
      draft.expanded = !draft.expanded; refresh();
      if (draft.expanded) {void this.activate(draft, source); input.focus();}
    };
    if (previewToggle) previewToggle.onclick = () => {
      draft.previewOpen = !draft.previewOpen; refresh();
      if (draft.previewOpen) void this.loadAnchor(draft, source);
    };
    history.onclick = () => {draft.followLatest = !draft.followLatest; refresh();};
    open.onclick = async () => {
      try {await this.options.host.openConversation?.({source, signal});}
      catch (error) {if (!signal.aborted) {draft.status = this.errorMessage(error); refresh();}}
    };
    input.onkeydown = event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {event.preventDefault(); form.requestSubmit();}
    };
    form.addEventListener('focusin', () => {void this.activate(draft, source);});
    input.oninput = () => { if (draft.prompt !== input.value) {draft.prompt = input.value; draft.revision++;} refresh(); };
    trigger.onclick = event => {
      if (draft.busy || signal.aborted) {event.preventDefault(); return;}
      if (!draft.target && !draft.loading) draft.targetsRead = undefined;
      if (!draft.targetsRead || draft.loading) {
        event.preventDefault();
        void this.activate(draft, source).then(() => {if (!signal.aborted && draft.targets.length) picker.open = true;});
      }
    };
    picker.onkeydown = event => {if (event.key === 'Escape') {picker.open = false; trigger.focus();}};
    form.addEventListener('paste', event => {
      if (draft.busy || signal.aborted || !event.clipboardData) return;
      const files = Array.from(event.clipboardData.files);
      const pasted = files.length ? files : Array.from(event.clipboardData.items)
        .filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => !!file);
      if (!pasted.length) return;
      event.preventDefault();
      draft.attachments.push(...pasted.map(file => ({kind: 'file' as const, file})));
      draft.revision++; refresh();
    });
    files.onchange = () => {
      const selected = Array.from(files.files ?? []);
      if (selected.length) {draft.attachments.push(...selected.map(file => ({ kind: 'file' as const, file }))); draft.revision++;}
      files.value = '';
      refresh();
    };
    attach.onclick = async () => {
      void this.activate(draft, source);
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
      if (!draft.targetsRead || draft.loading) await this.activate(draft, source);
      if (draft.busy || draft.loading || !draft.target || !draft.prompt.trim() || signal.aborted) return;
      draft.busy = true;
      draft.status = '';
      refresh();
      try {
        if (!source.anchorId && this.options.host.createAnchor) await this.promoteLegacy(panel, draft, source, context);
        if (!draft.submission || draft.submission.revision !== draft.revision)
          draft.submission = {revision: draft.revision, operationId: randomUUID()};
        await this.options.host.onSubmit({ operationId: draft.submission.operationId, prompt: draft.prompt, target: { ...draft.target },
          attachments: [...draft.attachments], source: { ...source }, signal });
        if (!signal.aborted) {
          const operationId = draft.submission!.operationId;
          draft.attachments = []; draft.submission = undefined; draft.revision++;
          if (source.anchorId && this.options.host.getAnchor) {
            draft.followLatest = true; draft.previewOpen = true; draft.status = '';
            draft.anchor = {...draft.anchor, status: 'bound', activity: {id: operationId, operationId, status: 'pending', markdown: ''}};
            void this.activate(draft, source); void this.loadAnchor(draft, source);
          } else draft.status = '已发送';
        }
      } catch (error) {
        if (!signal.aborted) draft.status = this.errorMessage(error);
      } finally {
        if (!signal.aborted) { draft.busy = false; draft.refresh?.(); }
      }
    };
    refresh();
    if (draft.focusOnMount) {draft.focusOnMount = false; void this.activate(draft, source); input.focus();}
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  destroy(): void {
    this.lifetime.abort();
    this.selectionActions?.destroy(); this.drafts.forEach(draft => {draft.stop?.(); draft.preview?.destroy();});
    this.cleanups.splice(0).forEach(cleanup => cleanup());
    this.drafts.clear();
  }
}

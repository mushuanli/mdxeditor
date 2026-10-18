import type { Tokens } from 'marked';
import type { MDxPlugin, PluginContext } from '../../core/types';
import { escapeHTML } from '../../utils/html';

export interface PlaygroundPluginOptions {
  /** Preview height in pixels. Defaults to 360. */
  height?: number;
}

type Language = 'html' | 'css' | 'js';
interface Source { pre: HTMLPreElement; language: Language; code: string; }
interface Playground {
  sources: Source[];
  source: HTMLElement;
  panel: HTMLElement;
  preview: HTMLButtonElement;
  code: HTMLButtonElement;
  rerun: HTMLButtonElement;
  actions: HTMLElement;
  codeControls?: HTMLElement;
  codeActions?: HTMLElement;
  status: HTMLElement;
  frame?: HTMLIFrameElement;
  snapshot?: string;
}

// The first policy in the preview applies before any user markup is parsed.
// Sandboxing alone does not restrict resource requests.
const RESOURCE_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; " +
  "frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** JSON embedded in a script must never contain HTML parser delimiters. */
function scriptJSON(value: string[]): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function previewDocument(sources: Source[]): string {
  const html = sources.filter(source => source.language === 'html').map(source => source.code).join('\n');
  const css = sources.filter(source => source.language === 'css').map(source => source.code);
  const js = sources.filter(source => source.language === 'js').map(source => source.code);
  // Create style/script nodes inside the sandbox so strings such as </script>
  // and </style> in separate source blocks retain their original meaning.
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${RESOURCE_POLICY}">
<script>for (const css of ${scriptJSON(css)}) {
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
}</script></head><body>${html}
<script>for (const code of ${scriptJSON(js)}) {
  const script = document.createElement('script'); script.textContent = code; document.body.append(script);
}</script></body></html>`;
}

function metadata(info: string | undefined): { language: Language; group?: string } | undefined {
  const [name, ...flags] = (info ?? '').trim().split(/\s+/);
  const language = name === 'javascript' ? 'js' : name;
  if (language !== 'html' && language !== 'css' && language !== 'js') return;
  const groups = flags.filter(flag => flag.startsWith('playground='));
  if (groups.length === 1) {
    const group = groups[0].slice('playground='.length);
    if (group.length <= 128 && /^[^\s"'<>`=]+$/u.test(group)) return { language, group };
  }
  if (groups.length === 0 && language === 'html' && flags.includes('live')) return { language };
}

/** Explicitly marked browser examples, executed only on a user click. */
export class PlaygroundPlugin implements MDxPlugin {
  name = 'interaction:playground';
  private height: number;
  private cleanup?: () => void;
  private root?: HTMLElement;
  private observer?: MutationObserver;
  private playgrounds = new Map<string, Playground>();

  constructor(options: PlaygroundPluginOptions = {}) {
    this.height = Number.isFinite(options.height) && options.height! > 0 ? options.height! : 360;
  }

  install(context: PluginContext): void {
    context.registerSyntaxExtension({ renderer: {
      code(token: Tokens.Code) {
        const meta = metadata(token.lang);
        if (!meta) return false;
        const group = meta.group === undefined ? '' : ` data-mdx-playground-group="${escapeHTML(meta.group)}"`;
        const language = token.lang!.trim().split(/\s+/)[0];
        return `<pre data-mdx-playground="${meta.language}"${group}><code class="language-${language}">${escapeHTML(token.text)}</code></pre>\n`;
      },
    } });
    this.cleanup = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
      const root = element.closest<HTMLElement>('.mdx-editor-renderer') ?? element;
      if (root !== this.root) {
        this.releaseRoot();
        this.root = root;
        // Streaming truncation can remove blocks without issuing domUpdated.
        this.observer = new MutationObserver(records => {
          if (records.some(record => Array.from(record.removedNodes).some(node =>
            node instanceof Element && (node.matches('pre[data-mdx-playground]') ||
              node.querySelector('pre[data-mdx-playground]'))))) this.refresh(root);
        });
        this.observer.observe(root, { childList: true, subtree: true });
      }
      this.refresh(root);
    });
  }

  private refresh(root: HTMLElement): void {
    const groups = new Map<string, Source[]>();
    let liveIndex = 0;
    for (const pre of root.querySelectorAll<HTMLPreElement>('pre[data-mdx-playground]')) {
      const language = pre.dataset.mdxPlayground;
      if (language !== 'html' && language !== 'css' && language !== 'js') continue;
      const code = pre.querySelector('code');
      if (!code) continue;
      const group = pre.dataset.mdxPlaygroundGroup;
      const key = group === undefined ? `live:${liveIndex++}` : `group:${group}`;
      const sources = groups.get(key) ?? [];
      sources.push({ pre, language, code: code.textContent ?? '' });
      groups.set(key, sources);
    }

    for (const [key, state] of this.playgrounds) {
      if (!groups.has(key) || groups.get(key)![0].pre !== state.sources[0].pre || !root.contains(state.panel)) {
        this.dispose(state);
        this.playgrounds.delete(key);
      }
    }
    for (const [key, sources] of groups) {
      let state = this.playgrounds.get(key);
      if (!state) {
        state = this.create(sources, sources[0].pre.dataset.mdxPlaygroundGroup);
        this.playgrounds.set(key, state);
        state.source.before(state.panel);
      }
      state.sources = sources;
      const source = this.sourceElement(sources[0].pre);
      if (source !== state.source) {
        this.restoreActions(state);
        this.restoreSource(state.source);
        state.source = source;
      }
      this.mountActions(state);
      this.setView(state, state.panel.dataset.view === 'preview');
    }
  }

  private signature(sources: Source[]): string {
    return JSON.stringify(sources.map(({ language, code }) => [language, code]));
  }

  private sourceElement(pre: HTMLPreElement): HTMLElement {
    return pre.hasAttribute('data-enhanced') ? pre.parentElement! : pre;
  }

  private restoreSource(source: HTMLElement): void {
    source.classList.remove('mdx-playground-source');
    source.removeAttribute('data-mdx-playground-hidden');
  }

  private mountActions(state: Playground): void {
    const controls = state.source.querySelector<HTMLElement>(':scope > [data-mdx-code-controls]');
    if (!controls || controls === state.codeControls) return;
    const actions = controls.querySelector<HTMLElement>('[data-mdx-code-actions]');
    if (!actions) return;
    this.restoreActions(state);
    state.codeControls = controls;
    state.codeActions = actions;
    controls.setAttribute('data-mdx-code-controls-merged', '');
    state.actions.append(actions);
  }

  private restoreActions(state: Playground): void {
    if (state.codeControls && state.codeActions) {
      state.codeControls.append(state.codeActions);
      state.codeControls.removeAttribute('data-mdx-code-controls-merged');
    }
    state.codeControls = undefined;
    state.codeActions = undefined;
  }

  private setView(state: Playground, preview: boolean): void {
    state.panel.dataset.view = preview ? 'preview' : 'code';
    state.source.classList.add('mdx-playground-source');
    state.source.toggleAttribute('data-mdx-playground-hidden', preview);
    if (state.frame) state.frame.hidden = !preview;
    state.preview.setAttribute('aria-pressed', String(preview));
    state.code.setAttribute('aria-pressed', String(!preview));
    state.actions.hidden = preview;
    state.rerun.disabled = !state.frame;
    const stale = !!state.frame && state.snapshot !== this.signature(state.sources);
    state.rerun.toggleAttribute('data-stale', stale);
    state.rerun.title = stale ? '代码已更新，点击刷新预览' : '刷新预览';
    state.status.textContent = state.frame
      ? (stale ? '代码已更新，请刷新预览'
        : preview ? '预览已启动' : '预览已保留')
      : '点击预览以运行代码';
  }

  private create(sources: Source[], group?: string): Playground {
    const panel = document.createElement('section');
    panel.className = 'mdx-playground';
    panel.setAttribute('aria-label', group === undefined ? '代码预览' : `代码预览 ${group}`);
    const toolbar = document.createElement('div');
    toolbar.className = 'mdx-playground__toolbar';
    const label = document.createElement('span');
    label.className = 'mdx-playground__label';
    label.textContent = group === undefined ? 'HTML 预览' : group;
    const preview = document.createElement('button');
    preview.type = 'button'; preview.textContent = '预览';
    const code = document.createElement('button');
    code.type = 'button'; code.textContent = '代码';
    const rerun = document.createElement('button');
    rerun.type = 'button'; rerun.textContent = '刷新'; rerun.disabled = true;
    const actions = document.createElement('div');
    actions.className = 'mdx-playground__actions';
    const status = document.createElement('span');
    status.className = 'mdx-playground__status';
    status.setAttribute('role', 'status');
    toolbar.append(label, preview, rerun, code, actions, status);
    panel.append(toolbar);
    const state: Playground = { sources, source: this.sourceElement(sources[0].pre), panel,
      preview, code, rerun, actions, status };
    preview.onclick = event => {
      event.stopPropagation();
      if (state.frame) this.setView(state, true); else this.run(state, group);
    };
    code.onclick = event => { event.stopPropagation(); this.setView(state, false); };
    rerun.onclick = event => { event.stopPropagation(); this.run(state, group); };
    return state;
  }

  private run(state: Playground, group?: string): void {
    // Read the entire current group, including blocks added later by streaming.
    if (this.root) this.refresh(this.root);
    if (!this.root?.contains(state.panel)) return;
    this.stop(state);
    const frame = document.createElement('iframe');
    frame.className = 'mdx-playground__frame';
    frame.title = group === undefined ? 'HTML 运行结果' : `${group} 运行结果`;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
    frame.referrerPolicy = 'no-referrer';
    frame.style.height = `${this.height}px`;
    frame.srcdoc = previewDocument(state.sources);
    state.frame = frame;
    state.snapshot = this.signature(state.sources);
    state.panel.append(frame);
    this.setView(state, true);
  }

  private stop(state: Playground): void {
    state.frame?.remove();
    state.frame = undefined;
    state.snapshot = undefined;
    this.setView(state, false);
  }

  private dispose(state: Playground): void {
    this.stop(state);
    state.preview.onclick = null;
    state.code.onclick = null;
    state.rerun.onclick = null;
    this.restoreActions(state);
    this.restoreSource(state.source);
    state.panel.remove();
  }

  private releaseRoot(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    for (const state of this.playgrounds.values()) this.dispose(state);
    this.playgrounds.clear();
    this.root = undefined;
  }

  destroy(): void {
    this.cleanup?.();
    this.cleanup = undefined;
    this.releaseRoot();
  }
}

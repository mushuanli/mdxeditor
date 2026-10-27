/** Host-owned execution target. IDs are opaque to the editor. */
export interface AiChatTarget {
  id: string;
  kind: 'agent' | 'flow';
  label: string;
}

/** Files stay local until the host accepts a submission. Existing assets use opaque references. */
export type AiChatAttachment =
  | { kind: 'file'; file: File }
  | { kind: 'reference'; id: string; name: string; mimeType?: string };

export interface AiChatSource {
  /** Stable authored ::@id@ anchor; the host scopes it to the owning document. */
  anchorId?: string;
  documentPath?: string;
  /** Authored text after ::@; the draft does not modify the Markdown. */
  defaultPrompt: string;
}

export interface AiChatSubmitRequest {
  /** Stable for this draft revision and its retries; hosts use it for idempotent admission. */
  operationId: string;
  prompt: string;
  target: AiChatTarget;
  attachments: readonly AiChatAttachment[];
  source: AiChatSource;
  signal: AbortSignal;
}

export interface AiChatSubmitResult {
  /** Optional receipt for the branch created by the host. Never interpreted by mdxeditor. */
  branchId?: string;
}

export interface AiChatAnchorContext {source: AiChatSource; signal: AbortSignal; includeResponse?: boolean}
export interface AiChatAnchorState {
  defaultPrompt?: string;
  selection?: string;
  status: 'unbound' | 'bound' | 'missing';
  /** Fixed initial response; complete history stays in the host. */
  response?: {id: string; markdown: string; status?: 'pending' | 'completed' | 'failed'};
  /** Latest accepted turn; independent of the fixed initial response. */
  activity?: {id: string; operationId?: string; markdown?: string; status: 'pending' | 'completed' | 'failed'};
}
export interface AiChatCreateAnchorRequest extends AiChatAnchorContext {
  source: AiChatSource & {anchorId: string};
  selection: string;
}

export interface AiChatHost {
  /** Called by explicit render-mode insertion or legacy submission, never ordinary Markdown reads. */
  createAnchor?(request: AiChatCreateAnchorRequest): Promise<void>;
  /** Host owns document metadata, branch identity, deletion and reconciliation. */
  getAnchor?(context: AiChatAnchorContext): Promise<AiChatAnchorState>;
  openConversation?(context: AiChatAnchorContext): Promise<void>;
  observeAnchor?(context: AiChatAnchorContext, changed: () => void): () => void;
  /** Host preference, e.g. the current Session agent. IDs use the same opaque values as listTargets. */
  getDefaultTarget?(context: {source: AiChatSource; signal: AbortSignal}):
    {kind: AiChatTarget['kind']; id: string} | undefined | Promise<{kind: AiChatTarget['kind']; id: string} | undefined>;
  listTargets(context: { source: AiChatSource; signal: AbortSignal }):
    readonly AiChatTarget[] | Promise<readonly AiChatTarget[]>;
  /** Resolve when the host has accepted the request and created/started its branch.
   * Reject on failure. Report actual generation separately through getAnchor/observeAnchor. */
  onSubmit(request: AiChatSubmitRequest): Promise<AiChatSubmitResult | void>;
  /** Optional VFS/library picker; without this callback the plugin offers local files. */
  pickAttachments?(context: {
    source: AiChatSource;
    attachments: readonly AiChatAttachment[];
    signal: AbortSignal;
  }): Promise<readonly AiChatAttachment[]>;
}

export interface AiChatPluginOptions {
  host: AiChatHost;
  /** Selection actions require createAnchor and a writable MDxEditor in render mode. */
  selectionActions?: boolean;
  defaultTarget?: { kind: AiChatTarget['kind']; id: string };
}

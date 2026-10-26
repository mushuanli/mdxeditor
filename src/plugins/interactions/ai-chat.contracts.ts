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

export interface AiChatHost {
  listTargets(context: { source: AiChatSource; signal: AbortSignal }):
    readonly AiChatTarget[] | Promise<readonly AiChatTarget[]>;
  /** Resolve when the host has accepted the request and created/started its branch.
   * Reject on failure. Streaming output and branch presentation belong to the host. */
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
  defaultTarget?: { kind: AiChatTarget['kind']; id: string };
}

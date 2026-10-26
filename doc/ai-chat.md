# AI Chat 输入插件

`AiChatPlugin` 按需启用。预览模式将独立行 `::@ 默认提示词` 显示为
`[当前 Agent 文字按钮] [默认提示词输入框] [+ 附件] [发送]`。点击 Agent 名称展开候选列表，选择后自动收起；键盘 Enter/Space 可展开，Escape 收起。
`::@` 可不带默认提示词；代码围栏和行内文字中的标记不触发。
编辑模式保留 Markdown 源码，输入框草稿不回写文档。

```ts
import { AiChatPlugin, type AiChatHost } from '@itookit/mdxeditor';

const host: AiChatHost = {
  listTargets: async ({ source, signal }) => [
    { kind: 'agent', id: 'assistant', label: 'Assistant' },
    { kind: 'flow', id: 'review', label: 'Review' },
  ],
  async onSubmit(request) {
    // 在宿主中：解析文档所属上下文、处理附件、创建 branch、启动执行。
    // request 包含 operationId / prompt / target / attachments / source / signal。
    // 返回 branchId 可作为回执；插件不解释它，也不负责显示 branch。
    await applicationSubmit(request);
  },
};
editor.use(new AiChatPlugin({ host,
  defaultTarget: { kind: 'agent', id: 'assistant' },
}));
```

`applicationSubmit` 是宿主提供的实现。也可在工厂的 `plugins` 配置中使用
`['interaction:ai-chat', { host }]`。插件已注册，但未加入默认插件列表。
所有契约从包根导出，见 `src/plugins/interactions/ai-chat.contracts.ts`。

## 回调约定

同一次草稿修订及其失败重试保留 `operationId`；修改提示词、目标或附件后，下次提交分配新 ID。成功后再次发送是新操作。宿主应持久记录该 ID，上传、创建 branch 和启动执行都沿原 ID 核对，不能因回调重试改为新的执行身份。

- `getDefaultTarget?({ source, signal })`：返回宿主当前目标的 `{kind, id}`，例如当前 Session 的 Agent；ID 必须与候选目录一致。显式 `defaultTarget` 优先，其次宿主偏好，再回退 `agent/default`、首个 Agent、首个目标。选择后的草稿不会被默认偏好覆盖。
- `listTargets({ source, signal })`：返回 agent/flow 列表，标识由宿主解释。每个输入行初次挂载时加载。
- 粘贴图片或文件会加入当前输入行附件，发送前可移除；纯文本保留浏览器正常粘贴行为。与文件选择一样，粘贴不自动上传，失败保留附件。
- `pickAttachments?({ source, attachments, signal })`：返回本次新增的附件；返回空列表表示取消。未提供时打开本地多文件选择器。
- `onSubmit(request)`：宿主接受请求、创建 branch 并启动执行后 resolve；失败 reject。插件提交期间禁用输入，拒绝重复提交；失败保留提示词与附件，成功清空附件并保留提示词。
- `AiChatAttachment`：本地 `{ kind: 'file', file: File }` 或宿主已有资源 `{ kind: 'reference', id, name, mimeType? }`。选择附件不自动上传；上传、权限、大小限制和资源生命周期由宿主负责。
- `source`：只有可选 `documentPath` 与原始 `defaultPrompt`。核心不推断 session、message、branch 或 namespace。
- `signal`：插件销毁或渲染到另一个文档路径时取消。宿主应在异步步骤中检查；已创建 branch 的回滚由宿主决定。

草稿只在插件实例内存中保存，以文档路径、渲染块、默认提示词和同名出现序号区分。
相同位置的完整/流式重渲染保留输入、附件和提交状态；修改默认提示词、调整块顺序或切换完整/流式渲染可能产生新草稿。
草稿不持久化，实例销毁或文档路径变化后释放。`defaultPrompt` 不是可靠的业务身份或消息定位信息。

## 后续 itookit / llm-ui 集成边界

建议 itookit 的 `ui/mdx-adapter` 构造 `AiChatHost`，用闭包绑定当前 session、来源消息和 branch 锚点。
`documentPath` 仅用于宿主校验/定位文档，不能直接当作 session ID。不同来源消息需要不同的宿主绑定。

建议的 `onSubmit` 流程（概念步骤，不代表已有 itookit API）：

1. 校验闭包中的来源消息、当前文档和所选 agent/flow；按需保存当前编辑内容。
2. 将 `File` 上传到宿主资源系统，将 `reference.id` 解析为执行所需的附件引用。
3. 在来源消息处创建子 branch，将提示词和附件作为新用户消息写入。
4. 根据 `target.kind` 启动 agent 或 flow；请求被接受后返回 `{ branchId }`。
5. 通过宿主状态管理打开/选中新 branch，把执行事件与流式输出交给 llm-ui 展示。

llm-ui 继续负责会话内容、消息状态、流式输出与 branch 导航。mdxeditor 提供输入入口，
不引入 llm-ui 依赖，也不接收模型 token 流。若需在文档附近展示执行结果，后续可由宿主
布局组合 llm-ui；当前接口不自动向 Markdown 插入回复。

创建 branch 与启动执行应由宿主封装为一个提交操作。若 branch 已创建但启动失败，
宿主应复用该 branch 重试或自行清理，避免用户点击重试产生孤立 branch。

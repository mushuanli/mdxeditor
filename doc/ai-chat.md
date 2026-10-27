# AI Chat 输入与只读回复预览

`interaction:ai-chat` / `AiChatPlugin` 按需启用，不进入默认插件列表。
所有类型从包根导出；核心不依赖 Session、VFS、itookit 或 llm-ui。

## 文档入口

- 兼容旧语法：独立行 `::@ 默认提示词`，直接显示输入行；代码围栏不触发。
- 稳定锚点：正文 `::@<id>@`，渲染为一个 SVG 小图标，点击展开输入行。
  ID 支持 1–128 个字母、数字、`_`、`-`，插入动作生成 UUID；多个锚点独立保存草稿。
- 可写编辑器的 render mode 中选择正文后，浮动菜单和 toolbar 共用“为选区插入 AI”。
  选中文字保留，标记插入选区末端，立即展开并将选中文字填入输入框、聚焦；无法证明 DOM 到源码的对应位置时提示重选，避免错插。
  源码修改走 CodeMirror 用户事务，支持 dirty、保存与撤销。
- 编辑模式、只读文档、回复预览及其他 AI 输入行中不提供选区插入。
- textarea 从一行自动增高，达到上限后内部滚动；Enter 换行，Ctrl/⌘+Enter 发送。
  点击当前 Agent 文字展开候选；Escape 收起。图片/文件粘贴加入附件，纯文本保持正常粘贴。

```ts
import {AiChatPlugin, type AiChatHost} from '@itookit/mdxeditor';

const host: AiChatHost = {
  listTargets: async ({source, signal}) => application.listTargets(source, signal),
  createAnchor: async request => application.createDocumentAnchor(request),
  getAnchor: async request => application.readDocumentAnchor(request),
  observeAnchor: (request, changed) => application.observeDocumentAnchor(request, changed),
  openConversation: async request => application.openDocumentBranch(request),
  onSubmit: async request => application.submitDocumentChat(request),
};
// application is the host's implementation, not an mdxeditor API.
editor.use(new AiChatPlugin({host}));
```

也可通过工厂 `plugins: [['interaction:ai-chat', {host}]]` 装配。
`selectionActions: false` 关闭选区菜单和 toolbar 插入，保留已存在的输入。
通用 toolbar 按钮可以声明 `modes: ['render']`，未声明者仍只在 edit mode 显示。

## 宿主回调

| 回调 | 职责 |
| --- | --- |
| `createAnchor({source, selection, signal})` | 用户明确插入时持久记录选区、锚点与文档关系；不启动模型 |
| `getAnchor({source, includeResponse, signal})` | 返回 `unbound/bound/missing`、默认提示词，以及可选的起始回复 Markdown、最新轮次 activity |
| `observeAnchor(context, changed)` | 通知关系或回复变化，返回取消订阅函数；插件合并密集通知 |
| `openConversation(context)` | 显式导航到绑定分支，核心不解释路由 |
| `onSubmit(request)` | 校验附件/目标，持久接纳一次提交；首次建立分支，后续复用分支 |
| `getDefaultTarget(context)` | 默认当前 Session/分支的 Agent 或 Flow，再回退 default |
| `listTargets(context)` | 返回宿主允许展示的 Agent/Flow，ID 不透明 |
| `pickAttachments(context)` | 可选宿主选择器；缺省为本地文件选择 |

`source` 包含 `anchorId? / documentPath? / defaultPrompt`。
`defaultPrompt` 和出现顺序均不能充当业务身份；锚点以文档身份 + anchorId 定位。
同一锚点复制到另一文档如何处理，由宿主决定。无 AI 的文档不调用 `createAnchor`。

`onSubmit` 收到 `operationId / prompt / target / attachments / source / signal`。
同一次草稿修订及失败重试保留 operationId；修改内容后是新操作；成功后再次发送也是新操作。
宿主应冻结原始提交请求并根据持久接纳回执核对，不能因为网络超时创建新的 Session。
`branchId` 返回值只是回执，核心不把它解释成 Session 或路由。
附件选择/粘贴不上传，提交失败保留；上传、大小限制、资源权限及清理由宿主管理。

旧 `::@ 提示词` 在宿主支持 createAnchor 且编辑器可写、处于 render mode 时，首次发送前迁移为
稳定锚点，原默认提示词交给宿主保存；纯 renderer 和未提供 createAnchor 的调用方式继续兼容。

## 回复预览

行末按钮可以展开/收起回复和“跳转到分支”。发送被宿主接纳后自动展开，显示最新轮次的回复。预览使用独立 `MDxRenderer`，固定只读，
流式更新复用 `renderStreaming` / `StreamingDiffer`。不构造 MDxEditor、CodeMirror、toolbar 或模式切换。
子 renderer 不安装 AI Chat/选区插件，`::@` 只作为普通文本；允许复制回复文字，不提供嵌套 AI。
原始 HTML 按 literal 渲染，危险链接协议被移除。预览有独立高度上限和滚动条。
当前预览范围为 Markdown 文本，不装配 llm-ui 工具卡片、执行控制或 Session 附件解析；
完整会话、交互与后续轮次由“跳转到分支”进入宿主页面查看。

宿主通过 `getAnchor.response` 固定返回初始 round/响应；`activity` 返回最新接纳轮次的
`id / operationId? / status / markdown?`。status 为 `pending/completed/failed`。
发送回调完成只表示已接纳；发送图标在等待或回复期间旋转，完成后恢复，失败显示错误图标。
有部分 Markdown 时显示“正在回复”，尚无内容时显示“等待回复”；不根据接纳回执宣称回复完成。
后续发送跟随最新回复，并提供切回起始回复的按钮；只收起预览不会取消执行。
`includeResponse: false` 允许宿主只返回状态；展开时再提供正文。

仅渲染文档时不获取 Agent 列表、关系或订阅；用户展开或操作输入后才激活宿主能力。
点击发送后文档继续打开；后续消息追加原分支，删除分支后的策略与提示由宿主提供。

## 元数据与反向链接

核心只处理可见标记和回调，不读写业务 metadata，也不推断 Session/project/namespace。
宿主应维护一条规范关系记录，文档 metadata 保存关系 ID 及必要投影，
分支反向索引指向同一记录。文档改名、复制、撤销、删除分支、离线文件修复均由宿主协调。
保存时可用导出的 `aiChatAnchorIds(markdown)` 获取真实锚点；它使用相同词法扩展排除代码和原始 HTML。
不要通过全局正则把代码示例也当作活跃关系。

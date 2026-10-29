# mdx 插件目录

## MDxEditor

实现 `IEditor`。`createMDxEditor(container, options)` 返回实例。支持 edit/render 双模式。

## MDxPlugin 接口

```typescript
interface MDxPlugin {
    name: string;
    install(ctx: PluginContext): void;
    destroy?(): void;
}
```

## 核心插件一览

| 类别 | 插件 | 功能 |
|---|---|---|
| 语法 | `MermaidPlugin` | Mermaid 图表 |
| | `MathJaxPlugin` | LaTeX 公式 |
| | `FoldablePlugin` | 可折叠块 |
| | `CalloutPlugin` | Callout |
| 交互 | `TaskListPlugin` | 任务列表 toggle |
| | `TablePlugin` | 表格编辑 |
| | `CodeBlockControlsPlugin` | 代码块复制/下载/折叠 |
| | `PlaygroundPlugin` | HTML/CSS/JS 隔离预览，单块或同名分组运行 |
| 自动完成 | `MentionPlugin` | @-mention |
| | `TagPlugin` | #-tag 自动完成 |
| Anki | `ClozePlugin` / `MemoryPlugin` | 完形填空/间隔重复 |
| UI | `ToolbarPlugin` / `TitleBarPlugin` | 工具栏/标题栏；`ui:toolbar` 在 edit 模式显示，render 模式隐藏整行 |

## 宿主与数据适配

插件通过 `PluginContext.getAssets()`、`getDocumentPath()`、`getScopedStore()` 和 `notify()` 访问公共能力；使用 `registerCodeMirrorExtension` / `registerSyntaxExtension` 注册扩展。

`context.renderMarkdown(markdown, options)` 解析内部片段，复用外层语法扩展与 HTML 策略，不执行生命周期钩子。异步 `afterRender` 钩子必须返回转换后的 `{ html, options }`，保留其他插件携带的 options。`FoldablePlugin` 使用此入口，避免内部解析绕过宿主的 `htmlPolicy`。

插件生成 `<details data-mdx-disclosure-key="stable-key">` 可保留展开状态；同一渲染器内 key 须唯一。`FoldablePlugin` 使用 `data-mdx-disclosure` 自动生成基于摘要和出现次序的 key。代码块控件根据代码内容及出现次序生成 key，也支持宿主在 `pre` 上显式提供 `data-mdx-disclosure-key`。状态只在实例内存保留，销毁时清理。

`MentionProvider`、`AutocompleteProvider` 和 `TagPluginOptions.getTags` 接收用户自己的查询实现。MindOS 的 VFS、附件管理和会话打印由 `@itookit/mdx-adapter` 接入，核心插件不导入内部业务包。

`CoreTitleBarPluginOptions.mountActions` 向现有标题栏右侧挂载宿主通用控件，返回清理函数。`overflowActions: true` 将次要按钮收进原标题栏更多菜单；默认不启用，宿主可按产品需要配置。保留原按钮与回调，标题输入仍负责文件重命名，核心不实现窗口列表和项目导航。

`presentButton(id, button)` 可在按钮创建时定制响应式图标和可访问名称，并返回销毁时释放监听的函数；它不替换核心按钮的异步点击处理管线。

## HTML/CSS/JS 在线预览

`PlaygroundPlugin` 在编辑器工厂中默认启用，注册名为 `playground`；通过 `plugins: ['-playground']` 禁用。
直接使用渲染器时调用 `renderer.usePlugin(new PlaygroundPlugin({ height: 360 }))`，并引入包的样式。
`height` 是预览高度（像素），默认 360。

独立演示使用 `html live`，可以包含 `<style>`、`<script>`，也可以写完整 HTML 文档：

````markdown
```html live
<button id="hello">点击</button>
<script>
document.querySelector('#hello').onclick = () => {
  document.querySelector('#hello').textContent = 'Hello!';
};
</script>
```
````

分开的代码块使用同一个 `playground=名称`。名称区分大小写，不含空白、引号、尖括号、反引号或等号，最多 128 字符；每个分组在首个代码块上方显示一套运行控件，避免长代码把按钮推到屏幕外：

````markdown
```html playground=demo
<button id="hello">点击</button>
```

代码块之间可以插入解释文字。

```css playground=demo
button { color: royalblue; }
```

```js playground=demo
document.querySelector('#hello').onclick = () => {
  document.querySelector('#hello').textContent = 'Hello!';
};
```
````

支持 `html`、`css`、`js` 和 `javascript`。同一渲染器内，同名分组的 HTML 按文档顺序拼接，CSS 在页面内容前加载，JS 在页面内容后按文档顺序执行。
各分组和每个 `html live` 块使用独立 iframe；普通代码块不参与运行。分组 JS 按浏览器经典脚本执行，不提供 Node.js、TypeScript、JSX 或 npm 构建环境。

代码块原位置使用单行工具栏：`HTML 预览 | 预览 | 刷新 | 代码 ... 下载 / 复制 / 折叠`，默认显示代码。
右侧图标直接移动原代码块按钮，仅在代码视图显示，不重建按钮或改变折叠、复制和下载行为；未安装代码块控件时只显示前三个操作。
首次点击“预览”才创建 iframe，运行结果替换该处代码的显示，不额外占用一块预览区域。运行前“刷新”禁用，刷新后显示新的预览。
切回“代码”保留原有复制、下载、折叠控件与折叠状态，同时保留 iframe；再次切到“预览”继续原来的运行状态。
“刷新”创建新的 iframe。替换首个代码块或销毁插件会移除 iframe；卸载 Playground 会把原代码块按钮还原到其工具栏。
分组在首个代码块处显示组合预览，其余 HTML/CSS/JS 代码块和解释文字保留在原位置。
流式更新通过现有 `StreamingDiffer` 渲染，同组后续代码发生变化时保留仍在运行的 iframe，并标记“刷新”按钮提示代码已更新。
完整重渲染（包括结束流式渲染）会关闭预览，需要再次点击“预览”。

预览使用 `srcdoc` 与 `sandbox="allow-scripts"`，不开放同源、弹窗、表单或宿主接口权限。
CSP 限制外部脚本、样式、图片和网络请求，只允许内联代码及指定的 data/blob 资源，因此 CDN、相对路径附件和远程 API 默认不可用。
这不是进程级隔离或 CPU 限额，不适合运行恶意代码。宿主 CSP 仍可能进一步限制内联脚本；Tauri/WebView 宿主需按实际策略验证。
`htmlPolicy` 继续只控制 Markdown 中的原始 HTML；显式标记的代码块由此插件提供隔离运行能力，宿主若不需要执行功能可禁用 `playground`。

### AI Chat（按需启用）

`interaction:ai-chat` / `AiChatPlugin` 支持独立行 `::@ 默认提示词` 和内联稳定锚点 `::@id@`，提供 render-only 选区插入、迷你图标、自动增高输入与独立只读回复预览。宿主提供 `AiChatHost`，负责创建 branch 与执行；详见 [接口与集成约定](./ai-chat.md)。

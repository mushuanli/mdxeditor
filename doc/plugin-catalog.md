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
| | `CodeBlockControlsPlugin` | 代码块复制/运行 |
| 自动完成 | `MentionPlugin` | @-mention |
| | `TagPlugin` | #-tag 自动完成 |
| Anki | `ClozePlugin` / `MemoryPlugin` | 完形填空/间隔重复 |
| UI | `ToolbarPlugin` / `TitleBarPlugin` | 工具栏/标题栏 |

## 宿主与数据适配

插件通过 `PluginContext.getAssets()`、`getDocumentPath()`、`getScopedStore()` 和 `notify()` 访问公共能力；使用 `registerCodeMirrorExtension` / `registerSyntaxExtension` 注册扩展。

`context.renderMarkdown(markdown, options)` 解析内部片段，复用外层语法扩展与 HTML 策略，不执行生命周期钩子。异步 `afterRender` 钩子必须返回转换后的 `{ html, options }`，保留其他插件携带的 options。`FoldablePlugin` 使用此入口，避免内部解析绕过宿主的 `htmlPolicy`。

插件生成 `<details data-mdx-disclosure-key="stable-key">` 可保留展开状态；同一渲染器内 key 须唯一。`FoldablePlugin` 使用 `data-mdx-disclosure` 自动生成基于摘要和出现次序的 key。代码块控件根据代码内容及出现次序生成 key，也支持宿主在 `pre` 上显式提供 `data-mdx-disclosure-key`。状态只在实例内存保留，销毁时清理。

`MentionProvider`、`AutocompleteProvider` 和 `TagPluginOptions.getTags` 接收用户自己的查询实现。MindOS 的 VFS、附件管理和会话打印由 `@itookit/mdx-adapter` 接入，核心插件不导入内部业务包。

`CoreTitleBarPluginOptions.mountActions` 向现有标题栏右侧挂载宿主通用控件，返回清理函数。`overflowActions: true` 将次要按钮收进原标题栏更多菜单；默认不启用，宿主可按产品需要配置。保留原按钮与回调，标题输入仍负责文件重命名，核心不实现窗口列表和项目导航。

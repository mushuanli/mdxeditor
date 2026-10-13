// @file: mdx/core/print.service.ts

import { MDxRenderer } from '../../renderer/mdx-renderer';
import type { MDxRendererConfig } from '../../renderer/mdx-renderer';
import { showPrintOptionsDialog } from './print-options';

// ✅ 从常量文件导入样式
import { PRINT_STYLES } from './print.styles';

/**
 * 打印配置选项
 */
export interface PrintOptions {
    /** 文档标题 */
    title?: string;
    /** File name used as the print title; its final extension is omitted. */
    fileName?: string;
    /** Show the file name in the print header (default: true). */
    showFileName?: boolean;
    /** Locale for the print options dialog. */
    locale?: 'zh-CN' | 'en';

    /** 自定义样式（CSS 字符串或数组） */
    styles?: string | string[];

    /** 是否显示页眉 */
    showHeader?: boolean;

    /** 页眉元数据 */
    headerMeta?: {
        author?: string;
        date?: string;
        version?: string;
        [key: string]: string | undefined;
    };

    /** 打印前的 HTML 处理钩子 */
    beforePrint?: (html: string) => string;

    /** 打印后是否自动关闭预览窗口 */
    autoClose?: boolean;

    /** 布局变体 */
    variant?: 'default' | 'compact';

    /** 纸张大小 */
    pageSize?: 'A4' | 'Letter' | 'Legal';

    /** 正文字体大小 */
    fontSize?: 'small' | 'normal' | 'large';
}

/**
 * 打印服务接口
 */
export interface PrintService {
    /**
     * 将 Markdown 渲染为可打印的 HTML
     */
    renderForPrint(markdown: string, options?: PrintOptions): Promise<string>;

    /**
     * 打开打印预览窗口并触发打印（从 Markdown 渲染）
     */
    print(markdown: string, options?: PrintOptions): Promise<void>;

    /**
     * ✅ [新增] 直接使用 HTML 内容打印（跳过渲染步骤）
     */
    printFromHtml(html: string, options?: PrintOptions): Promise<void>;

    /**
     * 销毁服务，释放资源
     */
    destroy?(): void;
}

/**
 * 默认打印服务实现
 * 
 * 使用 MDxRenderer 确保渲染结果与编辑器一致，
 * 并应用 BEM 命名的打印专用样式。
 */
export class DefaultPrintService implements PrintService {
    private renderer: MDxRenderer | null = null;
    constructor(private readonly rendererOptions: MDxRendererConfig = {}) {}

    /**
     * 延迟初始化渲染器
     */
    private getRenderer(): MDxRenderer {
        if (!this.renderer) {
            this.renderer = new MDxRenderer({
                ...this.rendererOptions,
            });
        }
        return this.renderer;
    }

    /**
     * 获取完整的打印样式
     */
    private getStyles(options: PrintOptions): string {
        // ✅ 使用导入的常量
        let styles = PRINT_STYLES;

        // 添加页面大小样式
        if (options.pageSize && options.pageSize !== 'A4') {
            styles += `\n@page { size: ${options.pageSize}; }`;
        }

        // 添加字体大小覆盖
        if (options.fontSize) {
            const sizeMap: Record<string, string> = {
                small: '12px',
                normal: '14px',
                large: '16px',
            };
            const baseSize = sizeMap[options.fontSize] || '14px';
            styles += `\n.mdx-print { font-size: ${baseSize}; }`;
        }

        // 添加自定义样式
        if (options.styles) {
            const customStyles = Array.isArray(options.styles)
                ? options.styles.join('\n')
                : options.styles;
            styles += '\n/* Custom Styles */\n' + customStyles;
        }

        return styles;
    }

    /**
     * 解析打印选项：fontSize 未显式设置时弹出选择对话框
     */
    private async resolvePrintOptions(options: PrintOptions): Promise<PrintOptions | null> {
        if (options.fontSize) {
            return options;
        }
        const selected = await showPrintOptionsDialog(options.showFileName !== false, options.locale);
        return selected ? { ...options, ...selected } : null;
    }

    /**
     * 构建页眉 HTML
     */
    private buildHeader(options: PrintOptions): string {
        if (!options.showHeader) {
            return '';
        }

        const title = this.printTitle(options);
        const meta = options.headerMeta || {};

        let metaItems = '';

        if (meta.author) {
            metaItems += `<span class="mdx-print-header__meta-item">${this.escapeHtml(meta.author)}</span>`;
        }

        // Date is rendered only when the caller supplies it explicitly.
        if (meta.date) {
            metaItems += `<span class="mdx-print-header__meta-item">${this.escapeHtml(meta.date)}</span>`;
        }

        if (meta.version) {
            metaItems += `<span class="mdx-print-header__meta-item">v${this.escapeHtml(meta.version)}</span>`;
        }

        if (options.showFileName === false && !metaItems) return '';
        return `
            <header class="mdx-print-header">
                ${options.showFileName === false ? '' : `<h1 class="mdx-print-header__title">${this.escapeHtml(title)}</h1>`}
                ${metaItems ? `<div class="mdx-print-header__meta">${metaItems}</div>` : ''}
            </header>
        `;
    }

    /**
     * 渲染 Markdown 为可打印的 HTML
     */
    async renderForPrint(markdown: string, options: PrintOptions = {}): Promise<string> {
        const renderer = this.getRenderer();

        // 创建临时容器进行渲染
        const tempContainer = document.createElement('div');
        tempContainer.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;';
        document.body.appendChild(tempContainer);

        try {
            // 使用 MDxRenderer 渲染
            await renderer.render(tempContainer, markdown);
            let html = tempContainer.innerHTML;

            // 应用前置处理钩子
            if (options.beforePrint) {
                html = options.beforePrint(html);
            }

            return html;
        } finally {
            document.body.removeChild(tempContainer);
        }
    }

    /**
     * 打开打印预览窗口
     */
    async print(markdown: string, options: PrintOptions = {}): Promise<void> {
        const resolved = await this.resolvePrintOptions(options);
        if (!resolved) return;
        const contentHtml = await this.renderForPrint(markdown, resolved);
        await this.printFromHtml(contentHtml, resolved);
    }

    /**
     * ✅ [新增] 直接使用 HTML 内容打印
     */
    async printFromHtml(contentHtml: string, options: PrintOptions = {}): Promise<void> {
        const resolved = await this.resolvePrintOptions(options);
        if (!resolved) return;
        const styles = this.getStyles(resolved);
        const header = this.buildHeader(resolved);

        // 确定变体类名
        const variantClass = resolved.variant === 'compact' ? 'mdx-print--compact' : '';
        const headerClass = header.trim() ? '' : 'mdx-print--no-header';

        // 在主文档中创建打印容器，通过 @media print 隔离
        const containerId = 'mdx-print-overlay';
        let container = document.getElementById(containerId);
        if (!container) {
            container = document.createElement('div');
            container.id = containerId;
            document.body.appendChild(container);
        }

        // 注入打印专用样式：打印时仅显示此容器，并附加打印内容样式
        const styleId = 'mdx-print-overlay-style';
        let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = styleId;
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = `
            #${containerId} { display: none; }
            @media print {
                html, body {
                    overflow: visible !important;
                    height: auto !important;
                    position: static !important;
                }
                body > *:not(#${containerId}) { display: none !important; }
                #${containerId} {
                    display: block !important;
                    position: static !important;
                    width: auto !important;
                    overflow: visible !important;
                    height: auto !important;
                }
            }
            ${styles}
        `;

        // 打印前预处理：展开所有折叠内容
        contentHtml = this.preprocessHtmlForPrint(contentHtml);

        // 只填充 body 内容（不包含完整的 HTML 文档结构，避免 innerHTML 剥离标签）
        container.innerHTML = `
            <article class="mdx-print ${variantClass} ${headerClass}">
                ${header}
                <main class="mdx-print-content">
                    ${contentHtml}
                </main>
            </article>
        `;

        // 等待渲染完成（图片等资源）
        await new Promise(resolve => setTimeout(resolve, 300));

        const originalTitle = document.title;
        if (resolved.showFileName === false) document.title = '';
        else if (resolved.title || resolved.fileName) document.title = this.printTitle(resolved);
        // 必须在 print() 前注册：阻塞式打印可能在返回前触发 afterprint。
        const cleanup = this.cleanupAfterPrint(container, styleEl, originalTitle);
        try {
            window.print();
        } catch (error) {
            cleanup();
            throw error;
        }
    }

    /** Keep arbitrary document titles intact; only explicit file names lose their extension. */
    private printTitle(options: PrintOptions): string {
        if (!options.fileName) return options.title || 'Untitled Document';
        const name = options.fileName.split(/[\\/]/).pop() || options.fileName;
        const dot = name.lastIndexOf('.');
        return dot > 0 && dot < name.length - 1 ? name.slice(0, dot) : name;
    }

    /** Expand collapsed details for the printed page. */
    private preprocessHtmlForPrint(html: string): string {
        // 确保所有 <details> 带 open 属性
        return html.replace(
            /<details(?![^>]*\bopen\b)([^>]*)>/g,
            '<details open$1>'
        );
    }

    /**
     * 打印后清理容器和样式
     */
    private cleanupAfterPrint(container: HTMLElement, styleEl: HTMLStyleElement, originalTitle: string): () => void {
        let cleaned = false;

        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            clearTimeout(timeout);
            document.title = originalTitle;
            window.removeEventListener('afterprint', cleanup);
            window.removeEventListener('focus', cleanup);
            if (container.parentNode) {
                container.innerHTML = '';
            }
            if (styleEl.parentNode) {
                document.head.removeChild(styleEl);
            }
        };

        window.addEventListener('afterprint', cleanup, { once: true });
        // 兜底：打印对话框关闭后主窗口重新获得焦点
        window.addEventListener('focus', cleanup, { once: true });
        // 最终兜底：60 秒后强制清理
        const timeout = setTimeout(cleanup, 60000);
        return cleanup;
    }

    /**
     * HTML 转义
     */
    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 销毁服务
     */
    destroy(): void {
        if (this.renderer) {
            this.renderer.destroy();
            this.renderer = null;
        }
    }
}

/**
 * LLM 对话打印服务
 * 
 * 扩展默认打印服务，添加对话专用的预处理逻辑
 */

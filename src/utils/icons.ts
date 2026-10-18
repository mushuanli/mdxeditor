const icon = (path: string) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
export const ACTION_ICONS = {
    sidebar: icon('M3 3h18v18H3zM9 3v18'),
    more: icon('M5 12h.01M12 12h.01M19 12h.01'),
    read: icon('M12 5v16M3 3l9 2 9-2v16l-9 2-9-2Z'),
    edit: icon('m15 3 6 6-12 12H3v-6Z'),
    save: icon('M3 3h15l3 3v15H3zM7 3v6h10V3M7 21v-8h10v8'),
    print: icon('M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6z'),
    wordWrap: icon('M3 6h18M3 12h14a3 3 0 0 1 0 6h-4m3-3-3 3 3 3M3 18h5'),
    ai: icon('m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z'),
    copy: icon('M9 9h12v12H9zM15 9V3H3v12h6'),
};

import * as obsidian from "obsidian";

const en = {
  defaultMode: "Default Mode",
  autoPin: "Auto Pin",
  hoverEmbeds: "Trigger hover preview on embeds",
  hoverEmbedsDesc: "Allow hover preview to trigger when hovering over any type of rendered embed such as images or block references",
  headings: "Trigger hover preview on sub-heading links",
  headingsDesc: "Use hover editor for links to subheadings, instead of the built-in preview/editor",
  blocks: "Trigger hover preview on block links",
  blocksDesc: "Use hover editor for links to blocks, instead of the built-in preview/editor",
  footnotes: "Trigger hover preview on footnotes",
  footnotesDesc: "Use hover editor for footnotes, instead of the built-in preview/editor",
  autoFocus: "Auto Focus",
  autoFocusDesc: "Set the hover editor as the active pane when opened",
  minimizeDown: "Minimize downwards",
  minimizeDownDesc: "When double clicking to minimize, the window will roll down instead of rolling up",
  snapEdges: "Snap to edges",
  snapEdgesDesc: `Quickly arrange popovers by dragging them to the edges of the screen. The left and right edges
        will maximize the popover vertically. The top edge will maximize the popover to fill the entire
        screen. Dragging the popovers away from the edges will restore the popver to its original size.`,
  showHeader: "Show view header by default",
  showHeaderDesc: `Show the view header by default when triggering a hover editor.
         When disabled, view headers will only show if you click the view header icon to the left of the minimize button.`,
  imageZoom: "Click to zoom image",
  imageZoomDesc: `Click and hold an image within a hover editor to temporarily maximize the popover and image to fill the entire viewport.
        On mouse up, the hover editor will restore to its original size.`,
  initialWidth: "Initial popover width",
  initialHeight: "Initial popover height",
  cssUnit: "Enter any valid CSS unit",
  triggerDelay: "Hover Trigger Delay (ms)",
  triggerDelayDesc: "How long to wait before showing a Hover Editor when hovering over a link",
  closeDelay: "Hover Close Delay (ms)",
  closeDelayDesc: "How long to wait before closing a Hover Editor once the mouse leaves",
  readingView: "Reading view",
  editingView: "Editing view",
  matchCurrent: "Match current view",
  onMove: "On drag or resize",
  always: "Always",
  openInHover: "Open in Hover Editor",
  convertToHover: "Convert to Hover Editor",
  dockToWorkspace: "Dock Hover Editor to workspace",
  dragToRearrange: "Drag to rearrange",
  toggleBounce: "Toggle bouncing popovers",
  openNew: "Open new Hover Editor",
  openLinkNew: "Open link under cursor in new Hover Editor",
  openCurrentNew: "Open current file in new Hover Editor",
  convertActive: "Convert active pane to Hover Editor",
  dockActive: "Dock active Hover Editor to workspace",
  restoreActive: "Restore active Hover Editor",
  minimizeActive: "Minimize active Hover Editor",
  snapActive: "Snap active Hover Editor to {{direction}}",
  snapLeft: "left",
  snapRight: "right",
  snapViewport: "viewport",
  createFile: "{{link}} is not yet created. Click to create."
};

const zh: typeof en = {
  defaultMode: "默认模式",
  autoPin: "自动固定",
  hoverEmbeds: "悬停嵌入内容时触发预览",
  hoverEmbedsDesc: "允许悬停在图片、块引用等任意类型的渲染嵌入内容上时触发悬停预览",
  headings: "悬停子标题链接时触发预览",
  headingsDesc: "对子标题链接使用悬停编辑器，而不是内置预览/编辑器",
  blocks: "悬停块链接时触发预览",
  blocksDesc: "对块链接使用悬停编辑器，而不是内置预览/编辑器",
  footnotes: "悬停脚注时触发预览",
  footnotesDesc: "对脚注使用悬停编辑器，而不是内置预览/编辑器",
  autoFocus: "自动聚焦",
  autoFocusDesc: "打开悬停编辑器时将其设为活动窗格",
  minimizeDown: "向下最小化",
  minimizeDownDesc: "双击最小化时，窗口向下收起而不是向上收起",
  snapEdges: "吸附到边缘",
  snapEdgesDesc: `将弹窗拖到屏幕边缘即可快速排列。左右边缘会使弹窗纵向最大化，顶部边缘会使弹窗铺满整个屏幕。将弹窗拖离边缘可恢复原始大小。`,
  showHeader: "默认显示视图标题栏",
  showHeaderDesc: `触发悬停编辑器时默认显示视图标题栏。关闭后，仅当点击最小化按钮左侧的视图标题栏图标时才显示。`,
  imageZoom: "点击缩放图片",
  imageZoomDesc: `在悬停编辑器中按住图片，可临时将弹窗和图片放大到整个视口。松开鼠标后，悬停编辑器会恢复原始大小。`,
  initialWidth: "弹窗初始宽度",
  initialHeight: "弹窗初始高度",
  cssUnit: "输入任意有效的 CSS 单位",
  triggerDelay: "悬停触发延迟（毫秒）",
  triggerDelayDesc: "悬停在链接上后，等待多久显示悬停编辑器",
  closeDelay: "悬停关闭延迟（毫秒）",
  closeDelayDesc: "鼠标离开后，等待多久关闭悬停编辑器",
  readingView: "阅读视图",
  editingView: "编辑视图",
  matchCurrent: "跟随当前视图",
  onMove: "拖动或调整大小时",
  always: "始终",
  openInHover: "在悬停编辑器中打开",
  convertToHover: "转换为悬停编辑器",
  dockToWorkspace: "将悬停编辑器停靠到工作区",
  dragToRearrange: "拖动以重新排列",
  toggleBounce: "切换弹窗弹跳效果",
  openNew: "打开新的悬停编辑器",
  openLinkNew: "在新的悬停编辑器中打开光标处的链接",
  openCurrentNew: "在新的悬停编辑器中打开当前文件",
  convertActive: "将活动窗格转换为悬停编辑器",
  dockActive: "将活动悬停编辑器停靠到工作区",
  restoreActive: "恢复活动悬停编辑器",
  minimizeActive: "最小化活动悬停编辑器",
  snapActive: "将活动悬停编辑器吸附到{{direction}}",
  snapLeft: "左侧",
  snapRight: "右侧",
  snapViewport: "视口",
  createFile: "{{link}} 尚未创建。点击创建。"
};

function isChinese(): boolean {
  // Moment's locale can be changed by date settings in other plugins.
  // Older Obsidian releases use the persisted UI language as a fallback.
  let language = (obsidian as { getLanguage?: () => string }).getLanguage?.();
  if (!language) {
    try {
      language = window.localStorage.getItem("language") ?? "en";
    } catch {
      language = "en";
    }
  }
  const locale = language.toLowerCase().replace("_", "-");
  return locale === "zh" || locale.startsWith("zh-");
}

export function t(key: keyof typeof en, values: Record<string, string> = {}): string {
  const template = (isChinese() ? zh : en)[key];
  return Object.entries(values).reduce(
    (text, [name, value]) => text.split(`{{${name}}}`).join(value),
    template,
  );
}

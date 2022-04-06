import { InteractEvent } from "@interactjs/types";

const SNAP_DISTANCE = 10;
const UNSNAP_THRESHOLD = 60;

export function calculateOffsets() {
  const appContainerEl = document.body.querySelector(".app-container") as HTMLElement;
  const leftRibbonEl = document.body.querySelector(".mod-left.workspace-ribbon") as HTMLElement;
  const titlebarHeight = appContainerEl.offsetTop;
  const ribbonWidth = document.body.hasClass("hider-ribbon") ? 0 : leftRibbonEl.offsetWidth;
  return { top: titlebarHeight, left: ribbonWidth };
}

export function getOrigDimensions(el: HTMLElement) {
  const height = el.getAttribute("data-orig-height");
  const width = el.getAttribute("data-orig-width");
  const left = parseFloat(el.getAttribute("data-orig-pos-left") || "0");
  let top = parseFloat(el.getAttribute("data-orig-pos-top") || "0");
  const titlebarHeight = calculateOffsets().top;
  if (top < titlebarHeight) top = titlebarHeight;
  return { height, width, top, left };
}

export function restoreDimentions(el: HTMLElement) {
  const { height, width, top, left } = getOrigDimensions(el);
  el.removeAttribute("data-orig-width");
  el.removeAttribute("data-orig-height");
  el.removeAttribute("data-orig-pos-left");
  el.removeAttribute("data-orig-pos-top");
  if (width) {
    el.style.width = width + "px";
  }
  if (height) {
    el.style.height = height + "px";
  }
  if (top) {
    el.style.top = top + "px";
    el.setAttribute("data-y", String(top));
  }
  if (left) {
    el.style.left = left + "px";
  }
}

export function restorePopover(el: HTMLElement) {
  if (el.hasClass("snap-to-viewport")) {
    el.removeClass("snap-to-viewport");
    restoreDimentions(el);
    return;
  }
}

export function expandContract(el: HTMLElement, expand: boolean) {
  let contentHeight = (el.querySelector(".view-content") as HTMLElement).offsetHeight;
  contentHeight = expand ? -contentHeight : contentHeight;
  const y = parseFloat(el.getAttribute("data-y") || "0") + contentHeight;
  el.style.top = y + "px";
  el.setAttribute("data-y", String(y));
}

export function storeDimensions(el: HTMLElement) {
  if (!el.hasAttribute("data-orig-width")) {
    el.setAttribute("data-orig-width", String(el.offsetWidth));
  }
  if (!el.hasAttribute("data-orig-height")) {
    el.setAttribute("data-orig-height", String(el.offsetHeight));
  }
  if (!el.hasAttribute("data-orig-pos-left")) {
    el.setAttribute("data-orig-pos-left", String(parseFloat(el.style.left)));
  }
  if (!el.hasAttribute("data-orig-pos-top")) {
    el.setAttribute("data-orig-pos-top", String(parseFloat(el.style.top)));
  }
}

function calculatePointerPosition(event: InteractEvent) {
  const target = event.target as HTMLElement;

  const pointerOffset = event.client.x - event.rect.left;
  const maximizedWidth = event.rect.width;

  const pointerOffsetPercentage = pointerOffset / maximizedWidth;
  const restoredWidth = target.offsetWidth;

  const x = String(event.client.x - pointerOffsetPercentage * restoredWidth);
  const y = String(event.client.y);

  target.setAttribute("data-x", String(x));
  target.setAttribute("data-y", String(y));
}

export function snapToEdge(el: HTMLElement, edge: string, offset: { top: number; left: number }) {
  el.addClass(`snap-to-${edge}`);
  el.style.top = offset.top + "px";
  el.style.height = `calc(100vh - ${offset.top}px)`;
  el.style.left = edge === "right" ? "unset" : offset.left + "px";
  if (edge === "viewport") {
    el.style.width = `calc(100vw - ${offset.left}px)`;
  }
}

export function dragMoveListener(event: InteractEvent) {
  const target = event.target as HTMLElement;

  let { x, y } = target.dataset;

  x = x ? x : target.style.left;
  y = y ? y : target.style.top;

  x = String((parseFloat(x) || 0) + event.dx);
  y = String((parseFloat(y) || 0) + event.dy);

  if (this.plugin.settings.snapToEdges) {
    let offset: { top: number; left: number };

    const insideLeftSnapTarget = event.client.x < SNAP_DISTANCE;
    const insideRightSnapTarget = event.client.x > document.body.offsetWidth - SNAP_DISTANCE;
    const insideTopSnapTarget = event.client.y < 30;

    if (insideLeftSnapTarget || insideRightSnapTarget || insideTopSnapTarget) {
      offset = calculateOffsets();
      storeDimensions(target);
    }

    if (insideLeftSnapTarget && event.buttons) {
      // if we're inside of a snap zone
      snapToEdge(target, "left", offset!);
      return;
    } else if (insideRightSnapTarget && event.buttons) {
      snapToEdge(target, "right", offset!);
      return;
    } else if (insideTopSnapTarget && event.buttons) {
      snapToEdge(target, "viewport", offset!);
      return;
    } else {
      // if we're outside of a snap zone
      if (target.hasClass("snap-to-viewport")) {
        if (event.client.y < UNSNAP_THRESHOLD) return;
        target.removeClass("snap-to-viewport");
        restoreDimentions(target);
        calculatePointerPosition(event);
        return;
      } else if (target.hasClass("snap-to-left")) {
        if (event.client.y < UNSNAP_THRESHOLD) return;
        target.removeClass("snap-to-left");
        restoreDimentions(target);
        calculatePointerPosition(event);
        return;
      } else if (target.hasClass("snap-to-right")) {
        if (event.client.y < UNSNAP_THRESHOLD) return;
        target.removeClass("snap-to-right");
        restoreDimentions(target);
        calculatePointerPosition(event);
        return;
      }
    }
  }

  // if snapping disabled or if no snapping action has just occurred

  target.style.top = y ? y + "px" : target.style.top;
  target.style.left = x ? x + "px" : target.style.left;

  target.setAttribute("data-x", String(x));
  target.setAttribute("data-y", String(y));
}

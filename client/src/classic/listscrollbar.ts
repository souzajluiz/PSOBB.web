// The scroll bar of a list window: track and thumb, PsoBB.exe (Ephinea 1.25.13)
// RenderScrollbarPrimitives_0073f6b2 (dump 710670), with its visibility gate
// IsListEntryInView_0073f878 (dump 710733). Pure geometry, no canvas: the field
// window draws the rectangles this returns (fieldwindows.ts drawListScrollbar).
//
// The exe reads the list's render rect (UiTextGeometryUpdate_0071b900, dump
// 683122), not the window: rect[0] / [1] are the window's x / y (the text
// padding and the 0.5 scale factor cancel for a scale of 1.0 at window+0x68 /
// +0x6c, ASSUMED), rect[2] / [3] its width / height, rect[7] the inner height
// (height - 2 * g_TextGeometryScale; minus 6 more under flag 0x40, the title,
// AdjustPosition_0071bc28). The track and thumb constants are the exe's
// float pool, read with `tools/exedata.py read 00972d2c f 24` and the disassembly
// of 0x73f6b2..0x73f8a4 (the global at each use is named below).

export const SCROLL_BASE_Y = 17; // 0x00972d3c g_ScrollbarBaseYOffset: the track starts 17 px below the window top
export const SCROLL_THICKNESS = 34; // 0x00972d60 g_ScrollbarThickness: the track ends 34 px short of the window height
export const SCROLL_THUMB_X = 7; // 0x00972d6c g_ScrollbarThumbPositionBase: the track sits 7 px left of the window's right edge (plus the width)
export const SCROLL_TRACK_W = 3; // 0x00972d38 g_ScrollbarTrackWidth
export const SCROLL_THUMB_W = 3; // 0x00972d34 g_ScrollbarThumbWidth
export const SCROLL_MIN_HEIGHT = 35; // 0x00972d30 g_ListEntryVisibilityThreshold (IsListEntryInView: height >= 35) and 0x00972d48 g_ScrollbarThumbResizeThreshold
export const SCROLL_TEXT_INSET = 10; // 0x009700c0 g_TextGeometryScale (2 x, the inner height is height - 20)
export const SCROLL_TITLE_SHIFT = -6; // 0x009700a0 g_UIElementVerticalOffset under flag 0x40 (AdjustPosition_0071bc28)
export const SCROLL_ROW = 20; // ListWindowObject_UpdateScrollbarMetrics_00736358: content = lines * 20 - 6

// The track colour is the texture modulated by 0xff646464 (unknown_set_image_in_texture
// on the hud texture); the thumb is InterpolateColorByProgress_007a919c with
// flag 1 (settings+8 is set to 1 at allocation). Flag 1 is outside its 300..330
// band, so the fallback colour (0x86, 0xff, 0x41) is what the exe draws.
export const SCROLL_TRACK_COLOR = '#646464';
export const SCROLL_THUMB_COLOR = '#86ff41';

export interface ScrollRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ListScrollbar {
  track: ScrollRect;
  thumb: ScrollRect;
}

// The scroll bar of a list window of `height` px at (x, y), `width` wide, with
// `items` lines and the first visible line `top`. Null when the exe does not draw it:
// the content (items * 20 - 6, settings+4) fits the inner height, or the window
// is under 35 px. The scroll offset (window+0x74) is `top * 20`, clamped to
// [0, content] as ClampRenderPosition_0073f8a4 does (ASSUMED: the exe's writer of
// that offset for the Item Pack was not found; see DEVLOG 2026-10-31).
export function listScrollbar(
  x: number,
  y: number,
  width: number,
  height: number,
  titled: boolean,
  items: number,
  top: number,
): ListScrollbar | null {
  const innerH = height - 2 * SCROLL_TEXT_INSET + (titled ? SCROLL_TITLE_SHIFT : 0); // rect[7]
  const content = items * SCROLL_ROW - 6; // settings+4 (UpdateScrollbarMetrics)
  if (!(innerH < content) || !(height >= SCROLL_MIN_HEIGHT)) return null;
  const trackLen = height - SCROLL_THICKNESS; // (local_c - 34) + rect[3] - local_c
  const x0 = x - SCROLL_THUMB_X + width; // (rect[0] - 7) + rect[2]
  const y0 = y + SCROLL_BASE_Y; // local_c = 17 + rect[1]
  const track: ScrollRect = { x: x0, y: y0, w: SCROLL_TRACK_W, h: trackLen };
  if (!(trackLen < content)) return { track, thumb: { x: x0, y: y0, w: SCROLL_THUMB_W, h: trackLen } };
  const r = Math.min(Math.max(top * SCROLL_ROW, 0), content);
  const thumb: ScrollRect = {
    x: x0,
    y: y0 + (r * trackLen) / content,
    w: SCROLL_THUMB_W,
    h: (innerH * trackLen) / content,
  };
  return { track, thumb };
}

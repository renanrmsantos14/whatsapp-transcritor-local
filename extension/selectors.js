(() => {
  "use strict";

  const VOICE_HINTS = '[data-icon="ptt-status"], [aria-label*="voice message" i], [aria-label*="mensagem de voz" i]';
  const ID_SELECTOR = "[data-id]";

  function messageId(row) {
    const node = row?.querySelector?.(ID_SELECTOR) || row?.closest?.(ID_SELECTOR);
    return node?.getAttribute?.("data-id") || null;
  }

  function isVoiceNote(row) {
    return Boolean(row?.querySelector?.(VOICE_HINTS));
  }

  function isOutgoing(row) {
    const id = messageId(row);
    if (id && /^(true|outgoing)_/i.test(id)) return true;
    if (id && /^(false|incoming)_/i.test(id)) return false;
    const anchor = row?.querySelector?.(VOICE_HINTS) || row?.firstElementChild;
    if (!anchor?.getBoundingClientRect || !row?.getBoundingClientRect) return false;
    const a = anchor.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return r.width > 0 && (a.left + a.right) / 2 > (r.left + r.right) / 2;
  }

  function rows(root = document) {
    const candidates = root.querySelectorAll?.('div[role="row"], div[data-id]') || [];
    return [...candidates].filter((row) => {
      if (!isVoiceNote(row)) return false;
      return !row.parentElement?.closest?.('div[role="row"]');
    });
  }

  function transportButton(row) {
    const buttons = [...(row?.querySelectorAll?.("button") || [])].filter((button) => !button.closest?.(".wt-wrap"));
    if (!buttons.length) return null;
    const slider = row.querySelector?.('[role="slider"]');
    if (slider) {
      const before = buttons.filter((button) => button.compareDocumentPosition(slider) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (before.length) return before[before.length - 1];
    }
    return buttons.find((button) => !/\d\s*[.,]?\d*\s*[x×]/i.test(button.textContent || "")) || null;
  }

  function isDownloadButton(button) {
    return /download|baixar|descargar/i.test(button?.textContent || button?.getAttribute?.("aria-label") || "");
  }

  function rowForMedia(mediaId) {
    if (!mediaId) return null;
    const media = document.querySelector?.(`[data-wt-media-id="${mediaId}"]`);
    return media?.closest?.('div[role="row"], div[data-id]') || null;
  }

  globalThis.WTSelectors = { VOICE_HINTS, messageId, isVoiceNote, isOutgoing, rows, rowForMedia, transportButton, isDownloadButton };
})();

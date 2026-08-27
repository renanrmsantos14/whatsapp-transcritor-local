(() => {
  "use strict";

  const VOICE_HINTS = '[data-icon="ptt-status"], [aria-label*="voice message" i], [aria-label*="mensagem de voz" i]';
  const AUDIO_HINTS = '[data-testid*="audio" i], [data-icon*="audio" i], audio, [aria-label*="reproduzir áudio" i], [aria-label*="play audio" i]';
  const ID_SELECTOR = "[data-id]";

  function messageId(row) {
    const node = row?.querySelector?.(ID_SELECTOR) || row?.closest?.(ID_SELECTOR);
    return node?.getAttribute?.("data-id") || null;
  }

  function bubbleAnchor(row) {
    const rowBox = row?.getBoundingClientRect?.();
    const media = row?.querySelector?.(VOICE_HINTS) || row?.querySelector?.(AUDIO_HINTS) || transportButton(row);
    let node = media?.parentElement || null;
    let geometric = null;
    let surface = null;
    while (node && node !== row) {
      const box = node.getBoundingClientRect?.();
      if (box && rowBox && box.width >= 180 && box.width < rowBox.width - 20 && box.height >= 40 && box.height <= 260) {
        if (!geometric && box.width >= 240 && box.height >= 56) geometric = node;
        try {
          const style = getComputedStyle(node);
          const background = style.backgroundColor;
          const radius = parseFloat(style.borderTopLeftRadius) || 0;
          if (!surface && background && background !== "transparent" && background !== "rgba(0, 0, 0, 0)" && radius > 0) surface = node;
        } catch (_) { }
      }
      node = node.parentElement;
    }
    return geometric || surface || row?.querySelector?.(ID_SELECTOR) || row?.closest?.(ID_SELECTOR) || null;
  }

  function isVoiceNote(row) {
    if (row?.querySelector?.(VOICE_HINTS)) return true;
    if (!row?.querySelector) return false;
    const hasAudioHint = Boolean(row.querySelector(AUDIO_HINTS));
    if (hasAudioHint) return true;
    const text = row.textContent || "";
    const hasDuration = /\b\d{1,2}:\d{2}\b/.test(text);
    const controls = [...(row.querySelectorAll("button, [role='button']") || [])];
    const hasPlaybackControl = controls.some((control) => /play|pause|reproduzir|tocar|áudio|audio/i.test(`${control.getAttribute?.("aria-label") || ""} ${control.getAttribute?.("data-testid") || ""} ${control.getAttribute?.("data-icon") || ""}`));
    return hasDuration && hasPlaybackControl;
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

  function diagnostic(row) {
    if (row?.querySelector?.(VOICE_HINTS)) return "voice_hint";
    if (row?.querySelector?.(AUDIO_HINTS)) return "audio_hint";
    return isVoiceNote(row) ? "structural_fallback" : "not_voice";
  }

  function transportButton(row) {
    const buttons = [...(row?.querySelectorAll?.("button") || [])].filter((button) => !button.closest?.(".wt-wrap"));
    if (!buttons.length) return null;
    const playback = buttons.find((button) => /play|pause|reproduzir|tocar|áudio|audio/i.test(`${button.getAttribute?.("aria-label") || ""} ${button.getAttribute?.("data-testid") || ""} ${button.getAttribute?.("data-icon") || ""}`));
    if (playback) return playback;
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

  globalThis.WTSelectors = { VOICE_HINTS, AUDIO_HINTS, messageId, bubbleAnchor, isVoiceNote, isOutgoing, rows, rowForMedia, transportButton, isDownloadButton, diagnostic };
})();

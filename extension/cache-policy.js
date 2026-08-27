(() => {
  "use strict";
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const expiresAt = (record) => {
    const explicit = Number(record?.expiresAt);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const created = Number(record?.createdAt);
    return Number.isFinite(created) && created > 0 ? created + TTL_MS : 0;
  };
  const isFresh = (record, now = Date.now()) => expiresAt(record) > now;
  globalThis.WTCachePolicy = Object.freeze({ TTL_MS, expiresAt, isFresh });
})();

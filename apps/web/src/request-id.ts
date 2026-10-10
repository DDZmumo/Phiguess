type RequestRandom = {
  randomUUID?: () => string;
  getRandomValues: (bytes: Uint8Array) => Uint8Array;
};

export function createRequestId(random: RequestRandom = globalThis.crypto): string {
  if (typeof random.randomUUID === 'function') return random.randomUUID();
  // getRandomValues is available on HTTP origins too; keep UUID v4 semantics.
  const bytes = random.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

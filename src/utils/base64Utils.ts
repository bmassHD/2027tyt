/**
 * Utility functions for UTF-8 and Unicode-safe Base64 encoding/decoding.
 * Safely handles multi-byte Vietnamese characters and large string payloads without call-stack overflow.
 */

/**
 * Encode any UTF-8 string into a Base64 string
 */
export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const chunkSize = 0x8000; // 32KB chunking to avoid call-stack size exceed
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Decode a Base64 string back into an authentic UTF-8 string
 */
export function base64ToUtf8(base64Str: string): string {
  const cleanB64 = base64Str.replace(/\s+/g, '');
  const binary = atob(cleanB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Check if a given string is a plausible Base64 string
 */
export function isLikelyBase64(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  const clean = str.trim().replace(/\s+/g, '');
  if (clean.length < 4 || clean.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(clean);
}

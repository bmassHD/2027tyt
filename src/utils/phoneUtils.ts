/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function formatPhoneNumber(phone?: string, canViewFull: boolean = false): string {
  if (!phone) return '';
  const clean = phone.trim().replace(/\s+/g, '');
  if (!canViewFull) {
    if (/^0\d{9,10}$/.test(clean)) {
      const prefix = clean.slice(0, 4); // e.g. 0939
      return `${prefix}.xxx.xxxx`;
    }
    return '0xx.xxx.xxxx';
  }
  if (clean.length === 10) {
    return `${clean.slice(0, 4)} ${clean.slice(4, 7)} ${clean.slice(7)}`;
  }
  if (clean.length === 11) {
    return `${clean.slice(0, 5)} ${clean.slice(5, 8)} ${clean.slice(8)}`;
  }
  return phone;
}

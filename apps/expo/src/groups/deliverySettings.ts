/**
 * Group credential delivery settings — mirrors Swift
 * GroupCredentialDeliverySettings (delivery method + PIN gate + encrypt
 * messages flag). Stored per-group key in MMKV under
 * `group_delivery_settings_<groupId>`.
 */
import { getMmkv } from '@/storage/mmkv';

export type DeliveryMethod = 'sakura' | 'proximity' | 'qr';

export const DELIVERY_METHODS: readonly DeliveryMethod[] = [
  'sakura',
  'proximity',
  'qr',
];

export function deliveryMethodLabel(method: DeliveryMethod): string {
  switch (method) {
    case 'sakura':
      return 'Sakura (Encrypted Relay)';
    case 'proximity':
      return 'Proximity (UWB / Bluetooth)';
    case 'qr':
      return 'QR Hand-off';
  }
}

export interface GroupDeliverySettings {
  readonly defaultDeliveryMethod: DeliveryMethod;
  readonly requirePIN: boolean;
  readonly pin: string | null;
  readonly encryptMessages: boolean;
}

export const DEFAULT_DELIVERY_SETTINGS: GroupDeliverySettings = {
  defaultDeliveryMethod: 'sakura',
  requirePIN: false,
  pin: null,
  encryptMessages: true,
};

function storageKey(groupId: string): string {
  return `group_delivery_settings_${groupId}`;
}

export function loadDeliverySettings(
  groupId: string
): GroupDeliverySettings {
  try {
    const raw = getMmkv().getString(storageKey(groupId));
    if (!raw) return DEFAULT_DELIVERY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<GroupDeliverySettings>;
    return { ...DEFAULT_DELIVERY_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_DELIVERY_SETTINGS;
  }
}

export function saveDeliverySettings(
  groupId: string,
  settings: GroupDeliverySettings
): void {
  try {
    getMmkv().set(storageKey(groupId), JSON.stringify(settings));
  } catch {
    // Best-effort — fail closed.
  }
}

/**
 * Centralized status configuration - single source of truth
 * All status-related mappings should reference this file
 */

export enum QCIStatus {
  Draft = 0,
  ReadyForSnapshot = 1,
  PostedToSnapshot = 2,
  Archived = 3,
  Implemented = 4,
}

interface StatusInfo {
  name: string;
  hash: `0x${string}`;
  displayName?: string;
}

// Main status configuration
export const STATUS_CONFIG: Record<QCIStatus, StatusInfo> = {
  [QCIStatus.Draft]: {
    name: "Draft",
    hash: "0xbffca6d7a13b72cfdfdf4a97d0ffb89fac6c686a62ced4a04137794363a3e382",
    displayName: "Draft",
  },
  [QCIStatus.ReadyForSnapshot]: {
    name: "Ready for Snapshot",
    hash: "0x7070e08f253402b7697ed999df8646627439945a954330fcee1b731dac30d7fb",
    displayName: "Ready for Snapshot",
  },
  [QCIStatus.PostedToSnapshot]: {
    name: "Posted to Snapshot",
    hash: "0x4ea8e9bba2b921001f72db15ceea1abf86759499f1e2f63f81995578937fc34c",
    displayName: "Posted to Snapshot",
  },
  [QCIStatus.Archived]: {
    name: "Archived",
    hash: "0x0d8595aca39f218edf0e157d52bd6f25c54fd84dd4194a1ae097f2f0020dcb90",
    displayName: "Archived",
  },
  [QCIStatus.Implemented]: {
    name: "Implemented",
    hash: "0x9efb4804baf7642e7ab5be82d82d0c674a47ee5eae9933c3887336b03fdfd96a",
    displayName: "Implemented",
  },
};

// Helper functions for conversions
export function getStatusByHash(hash: string): QCIStatus | undefined {
  const normalizedHash = hash.toLowerCase();
  for (const [enumValue, info] of Object.entries(STATUS_CONFIG)) {
    if (info.hash.toLowerCase() === normalizedHash) {
      return Number(enumValue) as QCIStatus;
    }
  }
  return undefined;
}

export function getStatusByName(name: string): QCIStatus | undefined {
  for (const [enumValue, info] of Object.entries(STATUS_CONFIG)) {
    if (info.name === name) {
      return Number(enumValue) as QCIStatus;
    }
  }
  return undefined;
}

export function getStatusName(status: QCIStatus): string {
  return STATUS_CONFIG[status]?.name || "Unknown";
}

export function getStatusHash(status: QCIStatus): `0x${string}` {
  return STATUS_CONFIG[status]?.hash || "0x0";
}

export function getStatusDisplayName(status: QCIStatus): string {
  return STATUS_CONFIG[status]?.displayName || STATUS_CONFIG[status]?.name || "Unknown";
}

// Convenience lookups
export const STATUS_HASH_TO_ENUM = Object.entries(STATUS_CONFIG).reduce((acc, [enumValue, info]) => {
  acc[info.hash] = Number(enumValue) as QCIStatus;
  acc[info.hash.toLowerCase()] = Number(enumValue) as QCIStatus;
  return acc;
}, {} as Record<string, QCIStatus>);

export const STATUS_NAME_TO_ENUM = Object.entries(STATUS_CONFIG).reduce((acc, [enumValue, info]) => {
  acc[info.name] = Number(enumValue) as QCIStatus;
  return acc;
}, {} as Record<string, QCIStatus>);

export const STATUS_ENUM_TO_NAME = Object.entries(STATUS_CONFIG).reduce((acc, [enumValue, info]) => {
  acc[Number(enumValue) as QCIStatus] = info.name;
  return acc;
}, {} as Record<QCIStatus, string>);

export const STATUS_ENUM_TO_HASH = Object.entries(STATUS_CONFIG).reduce((acc, [enumValue, info]) => {
  acc[Number(enumValue) as QCIStatus] = info.hash;
  return acc;
}, {} as Record<QCIStatus, string>);

// All status values as arrays
export const ALL_STATUS_ENUMS = Object.keys(STATUS_CONFIG).map(Number) as QCIStatus[];
export const ALL_STATUS_NAMES = Object.values(STATUS_CONFIG).map(info => info.name);
export const ALL_STATUS_HASHES = Object.values(STATUS_CONFIG).map(info => info.hash);

// Default status values
export const DEFAULT_STATUS = QCIStatus.Draft;
export const DEFAULT_STATUS_NAME = "Draft";
export const DEFAULT_STATUS_HASH = STATUS_CONFIG[QCIStatus.Draft].hash;
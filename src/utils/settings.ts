/**
 * Settings storage utility
 * Manages user settings in localStorage
 */

const SETTINGS_KEY = 'qcis-settings';

export interface UserSettings {
  etherscanApiKey?: string;
}

/**
 * Get user settings from localStorage
 */
export function getSettings(): UserSettings {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) {
      return {};
    }
    return JSON.parse(stored);
  } catch (error) {
    console.error('[Settings] Failed to load settings:', error);
    return {};
  }
}

/**
 * Save user settings to localStorage
 */
export function saveSettings(settings: UserSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('[Settings] Failed to save settings:', error);
  }
}

/**
 * Update specific setting
 */
export function updateSetting<K extends keyof UserSettings>(
  key: K,
  value: UserSettings[K]
): void {
  const settings = getSettings();
  settings[key] = value;
  saveSettings(settings);
}

/**
 * Get Etherscan API key from user settings
 * Only uses localStorage - no environment variable fallback
 */
export function getEtherscanApiKey(): string | undefined {
  const settings = getSettings();
  return settings.etherscanApiKey;
}

/**
 * Check if an API key is available from user settings
 */
export function hasApiKey(): boolean {
  const apiKey = getEtherscanApiKey();
  return !!apiKey && apiKey.trim().length > 0;
}

/**
 * Clear all settings
 */
export function clearSettings(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch (error) {
    console.error('[Settings] Failed to clear settings:', error);
  }
}

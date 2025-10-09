import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Check, ExternalLink, Info } from 'lucide-react';
import { getSettings, saveSettings, type UserSettings } from '../utils/settings';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const [settings, setSettings] = useState<UserSettings>({});
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);

  // Load settings when dialog opens
  useEffect(() => {
    if (isOpen) {
      const currentSettings = getSettings();
      setSettings(currentSettings);
      setApiKey(currentSettings.etherscanApiKey || '');
      setSaved(false);
    }
  }, [isOpen]);

  const handleSave = () => {
    const newSettings: UserSettings = {
      etherscanApiKey: apiKey.trim() || undefined,
    };

    saveSettings(newSettings);
    setSettings(newSettings);
    setSaved(true);

    // Clear saved indicator after 3 seconds
    setTimeout(() => setSaved(false), 3000);
  };

  const handleClear = () => {
    setApiKey('');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your preferences and API keys
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Etherscan API Key Section */}
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold mb-2">Etherscan API Key</h3>
              <p className="text-sm text-muted-foreground">
                Provide your Etherscan API key to fetch contract ABIs automatically.
                A single key works for all supported chains via Etherscan V2 API.
              </p>
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <div className="space-y-2">
                  <p>
                    Get a free API key from Etherscan to enable automatic ABI fetching for contracts on Ethereum, Polygon, Base, Arbitrum, Optimism, and more.
                  </p>
                  <a
                    href="https://etherscan.io/myapikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Get your free API key
                    <ExternalLink size={12} />
                  </a>
                </div>
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="etherscanApiKey">API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="etherscanApiKey"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your Etherscan API key"
                  className="flex-1 font-mono"
                />
                <Button
                  onClick={handleClear}
                  variant="outline"
                  disabled={!apiKey}
                >
                  Clear
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Your API key is stored locally in your browser and never sent to our servers.
              </p>
            </div>

            {saved && (
              <Alert className="border-green-400 bg-green-100 text-green-700">
                <Check className="h-4 w-4" />
                <AlertDescription>
                  Settings saved successfully! Your API key will be used for all ABI requests.
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Privacy Notice */}
          <div className="pt-4 border-t border-border">
            <h3 className="text-sm font-semibold mb-2">Privacy & Security</h3>
            <p className="text-xs text-muted-foreground">
              All settings are stored locally in your browser's localStorage.
              Your API keys are never transmitted to our servers. They are only
              used directly by your browser to make requests to block explorer APIs.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-4 pt-4 border-t border-border">
            <Button onClick={onClose} variant="outline">
              Cancel
            </Button>
            <Button onClick={handleSave} variant="gradient-primary">
              Save Settings
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

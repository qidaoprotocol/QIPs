import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { ConnectKitButton } from "connectkit";
import { Settings } from "lucide-react";
import { useAccount } from "wagmi";
import { type Address } from "viem";

import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Button } from "@/components/ui/button";
import { SettingsDialog } from "@/components/SettingsDialog";
import { useCheckRoles } from "@/hooks/useCheckRoles";
import { config } from "@/config/env";

import logoIcon from "../images/icon-48x48.png";

// Navigation component
const Navigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showSettings, setShowSettings] = useState(false);
  const { address } = useAccount();

  // Check if user has editor or admin role
  const { hasAnyRole } = useCheckRoles({
    address: address as Address | undefined,
    registryAddress: config.registryAddress as Address,
    enabled: !!address,
  });

  return (
    <>
      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    <nav className="navbar bg-background border-b border-border w-full fixed top-0 p-4 flex justify-between items-center z-50">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <img src={logoIcon} alt="QCI Logo" className="h-8 w-8" />
          <Link to="/" className="text-xl font-bold">
            Governance
          </Link>
        </div>
        <Link to="/all-proposals" className="underline text-foreground hover:text-primary">
          🏛️ Explore
        </Link>
        <a
          href="https://discord.com/invite/mQq55j65xJ"
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-foreground hover:text-primary"
        >
          💬 Community Discord
        </a>
        <a
          href="https://snapshot.box/#/s:qidao.eth"
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-foreground hover:text-primary"
        >
          ⚡️ Snapshot
        </a>
        {location.pathname !== "/create-proposal" && (
          <Button variant="gradient-primary" onClick={() => navigate("/create-proposal")} size="sm">
            Start a QCI
          </Button>
        )}
      </div>
      <div className="flex items-center gap-4">
        {hasAnyRole && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
          >
            <Settings size={20} />
          </Button>
        )}
        <ThemeToggle />
        <ConnectKitButton />
      </div>
    </nav>
    </>
  );
};

export default Navigation;

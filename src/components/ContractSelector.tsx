import React, { useState } from 'react';
import { Check, ChevronsUpDown, History, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useContractHistoryByChain } from '../hooks/useContractHistory';
import type { CachedContract } from '../types/abi';

interface ContractSelectorProps {
  chain: string;
  onSelect: (contract: CachedContract) => void;
  disabled?: boolean;
}

/**
 * Truncate address for display
 * Shows first 6 and last 4 characters
 */
function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format timestamp as relative time
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function ContractSelector({
  chain,
  onSelect,
  disabled = false,
}: ContractSelectorProps) {
  const [open, setOpen] = useState(false);
  const { contracts, removeFromHistory } = useContractHistoryByChain(chain);

  const handleSelect = (contract: CachedContract) => {
    onSelect(contract);
    setOpen(false);
  };

  const handleRemove = async (
    e: React.MouseEvent,
    address: string,
    contractChain: string
  ) => {
    e.stopPropagation();
    await removeFromHistory({ address, chain: contractChain });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || contracts.length === 0}
          className="w-full justify-between"
        >
          <div className="flex items-center gap-2">
            <History size={16} />
            <span>
              {contracts.length > 0
                ? `Recent Contracts (${contracts.length})`
                : 'No Recent Contracts'}
            </span>
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[500px] p-0">
        <Command>
          <CommandInput placeholder="Search contracts..." />
          <CommandList>
            <CommandEmpty>No contracts found.</CommandEmpty>
            <CommandGroup>
              {contracts.map((contract) => (
                <CommandItem
                  key={`${contract.chain}-${contract.address}`}
                  onSelect={() => handleSelect(contract)}
                  className="flex items-center justify-between gap-2 cursor-pointer"
                >
                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    <Check
                      className={cn(
                        'h-4 w-4 shrink-0',
                        'invisible' // Never show check since we're not tracking selection
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {contract.name}
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-2">
                        <code className="text-xs">
                          {truncateAddress(contract.address)}
                        </code>
                        <span className="text-xs">
                          {formatRelativeTime(contract.lastUsed)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary" className="text-xs">
                      {contract.chain}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) =>
                        handleRemove(e, contract.address, contract.chain)
                      }
                    >
                      <Trash2 size={12} className="text-destructive" />
                    </Button>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

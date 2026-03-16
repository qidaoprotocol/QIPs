import React, { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
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
import { getAllChainNames } from '@/config/proposalChains';

interface ChainComboboxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  networks?: string[];
  disabled?: boolean;
}

const DEFAULT_NETWORKS = ["All Chains", ...getAllChainNames()];

export function ChainCombobox({
  value,
  onChange,
  placeholder = "Select or type a chain...",
  networks = DEFAULT_NETWORKS,
  disabled = false
}: ChainComboboxProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const handleSelect = (currentValue: string) => {
    onChange(currentValue);
    setOpen(false);
    setInputValue('');
  };

  const handleInputChange = (search: string) => {
    setInputValue(search);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputValue) {
      e.preventDefault();
      // Check if it's an exact match (case-insensitive) with a predefined network
      const exactMatch = networks.find(net => net.toLowerCase() === inputValue.toLowerCase());
      if (exactMatch) {
        onChange(exactMatch);
      } else {
        onChange(inputValue);
      }
      setOpen(false);
      setInputValue('');
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !value && "text-muted-foreground"
          )}
        >
          {value || placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput
            placeholder="Search or type custom chain..."
            value={inputValue}
            onValueChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
          />
          <CommandList>
            <CommandEmpty>
              Press Enter to use "{inputValue}" as custom chain
            </CommandEmpty>
            <CommandGroup>
              {networks.map((network) => (
                <CommandItem
                  key={network}
                  value={network}
                  onSelect={() => handleSelect(network)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === network ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {network}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
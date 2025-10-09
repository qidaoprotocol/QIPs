import React, { useState, useEffect } from 'react';
import { ABIParser, type ParsedFunction, type TransactionData } from '../utils/abiParser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChainCombobox } from './ChainCombobox';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { AlertCircle, Check, Download, Loader2, Info, ChevronDown, ChevronRight } from 'lucide-react';
import { FunctionSelector } from './FunctionSelector';
import { ContractSelector } from './ContractSelector';
import { useFetchContractABI, useContractABI } from '../hooks/useContractABI';
import { useContractHistory } from '../hooks/useContractHistory';
import type { CachedContract } from '../types/abi';
import { hasApiKey } from '../utils/settings';

interface TransactionFormatterProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (transaction: TransactionData) => void;
  networks: string[];
  editingTransaction?: TransactionData;
}

export const TransactionFormatter: React.FC<TransactionFormatterProps> = ({
  isOpen,
  onClose,
  onAdd,
  networks,
  editingTransaction
}) => {
  const [chain, setChain] = useState(editingTransaction?.chain || 'Polygon');
  const [contractAddress, setContractAddress] = useState(editingTransaction?.contractAddress || '');
  const [abiInput, setAbiInput] = useState('');
  const [parsedFunctions, setParsedFunctions] = useState<ParsedFunction[]>([]);
  const [selectedFunction, setSelectedFunction] = useState<ParsedFunction | null>(null);
  const [functionArgs, setFunctionArgs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [parseError, setParseError] = useState('');
  const [formattedTransaction, setFormattedTransaction] = useState('');
  const [fetchABISuccess, setFetchABISuccess] = useState('');
  const [fetchABIError, setFetchABIError] = useState('');
  const [contractName, setContractName] = useState('');
  const [isProxyContract, setIsProxyContract] = useState(false);
  const [implementationAddress, setImplementationAddress] = useState('');

  // Collapsible section states
  const [contractSetupOpen, setContractSetupOpen] = useState(true);
  const [abiInputOpen, setAbiInputOpen] = useState(true);
  const [functionSelectionOpen, setFunctionSelectionOpen] = useState(true);

  // Contract ABI fetching and history
  const fetchABIMutation = useFetchContractABI();
  const { addToHistory } = useContractHistory();

  // Check if API key is available for ABI fetching features
  const apiKeyAvailable = hasApiKey();

  // Auto-fetch ABI when editing a transaction (only if no ABI and API key available)
  const shouldAutoFetch = !!(
    editingTransaction &&
    editingTransaction.contractAddress &&
    editingTransaction.chain &&
    apiKeyAvailable &&
    (!editingTransaction.abi || editingTransaction.abi.length === 0)
  );

  const autoFetchedABI = useContractABI(
    editingTransaction?.contractAddress || '',
    editingTransaction?.chain || '',
    {
      enabled: shouldAutoFetch,
      onError: (error) => {
        setFetchABIError(error);
        setAbiInputOpen(true);
      },
    }
  );

  // Initialize edit mode
  useEffect(() => {
    if (editingTransaction) {
      setChain(editingTransaction.chain);
      setContractAddress(editingTransaction.contractAddress);

      // Set ABI if available in the transaction
      if (editingTransaction.abi && editingTransaction.abi.length > 0) {
        const abiString = JSON.stringify(editingTransaction.abi, null, 2);
        setAbiInput(abiString);
        handleParseABI(abiString);
      } else if (!apiKeyAvailable) {
        // Prompt user to paste ABI if no API key
        setFetchABIError('Please paste the contract ABI below to edit this transaction, or configure an API key in Settings to auto-fetch it.');
        setAbiInputOpen(true);
      }

      // Pre-fill function and args
      if (editingTransaction.functionName && editingTransaction.args) {
        const args: Record<string, string> = {};
        editingTransaction.args.forEach((arg, index) => {
          args[`arg_${index}`] = typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
        });
        setFunctionArgs(args);
      }
    }
  }, [editingTransaction, apiKeyAvailable]);

  // Handle auto-fetched ABI data
  useEffect(() => {
    if (autoFetchedABI.data && shouldAutoFetch) {
      const abiString = JSON.stringify(autoFetchedABI.data.abi, null, 2);
      setAbiInput(abiString);
      setContractName(autoFetchedABI.data.name);
      handleParseABI(abiString);

      // Check if this is a proxy contract
      if (autoFetchedABI.data.isProxy && autoFetchedABI.data.implementation) {
        setIsProxyContract(true);
        setImplementationAddress(autoFetchedABI.data.implementation);
        setFetchABISuccess(
          `Proxy contract detected! Using implementation ABI from ${autoFetchedABI.data.name}`
        );
      } else {
        setFetchABISuccess(`Loaded ABI for ${autoFetchedABI.data.name}`);
      }
    }
  }, [autoFetchedABI.data, shouldAutoFetch]);

  // Auto-select function when editing (after ABI is parsed)
  useEffect(() => {
    if (editingTransaction && editingTransaction.functionName && parsedFunctions.length > 0) {
      // Find the function by name
      const matchingFunction = parsedFunctions.find(
        fn => fn.name === editingTransaction.functionName
      );

      if (matchingFunction) {
        setSelectedFunction(matchingFunction);
      } else {
        // Function not found in ABI - keep function selection open
        console.warn(
          `[TransactionFormatter] Function "${editingTransaction.functionName}" not found in parsed ABI. ` +
          `Available functions: ${parsedFunctions.map(f => f.name).join(', ')}`
        );
        setFunctionSelectionOpen(true);
      }
    }
  }, [editingTransaction, parsedFunctions]);

  // Auto-collapse sections when completed
  useEffect(() => {
    // Collapse contract setup and ABI input when ABI is parsed
    if (parsedFunctions.length > 0) {
      setContractSetupOpen(false);
      setAbiInputOpen(false);
    }
  }, [parsedFunctions]);

  useEffect(() => {
    // Collapse function selection when function is selected
    if (selectedFunction) {
      setFunctionSelectionOpen(false);
    }
  }, [selectedFunction]);

  // Update formatted transaction preview
  useEffect(() => {
    if (chain && contractAddress && selectedFunction && Object.keys(functionArgs).length === selectedFunction.inputs.length) {
      const args = selectedFunction.inputs.map((_, index) => functionArgs[`arg_${index}`] || '');
      const hasAllArgs = args.every(arg => arg !== '');

      if (hasAllArgs) {
        const transaction: TransactionData = {
          chain,
          contractAddress,
          functionName: selectedFunction.name,
          args: args.map((arg, index) => {
            const validation = ABIParser.validateInput(arg, selectedFunction.inputs[index].type);
            return validation.parsed;
          }),
          abi: [] // Will be set when adding
        };

        setFormattedTransaction(ABIParser.formatTransaction(transaction));
      } else {
        setFormattedTransaction('');
      }
    } else {
      setFormattedTransaction('');
    }
  }, [chain, contractAddress, selectedFunction, functionArgs]);

  const handleParseABI = (input?: string) => {
    const abiToParse = input || abiInput;
    if (!abiToParse.trim()) {
      setParseError('Please enter an ABI');
      return;
    }

    try {
      const { functions } = ABIParser.parseABI(abiToParse);
      setParsedFunctions(functions);
      setParseError('');
      setSelectedFunction(null);
      setFunctionArgs({});
      setErrors({});
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Failed to parse ABI');
      setParsedFunctions([]);
    }
  };

  const handleFetchABI = async () => {
    if (!contractAddress || !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
      setFetchABIError('Please enter a valid contract address first');
      return;
    }

    if (!chain) {
      setFetchABIError('Please select a chain first');
      return;
    }

    setFetchABISuccess('');
    setFetchABIError('');
    setIsProxyContract(false);
    setImplementationAddress('');

    try {
      const result = await fetchABIMutation.mutateAsync({
        address: contractAddress,
        chain,
      });

      if (result.success && result.data) {
        // Update ABI input and parse
        const abiString = JSON.stringify(result.data.abi, null, 2);
        setAbiInput(abiString);
        setContractName(result.data.name);
        handleParseABI(abiString);

        // Check if this is a proxy contract
        if (result.data.isProxy && result.data.implementation) {
          setIsProxyContract(true);
          setImplementationAddress(result.data.implementation);
          setFetchABISuccess(
            `Proxy contract detected! Using implementation ABI from ${result.data.name}`
          );
        } else {
          setIsProxyContract(false);
          setFetchABISuccess(`Successfully fetched ABI for ${result.data.name}`);
        }
      } else {
        setFetchABIError(result.error || 'Failed to fetch ABI');
      }
    } catch (error) {
      setFetchABIError(error instanceof Error ? error.message : 'Failed to fetch ABI');
    }
  };

  const handleContractSelect = (contract: CachedContract) => {
    // Auto-populate form with contract data
    setContractAddress(contract.address);
    setChain(contract.chain);
    setContractName(contract.name);

    // Set and parse ABI
    const abiString = JSON.stringify(contract.abi, null, 2);
    setAbiInput(abiString);
    handleParseABI(abiString);

    // Show success message
    setFetchABISuccess(`Loaded ${contract.name} from history`);
    setFetchABIError('');
  };

  const handleFunctionSelect = (func: ParsedFunction) => {
    setSelectedFunction(func);
    setFunctionArgs({});
    setErrors({});
  };

  const handleArgChange = (index: number, value: string, type: string) => {
    const newArgs = { ...functionArgs, [`arg_${index}`]: value };
    setFunctionArgs(newArgs);

    // Validate input
    if (value) {
      const validation = ABIParser.validateInput(value, type);
      if (!validation.valid) {
        setErrors({ ...errors, [`arg_${index}`]: validation.error || 'Invalid input' });
      } else {
        const newErrors = { ...errors };
        delete newErrors[`arg_${index}`];
        setErrors(newErrors);
      }
    } else {
      const newErrors = { ...errors };
      delete newErrors[`arg_${index}`];
      setErrors(newErrors);
    }
  };

  const handleSubmit = async () => {
    if (!chain || !contractAddress || !selectedFunction) {
      return;
    }

    // Validate all inputs
    const args: any[] = [];
    let hasErrors = false;

    selectedFunction.inputs.forEach((input, index) => {
      const value = functionArgs[`arg_${index}`] || '';

      if (!value) {
        setErrors(prev => ({ ...prev, [`arg_${index}`]: 'This field is required' }));
        hasErrors = true;
        return;
      }

      const validation = ABIParser.validateInput(value, input.type);
      if (!validation.valid) {
        setErrors(prev => ({ ...prev, [`arg_${index}`]: validation.error || 'Invalid input' }));
        hasErrors = true;
      } else {
        args.push(validation.parsed);
      }
    });

    if (hasErrors) {
      return;
    }

    // Parse ABI for storage
    const { abi } = ABIParser.parseABI(abiInput);

    const transaction: TransactionData = {
      chain,
      contractAddress,
      functionName: selectedFunction.name,
      args,
      abi
    };

    // Save to contract history
    try {
      await addToHistory({
        address: contractAddress,
        chain,
        name: contractName || 'Unknown Contract',
        abi,
        lastUsed: Date.now(),
        verified: true,
      });
    } catch (error) {
      console.warn('Failed to add contract to history:', error);
      // Don't block transaction submission if history save fails
    }

    onAdd(transaction);
    handleClose();
  };

  const handleClose = () => {
    setChain('Polygon');
    setContractAddress('');
    setAbiInput('');
    setParsedFunctions([]);
    setSelectedFunction(null);
    setFunctionArgs({});
    setErrors({});
    setParseError('');
    setFormattedTransaction('');
    setFetchABISuccess('');
    setFetchABIError('');
    setContractName('');
    setIsProxyContract(false);
    setImplementationAddress('');
    setContractSetupOpen(true);
    setAbiInputOpen(true);
    setFunctionSelectionOpen(true);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingTransaction ? 'Edit Transaction' : 'Add Transaction'}
          </DialogTitle>
          <DialogDescription>
            Configure an on-chain transaction to be included with this proposal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Contract Setup Section */}
          <Collapsible open={contractSetupOpen} onOpenChange={setContractSetupOpen}>
            <div className="flex items-center justify-between">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between p-2 h-auto">
                  <div className="flex items-center gap-2">
                    {contractSetupOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="font-semibold">1. Contract Setup</span>
                  </div>
                  {!contractSetupOpen && chain && contractAddress && (
                    <span className="text-sm text-muted-foreground font-mono">
                      {contractName || 'Contract'} on {chain}
                    </span>
                  )}
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="space-y-4 mt-4">
              {/* Chain Selection */}
              <div className="space-y-2">
                <Label htmlFor="chain">Chain</Label>
                <ChainCombobox
                  value={chain}
                  onChange={setChain}
                  placeholder="Select or type a chain..."
                  networks={networks}
                />
              </div>

              {/* Contract History Selector - Only show if API key available */}
              {apiKeyAvailable && (
                <div className="space-y-2">
                  <Label>Quick Select from History</Label>
                  <ContractSelector
                    chain={chain}
                    onSelect={handleContractSelect}
                  />
                </div>
              )}

              {/* Contract Address */}
              <div className="space-y-2">
                <Label htmlFor="contractAddress">Contract Address</Label>
                <div className="flex gap-2">
                  <Input
                    id="contractAddress"
                    type="text"
                    value={contractAddress}
                    onChange={(e) => setContractAddress(e.target.value)}
                    placeholder="0x..."
                    className={apiKeyAvailable ? "flex-1" : ""}
                  />
                  {apiKeyAvailable && (
                    <Button
                      onClick={handleFetchABI}
                      variant="secondary"
                      disabled={fetchABIMutation.isPending || !contractAddress || !chain}
                      className="shrink-0"
                    >
                      {fetchABIMutation.isPending ? (
                        <>
                          <Loader2 size={16} className="mr-2 animate-spin" />
                          Fetching...
                        </>
                      ) : (
                        <>
                          <Download size={16} className="mr-2" />
                          Fetch ABI
                        </>
                      )}
                    </Button>
                  )}
                </div>
                {contractAddress && !/^0x[a-fA-F0-9]{40}$/.test(contractAddress) && (
                  <p className="text-sm text-destructive">Invalid address format</p>
                )}
                {fetchABISuccess && (
                  <Alert className="border-green-400 bg-green-100 text-green-700">
                    <Check className="h-4 w-4" />
                    <AlertDescription>{fetchABISuccess}</AlertDescription>
                  </Alert>
                )}
                {isProxyContract && implementationAddress && (
                  <Alert className="border-blue-400 bg-blue-50 dark:bg-blue-950/30">
                    <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <AlertDescription className="text-blue-700 dark:text-blue-300">
                      <div className="space-y-1">
                        <p className="font-semibold">Proxy Contract Information</p>
                        <p className="text-xs">
                          Proxy Address: <code className="font-mono">{contractAddress}</code>
                        </p>
                        <p className="text-xs">
                          Implementation: <code className="font-mono">{implementationAddress}</code>
                        </p>
                        <p className="text-xs mt-1 text-blue-600 dark:text-blue-400">
                          The ABI below is from the implementation contract, which contains the actual function definitions.
                        </p>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
                {fetchABIError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{fetchABIError}</AlertDescription>
                  </Alert>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* ABI Input Section */}
          <Collapsible open={abiInputOpen} onOpenChange={setAbiInputOpen}>
            <div className="flex items-center justify-between">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between p-2 h-auto">
                  <div className="flex items-center gap-2">
                    {abiInputOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="font-semibold">2. Contract ABI</span>
                  </div>
                  {!abiInputOpen && parsedFunctions.length > 0 && (
                    <span className="text-sm text-muted-foreground">
                      {parsedFunctions.length} function{parsedFunctions.length !== 1 ? 's' : ''} available
                    </span>
                  )}
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="abi">Contract ABI</Label>
                <Textarea
                  id="abi"
                  value={abiInput}
                  onChange={(e) => setAbiInput(e.target.value)}
                  placeholder='Paste contract ABI JSON here, e.g., [{"type":"function","name":"transfer","inputs":[...],"outputs":[...]}]'
                  rows={6}
                  className="font-mono text-sm"
                />
                {parseError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{parseError}</AlertDescription>
                  </Alert>
                )}
                <Button
                  onClick={() => handleParseABI()}
                  variant="secondary"
                >
                  Parse ABI
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Function Selection Section */}
          {parsedFunctions.length > 0 && (
            <Collapsible open={functionSelectionOpen} onOpenChange={setFunctionSelectionOpen}>
              <div className="flex items-center justify-between">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between p-2 h-auto">
                    <div className="flex items-center gap-2">
                      {functionSelectionOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <span className="font-semibold">3. Select Function</span>
                    </div>
                    {!functionSelectionOpen && selectedFunction && (
                      <span className="text-sm text-muted-foreground font-mono">
                        {selectedFunction.name}()
                      </span>
                    )}
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent className="space-y-4 mt-4">
                <FunctionSelector
                  functions={parsedFunctions}
                  selectedFunction={selectedFunction}
                  onSelect={handleFunctionSelect}
                />
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Function Arguments & Preview */}
          {selectedFunction && (
            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold">4. Configure & Review</span>
              </div>

              {selectedFunction.inputs.length > 0 && (
                <div className="space-y-2">
                  <Label>Function Arguments</Label>
                  <div className="space-y-3">
                    {selectedFunction.inputs.map((input, index) => (
                      <div key={index} className="space-y-2">
                        <Label htmlFor={`arg_${index}`}>
                          {input.name || `Parameter ${index + 1}`} ({input.type})
                        </Label>
                        <Input
                          id={`arg_${index}`}
                          type="text"
                          value={functionArgs[`arg_${index}`] || ''}
                          onChange={(e) => handleArgChange(index, e.target.value, input.type)}
                          placeholder={ABIParser.getTypeDescription(input.type)}
                          className={errors[`arg_${index}`] ? 'border-destructive' : ''}
                        />
                        {errors[`arg_${index}`] && (
                          <p className="text-sm text-destructive flex items-center gap-1">
                            <AlertCircle size={14} />
                            {errors[`arg_${index}`]}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Transaction Preview */}
              {formattedTransaction && (
                <div className="space-y-2">
                  <Label>Transaction Preview</Label>
                  <div className="rounded-lg bg-muted/30 p-4">
                    <code className="break-all font-mono text-sm">{formattedTransaction}</code>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                    <Check size={16} />
                    Transaction format valid
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-4">
            <Button
              onClick={handleClose}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!formattedTransaction || Object.keys(errors).length > 0}
              variant="gradient-primary"
            >
              {editingTransaction ? 'Update Transaction' : 'Add Transaction'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
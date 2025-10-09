import { type Abi, type AbiFunction, parseAbi } from 'viem';

export interface ParsedFunction {
  name: string;
  inputs: {
    name: string;
    type: string;
    internalType?: string;
  }[];
  stateMutability: string;
  signature: string;
}

export interface TransactionData {
  chain: string;
  contractAddress: string;
  functionName: string;
  args: any[];
  abi: Abi;
  annotation?: string;
  multisig?: string;
}

export class ABIParser {
  /**
   * Parse ABI string and extract callable functions
   */
  static parseABI(abiString: string): { abi: Abi; functions: ParsedFunction[] } {
    try {
      let abi: Abi;
      
      // Try to parse as JSON first
      try {
        const parsed = JSON.parse(abiString);
        abi = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        // If not JSON, try to parse as human-readable ABI
        abi = parseAbi([abiString]);
      }

      // Extract functions that can be called (non-view, non-pure)
      const functions: ParsedFunction[] = [];
      
      for (const item of abi) {
        if (item.type === 'function') {
          const func = item as AbiFunction;
          // Include all functions, let user decide which to call
          functions.push({
            name: func.name,
            inputs: func.inputs.map(input => ({
              name: input.name || '',
              type: input.type,
              internalType: input.internalType
            })),
            stateMutability: func.stateMutability || 'nonpayable',
            signature: `${func.name}(${func.inputs.map(i => i.type).join(',')})`
          });
        }
      }

      return { abi, functions };
    } catch (error) {
      throw new Error(`Failed to parse ABI: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate input value based on Solidity type
   */
  static validateInput(value: string, type: string): { valid: boolean; parsed: any; error?: string } {
    try {
      // Handle array types
      if (type.includes('[')) {
        const baseType = type.substring(0, type.indexOf('['));
        const isFixedArray = type.includes('[') && type.includes(']') && type.match(/\[(\d+)\]/);
        
        try {
          const parsed = JSON.parse(value);
          if (!Array.isArray(parsed)) {
            return { valid: false, parsed: null, error: 'Value must be an array' };
          }
          
          if (isFixedArray) {
            const size = parseInt(isFixedArray[1]);
            if (parsed.length !== size) {
              return { valid: false, parsed: null, error: `Array must have exactly ${size} elements` };
            }
          }
          
          // Validate each element
          for (const elem of parsed) {
            const elemValidation = this.validateInput(String(elem), baseType);
            if (!elemValidation.valid) {
              return { valid: false, parsed: null, error: `Array element invalid: ${elemValidation.error}` };
            }
          }
          
          return { valid: true, parsed };
        } catch {
          return { valid: false, parsed: null, error: 'Invalid array format. Use JSON array syntax: ["item1", "item2"]' };
        }
      }

      // Handle tuple types
      if (type.startsWith('tuple')) {
        try {
          const parsed = JSON.parse(value);
          return { valid: true, parsed };
        } catch {
          return { valid: false, parsed: null, error: 'Invalid tuple format. Use JSON object syntax' };
        }
      }

      // Handle basic types
      switch (type) {
        case 'address':
          if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
            return { valid: false, parsed: null, error: 'Invalid address format (must be 0x followed by 40 hex characters)' };
          }
          return { valid: true, parsed: value };

        case 'bool':
          if (value !== 'true' && value !== 'false') {
            return { valid: false, parsed: null, error: 'Value must be "true" or "false"' };
          }
          return { valid: true, parsed: value === 'true' };

        case 'string':
          return { valid: true, parsed: value };

        case 'bytes':
          if (!/^0x[a-fA-F0-9]*$/.test(value)) {
            return { valid: false, parsed: null, error: 'Bytes must start with 0x followed by hex characters' };
          }
          return { valid: true, parsed: value };

        default:
          // Handle bytes1, bytes2, ..., bytes32
          if (type.startsWith('bytes')) {
            const size = parseInt(type.substring(5));
            if (size >= 1 && size <= 32) {
              if (!/^0x[a-fA-F0-9]+$/.test(value)) {
                return { valid: false, parsed: null, error: `${type} must start with 0x followed by hex characters` };
              }
              const expectedLength = 2 + (size * 2); // 0x + 2 chars per byte
              if (value.length !== expectedLength) {
                return { valid: false, parsed: null, error: `${type} must be exactly ${expectedLength} characters (0x + ${size * 2} hex chars)` };
              }
              return { valid: true, parsed: value };
            }
          }

          // Handle uint/int types
          if (type.startsWith('uint') || type.startsWith('int')) {
            const isUnsigned = type.startsWith('uint');
            const bits = type.includes('int') ? parseInt(type.substring(isUnsigned ? 4 : 3)) || 256 : 256;
            
            try {
              const num = BigInt(value);
              
              if (isUnsigned && num < 0n) {
                return { valid: false, parsed: null, error: 'Unsigned integer cannot be negative' };
              }
              
              const maxValue = isUnsigned ? (2n ** BigInt(bits)) - 1n : (2n ** BigInt(bits - 1)) - 1n;
              const minValue = isUnsigned ? 0n : -(2n ** BigInt(bits - 1));
              
              if (num > maxValue || num < minValue) {
                return { valid: false, parsed: null, error: `Value out of range for ${type}` };
              }
              
              return { valid: true, parsed: value };
            } catch {
              return { valid: false, parsed: null, error: 'Invalid number format' };
            }
          }

          return { valid: false, parsed: null, error: `Unsupported type: ${type}` };
      }
    } catch (error) {
      return { valid: false, parsed: null, error: error instanceof Error ? error.message : 'Validation error' };
    }
  }

  /**
   * Format transaction data as a JSON string for structured storage
   */
  static formatTransaction(data: TransactionData): string {
    // Map chain names to chain IDs
    const chainIdMap: Record<string, number> = {
      'Ethereum': 1,
      'Polygon': 137,
      'Base': 8453,
      'Arbitrum': 42161,
      'Optimism': 10,
      'BSC': 56,
      'Binance': 56, // Alias
      'Avalanche': 43114,
      'Metis': 1088,
      // Add more as needed
    };

    // Get chain ID, fallback to chain name if not found
    const chainId = chainIdMap[data.chain] || data.chain;

    // Create a structured transaction object (ABI is NOT stored to keep size small)
    const transaction: Record<string, any> = {
      chainId: chainId,
      to: data.contractAddress,
      function: data.functionName,
      args: data.args,
      value: "0", // Default to 0, can be extended later
    };

    // Add optional annotation if provided
    if (data.annotation) {
      transaction.annotation = data.annotation;
    }

    return JSON.stringify(transaction, null, 2);
  }

  /**
   * Format transaction data in legacy format (for backward compatibility)
   */
  static formatTransactionLegacy(data: TransactionData): string {
    const argsString = data.args.map(arg => {
      if (typeof arg === 'object') {
        return JSON.stringify(arg);
      }
      return String(arg);
    }).join(',');
    
    return `${data.chain}:${data.contractAddress}:${data.functionName}:[${argsString}]`;
  }

  /**
   * Parse a formatted transaction string back to TransactionData
   * Supports both new JSON format and legacy colon-separated format
   */
  static parseTransaction(transactionString: string): TransactionData {
    // Map chain IDs back to chain names
    const chainNameMap: Record<number, string> = {
      1: 'Ethereum',
      137: 'Polygon',
      8453: 'Base',
      42161: 'Arbitrum',
      10: 'Optimism',
      56: 'BSC',
      43114: 'Avalanche',
      1088: 'Metis',
    };

    // First, try to parse as JSON (new format)
    try {
      const parsed = JSON.parse(transactionString);
      if ((parsed.chainId || parsed.chain) && (parsed.to || parsed.address || parsed.contractAddress) && parsed.function) {
        // Convert chainId to chain name if needed
        let chain = parsed.chain;
        if (parsed.chainId) {
          if (typeof parsed.chainId === 'number') {
            // Numeric chainId - map to chain name
            chain = chainNameMap[parsed.chainId] || `Chain ${parsed.chainId}`;
          } else if (typeof parsed.chainId === 'string') {
            // String chainId like "Polygon PoS" - use directly
            chain = parsed.chainId;
          }
        }

        return {
          chain: chain,
          contractAddress: parsed.to || parsed.address || parsed.contractAddress,
          functionName: parsed.function || parsed.functionName,
          args: parsed.args || [],
          abi: [], // ABI is not stored, will be fetched on edit
          annotation: parsed.annotation, // Include annotation if present
        };
      }
    } catch {
      // Not JSON, try legacy format
    }
    
    // Fall back to legacy format parsing
    const match = transactionString.match(/^([^:]+):([^:]+):([^:]+):\[(.*)\]$/);
    
    if (!match) {
      throw new Error('Invalid transaction format');
    }
    
    const [, chain, contractAddress, functionName, argsString] = match;
    
    // Parse arguments
    let args: any[] = [];
    if (argsString) {
      // Simple CSV parsing, handling JSON objects
      const argParts: string[] = [];
      let current = '';
      let depth = 0;
      
      for (let i = 0; i < argsString.length; i++) {
        const char = argsString[i];
        if (char === '{' || char === '[') depth++;
        if (char === '}' || char === ']') depth--;
        
        if (char === ',' && depth === 0) {
          argParts.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      
      if (current) {
        argParts.push(current.trim());
      }
      
      args = argParts.map(arg => {
        // Try to parse as JSON
        try {
          return JSON.parse(arg);
        } catch {
          // If not JSON, return as string
          return arg;
        }
      });
    }
    
    return {
      chain,
      contractAddress,
      functionName,
      args,
      abi: [] // Legacy format doesn't store ABI
    };
  }

  /**
   * Get a user-friendly type description
   */
  static getTypeDescription(type: string): string {
    const descriptions: Record<string, string> = {
      'address': 'Ethereum address (0x...)',
      'uint256': 'Positive integer (0 to 2^256-1)',
      'uint': 'Positive integer (0 to 2^256-1)',
      'int256': 'Integer (-2^255 to 2^255-1)',
      'int': 'Integer (-2^255 to 2^255-1)',
      'bool': 'Boolean (true/false)',
      'string': 'Text string',
      'bytes': 'Hex bytes (0x...)',
      'bytes32': '32-byte hex string (0x... with 64 hex chars)',
    };

    // Check for array types
    if (type.includes('[')) {
      const baseType = type.substring(0, type.indexOf('['));
      const arrayPart = type.substring(type.indexOf('['));
      const baseDesc = descriptions[baseType] || baseType;
      
      if (arrayPart === '[]') {
        return `Array of ${baseDesc}`;
      } else {
        const size = arrayPart.match(/\[(\d+)\]/)?.[1];
        return `Fixed array of ${size} ${baseDesc}`;
      }
    }

    // Check for sized bytes
    if (type.startsWith('bytes') && type !== 'bytes') {
      const size = type.substring(5);
      return `${size}-byte hex string (0x... with ${parseInt(size) * 2} hex chars)`;
    }

    // Check for sized uints/ints
    if (type.startsWith('uint') && type !== 'uint') {
      const bits = type.substring(4);
      return `Positive integer (0 to 2^${bits}-1)`;
    }
    if (type.startsWith('int') && type !== 'int') {
      const bits = type.substring(3);
      return `Integer (-2^${parseInt(bits)-1} to 2^${parseInt(bits)-1}-1)`;
    }

    return descriptions[type] || type;
  }
}
import React, { useState } from 'react';
import { FiAlertTriangle, FiInfo } from 'react-icons/fi';

interface StatusDiscrepancyIndicatorProps {
  onChainStatus: string;
  ipfsStatus?: string;
  showTooltip?: boolean;
  className?: string;
}

export const StatusDiscrepancyIndicator: React.FC<StatusDiscrepancyIndicatorProps> = ({
  onChainStatus,
  ipfsStatus,
  showTooltip = true,
  className = ''
}) => {
  const [showDetails, setShowDetails] = useState(false);
  
  // No indicator if statuses match or IPFS status is not available
  if (!ipfsStatus || onChainStatus.toLowerCase() === ipfsStatus.toLowerCase()) {
    return null;
  }

  return (
    <div className={`inline-flex items-center gap-1 ${className}`}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          onMouseEnter={() => showTooltip && setShowDetails(true)}
          onMouseLeave={() => showTooltip && setShowDetails(false)}
          className="text-yellow-600 hover:text-yellow-700 focus:outline-none"
          aria-label="Status discrepancy information"
        >
          <FiAlertTriangle className="h-4 w-4" />
        </button>
        
        {showDetails && (
          <div className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 p-3 bg-white rounded-lg shadow-lg border border-gray-200">
            <div className="flex items-start gap-2">
              <FiInfo className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-semibold mb-1">Status Discrepancy Detected</p>
                <p className="text-gray-600 mb-2">
                  The on-chain status differs from the IPFS content:
                </p>
                <div className="space-y-1">
                  <div>
                    <span className="font-medium">On-chain (current):</span>{' '}
                    <span className="text-green-600">{onChainStatus}</span>
                  </div>
                  <div>
                    <span className="font-medium">IPFS (outdated):</span>{' '}
                    <span className="text-gray-500">{ipfsStatus}</span>
                  </div>
                </div>
                <p className="text-gray-500 mt-2 text-[10px]">
                  On-chain status is the authoritative source. IPFS content may be outdated after status updates.
                </p>
              </div>
            </div>
            <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full">
              <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-white"></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Compact version for use in tables or lists
export const StatusDiscrepancyBadge: React.FC<{
  hasDiscrepancy: boolean;
  onChainStatus?: string;
  ipfsStatus?: string;
}> = ({ hasDiscrepancy, onChainStatus, ipfsStatus }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!hasDiscrepancy) return null;

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"
      >
        <FiAlertTriangle className="h-3 w-3 mr-1" />
        Out of Sync
      </div>
      
      {showTooltip && onChainStatus && ipfsStatus && (
        <div className="absolute z-50 bottom-full left-0 mb-1 w-48 p-2 bg-gray-900 text-white text-xs rounded shadow-lg">
          <div>On-chain: {onChainStatus}</div>
          <div>IPFS: {ipfsStatus}</div>
        </div>
      )}
    </div>
  );
};
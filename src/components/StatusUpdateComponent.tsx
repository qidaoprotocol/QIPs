import React, { useState } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { QIPStatus } from '../services/qipClient';
import { toast } from 'react-hot-toast';
import { FiCheck, FiX, FiAlertCircle } from 'react-icons/fi';

interface StatusUpdateComponentProps {
  qipNumber: bigint;
  currentStatus: QIPStatus;
  currentIpfsStatus?: string;
  isAuthor: boolean;
  isEditor: boolean;
  onStatusUpdate: (newStatus: QIPStatus) => Promise<void>;
  onSyncToIPFS?: () => Promise<void>;
}

// Status transition rules - defines valid transitions from each status
// Note: These are UI suggestions only. Editors/Admins can transition to any status on-chain.
const STATUS_TRANSITIONS: Record<QIPStatus, QIPStatus[]> = {
  [QIPStatus.Draft]: [QIPStatus.ReviewPending, QIPStatus.Withdrawn],
  [QIPStatus.ReviewPending]: [QIPStatus.VotePending, QIPStatus.Draft, QIPStatus.Withdrawn],
  [QIPStatus.VotePending]: [QIPStatus.Approved, QIPStatus.Rejected, QIPStatus.Withdrawn],
  [QIPStatus.Approved]: [QIPStatus.Implemented, QIPStatus.Superseded],
  [QIPStatus.Rejected]: [QIPStatus.Draft, QIPStatus.Withdrawn],
  [QIPStatus.Implemented]: [QIPStatus.Superseded],
  [QIPStatus.Superseded]: [],
  [QIPStatus.Withdrawn]: [QIPStatus.Draft]
};

// All possible statuses for editors/admins
const ALL_STATUSES = [
  QIPStatus.Draft,
  QIPStatus.ReviewPending,
  QIPStatus.VotePending,
  QIPStatus.Approved,
  QIPStatus.Rejected,
  QIPStatus.Implemented,
  QIPStatus.Superseded,
  QIPStatus.Withdrawn
];

// Human-readable status labels
const STATUS_LABELS: Record<QIPStatus, string> = {
  [QIPStatus.Draft]: 'Draft',
  [QIPStatus.ReviewPending]: 'Review Pending',
  [QIPStatus.VotePending]: 'Vote Pending',
  [QIPStatus.Approved]: 'Approved',
  [QIPStatus.Rejected]: 'Rejected',
  [QIPStatus.Implemented]: 'Implemented',
  [QIPStatus.Superseded]: 'Superseded',
  [QIPStatus.Withdrawn]: 'Withdrawn'
};

// Status colors for visual feedback
const STATUS_COLORS: Record<QIPStatus, string> = {
  [QIPStatus.Draft]: 'bg-gray-100 text-gray-800',
  [QIPStatus.ReviewPending]: 'bg-yellow-100 text-yellow-800',
  [QIPStatus.VotePending]: 'bg-blue-100 text-blue-800',
  [QIPStatus.Approved]: 'bg-green-100 text-green-800',
  [QIPStatus.Rejected]: 'bg-red-100 text-red-800',
  [QIPStatus.Implemented]: 'bg-purple-100 text-purple-800',
  [QIPStatus.Superseded]: 'bg-orange-100 text-orange-800',
  [QIPStatus.Withdrawn]: 'bg-gray-100 text-gray-600'
};

export const StatusUpdateComponent: React.FC<StatusUpdateComponentProps> = ({
  qipNumber,
  currentStatus,
  currentIpfsStatus,
  isAuthor,
  isEditor,
  onStatusUpdate,
  onSyncToIPFS
}) => {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<QIPStatus | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Only editors/admins can update status on-chain (per smart contract)
  const canUpdateStatus = isConnected && isEditor;

  // Get valid transitions for current status
  const validTransitions = STATUS_TRANSITIONS[currentStatus] || [];

  // Get available transitions based on user permissions
  const getAvailableTransitions = (): QIPStatus[] => {
    if (!canUpdateStatus) return [];

    // Editors/Admins can transition to ANY status (as enforced by smart contract)
    // We show all statuses except the current one
    if (isEditor) {
      return ALL_STATUSES.filter(status => status !== currentStatus);
    }

    // Authors cannot update status on-chain at all
    // The smart contract's updateStatus function has onlyRole(EDITOR_ROLE) modifier
    return [];
  };

  const availableTransitions = getAvailableTransitions();

  const handleStatusSelect = (newStatus: QIPStatus) => {
    setSelectedStatus(newStatus);
    setShowConfirmDialog(true);
  };

  const confirmStatusUpdate = async () => {
    if (!selectedStatus || !walletClient) return;

    setIsUpdating(true);
    try {
      await onStatusUpdate(selectedStatus);
      toast.success(`Status updated to ${STATUS_LABELS[selectedStatus]}`);
      setShowConfirmDialog(false);
      setSelectedStatus(null);
    } catch (error: any) {
      console.error('Failed to update status:', error);
      toast.error(error.message || 'Failed to update status');
    } finally {
      setIsUpdating(false);
    }
  };

  const cancelStatusUpdate = () => {
    setShowConfirmDialog(false);
    setSelectedStatus(null);
  };

  if (!canUpdateStatus || availableTransitions.length === 0) {
    // Just show current status without update options
    return (
      <div className="inline-flex items-center gap-2">
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[currentStatus]}`}>
          {STATUS_LABELS[currentStatus]}
        </span>
        {isAuthor && !isEditor && (
          <span className="text-xs text-gray-500 italic">
            (Status updates require editor permissions)
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="inline-flex items-center gap-2">
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[currentStatus]}`}>
          {STATUS_LABELS[currentStatus]}
        </span>
        
        {/* Status update dropdown */}
        <div className="relative inline-block">
          <select
            className="appearance-none bg-white border border-gray-300 rounded-md px-3 py-1 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            onChange={(e) => {
              const newStatus = parseInt(e.target.value) as QIPStatus;
              if (!isNaN(newStatus)) {
                handleStatusSelect(newStatus);
              }
            }}
            disabled={isUpdating}
            value=""
          >
            <option value="" disabled>Change status...</option>
            {/* Group transitions for better UX */}
            {isEditor && (
              <>
                <optgroup label="Suggested Transitions">
                  {validTransitions.map(status => (
                    <option key={status} value={status}>
                      → {STATUS_LABELS[status]} (suggested)
                    </option>
                  ))}
                </optgroup>
                {availableTransitions.filter(s => !validTransitions.includes(s)).length > 0 && (
                  <optgroup label="All Other Statuses">
                    {availableTransitions
                      .filter(status => !validTransitions.includes(status))
                      .map(status => (
                        <option key={status} value={status}>
                          → {STATUS_LABELS[status]}
                        </option>
                      ))}
                  </optgroup>
                )}
              </>
            )}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
              <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && selectedStatus !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-start mb-4">
              <div className="flex-shrink-0">
                <FiAlertCircle className="h-6 w-6 text-yellow-500" />
              </div>
              <div className="ml-3">
                <h3 className="text-lg font-medium text-gray-900">
                  Confirm Status Change
                </h3>
                <div className="mt-2">
                  <p className="text-sm text-gray-500">
                    Are you sure you want to change the status from{' '}
                    <span className="font-semibold">{STATUS_LABELS[currentStatus]}</span> to{' '}
                    <span className="font-semibold">{STATUS_LABELS[selectedStatus]}</span>?
                  </p>
                  
                  {/* Show admin override notice when making non-standard transitions */}
                  {isEditor && !validTransitions.includes(selectedStatus) && (
                    <div className="mt-3 p-3 bg-blue-50 rounded-md">
                      <p className="text-sm text-blue-800">
                        <strong>Administrative Override:</strong> This is not a standard workflow transition. 
                        As an editor/admin, you have permission to make any status change.
                      </p>
                    </div>
                  )}
                  
                  {/* Show IPFS sync warning if status will be out of sync */}
                  {currentIpfsStatus && STATUS_LABELS[selectedStatus] !== currentIpfsStatus && (
                    <div className="mt-3 p-3 bg-amber-50 rounded-md">
                      <p className="text-sm text-amber-800">
                        <strong>Note:</strong> This status update will only change the on-chain status. 
                        The IPFS content will show "{currentIpfsStatus}" until manually synchronized.
                        {onSyncToIPFS && (
                          <span> You can sync to IPFS after updating if needed.</span>
                        )}
                      </p>
                    </div>
                  )}
                  
                  {/* Show warning for certain transitions */}
                  {selectedStatus === QIPStatus.Withdrawn && (
                    <div className="mt-3 p-3 bg-yellow-50 rounded-md">
                      <p className="text-sm text-yellow-800">
                        <strong>Warning:</strong> Withdrawing a proposal will remove it from active consideration.
                      </p>
                    </div>
                  )}
                  
                  {selectedStatus === QIPStatus.Rejected && (
                    <div className="mt-3 p-3 bg-red-50 rounded-md">
                      <p className="text-sm text-red-800">
                        <strong>Warning:</strong> Rejecting a proposal will require it to be resubmitted for review.
                      </p>
                    </div>
                  )}

                  {selectedStatus === QIPStatus.Implemented && (
                    <div className="mt-3 p-3 bg-green-50 rounded-md">
                      <p className="text-sm text-green-800">
                        <strong>Note:</strong> Mark as implemented only after the proposal has been fully executed on-chain.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={cancelStatusUpdate}
                disabled={isUpdating}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                <FiX className="inline mr-1" />
                Cancel
              </button>
              <button
                onClick={confirmStatusUpdate}
                disabled={isUpdating}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {isUpdating ? (
                  <>
                    <span className="inline-block animate-spin mr-2">⟳</span>
                    Updating...
                  </>
                ) : (
                  <>
                    <FiCheck className="inline mr-1" />
                    Confirm
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
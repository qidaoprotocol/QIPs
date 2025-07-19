import React, { useEffect, useState } from 'react';
import { checkIPFSHealth, IPFSHealth } from '../utils/ipfs-health';

interface IPFSStatusProps {
  apiUrl?: string;
  gatewayUrl?: string;
  checkInterval?: number;
  showWhenHealthy?: boolean;
}

export const IPFSStatus: React.FC<IPFSStatusProps> = ({
  apiUrl = 'http://localhost:5001',
  gatewayUrl = 'http://localhost:8080',
  checkInterval = 30000, // 30 seconds
  showWhenHealthy = false
}) => {
  const [health, setHealth] = useState<IPFSHealth | null>(null);
  const [checking, setChecking] = useState(true);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  useEffect(() => {
    const check = async () => {
      setChecking(true);
      try {
        const result = await checkIPFSHealth(apiUrl, gatewayUrl);
        setHealth(result);
        setLastCheck(new Date());
      } catch (error) {
        setHealth({
          apiAvailable: false,
          gatewayAvailable: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      } finally {
        setChecking(false);
      }
    };

    // Initial check
    check();

    // Set up interval for periodic checks
    const interval = setInterval(check, checkInterval);
    return () => clearInterval(interval);
  }, [apiUrl, gatewayUrl, checkInterval]);

  // Don't render anything while initial check is loading
  if (checking && !health) {
    return null;
  }

  // Don't show anything if IPFS is healthy and showWhenHealthy is false
  if (health?.apiAvailable && health?.gatewayAvailable && !showWhenHealthy) {
    return null;
  }

  const isHealthy = health?.apiAvailable && health?.gatewayAvailable;
  const hasPartialHealth = health?.apiAvailable || health?.gatewayAvailable;

  return (
    <div className={`rounded-lg border p-4 ${
      isHealthy 
        ? 'bg-green-50 border-green-200 text-green-800'
        : hasPartialHealth
        ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
        : 'bg-red-50 border-red-200 text-red-800'
    }`}>
      <div className="flex items-start">
        <div className="flex-shrink-0">
          {checking ? (
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current"></div>
          ) : isHealthy ? (
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          )}
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium">
            {checking ? 'Checking IPFS Status...' : 
             isHealthy ? 'IPFS is Running' :
             hasPartialHealth ? 'IPFS Partially Available' :
             'IPFS Not Available'}
          </h3>
          
          {health && (
            <div className="mt-2 text-sm">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    health.apiAvailable ? 'bg-green-500' : 'bg-red-500'
                  }`}></span>
                  <span>API ({apiUrl}): {health.apiAvailable ? 'Available' : 'Unavailable'}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    health.gatewayAvailable ? 'bg-green-500' : 'bg-red-500'
                  }`}></span>
                  <span>Gateway ({gatewayUrl}): {health.gatewayAvailable ? 'Available' : 'Unavailable'}</span>
                </div>
                {health.version && (
                  <div className="text-xs opacity-75">
                    Version: {health.version}
                  </div>
                )}
              </div>
              
              {!isHealthy && (
                <div className="mt-3 p-3 bg-white bg-opacity-50 rounded border">
                  <p className="font-medium text-sm mb-2">To start IPFS:</p>
                  <code className="block text-xs bg-black bg-opacity-10 p-2 rounded font-mono">
                    ipfs daemon
                  </code>
                  <p className="text-xs mt-2 opacity-75">
                    Need to install IPFS? Visit{' '}
                    <a 
                      href="https://docs.ipfs.tech/install/" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="underline hover:no-underline"
                    >
                      docs.ipfs.tech/install
                    </a>
                  </p>
                </div>
              )}
              
              {lastCheck && (
                <div className="text-xs opacity-50 mt-2">
                  Last checked: {lastCheck.toLocaleTimeString()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default IPFSStatus;
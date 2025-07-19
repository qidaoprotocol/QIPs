import React from 'react';
import { config } from '../config';

const LocalModeBanner: React.FC = () => {
  if (!config.localMode || typeof window === 'undefined') {
    return null;
  }

  return (
    <div className="bg-yellow-500 text-black px-4 py-2 text-center text-sm font-medium">
      <span className="mr-2">🚧</span>
      Local Development Mode - Connected to Anvil at localhost:8545
      <span className="ml-2">🚧</span>
    </div>
  );
};

export default LocalModeBanner;
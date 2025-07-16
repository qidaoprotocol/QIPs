import React from 'react';

const LocalModeBanner: React.FC = () => {
  const isLocalMode = process.env.GATSBY_LOCAL_MODE === 'true';
  
  if (!isLocalMode || typeof window === 'undefined') {
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
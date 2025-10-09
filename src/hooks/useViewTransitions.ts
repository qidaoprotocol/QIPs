import { useEffect, useState } from 'react';

/**
 * Hook to detect if the browser supports the View Transitions API
 * @returns boolean indicating View Transitions API support
 */
export function useViewTransitions(): boolean {
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    // Check if document.startViewTransition exists
    setIsSupported(
      typeof document !== 'undefined' &&
      'startViewTransition' in document
    );
  }, []);

  return isSupported;
}

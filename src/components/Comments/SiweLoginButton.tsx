import React from 'react';
import { ConnectKitButton } from 'connectkit';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useSiweSession } from '@/hooks/useSiweSession';

/**
 * The auth gate above the comment composer:
 *
 *   no wallet           → ConnectKitButton (defers to the existing flow
 *                          configured in Web3Provider — keeps wallet UX
 *                          consistent across the app).
 *   wallet, no session  → "Sign in to comment" button → useSiweSession.signIn()
 *   wallet + session    → renders nothing (composer takes over).
 *
 * Sign-in errors map to silent / toast surfaces:
 *   user_rejected → silent (the user just cancelled the wallet popup)
 *   verify_failed → toast (the API rejected the SIWE message)
 *   unknown       → toast (transport error, etc.)
 */
export const SiweLoginButton: React.FC = () => {
  const { isConnected } = useAccount();
  const { sessionToken, signIn, isPending } = useSiweSession();

  if (sessionToken) {
    return null;
  }

  if (!isConnected) {
    return <ConnectKitButton />;
  }

  return (
    <Button
      onClick={async () => {
        const result = await signIn();
        if (!result.ok && result.reason !== 'user_rejected') {
          toast.error(
            result.reason === 'verify_failed'
              ? "Couldn't verify your signature. Please try again."
              : "Couldn't sign in. Please try again.",
          );
        }
      }}
      disabled={isPending}
    >
      {isPending ? 'Signing in…' : 'Sign in to comment'}
    </Button>
  );
};

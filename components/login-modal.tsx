import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { useUser } from "../contexts/UserContext";

interface LoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogin: () => void;
}

export function LoginModal({ open, onOpenChange, onLogin }: LoginModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useUser();

  const handlePasskeyLogin = async () => {
    setIsLoading(true);
    try {
      const loggedInUser = await login();
      onLogin();
      toast.success(`Welcome back, ${loggedInUser.username}!`);
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Passkey sign-in failed";
      // Don't toast on user-cancelled WebAuthn prompts — those throw NotAllowedError
      if (!/NotAllowedError|cancelled|abort/i.test(message)) {
        toast.error(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="text-2xl">Welcome back</DialogTitle>
          <DialogDescription>
            Sign in with a passkey registered on this device or via your phone.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-4">
          <Button
            type="button"
            className="w-full"
            onClick={handlePasskeyLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <KeyRound className="w-4 h-4 mr-2" />
            )}
            {isLoading ? "Waiting for passkey..." : "Sign in with passkey"}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            No passkey yet? Ask an administrator for an enrolment link.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

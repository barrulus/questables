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
      <DialogContent
        overlayClassName="bg-[rgba(46,28,16,0.55)]"
        className="w-[420px] max-w-[calc(100vw-2rem)] gap-0 rounded-none border-[3px] border-[#2e1c10] bg-[#f3e4c8] p-[30px] font-alegreya shadow-[10px_10px_0_rgba(46,28,16,0.5)]"
      >
        <DialogHeader className="gap-2 p-0 text-left">
          <DialogTitle className="font-fell text-[34px] leading-none text-[#2e1c10]">
            Welcome back
          </DialogTitle>
          <DialogDescription className="text-[16px] leading-[1.5] text-[#6b4426]">
            Sign in with a passkey registered on this device or via your phone.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6 space-y-4">
          <Button
            type="button"
            variant="slab"
            size="slab"
            className="w-full py-[15px] text-[13px]"
            onClick={handlePasskeyLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <KeyRound className="mr-2 size-4" />
            )}
            {isLoading ? "Waiting for passkey…" : "Sign in with passkey"}
          </Button>

          <p className="text-center font-fell text-[14px] italic leading-[1.4] text-[#7a5636]">
            No passkey yet? Ask an administrator for an enrolment link.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { KeyRound, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { getEnrolment, enrolWithPasskey } from "../utils/api/passkey";
import { useUser } from "../contexts/UserContext";

interface EnrolPageProps {
  token: string;
  onComplete: () => void;
}

interface UserPreview {
  id: string;
  username: string;
  email: string;
}

export function EnrolPage({ token, onComplete }: EnrolPageProps) {
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [user, setUser] = useState<UserPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [done, setDone] = useState(false);
  const { loginWithSession } = useUser();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getEnrolment(token);
        if (cancelled) return;
        setUser(data.user);
        // Sensible default device name guess
        const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
        const guess = /iPhone|iPad/.test(ua)
          ? "iPhone"
          : /Android/.test(ua)
            ? "Android"
            : /Macintosh/.test(ua)
              ? "Mac"
              : /Windows/.test(ua)
                ? "Windows PC"
                : "This device";
        setDeviceName(guess);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Enrolment link is invalid or expired.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleEnrol = async () => {
    setEnrolling(true);
    setError(null);
    try {
      const result = await enrolWithPasskey(token, deviceName.trim() || undefined);
      loginWithSession(result.user, result.token);
      setDone(true);
      toast.success("Passkey registered. You're signed in.");
      // Brief pause so the user sees the success state, then jump into the app
      setTimeout(() => onComplete(), 1200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Passkey registration failed.";
      if (/NotAllowedError|cancelled|abort/i.test(message)) {
        setError("Passkey registration was cancelled.");
      } else {
        setError(message);
      }
    } finally {
      setEnrolling(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-destructive" />
              Enrolment link invalid
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Ask an administrator to issue a fresh link, then open it again.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>Register a passkey</CardTitle>
          <CardDescription>
            You're enrolling as <strong>{user?.username}</strong> ({user?.email}).
            Your device will create a passkey that you'll use to sign in from now on.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="device-name">Device label (optional)</Label>
            <Input
              id="device-name"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="e.g. iPhone, Work laptop"
              disabled={enrolling || done}
            />
            <p className="text-xs text-muted-foreground">
              Helps you tell passkeys apart in your settings later.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {done ? (
            <Alert>
              <CheckCircle2 className="w-4 h-4" />
              <AlertDescription>Passkey registered. Redirecting...</AlertDescription>
            </Alert>
          ) : (
            <Button onClick={handleEnrol} disabled={enrolling} className="w-full">
              {enrolling ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <KeyRound className="w-4 h-4 mr-2" />
              )}
              {enrolling ? "Waiting for passkey..." : "Register passkey"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Alert, AlertDescription } from "./ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, KeyRound, Loader2, Trash2, AlertCircle, Plus } from "lucide-react";
import { useUser } from "../contexts/UserContext";
import { addPasskey, listPasskeys, removePasskey, type PasskeyRecord } from "../utils/api/passkey";

interface UserSettingsPageProps {
  onBack: () => void;
}

export function UserSettingsPage({ onBack }: UserSettingsPageProps) {
  const { user } = useUser();
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PasskeyRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await listPasskeys();
      setPasskeys(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load passkeys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAdd = async () => {
    setBusy(true);
    try {
      await addPasskey(deviceName.trim() || undefined);
      toast.success("Passkey added");
      setAddOpen(false);
      setDeviceName("");
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add passkey";
      if (!/NotAllowedError|cancelled|abort/i.test(message)) {
        toast.error(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await removePasskey(deleteTarget.id);
      toast.success("Passkey removed");
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove passkey");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <h1 className="text-2xl font-semibold">Account settings</h1>
        </div>

        {user && (
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Read-only — ask an admin to change your username or email.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <span className="text-muted-foreground">Username</span>
                <div className="font-medium">{user.username}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Email</span>
                <div className="font-medium">{user.email}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Roles</span>
                <div className="font-medium">{user.roles.join(", ")}</div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Passkeys</CardTitle>
              <CardDescription>
                Sign-in keys bound to your devices. Register more than one so you don't get
                locked out if a device is lost.
              </CardDescription>
            </div>
            <Button onClick={() => setAddOpen(true)} disabled={busy}>
              <Plus className="w-4 h-4 mr-2" />
              Add passkey
            </Button>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : passkeys.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No passkeys yet. Add one to keep your account accessible.
              </p>
            ) : (
              <ul className="space-y-2">
                {passkeys.map((pk) => (
                  <li
                    key={pk.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <KeyRound className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{pk.device_name || "Unnamed device"}</div>
                        <div className="text-xs text-muted-foreground">
                          Added {new Date(pk.created_at).toLocaleDateString()}
                          {pk.last_used_at
                            ? ` • last used ${new Date(pk.last_used_at).toLocaleDateString()}`
                            : " • never used"}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(pk)}
                      disabled={busy || passkeys.length <= 1}
                      title={
                        passkeys.length <= 1
                          ? "Add another passkey before removing this one"
                          : "Remove this passkey"
                      }
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) setAddOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a passkey</DialogTitle>
            <DialogDescription>
              Your device will prompt you to create a passkey. Give it a friendly label so you
              can identify it later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="add-device-name">Device label</Label>
            <Input
              id="add-device-name"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="e.g. iPhone, Work laptop"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
              Register passkey
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove passkey?</DialogTitle>
            <DialogDescription>
              <strong>{deleteTarget?.device_name || "This passkey"}</strong> will be removed.
              You won't be able to sign in with it anymore.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              {busy ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

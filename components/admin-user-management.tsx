import { useCallback, useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Alert, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Search,
  Shield,
  ShieldOff,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
} from "lucide-react";
import { Label } from "./ui/label";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";

interface UserRecord {
  id: string;
  username: string;
  email: string;
  roles: string[];
  status: string;
  created_at: string;
  last_login: string | null;
}

interface ListUsersResponse {
  users: UserRecord[];
  total: number;
}

const PAGE_SIZE = 25;

export function AdminUserManagement() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [roleDialog, setRoleDialog] = useState<{ open: boolean; user: UserRecord | null; selectedRoles: string[] }>({
    open: false,
    user: null,
    selectedRoles: [],
  });
  const [mutating, setMutating] = useState(false);

  const [createDialog, setCreateDialog] = useState<{
    open: boolean; username: string; email: string; password: string; selectedRoles: string[];
  }>({ open: false, username: "", email: "", password: "", selectedRoles: ["player"] });

  const [editDialog, setEditDialog] = useState<{
    open: boolean; user: UserRecord | null; username: string; email: string; selectedRoles: string[];
  }>({ open: false, user: null, username: "", email: "", selectedRoles: [] });

  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean; user: UserRecord | null;
  }>({ open: false, user: null });

  const [passwordDialog, setPasswordDialog] = useState<{
    open: boolean; user: UserRecord | null; password: string;
  }>({ open: false, user: null, password: "" });

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));

      const response = await apiFetch(`/api/admin/users?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to load users"));
      }
      const data = await readJsonBody<ListUsersResponse>(response);
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleStatusChange = async (userId: string, newStatus: string) => {
    setMutating(true);
    try {
      const response = await apiFetch(`/api/admin/users/${userId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to update status"));
      }
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMutating(false);
    }
  };

  const handleRolesChange = async () => {
    if (!roleDialog.user) return;
    setMutating(true);
    try {
      const response = await apiFetch(`/api/admin/users/${roleDialog.user.id}/roles`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: roleDialog.selectedRoles }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to update roles"));
      }
      setRoleDialog({ open: false, user: null, selectedRoles: [] });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMutating(false);
    }
  };

  const handleCreateUser = async () => {
    setMutating(true);
    try {
      const response = await apiFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: createDialog.username,
          email: createDialog.email,
          password: createDialog.password,
          roles: createDialog.selectedRoles,
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to create user"));
      }
      setCreateDialog({ open: false, username: "", email: "", password: "", selectedRoles: ["player"] });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMutating(false);
    }
  };

  const handleEditUser = async () => {
    if (!editDialog.user) return;
    setMutating(true);
    try {
      const response = await apiFetch(`/api/admin/users/${editDialog.user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: editDialog.username,
          email: editDialog.email,
          roles: editDialog.selectedRoles,
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to update user"));
      }
      setEditDialog({ open: false, user: null, username: "", email: "", selectedRoles: [] });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMutating(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteDialog.user) return;
    setMutating(true);
    try {
      const response = await apiFetch(`/api/admin/users/${deleteDialog.user.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to delete user"));
      }
      setDeleteDialog({ open: false, user: null });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMutating(false);
    }
  };

  const handleResetPassword = async () => {
    if (!passwordDialog.user) return;
    setMutating(true);
    try {
      const response = await apiFetch(`/api/admin/users/${passwordDialog.user.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordDialog.password }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to reset password"));
      }
      setPasswordDialog({ open: false, user: null, password: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMutating(false);
    }
  };

  const toggleRole = (role: string) => {
    setRoleDialog((prev) => {
      const current = prev.selectedRoles;
      const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
      return { ...prev, selectedRoles: next.length > 0 ? next : current };
    });
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const statusBadgeVariant = (status: string) => {
    switch (status) {
      case "active": return "default" as const;
      case "inactive": return "secondary" as const;
      case "banned": return "destructive" as const;
      default: return "outline" as const;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">User Management</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setCreateDialog({ open: true, username: "", email: "", password: "", selectedRoles: ["player"] })}
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Create User
          </Button>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-9 w-56"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="banned">Banned</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No users found
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.username}</TableCell>
                      <TableCell className="text-muted-foreground">{u.email}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {u.roles.map((r) => (
                            <Badge key={r} variant="outline" className="text-xs">{r}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(u.status)}>{u.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(u.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" disabled={mutating}>
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {u.status !== "active" && (
                              <DropdownMenuItem onClick={() => handleStatusChange(u.id, "active")}>
                                <UserCheck className="w-4 h-4 mr-2" />
                                Activate
                              </DropdownMenuItem>
                            )}
                            {u.status !== "banned" && (
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleStatusChange(u.id, "banned")}
                              >
                                <UserX className="w-4 h-4 mr-2" />
                                Ban
                              </DropdownMenuItem>
                            )}
                            {u.status !== "inactive" && (
                              <DropdownMenuItem onClick={() => handleStatusChange(u.id, "inactive")}>
                                <ShieldOff className="w-4 h-4 mr-2" />
                                Deactivate
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setRoleDialog({ open: true, user: u, selectedRoles: [...u.roles] })}
                            >
                              <Shield className="w-4 h-4 mr-2" />
                              Change roles
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setEditDialog({ open: true, user: u, username: u.username, email: u.email, selectedRoles: [...u.roles] })}
                            >
                              <Pencil className="w-4 h-4 mr-2" />
                              Edit user
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setPasswordDialog({ open: true, user: u, password: "" })}
                            >
                              <KeyRound className="w-4 h-4 mr-2" />
                              Reset password
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteDialog({ open: true, user: u })}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete user
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={roleDialog.open} onOpenChange={(open) => { if (!open) setRoleDialog({ open: false, user: null, selectedRoles: [] }); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change roles for {roleDialog.user?.username}</DialogTitle>
            <DialogDescription>Select the roles this user should have.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 py-4">
            {["player", "dm", "admin"].map((role) => (
              <Button
                key={role}
                variant={roleDialog.selectedRoles.includes(role) ? "default" : "outline"}
                size="sm"
                onClick={() => toggleRole(role)}
              >
                {role}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialog({ open: false, user: null, selectedRoles: [] })}>
              Cancel
            </Button>
            <Button onClick={handleRolesChange} disabled={mutating || roleDialog.selectedRoles.length === 0}>
              {mutating ? "Saving..." : "Save roles"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create User Dialog */}
      <Dialog open={createDialog.open} onOpenChange={(open) => { if (!open) setCreateDialog({ open: false, username: "", email: "", password: "", selectedRoles: ["player"] }); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
            <DialogDescription>Create a new user account.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="create-username">Username</Label>
              <Input id="create-username" value={createDialog.username} onChange={(e) => setCreateDialog((prev) => ({ ...prev, username: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-email">Email</Label>
              <Input id="create-email" type="email" value={createDialog.email} onChange={(e) => setCreateDialog((prev) => ({ ...prev, email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-password">Password</Label>
              <Input id="create-password" type="password" value={createDialog.password} onChange={(e) => setCreateDialog((prev) => ({ ...prev, password: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Roles</Label>
              <div className="flex gap-2">
                {["player", "dm", "admin"].map((role) => (
                  <Button
                    key={role}
                    variant={createDialog.selectedRoles.includes(role) ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCreateDialog((prev) => {
                      const next = prev.selectedRoles.includes(role)
                        ? prev.selectedRoles.filter((r) => r !== role)
                        : [...prev.selectedRoles, role];
                      return { ...prev, selectedRoles: next.length > 0 ? next : prev.selectedRoles };
                    })}
                  >
                    {role}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialog({ open: false, username: "", email: "", password: "", selectedRoles: ["player"] })}>
              Cancel
            </Button>
            <Button onClick={handleCreateUser} disabled={mutating || !createDialog.username.trim() || !createDialog.email.trim() || createDialog.password.length < 6}>
              {mutating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialog.open} onOpenChange={(open) => { if (!open) setEditDialog({ open: false, user: null, username: "", email: "", selectedRoles: [] }); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editDialog.user?.username}</DialogTitle>
            <DialogDescription>Update user details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-username">Username</Label>
              <Input id="edit-username" value={editDialog.username} onChange={(e) => setEditDialog((prev) => ({ ...prev, username: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" type="email" value={editDialog.email} onChange={(e) => setEditDialog((prev) => ({ ...prev, email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Roles</Label>
              <div className="flex gap-2">
                {["player", "dm", "admin"].map((role) => (
                  <Button
                    key={role}
                    variant={editDialog.selectedRoles.includes(role) ? "default" : "outline"}
                    size="sm"
                    onClick={() => setEditDialog((prev) => {
                      const next = prev.selectedRoles.includes(role)
                        ? prev.selectedRoles.filter((r) => r !== role)
                        : [...prev.selectedRoles, role];
                      return { ...prev, selectedRoles: next.length > 0 ? next : prev.selectedRoles };
                    })}
                  >
                    {role}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog({ open: false, user: null, username: "", email: "", selectedRoles: [] })}>
              Cancel
            </Button>
            <Button onClick={handleEditUser} disabled={mutating || !editDialog.username.trim() || !editDialog.email.trim() || editDialog.selectedRoles.length === 0}>
              {mutating ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => { if (!open) setDeleteDialog({ open: false, user: null }); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteDialog.user?.username}</strong>? This action is irreversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, user: null })}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteUser} disabled={mutating}>
              {mutating ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Reset Dialog */}
      <Dialog open={passwordDialog.open} onOpenChange={(open) => { if (!open) setPasswordDialog({ open: false, user: null, password: "" }); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password for {passwordDialog.user?.username}</DialogTitle>
            <DialogDescription>Set a new password for this user.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="reset-password">New password</Label>
            <Input id="reset-password" type="password" value={passwordDialog.password} onChange={(e) => setPasswordDialog((prev) => ({ ...prev, password: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordDialog({ open: false, user: null, password: "" })}>
              Cancel
            </Button>
            <Button onClick={handleResetPassword} disabled={mutating || passwordDialog.password.length < 6}>
              {mutating ? "Resetting..." : "Reset password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

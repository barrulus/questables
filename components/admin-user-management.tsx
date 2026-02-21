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
  MoreHorizontal,
  Search,
  Shield,
  ShieldOff,
  UserX,
  UserCheck,
} from "lucide-react";
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
    </div>
  );
}

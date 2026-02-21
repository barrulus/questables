import { useCallback, useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Alert, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";

interface ModerationReport {
  id: string;
  report_type: string;
  description: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
  resolved_at: string | null;
  reporter_username: string | null;
  reported_username: string | null;
  resolved_by_username: string | null;
}

interface ListReportsResponse {
  reports: ModerationReport[];
  total: number;
}

const PAGE_SIZE = 25;

export function AdminModeration() {
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resolveDialog, setResolveDialog] = useState<{ open: boolean; report: ModerationReport | null; action: "resolved" | "dismissed" }>({
    open: false,
    report: null,
    action: "resolved",
  });
  const [adminNotes, setAdminNotes] = useState("");
  const [mutating, setMutating] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));

      const response = await apiFetch(`/api/admin/moderation/reports?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to load reports"));
      }
      const data = await readJsonBody<ListReportsResponse>(response);
      setReports(data.reports);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleResolve = async () => {
    if (!resolveDialog.report) return;
    setMutating(true);
    try {
      const response = await apiFetch(`/api/admin/moderation/reports/${resolveDialog.report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: resolveDialog.action,
          adminNotes: adminNotes.trim() || null,
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to update report"));
      }
      setResolveDialog({ open: false, report: null, action: "resolved" });
      setAdminNotes("");
      await loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMutating(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const statusBadgeVariant = (status: string) => {
    switch (status) {
      case "pending": return "default" as const;
      case "reviewed": return "secondary" as const;
      case "resolved": return "outline" as const;
      case "dismissed": return "outline" as const;
      default: return "outline" as const;
    }
  };

  const reportTypeLabel = (type: string) => {
    switch (type) {
      case "harassment": return "Harassment";
      case "cheating": return "Cheating";
      case "spam": return "Spam";
      case "inappropriate_content": return "Inappropriate Content";
      case "other": return "Other";
      default: return type;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">Moderation Queue</h2>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>
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
                  <TableHead>Type</TableHead>
                  <TableHead>Reporter</TableHead>
                  <TableHead>Reported User</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No reports found
                    </TableCell>
                  </TableRow>
                ) : (
                  reports.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Badge variant="outline">{reportTypeLabel(r.report_type)}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{r.reporter_username ?? "—"}</TableCell>
                      <TableCell className="text-sm font-medium">{r.reported_username ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                        {r.description}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(r.status)}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {(r.status === "pending" || r.status === "reviewed") && (
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Resolve"
                              onClick={() => {
                                setResolveDialog({ open: true, report: r, action: "resolved" });
                                setAdminNotes("");
                              }}
                            >
                              <CheckCircle className="w-4 h-4 text-green-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Dismiss"
                              onClick={() => {
                                setResolveDialog({ open: true, report: r, action: "dismissed" });
                                setAdminNotes("");
                              }}
                            >
                              <XCircle className="w-4 h-4 text-muted-foreground" />
                            </Button>
                          </div>
                        )}
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

      <Dialog open={resolveDialog.open} onOpenChange={(open) => { if (!open) setResolveDialog({ open: false, report: null, action: "resolved" }); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {resolveDialog.action === "resolved" ? "Resolve" : "Dismiss"} Report
            </DialogTitle>
            <DialogDescription>
              {resolveDialog.report?.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label>Admin Notes (optional)</Label>
            <Textarea
              placeholder="Add notes about this resolution..."
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDialog({ open: false, report: null, action: "resolved" })}>
              Cancel
            </Button>
            <Button
              variant={resolveDialog.action === "dismissed" ? "secondary" : "default"}
              onClick={handleResolve}
              disabled={mutating}
            >
              {mutating ? "Saving..." : resolveDialog.action === "resolved" ? "Resolve" : "Dismiss"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

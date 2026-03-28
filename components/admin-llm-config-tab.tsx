import { useCallback, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Skeleton } from "./ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Loader2, RefreshCw, Trash2, Zap } from "lucide-react";
import {
  listAdminLLMProviders,
  createAdminLLMProvider,
  updateAdminLLMProvider,
  deleteAdminLLMProvider,
  setAdminLLMDefaultProvider,
  listAdminLLMProviderModels,
  reloadAdminLLMServices,
  type LLMProviderWithHealth,
} from "../utils/api-client";
import { toast } from "sonner";

export function AdminLLMConfigTab() {
  const [providers, setProviders] = useState<LLMProviderWithHealth[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LLMProviderWithHealth | null>(null);
  const [form, setForm] = useState({ name: "", adapter: "ollama", host: "", model: "", apiKey: "", timeoutMs: "" });
  const [saving, setSaving] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listAdminLLMProviders();
      setProviders(result.providers);
      setInitialLoaded(true);
    } catch (error) {
      console.error("Failed to load LLM providers", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on first render
  if (!initialLoaded && !loading) {
    loadProviders();
  }

  const openDialog = useCallback((provider?: LLMProviderWithHealth) => {
    if (provider) {
      setEditingProvider(provider);
      setForm({
        name: provider.name,
        adapter: provider.adapter,
        host: provider.host ?? "",
        model: provider.model ?? "",
        apiKey: "",
        timeoutMs: provider.timeoutMs ? String(provider.timeoutMs) : "",
      });
    } else {
      setEditingProvider(null);
      setForm({ name: "", adapter: "ollama", host: "", model: "", apiKey: "", timeoutMs: "" });
    }
    setAvailableModels([]);
    setDialogOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (editingProvider) {
        const updates: Record<string, unknown> = {};
        if (form.adapter) updates.adapter = form.adapter;
        if (form.host) updates.host = form.host;
        if (form.model) updates.model = form.model;
        if (form.apiKey) updates.apiKey = form.apiKey;
        if (form.timeoutMs) updates.timeoutMs = Number(form.timeoutMs);
        await updateAdminLLMProvider(editingProvider.name, updates);
      } else {
        await createAdminLLMProvider({
          name: form.name,
          adapter: form.adapter,
          host: form.host || undefined,
          model: form.model || undefined,
          apiKey: form.apiKey || undefined,
          timeoutMs: form.timeoutMs ? Number(form.timeoutMs) : undefined,
        });
      }
      setDialogOpen(false);
      try { await reloadAdminLLMServices(); } catch { /* best-effort */ }
      await loadProviders();
      toast.success(editingProvider ? "Provider updated" : "Provider created");
    } catch (error) {
      console.error("Failed to save provider", error);
      toast.error(error instanceof Error ? error.message : "Failed to save provider");
    } finally {
      setSaving(false);
    }
  }, [editingProvider, form, loadProviders]);

  const handleDelete = useCallback(async (name: string) => {
    if (!window.confirm(`Delete provider "${name}"? This cannot be undone.`)) return;
    try {
      await deleteAdminLLMProvider(name);
      await loadProviders();
      toast.success(`Provider "${name}" deleted`);
    } catch (error) {
      console.error("Failed to delete provider", error);
      toast.error(error instanceof Error ? error.message : "Failed to delete provider");
    }
  }, [loadProviders]);

  const handleSetDefault = useCallback(async (name: string) => {
    try {
      await setAdminLLMDefaultProvider(name);
      await loadProviders();
      toast.success(`"${name}" set as default provider`);
    } catch (error) {
      console.error("Failed to set default provider", error);
      toast.error(error instanceof Error ? error.message : "Failed to set default provider");
    }
  }, [loadProviders]);

  const handleLoadModels = useCallback(async (name: string) => {
    setModelsLoading(true);
    try {
      const models = await listAdminLLMProviderModels(name);
      setAvailableModels(models);
    } catch (error) {
      console.error("Failed to load models", error);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const handleReload = useCallback(async () => {
    try {
      await reloadAdminLLMServices();
      await loadProviders();
      toast.success("LLM services reloaded");
    } catch (error) {
      console.error("Failed to reload LLM services", error);
      toast.error(error instanceof Error ? error.message : "Failed to reload LLM services");
    }
  }, [loadProviders]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">LLM Provider Configuration</h2>
          <p className="text-sm text-muted-foreground">Manage LLM providers, models, and defaults.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={loadProviders} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
          <Button onClick={handleReload} variant="outline">
            <Zap className="w-4 h-4" />
            <span className="ml-2">Reload Services</span>
          </Button>
          <Button onClick={() => openDialog()}>
            <span className="ml-1">Add Provider</span>
          </Button>
        </div>
      </div>

      {loading && providers.length === 0 ? (
        <Skeleton className="h-32 w-full" />
      ) : providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No providers configured. Add one to get started.</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Providers</CardTitle>
            <CardDescription>Registered LLM providers and their health status.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {providers.map((provider) => (
                <div key={provider.name} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{provider.name}</p>
                      {provider.default && <Badge className="text-xs">Default</Badge>}
                      <Badge variant={provider.health.healthy ? "outline" : "destructive"} className="text-xs">
                        {provider.health.healthy ? "Healthy" : "Unhealthy"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {provider.adapter} &middot; {provider.host ?? "\u2014"} &middot; {provider.model ?? "\u2014"}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {!provider.default && (
                      <Button variant="ghost" size="sm" onClick={() => handleSetDefault(provider.name)}>
                        Set Default
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => openDialog(provider)}>Edit</Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(provider.name)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg" onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement;
          if (target?.closest?.("[data-radix-select-content]") || target?.closest?.("[role='listbox']") || target?.closest?.("[role='option']")) {
            e.preventDefault();
          }
        }}>
          <DialogHeader>
            <DialogTitle>{editingProvider ? "Edit Provider" : "Add Provider"}</DialogTitle>
            <DialogDescription>
              {editingProvider ? `Editing ${editingProvider.name}` : "Configure a new LLM provider."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {!editingProvider && (
              <div>
                <Label htmlFor="prov-name">Name</Label>
                <Input id="prov-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="my-provider" />
              </div>
            )}
            <div>
              <Label htmlFor="prov-adapter">Adapter</Label>
              <Select value={form.adapter} onValueChange={(v) => setForm((p) => ({ ...p, adapter: v }))}>
                <SelectTrigger id="prov-adapter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ollama">Ollama</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="prov-host">Host</Label>
              <Input id="prov-host" value={form.host} onChange={(e) => setForm((p) => ({ ...p, host: e.target.value }))} placeholder="http://192.168.1.34:11434" />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="prov-model">Model</Label>
                {editingProvider && (
                  <Button variant="ghost" size="sm" onClick={() => handleLoadModels(editingProvider.name)} disabled={modelsLoading}>
                    {modelsLoading ? "Loading..." : "Fetch Models"}
                  </Button>
                )}
              </div>
              {availableModels.length > 0 ? (
                <Select value={form.model} onValueChange={(v) => setForm((p) => ({ ...p, model: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select model" /></SelectTrigger>
                  <SelectContent>
                    {availableModels.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input id="prov-model" value={form.model} onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))} placeholder="qwen3:8b" />
              )}
            </div>
            <div>
              <Label htmlFor="prov-apikey">API Key (optional)</Label>
              <Input id="prov-apikey" type="password" value={form.apiKey} onChange={(e) => setForm((p) => ({ ...p, apiKey: e.target.value }))} placeholder="Leave blank to keep current" />
            </div>
            <div>
              <Label htmlFor="prov-timeout">Timeout (ms)</Label>
              <Input id="prov-timeout" type="number" value={form.timeoutMs} onChange={(e) => setForm((p) => ({ ...p, timeoutMs: e.target.value }))} placeholder="60000" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {editingProvider ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

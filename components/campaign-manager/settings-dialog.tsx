import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Checkbox } from "../ui/checkbox";
import { Slider } from "../ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toast } from "sonner";
import { History, Loader2 } from "lucide-react";
import {
  type Campaign,
  type CampaignSettingsFormState,
  type ExperienceType,
  type RestingRules,
  type DeathSaveRules,
  buildSettingsFormState,
  createSettingsFormDefaults,
} from "../campaign-shared";
import {
  updateCampaign,
  getCampaignLLMSettings,
  updateCampaignLLMSettings,
  getCampaignLLMSettingsHistory,
  type UpdateCampaignRequest,
  type CampaignLLMSettings,
  type WorldTone,
  type NarrativeVoice,
  type PromptVersionEntry,
} from "../../utils/api-client";

export interface SettingsDialogProps {
  campaign: Campaign | null;
  userId: string;
  onClose: () => void;
  onSaved: (campaignId: string) => Promise<void>;
}

const NARRATIVE_TYPE_OPTIONS = [
  { value: "dm_narration", label: "DM Narration" },
  { value: "scene_description", label: "Scene Description" },
  { value: "npc_dialogue", label: "NPC Dialogue" },
  { value: "action_narrative", label: "Action Narrative" },
  { value: "quest_generation", label: "Quest Generation" },
  { value: "objective_description", label: "Objective Description" },
  { value: "shop_auto_stock", label: "Shop Auto-Stock" },
];

interface LLMSettingsForm {
  world_tone: WorldTone;
  narrative_voice: NarrativeVoice;
  custom_world_context: string;
  system_prompt_additions: string;
  directive_overrides: Record<string, string>;
  chat_history_depth: number;
  npc_memory_depth: number;
  include_undiscovered_locations: boolean;
  preferred_provider: string;
  preferred_model: string;
  temperature: string;
  top_p: string;
}

const defaultLLMForm: LLMSettingsForm = {
  world_tone: "balanced",
  narrative_voice: "concise",
  custom_world_context: "",
  system_prompt_additions: "",
  directive_overrides: {},
  chat_history_depth: 5,
  npc_memory_depth: 10,
  include_undiscovered_locations: false,
  preferred_provider: "",
  preferred_model: "",
  temperature: "",
  top_p: "",
};

function llmSettingsToForm(settings: CampaignLLMSettings): LLMSettingsForm {
  return {
    world_tone: settings.world_tone,
    narrative_voice: settings.narrative_voice,
    custom_world_context: settings.custom_world_context ?? "",
    system_prompt_additions: settings.system_prompt_additions ?? "",
    directive_overrides: settings.directive_overrides ?? {},
    chat_history_depth: settings.chat_history_depth,
    npc_memory_depth: settings.npc_memory_depth,
    include_undiscovered_locations: settings.include_undiscovered_locations,
    preferred_provider: settings.preferred_provider ?? "",
    preferred_model: settings.preferred_model ?? "",
    temperature: settings.temperature != null ? String(settings.temperature) : "",
    top_p: settings.top_p != null ? String(settings.top_p) : "",
  };
}

export function SettingsDialog({
  campaign,
  userId,
  onClose,
  onSaved,
}: SettingsDialogProps) {
  const [settingsForm, setSettingsForm] = useState<CampaignSettingsFormState>(
    () => createSettingsFormDefaults(),
  );
  const [settingsSaving, setSettingsSaving] = useState(false);

  // LLM settings state
  const [llmForm, setLLMForm] = useState<LLMSettingsForm>({ ...defaultLLMForm });
  const [llmLoading, setLLMLoading] = useState(false);
  const [llmSaving, setLLMSaving] = useState(false);
  const [llmLoaded, setLLMLoaded] = useState(false);
  const [overrideType, setOverrideType] = useState("dm_narration");

  // Prompt history state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyField, setHistoryField] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<PromptVersionEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Hydrate form when campaign changes
  useEffect(() => {
    if (campaign) {
      setSettingsForm(buildSettingsFormState(campaign));
      setLLMLoaded(false);
    }
  }, [campaign]);

  const loadLLMSettings = useCallback(async () => {
    if (!campaign || llmLoaded) return;
    setLLMLoading(true);
    try {
      const settings = await getCampaignLLMSettings(campaign.id);
      setLLMForm(llmSettingsToForm(settings));
      setLLMLoaded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load AI settings";
      toast.error(message);
    } finally {
      setLLMLoading(false);
    }
  }, [campaign, llmLoaded]);

  const handleClose = useCallback(() => {
    onClose();
    setSettingsForm(createSettingsFormDefaults());
    setLLMForm({ ...defaultLLMForm });
    setLLMLoaded(false);
  }, [onClose]);

  const handleUpdateCampaignSettings = useCallback(async () => {
    if (!campaign) return;

    if (campaign.dm_user_id !== userId) {
      toast.error("Only the campaign DM can update settings.");
      return;
    }

    const payload: UpdateCampaignRequest = {
      isPublic: settingsForm.isPublic,
      allowSpectators: settingsForm.allowSpectators,
      autoApproveJoinRequests: settingsForm.autoApproveJoinRequests,
      experienceType: settingsForm.experienceType,
      restingRules: settingsForm.restingRules,
      deathSaveRules: settingsForm.deathSaveRules,
    };

    try {
      setSettingsSaving(true);
      await updateCampaign(campaign.id, payload);
      await onSaved(campaign.id);
      toast.success("Campaign settings updated.");
      handleClose();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update campaign settings";
      toast.error(message);
    } finally {
      setSettingsSaving(false);
    }
  }, [
    handleClose,
    onSaved,
    campaign,
    settingsForm.allowSpectators,
    settingsForm.autoApproveJoinRequests,
    settingsForm.deathSaveRules,
    settingsForm.experienceType,
    settingsForm.isPublic,
    settingsForm.restingRules,
    userId,
  ]);

  const handleSaveLLMSettings = useCallback(async () => {
    if (!campaign) return;

    try {
      setLLMSaving(true);
      const payload: Partial<CampaignLLMSettings> = {
        world_tone: llmForm.world_tone,
        narrative_voice: llmForm.narrative_voice,
        custom_world_context: llmForm.custom_world_context || null,
        system_prompt_additions: llmForm.system_prompt_additions || null,
        directive_overrides: llmForm.directive_overrides,
        chat_history_depth: llmForm.chat_history_depth,
        npc_memory_depth: llmForm.npc_memory_depth,
        include_undiscovered_locations: llmForm.include_undiscovered_locations,
        preferred_provider: llmForm.preferred_provider || null,
        preferred_model: llmForm.preferred_model || null,
        temperature: llmForm.temperature ? Number(llmForm.temperature) : null,
        top_p: llmForm.top_p ? Number(llmForm.top_p) : null,
      };

      const updated = await updateCampaignLLMSettings(campaign.id, payload);
      setLLMForm(llmSettingsToForm(updated));
      toast.success("AI narrative settings updated.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update AI settings";
      toast.error(message);
    } finally {
      setLLMSaving(false);
    }
  }, [campaign, llmForm]);

  const handleOpenHistory = useCallback(async (field: string) => {
    if (!campaign) return;
    setHistoryField(field);
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const entries = await getCampaignLLMSettingsHistory(campaign.id);
      setHistoryEntries(entries.filter((e) => e.fieldName === field));
    } catch {
      toast.error("Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  }, [campaign]);

  const handleRestoreValue = useCallback((field: string, value: string | null) => {
    if (field === "custom_world_context") {
      setLLMForm((prev) => ({ ...prev, custom_world_context: value ?? "" }));
    } else if (field === "system_prompt_additions") {
      setLLMForm((prev) => ({ ...prev, system_prompt_additions: value ?? "" }));
    } else if (field === "directive_overrides") {
      try {
        const parsed = value ? JSON.parse(value) : {};
        setLLMForm((prev) => ({ ...prev, directive_overrides: parsed }));
      } catch {
        toast.error("Failed to restore directive overrides");
      }
    }
    setHistoryOpen(false);
    toast.info("Value restored. Save to apply.");
  }, []);

  return (
    <>
      <Dialog
        open={Boolean(campaign)}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Campaign Settings</DialogTitle>
            <DialogDescription>
              Control how players discover and interact with this campaign.
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="gameplay" onValueChange={(val) => { if (val === "ai-narrative") loadLLMSettings(); }}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="gameplay">Gameplay Rules</TabsTrigger>
              <TabsTrigger value="ai-narrative">AI Narrative</TabsTrigger>
            </TabsList>

            {/* ── Gameplay Rules Tab ── */}
            <TabsContent value="gameplay" className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Public campaign</p>
                    <p className="text-xs text-muted-foreground">
                      Allow players outside your roster to discover this campaign in
                      public listings.
                    </p>
                  </div>
                  <Switch
                    id="settings-campaign-public"
                    checked={settingsForm.isPublic}
                    onCheckedChange={(checked) =>
                      setSettingsForm((prev) => ({ ...prev, isPublic: checked }))
                    }
                    className="mt-1"
                  />
                </div>
                <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Allow spectators</p>
                    <p className="text-xs text-muted-foreground">
                      Enables view-only seats so non-participants can watch live
                      sessions.
                    </p>
                  </div>
                  <Switch
                    id="settings-campaign-spectators"
                    checked={settingsForm.allowSpectators}
                    onCheckedChange={(checked) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        allowSpectators: checked,
                      }))
                    }
                    className="mt-1"
                  />
                </div>
                <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      Auto-approve join requests
                    </p>
                    <p className="text-xs text-muted-foreground">
                      When enabled, new requests from authenticated users are
                      approved without manual review.
                    </p>
                  </div>
                  <Switch
                    id="settings-campaign-auto-approve"
                    checked={settingsForm.autoApproveJoinRequests}
                    onCheckedChange={(checked) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        autoApproveJoinRequests: checked,
                      }))
                    }
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="settings-experience">Experience model</Label>
                  <Select
                    value={settingsForm.experienceType}
                    onValueChange={(value) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        experienceType: value as ExperienceType,
                      }))
                    }
                  >
                    <SelectTrigger id="settings-experience">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="milestone">Milestone progression</SelectItem>
                      <SelectItem value="experience_points">Experience points</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="settings-resting">Resting rules</Label>
                  <Select
                    value={settingsForm.restingRules}
                    onValueChange={(value) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        restingRules: value as RestingRules,
                      }))
                    }
                  >
                    <SelectTrigger id="settings-resting">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard (PHB)</SelectItem>
                      <SelectItem value="gritty">Gritty realism</SelectItem>
                      <SelectItem value="heroic">Heroic rest variant</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="settings-death">Death save difficulty</Label>
                  <Select
                    value={settingsForm.deathSaveRules}
                    onValueChange={(value) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        deathSaveRules: value as DeathSaveRules,
                      }))
                    }
                  >
                    <SelectTrigger id="settings-death">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="hardcore">Hardcore (harder to stabilize)</SelectItem>
                      <SelectItem value="forgiving">Forgiving (easier stabilization)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                <Button onClick={handleUpdateCampaignSettings} disabled={settingsSaving}>
                  {settingsSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Save Settings
                </Button>
              </div>
            </TabsContent>

            {/* ── AI Narrative Tab ── */}
            <TabsContent value="ai-narrative" className="space-y-4">
              {llmLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {/* World Tone & Narrative Voice */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="llm-world-tone">World Tone</Label>
                      <Select
                        value={llmForm.world_tone}
                        onValueChange={(v) => setLLMForm((prev) => ({ ...prev, world_tone: v as WorldTone }))}
                      >
                        <SelectTrigger id="llm-world-tone"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="balanced">Balanced</SelectItem>
                          <SelectItem value="dark">Dark</SelectItem>
                          <SelectItem value="heroic">Heroic</SelectItem>
                          <SelectItem value="comedic">Comedic</SelectItem>
                          <SelectItem value="gritty">Gritty</SelectItem>
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="llm-narrative-voice">Narrative Voice</Label>
                      <Select
                        value={llmForm.narrative_voice}
                        onValueChange={(v) => setLLMForm((prev) => ({ ...prev, narrative_voice: v as NarrativeVoice }))}
                      >
                        <SelectTrigger id="llm-narrative-voice"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="concise">Concise</SelectItem>
                          <SelectItem value="verbose">Verbose</SelectItem>
                          <SelectItem value="poetic">Poetic</SelectItem>
                          <SelectItem value="terse">Terse</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* World Context */}
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="llm-world-context">World Context</Label>
                      <Button variant="ghost" size="sm" onClick={() => handleOpenHistory("custom_world_context")}>
                        <History className="w-3 h-3 mr-1" /> History
                      </Button>
                    </div>
                    <Textarea
                      id="llm-world-context"
                      value={llmForm.custom_world_context}
                      onChange={(e) => setLLMForm((prev) => ({ ...prev, custom_world_context: e.target.value }))}
                      placeholder="Custom world lore injected into every prompt..."
                      rows={3}
                    />
                  </div>

                  {/* System Prompt Additions */}
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="llm-system-additions">System Prompt Additions</Label>
                      <Button variant="ghost" size="sm" onClick={() => handleOpenHistory("system_prompt_additions")}>
                        <History className="w-3 h-3 mr-1" /> History
                      </Button>
                    </div>
                    <Textarea
                      id="llm-system-additions"
                      value={llmForm.system_prompt_additions}
                      onChange={(e) => setLLMForm((prev) => ({ ...prev, system_prompt_additions: e.target.value }))}
                      placeholder="Additional instructions appended to the system prompt..."
                      rows={3}
                    />
                  </div>

                  {/* Per-Type Directive Overrides */}
                  <div>
                    <div className="flex items-center justify-between">
                      <Label>Per-Type Directive Override</Label>
                      <Button variant="ghost" size="sm" onClick={() => handleOpenHistory("directive_overrides")}>
                        <History className="w-3 h-3 mr-1" /> History
                      </Button>
                    </div>
                    <div className="flex gap-2 mt-1">
                      <Select value={overrideType} onValueChange={setOverrideType}>
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {NARRATIVE_TYPE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Textarea
                      className="mt-2"
                      value={llmForm.directive_overrides[overrideType] ?? ""}
                      onChange={(e) =>
                        setLLMForm((prev) => ({
                          ...prev,
                          directive_overrides: {
                            ...prev.directive_overrides,
                            [overrideType]: e.target.value,
                          },
                        }))
                      }
                      placeholder={`Override directives for ${overrideType}...`}
                      rows={2}
                    />
                  </div>

                  {/* Context Depth */}
                  <div className="space-y-3">
                    <div>
                      <Label>Chat History Depth: {llmForm.chat_history_depth}</Label>
                      <Slider
                        min={1}
                        max={20}
                        step={1}
                        value={[llmForm.chat_history_depth]}
                        onValueChange={([v]) => setLLMForm((prev) => ({ ...prev, chat_history_depth: v }))}
                      />
                    </div>
                    <div>
                      <Label>NPC Memory Depth: {llmForm.npc_memory_depth}</Label>
                      <Slider
                        min={1}
                        max={25}
                        step={1}
                        value={[llmForm.npc_memory_depth]}
                        onValueChange={([v]) => setLLMForm((prev) => ({ ...prev, npc_memory_depth: v }))}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="llm-include-undiscovered"
                        checked={llmForm.include_undiscovered_locations}
                        onCheckedChange={(checked) =>
                          setLLMForm((prev) => ({ ...prev, include_undiscovered_locations: Boolean(checked) }))
                        }
                      />
                      <Label htmlFor="llm-include-undiscovered" className="text-sm font-normal">
                        Include undiscovered locations in context
                      </Label>
                    </div>
                  </div>

                  {/* Provider Override */}
                  <details className="rounded-md border p-3">
                    <summary className="text-sm font-medium cursor-pointer">Provider Override (optional)</summary>
                    <div className="grid gap-3 md:grid-cols-2 mt-3">
                      <div>
                        <Label htmlFor="llm-provider">Provider</Label>
                        <Input
                          id="llm-provider"
                          value={llmForm.preferred_provider}
                          onChange={(e) => setLLMForm((prev) => ({ ...prev, preferred_provider: e.target.value }))}
                          placeholder="e.g. ollama"
                        />
                      </div>
                      <div>
                        <Label htmlFor="llm-model">Model</Label>
                        <Input
                          id="llm-model"
                          value={llmForm.preferred_model}
                          onChange={(e) => setLLMForm((prev) => ({ ...prev, preferred_model: e.target.value }))}
                          placeholder="e.g. qwen3:8b"
                        />
                      </div>
                      <div>
                        <Label htmlFor="llm-temperature">Temperature (0.0 - 2.0)</Label>
                        <Input
                          id="llm-temperature"
                          type="number"
                          min={0}
                          max={2}
                          step={0.1}
                          value={llmForm.temperature}
                          onChange={(e) => setLLMForm((prev) => ({ ...prev, temperature: e.target.value }))}
                          placeholder="0.7"
                        />
                      </div>
                      <div>
                        <Label htmlFor="llm-top-p">Top-P (0.0 - 1.0)</Label>
                        <Input
                          id="llm-top-p"
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={llmForm.top_p}
                          onChange={(e) => setLLMForm((prev) => ({ ...prev, top_p: e.target.value }))}
                          placeholder="0.9"
                        />
                      </div>
                    </div>
                  </details>

                  <div className="flex justify-end gap-2 pt-4">
                    <Button variant="outline" onClick={handleClose}>Cancel</Button>
                    <Button onClick={handleSaveLLMSettings} disabled={llmSaving}>
                      {llmSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Save AI Settings
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* ── Prompt Version History Sheet ── */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Prompt History</SheetTitle>
            <SheetDescription>
              Version history for {historyField?.replace(/_/g, " ")}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3 max-h-[70vh] overflow-y-auto">
            {historyLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : historyEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No history entries found.</p>
            ) : (
              historyEntries.map((entry) => (
                <div key={entry.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{entry.changedByUsername ?? "unknown"}</span>
                    <span>{entry.changedAt ? new Date(entry.changedAt).toLocaleString() : ""}</span>
                  </div>
                  {entry.oldValue && (
                    <div>
                      <p className="text-xs font-medium text-destructive">Old:</p>
                      <pre className="text-xs bg-muted p-2 rounded max-h-24 overflow-y-auto whitespace-pre-wrap">{entry.oldValue}</pre>
                    </div>
                  )}
                  {entry.newValue && (
                    <div>
                      <p className="text-xs font-medium text-green-600">New:</p>
                      <pre className="text-xs bg-muted p-2 rounded max-h-24 overflow-y-auto whitespace-pre-wrap">{entry.newValue}</pre>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRestoreValue(entry.fieldName, entry.oldValue)}
                  >
                    Restore old value
                  </Button>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

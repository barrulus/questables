/**
 * WorldLorePanel — collaborative world-building UI for campaign prep.
 *
 * The CD uses this to generate, review, edit, and manage world lore sections
 * (geopolitical, history, cultures, religions, regions, factions) in
 * collaboration with the LLM.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles, Pencil, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { apiFetch, readJsonBody, readErrorMessage } from "../utils/api-client";

interface LoreEntry {
  id: string;
  section: string;
  subsection: string | null;
  content: string;
  cd_direction: string | null;
  generated_by: string;
  version: number;
  created_at: string;
  updated_at: string;
}

const SECTIONS = [
  { key: "geopolitical", label: "Geopolitical Overview", description: "States, alliances, rivalries, trade relationships" },
  { key: "history", label: "World History", description: "Eras, events, legends, catastrophes" },
  { key: "cultures", label: "Cultures", description: "Peoples, customs, values, social structures" },
  { key: "religions", label: "Religions", description: "Faiths, clergy, holy sites, festivals" },
  { key: "regions", label: "Regional Backstories", description: "Per-state rulers, customs, economy, challenges" },
  { key: "factions", label: "Factions & Organisations", description: "Guilds, orders, secret societies, rebel groups" },
] as const;

interface WorldLorePanelProps {
  campaignId: string;
  canEdit: boolean;
}

export function WorldLorePanel({ campaignId, canEdit }: WorldLorePanelProps) {
  const [lore, setLore] = useState<LoreEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [directions, setDirections] = useState<Record<string, string>>({});

  const loadLore = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/campaigns/${campaignId}/world-building/lore`);
      if (res.ok) {
        const data = await readJsonBody<LoreEntry[]>(res);
        setLore(data);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    loadLore();
  }, [loadLore]);

  const handleGenerate = useCallback(async (section: string, subsection?: string) => {
    setGenerating(section);
    try {
      const res = await apiFetch(`/api/campaigns/${campaignId}/world-building/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section,
          subsection: subsection ?? null,
          direction: directions[section]?.trim() || null,
        }),
      });
      if (res.ok) {
        toast.success(`Generated ${section} lore`);
        await loadLore();
      } else {
        const msg = await readErrorMessage(res, "Generation failed");
        toast.error(msg);
      }
    } catch {
      toast.error("Failed to generate lore");
    } finally {
      setGenerating(null);
    }
  }, [campaignId, directions, loadLore]);

  const handleSaveEdit = useCallback(async (loreId: string) => {
    try {
      const res = await apiFetch(`/api/campaigns/${campaignId}/world-building/lore/${loreId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (res.ok) {
        toast.success("Lore updated");
        setEditingId(null);
        await loadLore();
      } else {
        toast.error("Failed to update lore");
      }
    } catch {
      toast.error("Failed to update lore");
    }
  }, [campaignId, editContent, loadLore]);

  const handleDelete = useCallback(async (loreId: string) => {
    try {
      const res = await apiFetch(`/api/campaigns/${campaignId}/world-building/lore/${loreId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Lore deleted");
        await loadLore();
      }
    } catch {
      toast.error("Failed to delete lore");
    }
  }, [campaignId, loadLore]);

  const getLoreForSection = (sectionKey: string) =>
    lore.filter((l) => l.section === sectionKey);

  if (loading && lore.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>World Lore</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <Loader2 className="h-5 w-5 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">World Lore</CardTitle>
        <CardDescription>
          Build your world collaboratively with the LLM. Provide direction, generate content, then edit to refine.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto space-y-3">
        {SECTIONS.map((section) => {
          const entries = getLoreForSection(section.key);
          const isExpanded = expandedSection === section.key;
          const isGenerating = generating === section.key;

          return (
            <div key={section.key} className="border rounded-lg">
              <button
                className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedSection(isExpanded ? null : section.key)}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{section.label}</span>
                    {entries.length > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        v{entries[0].version} · {entries[0].generated_by}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{section.description}</p>
                </div>
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              {isExpanded && (
                <div className="border-t p-3 space-y-3">
                  {/* Direction input */}
                  {canEdit && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Your direction (optional)</Label>
                      <Input
                        placeholder={`e.g. "Make the northern kingdom isolationist and suspicious of magic"`}
                        value={directions[section.key] ?? ""}
                        onChange={(e) =>
                          setDirections((prev) => ({ ...prev, [section.key]: e.target.value }))
                        }
                        className="text-sm"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleGenerate(section.key)}
                        disabled={isGenerating}
                      >
                        {isGenerating ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5 mr-1" />
                        )}
                        {entries.length > 0 ? "Regenerate" : "Generate"}
                      </Button>
                    </div>
                  )}

                  {/* Content display/edit */}
                  {entries.map((entry) => (
                    <div key={entry.id} className="space-y-2">
                      {editingId === entry.id ? (
                        <div className="space-y-2">
                          <Textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows={12}
                            className="text-sm font-mono"
                          />
                          <div className="flex gap-1.5">
                            <Button size="sm" onClick={() => handleSaveEdit(entry.id)}>
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap bg-muted/30 rounded p-3 max-h-96 overflow-y-auto">
                            {entry.content}
                          </div>
                          {entry.cd_direction && (
                            <p className="text-xs text-muted-foreground italic">
                              Direction: &ldquo;{entry.cd_direction}&rdquo;
                            </p>
                          )}
                          {canEdit && (
                            <div className="flex gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingId(entry.id);
                                  setEditContent(entry.content);
                                }}
                              >
                                <Pencil className="h-3 w-3 mr-1" /> Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => handleDelete(entry.id)}
                              >
                                <Trash2 className="h-3 w-3 mr-1" /> Delete
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {entries.length === 0 && !isGenerating && (
                    <p className="text-xs text-muted-foreground italic py-2">
                      No lore generated yet. Provide direction above and click Generate.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";
import { Loader2 } from "lucide-react";

const abilityKeys = [
  "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma",
] as const;

const abilityLabels: Record<typeof abilityKeys[number], string> = {
  strength: "Strength", dexterity: "Dexterity", constitution: "Constitution",
  intelligence: "Intelligence", wisdom: "Wisdom", charisma: "Charisma",
};

export interface CharacterFormState {
  id?: string;
  name: string;
  className: string;
  level: number;
  race: string;
  background: string;
  armorClass: number;
  speed: number;
  proficiencyBonus: number;
  hitPointsCurrent: number;
  hitPointsMax: number;
  hitPointsTemporary: number;
  abilities: Record<typeof abilityKeys[number], number>;
  backstory: string;
  personality: string;
  ideals: string;
  bonds: string;
  flaws: string;
}

interface CharacterEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formState: CharacterFormState;
  onFormStateChange: (updater: (prev: CharacterFormState) => CharacterFormState) => void;
  mode: "create" | "edit";
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}

export function CharacterEditDialog({
  open,
  onOpenChange,
  formState,
  onFormStateChange,
  mode,
  saving,
  onSave,
  onCancel,
}: CharacterEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create Character" : "Edit Character"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <Tabs defaultValue="core" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="core">Core</TabsTrigger>
              <TabsTrigger value="stats">Stats</TabsTrigger>
              <TabsTrigger value="story">Story</TabsTrigger>
            </TabsList>
            <TabsContent value="core" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="name">Name *</Label>
                  <Input id="name" value={formState.name} onChange={(event) => onFormStateChange((prev) => ({ ...prev, name: event.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="class">Class *</Label>
                  <Input id="class" value={formState.className} onChange={(event) => onFormStateChange((prev) => ({ ...prev, className: event.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="race">Race *</Label>
                  <Input id="race" value={formState.race} onChange={(event) => onFormStateChange((prev) => ({ ...prev, race: event.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="background">Background</Label>
                  <Input id="background" value={formState.background} onChange={(event) => onFormStateChange((prev) => ({ ...prev, background: event.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="level">Level</Label>
                  <Input id="level" type="number" min={1} max={20} value={formState.level} onChange={(event) => onFormStateChange((prev) => ({ ...prev, level: Number(event.target.value) || 1 }))} />
                </div>
                <div>
                  <Label htmlFor="armorClass">Armor Class</Label>
                  <Input id="armorClass" type="number" value={formState.armorClass} onChange={(event) => onFormStateChange((prev) => ({ ...prev, armorClass: Number(event.target.value) || 10 }))} />
                </div>
                <div>
                  <Label htmlFor="speed">Speed</Label>
                  <Input id="speed" type="number" value={formState.speed} onChange={(event) => onFormStateChange((prev) => ({ ...prev, speed: Number(event.target.value) || 30 }))} />
                </div>
                <div>
                  <Label htmlFor="proficiency">Proficiency Bonus</Label>
                  <Input id="proficiency" type="number" value={formState.proficiencyBonus} onChange={(event) => onFormStateChange((prev) => ({ ...prev, proficiencyBonus: Number(event.target.value) || 2 }))} />
                </div>
              </div>
            </TabsContent>
            <TabsContent value="stats" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <Label htmlFor="hpCurrent">Current HP</Label>
                  <Input id="hpCurrent" type="number" value={formState.hitPointsCurrent} onChange={(event) => onFormStateChange((prev) => ({ ...prev, hitPointsCurrent: Number(event.target.value) || 0 }))} />
                </div>
                <div>
                  <Label htmlFor="hpMax">Maximum HP</Label>
                  <Input id="hpMax" type="number" value={formState.hitPointsMax} onChange={(event) => onFormStateChange((prev) => ({ ...prev, hitPointsMax: Number(event.target.value) || 0 }))} />
                </div>
                <div>
                  <Label htmlFor="hpTemp">Temporary HP</Label>
                  <Input id="hpTemp" type="number" value={formState.hitPointsTemporary} onChange={(event) => onFormStateChange((prev) => ({ ...prev, hitPointsTemporary: Number(event.target.value) || 0 }))} />
                </div>
              </div>
              <div>
                <Label>Ability Scores</Label>
                <div className="mt-2 grid gap-4 md:grid-cols-3">
                  {abilityKeys.map((ability) => (
                    <div key={ability}>
                      <Label className="text-xs uppercase text-muted-foreground">{abilityLabels[ability]}</Label>
                      <Input
                        type="number" min={1} max={30}
                        value={formState.abilities[ability]}
                        onChange={(event) => onFormStateChange((prev) => ({
                          ...prev,
                          abilities: { ...prev.abilities, [ability]: Number(event.target.value) || 10 },
                        }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
            <TabsContent value="story" className="space-y-4">
              <div>
                <Label htmlFor="backstory">Backstory</Label>
                <Textarea id="backstory" rows={4} value={formState.backstory} onChange={(event) => onFormStateChange((prev) => ({ ...prev, backstory: event.target.value }))} />
              </div>
              <div>
                <Label htmlFor="personality">Personality</Label>
                <Textarea id="personality" rows={3} value={formState.personality} onChange={(event) => onFormStateChange((prev) => ({ ...prev, personality: event.target.value }))} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="ideals">Ideals</Label>
                  <Textarea id="ideals" rows={3} value={formState.ideals} onChange={(event) => onFormStateChange((prev) => ({ ...prev, ideals: event.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="bonds">Bonds</Label>
                  <Textarea id="bonds" rows={3} value={formState.bonds} onChange={(event) => onFormStateChange((prev) => ({ ...prev, bonds: event.target.value }))} />
                </div>
              </div>
              <div>
                <Label htmlFor="flaws">Flaws</Label>
                <Textarea id="flaws" rows={3} value={formState.flaws} onChange={(event) => onFormStateChange((prev) => ({ ...prev, flaws: event.target.value }))} />
              </div>
            </TabsContent>
          </Tabs>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
            <Button onClick={onSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "create" ? "Create" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

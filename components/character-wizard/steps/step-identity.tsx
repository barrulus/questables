import { useState, useEffect } from 'react';
import { useWizard } from '../wizard-context';
import { ALIGNMENTS } from '../../../utils/srd/constants';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';

export function StepIdentity() {
  const { state, dispatch } = useWizard();
  const [name, setName] = useState(state.name || '');
  const [alignment, setAlignment] = useState(state.alignment || '');
  const [personality, setPersonality] = useState(state.personality || '');
  const [ideals, setIdeals] = useState(state.ideals || '');
  const [bonds, setBonds] = useState(state.bonds || '');
  const [flaws, setFlaws] = useState(state.flaws || '');
  const [backstory, setBackstory] = useState(state.backstory || '');

  // Debounce updates to wizard state
  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: 'SET_IDENTITY', field: 'name', value: name });
    }, 300);
    return () => clearTimeout(timer);
  }, [name, dispatch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: 'SET_IDENTITY', field: 'alignment', value: alignment });
    }, 300);
    return () => clearTimeout(timer);
  }, [alignment, dispatch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: 'SET_IDENTITY', field: 'personality', value: personality });
    }, 300);
    return () => clearTimeout(timer);
  }, [personality, dispatch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: 'SET_IDENTITY', field: 'ideals', value: ideals });
    }, 300);
    return () => clearTimeout(timer);
  }, [ideals, dispatch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: 'SET_IDENTITY', field: 'bonds', value: bonds });
    }, 300);
    return () => clearTimeout(timer);
  }, [bonds, dispatch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: 'SET_IDENTITY', field: 'flaws', value: flaws });
    }, 300);
    return () => clearTimeout(timer);
  }, [flaws, dispatch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: 'SET_IDENTITY', field: 'backstory', value: backstory });
    }, 300);
    return () => clearTimeout(timer);
  }, [backstory, dispatch]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Character Identity</h2>
        <p className="text-muted-foreground">
          Define your character's personality, beliefs, and backstory.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">
                Character Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                placeholder="Enter your character's name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="alignment">Alignment</Label>
              <Select value={alignment} onValueChange={setAlignment}>
                <SelectTrigger id="alignment">
                  <SelectValue placeholder="Select an alignment..." />
                </SelectTrigger>
                <SelectContent>
                  {ALIGNMENTS.map((align: string) => (
                    <SelectItem key={align} value={align}>
                      {align}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Alignment represents your character's moral and ethical outlook.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Personality</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="personality">Personality Traits</Label>
              <Textarea
                id="personality"
                placeholder="Describe your character's personality traits..."
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ideals">Ideals</Label>
              <Textarea
                id="ideals"
                placeholder="What does your character believe in?"
                value={ideals}
                onChange={(e) => setIdeals(e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bonds">Bonds</Label>
              <Textarea
                id="bonds"
                placeholder="What ties your character to the world?"
                value={bonds}
                onChange={(e) => setBonds(e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="flaws">Flaws</Label>
              <Textarea
                id="flaws"
                placeholder="What are your character's weaknesses?"
                value={flaws}
                onChange={(e) => setFlaws(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backstory</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="backstory">Character Backstory</Label>
            <Textarea
              id="backstory"
              placeholder="Tell your character's story..."
              value={backstory}
              onChange={(e) => setBackstory(e.target.value)}
              rows={6}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

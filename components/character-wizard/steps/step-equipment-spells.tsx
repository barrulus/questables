import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useWizard } from '../wizard-context';
import { fetchSpells, fetchClassByKey, fetchItems } from '../../../utils/api/srd';
import type { SrdSpell, SrdClass, SrdItem } from '../../../utils/srd/types';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { ScrollArea } from '../../ui/scroll-area';
import { Checkbox } from '../../ui/checkbox';
import { Label } from '../../ui/label';
import { Button } from '../../ui/button';
import { RadioGroup, RadioGroupItem } from '../../ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { Info } from 'lucide-react';
import { MarkdownText } from '../markdown-text';
import { SrdDetailModal } from '../srd-detail-modal';
import { EquipmentShop, parseCostGP } from './equipment-shop';
import type { CartEntry } from './equipment-shop';

const DESC_PREVIEW_LENGTH = 120;

/** Extract equipment options from "Core * Traits" table's Starting Equipment row. */
export function parseEquipmentOptions(coreTraitsDesc: string): { label: string; items: string }[] | null {
  // Find the Starting Equipment row in the pipe table
  const lines = coreTraitsDesc.split('\n');
  const equipLine = lines.find((l) => l.includes('Starting Equipment'));
  if (!equipLine) return null;

  // Get the value cell: "|Starting Equipment|Choose A or B: ...|"
  const cells = equipLine.split('|').map((c) => c.trim()).filter(Boolean);
  const value = cells.length >= 2 ? cells.slice(1).join(' | ') : null;
  if (!value) return null;

  // Parse "(A) items; (B) items; or (C) items" pattern
  const optionRegex = /\(([A-Z])\)\s*([^;]*?)(?:;|$)/g;
  const options: { label: string; items: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = optionRegex.exec(value)) !== null) {
    options.push({ label: match[1], items: match[2].replace(/^or\s+/i, '').trim() });
  }

  return options.length > 0 ? options : null;
}

function SpellDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > DESC_PREVIEW_LENGTH;

  if (expanded || !needsTruncation) {
    return (
      <div className="text-xs text-muted-foreground mt-1">
        <MarkdownText text={text} />
        {needsTruncation && (
          <Button
            variant="link"
            className="h-auto p-0 ml-1 text-xs"
            onClick={(e) => { e.preventDefault(); setExpanded(false); }}
          >
            Show less
          </Button>
        )}
      </div>
    );
  }

  return (
    <p className="text-xs text-muted-foreground mt-1">
      {text.substring(0, DESC_PREVIEW_LENGTH)}...
      <Button
        variant="link"
        className="h-auto p-0 ml-1 text-xs"
        onClick={(e) => { e.preventDefault(); setExpanded(true); }}
      >
        Show more
      </Button>
    </p>
  );
}

export function StepEquipmentSpells() {
  const { state, dispatch } = useWizard();
  const [spells, setSpells] = useState<SrdSpell[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSpellcaster, setIsSpellcaster] = useState(false);
  const [cantripsKnown, setCantripsKnown] = useState(0);
  const [spellsKnown, setSpellsKnown] = useState(0);
  const [classData, setClassData] = useState<SrdClass | null>(null);
  const [detailSpell, setDetailSpell] = useState<SrdSpell | null>(null);
  const [detailItem, setDetailItem] = useState<SrdItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailType, setDetailType] = useState<'spell' | 'item'>('spell');

  // Restore equipment choice and cart from wizard context
  // Format: ['pack-A'] for equipment pack, ['gold-B', 'itemkey:qty', ...] for gold option
  const [equipmentChoice, setEquipmentChoice] = useState<string>(() => {
    const equip = state.chosenEquipment;
    if (equip.length === 0) return '';
    const tag = equip[0];
    if (tag.startsWith('pack-')) return tag.replace('pack-', '');
    if (tag.startsWith('gold-')) return tag.replace('gold-', '');
    return '';
  });
  const [shopCart, setShopCart] = useState<CartEntry[]>(() =>
    state.chosenEquipment
      .filter((e) => e.includes(':'))
      .map((e) => {
        const [key, qtyStr] = e.split(':');
        return { key, name: key.split('_').pop()?.replace(/-/g, ' ') ?? key, cost: 0, qty: parseInt(qtyStr) || 1 };
      }),
  );
  const [activeTab, setActiveTab] = useState(() => {
    if (!state.classKey) return 'equipment';
    const spellcastingClasses = ['wizard', 'cleric', 'druid', 'bard', 'sorcerer', 'warlock', 'paladin', 'ranger'];
    const caster = spellcastingClasses.some((c) => state.classKey?.toLowerCase().includes(c));
    return caster && state.chosenEquipment.length > 0 ? 'spells' : 'equipment';
  });

  // Fetch class data for equipment display
  const [prevClassKey, setPrevClassKey] = useState(state.classKey);
  useEffect(() => {
    if (!state.classKey) { setClassData(null); return; }
    // Only reset choices when class actually changes (not on remount)
    if (state.classKey !== prevClassKey) {
      setPrevClassKey(state.classKey);
      setEquipmentChoice('');
      setShopCart([]);
    }
    const controller = new AbortController();
    fetchClassByKey(state.classKey, { signal: controller.signal, source: state.documentSource })
      .then((data) => {
        if (!controller.signal.aborted) {
          setClassData(data);
        }
      })
      .catch((err) => { if (!(err instanceof Error && err.name === 'AbortError')) console.error(err); });
    return () => controller.abort();
  }, [state.classKey, prevClassKey]);

  // Resolve cart item names/costs on remount (costs are 0 when restored from context)
  useEffect(() => {
    const unresolved = shopCart.filter((e) => e.cost === 0);
    if (unresolved.length === 0) return;
    const controller = new AbortController();
    // Fetch all items without category filter to resolve any cart item
    fetchItems({}, { signal: controller.signal })
      .then((allItems) => {
        if (controller.signal.aborted) return;
        setShopCart((prev) =>
          prev.map((entry) => {
            if (entry.cost > 0) return entry;
            const found = allItems.find((i) => i.key === entry.key);
            return found
              ? { ...entry, name: found.name, cost: parseCostGP(found.cost) }
              : entry;
          }),
        );
      })
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!state.classKey) return;

    const spellcastingClasses = ['wizard', 'cleric', 'druid', 'bard', 'sorcerer', 'warlock', 'paladin', 'ranger'];
    const caster = spellcastingClasses.some((c) => state.classKey?.toLowerCase().includes(c));
    setIsSpellcaster(caster);
    // Reset counts while loading to avoid stale values from a previous class
    setCantripsKnown(0);
    setSpellsKnown(0);

    const controller = new AbortController();
    setLoading(true);

    fetchSpells({ class: state.classKey, source: state.documentSource }, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setSpells(data);

          const key = state.classKey?.toLowerCase() ?? '';
          if (key.includes('wizard')) {
            setCantripsKnown(3); setSpellsKnown(6);
          } else if (key.includes('bard') || key.includes('sorcerer')) {
            setCantripsKnown(4); setSpellsKnown(2);
          } else if (key.includes('warlock')) {
            setCantripsKnown(2); setSpellsKnown(2);
          } else if (key.includes('cleric') || key.includes('druid')) {
            // Prepared casters: cantrips are fixed, spells prepared handled below
            setCantripsKnown(3);
          } else if (key.includes('paladin') || key.includes('ranger')) {
            // Half-casters: spells prepared = CHA/WIS mod + half level (min 1)
            setCantripsKnown(0);
          } else {
            setCantripsKnown(2); setSpellsKnown(2);
          }
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Failed to load spells:', err);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [state.classKey]);

  // Prepared casters (cleric/druid/paladin/ranger): spells prepared = ability mod + level (min 1)
  useEffect(() => {
    const key = state.classKey?.toLowerCase() ?? '';
    if (key.includes('cleric') || key.includes('druid')) {
      const wisMod = Math.floor((state.baseAbilities.wisdom - 10) / 2);
      setSpellsKnown(Math.max(1, wisMod + 1));
    } else if (key.includes('paladin')) {
      const chaMod = Math.floor((state.baseAbilities.charisma - 10) / 2);
      setSpellsKnown(Math.max(1, chaMod + 1));
    } else if (key.includes('ranger')) {
      const wisMod = Math.floor((state.baseAbilities.wisdom - 10) / 2);
      setSpellsKnown(Math.max(1, wisMod + 1));
    }
  }, [state.classKey, state.baseAbilities.wisdom, state.baseAbilities.charisma]);

  // Trim selections if the limit decreased (e.g. user lowered WIS after picking spells)
  useEffect(() => {
    if (cantripsKnown > 0 && state.chosenCantrips.length > cantripsKnown) {
      dispatch({ type: 'SET_CANTRIPS', cantrips: state.chosenCantrips.slice(0, cantripsKnown) });
    }
  }, [cantripsKnown, state.chosenCantrips.length, dispatch]);

  useEffect(() => {
    if (spellsKnown > 0 && state.chosenSpells.length > spellsKnown) {
      dispatch({ type: 'SET_SPELLS', spells: state.chosenSpells.slice(0, spellsKnown) });
    }
  }, [spellsKnown, state.chosenSpells.length, dispatch]);

  const shopTotalSpent = useMemo(
    () => shopCart.reduce((sum, e) => sum + e.cost * e.qty, 0),
    [shopCart],
  );

  const equipmentChoiceRef = useRef(equipmentChoice);
  equipmentChoiceRef.current = equipmentChoice;

  const dispatchCart = useCallback((entries: CartEntry[]) => {
    const items = entries.map((e) => `${e.key}:${e.qty}`);
    dispatch({ type: 'SET_EQUIPMENT', equipment: [`gold-${equipmentChoiceRef.current}`, ...items] });
  }, [dispatch]);

  const handleShopAdd = useCallback((item: SrdItem) => {
    setShopCart((prev) => {
      const existing = prev.find((e) => e.key === item.key);
      const next = existing
        ? prev.map((e) => e.key === item.key ? { ...e, qty: e.qty + 1 } : e)
        : [...prev, { key: item.key, name: item.name, cost: parseCostGP(item.cost), qty: 1 }];
      dispatchCart(next);
      return next;
    });
  }, [dispatchCart]);

  const handleShopRemove = useCallback((key: string) => {
    setShopCart((prev) => {
      const next = prev
        .map((e) => e.key === key ? { ...e, qty: e.qty - 1 } : e)
        .filter((e) => e.qty > 0);
      dispatchCart(next);
      return next;
    });
  }, [dispatchCart]);

  const handleShopClear = useCallback((key: string) => {
    setShopCart((prev) => {
      const next = prev.filter((e) => e.key !== key);
      dispatchCart(next);
      return next;
    });
  }, [dispatchCart]);

  const cantrips = spells.filter((s) => s.level === 0);
  const level1Spells = spells.filter((s) => s.level === 1);

  const handleCantripToggle = (spellKey: string, checked: boolean) => {
    if (checked && state.chosenCantrips.length >= cantripsKnown) return;
    const newCantrips = checked
      ? [...state.chosenCantrips, spellKey]
      : state.chosenCantrips.filter((s) => s !== spellKey);
    dispatch({ type: 'SET_CANTRIPS', cantrips: newCantrips });
  };

  const handleSpellToggle = (spellKey: string, checked: boolean) => {
    if (checked && state.chosenSpells.length >= spellsKnown) return;
    const newSpells = checked
      ? [...state.chosenSpells, spellKey]
      : state.chosenSpells.filter((s) => s !== spellKey);
    dispatch({ type: 'SET_SPELLS', spells: newSpells });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Equipment & Spells</h2>
        <p className="text-muted-foreground">
          Select your starting equipment and spells (if applicable).
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
          {isSpellcaster && <TabsTrigger value="spells">Spells</TabsTrigger>}
        </TabsList>

        <TabsContent value="equipment">
          <Card>
            <CardHeader>
              <CardTitle>Starting Equipment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {classData && (() => {
                  const coreTraits = classData.features.find((f) =>
                    f.name.startsWith('Core ') && f.name.endsWith(' Traits'),
                  ) ?? classData.features.find((f) => f.desc.includes('Starting Equipment'));
                  const options = coreTraits ? parseEquipmentOptions(coreTraits.desc) : null;

                  if (options) {
                    const isGoldOnly = (items: string) => /^\d+\s*GP$/i.test(items.trim());

                    return (
                      <>
                        <p className="text-sm text-muted-foreground">
                          Choose your {classData.name} starting equipment:
                        </p>
                        <RadioGroup
                          value={equipmentChoice}
                          onValueChange={(val) => {
                            setEquipmentChoice(val);
                            setShopCart([]);
                            const selectedOpt = options.find((o) => o.label === val);
                            if (selectedOpt && isGoldOnly(selectedOpt.items)) {
                              dispatch({ type: 'SET_EQUIPMENT', equipment: [`gold-${val}`] });
                            } else {
                              dispatch({ type: 'SET_EQUIPMENT', equipment: [`pack-${val}`] });
                            }
                          }}
                        >
                          {options.map((opt) => (
                            <div key={opt.label} className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted">
                              <RadioGroupItem value={opt.label} id={`equip-${opt.label}`} className="mt-0.5" />
                              <Label htmlFor={`equip-${opt.label}`} className="cursor-pointer flex-1">
                                <span className="font-semibold">
                                  {isGoldOnly(opt.items) ? `Option ${opt.label} — Starting Gold` : `Option ${opt.label} — Equipment Pack`}
                                </span>
                                <p className="text-sm text-muted-foreground mt-1">{opt.items}</p>
                              </Label>
                            </div>
                          ))}
                        </RadioGroup>
                        {isGoldOnly(options.find((o) => o.label === equipmentChoice)?.items ?? '') && (() => {
                          const goldText = options.find((o) => o.label === equipmentChoice)?.items ?? '0';
                          const goldBudget = parseFloat(goldText) || 0;
                          return (
                            <EquipmentShop
                              budget={goldBudget}
                              cartEntries={shopCart}
                              onAdd={handleShopAdd}
                              onRemove={handleShopRemove}
                              onClear={handleShopClear}
                              totalSpent={shopTotalSpent}
                              onInfoClick={(item) => { setDetailItem(item); setDetailType('item'); setDetailOpen(true); }}
                            />
                          );
                        })()}
                      </>
                    );
                  }

                  return (
                    <div className="p-4 bg-muted rounded-lg">
                      <h4 className="font-semibold mb-2">{classData.name} Equipment</h4>
                      <p className="text-sm text-muted-foreground">
                        Consult your class description for the specific items you begin with,
                        or work with your DM to purchase equipment using your starting gold.
                      </p>
                    </div>
                  );
                })()}

                {!classData && !state.classKey && (
                  <p className="text-sm text-muted-foreground italic">
                    Select a class to see starting equipment options.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {isSpellcaster && (
          <TabsContent value="spells">
            <Card>
              <CardHeader>
                <CardTitle>Choose Your Spells</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div>
                    <h4 className="font-semibold mb-2">
                      Cantrips (Choose {cantripsKnown})
                    </h4>
                    <p className="text-xs text-muted-foreground mb-3">
                      Selected: {state.chosenCantrips.length} / {cantripsKnown}
                    </p>
                    {cantrips.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">
                        No cantrips available for this class.
                      </p>
                    ) : (
                      <ScrollArea className="h-64">
                        <div className="space-y-2 pr-4">
                          {cantrips.map((spell) => (
                            <div key={spell.key} className="flex items-start space-x-2 p-2 hover:bg-muted rounded">
                              <Checkbox
                                id={`cantrip-${spell.key}`}
                                checked={state.chosenCantrips.includes(spell.key)}
                                onCheckedChange={(checked) =>
                                  handleCantripToggle(spell.key, checked as boolean)
                                }
                                disabled={
                                  !state.chosenCantrips.includes(spell.key) &&
                                  state.chosenCantrips.length >= cantripsKnown
                                }
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-1">
                                  <Label htmlFor={`cantrip-${spell.key}`} className="text-sm font-medium cursor-pointer">
                                    {spell.name}
                                  </Label>
                                  <button
                                    type="button"
                                    className="p-0.5 rounded hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground"
                                    onClick={(e) => { e.preventDefault(); setDetailSpell(spell); setDetailType('spell'); setDetailOpen(true); }}
                                    aria-label={`Details for ${spell.name}`}
                                  >
                                    <Info className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                                {spell.school_key && (
                                  <p className="text-xs text-muted-foreground">{spell.school_key}</p>
                                )}
                                {spell.desc_text && <SpellDescription text={spell.desc_text} />}
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>

                  {level1Spells.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2">
                        1st Level Spells (Choose {spellsKnown})
                      </h4>
                      <p className="text-xs text-muted-foreground mb-3">
                        Selected: {state.chosenSpells.length} / {spellsKnown}
                      </p>
                      <ScrollArea className="h-64">
                        <div className="space-y-2 pr-4">
                          {level1Spells.map((spell) => (
                            <div key={spell.key} className="flex items-start space-x-2 p-2 hover:bg-muted rounded">
                              <Checkbox
                                id={`spell-${spell.key}`}
                                checked={state.chosenSpells.includes(spell.key)}
                                onCheckedChange={(checked) =>
                                  handleSpellToggle(spell.key, checked as boolean)
                                }
                                disabled={
                                  !state.chosenSpells.includes(spell.key) &&
                                  state.chosenSpells.length >= spellsKnown
                                }
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-1">
                                  <Label htmlFor={`spell-${spell.key}`} className="text-sm font-medium cursor-pointer">
                                    {spell.name}
                                  </Label>
                                  <button
                                    type="button"
                                    className="p-0.5 rounded hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground"
                                    onClick={(e) => { e.preventDefault(); setDetailSpell(spell); setDetailType('spell'); setDetailOpen(true); }}
                                    aria-label={`Details for ${spell.name}`}
                                  >
                                    <Info className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                                {spell.school_key && (
                                  <p className="text-xs text-muted-foreground">{spell.school_key}</p>
                                )}
                                {spell.desc_text && <SpellDescription text={spell.desc_text} />}
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <SrdDetailModal
        open={detailOpen}
        onOpenChange={setDetailOpen}
        entityType={detailType}
        entity={detailType === 'spell' ? detailSpell : detailItem}
      />
    </div>
  );
}

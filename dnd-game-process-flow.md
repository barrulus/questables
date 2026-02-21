# D&D Game Process Flow — LLM Dungeon Master System

> **Purpose:** This document defines the complete process flow for a multiplayer D&D game powered by a local LLM acting as Dungeon Master. It is intended as a specification for a Claude Code agent to implement and refine game logic, state management, and DM behaviour.

---

## 1. High-Level Game Loop

The game operates as an infinite session loop cycling through three core phases. The DM (LLM) orchestrates transitions between phases based on player actions and world state.

```mermaid
stateDiagram-v2
    [*] --> SessionStart
    SessionStart --> Exploration: DM sets the scene

    state GameLoop {
        Exploration --> Combat: Hostile encounter triggered
        Exploration --> Social: NPC / player interaction triggered
        Exploration --> Rest: Party initiates short/long rest
        Combat --> Exploration: All hostiles defeated / fled / resolved
        Combat --> Social: Parley / surrender initiated
        Social --> Exploration: Interaction concluded
        Social --> Combat: Negotiation fails / ambush
        Rest --> Exploration: Rest completes
    }

    GameLoop --> SessionEnd: Players save & quit
    SessionEnd --> [*]
```

### Phase Definitions

| Phase | Description | DM Responsibilities |
|---|---|---|
| **Exploration** | Players move on the map, investigate, loot, and interact with the environment. | Narrate surroundings, reveal map fog-of-war, describe points of interest, handle perception/investigation checks, trigger encounters. |
| **Combat** | Turn-based tactical engagement with hostile entities. | Control all enemy/NPC actions, adjudicate rules, narrate outcomes, track enemy HP/status. |
| **Social** | Dialogue-driven interaction with NPCs, shops, quest-givers, or between players with DM mediation. | Roleplay NPCs, adjudicate persuasion/deception/intimidation checks, manage trade and quest logic. |
| **Rest** | Short or long rest to recover resources. | Enforce rest rules, narrate passage of time, roll for random encounters during long rests, apply recovery effects. |

---

## 2. Session Start Flow

This runs once when the game begins or a saved session is loaded.

```mermaid
flowchart TD
    A[Session Start] --> B{New or Loaded Game?}
    B -->|New| C[Load Player Characters]
    B -->|Loaded| D[Restore Saved Game State]
    C --> E[Place Players on Map at Starting Location]
    D --> E
    E --> F[DM: Deliver Opening Narration / Recap]
    F --> G[Set Phase → Exploration]
    G --> H[Begin Turn Order]
```

### Game State to Restore/Initialise

- Player positions on map
- Player inventories, spell slots, HP, conditions
- Active quests and flags
- Map fog-of-war state
- NPC states and dispositions
- Current phase and turn order

---

## 3. Exploration Phase

Exploration is the default phase. Players act in **round-robin turn order** (not initiative — that is reserved for combat). Each player takes a turn, then the DM processes the world.

```mermaid
flowchart TD
    A[Exploration Phase Begins] --> B[DM: Narrate Current Scene]
    B --> C[Next Player's Turn]

    C --> D{Player Chooses Action}
    D -->|Move| E[Validate Movement on Map]
    D -->|Interact with Object| F[DM: Resolve Interaction]
    D -->|Talk to NPC| G[Transition → Social Phase]
    D -->|Search / Investigate| H[DM: Call for Ability Check]
    D -->|Use Item / Spell| I[DM: Resolve Effect]
    D -->|Open Inventory / Spellbook| J[Player Manages Resources — No Turn Cost]
    D -->|Talk to Other Player| K[Player Chat — No Turn Cost]
    D -->|Private Message to DM| L[DM: Respond Privately]
    D -->|Pass Turn| M[Turn Ends]

    E --> N{Does Movement Trigger Encounter?}
    N -->|Yes — Hostile| O[Transition → Combat Phase]
    N -->|Yes — NPC| G
    N -->|Yes — Trap/Hazard| P[DM: Resolve Trap — Call for Save/Check]
    N -->|No| Q[DM: Describe New Position]
    
    F --> M
    H --> R[Player Rolls / System Rolls]
    R --> S[DM: Narrate Outcome]
    S --> M
    I --> M
    P --> M
    Q --> M

    M --> T{All Players Had a Turn?}
    T -->|No| C
    T -->|Yes| U[DM: World Turn — Advance Time, NPC Actions, Environmental Changes]
    U --> V{Phase Change Triggered?}
    V -->|No| B
    V -->|Yes| W[Transition to New Phase]
```

### Key Rules for Exploration

- **Free actions** (no turn cost): opening inventory, reading spellbook, player-to-player chat, checking stats.
- **Turn actions** (consume the player's turn): move, interact, search, use item/spell, talk to NPC.
- **DM world turn**: after all players have acted, the DM advances world state — NPC patrols move, torches dim, time passes, wandering monster checks occur.
- **Encounter triggers** are defined on the map (fixed) or rolled randomly by the DM (wandering).

---

## 4. Combat Phase

Combat uses standard D&D turn-based rules: initiative order, action economy, and round structure.

### 4.1 Combat Initiation

```mermaid
flowchart TD
    A[Combat Triggered] --> B[DM: Describe the Encounter]
    B --> C[All Combatants Roll Initiative]
    C --> D[Sort into Initiative Order — Highest First]
    D --> E{Surprise Round?}
    E -->|Yes| F[Only Non-Surprised Combatants Act]
    E -->|No| G[Begin Round 1]
    F --> G
```

### 4.2 Combat Round Loop

```mermaid
flowchart TD
    A[Round Begins] --> B[Next Combatant in Initiative Order]

    B --> C{Is Combatant a Player?}
    C -->|Yes| D[Player Turn]
    C -->|No| E[DM Turn — Control NPC/Enemy]

    D --> F{Player Chooses Action}
    F -->|Attack| G[Roll to Hit → DM Resolves Damage]
    F -->|Cast Spell| H[Select Target → DM Resolves Spell Effect]
    F -->|Use Item| I[DM Resolves Item Effect]
    F -->|Dash| J[Double Movement]
    F -->|Dodge| K[Apply Dodge Condition]
    F -->|Disengage| L[No Opportunity Attacks This Turn]
    F -->|Help| M[Grant Advantage to Ally]
    F -->|Hide| N[Roll Stealth → DM Sets DC]
    F -->|Ready Action| O[Set Trigger Condition → Resolve on Trigger]
    F -->|Other / Creative Action| P[DM Adjudicates Freely]

    G --> Q[Player May Use Bonus Action]
    H --> Q
    I --> Q
    J --> Q
    K --> Q
    L --> Q
    M --> Q
    N --> Q
    O --> Q
    P --> Q

    Q --> R{Bonus Action Used?}
    R -->|Yes| S[DM Resolves Bonus Action]
    R -->|No / N/A| T[Player May Use Movement]
    S --> T

    T --> U[Player May Use Reaction — Stored for Use Before Next Turn]
    U --> V[Turn Ends]

    E --> W[DM: Determine NPC/Enemy Action Using AI + Stat Block]
    W --> X[DM: Narrate Enemy Action]
    X --> Y[Resolve Effects on Targets]
    Y --> V

    V --> Z{All Combatants Acted?}
    Z -->|No| B
    Z -->|Yes| AA[Round Ends]

    AA --> AB[DM: Process End-of-Round Effects — Concentration, Conditions, Lair Actions]
    AB --> AC{Combat Over?}
    AC -->|No| A
    AC -->|Yes| AD[Combat Resolution]
```

### 4.3 Combat Resolution

```mermaid
flowchart TD
    A[Combat Over] --> B{How Did It End?}
    B -->|All Enemies Defeated| C[DM: Narrate Victory]
    B -->|All Enemies Fled| D[DM: Narrate Retreat]
    B -->|Party Fled| E[DM: Narrate Escape — Possible Pursuit]
    B -->|Parley / Surrender| F[Transition → Social Phase]
    B -->|TPK — Total Party Kill| G[DM: Handle Game Over / Rescue Scenario]

    C --> H[Distribute XP / Milestone Progress]
    D --> H
    E --> H

    H --> I[Loot Phase — DM Describes Available Loot]
    I --> J[Players Collect Items to Inventory]
    J --> K[DM: Update Map State — Remove Enemies, Open Paths]
    K --> L[Transition → Exploration Phase]
```

### 4.4 Player Action Economy Per Turn (Reference)

| Component | Count | Examples |
|---|---|---|
| **Action** | 1 | Attack, Cast a Spell, Dash, Dodge, Disengage, Help, Hide, Use Object, Ready |
| **Bonus Action** | 0–1 | Offhand attack, certain spells (Healing Word, Misty Step), class features (Cunning Action) |
| **Movement** | Up to speed | Can be split before/after action. Difficult terrain costs double. |
| **Reaction** | 0–1 (before next turn) | Opportunity attack, Shield spell, Counterspell, class features |
| **Free Interaction** | 1 | Draw/sheathe weapon, open door, speak a short phrase |

---

## 5. Social Phase

Social interactions are primarily driven by the LLM roleplaying NPCs.

```mermaid
flowchart TD
    A[Social Phase Begins] --> B[DM: Introduce NPC / Set the Scene]
    B --> C[Player Speaks to NPC — Free-Form Text]
    C --> D[DM as NPC: Responds in Character]
    D --> E{Player Choice}
    E -->|Continue Dialogue| C
    E -->|Attempt Persuasion / Deception / Intimidation| F[DM: Set DC → Player Rolls]
    E -->|Trade / Shop| G[Open Trade Interface — DM Sets Prices]
    E -->|Accept / Turn In Quest| H[DM: Update Quest State]
    E -->|Attack NPC| I[Transition → Combat Phase]
    E -->|Leave Conversation| J[Transition → Exploration Phase]

    F --> K[DM: Narrate Outcome Based on Roll]
    K --> E
    G --> L[Player Buys / Sells — Inventory + Gold Updated]
    L --> E
    H --> M[DM: Deliver Quest Reward / New Objective]
    M --> E
```

### DM Behaviour During Social Phase

- The LLM should maintain a **consistent NPC personality** across interactions (use NPC state/memory).
- NPC disposition can shift based on player actions (friendly → hostile if insulted).
- **Insight checks** can be requested by players to detect NPC lies or motivations.
- Group conversations: multiple players can participate; the DM should address them naturally.

---

## 6. Rest Phase

```mermaid
flowchart TD
    A[Party Initiates Rest] --> B{Short or Long Rest?}

    B -->|Short Rest — 1 Hour| C[Players May Spend Hit Dice to Heal]
    C --> D[Restore Short-Rest Abilities — Per Class Rules]
    D --> E[DM: Narrate Time Passing]
    E --> F[Transition → Exploration]

    B -->|Long Rest — 8 Hours| G[DM: Roll for Random Encounter]
    G --> H{Encounter?}
    H -->|Yes| I[Interrupt Rest → Combat Phase]
    H -->|No| J[Full HP Restored]
    I --> K{Rest Resumes After Combat?}
    K -->|Yes — Enough Time Left| J
    K -->|No — Rest Broken| F
    J --> L[Restore All Spell Slots]
    L --> M[Restore Long-Rest Abilities]
    M --> N[Reset Hit Dice — Regain Up to Half Max]
    N --> O[Remove Temporary Conditions as Applicable]
    O --> E
```

---

## 7. Communication System

Communication is a core pillar. There are four distinct channels.

```mermaid
flowchart LR
    subgraph Channels
        A[Party Chat — All Players + DM]
        B[Player-to-Player DM — Private Between Two Players]
        C[Player-to-DM Private — Only That Player and the DM See This]
        D[DM Broadcast — DM Narration to All Players]
    end

    P1[Player 1] --> A
    P1 --> B
    P1 --> C
    P2[Player 2] --> A
    P2 --> B
    P2 --> C
    DM[DM — LLM] --> A
    DM --> C
    DM --> D
```

### Channel Rules

| Channel | Participants | Turn Cost | Use Cases |
|---|---|---|---|
| **Party Chat** | All players + DM | None | Strategy, banter, group decisions |
| **Player ↔ Player Private** | Two specific players | None | Secret plans, RP between characters, passing items covertly |
| **Player → DM Private** | One player + DM only | None | Ask rules questions, declare secret actions (e.g. "I secretly palm the gem"), request hidden rolls |
| **DM Broadcast** | DM → all players | N/A | Scene narration, combat descriptions, world events, announcements |

### DM Private Message Behaviour

When a player sends a private message to the DM, the LLM should:

1. **Rules questions**: Answer factually without narrative flavour. Do not reveal the answer to other players.
2. **Secret actions**: Acknowledge, resolve silently (make any required rolls), and only narrate the visible outcome to the group. Example: Player privately says "I try to pickpocket the merchant." → DM privately responds with the Sleight of Hand result. If successful, group sees nothing. If failed, DM narrates to group that the merchant notices.
3. **Meta questions**: ("What are my options?", "Can I do X?") Answer helpfully. This is analogous to a player whispering to the DM at a real table.

---

## 8. DM Decision Flow — How the LLM Should Process Any Player Action

This is the core logic the LLM follows every time a player declares any action.

```mermaid
flowchart TD
    A[Player Declares Action] --> B{Is the Action Possible Within the Rules?}
    B -->|No| C[DM: Explain Why Not — Suggest Alternatives]
    B -->|Yes| D{Does It Require a Roll?}
    D -->|No — Auto-Success| E[DM: Narrate Success]
    D -->|Yes| F[DM: Determine Ability + Skill + DC]
    F --> G[Player Rolls / System Rolls d20 + Modifiers]
    G --> H{Result vs DC}
    H -->|Critical Success — Nat 20 on Attack| I[DM: Narrate Exceptional Success]
    H -->|Success — Meets or Beats DC| J[DM: Narrate Standard Success]
    H -->|Failure — Below DC| K[DM: Narrate Failure with Consequence]
    H -->|Critical Failure — Nat 1 on Attack| L[DM: Narrate Dramatic Failure — Optional Fumble]

    E --> M[Update Game State]
    I --> M
    J --> M
    K --> M
    L --> M

    M --> N[DM: Check for Chain Reactions — Does This Trigger Anything?]
    N -->|Triggers Encounter| O[Transition Phase]
    N -->|Triggers NPC Reaction| P[DM: NPC Responds]
    N -->|Triggers Environmental Change| Q[Update Map State]
    N -->|No Chain Reaction| R[Turn Ends]
```

---

## 9. Player State Model

Each player has a persistent state object the system must track.

```
Player {
    // Identity
    name: string
    class: string
    race: string
    level: int
    xp: int
    alignment: string

    // Core Stats
    abilities: { STR, DEX, CON, INT, WIS, CHA }  // Each 1–20+
    proficiency_bonus: int
    armor_class: int
    hit_points: { current, max, temporary }
    hit_dice: { current, max, die_type }
    speed: int
    
    // Position
    map_position: { x, y }
    
    // Resources
    spell_slots: { level_1: {current, max}, ... level_9: {current, max} }
    class_resources: { ... }  // Ki points, rage uses, sorcery points, etc.
    gold: int
    
    // Collections
    inventory: [ { item, quantity, equipped } ]
    spellbook: [ { spell, level, prepared } ]   // Known/prepared spells
    conditions: [ { condition, duration, source } ]  // Poisoned, prone, etc.
    
    // Social
    active_quests: [ { quest_id, stage } ]
    npc_dispositions: { npc_id: attitude }  // Tracks relationship with NPCs
}
```

---

## 10. Levelling Up

Levelling happens outside of the core game loop but must be handled.

```mermaid
flowchart TD
    A[XP Threshold Reached or Milestone Awarded] --> B[DM: Announce Level Up]
    B --> C[Player Gains New Level]
    C --> D[Roll or Average New Hit Points → Add to Max HP]
    D --> E{New Proficiency Bonus Tier?}
    E -->|Yes| F[Update Proficiency Bonus]
    E -->|No| G[Continue]
    F --> G
    G --> H[Apply Class Features for New Level]
    H --> I{Ability Score Improvement / Feat Level?}
    I -->|Yes| J[Player Chooses ASI or Feat]
    I -->|No| K[Continue]
    J --> K
    K --> L{Spellcaster?}
    L -->|Yes| M[Update Spell Slots + Learn/Prepare New Spells]
    L -->|No| N[Done]
    M --> N
    N --> O[DM: Narrate Growth Flavour Text]
```

---

## 11. Death and Dying

```mermaid
flowchart TD
    A[Player HP Drops to 0] --> B{Was Damage Enough to Reach Negative Max HP?}
    B -->|Yes| C[Instant Death]
    B -->|No| D[Player Falls Unconscious — Begin Death Saves]

    D --> E[On Player's Turn: Roll d20]
    E --> F{Roll Result}
    F -->|10+ Success| G[Mark Death Save Success]
    F -->|1–9 Failure| H[Mark Death Save Failure]
    F -->|Natural 20| I[Player Regains 1 HP — Conscious!]
    F -->|Natural 1| J[Mark 2 Death Save Failures]

    G --> K{3 Successes?}
    K -->|Yes| L[Player Stabilises at 0 HP — Unconscious but Not Dying]
    K -->|No| E

    H --> M{3 Failures?}
    J --> M
    M -->|Yes| C
    M -->|No| E

    I --> N[Player Rejoins Combat on Next Turn]

    C --> O[Character Dies]
    O --> P{Resurrection Available?}
    P -->|Yes| Q[Party Uses Spell/Item to Revive]
    P -->|No| R[Player Creates New Character or Spectates]

    L --> S[Can Be Healed by Ally — Regains Consciousness with Healed HP]
```

### External Interrupts During Death Saves

- **Taking damage while at 0 HP** = automatic death save failure (2 failures if critical hit).
- **Receiving healing while at 0 HP** = regain consciousness with healed HP amount, death saves reset.
- **Stabilised** characters regain 1 HP after 1d4 hours unless healed sooner.

---

## 12. Complete Turn Sequence Summary

This is the atomic unit of gameplay. Every player turn follows this sequence.

```mermaid
flowchart TD
    A[Turn Begins — DM Identifies Active Player] --> B[DM: Brief Situational Reminder if Needed]
    B --> C[Player Reads Chat / Checks State — Free]
    C --> D[Player Communicates — Free: Party Chat, Private Chat, DM Whisper]
    D --> E[Player Declares Action]
    E --> F[DM: Resolves Action — See Section 8]
    F --> G{In Combat?}
    G -->|Yes| H[Resolve Bonus Action if Used]
    H --> I[Resolve Movement if Used]
    I --> J[Store Reaction if Declared]
    G -->|No — Exploration| K[Action Resolves Fully]
    J --> L[Turn Ends]
    K --> L
    L --> M[DM: Narrate Outcome + Transition]
    M --> N[Next Player or DM World Turn]
```

---

## 13. Phase Transition Reference

| From | To | Trigger |
|---|---|---|
| Exploration → Combat | Hostile creature detected, trap triggers attack, player attacks NPC |
| Exploration → Social | Player initiates dialogue with NPC, enters shop, triggers cutscene |
| Exploration → Rest | Party unanimously agrees to rest in a safe-enough location |
| Combat → Exploration | All hostiles defeated, fled, or otherwise resolved |
| Combat → Social | Combatant(s) attempt parley, surrender is offered/accepted |
| Social → Exploration | Conversation ends, player leaves dialogue |
| Social → Combat | NPC turns hostile, negotiation fails catastrophically, ambush |
| Rest → Exploration | Rest completes without interruption |
| Rest → Combat | Random encounter interrupts rest |

---

## 14. Implementation Notes for the LLM DM

### Context the LLM Needs Per Request

Every time the LLM is prompted for a DM response, it should receive:

1. **Current phase** (exploration / combat / social / rest)
2. **Active player** (whose turn it is)
3. **Player action** (what they declared)
4. **Relevant player state** (HP, conditions, position, inventory excerpt)
5. **Scene context** (current room/area description, visible NPCs/enemies)
6. **Combat state** (if in combat: initiative order, enemy HP/conditions, round number)
7. **Recent narration history** (last N messages for continuity)
8. **NPC memory/state** (if in social: who they're talking to, disposition, conversation so far)

### LLM Response Format

The LLM should return structured output containing:

- **narration**: Flavour text to display to all players (or privately if applicable)
- **mechanical_outcome**: Structured data — damage dealt, HP changes, conditions applied/removed, items gained/lost
- **required_rolls**: Any rolls the system needs to prompt for
- **state_changes**: Updates to apply to game state
- **phase_transition**: If the phase should change, and to what
- **private_messages**: Any messages that should only go to specific players

### Tone Guidelines

- Narration should be vivid but concise — players want to act, not read novels.
- Combat narration should emphasise impact and stakes.
- Failed actions should still feel like something happened, not just "you fail."
- The DM should never directly say dice results in narration — weave them into the story.

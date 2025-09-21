# LLM-Powered Narrative Generation System

## Overview

This system provides intelligent narrative generation for tabletop RPG (D&D) campaigns through a sophisticated multi-layered architecture. The system manages context, caches responses, handles NPC personalities and memory, and generates appropriate narratives for different game situations.

## Core Components

### 1. Context Manager
**Purpose**: Builds and manages contextual information for LLM prompts

**Key Responsibilities**:
- Constructs structured game context from campaign, session, and character data
- Manages location context with environmental details, NPCs, and interactive objects
- Builds character context including stats, personality traits, and current status
- Handles combat context with initiative order, combatant information, and battlefield state
- Trims context to fit within token limits while preserving priority information

**Data Flow**:
- Input: Raw campaign data, session state, character information, location details
- Processing: Validates and cleans data, structures into context objects
- Output: Structured GameContext objects with prioritized information

### 2. Enhanced LLM Service
**Purpose**: High-level orchestrator that coordinates all narrative generation

**Key Responsibilities**:
- Manages caching, context windowing, template application, and NPC interactions
- Routes different types of narrative requests to appropriate generation methods
- Handles performance tracking and error recovery
- Coordinates between all other services

**Core Generation Methods**:
- **DM Narration**: General responses to player actions
- **Scene Descriptions**: Environmental and location narratives
- **NPC Dialogue**: Character-specific conversational responses
- **Action Narratives**: Results of player actions and their consequences
- **Quest Generation**: Complete quest creation with objectives and rewards

### 3. Narrative Generator
**Purpose**: Specialized narrative generation for specific game situations

**Key Responsibilities**:
- Generates action result descriptions with appropriate dramatic style
- Creates environmental descriptions with mood-appropriate atmosphere
- Handles encounter introductions and victory descriptions
- Manages dialogue context and quest narrative generation
- Applies narrative templates based on situation type

**Style Determination**:
- Analyzes action results to determine narrative style (dramatic success, failure, etc.)
- Considers environmental factors for mood setting
- Evaluates encounter parameters for tone determination

### 4. NPC Manager
**Purpose**: Manages NPC personalities, memory, and relationship tracking

**Key Components**:
- **Personality System**: Traits, ideals, bonds, flaws, behavioral modifiers
- **Dialogue History**: Conversation tracking, relationship status, trust levels
- **Memory Management**: Information retention, topic-based recall
- **Relationship Dynamics**: Trust levels, emotional states, reaction determination

**Personality Templates**:
- Friendly Merchant, Gruff Guard, Wise Elder, Nervous Scholar, Mysterious Stranger
- Each template includes traits, motivations, speech patterns, and behavioral tendencies

**Memory and Relationships**:
- Tracks conversation history and emotional outcomes
- Maintains character-specific trust levels and relationship status
- Updates NPC knowledge base and reaction patterns over time
- When NPC dialogue is generated without explicit interaction metadata, the service derives a summary from the response, estimates sentiment via keyword heuristics, clamps trust adjustments within ±10, and applies relationship deltas (±5) before persisting to `npc_memories` and `npc_relationships`.

### 5. Prompt Template Manager
**Purpose**: Provides structured prompts and templates for different narrative types

**Template Categories**:
- System prompts for different narrative types (scene description, dialogue, combat, etc.)
- Narrative templates with placeholders for dynamic content
- Context formatters for consistent information presentation

**Template Types**:
- Scene descriptions for various location types
- Action results for different success levels
- Dialogue patterns for various NPC dispositions
- Combat narratives for different action types

## Process Flow

### General Narrative Generation Flow

1. **Request Initiation**: System receives request for narrative content with context data
2. **Context Building**: Context Manager assembles relevant game state information
3. **Cache Check**: Enhanced LLM Service checks for cached responses
4. **Template Selection**: Prompt Template Manager provides appropriate templates
5. **Context Windowing**: System fits context within token limits while preserving priority data
6. **LLM Generation**: Request sent to language model with structured prompt
7. **Post-Processing**: Response cleaned and formatted for game use
8. **Caching**: Response stored for future similar requests
9. **Memory Update**: NPC interactions update relationship and memory systems

### Specific Workflows

#### NPC Dialogue Generation
1. **NPC Context Assembly**: Gather personality, history, and current relationship status
2. **Situation Analysis**: Determine appropriate reaction based on party reputation and circumstances
3. **Dialogue Generation**: Create character-appropriate response using personality templates
4. **Interaction Evaluation**: Assess dialogue outcome (positive, negative, neutral)
5. **Memory Update**: Store conversation summary and update relationship metrics
6. **Trust Adjustment**: Modify trust levels based on interaction results

#### Scene Description Generation
1. **Location Context**: Compile location features, atmosphere, environmental conditions
2. **Mood Determination**: Analyze danger level, atmosphere, and contextual factors
3. **Template Application**: Select appropriate scene template based on location type
4. **Environmental Integration**: Include time of day, weather, and atmospheric elements
5. **Character Presence**: Factor in active characters and their positions
6. **Narrative Generation**: Create immersive description with sensory details

#### Action Result Narration
1. **Action Analysis**: Examine action type, character, target, and success parameters
2. **Style Determination**: Choose narrative style based on success level and criticality
3. **Character Integration**: Include character class, abilities, and personality
4. **Context Consideration**: Factor in location, combat state, and environmental elements
5. **Dramatic Narration**: Generate appropriate description matching action outcome
6. **Consequence Integration**: Include immediate effects and follow-up opportunities

## Data Structures and Information Flow

### GameContext Object
- Campaign and session identifiers
- Current location with features, exits, NPCs, and interactive objects
- Active character list with stats, conditions, and current status
- Combat state including initiative order and battlefield information
- Recent events history for continuity
- Time and environmental information

### Character Context
- Basic information (name, race, class, level)
- Ability scores, skills, equipment, and current health
- Personality traits, ideals, bonds, and flaws
- Current conditions and status effects
- Activity and position information

### NPC Context
- Personality summary and behavioral traits
- Current mood and emotional state
- Relationship status with party members
- Known information and conversation history
- Motivations, fears, and goals
- Speech patterns and mannerisms

### Location Context
- Physical features and layout description
- Atmospheric conditions and mood
- Present characters and NPCs
- Interactive objects and potential hazards
- Exits and connection information
- Environmental effects and conditions

## Caching and Performance Strategy

### Cache Key Generation
- Combines prompt content, context parameters, and model information
- Includes campaign-specific data for appropriate cache isolation
- Considers context type for cache TTL determination

### Cache Invalidation
- Campaign-specific invalidation for world state changes
- Context-type filtering for targeted cache clearing
- Automatic expiration for time-sensitive content

### Performance Optimization
- Context window management to maximize relevant information within token limits
- Priority ordering for context elements based on narrative type
- Token usage tracking and optimization
- Response time monitoring and statistics

## Integration Points

### Database Interactions
- NPC personality and dialogue history persistence
- Campaign and session state management
- Character information and relationship tracking
- Cache storage and retrieval

### External LLM Client
- Text generation for general narratives
- Chat-based generation for dialogue
- Structured generation for quests and complex content
- Temperature and token limit management

### Game State Management
- Real-time context updates from game events
- Character action processing and result integration
- Combat state synchronization
- Environmental condition tracking

## Error Handling and Fallbacks

### Graceful Degradation
- Fallback narratives for generation failures
- Default personality templates for missing NPCs
- Generic responses for context building errors
- Simplified descriptions when detailed generation fails

### Recovery Mechanisms
- Context rebuilding from minimal information
- Cache bypass options for critical requests
- Alternative template selection for missing resources
- Error logging and performance impact tracking

This system creates a comprehensive narrative generation framework that maintains consistency, character continuity, and appropriate dramatic pacing while providing the flexibility to handle diverse RPG scenarios and player interactions.

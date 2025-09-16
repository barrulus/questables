# Phase 2: Core Features Tasks
## Database Integration Core Features (2-3 weeks)

**Phase 2 Goal:** Complete character and campaign management integration, implement comprehensive API endpoints, add real-time chat with database persistence, and connect inventory/spellbook to character data.

**Prerequisites:** Phase 1 must be completed (user authentication, basic character sheet integration, database connection established)

---

## Task Sequence

### Task 1: Implement Complete Character API Endpoints
**File:** `/server/database-server.js`
**Priority:** Critical - API Foundation
**Dependencies:** Phase 1 complete

1. **Add comprehensive character CRUD endpoints**
   ```javascript
   // GET /api/characters/:id - Get single character
   app.get('/api/characters/:id', async (req, res) => {
     try {
       const { id } = req.params;
       const result = await pool.query('SELECT * FROM characters WHERE id = $1', [id]);
       if (result.rows.length === 0) {
         return res.status(404).json({ error: 'Character not found' });
       }
       res.json(result.rows[0]);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // PUT /api/characters/:id - Update character
   app.put('/api/characters/:id', async (req, res) => {
     try {
       const { id } = req.params;
       const updates = req.body;
       // Dynamic update logic here
       res.json({ success: true });
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // DELETE /api/characters/:id - Delete character
   app.delete('/api/characters/:id', async (req, res) => {
     try {
       const { id } = req.params;
       await pool.query('DELETE FROM characters WHERE id = $1', [id]);
       res.json({ success: true });
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });
   ```

2. **Add character validation middleware**
   - Validate character data structure before database operations
   - Check required fields (name, class, level, race, background)
   - Validate JSONB fields (abilities, inventory, equipment)

3. **Add user ownership validation**
   - Ensure users can only access their own characters
   - Add authorization middleware for character operations
   - Return 403 for unauthorized access attempts

**Success Criteria:** All character CRUD operations work via API endpoints with proper validation

---

### Task 2: Implement Campaign Management API
**File:** `/server/database-server.js`
**Priority:** High - Campaign Foundation
**Dependencies:** Task 1 complete

1. **Add campaign CRUD endpoints**
   ```javascript
   // POST /api/campaigns - Create campaign
   app.post('/api/campaigns', async (req, res) => {
     try {
       const campaign = req.body;
       const result = await pool.query(`
         INSERT INTO campaigns (name, description, dm_user_id, system, setting, status, max_players, level_range, is_public)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *
       `, [campaign.name, campaign.description, campaign.dmUserId, campaign.system, 
           campaign.setting, campaign.status, campaign.maxPlayers, 
           JSON.stringify(campaign.levelRange), campaign.isPublic]);
       res.json(result.rows[0]);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // GET /api/users/:userId/campaigns - Get user's campaigns (as DM or player)
   app.get('/api/users/:userId/campaigns', async (req, res) => {
     try {
       const { userId } = req.params;
       const dmCampaigns = await pool.query('SELECT * FROM campaigns WHERE dm_user_id = $1', [userId]);
       const playerCampaigns = await pool.query(`
         SELECT c.* FROM campaigns c 
         JOIN campaign_players cp ON c.id = cp.campaign_id 
         WHERE cp.user_id = $1
       `, [userId]);
       res.json({ dmCampaigns: dmCampaigns.rows, playerCampaigns: playerCampaigns.rows });
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });
   ```

2. **Add campaign player management endpoints**
   ```javascript
   // POST /api/campaigns/:campaignId/players - Join campaign
   app.post('/api/campaigns/:campaignId/players', async (req, res) => {
     try {
       const { campaignId } = req.params;
       const { userId, characterId } = req.body;
       await pool.query(`
         INSERT INTO campaign_players (campaign_id, user_id, character_id, status, role)
         VALUES ($1, $2, $3, 'active', 'player')
       `, [campaignId, userId, characterId]);
       res.json({ success: true });
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // DELETE /api/campaigns/:campaignId/players/:userId - Leave campaign
   app.delete('/api/campaigns/:campaignId/players/:userId', async (req, res) => {
     try {
       const { campaignId, userId } = req.params;
       await pool.query('DELETE FROM campaign_players WHERE campaign_id = $1 AND user_id = $2', [campaignId, userId]);
       res.json({ success: true });
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });
   ```

3. **Add public campaign discovery**
   ```javascript
   // GET /api/campaigns/public - Get public recruiting campaigns
   app.get('/api/campaigns/public', async (req, res) => {
     try {
       const result = await pool.query(`
         SELECT c.*, u.username as dm_username, 
                COUNT(cp.user_id) as current_players
         FROM campaigns c
         LEFT JOIN campaign_players cp ON c.id = cp.campaign_id AND cp.status = 'active'
         JOIN user_profiles u ON c.dm_user_id = u.id
         WHERE c.is_public = true AND c.status = 'recruiting'
         GROUP BY c.id, u.username
         ORDER BY c.created_at DESC
       `);
       res.json(result.rows);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });
   ```

**Success Criteria:** Campaign creation, management, and player joining works via API

---

### Task 3: Update Campaign Manager Component Integration
**File:** `/components/campaign-manager.tsx`
**Priority:** High - Campaign UI
**Dependencies:** Task 2 complete

1. **Replace hardcoded data with API calls**
   ```typescript
   import { useState, useEffect, useContext } from 'react';
   import { UserContext } from '../App';
   import { databaseClient } from '../utils/database';

   interface Campaign {
     id: string;
     name: string;
     description: string;
     dm_user_id: string;
     dm_username?: string;
     status: 'recruiting' | 'active' | 'paused' | 'completed';
     max_players: number;
     current_players?: number;
     level_range: { min: number; max: number };
     is_public: boolean;
     created_at: string;
   }

   export default function CampaignManager() {
     const { user } = useContext(UserContext);
     const [dmCampaigns, setDmCampaigns] = useState<Campaign[]>([]);
     const [playerCampaigns, setPlayerCampaigns] = useState<Campaign[]>([]);
     const [publicCampaigns, setPublicCampaigns] = useState<Campaign[]>([]);
     const [loading, setLoading] = useState(true);
   ```

2. **Implement data loading functions**
   ```typescript
   const loadUserCampaigns = async () => {
     try {
       const response = await fetch(`/api/users/${user.id}/campaigns`);
       const data = await response.json();
       setDmCampaigns(data.dmCampaigns);
       setPlayerCampaigns(data.playerCampaigns);
     } catch (error) {
       console.error('Failed to load campaigns:', error);
     }
   };

   const loadPublicCampaigns = async () => {
     try {
       const response = await fetch('/api/campaigns/public');
       const data = await response.json();
       setPublicCampaigns(data);
     } catch (error) {
       console.error('Failed to load public campaigns:', error);
     }
   };

   useEffect(() => {
     if (user) {
       Promise.all([loadUserCampaigns(), loadPublicCampaigns()])
         .finally(() => setLoading(false));
     }
   }, [user]);
   ```

3. **Implement campaign creation**
   ```typescript
   const createCampaign = async (campaignData: Omit<Campaign, 'id' | 'created_at' | 'dm_username'>) => {
     try {
       const response = await fetch('/api/campaigns', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ ...campaignData, dmUserId: user.id })
       });
       if (response.ok) {
         await loadUserCampaigns(); // Refresh campaign list
       }
     } catch (error) {
       console.error('Failed to create campaign:', error);
     }
   };
   ```

4. **Add campaign joining functionality**
   ```typescript
   const joinCampaign = async (campaignId: string, characterId: string) => {
     try {
       const response = await fetch(`/api/campaigns/${campaignId}/players`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ userId: user.id, characterId })
       });
       if (response.ok) {
         await Promise.all([loadUserCampaigns(), loadPublicCampaigns()]);
       }
     } catch (error) {
       console.error('Failed to join campaign:', error);
     }
   };
   ```

**Success Criteria:** Campaign manager loads real data from database and supports campaign creation/joining

---

### Task 4: Implement Real-time Chat System
**File:** `/components/chat-system.tsx`
**Priority:** High - Communication
**Dependencies:** Task 3 complete

1. **Add chat message API endpoints to server**
   ```javascript
   // POST /api/campaigns/:campaignId/messages - Send message
   app.post('/api/campaigns/:campaignId/messages', async (req, res) => {
     try {
       const { campaignId } = req.params;
       const { content, type, sender_id, sender_name, character_id, dice_roll } = req.body;
       
       const result = await pool.query(`
         INSERT INTO chat_messages (campaign_id, content, message_type, sender_id, sender_name, character_id, dice_roll)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *
       `, [campaignId, content, type, sender_id, sender_name, character_id, JSON.stringify(dice_roll)]);
       
       res.json(result.rows[0]);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // GET /api/campaigns/:campaignId/messages - Get messages
   app.get('/api/campaigns/:campaignId/messages', async (req, res) => {
     try {
       const { campaignId } = req.params;
       const { limit = 50 } = req.query;
       
       const result = await pool.query(`
         SELECT cm.*, up.username, c.name as character_name
         FROM chat_messages cm
         JOIN user_profiles up ON cm.sender_id = up.id
         LEFT JOIN characters c ON cm.character_id = c.id
         WHERE cm.campaign_id = $1
         ORDER BY cm.created_at DESC
         LIMIT $2
       `, [campaignId, limit]);
       
       res.json(result.rows.reverse());
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });
   ```

2. **Replace hardcoded chat with database integration**
   ```typescript
   import { useState, useEffect, useContext } from 'react';
   import { UserContext } from '../App';

   interface ChatMessage {
     id: string;
     campaign_id: string;
     content: string;
     message_type: 'text' | 'dice_roll' | 'system' | 'ooc';
     sender_id: string;
     sender_name: string;
     character_id?: string;
     character_name?: string;
     dice_roll?: any;
     created_at: string;
   }

   export default function ChatSystem({ campaignId }: { campaignId: string }) {
     const { user } = useContext(UserContext);
     const [messages, setMessages] = useState<ChatMessage[]>([]);
     const [newMessage, setNewMessage] = useState('');
     const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
     const [loading, setLoading] = useState(true);
   ```

3. **Implement message loading and sending**
   ```typescript
   const loadMessages = async () => {
     try {
       const response = await fetch(`/api/campaigns/${campaignId}/messages`);
       const data = await response.json();
       setMessages(data);
     } catch (error) {
       console.error('Failed to load messages:', error);
     } finally {
       setLoading(false);
     }
   };

   const sendMessage = async () => {
     if (!newMessage.trim()) return;

     try {
       const messageData = {
         content: newMessage,
         type: 'text',
         sender_id: user.id,
         sender_name: user.username,
         character_id: selectedCharacter,
         dice_roll: null
       };

       const response = await fetch(`/api/campaigns/${campaignId}/messages`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(messageData)
       });

       if (response.ok) {
         setNewMessage('');
         await loadMessages(); // Refresh messages
       }
     } catch (error) {
       console.error('Failed to send message:', error);
     }
   };

   useEffect(() => {
     loadMessages();
     // Set up polling for new messages every 2 seconds
     const interval = setInterval(loadMessages, 2000);
     return () => clearInterval(interval);
   }, [campaignId]);
   ```

4. **Add dice rolling integration**
   ```typescript
   const rollDice = async (diceExpression: string) => {
     // Simple dice rolling logic
     const rollResult = evaluateDiceExpression(diceExpression);
     
     const messageData = {
       content: `${user.username} rolled ${diceExpression}`,
       type: 'dice_roll',
       sender_id: user.id,
       sender_name: user.username,
       character_id: selectedCharacter,
       dice_roll: rollResult
     };

     try {
       await fetch(`/api/campaigns/${campaignId}/messages`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(messageData)
       });
       await loadMessages();
     } catch (error) {
       console.error('Failed to send dice roll:', error);
     }
   };
   ```

**Success Criteria:** Chat system persists messages in database and updates in real-time (via polling)

---

### Task 5: Connect Inventory System to Character Data
**File:** `/components/inventory.tsx`
**Priority:** High - Character Integration
**Dependencies:** Task 4 complete

1. **Replace hardcoded inventory with character data**
   ```typescript
   import { useState, useEffect, useContext } from 'react';
   import { characterHelpers, type InventoryItem, type Equipment } from '../utils/database';

   interface InventoryProps {
     characterId: string;
     onInventoryChange?: () => void;
   }

   export default function Inventory({ characterId, onInventoryChange }: InventoryProps) {
     const [inventory, setInventory] = useState<InventoryItem[]>([]);
     const [equipment, setEquipment] = useState<Equipment | null>(null);
     const [currency, setCurrency] = useState({ copper: 0, silver: 0, gold: 0, platinum: 0 });
     const [loading, setLoading] = useState(true);
   ```

2. **Implement inventory loading**
   ```typescript
   const loadCharacterInventory = async () => {
     try {
       const character = await characterHelpers.getCharacter(characterId);
       if (character) {
         setInventory(character.inventory || []);
         setEquipment(character.equipment || {});
         // Extract currency from inventory or character data
         const currencyItem = character.inventory.find(item => item.type === 'currency');
         if (currencyItem && currencyItem.value) {
           setCurrency(currencyItem.value);
         }
       }
     } catch (error) {
       console.error('Failed to load character inventory:', error);
     } finally {
       setLoading(false);
     }
   };

   useEffect(() => {
     if (characterId) {
       loadCharacterInventory();
     }
   }, [characterId]);
   ```

3. **Implement inventory modification functions**
   ```typescript
   const addItem = async (item: Omit<InventoryItem, 'id'>) => {
     try {
       const newItem: InventoryItem = {
         ...item,
         id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
       };
       
       const updatedInventory = [...inventory, newItem];
       await characterHelpers.updateCharacter(characterId, { inventory: updatedInventory });
       setInventory(updatedInventory);
       onInventoryChange?.();
     } catch (error) {
       console.error('Failed to add item:', error);
     }
   };

   const removeItem = async (itemId: string) => {
     try {
       const updatedInventory = inventory.filter(item => item.id !== itemId);
       await characterHelpers.updateCharacter(characterId, { inventory: updatedInventory });
       setInventory(updatedInventory);
       onInventoryChange?.();
     } catch (error) {
       console.error('Failed to remove item:', error);
     }
   };

   const equipItem = async (item: InventoryItem) => {
     try {
       const updatedEquipment = { ...equipment };
       
       // Logic to equip item based on type
       if (item.type === 'weapon') {
         updatedEquipment.weapons = updatedEquipment.weapons || {};
         updatedEquipment.weapons.mainHand = item;
       } else if (item.type === 'armor') {
         updatedEquipment.armor = item;
       }
       
       await characterHelpers.updateCharacter(characterId, { equipment: updatedEquipment });
       setEquipment(updatedEquipment);
       onInventoryChange?.();
     } catch (error) {
       console.error('Failed to equip item:', error);
     }
   };
   ```

4. **Add currency management**
   ```typescript
   const updateCurrency = async (newCurrency: typeof currency) => {
     try {
       // Find or create currency item in inventory
       const currencyItemIndex = inventory.findIndex(item => item.type === 'currency');
       const updatedInventory = [...inventory];
       
       if (currencyItemIndex >= 0) {
         updatedInventory[currencyItemIndex] = {
           ...updatedInventory[currencyItemIndex],
           value: newCurrency
         };
       } else {
         updatedInventory.push({
           id: 'currency',
           name: 'Currency',
           description: 'Character currency',
           quantity: 1,
           type: 'treasure',
           value: newCurrency
         });
       }
       
       await characterHelpers.updateCharacter(characterId, { inventory: updatedInventory });
       setInventory(updatedInventory);
       setCurrency(newCurrency);
       onInventoryChange?.();
     } catch (error) {
       console.error('Failed to update currency:', error);
     }
   };
   ```

**Success Criteria:** Inventory system reads and writes to character database records

---

### Task 6: Connect Spellbook to Character Data
**File:** `/components/spellbook.tsx`
**Priority:** High - Character Integration
**Dependencies:** Task 5 complete

1. **Replace hardcoded spells with character spellcasting data**
   ```typescript
   import { useState, useEffect } from 'react';
   import { characterHelpers, type Character, type SpellcastingInfo } from '../utils/database';

   interface SpellbookProps {
     characterId: string;
     onSpellcastingChange?: () => void;
   }

   interface Spell {
     id: string;
     name: string;
     level: number;
     school: string;
     description: string;
     castingTime: string;
     range: string;
     duration: string;
     components: string[];
   }

   export default function Spellbook({ characterId, onSpellcastingChange }: SpellbookProps) {
     const [character, setCharacter] = useState<Character | null>(null);
     const [spellcasting, setSpellcasting] = useState<SpellcastingInfo | null>(null);
     const [availableSpells, setAvailableSpells] = useState<Spell[]>([]);
     const [loading, setLoading] = useState(true);
   ```

2. **Implement spellcasting data loading**
   ```typescript
   const loadCharacterSpellcasting = async () => {
     try {
       const char = await characterHelpers.getCharacter(characterId);
       if (char) {
         setCharacter(char);
         setSpellcasting(char.spellcasting || null);
         
         // Load available spells based on character class
         // This would typically come from a spells database/API
         const classSpells = await loadSpellsForClass(char.class);
         setAvailableSpells(classSpells);
       }
     } catch (error) {
       console.error('Failed to load character spellcasting:', error);
     } finally {
       setLoading(false);
     }
   };

   useEffect(() => {
     if (characterId) {
       loadCharacterSpellcasting();
     }
   }, [characterId]);
   ```

3. **Implement spell slot management**
   ```typescript
   const updateSpellSlots = async (level: number, used: number) => {
     if (!spellcasting || !character) return;

     try {
       const updatedSpellcasting = {
         ...spellcasting,
         spellSlots: {
           ...spellcasting.spellSlots,
           [level]: {
             ...spellcasting.spellSlots[level],
             used: Math.min(used, spellcasting.spellSlots[level].max)
           }
         }
       };

       await characterHelpers.updateCharacter(characterId, { 
         spellcasting: updatedSpellcasting 
       });
       setSpellcasting(updatedSpellcasting);
       onSpellcastingChange?.();
     } catch (error) {
       console.error('Failed to update spell slots:', error);
     }
   };

   const castSpell = async (spellLevel: number) => {
     if (spellcasting?.spellSlots[spellLevel]) {
       const currentUsed = spellcasting.spellSlots[spellLevel].used;
       await updateSpellSlots(spellLevel, currentUsed + 1);
     }
   };

   const restoreSpellSlots = async (restType: 'short' | 'long') => {
     if (!spellcasting) return;

     try {
       const updatedSpellSlots = { ...spellcasting.spellSlots };
       
       if (restType === 'long') {
         // Long rest restores all spell slots
         Object.keys(updatedSpellSlots).forEach(level => {
           updatedSpellSlots[level].used = 0;
         });
       }
       // Short rest logic could be implemented for specific classes

       const updatedSpellcasting = {
         ...spellcasting,
         spellSlots: updatedSpellSlots
       };

       await characterHelpers.updateCharacter(characterId, {
         spellcasting: updatedSpellcasting
       });
       setSpellcasting(updatedSpellcasting);
       onSpellcastingChange?.();
     } catch (error) {
       console.error('Failed to restore spell slots:', error);
     }
   };
   ```

4. **Implement known spells management**
   ```typescript
   const learnSpell = async (spellId: string) => {
     if (!spellcasting || !character) return;

     try {
       const updatedSpellcasting = {
         ...spellcasting,
         spellsKnown: [...spellcasting.spellsKnown, spellId]
       };

       await characterHelpers.updateCharacter(characterId, {
         spellcasting: updatedSpellcasting
       });
       setSpellcasting(updatedSpellcasting);
       onSpellcastingChange?.();
     } catch (error) {
       console.error('Failed to learn spell:', error);
     }
   };

   const forgetSpell = async (spellId: string) => {
     if (!spellcasting || !character) return;

     try {
       const updatedSpellcasting = {
         ...spellcasting,
         spellsKnown: spellcasting.spellsKnown.filter(id => id !== spellId)
       };

       await characterHelpers.updateCharacter(characterId, {
         spellcasting: updatedSpellcasting
       });
       setSpellcasting(updatedSpellcasting);
       onSpellcastingChange?.();
     } catch (error) {
       console.error('Failed to forget spell:', error);
     }
   };
   ```

**Success Criteria:** Spellbook reads character spellcasting data and persists spell slot usage

---

### Task 7: Update Character Sheet with Live Data Synchronization
**File:** `/components/character-sheet.tsx`
**Priority:** Medium - Data Synchronization
**Dependencies:** Task 6 complete

1. **Add automatic data refresh when inventory/spells change**
   ```typescript
   const [character, setCharacter] = useState<Character | null>(null);
   const [refreshTrigger, setRefreshTrigger] = useState(0);

   const refreshCharacter = () => {
     setRefreshTrigger(prev => prev + 1);
   };

   useEffect(() => {
     loadCharacter();
   }, [characterId, refreshTrigger]);
   ```

2. **Connect to inventory and spellbook updates**
   ```typescript
   return (
     <div className="character-sheet">
       {/* Character basic info */}
       <CharacterBasicInfo character={character} />
       
       {/* Inventory component with refresh callback */}
       <Inventory 
         characterId={characterId} 
         onInventoryChange={refreshCharacter}
       />
       
       {/* Spellbook component with refresh callback */}
       <Spellbook 
         characterId={characterId} 
         onSpellcastingChange={refreshCharacter}
       />
     </div>
   );
   ```

3. **Add real-time calculated stats**
   ```typescript
   const calculateDerivedStats = (character: Character) => {
     const abilityModifiers = {
       strength: Math.floor((character.abilities.strength - 10) / 2),
       dexterity: Math.floor((character.abilities.dexterity - 10) / 2),
       constitution: Math.floor((character.abilities.constitution - 10) / 2),
       intelligence: Math.floor((character.abilities.intelligence - 10) / 2),
       wisdom: Math.floor((character.abilities.wisdom - 10) / 2),
       charisma: Math.floor((character.abilities.charisma - 10) / 2)
     };

     // Calculate AC from equipment
     let armorClass = 10 + abilityModifiers.dexterity;
     if (character.equipment?.armor) {
       // AC calculation logic based on equipped armor
     }

     return { abilityModifiers, armorClass };
   };
   ```

**Success Criteria:** Character sheet automatically updates when inventory or spells change

---

### Task 8: Add Error Handling and Loading States
**Files:** All modified components
**Priority:** Medium - User Experience
**Dependencies:** Tasks 1-7 complete

1. **Standardize error handling across components**
   ```typescript
   // Create shared error handling utilities
   // File: /utils/error-handling.tsx
   export interface AppError {
     message: string;
     code?: string;
     details?: any;
   }

   export const handleApiError = (error: any): AppError => {
     if (error.response) {
       return {
         message: error.response.data?.error || 'Server error occurred',
         code: error.response.status.toString(),
         details: error.response.data
       };
     }
     return {
       message: error.message || 'An unexpected error occurred'
     };
   };
   ```

2. **Add loading states to all database operations**
   ```typescript
   // Standard loading state pattern for all components
   const [loading, setLoading] = useState(false);
   const [error, setError] = useState<AppError | null>(null);

   const executeWithErrorHandling = async (operation: () => Promise<void>) => {
     try {
       setLoading(true);
       setError(null);
       await operation();
     } catch (err) {
       setError(handleApiError(err));
     } finally {
       setLoading(false);
     }
   };
   ```

3. **Add retry mechanisms**
   ```typescript
   const retryOperation = async (operation: () => Promise<void>, maxRetries = 3) => {
     for (let attempt = 1; attempt <= maxRetries; attempt++) {
       try {
         await operation();
         return;
       } catch (error) {
         if (attempt === maxRetries) throw error;
         await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
       }
     }
   };
   ```

**Success Criteria:** All components have consistent error handling and loading states

---

### Task 9: Implement Database Connection Health Monitoring
**File:** `/App.tsx`
**Priority:** Low - Reliability
**Dependencies:** Task 8 complete

1. **Add connection monitoring**
   ```typescript
   const [dbStatus, setDbStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');

   const checkDatabaseConnection = async () => {
     try {
       const response = await fetch('/health');
       if (response.ok) {
         setDbStatus('connected');
       } else {
         setDbStatus('error');
       }
     } catch (error) {
       setDbStatus('disconnected');
     }
   };

   useEffect(() => {
     checkDatabaseConnection();
     const interval = setInterval(checkDatabaseConnection, 30000); // Check every 30 seconds
     return () => clearInterval(interval);
   }, []);
   ```

2. **Add connection status UI**
   ```typescript
   const renderConnectionStatus = () => {
     switch (dbStatus) {
       case 'connected':
         return <div className="status-indicator connected">Database Connected</div>;
       case 'disconnected':
         return <div className="status-indicator disconnected">Database Disconnected</div>;
       case 'error':
         return <div className="status-indicator error">Database Error</div>;
       default:
         return <div className="status-indicator connecting">Connecting...</div>;
     }
   };
   ```

**Success Criteria:** App displays database connection status and handles disconnections gracefully

---

### Task 10: Update Documentation and Environment Setup
**Files:** `README.md`, `.env.example`, `package.json`
**Priority:** Low - Documentation
**Dependencies:** Tasks 1-9 complete

1. **Update .env.example with all required variables**
   ```bash
   # Database Configuration
   VITE_DATABASE_SERVER_URL=http://localhost:3001
   
   # Server Configuration
   DATABASE_HOST=localhost
   DATABASE_PORT=5432
   DATABASE_NAME=dnd_app
   DATABASE_USER=your_username
   DATABASE_PASSWORD=your_password
   DATABASE_SSL=false
   
   # Frontend Configuration
   FRONTEND_URL=http://localhost:3000
   DATABASE_SERVER_PORT=3001
   ```

2. **Add setup documentation**
   - Document Phase 2 feature usage
   - Add API endpoint documentation
   - Document campaign creation and management flow
   - Add troubleshooting guide for common issues

3. **Add npm scripts for development**
   ```json
   {
     "scripts": {
       "dev:full": "concurrently \"npm run dev\" \"npm run server\"",
       "server": "cd server && npm run dev",
       "db:setup": "psql -d dnd_app -f database/schema.sql",
       "db:reset": "dropdb dnd_app && createdb dnd_app && npm run db:setup"
     }
   }
   ```

**Success Criteria:** Complete documentation for Phase 2 features and setup

---

## Phase 2 Completion Criteria

### Functional Requirements Met:
- ✅ Complete character CRUD operations via API
- ✅ Campaign creation, management, and player joining works
- ✅ Real-time chat system with database persistence
- ✅ Inventory system connected to character data
- ✅ Spellbook system with spell slot management
- ✅ Character sheet reflects live data from inventory/spells
- ✅ Error handling and loading states implemented
- ✅ Database connection monitoring active

### Technical Requirements Met:
- ✅ Comprehensive API endpoints for characters and campaigns
- ✅ All hardcoded campaign data eliminated
- ✅ Real-time chat with polling mechanism
- ✅ Inventory and equipment persistence
- ✅ Spellcasting data persistence and management
- ✅ Live data synchronization between components

### Success Validation:
1. User can create, edit, and delete characters with full data persistence
2. User can create campaigns and invite other players
3. Players can join public campaigns and communicate via chat
4. Inventory changes persist and affect character stats
5. Spell slot usage is tracked and persists across sessions
6. Character sheet automatically updates when related data changes
7. All database operations handle errors gracefully
8. Application works smoothly with multiple users

**Ready for Phase 3:** Advanced Features (PostGIS mapping, combat tracking, sessions)
# Phase 1: Foundation Tasks
## Database Integration Foundation (1-2 weeks)

**Phase 1 Goal:** Establish basic database connectivity, fix authentication, and connect core character functionality to eliminate hardcoded data for essential features.

---

## Task Sequence

### Task 1: Fix Database Server Schema Alignment
**File:** `/server/database-server.js`
**Priority:** Critical - Foundation
**Dependencies:** None

1. **Replace simplified table creation with full schema import**
   - Remove hardcoded table creation in lines 68-135
   - Add schema file import: `import { readFileSync } from 'fs';`
   - Replace table creation with: 
     ```javascript
     const schemaSQL = readFileSync('./database/schema.sql', 'utf8');
     await client.query(schemaSQL);
     ```

2. **Fix UUID vs SERIAL mismatch**
   - Update all references from `SERIAL PRIMARY KEY` to `UUID DEFAULT uuid_generate_v4() PRIMARY KEY`
   - Ensure UUID extension is enabled first

3. **Add missing API endpoints**
   - Add endpoint: `POST /api/characters` (create character)
   - Add endpoint: `GET /api/characters/:id` (get character)
   - Add endpoint: `GET /api/users/:userId/characters` (get user's characters)
   - Add endpoint: `PUT /api/characters/:id` (update character)
   - Add endpoint: `DELETE /api/characters/:id` (delete character)

**Success Criteria:** Server creates full schema and provides character CRUD endpoints

---

### Task 2: Fix Data Structure Mismatches in TypeScript Interfaces
**File:** `/utils/database/data-structures.tsx`
**Priority:** Critical - Foundation
**Dependencies:** Task 1 complete

1. **Fix User interface alignment**
   - Add missing fields: `avatar_url?: string`, `timezone?: string`
   - Change `createdAt` to match database `created_at` field naming
   - Change `lastLogin` to match database `last_login` field naming

2. **Fix Character interface critical mismatches**
   - Change `userId` to `user_id` to match database snake_case
   - Change `hitPoints` to `hit_points` 
   - Change `armorClass` to `armor_class`
   - Change `proficiencyBonus` to `proficiency_bonus`
   - Change `savingThrows` to `saving_throws`
   - Update `campaigns` from `string[]` to proper relationship handling
   - Ensure all timestamps are `string` type for ISO dates

3. **Add database field mapping utility**
   - Create function `mapDatabaseFields(dbObject)` to convert snake_case to camelCase
   - Create function `mapToDatabase(frontendObject)` to convert camelCase to snake_case

**Success Criteria:** TypeScript interfaces align with actual database schema

---

### Task 3: Update Database Helper Functions
**File:** `/utils/database/production-helpers.tsx`
**Priority:** High - Foundation
**Dependencies:** Task 2 complete

1. **Fix userHelpers functions**
   - Update `getCurrentUser()` to use proper field names (`created_at`, `last_login`)
   - Add field mapping in return statements
   - Fix `updateUserProfile()` to handle snake_case conversion

2. **Fix characterHelpers functions**
   - Update all SQL queries to use snake_case field names
   - Add proper field mapping in `getCharacter()`
   - Fix `createCharacter()` to handle UUID generation
   - Update `updateCharacter()` field mapping
   - Ensure JSON parsing handles database JSONB fields correctly

3. **Add error handling**
   - Wrap all database calls in try-catch blocks
   - Add specific error messages for common issues
   - Add connection validation before queries

**Success Criteria:** Helper functions work with corrected database schema

---

### Task 4: Implement User Authentication Context
**File:** `/App.tsx`
**Priority:** Critical - User Management
**Dependencies:** Task 3 complete

1. **Create UserContext**
   - Add React context: `createContext<{user: User | null, login: (user: User) => void, logout: () => void}>()`
   - Add context provider wrapper around main app content
   - Add localStorage persistence for user session

2. **Fix authentication flow**
   - Import and use `databaseClient.auth.login()` in login modal
   - Store returned user in context and localStorage
   - Add authentication check on app startup
   - Add logout functionality that clears context and localStorage

3. **Add user session validation**
   - Check localStorage on app startup
   - Validate user session with database
   - Handle expired/invalid sessions gracefully

4. **Add loading states**
   - Add loading state during authentication
   - Add loading state during initial user validation
   - Show appropriate UI during loading

**Success Criteria:** User login persists across page refreshes and provides user context to all components

---

### Task 5: Connect Character Sheet to Database
**File:** `/components/character-sheet.tsx`
**Priority:** High - Core Functionality
**Dependencies:** Task 4 complete

1. **Add database imports and props**
   - Import: `import { characterHelpers, Character } from '../utils/database'`
   - Change component props to accept: `characterId: string`
   - Add user context: `const { user } = useContext(UserContext)`

2. **Replace hardcoded data with database loading**
   - Remove hardcoded character object
   - Add state: `const [character, setCharacter] = useState<Character | null>(null)`
   - Add state: `const [loading, setLoading] = useState(true)`
   - Add useEffect to load character:
     ```typescript
     useEffect(() => {
       if (characterId) {
         loadCharacter();
       }
     }, [characterId]);

     const loadCharacter = async () => {
       try {
         setLoading(true);
         const char = await characterHelpers.getCharacter(characterId);
         setCharacter(char);
       } catch (error) {
         console.error('Failed to load character:', error);
       } finally {
         setLoading(false);
       }
     };
     ```

3. **Add data transformation for display**
   - Create helper function to calculate ability modifiers
   - Create helper function to calculate skill bonuses from character data
   - Transform database inventory/equipment JSONB to display format

4. **Add loading and error states**
   - Show loading spinner while character loads
   - Show error message if character fails to load
   - Handle case where character doesn't exist

**Success Criteria:** Character sheet displays real character data from database

---

### Task 6: Add Character Creation/Selection Interface
**File:** `/components/character-manager.tsx`
**Priority:** High - Core Functionality
**Dependencies:** Task 5 complete

1. **Fix data structure alignment**
   - Remove local `Character` interface
   - Import database `Character` interface from utils
   - Update all references to use database-aligned structure

2. **Replace hardcoded characters with database loading**
   - Remove hardcoded characters array
   - Add state: `const [characters, setCharacters] = useState<Character[]>([])`
   - Add useEffect to load user's characters:
     ```typescript
     useEffect(() => {
       if (user) {
         loadUserCharacters();
       }
     }, [user]);

     const loadUserCharacters = async () => {
       try {
         const chars = await characterHelpers.getCharactersByUser(user.id);
         setCharacters(chars);
       } catch (error) {
         console.error('Failed to load characters:', error);
       }
     };
     ```

3. **Implement character creation**
   - Add form for basic character creation (name, class, race, level)
   - Use database `Character` structure for form
   - Call `characterHelpers.createCharacter()` on form submission
   - Refresh character list after creation

4. **Add character selection**
   - Add character selection interface
   - Pass selected character ID to character sheet component
   - Add character switching functionality

**Success Criteria:** Users can create, view, and select their characters from the database

---

### Task 7: Implement Basic Campaign Context
**File:** `/App.tsx` (extend existing UserContext)
**Priority:** Medium - Multi-user Support
**Dependencies:** Task 6 complete

1. **Extend user context with campaign**
   - Add `activeCampaign: Campaign | null` to user context
   - Add `setActiveCampaign: (campaign: Campaign) => void` function
   - Add localStorage persistence for active campaign

2. **Add campaign selection interface**
   - Create simple campaign selector component
   - Load user's campaigns using database helpers
   - Allow user to select active campaign
   - Store selection in context and localStorage

3. **Connect campaign to character sheet**
   - Filter character list by active campaign if selected
   - Show campaign-specific character data
   - Add campaign context to character sheet component

**Success Criteria:** Users can select campaigns and see campaign-specific character data

---

### Task 8: Add Database Connection Initialization
**File:** `/App.tsx` (startup sequence)
**Priority:** High - Reliability
**Dependencies:** Task 7 complete

1. **Add database connection testing**
   - Import `utils.testConnection()` from database utilities
   - Test database connection on app startup
   - Show connection status to user
   - Handle connection failures gracefully

2. **Add database initialization check**
   - Use `utils.initializeDatabase()` to verify schema
   - Show database status in UI
   - Provide clear error messages for setup issues

3. **Add environment variable validation**
   - Check for required environment variables on startup
   - Show clear setup instructions if variables missing
   - Validate database server URL accessibility

**Success Criteria:** App shows clear database connection status and setup guidance

---

### Task 9: Add Basic Error Handling and Loading States
**Files:** All components modified in previous tasks
**Priority:** Medium - User Experience
**Dependencies:** Tasks 1-8 complete

1. **Standardize error handling**
   - Create error boundary component
   - Add consistent error display components
   - Add error logging for debugging

2. **Add loading states to all database operations**
   - Character loading indicators
   - User authentication loading
   - Campaign loading indicators

3. **Add retry mechanisms**
   - Retry failed database connections
   - Retry failed character loads
   - Add manual refresh buttons for failed operations

**Success Criteria:** All database operations have proper loading and error states

---

### Task 10: Update Environment Configuration
**File:** `.env.example` and documentation
**Priority:** Low - Setup
**Dependencies:** Tasks 1-9 complete

1. **Create comprehensive .env.example**
   - Add all required environment variables
   - Document database connection settings
   - Add development vs production configurations

2. **Add setup documentation**
   - Document database setup requirements
   - Add PostgreSQL installation instructions
   - Document schema import process

3. **Add development scripts**
   - Add package.json scripts for database setup
   - Add schema migration commands
   - Add development server startup sequence

**Success Criteria:** New developers can set up the database integration following clear documentation

---

## Phase 1 Completion Criteria

### Functional Requirements Met:
- ✅ User authentication works and persists across sessions
- ✅ Character sheet loads real character data from database
- ✅ Users can create and manage their characters
- ✅ Database connection is properly initialized and tested
- ✅ Basic campaign context is available
- ✅ All hardcoded character data is eliminated

### Technical Requirements Met:
- ✅ Database schema alignment between server and full schema.sql
- ✅ TypeScript interfaces match database structure
- ✅ Database helper functions work with real schema
- ✅ Error handling and loading states implemented
- ✅ User context provides authentication across app

### Success Validation:
1. User can register/login and session persists after page refresh
2. User can create a new character and it appears in database
3. Character sheet displays character data from database
4. User can switch between multiple characters
5. Basic campaign selection works
6. No hardcoded character data remains in components
7. Database connection errors are handled gracefully

**Ready for Phase 2:** Core Features Integration
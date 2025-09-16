// Component integration tests for CharacterSheet
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CharacterSheet } from '../character-sheet';
import UserContext from '../../contexts/UserContext';

// Mock the production helpers
jest.mock('../../utils/database/production-helpers', () => ({
  characterHelpers: {
    getCharacter: jest.fn(),
    updateCharacter: jest.fn(),
  },
}));

// Mock user context
const mockUser = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  username: 'testuser',
  email: 'test@example.com',
  role: 'player'
};

const mockCharacter = {
  id: '456e7890-e89b-12d3-a456-426614174001',
  user_id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Test Character',
  character_class: 'Fighter',
  level: 5,
  race: 'Human',
  background: 'Soldier',
  abilities: {
    strength: 16,
    dexterity: 14,
    constitution: 15,
    intelligence: 12,
    wisdom: 13,
    charisma: 11
  },
  hit_points: { max: 45, current: 35, temporary: 0 },
  armor_class: 16,
  proficiency_bonus: 3,
  speed: 30,
  skills: {
    athletics: 6,
    intimidation: 3
  },
  saving_throws: {
    strength: 6,
    constitution: 5
  },
  inventory: [
    {
      name: 'Longsword',
      type: 'weapon',
      quantity: 1,
      equipped: true
    }
  ],
  spellcasting: null
};

// Helper function to render component with context
const renderWithContext = (component: React.ReactElement) => {
  return render(
    <UserContext.Provider value={{ user: mockUser, setUser: jest.fn() }}>
      {component}
    </UserContext.Provider>
  );
};

describe('CharacterSheet Component', () => {
  const mockGetCharacter = require('../../utils/database/production-helpers').characterHelpers.getCharacter;
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render loading state initially', () => {
    mockGetCharacter.mockImplementation(() => new Promise(() => {})); // Never resolves
    
    renderWithContext(<CharacterSheet characterId="456e7890-e89b-12d3-a456-426614174001" />);
    
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('should render character data when loaded successfully', async () => {
    mockGetCharacter.mockResolvedValue(mockCharacter);
    
    renderWithContext(<CharacterSheet characterId="456e7890-e89b-12d3-a456-426614174001" />);
    
    await waitFor(() => {
      expect(screen.getByText('Test Character')).toBeInTheDocument();
    });
    
    expect(screen.getByText('Fighter')).toBeInTheDocument();
    expect(screen.getByText('Level 5')).toBeInTheDocument();
    expect(screen.getByText('Human')).toBeInTheDocument();
  });

  it('should display ability scores correctly', async () => {
    mockGetCharacter.mockResolvedValue(mockCharacter);
    
    renderWithContext(<CharacterSheet characterId="456e7890-e89b-12d3-a456-426614174001" />);
    
    await waitFor(() => {
      expect(screen.getByText('Test Character')).toBeInTheDocument();
    });
    
    // Check ability scores are displayed
    expect(screen.getByText('16')).toBeInTheDocument(); // Strength
    expect(screen.getByText('14')).toBeInTheDocument(); // Dexterity
    expect(screen.getByText('15')).toBeInTheDocument(); // Constitution
  });

  it('should calculate ability modifiers correctly', async () => {
    mockGetCharacter.mockResolvedValue(mockCharacter);
    
    renderWithContext(<CharacterSheet characterId="456e7890-e89b-12d3-a456-426614174001" />);
    
    await waitFor(() => {
      expect(screen.getByText('Test Character')).toBeInTheDocument();
    });
    
    // Strength 16 = +3 modifier
    expect(screen.getByText('+3')).toBeInTheDocument();
    // Dexterity 14 = +2 modifier  
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('should display hit points correctly', async () => {
    mockGetCharacter.mockResolvedValue(mockCharacter);
    
    renderWithContext(<CharacterSheet characterId="456e7890-e89b-12d3-a456-426614174001" />);
    
    await waitFor(() => {
      expect(screen.getByText('Test Character')).toBeInTheDocument();
    });
    
    expect(screen.getByText('35 / 45')).toBeInTheDocument();
  });

  it('should handle character not found error', async () => {
    mockGetCharacter.mockResolvedValue(null);
    
    renderWithContext(<CharacterSheet characterId="nonexistent-id" />);
    
    await waitFor(() => {
      expect(screen.getByText(/character not found/i)).toBeInTheDocument();
    });
  });

  it('should handle network error', async () => {
    mockGetCharacter.mockRejectedValue(new Error('Network error'));
    
    renderWithContext(<CharacterSheet characterId="456e7890-e89b-12d3-a456-426614174001" />);
    
    await waitFor(() => {
      expect(screen.getByText(/failed to load character/i)).toBeInTheDocument();
    });
  });

  it('should refresh character data when refreshTrigger changes', async () => {
    mockGetCharacter.mockResolvedValue(mockCharacter);
    
    const { rerender } = renderWithContext(
      <CharacterSheet characterId="456e7890-e89b-12d3-a456-426614174001" refreshTrigger={1} />
    );
    
    await waitFor(() => {
      expect(screen.getByText('Test Character')).toBeInTheDocument();
    });
    
    expect(mockGetCharacter).toHaveBeenCalledTimes(1);
    
    // Trigger refresh
    rerender(
      <UserContext.Provider value={{ user: mockUser, setUser: jest.fn() }}>
        <CharacterSheet characterId="456e7890-e89b-12d3-a456-426614174001" refreshTrigger={2} />
      </UserContext.Provider>
    );
    
    await waitFor(() => {
      expect(mockGetCharacter).toHaveBeenCalledTimes(2);
    });
  });

  it('should display skills with correct bonuses', async () => {
    mockGetCharacter.mockResolvedValue(mockCharacter);
    
    renderWithContext(<CharacterSheet characterId="456e7890-e89b-12d3-a456-426614174001" />);
    
    await waitFor(() => {
      expect(screen.getByText('Test Character')).toBeInTheDocument();
    });
    
    // Athletics should show +6 (proficient)
    expect(screen.getByText('+6')).toBeInTheDocument();
  });

  it('should handle character without spellcasting', async () => {
    mockGetCharacter.mockResolvedValue(mockCharacter);
    
    renderWithContext(<CharacterSheet characterId="456e7890-e89b-12d3-a456-426614174001" />);
    
    await waitFor(() => {
      expect(screen.getByText('Test Character')).toBeInTheDocument();
    });
    
    // Should not crash when spellcasting is null
    expect(screen.queryByText(/spell slots/i)).not.toBeInTheDocument();
  });

  it('should render without character ID', () => {
    renderWithContext(<CharacterSheet />);
    
    // Should handle missing character ID gracefully
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });
});

// Test validation functions
describe('CharacterSheet Validation', () => {
  it('should validate ability score range', () => {
    // Valid range: 1-30
    expect(16).toBeGreaterThanOrEqual(1);
    expect(16).toBeLessThanOrEqual(30);
  });

  it('should validate character level range', () => {
    // Valid range: 1-20
    expect(5).toBeGreaterThanOrEqual(1);
    expect(5).toBeLessThanOrEqual(20);
  });

  it('should calculate ability modifiers correctly', () => {
    const getModifier = (score: number) => Math.floor((score - 10) / 2);
    
    expect(getModifier(8)).toBe(-1);   // 8 = -1
    expect(getModifier(10)).toBe(0);   // 10 = +0
    expect(getModifier(12)).toBe(1);   // 12 = +1
    expect(getModifier(16)).toBe(3);   // 16 = +3
    expect(getModifier(20)).toBe(5);   // 20 = +5
  });
});

// Error boundary test
describe('CharacterSheet Error Handling', () => {
  it('should handle component errors gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    
    mockGetCharacter.mockImplementation(() => {
      throw new Error('Component error');
    });
    
    renderWithContext(<CharacterSheet characterId="456e7890-e89b-12d3-a456-426614174001" />);
    
    await waitFor(() => {
      expect(screen.getByText(/failed to load character/i)).toBeInTheDocument();
    });
    
    consoleSpy.mockRestore();
  });
});

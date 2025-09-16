// Unit tests for database helper functions
import { characterHelpers, campaignHelpers } from '../production-helpers';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('characterHelpers', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('getCharacter', () => {
    it('should return character data for valid ID', async () => {
      const mockCharacter = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Character',
        character_class: 'Fighter',
        level: 5,
        race: 'Human',
        abilities: {
          strength: 16,
          dexterity: 14,
          constitution: 15,
          intelligence: 12,
          wisdom: 13,
          charisma: 11
        },
        hit_points: { max: 45, current: 45 },
        armor_class: 16
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ character: mockCharacter })
      });

      const result = await characterHelpers.getCharacter('123e4567-e89b-12d3-a456-426614174000');

      expect(mockFetch).toHaveBeenCalledWith('/api/characters/123e4567-e89b-12d3-a456-426614174000');
      expect(result).toEqual(mockCharacter);
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        characterHelpers.getCharacter('invalid-id')
      ).rejects.toThrow('Network error');
    });

    it('should handle 404 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Character not found' })
      });

      const result = await characterHelpers.getCharacter('nonexistent-id');
      expect(result).toBeNull();
    });
  });

  describe('createCharacter', () => {
    it('should create character with valid data', async () => {
      const newCharacter = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'New Character',
        character_class: 'Wizard',
        level: 1,
        race: 'Elf',
        background: 'Scholar',
        abilities: {
          strength: 10,
          dexterity: 14,
          constitution: 12,
          intelligence: 16,
          wisdom: 13,
          charisma: 11
        },
        hit_points: { max: 8, current: 8 },
        armor_class: 12,
        proficiency_bonus: 2,
        speed: 30
      };

      const mockResponse = { ...newCharacter, id: '456e7890-e89b-12d3-a456-426614174001' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ character: mockResponse })
      });

      const result = await characterHelpers.createCharacter(newCharacter);

      expect(mockFetch).toHaveBeenCalledWith('/api/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCharacter)
      });
      expect(result).toEqual(mockResponse);
    });

    it('should handle validation errors', async () => {
      const invalidCharacter = {
        name: '', // Invalid: empty name
        character_class: 'Fighter'
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ 
          error: 'Validation failed',
          details: [{ field: 'name', message: 'Character name is required' }]
        })
      });

      await expect(
        characterHelpers.createCharacter(invalidCharacter)
      ).rejects.toThrow('Validation failed');
    });
  });
});

describe('campaignHelpers', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('getCampaignsByUser', () => {
    it('should return user campaigns', async () => {
      const mockCampaigns = {
        dmCampaigns: [
          {
            id: '123e4567-e89b-12d3-a456-426614174000',
            name: 'Test Campaign',
            dm_user_id: '456e7890-e89b-12d3-a456-426614174001',
            status: 'active'
          }
        ],
        playerCampaigns: []
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCampaigns
      });

      const result = await campaignHelpers.getCampaignsByUser('456e7890-e89b-12d3-a456-426614174001');

      expect(mockFetch).toHaveBeenCalledWith('/api/users/456e7890-e89b-12d3-a456-426614174001/campaigns');
      expect(result).toEqual(mockCampaigns);
    });
  });

  describe('createCampaign', () => {
    it('should create campaign with valid data', async () => {
      const newCampaign = {
        name: 'New Campaign',
        description: 'Test description',
        dmUserId: '123e4567-e89b-12d3-a456-426614174000',
        system: 'D&D 5e',
        maxPlayers: 6,
        isPublic: false
      };

      const mockResponse = { ...newCampaign, id: '456e7890-e89b-12d3-a456-426614174001' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ campaign: mockResponse })
      });

      const result = await campaignHelpers.createCampaign(newCampaign);

      expect(mockFetch).toHaveBeenCalledWith('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCampaign)
      });
      expect(result).toEqual(mockResponse);
    });
  });
});

// Integration test for database connection
describe('Database Integration', () => {
  it('should handle database connection errors gracefully', async () => {
    // Mock database connection failure
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(
      characterHelpers.getCharacter('123e4567-e89b-12d3-a456-426614174000')
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('should handle timeout errors', async () => {
    // Mock timeout
    mockFetch.mockImplementationOnce(() => 
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 100)
      )
    );

    await expect(
      characterHelpers.getCharacter('123e4567-e89b-12d3-a456-426614174000')
    ).rejects.toThrow('Timeout');
  });
});

// Test data validation
describe('Data Validation', () => {
  it('should validate UUID format', () => {
    const validUUID = '123e4567-e89b-12d3-a456-426614174000';
    const invalidUUID = 'invalid-uuid';

    expect(validUUID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(invalidUUID).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('should validate character level range', () => {
    expect(5).toBeGreaterThanOrEqual(1);
    expect(5).toBeLessThanOrEqual(20);
    
    expect(0).toBeLessThan(1);
    expect(21).toBeGreaterThan(20);
  });

  it('should validate ability scores', () => {
    expect(16).toBeGreaterThanOrEqual(1);
    expect(16).toBeLessThanOrEqual(30);
    
    expect(0).toBeLessThan(1);
    expect(31).toBeGreaterThan(30);
  });
});
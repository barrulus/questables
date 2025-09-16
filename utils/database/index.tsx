// Main database utilities export
// Provides a unified interface for all database operations

export { databaseClient, db } from './client';
export { 
  userHelpers, 
  characterHelpers, 
  campaignHelpers, 
  locationHelpers, 
  mapHelpers, 
  chatHelpers, 
  utils 
} from './production-helpers';

export type * from './data-structures';

// Legacy compatibility
export const supabase = null;
console.warn('supabase import is deprecated - use databaseClient instead');
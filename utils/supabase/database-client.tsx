// Unified database client for both Supabase and local PostgreSQL
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { databaseConfig, databaseType } from './info';

// Database client interface
export interface DatabaseClient {
  type: 'supabase' | 'local-postgres';
  query: (sql: string, params?: any[]) => Promise<any>;
  from: (table: string) => any;
  auth: any;
  storage: any;
  channel: (channel: string) => any;
  rpc: (fn: string, params?: any) => Promise<any>;
}

// Create Supabase client
const createSupabaseDBClient = (): DatabaseClient => {
  const client = createSupabaseClient(
    databaseConfig.supabase.url,
    databaseConfig.supabase.anonKey
  );

  return {
    type: 'supabase',
    query: async (sql: string, params?: any[]) => {
      // For raw SQL queries in Supabase, we use RPC functions
      // This is a placeholder - you'd need to create stored procedures
      console.warn('[Database] Raw SQL queries require stored procedures in Supabase');
      return { data: null, error: new Error('Raw SQL not supported via client') };
    },
    from: (table: string) => client.from(table),
    auth: client.auth,
    storage: client.storage,
    channel: (channel: string) => client.channel(channel),
    rpc: (fn: string, params?: any) => client.rpc(fn, params)
  };
};

// Create local PostgreSQL client
const createPostgreSQLClient = (): DatabaseClient => {
  // Note: This is a placeholder for PostgreSQL client
  // In a real implementation, you'd use a library like 'pg' or 'postgres'
  // Since we're in a browser environment, this would need to go through a server
  
  const postgresClient = {
    type: 'local-postgres' as const,
    query: async (sql: string, params?: any[]) => {
      try {
        // This would make a request to your local server endpoint
        const response = await fetch('/api/database/query', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sql, params })
        });
        
        if (!response.ok) {
          throw new Error(`Database query failed: ${response.statusText}`);
        }
        
        const result = await response.json();
        return { data: result.rows, error: null };
      } catch (error) {
        console.error('[Database] PostgreSQL query error:', error);
        return { data: null, error };
      }
    },
    from: (table: string) => ({
      select: (columns: string = '*') => ({
        eq: (column: string, value: any) => ({
          single: () => postgresClient.query(
            `SELECT ${columns} FROM ${table} WHERE ${column} = $1 LIMIT 1`,
            [value]
          ),
          limit: (count: number) => ({
            then: (callback: any) => postgresClient.query(
              `SELECT ${columns} FROM ${table} WHERE ${column} = $1 LIMIT ${count}`,
              [value]
            ).then(callback)
          })
        }),
        order: (column: string, options?: { ascending?: boolean }) => ({
          then: (callback: any) => postgresClient.query(
            `SELECT ${columns} FROM ${table} ORDER BY ${column} ${options?.ascending === false ? 'DESC' : 'ASC'}`,
            []
          ).then(callback)
        }),
        then: (callback: any) => postgresClient.query(
          `SELECT ${columns} FROM ${table}`,
          []
        ).then(callback)
      }),
      insert: (data: any) => ({
        select: () => ({
          single: () => {
            const keys = Object.keys(data);
            const values = Object.values(data);
            const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
            return postgresClient.query(
              `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
              values
            );
          }
        })
      }),
      update: (data: any) => ({
        eq: (column: string, value: any) => ({
          select: () => ({
            single: () => {
              const keys = Object.keys(data);
              const values = Object.values(data);
              const updates = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
              return postgresClient.query(
                `UPDATE ${table} SET ${updates} WHERE ${column} = $${keys.length + 1} RETURNING *`,
                [...values, value]
              );
            }
          })
        })
      }),
      delete: () => ({
        eq: (column: string, value: any) => 
          postgresClient.query(`DELETE FROM ${table} WHERE ${column} = $1`, [value])
      })
    }),
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: new Error('Auth not implemented for local PostgreSQL') }),
      signInWithPassword: () => Promise.resolve({ data: null, error: new Error('Auth not implemented for local PostgreSQL') }),
      signUp: () => Promise.resolve({ data: null, error: new Error('Auth not implemented for local PostgreSQL') }),
      signOut: () => Promise.resolve({ error: null })
    },
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ data: null, error: new Error('Storage not implemented for local PostgreSQL') }),
        getPublicUrl: () => ({ data: { publicUrl: '' } })
      })
    },
    channel: () => ({
      on: () => ({ subscribe: () => {} }),
      subscribe: () => {}
    }),
    rpc: async (fn: string, params?: any) => {
      // Call PostgreSQL functions
      const paramKeys = params ? Object.keys(params) : [];
      const paramValues = params ? Object.values(params) : [];
      const paramPlaceholders = paramKeys.map((_, i) => `$${i + 1}`).join(', ');
      
      const result = await postgresClient.query(
        `SELECT ${fn}(${paramPlaceholders})`,
        paramValues
      );
      
      return result;
    }
  };

  return postgresClient;
};

// Create the appropriate client based on configuration
export const createDatabaseClient = (): DatabaseClient => {
  if (databaseType === 'local-postgres') {
    console.log('[Database] Initializing local PostgreSQL client');
    return createPostgreSQLClient();
  } else {
    console.log('[Database] Initializing Supabase client');
    return createSupabaseDBClient();
  }
};

// Export singleton instance
export const databaseClient = createDatabaseClient();

// Compatibility export for existing code
export const supabase = databaseClient;
// Environment variable access with fallbacks for different environments
const getEnvVar = (key: string, fallback: string) => {
  // Check for Vite environment variables (client-side)
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env[key] || fallback;
  }
  
  // Check for Node.js environment variables (server-side)
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] || fallback;
  }
  
  // Fallback to default values
  return fallback;
};

// Database connection configuration
export type DatabaseType = 'supabase' | 'local-postgres';

// Detect database type based on environment variables
export const getDatabaseType = (): DatabaseType => {
  const localDbUrl = getEnvVar('VITE_DATABASE_URL', '');
  const supabaseUrl = getEnvVar('VITE_SUPABASE_URL', '');
  
  if (localDbUrl) {
    return 'local-postgres';
  } else if (supabaseUrl) {
    return 'supabase';
  }
  
  // Default to Supabase for backward compatibility
  return 'supabase';
};

export const databaseType = getDatabaseType();

// Supabase configuration
const defaultProjectId = "qtaqcdvohcfkikvvyscu";
const defaultAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0YXFjZHZvaGNma2lrdnZ5c2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2NzEyNjIsImV4cCI6MjA3MzI0NzI2Mn0.asF5VGDXhe2FqXLlmk_iURFv0Xqc4MSzKEW4-pbzCoI";

export const supabaseUrl = getEnvVar('VITE_SUPABASE_URL', `https://${defaultProjectId}.supabase.co`);
export const projectId = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
export const publicAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY', defaultAnonKey);
export const serviceRoleKey = getEnvVar('VITE_SUPABASE_SERVICE_ROLE_KEY', '');

// Local PostgreSQL configuration
export const localDatabaseUrl = getEnvVar('VITE_DATABASE_URL', '');
export const localDatabaseHost = getEnvVar('VITE_DATABASE_HOST', 'localhost');
export const localDatabasePort = getEnvVar('VITE_DATABASE_PORT', '5432');
export const localDatabaseName = getEnvVar('VITE_DATABASE_NAME', 'dnd_app');
export const localDatabaseUser = getEnvVar('VITE_DATABASE_USER', 'postgres');
export const localDatabasePassword = getEnvVar('VITE_DATABASE_PASSWORD', '');

// Database configuration object
export const databaseConfig = {
  type: databaseType,
  supabase: {
    url: supabaseUrl,
    anonKey: publicAnonKey,
    serviceRoleKey: serviceRoleKey,
    projectId: projectId
  },
  postgres: {
    url: localDatabaseUrl,
    host: localDatabaseHost,
    port: parseInt(localDatabasePort),
    database: localDatabaseName,
    user: localDatabaseUser,
    password: localDatabasePassword
  }
};

// Log database configuration for debugging
if (typeof console !== 'undefined') {
  console.log(`[Database] Using ${databaseType} database`);
  if (databaseType === 'local-postgres') {
    console.log(`[Database] PostgreSQL: ${localDatabaseHost}:${localDatabasePort}/${localDatabaseName}`);
  } else {
    console.log(`[Database] Supabase: ${projectId}.supabase.co`);
  }
}
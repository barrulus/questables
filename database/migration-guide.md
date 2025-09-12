# Migration Guide: From Make Environment to Live Deployment

This guide covers transitioning your D&D 5e web app from the Make prototyping environment to a live Supabase deployment.

## Overview

**Current State (Make Environment):**
- Key-Value store with JSON documents
- Single `kv_store_eb20c46f` table
- Limited to prototype functionality

**Target State (Live Deployment):**
- Proper PostgreSQL relational database
- Full Supabase features (Auth, Storage, Edge Functions)
- Production-ready with RLS security

## Step 1: Set Up Live Supabase Project

### 1.1 Create Supabase Project
1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Choose your region and database password
4. Wait for project initialization

### 1.2 Configure Authentication
1. In Supabase Dashboard → Authentication → Settings
2. Configure your site URL (your production domain)
3. Set up OAuth providers if needed (Google, GitHub, etc.)
4. Configure email templates

### 1.3 Set Up Storage
1. In Supabase Dashboard → Storage
2. Create buckets for your app:
   ```sql
   -- Character avatars
   INSERT INTO storage.buckets (id, name, public) VALUES ('character-avatars', 'character-avatars', true);
   
   -- User avatars  
   INSERT INTO storage.buckets (id, name, public) VALUES ('user-avatars', 'user-avatars', true);
   
   -- Campaign assets
   INSERT INTO storage.buckets (id, name, public) VALUES ('campaign-assets', 'campaign-assets', false);
   
   -- World maps
   INSERT INTO storage.buckets (id, name, public) VALUES ('world-maps', 'world-maps', false);
   
   -- Encounter maps
   INSERT INTO storage.buckets (id, name, public) VALUES ('encounter-maps', 'encounter-maps', false);
   ```

## Step 2: Deploy Database Schema

### 2.1 Run Database Migrations
1. In Supabase Dashboard → SQL Editor
2. Copy and paste the entire contents of `/database/schema.sql`
3. Execute the script
4. Verify all tables were created successfully

### 2.2 Set Up Storage Policies
```sql
-- Character avatars (public read, user can upload their own)
CREATE POLICY "Public character avatars" ON storage.objects
FOR SELECT USING (bucket_id = 'character-avatars');

CREATE POLICY "Users can upload character avatars" ON storage.objects
FOR INSERT WITH CHECK (
    bucket_id = 'character-avatars' 
    AND auth.uid()::text = (storage.foldername(name))[1]
);

-- User avatars (public read, user can manage their own)
CREATE POLICY "Public user avatars" ON storage.objects
FOR SELECT USING (bucket_id = 'user-avatars');

CREATE POLICY "Users can manage own avatars" ON storage.objects
FOR ALL USING (
    bucket_id = 'user-avatars' 
    AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Campaign assets (private, campaign participants can access)
CREATE POLICY "Campaign participants can access assets" ON storage.objects
FOR ALL USING (
    bucket_id = 'campaign-assets' 
    AND EXISTS (
        SELECT 1 FROM campaigns c 
        WHERE c.id::text = (storage.foldername(name))[1]
        AND (
            c.dm_user_id = auth.uid() 
            OR EXISTS (
                SELECT 1 FROM campaign_players cp 
                WHERE cp.campaign_id = c.id AND cp.user_id = auth.uid()
            )
        )
    )
);
```

## Step 3: Update Frontend Code

### 3.1 Replace Data Helpers
Replace the Make environment data helpers with proper Supabase client calls:

```typescript
// utils/supabase/client.ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

### 3.2 Update Environment Variables
Create `.env.local` file:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3.3 Update Data Helpers
Replace KV store calls with Supabase queries. For example:

**Before (Make Environment):**
```typescript
const character = await kv.get(`character:${userId}:${characterId}`);
```

**After (Live Deployment):**
```typescript
const { data: character } = await supabase
  .from('characters')
  .select('*')
  .eq('id', characterId)
  .eq('user_id', userId)
  .single();
```

## Step 4: Data Migration

### 4.1 Export Data from Make Environment
Create a migration script to export your prototype data:

```typescript
// scripts/export-make-data.ts
import * as kv from '../utils/supabase/kv_store';

async function exportData() {
  const data = {
    users: await kv.getByPrefix('user:'),
    characters: await kv.getByPrefix('character:'),
    campaigns: await kv.getByPrefix('campaign:'),
    // ... export other data types
  };
  
  console.log(JSON.stringify(data, null, 2));
}

exportData();
```

### 4.2 Transform and Import Data
Create a script to transform KV data to SQL format:

```typescript
// scripts/import-to-supabase.ts
import { supabase } from '../utils/supabase/client';

async function importData(exportedData: any) {
  // Transform and insert users
  for (const [key, user] of Object.entries(exportedData.users)) {
    await supabase.from('user_profiles').insert({
      id: user.id,
      username: user.username,
      role: user.role,
      // ... other fields
    });
  }
  
  // Transform and insert characters
  for (const [key, character] of Object.entries(exportedData.characters)) {
    await supabase.from('characters').insert({
      id: character.id,
      user_id: character.userId,
      name: character.name,
      // ... transform other fields
    });
  }
  
  // Continue for other data types...
}
```

## Step 5: Deploy Edge Functions

### 5.1 Set Up Supabase CLI
```bash
npm install -g supabase
supabase login
supabase init
```

### 5.2 Create Edge Functions
```bash
supabase functions new dice-roller
supabase functions new chat-handler
supabase functions new map-processor
```

### 5.3 Deploy Functions
```bash
supabase functions deploy --project-ref your-project-ref
```

## Step 6: Update Authentication Flow

### 6.1 Replace Mock Authentication
Update your login/register components to use real Supabase Auth:

```typescript
// Login
const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password,
});

// Register
const { data, error } = await supabase.auth.signUp({
  email,
  password,
  options: {
    data: {
      username: username,
    }
  }
});

// Get current user
const { data: { user } } = await supabase.auth.getUser();
```

### 6.2 Set Up Auth State Management
```typescript
// contexts/AuthContext.tsx
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase/client';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
```

## Step 7: Production Deployment

### 7.1 Choose Hosting Platform
- **Vercel** (recommended for Next.js)
- **Netlify** 
- **AWS Amplify**
- **Self-hosted**

### 7.2 Configure Environment Variables
Set up environment variables in your hosting platform:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### 7.3 Set Up Custom Domain
1. Configure DNS records
2. Set up SSL certificate
3. Update Supabase Auth settings with new domain

### 7.4 Configure Supabase for Production
1. Update Site URL in Supabase Auth settings
2. Configure redirect URLs
3. Set up webhook endpoints if needed
4. Configure CORS policies

## Step 8: Testing and Monitoring

### 8.1 Set Up Error Monitoring
- **Sentry** for error tracking
- **LogRocket** for session replay
- **Supabase Dashboard** for database monitoring

### 8.2 Performance Monitoring
- **Vercel Analytics** if using Vercel
- **Google Analytics** for user analytics
- **Supabase Dashboard** for database performance

### 8.3 Backup Strategy
- Supabase provides automatic backups
- Consider setting up additional backup scripts for critical data
- Test restore procedures

## Step 9: Post-Launch Tasks

### 9.1 Security Audit
- Review RLS policies
- Test authentication flows
- Verify API endpoint security
- Check for exposed sensitive data

### 9.2 Performance Optimization
- Add database indexes based on usage patterns
- Optimize image loading and caching
- Set up CDN for static assets
- Enable Supabase connection pooling

### 9.3 User Migration (if applicable)
If you have existing users from prototype:
1. Export user data from Make environment
2. Send migration instructions to users
3. Provide data import tools
4. Set up user support channels

## Common Issues and Solutions

### Issue: RLS Policies Too Restrictive
**Solution:** Test policies thoroughly and use the Supabase policy simulator

### Issue: Large Data Migration
**Solution:** Use batch processing and consider incremental migration

### Issue: Authentication Redirect Loops
**Solution:** Verify Site URL and redirect URL configurations

### Issue: Performance Problems
**Solution:** Add appropriate database indexes and optimize queries

### Issue: Storage Access Denied
**Solution:** Review and test storage policies carefully

## Checklist for Go-Live

- [ ] Database schema deployed and tested
- [ ] Authentication working correctly
- [ ] Data migrated successfully
- [ ] Edge functions deployed
- [ ] Environment variables configured
- [ ] Custom domain set up
- [ ] SSL certificate active
- [ ] Error monitoring configured
- [ ] Performance monitoring set up
- [ ] Backup strategy implemented
- [ ] Security audit completed
- [ ] Load testing performed
- [ ] User documentation updated
- [ ] Support channels established

## Next Steps After Launch

1. **Monitor Performance**: Keep an eye on database performance and user feedback
2. **Gather User Feedback**: Set up feedback channels and iterate based on user needs
3. **Plan Feature Roadmap**: Continue development based on usage patterns
4. **Scale Infrastructure**: Monitor usage and scale Supabase resources as needed
5. **Community Building**: Engage with your D&D community and gather feature requests

---

This migration transforms your prototype into a production-ready D&D 5e web application with proper database structure, authentication, and scalability for real campaigns and players.
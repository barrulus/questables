# Database Setup Guide

This guide covers the complete setup process for the PostgreSQL database integration with Questables D&D application.

## Prerequisites

- Node.js 18+ and npm/pnpm
- PostgreSQL 17+ with PostGIS extension
- Git

## Environment Setup

### 1. Database Environment Variables

Create a `.env.local` file in your project root (this will be ignored by git):

```bash
# Database Configuration (Production - use for PostgreSQL)
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=dnd_app
DATABASE_USER=your_username
DATABASE_PASSWORD=your_password
DATABASE_SSL=false

# Alternative: PostgreSQL environment variables
PGHOST=localhost
PGPORT=5432
PGDATABASE=dnd_app
PGUSER=your_username
PGPASSWORD=your_password

# Server Configuration
DATABASE_SERVER_PORT=3001
FRONTEND_URL=http://localhost:3000

# Optional: Enable debug logging
DEBUG=true
```

### 2. PostgreSQL Database Setup

#### Local PostgreSQL Installation

**macOS (using Homebrew):**
```bash
brew install postgresql postgis
brew services start postgresql
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib postgis postgresql-17-postgis-3
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

#### Database Creation

1. **Connect to PostgreSQL:**
```bash
sudo -u postgres psql
# OR if using your user
psql -U your_username -h localhost
```

2. **Create Database and User:**
```sql
CREATE DATABASE dnd_app;
CREATE USER your_username WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE dnd_app TO your_username;
```

3. **Enable PostGIS Extension:**
```sql
\c dnd_app
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

4. **Import Schema:**
```bash
psql -U your_username -d dnd_app -f database/schema.sql
```

## Development Setup

### 1. Install Dependencies

```bash
npm install
# OR
pnpm install
```

### 2. Start Database Server

The database server handles all PostgreSQL connections:

```bash
npm run db:server
# OR
node server/database-server.js
```

The server will start on `http://localhost:3001` (or your configured port).

### 3. Start Frontend Development Server

In a separate terminal:

```bash
npm run dev
# OR
pnpm dev
```

The frontend will start on `http://localhost:3000`.

## Database Schema Overview

The application uses a comprehensive PostgreSQL schema with the following key features:

### Core Tables
- **users**: User authentication and profiles
- **characters**: D&D character data with JSONB fields for flexibility
- **campaigns**: Campaign management and settings
- **campaign_players**: Many-to-many relationship for campaign membership (with live map coordinates)
- **campaign_player_locations**: Historical position trail for player tokens
- **chat_messages**: Real-time chat with character-based messaging
- **sessions**: Campaign session tracking
- **locations**: Geographic data with PostGIS integration
- **npcs**: Non-player characters with relationships
- **encounters**: Combat encounters and tracking

### Key Features
- **UUID Primary Keys**: All tables use UUID for better distributed system support
- **JSONB Fields**: Flexible storage for D&D-specific data (abilities, inventory, spellcasting)
- **PostGIS Integration**: Spatial data support for maps, locations, and player tokens
- **Player Token Telemetry**: Current and historical player positions persisted in PostGIS with automatic auditing
- **Field Mapping**: Automatic conversion between snake_case (database) and camelCase (frontend)

## API Endpoints

The database server provides RESTful endpoints:

### Health Check
- `GET /api/health` - Database connection status and metrics

### Characters
- `GET /api/characters` - List user's characters
- `GET /api/characters/:id` - Get specific character
- `POST /api/characters` - Create new character
- `PUT /api/characters/:id` - Update character
- `DELETE /api/characters/:id` - Delete character

### Campaigns
- `GET /api/campaigns` - List user's campaigns
- `GET /api/campaigns/:id` - Get specific campaign
- `POST /api/campaigns` - Create new campaign
- `PUT /api/campaigns/:id` - Update campaign
- `DELETE /api/campaigns/:id` - Delete campaign
- `POST /api/campaigns/:id/join` - Join campaign
- `POST /api/campaigns/:id/leave` - Leave campaign

### Chat Messages
- `GET /api/campaigns/:id/messages` - Get campaign messages
- `GET /api/campaigns/:id/messages/recent` - Get recent messages (polling)
- `POST /api/campaigns/:id/messages` - Send message
- `DELETE /api/campaigns/:campaignId/messages/:messageId` - Delete message

### Users
- `GET /api/users/profile` - Get current user profile
- `PUT /api/users/profile` - Update user profile

## Troubleshooting

### Common Issues

**1. Database Connection Failed**
- Check PostgreSQL is running: `pg_isready -h localhost -p 5432`
- Verify credentials in `.env.local`
- Check database exists: `psql -l`

**2. PostGIS Extension Error**
```sql
-- Connect to database and enable extensions
\c dnd_app
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

**3. Schema Import Errors**
- Ensure database is empty before importing
- Check file permissions on `database/schema.sql`
- Import with: `psql -U username -d dnd_app -f database/schema.sql`

**4. Port Conflicts**
- Database server port (default 3001) must be free
- PostgreSQL port (default 5432) must be accessible
- Frontend port (default 3000) must be free

### Health Monitoring

The application includes built-in database health monitoring:

- **Real-time Status**: Connection status displayed in UI
- **Automatic Retry**: Exponential backoff for reconnection
- **Graceful Degradation**: Offline mode when database unavailable
- **Performance Metrics**: Latency and connection pool monitoring

### Development Tips

1. **Enable Debug Logging**: Set `DEBUG=true` in `.env.local`
2. **Monitor Health**: Check `/api/health` endpoint for diagnostics
3. **Use Database Tools**: pgAdmin, DBeaver, or psql for direct database access
4. **Schema Changes**: Update `database/schema.sql` and re-import for changes

## Production Deployment

For production deployment:

1. **Environment Variables**: Use production database credentials
2. **SSL**: Enable `DATABASE_SSL=true` for remote connections
3. **Connection Pooling**: Database server uses connection pooling (max 20 connections)
4. **Health Monitoring**: Set up monitoring for `/api/health` endpoint
5. **Backup Strategy**: Implement regular PostgreSQL backups

## Security Considerations

- Never commit `.env.local` files
- Use strong database passwords
- Enable SSL for remote connections
- Implement proper user authentication
- Regular security updates for PostgreSQL
- Monitor connection pool usage
- Use environment variables for all secrets
#!/bin/bash

# Remove legacy Supabase directories and files
echo "Removing legacy Supabase code..."

# Remove Supabase functions directory
rm -rf ./supabase/

# Remove legacy Supabase utilities directory  
rm -rf ./utils/supabase/

# Clean up any remaining references
echo "Supabase cleanup completed. The following directories have been removed:"
echo "- /supabase/functions/server/"
echo "- /utils/supabase/"
echo ""
echo "Current active backend:"
echo "- Express.js server: /server/database-server.js (port 3001)"
echo "- Database utilities: /utils/database/"
echo "- PostgreSQL 17 with PostGIS"
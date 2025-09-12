# D&D 5e Web App Development Guidelines

## General Development Guidelines

* Use TypeScript for all components and maintain strict type safety
* Implement responsive design with flexbox and grid layouts by default
* Keep components modular and create helper functions in separate files
* Follow the existing icon-based sidebar design pattern
* Use the established resizable panel system for layout management
* Maintain clean, readable code with proper error handling

## Architecture Overview

This is a comprehensive D&D 5e web application with three main architectural layers:

### 1. **Frontend (React + TypeScript)**
- **Main Entry**: `/App.tsx` with role-based dashboards (Player, DM, Admin)
- **Game Interface**: Icon sidebar with expandable panels and integrated mapping
- **UI Components**: ShadCN/UI component library with custom D&D-specific components

### 2. **Backend (Supabase + PostGIS)**
- **Database**: PostgreSQL with PostGIS spatial extensions
- **Functions**: Spatial query functions for map data and location services
- **Auth**: Role-based authentication with player/DM/admin permissions

### 3. **Mapping System (OpenLayers + PostGIS)**
- **Engine**: OpenLayers for professional mapping capabilities
- **Data Source**: Azgaar's Fantasy Map Generator (FMG) geoJSON exports
- **Integration**: Real-time spatial queries with PostGIS backend

---

## Mapping System Guidelines

### Map Component Usage

**Primary Component**: `EnhancedOpenLayersMap`
- Use this component for all mapping needs in the game interface
- Automatically handles world vs encounter map modes
- Integrates with PostGIS spatial database

**Data Loading**: `MapDataLoader`
- Handles all spatial data queries to PostGIS database
- Provides fallback to mock data for development
- Implements zoom-based data loading for performance

### Map Data Types

The application supports these spatial data types from Azgaar's FMG:

1. **Burgs** (Cities/Towns)
   - Population, capital status, trade ports
   - Cultural and religious affiliations
   - Spatial point geometries

2. **Routes** (Roads/Paths)  
   - Highway, road, and path classifications
   - Line geometries connecting settlements
   - Travel time calculations

3. **Rivers** (Waterways)
   - Discharge rates, width, and length data
   - Line geometries for navigation
   - Bridge and ford locations

4. **Cells** (Terrain/Biomes)
   - Biome classifications (forest, desert, mountain, etc.)
   - Population density and political control
   - Polygon geometries for area coverage

5. **Markers** (Custom Points)
   - User-defined locations and notes
   - Campaign-specific markers
   - Point geometries with metadata

### PostGIS Integration

**Database Schema**: Located in `/database/schema.sql`
- Full Azgaar's FMG data structure with spatial indexes
- Campaign location linking to world positions
- Spatial query functions for gameplay mechanics

**Key Spatial Functions**:
- `get_burgs_near_point(lat, lng, radius_km)` - Find nearby cities
- `get_routes_between_points(start_lat, start_lng, end_lat, end_lng)` - Route finding
- `get_cell_at_point(lat, lng)` - Terrain lookup
- `calculate_travel_distance(start, end)` - Distance calculations

---

## UI/UX Design Guidelines

### Layout Patterns

**Icon Sidebar Design**:
- Left sidebar with tool icons
- Tools expand into center panel when activated
- Map always visible on the right side
- Resizable panel system for user customization

**Panel Management**:
- Only one expandable panel active at a time
- Smooth transitions between tools
- Maintain map visibility during tool usage

### Component Hierarchy

**Game Interface Structure**:
```
App.tsx
├── IconSidebar (tools)
├── ExpandablePanel (active tool)
├── EnhancedOpenLayersMap (main map)
└── ChatPanel (communication)
```

**Tool Panels**:
- Character Sheet & Stats
- Inventory Management  
- Spellbook & Abilities
- Combat Tracker
- Exploration Tools
- Campaign Journal

### Map Interface Guidelines

**Map Controls**:
- Zoom controls in top-right corner
- Tool selection (Pan, Pin, Measure, Info) in header
- Layer visibility toggles for different data types
- World map selector for multiple campaign worlds

**Map Interactions**:
- **Pan Tool**: Default mode for map navigation
- **Pin Tool**: Click to place custom campaign markers
- **Info Tool**: Click features to view detailed PostGIS data
- **Measure Tool**: Calculate distances for travel planning

**Performance Optimization**:
- Load data based on current viewport bounds
- Zoom-based layer visibility (cities at zoom 3+, terrain at zoom 10+)
- Lazy loading for large datasets (terrain cells)
- Vector tile rendering for smooth performance

---

## Development Environment

### Database Configuration Options

The app supports two database backends:

#### **Option 1: Supabase (Cloud)**
- **Pros**: Managed service, built-in auth, real-time subscriptions, file storage
- **Setup**: Create Supabase project, set environment variables
- **Best for**: Quick prototyping, production with managed infrastructure

#### **Option 2: Local PostgreSQL**
- **Pros**: Full control, no external dependencies, custom extensions
- **Setup**: Install PostgreSQL + PostGIS, run setup scripts
- **Best for**: Development, self-hosted production, data privacy requirements

### Local Development Setup

**Automatic Database Detection**:
- If `VITE_DATABASE_URL` is set, uses local PostgreSQL
- Otherwise falls back to Supabase configuration
- Console logging indicates which database type is active

**Mock Data Fallback**: 
- When neither database is available, components use mock data
- Development-friendly with sample Middle Earth and Faerûn maps
- Console warnings indicate fallback vs real database usage

**Environment Configuration**:
- Database type auto-detected from environment variables
- Unified database client handles both Supabase and PostgreSQL
- Error-resilient data loading with graceful degradation

### Local PostgreSQL Setup

**Requirements**:
- PostgreSQL 13+ with PostGIS extension
- Node.js for the database server middleware
- Database setup scripts handle schema creation

**Quick Start**:
```bash
# Set up local PostgreSQL database
npm run db:setup

# Start both frontend and database server
npm run dev:local
```

**Database Server**:
- Express.js middleware at `:3001` handles PostgreSQL queries
- Spatial function endpoints for PostGIS operations  
- Basic authentication endpoints (extensible)

### Production Deployment

**Supabase Production**:
- Managed PostgreSQL with PostGIS enabled
- Built-in authentication and file storage
- Real-time subscriptions and edge functions

**Self-Hosted PostgreSQL**:
- PostgreSQL server with PostGIS extension
- Database server application for API layer
- Custom authentication implementation
- Docker support for containerized deployment

**Common Requirements**:
- Spatial indexes on all geometry columns
- Custom spatial functions deployed
- Azgaar's FMG data imported and indexed
- Backup and monitoring solutions

**Map Tile Configuration**:
- Support for multiple tile providers (OSM, Satellite, Terrain)
- Custom tile sets can be configured in database
- Attribution handling for map data sources

---

## Campaign Management Integration

### World Map Integration

**Azgaar's FMG Workflow**:
1. Export world data as geoJSON from Azgaar's Fantasy Map Generator
2. Import into PostGIS using provided migration scripts
3. Configure world bounds and tile sets in admin dashboard
4. World becomes available for campaign selection

**Campaign Location Linking**:
- Campaign locations can be linked to world map positions
- Spatial queries find nearby settlements and terrain
- Automatic distance calculations for travel mechanics
- Integration with exploration and travel tools

### Multi-Campaign Support

**World Map Selection**:
- Multiple fantasy worlds can be imported and managed
- Campaign-specific world map assignment
- Shared world maps across multiple campaigns
- World map versioning and updates

---

## File Organization

### Map-Related Components
- `/components/enhanced-openlayers-map.tsx` - Main map component
- `/components/map-data-loader.tsx` - PostGIS data integration
- `/components/openlayers-map.tsx` - Basic map implementation
- `/components/enhanced-map.tsx` - Legacy Leaflet component (deprecated)

### Database Integration
- `/utils/supabase/production-helpers.tsx` - Database client and helpers
- `/utils/supabase/data-structures.tsx` - TypeScript interfaces
- `/database/schema.sql` - PostGIS database schema
- `/supabase/functions/server/` - Edge functions for spatial queries

### Styling
- `/styles/globals.css` - OpenLayers CSS integration and custom styles
- Uses Tailwind V4 with custom design tokens
- Dark/light mode support throughout application

---

## Design System Guidelines

### Typography
- Base font-size: 16px (defined in CSS custom properties)
- Font weights: normal (400) and medium (500)
- Consistent heading hierarchy with proper semantic markup
- No manual font styling classes unless specifically overriding defaults

### Color System
- Use CSS custom properties for all colors
- Support for both light and dark themes
- Consistent color palette across all components
- High contrast ratios for accessibility

### Component Guidelines

#### Buttons
- Use ShadCN/UI button component with variants (default, outline, ghost)
- Icon buttons should be 32x32px (h-8 w-8) for toolbar usage
- Include proper ARIA labels and tooltips for accessibility

#### Cards
- Use for grouping related content and controls
- Consistent padding and border radius from design tokens
- Proper elevation with box shadows

#### Resizable Panels
- Default sizes: 60% main content, 40% sidebar when panel is open
- Minimum sizes: 40% main content, 25% sidebar
- Smooth transitions and proper handle styling

### Responsive Design
- Mobile-first approach with progressive enhancement
- Flexible layouts using CSS Grid and Flexbox
- Appropriate touch targets for mobile devices (minimum 44px)
- Collapsible sidebar on smaller screens

---

## Error Handling Guidelines

### Database Connection Errors
- Always provide fallback to mock data for development
- Log warnings when using fallback data vs real errors
- Graceful degradation of features when services unavailable
- User-friendly error messages with recovery suggestions

### Map Loading Errors
- Progressive loading with loading states
- Retry mechanisms for failed tile loads
- Fallback map sources when primary source fails
- Performance monitoring and optimization

### User Input Validation
- Client-side validation with immediate feedback
- Server-side validation for security
- Proper error messages with specific guidance
- Accessible error announcements for screen readers

---

## Performance Guidelines

### Map Performance
- Viewport-based data loading
- Zoom-level appropriate detail levels
- Vector tile optimization for large datasets
- Proper layer management and cleanup

### Code Splitting
- Lazy load non-critical components
- Separate bundles for different user roles
- Progressive loading of tool panels

### Memory Management
- Proper cleanup of OpenLayers resources
- Event listener removal on component unmount
- Efficient state management for large datasets

---

## Accessibility Guidelines

### Keyboard Navigation
- All interactive elements must be keyboard accessible
- Proper tab order throughout the application
- Escape key closes modals and panels
- Arrow key navigation for maps and grids

### Screen Reader Support
- Semantic HTML structure throughout
- Proper ARIA labels and descriptions
- Live regions for dynamic content updates
- Alternative text for all images and icons

### Visual Accessibility
- High contrast color combinations
- Scalable text and UI elements
- No color-only information conveying
- Reduced motion options for animations

---

## Testing Guidelines

### Component Testing
- Unit tests for utility functions
- Component testing with realistic data
- Integration tests for database operations
- Mock implementations for external services

### Map Testing
- Test with various zoom levels and viewport sizes
- Verify spatial query accuracy
- Performance testing with large datasets
- Cross-browser compatibility testing

### User Experience Testing
- Role-based workflow testing
- Accessibility compliance verification
- Mobile device testing
- Performance on lower-end devices
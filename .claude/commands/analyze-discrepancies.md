# Discrepancy Analysis

Identify mismatches, inconsistencies, and discrepancies across the codebase.

## Areas to Analyze

### 1. Type vs Database Schema Discrepancies

Compare TypeScript types/interfaces with database schema:
- Read `database/schema.sql` for table definitions
- Find corresponding TypeScript types in the codebase
- Check for:
  - Missing fields (in type but not DB, or vice versa)
  - Type mismatches (string vs number, nullable vs required)
  - Naming inconsistencies (snake_case vs camelCase)
  - Enum value mismatches

### 2. API Documentation vs Implementation

Compare documented API with actual routes:
- Read API documentation files
- Scan server routes for actual endpoints
- Check for:
  - Undocumented endpoints
  - Documented but removed endpoints
  - Parameter mismatches
  - Response format differences

### 3. Frontend vs Backend Types

Compare types used on both sides:
- API response types on server
- Expected response types on client
- Check for:
  - Field name mismatches
  - Optional vs required field differences
  - Date format handling differences

### 4. Test Mocks vs Reality

Compare test fixtures with actual schemas:
- Check mock data shapes match real types
- Verify test assertions align with actual behavior
- Identify stale test data

### 5. Environment Configuration

Compare config files and usage:
- `.env.example` vs actual env usage
- Config defaults vs documentation
- Missing or extra environment variables

### 6. Import/Export Consistency

Check module boundaries:
- Exports that don't match imports
- Re-exports that might be stale
- Circular dependency risks

### 7. Component Props vs Usage

For React components:
- Props interface vs actual prop passing
- Default props vs required props handling
- Children prop expectations

### 8. Route Parameters

Check routing:
- URL parameters defined vs used
- Query parameter handling consistency
- Navigation state expectations

## Output Format

```markdown
# Discrepancy Report

## Critical Discrepancies
[Discrepancies causing bugs or build failures]

## Significant Discrepancies
[Mismatches that could cause runtime issues]

## Minor Discrepancies
[Inconsistencies that affect maintainability]

## Detailed Findings

### Type/Schema Mismatches
| Location | Expected | Actual | Impact |
|----------|----------|--------|--------|
| file:line | Type X | Type Y | Description |

### API Discrepancies
| Endpoint | Documentation | Implementation | Status |
|----------|---------------|----------------|--------|
| GET /api/x | Returns {a,b} | Returns {a,c} | Mismatch |

### Frontend/Backend Mismatches
...

### Other Discrepancies
...

## Recommendations
- Priority fixes
- Alignment strategies
- Prevention measures
```

## Process

1. Build cross-reference maps of related entities
2. Compare systematically across boundaries
3. Flag all differences
4. Assess impact of each discrepancy
5. Prioritize by risk of runtime failure

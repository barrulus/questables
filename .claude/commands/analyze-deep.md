# Deep Code Analysis

Perform an exhaustive analysis of the codebase, examining every aspect for issues, inconsistencies, and opportunities for improvement.

## Phase 1: Infrastructure Health

### Build System
- Run `npm run build` and capture all errors
- Check for any TypeScript strict mode violations
- Identify files with excessive `// @ts-ignore` or `// @ts-expect-error`

### Linting
- Run `npm run lint` and catalog all violations by severity
- Check for disabled lint rules (`eslint-disable` comments)
- Note patterns of rule violations

### Dependencies
- Check for peer dependency warnings
- Identify any deprecated packages
- Look for duplicate dependencies

## Phase 2: Code Completeness

### Search for All Markers
Use grep/search to find ALL instances of:
```
TODO, FIXME, HACK, XXX, BUG, OPTIMIZE, REFACTOR, REVIEW,
NOTE (when actionable), INCOMPLETE, WIP, PLACEHOLDER,
NotImplementedError, throw new Error, "not implemented"
```

### Incomplete Implementations
Search for:
- Empty function bodies `{ }` or `{ }`
- Functions returning only `undefined`, `null`, or placeholder values
- Commented-out code blocks (potential incomplete refactors)
- Stub implementations (`pass`, `noop`, etc.)

### Dead Code Detection
- Unused exports (functions, classes, constants exported but never imported)
- Unreachable code after `return`, `throw`, `break`, `continue`
- Unused variables and parameters (beyond what lint catches)
- Commented-out code that should be removed

## Phase 3: Type Safety Analysis

### TypeScript Issues
- Usage of `any` type - list all occurrences
- Type assertions (`as`) that might hide issues
- Non-null assertions (`!`) that could cause runtime errors
- Missing return types on public functions
- Inconsistent null handling (`null` vs `undefined`)

### Type-Database Alignment
- Compare TypeScript interfaces/types with database schema
- Check that all database columns have corresponding type definitions
- Verify enum values match between code and database
- Check for snake_case/camelCase conversion issues

## Phase 4: API Consistency

### Route Analysis
- List all API endpoints
- Check each endpoint has proper validation
- Verify error handling returns consistent formats
- Check authentication/authorization on protected routes

### Client-Server Contract
- Compare API response types with what frontend expects
- Check for missing fields or extra fields
- Verify query parameter handling

## Phase 5: Error Handling

### Exception Handling
- Identify try/catch blocks with empty or generic catch handlers
- Find async functions without proper error handling
- Check for unhandled promise rejections
- Look for swallowed errors (catch without re-throw or logging)

### User-Facing Errors
- Check error messages are user-friendly
- Verify sensitive information isn't leaked in errors
- Ensure errors are properly logged server-side

## Phase 6: Security Review

### Input Validation
- Check all user inputs are validated
- Look for raw SQL queries (potential injection)
- Check for proper escaping in rendered content (XSS)
- Verify file upload restrictions

### Authentication & Authorization
- Check auth middleware is applied correctly
- Verify permission checks on sensitive operations
- Look for hardcoded credentials or secrets

### Data Handling
- Check sensitive data is properly protected
- Verify proper use of HTTPS/TLS
- Check for proper session handling

## Phase 7: Performance Concerns

### Database Queries
- Look for N+1 query patterns
- Check for missing indexes on frequently queried columns
- Identify potentially slow queries (lack of limits, full table scans)

### Frontend Performance
- Large component re-renders
- Missing memoization on expensive computations
- Inefficient data fetching patterns

## Phase 8: Test Coverage

### Coverage Analysis
- Run `npm run test:coverage` if available
- Identify critical paths without tests
- Check for skipped tests and why

### Test Quality
- Look for tests with no assertions
- Find flaky tests (timing-dependent, order-dependent)
- Check for proper cleanup in tests

## Output Format

Generate a comprehensive report organized by severity and category:

```markdown
# Deep Code Analysis Report
Generated: [timestamp]

## Executive Summary
[High-level overview of codebase health]

## Critical Issues (Must Fix)
[Issues that cause failures or security vulnerabilities]

## High Priority (Should Fix Soon)
[Significant bugs or maintainability concerns]

## Medium Priority (Plan to Address)
[Quality improvements and technical debt]

## Low Priority (Nice to Have)
[Minor improvements and optimizations]

## Metrics
- Total files analyzed: X
- Total issues found: X
- Type safety score: X%
- Test coverage: X%
- TODO/FIXME count: X

## Detailed Findings by Category
[Complete categorized list with file:line references]

## Recommendations
[Prioritized action items]
```

## Execution Notes

- This analysis takes time - run automated checks in parallel where possible
- Use Task agents for parallel exploration of different areas
- Focus on patterns, not just individual issues
- Provide context for why each issue matters

# Code Analysis Agent

Perform a comprehensive code analysis to identify broken code, incomplete items, discrepancies, and work to be done.

## Analysis Scope

Analyze the codebase systematically in the following categories:

### 1. Build & Type Errors
- Run `npm run build` to check for TypeScript compilation errors
- Run `npm run lint` to identify ESLint violations
- Note any type mismatches, missing types, or `any` type usage that should be addressed

### 2. Incomplete Items (Code Markers)
Search for and catalog all instances of:
- `TODO` comments - planned work items
- `FIXME` comments - known bugs or issues
- `HACK` comments - temporary workarounds
- `XXX` comments - attention required
- `BUG` comments - documented bugs
- `OPTIMIZE` comments - performance improvements needed
- `REFACTOR` comments - code that needs restructuring
- `NOTE` comments with actionable items
- Incomplete implementations (empty function bodies, placeholder returns, `throw new Error('Not implemented')`)

### 3. Code Quality Issues
- Functions or components with excessive complexity
- Dead code (unused exports, unreachable code paths)
- Inconsistent patterns (different approaches to similar problems)
- Missing error handling in critical paths
- Hardcoded values that should be configurable
- Console.log statements left in production code

### 4. Test Coverage Gaps
- Run `npm run test:coverage` if available
- Identify untested critical paths
- Note components/functions without corresponding tests
- Check for skipped tests (`.skip`, `xit`, `xdescribe`)

### 5. Documentation Gaps
- Public APIs missing JSDoc comments
- Complex functions lacking explanatory comments
- Outdated comments that don't match code behavior
- README or documentation inconsistencies with actual implementation

### 6. Dependency & Security Issues
- Check for outdated dependencies with potential issues
- Look for deprecated API usage
- Identify potential security vulnerabilities (SQL injection, XSS, etc.)

### 7. Database & API Discrepancies
- Schema mismatches between TypeScript types and database schema
- API endpoints that don't match their documentation
- Missing validation on API inputs
- Inconsistent error response formats

## Output Format

Generate a structured report with the following sections:

```markdown
# Code Analysis Report

## Summary
- Total issues found: [count]
- Critical: [count]
- High Priority: [count]
- Medium Priority: [count]
- Low Priority: [count]

## Critical Issues (Blocking/Breaking)
[List items that prevent build or cause runtime failures]

## High Priority Issues
[List items that significantly impact functionality or maintainability]

## Medium Priority Issues
[List items that should be addressed but aren't urgent]

## Low Priority Issues
[List minor improvements and nice-to-haves]

## Detailed Findings

### Build & Type Errors
[Detailed list with file:line references]

### Incomplete Items
[Categorized TODO/FIXME/etc. with context]

### Code Quality Issues
[Specific issues with recommendations]

### Test Coverage
[Coverage gaps with priority suggestions]

### Documentation Gaps
[Missing or outdated documentation]

### Other Findings
[Any additional observations]
```

## Execution Strategy

1. **Phase 1: Automated Checks**
   - Run build, lint, and test commands
   - Capture all error output

2. **Phase 2: Pattern Search**
   - Search for TODO/FIXME markers across codebase
   - Search for incomplete implementations
   - Search for potential issues (console.log, hardcoded secrets, etc.)

3. **Phase 3: Cross-Reference Analysis**
   - Compare TypeScript types with database schema
   - Check API routes against documentation
   - Verify test coverage of critical paths

4. **Phase 4: Report Generation**
   - Compile findings into structured report
   - Prioritize by severity and impact
   - Include actionable recommendations

## Notes

- Focus on actionable items, not style preferences
- Prioritize issues that affect functionality over cosmetic concerns
- Include file paths and line numbers for all findings
- Group related issues together
- Suggest fixes where straightforward

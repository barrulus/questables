# TODO/FIXME Analysis

Compile a comprehensive list of all work markers in the codebase.

## Search Patterns

Find and categorize all instances of the following markers:

### High Priority
- `FIXME` - Known issues that need fixing
- `BUG` - Documented bugs
- `SECURITY` - Security concerns
- `CRITICAL` - Critical issues

### Medium Priority
- `TODO` - Planned work items
- `HACK` - Temporary workarounds
- `XXX` - Attention required
- `REVIEW` - Needs code review

### Lower Priority
- `OPTIMIZE` - Performance improvements
- `REFACTOR` - Code restructuring
- `CLEANUP` - Code cleanup needed
- `DEPRECATE` - Deprecation work

### Implementation Markers
- `WIP` - Work in progress
- `INCOMPLETE` - Incomplete implementation
- `PLACEHOLDER` - Placeholder code
- `STUB` - Stub implementation

## Output Format

For each marker found, report:
1. File path and line number
2. The marker type
3. The full comment text
4. Surrounding context (function/component name)

Group by:
1. Priority level
2. Category (feature area or component)
3. Age (if git blame available)

```markdown
# Work Items Report

## Summary
- Total items: X
- High priority: X
- Medium priority: X
- Lower priority: X

## High Priority Items

### FIXME (X items)
- `file.ts:123` - [context] Comment text here
- `other.ts:456` - [context] Another fixme

### BUG (X items)
...

## Medium Priority Items
...

## Lower Priority Items
...

## By Feature Area
[Group related items together for easier planning]

## Recommendations
- Suggested sprint items
- Quick wins (items that can be fixed easily)
- Items that should be elevated or de-prioritized
```

## Tips

- Use git blame to identify how old each item is
- Flag very old items that may be stale
- Identify items that might be blocking other work
- Note any items that reference external issues/tickets

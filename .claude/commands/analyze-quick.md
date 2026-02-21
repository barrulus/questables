# Quick Code Analysis

Perform a fast automated analysis to catch immediate issues.

## Steps

1. **Run Build Check**
   ```bash
   npm run build 2>&1
   ```
   Report any TypeScript compilation errors.

2. **Run Lint Check**
   ```bash
   npm run lint 2>&1
   ```
   Report any ESLint violations.

3. **Run Tests** (if they exist and are fast)
   ```bash
   npm test -- --passWithNoTests 2>&1
   ```
   Report any test failures.

4. **Quick TODO/FIXME Scan**
   Search for high-priority markers:
   - `FIXME` - immediate issues
   - `BUG` - known bugs
   - `HACK` - temporary workarounds

## Output

Provide a brief summary:
- Build status (pass/fail with error count)
- Lint status (pass/fail with violation count)
- Test status (pass/fail)
- Critical markers found (count and locations)

Keep output concise - this is meant to be a quick health check.

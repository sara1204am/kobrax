# Prompts & Confirmation Minimization

**Author:** Abel (Preferencia de sesión)
**Applies to:** All files
**Priority:** High

## Overview

Reduce unnecessary confirmation prompts. Only ask when truly ambiguous, destructive, or blocked on requirements.

## When to ASK (Use `ask_user` tool)

1. **Destructive operations** – `prisma migrate reset`, `git reset --hard`, force-push, deletion of code
2. **Scope ambiguity** – "should I implement X or just refactor Y?" → ask
3. **Behavior conflict** – multiple reasonable approaches and no docs decide it
4. **Blocked on user input** – need feature name, module structure, or preference to proceed

## When NOT to ask

- Configuration alignment to documented decisions (just mention it in the response)
- File structure / naming following established patterns
- Dependency additions (just note them, no decision needed)
- Code style, formatting, or patterns already in the codebase
- Approach decisions already established in the `AGENTS.md` files, `.claude/rules/`, or existing codebase patterns
- Authorization phrases for feature work (assuming the user already said "autorizo" or "I authorize")

## Example Behaviors

✅ **Good:** "I'll align `package.json` to match the dependency set the code already imports."
❌ **Bad:** "Should I align `package.json`? Yes or no?"

✅ **Good:** "This refactor requires choosing between Strategy A and B. Which approach do you prefer?"
❌ **Bad:** "Should I add error handling to function X? Yes or no?"

✅ **Good:** "I see this is destructive—confirm: run `prisma migrate reset`?"
❌ **Bad:** "Should I add the auth middleware?"

## Implementation

- Batch related work (plan, execute, validate) before reporting back
- Default to "proceeding as documented" unless you hit a genuine blocker
- When in doubt, *proceed and document* rather than block

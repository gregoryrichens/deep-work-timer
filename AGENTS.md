## Code Review Rules

### Code Quality / The Art of Software Engineering
- Prefer human-readable code over technically correct but esoteric
  syntax. Suggest rewrites when discovered.

### Findings
- Prioritize bugs introduced by this change that affect correctness,
  security, data integrity, or existing user workflows.
- For each finding, explain the triggering conditions and concrete
  impact. Cite the smallest relevant code location.
- Verify claims against surrounding code and callers. State any
  assumptions; avoid speculative findings without a plausible failure path.
- Strictly flag extraneous code comments, especially those that refer to
  documentation and concepts outside of the repository.
- Skip formatting, naming preferences, and optional refactors unless
  they cause a concrete defect.
- Report each underlying issue once.

### Compatibility and security
- Check changes to public interfaces and persisted data for compatibility
  with existing callers and previously saved values.
- Flag newly exposed secrets or sensitive data, missing authorization,
  and unsafe handling of untrusted input.

### Tests
- Identify important changed behavior that existing tests do not cover.
  Describe the failure scenario a regression test should exercise.
- Do not claim tests passed unless they were actually run.
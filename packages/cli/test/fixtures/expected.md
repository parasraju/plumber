# Plumber Health Report: sample
**Score:** 83.2/100 | **Grade:** B | **Issues:** 4

### `ci.yml`
- **L8 [MEDIUM] Unpinned Docker Image (Missing Tag or :latest)**: Pin image to an explicit version tag or SHA256 digest (e.g., node:20.11-alpine).
- **L11 [CRITICAL] Remote Script Piped Directly to Shell (curl | bash)**: Download script first, verify its SHA256 checksum or signature, then execute it.
- **L3 [HIGH] Overly Broad Workflow Write Permissions**: Use least-privilege permissions (e.g., permissions: { contents: read }).
- **L13 [MEDIUM] Unpinned npm Install in CI Without Lockfile Enforcement**: Use npm ci to enforce lockfile versions or pass --save-exact when adding packages.

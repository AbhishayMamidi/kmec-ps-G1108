# Contributing to NeuroSentinel AI

Thank you for your interest in contributing! Here's how to get started.

## Reporting Issues

Use [GitHub Issues](../../issues) to report bugs or request features. Please include:
- A clear description of the problem
- Steps to reproduce (for bugs)
- Expected vs. actual behavior

## Development Workflow

1. **Fork** the repository and clone your fork.
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```
3. **Make your changes.** Follow the conventions below.
4. **Run tests** before opening a PR:
   ```bash
   # Backend
   cd neurosentinel-backend && pytest tests/ -v

   # Frontend lint
   cd neurosentinel && npm run lint
   ```
5. **Open a Pull Request** against `main` with a clear description.

## Code Conventions

### Python (Backend)
- Follow PEP 8; use type hints throughout.
- Keep functions focused and documented with docstrings.
- Add or update tests in `neurosentinel-backend/tests/` for any logic changes.

### TypeScript (Frontend)
- Use strict TypeScript — no `any` unless unavoidable.
- Follow the existing file/folder structure under `app/`.
- Components go in `app/components/` (shared) or `app/<page>/_components/` (page-local).

## What NOT to Commit

- `.env`, `.env.local`, or any file with real credentials.
- Model weight files (`.pt`, `.pth`, `.bin`, etc.) — store in cloud storage.
- Large binary files or auto-generated artifacts.
- Dev/scratch scripts — these belong in your local workspace only.

## Questions

Open a [Discussion](../../discussions) or reach out via GitHub Issues.

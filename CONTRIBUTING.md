# Contributing to ReadMeABook

Thank you for your interest in contributing to ReadMeABook! This document provides guidelines and instructions for contributing to the project.

---

## 🤝 How to Contribute

### Reporting Issues

If you encounter a bug or have a feature request:

1. **Check existing issues** - Search [GitHub Issues](https://github.com/kikootwo/ReadMeABook/issues) to see if it's already reported
2. **Create a new issue** - Use the appropriate issue template
3. **Provide details** - Include:
   - Clear description of the problem/feature
   - Steps to reproduce (for bugs)
   - Expected vs actual behavior
   - Environment details (OS, Docker version, etc.)
   - Relevant logs or screenshots

### Submitting Pull Requests

1. **Fork the repository**
2. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** following our coding standards
4. **Test your changes** thoroughly
5. **Commit with clear messages**:
   ```bash
   git commit -m "Add: brief description of changes"
   ```
6. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```
7. **Open a Pull Request** with:
   - Clear title and description
   - Reference to related issues
   - Screenshots/demos if applicable

---

## 🏗️ Development Setup

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Git

### Local Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/kikootwo/ReadMeABook.git
   cd ReadMeABook
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your local configuration
   ```

4. **Start development stack:**
   ```bash
   # Using Docker Compose (recommended)
   docker compose -f docker-compose.local.yml up -d

   # Or run services separately
   docker compose -f docker-compose.debug.yml up -d postgres redis
   npm run dev
   ```

5. **Run database migrations:**
   ```bash
   npm run prisma:generate
   npm run db:push
   ```

6. **Access the app:**
   - App: http://localhost:3030
   - Prisma Studio: `npm run prisma:studio`

---

## 📝 Coding Standards

### General Guidelines

- **Follow existing code style** - Use the project's ESLint configuration
- **Write clear, descriptive variable names**
- **Add comments for complex logic**
- **Keep functions small and focused**
- **Test your changes**

### TypeScript

- Use TypeScript for all new code
- Define proper types (avoid `any`)
- Use interfaces for object shapes
- Export types when they're reusable

### React Components

- Use functional components with hooks
- Keep components focused and reusable
- Use proper TypeScript props typing
- Follow the existing component structure in `src/components/`

### File Organization

- **Max 300-400 lines per file** - Refactor if larger
- **Add file headers** to reference documentation:
  ```typescript
  /**
   * Component: Feature Name
   * Documentation: documentation/path/to/doc.md
   */
  ```

### Database Changes

- Always use Prisma migrations
- Test migrations with seed data
- Document schema changes in pull request

---

## 📚 Documentation

### Updating Documentation

When making changes that affect documentation:

1. **Update relevant docs** in `documentation/`
2. **Use token-efficient format** (see [CLAUDE.md](CLAUDE.md))
3. **Update TABLEOFCONTENTS.md** if adding new docs
4. **Keep docs in sync** with code changes

### Documentation Standards

- Use bullet points over prose
- Include code examples where helpful
- Keep status indicators updated (✅/⏳/❌)
- Link to related documentation

---

## 🧪 Testing

### Before Submitting

- Test locally with Docker Compose
- Verify no console errors
- Test with clean database (migrations)
- Check responsive design (if UI changes)
- Verify all features still work

### Manual Testing Checklist

- [ ] Login with Plex works
- [ ] Library scan completes
- [ ] Book requests can be created
- [ ] Settings can be updated
- [ ] Background jobs run correctly

---

## 🔍 Code Review Process

### What We Look For

- **Functionality** - Does it work as intended?
- **Code quality** - Is it clean and maintainable?
- **Testing** - Has it been adequately tested?
- **Documentation** - Are docs updated?
- **Breaking changes** - Are they necessary and documented?

### Review Timeline

- Initial review: Within 1-2 weeks
- Follow-up on feedback: Ongoing
- Merge: When approved and CI passes

---

## 🚀 Release Process

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

### Release Cycle

- Releases are tagged as needed
- Docker images automatically built on push to `main`
- Breaking changes documented in release notes

---

## 💡 Development Tips

### Working with Prisma

```bash
# Generate Prisma client after schema changes
npm run prisma:generate

# Push schema changes to database
npm run db:push

# Open Prisma Studio
npm run prisma:studio
```

### Working with Docker

```bash
# Build local image
docker compose -f docker-compose.local.yml build

# View logs
docker compose -f docker-compose.local.yml logs -f

# Reset database
docker compose -f docker-compose.local.yml down -v
```

### Debugging

- Use `LOG_LEVEL=debug` in environment
- Check browser console for frontend issues
- Use Prisma Studio to inspect database
- Check Docker logs for backend issues

---

## 📋 Commit Message Guidelines

### Format

```
<type>: <subject>

<body>

<footer>
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting)
- **refactor**: Code refactoring
- **test**: Adding/updating tests
- **chore**: Maintenance tasks

### Examples

```
feat: Add support for multiple audiobook formats

Implements support for M4A, M4B, and FLAC formats in addition to MP3.

Closes #123
```

```
fix: Resolve Plex authentication timeout issue

Increases timeout and adds retry logic for slow Plex servers.

Fixes #456
```

---

## 🎯 Areas We Need Help

- [ ] Additional audiobook format support
- [ ] Enhanced torrent ranking algorithm
- [ ] Mobile UI improvements
- [ ] Internationalization (i18n)
- [ ] Additional integration options
- [ ] Performance optimization
- [ ] Test coverage
- [ ] Documentation improvements

---

## 💬 Community

- **Discussions**: [GitHub Discussions](https://github.com/kikootwo/ReadMeABook/discussions)
- **Issues**: [GitHub Issues](https://github.com/kikootwo/ReadMeABook/issues)

---

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

## 🙏 Thank You

Every contribution, no matter how small, makes ReadMeABook better. Thank you for taking the time to contribute!

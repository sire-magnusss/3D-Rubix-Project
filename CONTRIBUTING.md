# Contributing to NeuralCube

Thank you for your interest in contributing to NeuralCube! 🎲✨

This document provides guidelines and instructions for contributing to this project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Project Structure](#project-structure)
- [Areas for Contribution](#areas-for-contribution)

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers and help them get started
- Focus on constructive feedback
- Celebrate diverse perspectives and ideas

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/3D-Rubix-Project.git
   cd 3D-Rubix-Project
   ```
3. **Set up the upstream remote**:
   ```bash
   git remote add upstream https://github.com/sire-magnusss/3D-Rubix-Project.git
   ```
4. **Create a branch** for your feature/fix:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

## Development Workflow

1. **Keep your fork updated**:
   ```bash
   git fetch upstream
   git checkout main
   git merge upstream/main
   ```

2. **Make your changes** on your feature branch

3. **Test your changes**:
   - Start a local server: `python3 -m http.server 8080` or `npx http-server -p 8080`
   - Test in multiple browsers if possible
   - Verify animations work smoothly
   - Check that the solver still functions correctly

4. **Commit your changes**:
   ```bash
   git add .
   git commit -m "Description of your changes"
   ```

5. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request** on GitHub

## Pull Request Process

### Before Submitting

- [ ] Code follows the project's coding standards
- [ ] Changes are tested and working
- [ ] No console errors or warnings
- [ ] Code is commented where necessary
- [ ] PR description is clear and detailed

### PR Title Format

Use one of these prefixes:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

Examples:
- `feat: Add move notation display`
- `fix: Resolve visual alignment bug at medium speed`
- `perf: Optimize cube state encoding`

### PR Description Template

When opening a PR, please include:

1. **What changes were made?**
   - Clear description of the feature/fix

2. **Why were these changes made?**
   - Problem being solved
   - Motivation for the change

3. **How was it tested?**
   - Steps to reproduce/test
   - Browser(s) tested in
   - Any edge cases considered

4. **Screenshots/GIFs** (if applicable)
   - Visual changes should include before/after

5. **Breaking Changes** (if any)
   - List any breaking changes

### Review Process

- Maintainers will review your PR
- Address any feedback or requested changes
- Be open to suggestions and improvements
- PRs may be requested to be rebased if conflicts arise

## Coding Standards

### JavaScript

- Use modern ES6+ syntax
- Follow existing code style and patterns
- Use meaningful variable and function names
- Comment complex logic
- Keep functions focused and single-purpose
- Use `const` and `let` (avoid `var`)

### CSS

- Follow existing naming conventions
- Use CSS variables for colors/theming
- Keep styles organized and commented
- Ensure responsive design considerations

### HTML

- Use semantic HTML
- Keep structure clean and accessible
- Maintain proper indentation

### General

- **No console.logs** in production code (use the log function if needed)
- **Keep it simple** - prefer readable code over clever tricks
- **Performance matters** - consider performance implications
- **Accessibility** - ensure changes don't break accessibility

## Project Structure

```
3D-Rubix-Project/
├── index.html          # Main HTML structure
├── script.js           # Three.js scene, cube logic, solver
├── style.css           # UI styling and themes
├── rubix.png           # Project favicon/logo
├── README.md           # Project documentation
├── CONTRIBUTING.md     # This file
└── .github/
    └── PULL_REQUEST_TEMPLATE.md  # PR template
```

### Key Code Sections in `script.js`

- **CONFIG**: Configuration constants
- **STATE**: Global state management
- **VirtualCube**: Cube logic engine
- **buildPuzzle()**: Cube construction
- **processQueue()**: Animation system
- **validateAndHeal()**: Integrity checking
- **scramble()**: Scrambling logic
- **solve()**: Solving logic

## Areas for Contribution

### High Priority

- 🐛 **Bug Fixes**: Visual alignment issues, state synchronization
- ⚡ **Performance**: Optimize solver algorithms, reduce memory usage
- 🎨 **UI/UX**: Improve interface, add features, enhance animations

### Solver Improvements

- Implement better heuristics for IDA*
- Add pattern databases for faster solving
- Implement Kociemba's algorithm for 3×3
- Add bidirectional BFS
- Optimize state encoding

### Features

- Move notation display (R, U, F, etc.)
- Custom scramble input
- Step-by-step solution replay
- Save/load cube states
- Timer/statistics tracking
- Different color schemes
- Touch controls for mobile
- Keyboard shortcuts

### Documentation

- Code comments and JSDoc
- Tutorial/guide improvements
- Algorithm explanations
- Performance benchmarks

### Testing

- Unit tests for cube logic
- Integration tests
- Visual regression tests
- Performance benchmarks

## Questions?

If you have questions or need help:

1. Check existing issues and PRs
2. Open a new issue with the `question` label
3. Be patient - maintainers are volunteers

## Thank You! 🙏

Your contributions make this project better for everyone. We appreciate your time and effort!

---

**Happy Coding!** 🚀

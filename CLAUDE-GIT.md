# ProcStudio Git Rules
- Follow Convetional Commits (https://www.conventionalcommits.org/en/v1.0.0/)
- Always fetch and pull before starting working
- Always check status and dirty branchs before start working
- Always create a remote, do not let local isolated branches
- Multiple agents working inside a tree or branch: Talk to the other user throught files here  "./agents/chat" don't act like crazy cleaning it up
- Do not ask user to Add, Commit and Pushl, this is your job
- Finishing the job:
    - Check and update human documentation (./docs);
    - Check and update ia documentation (CLAUDE-\*.md);
    - Check and update Bruno collections;
    - Check basic tests, lint and other general code standards
    - Update .\frontend\changelog.md following it's own rules
    - Empty/Clean/Delete now unused files, implementation plans and specs
    - For pending actions, tech debt and other todos: Create a Linear issue
      following **CLAUDE-LINEAR-ISSUES.md** (title pattern, prefixes, state,
      priority, assignee and the mandatory QA criteria)

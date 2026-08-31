## Deploy Configuration (configured by /setup-deploy)

- Platform: custom Docker Compose over SSH on h2
- Production URL: https://jurcrawler.com.br
- Deploy workflow: immutable release copied from origin/main, then current symlink switch
- Deploy status command: ssh -i ~/.ssh/whats-organizer-backend brpl@168.231.91.47 'docker compose -p jur -f /home/brpl/apps/prc_jur_crawler/current/infra/compose.yml ps'
- Merge method: direct main commits following CLAUDE-GIT.md
- Project type: web app + REST API + MCP
- Post-deploy health check: curl -fsS https://jurcrawler.com.br/api/v1/saude

### Custom deploy hooks

- Pre-merge: cd jur && npm test && npm run test:browser && npm run aceite -- TJSC --rapido
- Deploy trigger: manual immutable release over SSH
- Deploy status: Docker Compose health plus public authentication probes
- Health check: https://jurcrawler.com.br/api/v1/saude
- Rollback: restore /home/brpl/apps/prc_jur_crawler/.previous-release as current and run docker compose up -d

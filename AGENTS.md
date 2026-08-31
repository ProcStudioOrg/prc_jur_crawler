## Deploy Configuration (configured by /setup-deploy)

- Platform: custom Docker Compose over SSH on h2
- Production URL: https://jurcrawler.com.br
- Deploy workflow: immutable release copied from origin/main, then current symlink switch
- Deploy status command: ssh -i ~/.ssh/whats-organizer-backend brpl@168.231.91.47 'docker compose -p jur -f /home/brpl/apps/prc_jur_crawler/current/infra/compose.yml ps'
- Merge method: direct main commits following CLAUDE-GIT.md
- Project type: web app + REST API + MCP
- Post-deploy health check (6b — pending DNS/TLS): curl -fsS https://jurcrawler.com.br/api/v1/saude

### Custom deploy hooks

- Pre-merge: cd jur && npm test && npm run test:browser && npm run aceite -- TJSC --rapido
- Deploy trigger: manual immutable release over SSH
- Deploy status: Docker Compose health; public authentication probes are 6b — pending DNS/TLS
- Health check (6b — pending DNS/TLS): https://jurcrawler.com.br/api/v1/saude
- Rollback (run on h2; preserve volumes): `previous_release="$(cat /home/brpl/apps/prc_jur_crawler/.previous-release)" && test -d "$previous_release" && ln -sfn "$previous_release" /home/brpl/apps/prc_jur_crawler/current && docker compose -p jur -f /home/brpl/apps/prc_jur_crawler/current/infra/compose.yml up -d --build`; never use `down -v` / nunca usar `down -v`.

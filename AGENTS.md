## Deploy Configuration (configured by /setup-deploy)

- Platform: custom Docker Compose over SSH on h2
- Production URL: https://jurcrawler.com.br
- Deploy workflow: immutable release copied from origin/main, then current symlink switch
- Deploy status command: ssh -o IdentitiesOnly=yes -i ~/.ssh/jurcrawler_deploy brpl@168.231.91.47 'docker compose -p jur -f /home/brpl/apps/prc_jur_crawler/current/infra/compose.yml ps'
- Merge method: direct main commits following CLAUDE-GIT.md
- Project type: web app + REST API + MCP
- Post-deploy health check: curl -fsS https://jurcrawler.com.br/api/v1/saude

### Custom deploy hooks

- Pre-merge: cd jur && npm test && npm run test:browser && npm run aceite -- TJSC --rapido
- Deploy trigger: manual immutable release over SSH
- Deploy status: Docker Compose health and public authentication probes; preserve the ProcStudio login and all persistent volumes.
- Health check: https://jurcrawler.com.br/api/v1/saude
- Pin each release image with JUR_IMAGE in its private infra/.env; preserve the previous image for rollback. Local-only jur/dev is excluded from the Docker image.
- Rollback (run on h2; preserve volumes): `previous_release="$(cat /home/brpl/apps/prc_jur_crawler/.previous-release)" && test -d "$previous_release" && ln -sfn "$previous_release" /home/brpl/apps/prc_jur_crawler/current && docker compose -p jur -f /home/brpl/apps/prc_jur_crawler/current/infra/compose.yml up -d --no-build`; never use `down -v` / nunca usar `down -v`.

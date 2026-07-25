# Court System URL Discovery Method

## Overview
When direct URLs fail (connection errors, bot protection, etc.), use this approach to discover working URLs.

## Steps

### 1. Access the Main Court Portal
- Search Google for: `[TRIBUNAL] site oficial` (e.g., "TJRS site oficial")
- Or try common patterns:
  - `https://www.tj[STATE].jus.br/`
  - `https://portal.tj[STATE].jus.br/`

### 2. Look for System Access Points
Navigate to sections like:
- "Serviços Processuais"
- "Consulta Processual"
- "Sistemas"
- "Acesso aos Sistemas"

### 3. Identify Dropdown Menus
Many courts hide system links in dropdown menus:
- Look for buttons like "Sistemas", "Serviços", "Acesso"
- Common CSS selectors: `.dropdown-toggle`, `.btn-overlay-header`

### 4. Extract Correct URLs
Systems may use different URL patterns than expected:
- **TJRS Example**:
  - Old (failed): `https://eproc.tjrs.jus.br/eproc2/`
  - New (works): `https://eproc1g.tjrs.jus.br/` and `https://eproc2g.tjrs.jus.br/`

### 5. Handle SSO/Keycloak Authentication
Some courts use centralized SSO:
- URLs may redirect through `keycloak-eks.[court].jus.br`
- Or `sso.cloud.pje.jus.br`
- This is normal - the final page should still load

## Common Systems

| System | Description | Typical URL Pattern |
|--------|-------------|---------------------|
| PJE | Processo Judicial Eletrônico | `pje.tj[STATE].jus.br/pje/login.seam` |
| ESAJ | e-SAJ (TJ SP, AC, AL, AM, MS) | `esaj.tj[STATE].jus.br/cpopg/open.do` |
| EPROC | Sistema Eproc (TRF4, TJRS, TJSC) | `eproc.tj[STATE].jus.br/eproc2/` |
| Projudi | Processo Judicial Digital | `projudi.tj[STATE].jus.br/projudi/` |

## URL Variations to Try

### PJE
```
https://pje.tj[STATE].jus.br/pje/login.seam
https://pje.tj[STATE].jus.br/1g/login.seam
https://pje1g.tj[STATE].jus.br/pje/login.seam
https://pje.tj[STATE].jus.br/pje1grau/login.seam
```

### EPROC
```
https://eproc.tj[STATE].jus.br/eproc2/
https://eproc1g.tj[STATE].jus.br/
https://eproc.tj[STATE].jus.br/eprocV2/
```

### ESAJ
```
https://esaj.tj[STATE].jus.br/cpopg/open.do (1st degree)
https://esaj.tj[STATE].jus.br/cposg/open.do (2nd degree)
https://consultasaj.tj[STATE].jus.br/cpopg/open.do
```

## Troubleshooting

1. **Connection Failed**: Try main portal and navigate manually
2. **Bot Protection (Keycloak)**: Look for alternative subdomain URLs
3. **Cloudflare**: Retry later or check if there's a bypass URL
4. **404 Not Found**: URL structure changed - check portal for new links
5. **Gateway Timeout**: Server overload - retry later

## Notes
- Some courts (BA, PR) use Projudi for both 1st and 2nd degree with single login
- Always save screenshots for reference
- Document old vs new URLs for tracking changes

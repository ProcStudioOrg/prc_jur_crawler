// Porta de issue-reporter/linear.ts do FFD — manter em sincronia; sem build TS no JurCrawler.
// Cliente GraphQL do Linear com fetch nativo: só labels/estados de um time e criação de issue.

const GRAPHQL_URL = 'https://api.linear.app/graphql';

class LinearError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = 'LinearError';
  }
}

async function gql(apiKey, query, variables) {
  let res;
  try {
    res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      // Uma issue não vale segurar o request do usuário por minutos.
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new LinearError(`Não foi possível falar com o Linear: ${e.message}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new LinearError('API key do Linear inválida ou sem permissão.', res.status);
  }
  if (!res.ok) {
    throw new LinearError(`Linear respondeu ${res.status}.`, res.status);
  }

  const body = await res.json();
  if (body.errors?.length) {
    throw new LinearError(body.errors.map((e) => e.message).join('; '));
  }
  if (!body.data) throw new LinearError('Linear respondeu sem dados.');
  return body.data;
}

/** Quem é o dono da key. */
async function getViewer(apiKey) {
  const data = await gql(apiKey, '{ viewer { name email } }');
  return data.viewer;
}

/** Times visíveis pela key. */
async function listTeams(apiKey) {
  const data = await gql(apiKey, '{ teams(first: 100) { nodes { id key name } } }');
  return data.teams.nodes;
}

const TEAM_META_QUERY = `
  query TeamMeta($teamId: String!) {
    team(id: $teamId) {
      id
      key
      name
      states(first: 100) { nodes { id name type position } }
    }
    issueLabels(first: 250) {
      nodes { id name isGroup team { id } parent { id name } }
    }
  }
`;

/**
 * Labels e estados de um time, numa consulta só.
 *
 * `issueLabels` vem do workspace inteiro porque no Linear as labels vivem em
 * dois lugares (time e workspace); o corte por time acontece aqui, no cliente.
 */
async function getTeamMeta(apiKey, teamId) {
  const data = await gql(apiKey, TEAM_META_QUERY, { teamId });

  if (!data.team) throw new LinearError(`Time ${teamId} não existe ou a key não o enxerga.`);

  const labels = data.issueLabels.nodes
    .filter((l) => l.team === null || l.team.id === teamId)
    .map((l) => ({
      id: l.id,
      name: l.name,
      isGroup: l.isGroup,
      teamId: l.team?.id ?? null,
      parentName: l.parent?.name ?? null,
    }));

  return {
    id: data.team.id,
    key: data.team.key,
    name: data.team.name,
    labels,
    states: data.team.states.nodes.slice().sort((a, b) => a.position - b.position),
  };
}

async function createIssue(apiKey, input) {
  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { identifier url }
      }
    }
  `;

  const payload = {
    teamId: input.teamId,
    title: input.title,
    description: input.description,
  };
  if (input.priority != null) payload.priority = input.priority;
  if (input.labelIds?.length) payload.labelIds = input.labelIds;
  if (input.stateId) payload.stateId = input.stateId;

  const data = await gql(apiKey, mutation, { input: payload });

  const { success, issue } = data.issueCreate;
  if (!success || !issue) throw new LinearError('O Linear recusou a criação da issue.');
  return issue;
}

module.exports = { GRAPHQL_URL, LinearError, getViewer, listTeams, getTeamMeta, createIssue };

Configure base_url, personal_token, connection_id e model_id no ambiente local Bruno. llm_api_key e personal_token são segredos: não exportar/commitar ambientes preenchidos.
As requisições de navegadores mostram capacidade global e apenas as sessões da conta.
Ative o acompanhamento antes da busca e preencha `job_id` com o identificador retornado
por `POST /api/v1/buscas`. `Continuar` só funciona durante pausa humana e exige a
verificação do portal concluída. Veja [guia](../../docs/navegadores.md).

import { config } from './config.js';

/**
 * Busca TODAS as linhas do dataset no Data Hub, paginando por offset/limit
 * ate cobrir `total` (a API nao aceita filtro de data no servidor - `from`/
 * `to` sao ignorados silenciosamente, confirmado testando contra o dataset
 * real - entao trazemos tudo e filtramos pelo periodo no cliente, em
 * exportDataHub.js).
 *
 * Respeita o rate limit do token (10 requisicoes/minuto) espacando as
 * chamadas por `minRequestIntervalMs` - hoje o dataset inteiro cabe numa
 * unica pagina (limit padrao 10000), entao isso so importa se o dataset
 * crescer.
 */
const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

// So pra debug: nunca loga o token inteiro, so um "fingerprint" (inicio +
// tamanho) suficiente pra confirmar visualmente se o processo esta lendo o
// valor esperado do .env sem expor o segredo completo em log.
function tokenFingerprint(token) {
  if (!token) return '(vazio)';
  return `${token.slice(0, 12)}...(len=${token.length})`;
}

export async function fetchAllDataHubRows(datasetSlug = config.dataHub.datasetSlug) {
  if (DEBUG) {
    console.debug(
      `[dataHub][debug] token=${tokenFingerprint(config.dataHub.token)} baseUrl=${config.dataHub.baseUrl} datasetSlug=${datasetSlug}`,
    );
  }

  if (!config.dataHub.token) {
    throw new Error(
      '[dataHub] DATA_HUB_TOKEN nao configurado. Defina a variavel de ambiente antes de rodar (ver automation/.env.example).',
    );
  }

  const rows = [];
  let offset = 0;
  const limit = 5000;
  let total = Infinity;
  let lastRequestAt = 0;

  while (offset < total) {
    const waitMs = config.dataHub.minRequestIntervalMs - (Date.now() - lastRequestAt);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

    const url = new URL(`/api/public/v1/datasets/${datasetSlug}/rows`, config.dataHub.baseUrl);
    url.searchParams.set('token', config.dataHub.token);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    if (DEBUG) {
      const redactedUrl = new URL(url);
      redactedUrl.searchParams.set('token', tokenFingerprint(config.dataHub.token));
      console.debug(`[dataHub][debug] GET ${redactedUrl.toString()}`);
    }

    lastRequestAt = Date.now();
    const response = await fetch(url);

    if (DEBUG) {
      console.debug(`[dataHub][debug] HTTP ${response.status} ${response.statusText}`);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      if (DEBUG) {
        console.debug(`[dataHub][debug] response body: ${bodyText.slice(0, 500)}`);
      }
      throw new Error(`[dataHub] Falha ao buscar dataset "${datasetSlug}": HTTP ${response.status}`);
    }

    const body = await response.json();
    rows.push(...body.rows);
    total = body.total;
    offset += body.rows.length;

    if (DEBUG) {
      console.debug(`[dataHub][debug] recebidas ${body.rows.length} linhas (offset=${offset}, total=${total})`);
    }

    if (body.rows.length === 0) break; // evita loop infinito se a API responder algo inesperado
  }

  return rows;
}

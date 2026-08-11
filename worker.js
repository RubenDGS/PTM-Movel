const ALLOWED_ORIGIN = "https://rubendgs.github.io";

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function cleanJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try { return JSON.parse(s); } catch { return { texto_extraido: text }; }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || ALLOWED_ORIGIN;
    const headers = cors(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (request.method === "GET") {
      return Response.json(
        { ok: true, service: "ptm-analise", ai: !!env.AI, message: "Worker PTM ativo" },
        { headers }
      );
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/analisar") {
      return Response.json({ ok: false, error: "Rota não encontrada" }, { status: 404, headers });
    }

    if (!env.AI) {
      return Response.json(
        { ok: false, error: "Binding Workers AI não configurado." },
        { status: 500, headers }
      );
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ ok: false, error: "Pedido inválido." }, { status: 400, headers });
    }

    const images = Array.isArray(payload?.images) ? payload.images : [];
    if (!images.length) {
      return Response.json({ ok: false, error: "Nenhuma fotografia recebida." }, { status: 400, headers });
    }

    const resultados = [];

    for (const item of images) {
      const tipo = item.tipo || "AUTO";
      const fase = ["A","B","C","N"].includes(tipo) ? tipo : "";

      const question = `
Analisa esta chapa de características de equipamento elétrico para preenchimento do Ativo de uma máquina Testrano 600 (PTM).

Contexto indicado pelo utilizador: ${tipo}.
${fase ? `Esta fotografia corresponde à travessia ${fase}.` : ""}

Lê APENAS valores realmente visíveis na imagem. Não inventes, não calcules valores ausentes e não preenchas por semelhança com outros equipamentos.
Reconhece marcas e modelos diversos (Siemens, EFACEC, Trench e outras).

Devolve SOMENTE JSON válido, sem markdown, com esta estrutura:
{
  "tipo_chapa": "transformador|regulador|travessia|desconhecido",
  "fase_travessia": "${fase}",
  "fabricante": "",
  "modelo_tipo": "",
  "numero_serie": "",
  "ano": "",
  "norma": "",
  "dados": {
    "potencia_nominal": "",
    "numero_fases": "",
    "frequencia": "",
    "grupo_ligacoes": "",
    "arrefecimento": "",
    "tensao_AT": "",
    "tensao_BT": "",
    "corrente_AT": "",
    "corrente_BT": "",
    "nivel_isolamento_AT": "",
    "nivel_isolamento_BT": "",
    "tensao_curto_circuito_Ucc": "",
    "impedancia_curto_circuito": "",
    "massa_total": "",
    "massa_oleo": "",
    "massa_transporte": "",
    "temperatura_oleo": "",
    "temperatura_enrolamento": ""
  },
  "regulador": {
    "fabricante": "",
    "modelo": "",
    "numero_serie": "",
    "corrente_nominal": "",
    "tensao_maxima_Um": "",
    "numero_posicoes": "",
    "posicoes": [
      {"posicao":"","tensao":"","corrente":"","seletor":"","pre_seletor":""}
    ]
  },
  "travessia": {
    "Um": "",
    "tensao_nominal": "",
    "tensao_maxima": "",
    "corrente_nominal": "",
    "BIL": "",
    "AC": "",
    "frequencia": "",
    "massa": "",
    "angulo_montagem": "",
    "FD_C1": "",
    "C1_pF": "",
    "FD_C2": "",
    "C2_pF": ""
  },
  "outros_campos_visiveis": {},
  "duvidas_leitura": [],
  "confianca": "alta|media|baixa"
}

Se uma secção não se aplicar, deixa-a vazia. Mantém unidades junto dos valores. Em "outros_campos_visiveis", inclui informação da chapa que não encaixe nos campos anteriores.
      `.trim();

      try {
        const ai = await env.AI.run("@cf/moondream/moondream3.1-9B-A2B", {
          task: "query",
          image: item.image,
          question,
          reasoning: false,
          temperature: 0.1,
          max_tokens: 6000,
          stream: false
        });

        const parsed = cleanJson(ai?.answer ?? ai?.response ?? ai);
        resultados.push({
          nome: item.name || "",
          tipo_indicado: tipo,
          resultado: parsed
        });
      } catch (err) {
        resultados.push({
          nome: item.name || "",
          tipo_indicado: tipo,
          erro: String(err?.message || err)
        });
      }
    }

    return Response.json({ ok: true, resultados }, { headers });
  }
};

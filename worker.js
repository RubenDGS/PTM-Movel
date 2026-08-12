const MODEL = "@cf/moondream/moondream3.1-9B-A2B";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (request.method !== "POST" || (url.pathname !== "/" && url.pathname !== "/analisar")) {
      return resposta({ ok:false, erro:"Método ou endereço não permitido." }, 405);
    }
    if (!env.AI) return resposta({ ok:false, erro:'Binding "AI" não encontrado.' }, 500);

    try {
      const body = await request.json();
      const images = Array.isArray(body.images) ? body.images : [];
      if (!images.length) return resposta({ ok:false, erro:"Não foram recebidas fotografias." }, 400);

      const resultados = [];

      for (const item of images) {
        const nome = item.name || item.nome || "Fotografia";
        const tipo = item.tipo || "AUTO";
        const image = item.image || item.imagem || "";

        if (!image) {
          resultados.push({ nome, tipo, erro:"Imagem não recebida." });
          continue;
        }

        try {
          const question = `Analisa esta chapa técnica para ajudar a preencher o Ativo no PTM.
Tipo indicado pelo utilizador: ${tipo}.

Lê APENAS o que está realmente visível. Não inventes, não calcules e não completes por conhecimento geral.
Se não conseguires ler um valor, usa "".
Mantém números e unidades tal como aparecem.

Identifica, quando existirem:
- tipo da chapa: transformador, regulador ou travessia
- fabricante, modelo/tipo, número de série, ano, norma
- potência nominal, número de fases, frequência, grupo de ligações, arrefecimento
- tensão AT e BT, corrente AT e BT
- níveis de isolamento AT/BT
- Ucc/impedância de curto-circuito
- massa total, óleo e transporte
- temperaturas de óleo/enrolamento
- regulador: número de posições e posições/tensões visíveis
- travessia: tensão nominal, tensão máxima, corrente nominal, BIL, C1, C2, FD C1, FD C2

Responde SOMENTE com JSON válido nesta estrutura:
{
 "tipo_chapa":"",
 "fabricante":"",
 "modelo_tipo":"",
 "numero_serie":"",
 "ano":"",
 "norma":"",
 "dados":{
  "potencia_nominal":"",
  "numero_fases":"",
  "frequencia":"",
  "grupo_ligacoes":"",
  "arrefecimento":"",
  "tensao_AT":"",
  "tensao_BT":"",
  "corrente_AT":"",
  "corrente_BT":"",
  "nivel_isolamento_AT":"",
  "nivel_isolamento_BT":"",
  "tensao_curto_circuito_Ucc":"",
  "impedancia_curto_circuito":"",
  "massa_total":"",
  "massa_oleo":"",
  "massa_transporte":"",
  "temperatura_oleo":"",
  "temperatura_enrolamento":"",
  "numero_posicoes_regulador":"",
  "posicoes_regulador":"",
  "tensao_nominal_travessia":"",
  "tensao_maxima_travessia":"",
  "corrente_nominal_travessia":"",
  "BIL":"",
  "C1_pF":"",
  "FD_C1":"",
  "C2_pF":"",
  "FD_C2":""
 },
 "outros_campos_visiveis":{}
}`;

          const raw = await env.AI.run(MODEL, {
            task:"query",
            image,
            question,
            reasoning:false,
            temperature:0,
            max_tokens:3000,
            stream:false
          });

          const texto = extrairTexto(raw);
          const dados = limparJSON(texto);

          if (!dados) {
            resultados.push({ nome, tipo, erro:"A leitura não veio num formato utilizável." });
          } else {
            resultados.push({ nome, tipo, resultado:dados });
          }
        } catch (e) {
          resultados.push({ nome, tipo, erro:e?.message || String(e) });
        }
      }

      return resposta({ ok:true, resultados });
    } catch (e) {
      return resposta({ ok:false, erro:e?.message || String(e) }, 500);
    }
  }
};

function extrairTexto(x) {
  if (typeof x === "string") return x;
  if (typeof x?.answer === "string") return x.answer;
  if (typeof x?.result?.answer === "string") return x.result.answer;
  if (typeof x?.response === "string") return x.response;
  if (typeof x?.result === "string") return x.result;
  return "";
}

function limparJSON(texto) {
  let s = String(texto || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a,b+1)); } catch {}
  }
  return null;
}

function resposta(dados, status=200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers:{
      ...CORS,
      "Content-Type":"application/json; charset=UTF-8",
      "Cache-Control":"no-store"
    }
  });
}

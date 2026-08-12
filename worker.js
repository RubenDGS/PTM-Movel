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

OBJETIVO:
Ler APENAS os valores que estão claramente associados ao respetivo rótulo na chapa.

REGRAS OBRIGATÓRIAS:
- Não inventes, não calcules, não deduzas e não completes por conhecimento geral.
- Se não conseguires provar a associação entre rótulo e valor, devolve "".
- NÃO repitas o mesmo valor em vários campos só porque aparece na imagem.
- Mantém sempre a unidade quando ela estiver visível.
- "50 Hz" só pode ser frequência.
- Valores com VA, kVA ou MVA só podem ser potência.
- Valores com V ou kV só podem ser tensão/isolamento/BIL conforme o rótulo.
- Valores com A ou kA só podem ser corrente.
- Valores com kg ou t só podem ser massa.
- Valores com °C ou C só podem ser temperatura quando o rótulo indicar temperatura.
- Ucc/Uk/Zk deve ter % quando a chapa o apresentar em percentagem.
- "AT" e "BT" isolados NÃO são grupo de ligações nem arrefecimento.
- Grupo de ligações deve parecer um código real, por exemplo Dyn11, YNyn0, Yd11, etc.
- Arrefecimento deve parecer um código real, por exemplo ONAN, ONAF, OFAF, ODAF, KNAN, KNAF.
- Fabricante deve ser um nome/marca legível, nunca palavras genéricas ou fragmentos como "EU".
- Ano deve ser um ano de 4 dígitos.
- Só preenche campos de travessia se a fotografia for realmente de uma travessia.
- Só preenche regulador se estiver claramente identificado um regulador/comutador ou tabela de posições.
- Se o tipo indicado pelo utilizador for A, B, C ou N, trata a fotografia como travessia dessa fase.
- Faz uma revisão final antes de responder e esvazia qualquer campo duvidoso.

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
            resultados.push({ nome, tipo, resultado:validarDados(dados, tipo) });
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


function validarDados(x, tipoEscolhido) {
  const out = {
    tipo_chapa: limpar(x?.tipo_chapa),
    fabricante: limpar(x?.fabricante),
    modelo_tipo: limpar(x?.modelo_tipo),
    numero_serie: limpar(x?.numero_serie),
    ano: limpar(x?.ano),
    norma: limpar(x?.norma),
    dados: {},
    outros_campos_visiveis:
      x?.outros_campos_visiveis && typeof x.outros_campos_visiveis === "object"
        ? x.outros_campos_visiveis : {}
  };

  const d = x?.dados && typeof x.dados === "object" ? x.dados : {};
  const get = k => limpar(d[k]);

  // Identificação
  if (!/^(transformador|regulador|travessia)$/i.test(out.tipo_chapa)) out.tipo_chapa = "";
  if (["A","B","C","N"].includes(String(tipoEscolhido).toUpperCase())) out.tipo_chapa = "travessia";

  if (!out.fabricante || out.fabricante.length < 3 ||
      /^(eu|fabricante|manufacturer|marca|brand)$/i.test(out.fabricante)) out.fabricante = "";

  if (/^(eu|tipo|modelo|model|type)$/i.test(out.modelo_tipo)) out.modelo_tipo = "";

  if (out.ano && !/^(19|20)\d{2}$/.test(out.ano.trim())) out.ano = "";

  // Só aceita valores com unidades/formatos compatíveis.
  out.dados.potencia_nominal = temUnidade(get("potencia_nominal"), /\b(?:VA|kVA|MVA)\b/i);
  out.dados.numero_fases = /^(?:1|3)(?:\s*(?:fase|fases|ph|phases))?$/i.test(get("numero_fases"))
    ? get("numero_fases") : "";
  out.dados.frequencia = temUnidade(get("frequencia"), /\bHz\b/i);

  const grupo = get("grupo_ligacoes");
  out.dados.grupo_ligacoes =
    /^(?=.*[0-9])(?=.*[A-Za-z])[A-Za-z0-9+\-\/]+$/.test(grupo) &&
    !/^(AT|BT)$/i.test(grupo) ? grupo : "";

  const cool = get("arrefecimento");
  out.dados.arrefecimento =
    /^(?:ONAN|ONAF|OFAF|ODAF|OFWF|ODWF|KNAN|KNAF|AN|AF)(?:[\/+\- ](?:ONAN|ONAF|OFAF|ODAF|OFWF|ODWF|KNAN|KNAF|AN|AF))*$/i.test(cool)
      ? cool : "";

  out.dados.tensao_AT = temUnidade(get("tensao_AT"), /\b(?:V|kV)\b/i);
  out.dados.tensao_BT = temUnidade(get("tensao_BT"), /\b(?:V|kV)\b/i);
  out.dados.corrente_AT = temUnidade(get("corrente_AT"), /\b(?:A|kA)\b/i);
  out.dados.corrente_BT = temUnidade(get("corrente_BT"), /\b(?:A|kA)\b/i);

  out.dados.nivel_isolamento_AT = validarIsolamento(get("nivel_isolamento_AT"));
  out.dados.nivel_isolamento_BT = validarIsolamento(get("nivel_isolamento_BT"));

  out.dados.tensao_curto_circuito_Ucc =
    temUnidade(get("tensao_curto_circuito_Ucc"), /%/) ;
  out.dados.impedancia_curto_circuito =
    temUnidade(get("impedancia_curto_circuito"), /(?:%|Ω|ohm)/i);

  out.dados.massa_total = temUnidade(get("massa_total"), /\b(?:kg|t)\b/i);
  out.dados.massa_oleo = temUnidade(get("massa_oleo"), /\b(?:kg|t)\b/i);
  out.dados.massa_transporte = temUnidade(get("massa_transporte"), /\b(?:kg|t)\b/i);

  out.dados.temperatura_oleo = validarTemperatura(get("temperatura_oleo"));
  out.dados.temperatura_enrolamento = validarTemperatura(get("temperatura_enrolamento"));

  // Se o mesmo valor foi atirado para vários campos incompatíveis, fica vazio.
  removerDuplicadosIncompativeis(out.dados, [
    ["tensao_AT","tensao_BT","corrente_AT","corrente_BT"],
    ["massa_total","massa_oleo","massa_transporte"],
    ["nivel_isolamento_AT","nivel_isolamento_BT"]
  ]);

  // Regulador: só aceita com evidência razoável.
  const npos = get("numero_posicoes_regulador");
  const pos = get("posicoes_regulador");
  const tipoUpper = String(tipoEscolhido || "").toUpperCase();
  const contextoRegulador = tipoUpper === "REGULADOR" || out.tipo_chapa === "regulador";
  out.dados.numero_posicoes_regulador =
    (contextoRegulador && /^\d{1,2}$/.test(npos) && Number(npos) >= 2) ? npos : "";
  out.dados.posicoes_regulador =
    (contextoRegulador && pos && pos !== "1") ? pos : "";

  // Travessia: jamais preencher a partir de chapa de transformador/regulador.
  const contextoTravessia =
    ["A","B","C","N"].includes(tipoUpper) || out.tipo_chapa === "travessia";

  out.dados.tensao_nominal_travessia =
    contextoTravessia ? temUnidade(get("tensao_nominal_travessia"), /\b(?:V|kV)\b/i) : "";
  out.dados.tensao_maxima_travessia =
    contextoTravessia ? temUnidade(get("tensao_maxima_travessia"), /\b(?:V|kV)\b/i) : "";
  out.dados.corrente_nominal_travessia =
    contextoTravessia ? temUnidade(get("corrente_nominal_travessia"), /\b(?:A|kA)\b/i) : "";
  out.dados.BIL =
    contextoTravessia ? validarIsolamento(get("BIL")) : "";
  out.dados.C1_pF =
    contextoTravessia ? temUnidade(get("C1_pF"), /\bpF\b/i) : "";
  out.dados.C2_pF =
    contextoTravessia ? temUnidade(get("C2_pF"), /\bpF\b/i) : "";
  out.dados.FD_C1 =
    contextoTravessia ? validarFD(get("FD_C1")) : "";
  out.dados.FD_C2 =
    contextoTravessia ? validarFD(get("FD_C2")) : "";

  return out;
}

function limpar(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return "";
  const s = v.trim();
  return /^(?:null|undefined|n\/a|na|ileg[ií]vel)$/i.test(s) ? "" : s;
}

function temUnidade(v, re) {
  v = limpar(v);
  return v && re.test(v) ? v : "";
}

function validarTemperatura(v) {
  v = limpar(v);
  return v && /-?\d+(?:[.,]\d+)?\s*°?\s*C\b/i.test(v) ? v : "";
}

function validarIsolamento(v) {
  v = limpar(v);
  return v && /\b(?:kV|V)\b/i.test(v) ? v : "";
}

function validarFD(v) {
  v = limpar(v);
  if (!v) return "";
  if (/%/.test(v)) return v;
  if (/^0?[.,]\d+$/.test(v)) return v;
  return "";
}

function removerDuplicadosIncompativeis(obj, grupos) {
  for (const grupo of grupos) {
    const mapa = {};
    for (const k of grupo) {
      const v = limpar(obj[k]);
      if (!v) continue;
      const key = v.toLowerCase().replace(/\s+/g," ");
      (mapa[key] ||= []).push(k);
    }
    for (const ks of Object.values(mapa)) {
      if (ks.length > 1) for (const k of ks) obj[k] = "";
    }
  }
}

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

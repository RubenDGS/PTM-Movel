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

    if (!env.AI) {
      return resposta({ ok:false, erro:'Binding "AI" não encontrado.' }, 500);
    }

    try {
      const body = await request.json();
      const images = Array.isArray(body.images) ? body.images : [];

      if (!images.length) {
        return resposta({ ok:false, erro:"Não foram recebidas fotografias." }, 400);
      }

      const resultados = [];

      for (const item of images) {
        const nome = item.name || item.nome || "Fotografia";
        const tipoEscolhido = String(item.tipo || "AUTO").toUpperCase();
        const image = item.image || item.imagem || "";

        if (!image) {
          resultados.push({ nome, tipo:tipoEscolhido, erro:"Imagem não recebida." });
          continue;
        }

        try {
          // PASSAGEM 1: dados principais do equipamento.
          const baseRaw = await env.AI.run(MODEL, {
            task:"query",
            image,
            question:promptBase(tipoEscolhido),
            reasoning:false,
            temperature:0,
            max_tokens:4500,
            stream:false
          });

          const baseText = extrairTexto(baseRaw);
          const baseJson = parseJSONSeguro(baseText) || {};

          // PASSAGEM 2: apenas dados que costumam estar em tabelas/zonas densas:
          // AT/BT, curto-circuito, massas, temperaturas e regulador/travessia.
          const detalheRaw = await env.AI.run(MODEL, {
            task:"query",
            image,
            question:promptDetalhe(tipoEscolhido),
            reasoning:false,
            temperature:0,
            max_tokens:5000,
            stream:false
          });

          const detalheText = extrairTexto(detalheRaw);
          const detalheJson = parseJSONSeguro(detalheText) || {};

          const combinado = combinar(baseJson, detalheJson);
          const resultado = validarEOrganizar(combinado, tipoEscolhido);

          resultados.push({
            nome,
            tipo:tipoEscolhido,
            resultado
          });

        } catch (e) {
          resultados.push({
            nome,
            tipo:tipoEscolhido,
            erro:e?.message || String(e)
          });
        }
      }

      return resposta({ ok:true, resultados });

    } catch (e) {
      return resposta({ ok:false, erro:e?.message || String(e) }, 500);
    }
  }
};

function promptBase(tipo) {
  return `Analisa esta chapa técnica para ajudar a preencher o Ativo no PTM.
Contexto indicado pelo utilizador: ${tipo}

FAZ APENAS EXTRAÇÃO DE DADOS VISÍVEIS.
Não inventes, não calcules e não completes por conhecimento geral.
Se não houver certeza, usa "".
Não repitas o mesmo valor em vários campos.

REGRAS:
- Hz = frequência
- VA/kVA/MVA = potência
- V/kV = tensão
- A/kA = corrente
- kg/t = massa
- °C/C = temperatura
- % = percentagem apenas quando o rótulo o justificar
- AT e BT isolados não são fabricante, modelo, grupo nem arrefecimento
- fabricante deve ser uma marca/nome real
- ano deve ter 4 dígitos
- grupo de ligações deve parecer um código real (ex.: Dyn11, YNyn0, Yd11)
- arrefecimento deve parecer um código real (ex.: ONAN, ONAF, OFAF, ODAF)
- se a chapa principal do transformador também tiver dados do regulador, o tipo continua a ser transformador

PROCURA:
fabricante, tipo/modelo, número de série, ano, norma,
potência nominal, número de fases, frequência,
grupo de ligações e arrefecimento.

Responde SOMENTE com JSON válido:
{
 "tipo_chapa":"",
 "fabricante":"",
 "modelo_tipo":"",
 "numero_serie":"",
 "ano":"",
 "norma":"",
 "potencia_nominal":"",
 "numero_fases":"",
 "frequencia":"",
 "grupo_ligacoes":"",
 "arrefecimento":""
}`;
}

function promptDetalhe(tipo) {
  return `Analisa a MESMA chapa técnica com foco apenas nos campos abaixo.
Contexto indicado pelo utilizador: ${tipo}

Não inventes. Se não estiver claramente associado ao rótulo/coluna, usa "".
Respeita AT/BT ou HV/LV.
Se uma unidade estiver no cabeçalho da linha/coluna, junta-a ao valor devolvido.
Não repitas um valor em campos diferentes.

PROCURA:
- tensão AT e BT
- corrente AT e BT
- níveis de isolamento AT e BT
- Ucc/Uk/Zk/impedância de curto-circuito
- massa total, massa do óleo e massa de transporte
- temperatura do óleo e temperatura do enrolamento
- regulador/comutador: número de posições e tabela/valores das posições
- travessia: tensão nominal, tensão máxima/Um, corrente nominal, BIL, C1, C2, FD C1, FD C2

REGRAS DE VALIDAÇÃO:
- tensão: V ou kV
- corrente: A ou kA
- massas: kg ou t
- temperatura: °C ou C
- Ucc/Uk/Zk: normalmente %
- C1/C2: pF
- BIL: V/kV
- só preencher travessia se a foto for realmente de uma travessia ou se o utilizador indicou A/B/C/N
- só preencher número/posições do regulador se houver regulador/comutador ou tabela de posições claramente visível

Responde SOMENTE com JSON válido:
{
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
}`;
}

function combinar(base, detalhe) {
  return {
    tipo_chapa:base?.tipo_chapa || "",
    fabricante:base?.fabricante || "",
    modelo_tipo:base?.modelo_tipo || "",
    numero_serie:base?.numero_serie || "",
    ano:base?.ano || "",
    norma:base?.norma || "",
    dados:{
      potencia_nominal:base?.potencia_nominal || "",
      numero_fases:base?.numero_fases || "",
      frequencia:base?.frequencia || "",
      grupo_ligacoes:base?.grupo_ligacoes || "",
      arrefecimento:base?.arrefecimento || "",

      tensao_AT:detalhe?.tensao_AT || "",
      tensao_BT:detalhe?.tensao_BT || "",
      corrente_AT:detalhe?.corrente_AT || "",
      corrente_BT:detalhe?.corrente_BT || "",
      nivel_isolamento_AT:detalhe?.nivel_isolamento_AT || "",
      nivel_isolamento_BT:detalhe?.nivel_isolamento_BT || "",
      tensao_curto_circuito_Ucc:detalhe?.tensao_curto_circuito_Ucc || "",
      impedancia_curto_circuito:detalhe?.impedancia_curto_circuito || "",
      massa_total:detalhe?.massa_total || "",
      massa_oleo:detalhe?.massa_oleo || "",
      massa_transporte:detalhe?.massa_transporte || "",
      temperatura_oleo:detalhe?.temperatura_oleo || "",
      temperatura_enrolamento:detalhe?.temperatura_enrolamento || "",
      numero_posicoes_regulador:detalhe?.numero_posicoes_regulador || "",
      posicoes_regulador:detalhe?.posicoes_regulador || "",
      tensao_nominal_travessia:detalhe?.tensao_nominal_travessia || "",
      tensao_maxima_travessia:detalhe?.tensao_maxima_travessia || "",
      corrente_nominal_travessia:detalhe?.corrente_nominal_travessia || "",
      BIL:detalhe?.BIL || "",
      C1_pF:detalhe?.C1_pF || "",
      FD_C1:detalhe?.FD_C1 || "",
      C2_pF:detalhe?.C2_pF || "",
      FD_C2:detalhe?.FD_C2 || ""
    },
    outros_campos_visiveis:{}
  };
}

function validarEOrganizar(x, tipoEscolhido) {
  const out = {
    tipo_chapa:normalizarTipo(x?.tipo_chapa, tipoEscolhido, x),
    fabricante:limpar(x?.fabricante),
    modelo_tipo:limpar(x?.modelo_tipo),
    numero_serie:limpar(x?.numero_serie),
    ano:limpar(x?.ano),
    norma:limpar(x?.norma),
    dados:{},
    outros_campos_visiveis:{}
  };

  const d = x?.dados || {};

  // Identificação
  if (!/^(19|20)\d{2}$/.test(out.ano)) out.ano = "";
  if (/^(AT|BT|HV|LV|EU|2U|1U|1V|1W)$/i.test(out.fabricante)) out.fabricante = "";
  if (/^(AT|BT|HV|LV|EU|2U|1U|1V|1W)$/i.test(out.modelo_tipo)) out.modelo_tipo = "";

  // Série: rejeita valores demasiado curtos e valores com unidades.
  if (out.numero_serie) {
    if (out.numero_serie.length < 3 ||
        /\b(?:Hz|MVA|kVA|VA|kV|V|kA|A|kg|pF|°C)\b/i.test(out.numero_serie)) {
      out.numero_serie = "";
    }
  }

  // Norma: CEI/IEC/EN + números, ou texto que contenha standard/norma.
  if (out.norma && !/\b(?:CEI|IEC|EN)\b.*\d/i.test(out.norma) &&
      !/\b(?:norma|standard)\b/i.test(out.norma)) {
    out.norma = "";
  }

  out.dados.potencia_nominal = unidade(d.potencia_nominal, /\b(?:MVA|kVA|VA)\b/i);
  out.dados.frequencia = unidade(d.frequencia, /\bHz\b/i);

  const nf = limpar(d.numero_fases);
  out.dados.numero_fases = /^(?:1|3)(?:\s*(?:fase|fases|phase|phases))?$/i.test(nf) ? nf : "";

  const grupo = limpar(d.grupo_ligacoes);
  out.dados.grupo_ligacoes =
    grupo && !/^(AT|BT|HV|LV)$/i.test(grupo) &&
    /(?=.*[A-Za-z])(?=.*\d)/.test(grupo) ? grupo : "";

  const cool = limpar(d.arrefecimento);
  out.dados.arrefecimento =
    /^(?:ONAN|ONAF|OFAF|ODAF|OFWF|ODWF|KNAN|KNAF)(?:[\/+\- ](?:ONAN|ONAF|OFAF|ODAF|OFWF|ODWF|KNAN|KNAF))*$/i.test(cool)
      ? cool : "";

  out.dados.tensao_AT = unidade(d.tensao_AT, /\b(?:kV|V)\b/i);
  out.dados.tensao_BT = unidade(d.tensao_BT, /\b(?:kV|V)\b/i);
  out.dados.corrente_AT = unidade(d.corrente_AT, /\b(?:kA|A)\b/i);
  out.dados.corrente_BT = unidade(d.corrente_BT, /\b(?:kA|A)\b/i);

  out.dados.nivel_isolamento_AT = unidade(d.nivel_isolamento_AT, /\b(?:kV|V)\b/i);
  out.dados.nivel_isolamento_BT = unidade(d.nivel_isolamento_BT, /\b(?:kV|V)\b/i);

  out.dados.tensao_curto_circuito_Ucc = unidade(d.tensao_curto_circuito_Ucc, /%/);
  out.dados.impedancia_curto_circuito = unidade(d.impedancia_curto_circuito, /(?:%|Ω|ohm)/i);

  out.dados.massa_total = unidade(d.massa_total, /\b(?:kg|t)\b/i);
  out.dados.massa_oleo = unidade(d.massa_oleo, /\b(?:kg|t)\b/i);
  out.dados.massa_transporte = unidade(d.massa_transporte, /\b(?:kg|t)\b/i);

  out.dados.temperatura_oleo = unidade(d.temperatura_oleo, /°?\s*C\b/i);
  out.dados.temperatura_enrolamento = unidade(d.temperatura_enrolamento, /°?\s*C\b/i);

  // Apaga duplicações impossíveis.
  apagarDuplicados(out.dados, [
    ["tensao_AT","tensao_BT","corrente_AT","corrente_BT"],
    ["massa_total","massa_oleo","massa_transporte"],
    ["nivel_isolamento_AT","nivel_isolamento_BT"]
  ]);

  const t = String(tipoEscolhido || "").toUpperCase();

  // Regulador pode estar na própria chapa do transformador.
  const nr = limpar(d.numero_posicoes_regulador);
  out.dados.numero_posicoes_regulador =
    /^\d{1,2}$/.test(nr) && Number(nr) >= 2 && Number(nr) <= 50 ? nr : "";

  const pos = limpar(d.posicoes_regulador);
  out.dados.posicoes_regulador =
    pos && pos !== "1" && pos.length >= 3 ? pos : "";

  // Travessia apenas quando é travessia.
  const isTrav = ["A","B","C","N"].includes(t) || out.tipo_chapa === "travessia";
  out.dados.tensao_nominal_travessia =
    isTrav ? unidade(d.tensao_nominal_travessia, /\b(?:kV|V)\b/i) : "";
  out.dados.tensao_maxima_travessia =
    isTrav ? unidade(d.tensao_maxima_travessia, /\b(?:kV|V)\b/i) : "";
  out.dados.corrente_nominal_travessia =
    isTrav ? unidade(d.corrente_nominal_travessia, /\b(?:kA|A)\b/i) : "";
  out.dados.BIL =
    isTrav ? unidade(d.BIL, /\b(?:kV|V)\b/i) : "";
  out.dados.C1_pF =
    isTrav ? unidade(d.C1_pF, /\bpF\b/i) : "";
  out.dados.C2_pF =
    isTrav ? unidade(d.C2_pF, /\bpF\b/i) : "";

  const fd1 = limpar(d.FD_C1);
  out.dados.FD_C1 = isTrav && (/%/.test(fd1) || /^0?[.,]\d+$/.test(fd1)) ? fd1 : "";
  const fd2 = limpar(d.FD_C2);
  out.dados.FD_C2 = isTrav && (/%/.test(fd2) || /^0?[.,]\d+$/.test(fd2)) ? fd2 : "";

  return out;
}

function normalizarTipo(v, tipoEscolhido, x) {
  const t = String(tipoEscolhido || "").toUpperCase();

  if (["A","B","C","N"].includes(t)) return "travessia";
  if (t === "TRANSFORMADOR") return "transformador";
  if (t === "REGULADOR") return "regulador";

  // AUTO: presença de MVA ou AT/BT favorece transformador,
  // mesmo que a chapa também tenha dados do regulador.
  const d = x?.dados || {};
  if (/\b(?:MVA|kVA|VA)\b/i.test(limpar(d.potencia_nominal)) ||
      limpar(d.tensao_AT) || limpar(d.tensao_BT) ||
      limpar(d.grupo_ligacoes)) {
    return "transformador";
  }

  const s = limpar(v).toLowerCase();
  if (/transform/.test(s)) return "transformador";
  if (/travessia|bushing/.test(s)) return "travessia";
  if (/regulador|oltc|tap/.test(s)) return "regulador";
  return "";
}

function limpar(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return "";
  return v.trim();
}

function unidade(v, re) {
  const s = limpar(v);
  return s && re.test(s) ? s : "";
}

function apagarDuplicados(obj, grupos) {
  for (const grupo of grupos) {
    const mapa = {};
    for (const k of grupo) {
      const v = limpar(obj[k]).toLowerCase().replace(/\s+/g," ");
      if (!v) continue;
      (mapa[v] ||= []).push(k);
    }
    for (const ks of Object.values(mapa)) {
      if (ks.length > 1) ks.forEach(k => obj[k] = "");
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

function parseJSONSeguro(texto) {
  if (!texto) return null;

  let s = String(texto).trim()
    .replace(/^```(?:json)?\s*/i,"")
    .replace(/\s*```$/i,"")
    .trim();

  try { return JSON.parse(s); } catch {}

  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a,b+1)); } catch {}
  }

  return null;
}

function resposta(dados, status=200) {
  return new Response(JSON.stringify(dados, null, 2), {
    status,
    headers:{
      ...CORS,
      "Content-Type":"application/json; charset=UTF-8",
      "Cache-Control":"no-store"
    }
  });
}

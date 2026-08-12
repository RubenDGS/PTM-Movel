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

IMPORTANTE:
Lê apenas o que está realmente visível. Não inventes.
A chapa pode estar organizada em tabela, com cabeçalhos AT/BT, colunas e várias linhas.
Usa o rótulo, a coluna e a unidade para associar cada valor.
Se um número estiver visível mas a unidade estiver no cabeçalho da linha/coluna, inclui essa unidade no valor devolvido.
Exemplo: se a linha disser "FREQUÊNCIA Hz" e o valor for "50", devolve "50 Hz".
Se uma coluna disser "AT kV" e o valor dessa coluna for "60", devolve "60 kV".
Se um valor estiver legível mas não souberes a que campo pertence, coloca-o em "outros_campos_visiveis" com o respetivo texto/rótulo visível.
Não repitas o mesmo valor em vários campos.
Antes de devolver o JSON, revê a chapa uma segunda vez procurando especificamente campos que ficaram vazios.

REGRAS DE UNIDADES:
- Hz = frequência
- VA, kVA, MVA = potência
- V, kV = tensão
- A, kA = corrente
- kg, t = massa
- °C ou C = temperatura
- pF = capacitância
- % = Ucc/Uk/Zk ou FD, apenas se o rótulo confirmar

CAMPOS A PROCURAR ATIVAMENTE NA CHAPA:
- frequência: procura "Hz", "FREQ", "FREQUÊNCIA", "FREQUENCY"
- tensão AT/BT: procura "AT", "BT", "HV", "LV", "PRIM.", "SEC.", "kV", "V" e respeita a coluna
- corrente AT/BT: procura "A", "kA", "CURRENT", "CORRENTE" e respeita a coluna
- grupo de ligações: procura "GRUPO", "VECTOR GROUP", "COUPLING"
- arrefecimento: procura "REFRIG.", "COOLING", ONAN, ONAF, OFAF, ODAF
- Ucc/impedância: procura Ucc, Uk, Zk, IMPEDÂNCIA, IMPEDANCE e %
- massas: procura MASSA/PESO/WEIGHT, TOTAL, ÓLEO/OIL, TRANSPORTE e kg/t
- temperaturas: procura TEMP., ÓLEO/OIL, ENROLAMENTO/WINDING e °C
- regulador: procura REGULADOR, COMUTADOR, TAP CHANGER, OLTC, POS., POSITION e tabela de tomadas

REGRAS DE CONTEXTO:
- "AT" ou "BT" isolados não são fabricante, modelo, grupo de ligações ou arrefecimento.
- Grupo de ligações deve ser um código como Dyn11, YNyn0, Yd11, etc.
- Arrefecimento deve ser um código como ONAN, ONAF, OFAF, ODAF, KNAN, KNAF.
- Ano deve ter 4 dígitos.
- Só preencher travessia se a foto for uma travessia ou se o utilizador escolheu A/B/C/N.
- Só preencher regulador se houver claramente regulador/comutador ou tabela de posições.
- Se não houver certeza, usa "".

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
            resultados.push({ nome, tipo, resultado:mapearDados(dados, tipo) });
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


function mapearDados(x, tipoEscolhido) {
  const out = {
    tipo_chapa: normalizarTipo(x?.tipo_chapa, tipoEscolhido),
    fabricante: limparTexto(x?.fabricante),
    modelo_tipo: limparTexto(x?.modelo_tipo),
    numero_serie: limparTexto(x?.numero_serie),
    ano: limparTexto(x?.ano),
    norma: limparTexto(x?.norma),
    dados: {
      potencia_nominal:"",
      numero_fases:"",
      frequencia:"",
      grupo_ligacoes:"",
      arrefecimento:"",
      tensao_AT:"",
      tensao_BT:"",
      corrente_AT:"",
      corrente_BT:"",
      nivel_isolamento_AT:"",
      nivel_isolamento_BT:"",
      tensao_curto_circuito_Ucc:"",
      impedancia_curto_circuito:"",
      massa_total:"",
      massa_oleo:"",
      massa_transporte:"",
      temperatura_oleo:"",
      temperatura_enrolamento:"",
      numero_posicoes_regulador:"",
      posicoes_regulador:"",
      tensao_nominal_travessia:"",
      tensao_maxima_travessia:"",
      corrente_nominal_travessia:"",
      BIL:"",
      C1_pF:"",
      FD_C1:"",
      C2_pF:"",
      FD_C2:""
    },
    outros_campos_visiveis:
      x?.outros_campos_visiveis && typeof x.outros_campos_visiveis === "object"
        ? x.outros_campos_visiveis : {}
  };

  const d = x?.dados && typeof x.dados === "object" ? x.dados : {};

  // Limpeza de identificação
  if (!/^(19|20)\d{2}$/.test(out.ano)) out.ano = "";
  if (/^(AT|BT|EU|HV|LV)$/i.test(out.fabricante)) out.fabricante = "";
  if (/^(AT|BT|EU|HV|LV)$/i.test(out.modelo_tipo)) out.modelo_tipo = "";
  if (/^(AT|BT|EU|HV|LV)$/i.test(out.norma)) out.norma = "";

  // Recolhe todos os valores devolvidos pela IA para os voltar a classificar por unidade.
  const pares = [];
  for (const [k,v] of Object.entries(d)) {
    const s = limparTexto(v);
    if (s) pares.push({k,v:s});
  }
  for (const k of ["fabricante","modelo_tipo","numero_serie","ano","norma"]) {
    const v = limparTexto(x?.[k]);
    if (v) pares.push({k,v});
  }

  const primeiroPor = re => {
    const p = pares.find(p => re.test(p.v));
    return p ? p.v : "";
  };

  // Unidades fortes: aqui corrigimos trocas como 50 Hz em "ano" e 20 MVA em "frequência".
  out.dados.frequencia = primeiroPor(/\b\d+(?:[.,]\d+)?\s*Hz\b/i);
  if (!out.dados.frequencia) {
    const f0 = limparTexto(d.frequencia);
    if (/^(?:50|60)(?:[.,]0+)?$/.test(f0)) out.dados.frequencia = f0 + " Hz";
  }
  out.dados.potencia_nominal = primeiroPor(/\b\d+(?:[.,]\d+)?\s*(?:MVA|kVA|VA)\b/i);

  // Campos que só aceitamos se o valor original já vier no campo certo E tiver unidade coerente.
  out.dados.tensao_AT = aceita(d.tensao_AT, /\b\d+(?:[.,]\d+)?\s*(?:kV|V)\b/i);
  out.dados.tensao_BT = aceita(d.tensao_BT, /\b\d+(?:[.,]\d+)?\s*(?:kV|V)\b/i);
  out.dados.corrente_AT = aceita(d.corrente_AT, /\b\d+(?:[.,]\d+)?\s*(?:kA|A)\b/i);
  out.dados.corrente_BT = aceita(d.corrente_BT, /\b\d+(?:[.,]\d+)?\s*(?:kA|A)\b/i);

  const fases = limparTexto(d.numero_fases);
  if (/^(1|3)(?:\s*(?:fase|fases|phase|phases))?$/i.test(fases)) out.dados.numero_fases = fases;

  const grupo = limparTexto(d.grupo_ligacoes);
  if (grupo && !/^(AT|BT)$/i.test(grupo) && /(?=.*[A-Za-z])(?=.*\d)/.test(grupo)) {
    out.dados.grupo_ligacoes = grupo;
  }

  const arref = limparTexto(d.arrefecimento);
  if (/^(?:ONAN|ONAF|OFAF|ODAF|OFWF|ODWF|KNAN|KNAF)(?:[\/+\- ](?:ONAN|ONAF|OFAF|ODAF|OFWF|ODWF|KNAN|KNAF))*$/i.test(arref)) {
    out.dados.arrefecimento = arref;
  }

  out.dados.nivel_isolamento_AT = aceita(d.nivel_isolamento_AT, /\b(?:kV|V)\b/i);
  out.dados.nivel_isolamento_BT = aceita(d.nivel_isolamento_BT, /\b(?:kV|V)\b/i);

  out.dados.tensao_curto_circuito_Ucc = aceita(d.tensao_curto_circuito_Ucc, /%/);
  out.dados.impedancia_curto_circuito = aceita(d.impedancia_curto_circuito, /(?:%|Ω|ohm)/i);

  out.dados.massa_total = aceita(d.massa_total, /\b(?:kg|t)\b/i);
  out.dados.massa_oleo = aceita(d.massa_oleo, /\b(?:kg|t)\b/i);
  out.dados.massa_transporte = aceita(d.massa_transporte, /\b(?:kg|t)\b/i);

  out.dados.temperatura_oleo = aceita(d.temperatura_oleo, /-?\d+(?:[.,]\d+)?\s*°?\s*C\b/i);
  out.dados.temperatura_enrolamento = aceita(d.temperatura_enrolamento, /-?\d+(?:[.,]\d+)?\s*°?\s*C\b/i);

  // Se o mesmo valor foi repetido em campos incompatíveis, apagamos esses campos.
  apagarDuplicados(out.dados, [
    ["tensao_AT","tensao_BT","corrente_AT","corrente_BT"],
    ["massa_total","massa_oleo","massa_transporte"],
    ["nivel_isolamento_AT","nivel_isolamento_BT"]
  ]);

  // Regulador só quando houver contexto
  const t = String(tipoEscolhido || "").toUpperCase();
  const reg = t === "REGULADOR" || out.tipo_chapa === "regulador";
  if (reg) {
    const np = limparTexto(d.numero_posicoes_regulador);
    if (/^\d{1,2}$/.test(np) && Number(np) >= 2) out.dados.numero_posicoes_regulador = np;
    const pos = limparTexto(d.posicoes_regulador);
    if (pos && pos !== "1") out.dados.posicoes_regulador = pos;
  }

  // Travessias só quando a foto é realmente de travessia / A B C N
  const trav = ["A","B","C","N"].includes(t) || out.tipo_chapa === "travessia";
  if (trav) {
    out.dados.tensao_nominal_travessia = aceita(d.tensao_nominal_travessia, /\b\d+(?:[.,]\d+)?\s*(?:kV|V)\b/i);
    out.dados.tensao_maxima_travessia = aceita(d.tensao_maxima_travessia, /\b\d+(?:[.,]\d+)?\s*(?:kV|V)\b/i);
    out.dados.corrente_nominal_travessia = aceita(d.corrente_nominal_travessia, /\b\d+(?:[.,]\d+)?\s*(?:kA|A)\b/i);
    out.dados.BIL = aceita(d.BIL, /\b(?:kV|V)\b/i);
    out.dados.C1_pF = aceita(d.C1_pF, /\bpF\b/i);
    out.dados.C2_pF = aceita(d.C2_pF, /\bpF\b/i);

    const fd1 = limparTexto(d.FD_C1);
    if (/%/.test(fd1) || /^0?[.,]\d+$/.test(fd1)) out.dados.FD_C1 = fd1;
    const fd2 = limparTexto(d.FD_C2);
    if (/%/.test(fd2) || /^0?[.,]\d+$/.test(fd2)) out.dados.FD_C2 = fd2;
  }

  // Série/norma: nunca aceitar valores que têm unidade elétrica.
  if (/\b(?:Hz|MVA|kVA|VA|kV|V|kA|A|kg|pF|°C)\b/i.test(out.numero_serie)) out.numero_serie = "";
  if (/\b(?:Hz|MVA|kVA|VA|kV|V|kA|A|kg|pF|°C)\b/i.test(out.norma)) out.norma = "";

  return out;
}

function normalizarTipo(v, tipoEscolhido) {
  const t = String(tipoEscolhido || "").toUpperCase();
  if (["A","B","C","N"].includes(t)) return "travessia";
  if (t === "TRANSFORMADOR") return "transformador";
  if (t === "REGULADOR") return "regulador";
  const s = limparTexto(v).toLowerCase();
  if (/transform/.test(s)) return "transformador";
  if (/regulador|oltc|tap/.test(s)) return "regulador";
  if (/travessia|bushing/.test(s)) return "travessia";
  return "";
}

function limparTexto(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return "";
  return v.trim();
}

function aceita(v, re) {
  const s = limparTexto(v);
  return s && re.test(s) ? s : "";
}

function apagarDuplicados(obj, grupos) {
  for (const grupo of grupos) {
    const mapa = {};
    for (const k of grupo) {
      const v = limparTexto(obj[k]).toLowerCase().replace(/\s+/g, " ");
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

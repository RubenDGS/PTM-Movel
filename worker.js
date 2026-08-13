const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const SCHEMA_ELETRICO = {
  type:"object",
  additionalProperties:false,
  properties:{
    bil:{type:"string"},
    tensao_fase_terra:{type:"string"},
    tensao_max_sistema:{type:"string"},
    corrente_nominal:{type:"string"},
    tipo_isolamento:{type:"string"},
    evidencias:{
      type:"object",
      additionalProperties:false,
      properties:{
        bil:{type:"string"},
        tensao_fase_terra:{type:"string"},
        tensao_max_sistema:{type:"string"},
        corrente_nominal:{type:"string"},
        tipo_isolamento:{type:"string"}
      },
      required:["bil","tensao_fase_terra","tensao_max_sistema","corrente_nominal","tipo_isolamento"]
    }
  },
  required:["bil","tensao_fase_terra","tensao_max_sistema","corrente_nominal","tipo_isolamento","evidencias"]
};

const SCHEMA_CAP = {
  type:"object",
  additionalProperties:false,
  properties:{
    fd_c1:{type:"string"},
    c1_pf:{type:"string"},
    fd_c2:{type:"string"},
    c2_pf:{type:"string"},
    evidencias:{
      type:"object",
      additionalProperties:false,
      properties:{
        fd_c1:{type:"string"},
        c1_pf:{type:"string"},
        fd_c2:{type:"string"},
        c2_pf:{type:"string"}
      },
      required:["fd_c1","c1_pf","fd_c2","c2_pf"]
    }
  },
  required:["fd_c1","c1_pf","fd_c2","c2_pf","evidencias"]
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers:CORS });

    const url = new URL(request.url);
    if (request.method !== "POST" || (url.pathname !== "/" && url.pathname !== "/analisar")) {
      return resposta({ok:false,erro:"Método ou endereço não permitido."},405);
    }
    if (!env.AI) return resposta({ok:false,erro:'Binding "AI" não encontrado.'},500);

    try {
      const body = await request.json();
      const images = Array.isArray(body.images) ? body.images : [];
      if (!images.length) return resposta({ok:false,erro:"Não foram recebidas fotografias."},400);

      const resultados = [];

      for (const item of images) {
        const nome = item.name || "Fotografia";
        const fase = String(item.fase || "").toUpperCase();
        const image = item.image || "";

        if (!["A","B","C","N"].includes(fase)) {
          resultados.push({nome,fase,erro:"Fase inválida. Escolhe A, B, C ou N."});
          continue;
        }
        if (!image) {
          resultados.push({nome,fase,erro:"Imagem não recebida."});
          continue;
        }

        try {
          const [eletrico, capacitivo] = await Promise.all([
            lerGrupo(env, image, promptEletrico(fase), SCHEMA_ELETRICO),
            lerGrupo(env, image, promptCapacitivo(fase), SCHEMA_CAP)
          ]);

          const combinado = {
            bil: eletrico?.bil || "",
            tensao_fase_terra: eletrico?.tensao_fase_terra || "",
            tensao_max_sistema: eletrico?.tensao_max_sistema || "",
            corrente_nominal: eletrico?.corrente_nominal || "",
            tipo_isolamento: eletrico?.tipo_isolamento || "",
            fd_c1: capacitivo?.fd_c1 || "",
            c1_pf: capacitivo?.c1_pf || "",
            fd_c2: capacitivo?.fd_c2 || "",
            c2_pf: capacitivo?.c2_pf || "",
            evidencias: {
              bil: eletrico?.evidencias?.bil || "",
              tensao_fase_terra: eletrico?.evidencias?.tensao_fase_terra || "",
              tensao_max_sistema: eletrico?.evidencias?.tensao_max_sistema || "",
              corrente_nominal: eletrico?.evidencias?.corrente_nominal || "",
              tipo_isolamento: eletrico?.evidencias?.tipo_isolamento || "",
              fd_c1: capacitivo?.evidencias?.fd_c1 || "",
              c1_pf: capacitivo?.evidencias?.c1_pf || "",
              fd_c2: capacitivo?.evidencias?.fd_c2 || "",
              c2_pf: capacitivo?.evidencias?.c2_pf || ""
            }
          };

          // FALLBACK: se algum campo importante ficou vazio, faz uma leitura
          // muito focada apenas nesse campo, sem voltar a interpretar a chapa toda.
          const faltam = [];
          for (const campo of ["bil","tensao_fase_terra","tensao_max_sistema","corrente_nominal","c1_pf","c2_pf"]) {
            if (!limpar(combinado[campo])) faltam.push(campo);
          }

          for (const campo of faltam) {
            const extra = await lerCampoUnico(env, image, fase, campo);
            if (extra?.valor) {
              combinado[campo] = extra.valor;
              combinado.evidencias[campo] = extra.evidencia || "";
            }
          }

          resultados.push({nome,fase,resultado:validar(combinado)});

        } catch (e) {
          resultados.push({nome,fase,erro:e?.message || String(e)});
        }
      }

      return resposta({ok:true,resultados});
    } catch (e) {
      return resposta({ok:false,erro:e?.message || String(e)},500);
    }
  }
};

async function lerGrupo(env, image, prompt, schema) {
  const raw = await env.AI.run(MODEL,{
    messages:[
      {
        role:"system",
        content:"Lê chapas técnicas de travessias elétricas com rigor. Usa só dados visíveis. Nunca inventes, calcules ou completes valores ausentes."
      },
      {
        role:"user",
        content:[
          {type:"text",text:prompt},
          {type:"image_url",image_url:{url:image}}
        ]
      }
    ],
    guided_json:schema,
    temperature:0,
    max_tokens:900,
    stream:false
  });

  return extrairObjeto(raw);
}


async function lerCampoUnico(env, image, fase, campo) {
  const mapa = {
    bil: `Procura APENAS o BIL/LI/Lightning Impulse da travessia ${fase}. Devolve o valor com unidade kV/V e uma evidência curta. Se não estiver visível, devolve vazio.`,
    tensao_fase_terra: `Procura APENAS a tensão fase-terra/phase-to-ground/phase-earth da travessia ${fase}. Nas chapas de referência este é o valor 72,5 kV, mas NÃO copies esse número se não estiver visível. Devolve só valor+unidade e evidência curta.`,
    tensao_max_sistema: `Procura APENAS a tensão máxima do sistema/equipamento da travessia ${fase}. Nas chapas de referência este é o valor 155 kV, mas NÃO copies esse número se não estiver visível. Devolve só valor+unidade e evidência curta.`,
    corrente_nominal: `Procura APENAS a corrente nominal Ir/Rated current da travessia ${fase}. Nas chapas de referência é 800 A, mas NÃO copies esse número se não estiver visível. Devolve só valor+unidade e evidência curta.`,
    c1_pf: `Procura APENAS a capacitância C1 da travessia ${fase}. Tem de ser o valor associado a C1 e em pF. Não devolvas FD/PF. Devolve só valor+unidade e evidência curta.`,
    c2_pf: `Procura APENAS a capacitância C2 da travessia ${fase}. Tem de ser o valor associado a C2 e em pF. Não devolvas FD/PF. Devolve só valor+unidade e evidência curta.`
  };

  const schema = {
    type:"object",
    additionalProperties:false,
    properties:{
      valor:{type:"string"},
      evidencia:{type:"string"}
    },
    required:["valor","evidencia"]
  };

  const raw = await env.AI.run(MODEL,{
    messages:[
      {role:"system",content:"Lê apenas um único campo de uma chapa técnica. Não inventes, não calcules e não uses valores de outros campos."},
      {role:"user",content:[
        {type:"text",text:mapa[campo]},
        {type:"image_url",image_url:{url:image}}
      ]}
    ],
    guided_json:schema,
    temperature:0,
    max_tokens:300,
    stream:false
  });

  const obj = extrairObjeto(raw);
  if (!obj || typeof obj !== "object") return null;
  return {valor:limpar(obj.valor), evidencia:limpar(obj.evidencia)};
}

function promptEletrico(fase) {
  return `Fotografia da travessia ${fase}.

Nesta passagem procura APENAS estes dados para os campos do PTM:
- bil = Nível de isolam. LL (BIL)
- tensao_fase_terra = tensão nominal/fase-terra da travessia
- tensao_max_sistema = tensão máxima indicada na chapa
- corrente_nominal = corrente nominal
- tipo_isolamento = tipo de isolamento, apenas se explícito

MAPEAMENTO DO PTM:
- O valor de tensão da classe/serviço da travessia, como 72,5 kV nas chapas de referência, vai para tensao_fase_terra.
- O valor superior de tensão máxima, como 155 kV nas chapas de referência, vai para tensao_max_sistema.
- BIL/LI, como 325 kV nas chapas de referência, vai para bil.
- Ir/Rated current, como 800 A nas chapas de referência, vai para corrente_nominal.
- Estes números são APENAS exemplos de mapeamento. NUNCA os copies se não estiverem visíveis na fotografia atual.

REGRAS RÍGIDAS:
- Lê os rótulos, a posição na tabela e a unidade antes de associar um valor.
- Procura explicitamente TODOS os valores de tensão visíveis antes de decidir qual pertence a cada campo.
- Não confundas 72,5 kV com 155 kV.
- Não confundas tensão (V/kV) com corrente (A/kA).
- corrente_nominal só pode resultar de um valor identificado como corrente nominal/Ir/Rated current.
- bil só pode resultar de BIL/LI/Lightning Impulse ou equivalente inequívoco.
- Não inventes, não calcules e não uses valores de outros campos.
- Se não conseguires distinguir tensao_fase_terra de tensao_max_sistema com segurança, deixa o campo incerto vazio.
- tipo_isolamento só se estiver explicitamente indicado, por exemplo OIP, RIP ou RBP.
- Em evidencias copia o rótulo/trecho curto da chapa que sustenta cada associação.
- Valores devem conter apenas número e unidade, por exemplo "72.5 kV", "155 kV", "800 A".`;
}
function promptCapacitivo(fase) {
  return `Fotografia da travessia ${fase}.

Nesta passagem procura APENAS:
- fd_c1: FD/PF/tan delta associado a C1
- c1_pf: capacitância C1 em pF
- fd_c2: FD/PF/tan delta associado a C2
- c2_pf: capacitância C2 em pF

REGRAS:
- Não confundas C1 com C2.
- C1 e C2 têm de vir com unidade pF.
- FD/PF pode vir em % ou decimal.
- Se um campo não existir ou não estiver legível, devolve "".
- Não inventes nem calcules.
- Em evidencias copia um rótulo curto da chapa que justifique o valor.`;
}

function extrairObjeto(raw) {
  if (raw && typeof raw.response === "object" && raw.response !== null) return raw.response;
  if (raw?.result && typeof raw.result.response === "object" && raw.result.response !== null) return raw.result.response;

  const candidatos = [
    raw?.response,
    raw?.result?.response,
    raw?.answer,
    raw?.result?.answer,
    typeof raw === "string" ? raw : null
  ].filter(v => typeof v === "string");

  for (const t of candidatos) {
    const o = parseJSONSeguro(t);
    if (o) return o;
  }
  return {};
}

function validar(x) {
  const out = {
    bil:"",
    tensao_fase_terra:"",
    tensao_max_sistema:"",
    corrente_nominal:"",
    fd_c1:"",
    c1_pf:"",
    fd_c2:"",
    c2_pf:"",
    tipo_isolamento:"",
    evidencias:{}
  };

  out.bil = extrairValorUnidade(x?.bil, "tensao");
  out.tensao_fase_terra = extrairValorUnidade(x?.tensao_fase_terra, "tensao");
  out.tensao_max_sistema = extrairValorUnidade(x?.tensao_max_sistema, "tensao");
  out.corrente_nominal = extrairValorUnidade(x?.corrente_nominal, "corrente");
  out.c1_pf = extrairValorUnidade(x?.c1_pf, "pf");
  out.c2_pf = extrairValorUnidade(x?.c2_pf, "pf");
  out.fd_c1 = validarFD(x?.fd_c1);
  out.fd_c2 = validarFD(x?.fd_c2);

  const ti = limpar(x?.tipo_isolamento);
  out.tipo_isolamento = sentinela(ti) ? "" : ti;

  // A evidência tem de ser compatível com o campo. Isto impede, por exemplo,
  // aceitar "800 A" como corrente se a evidência indicada pelo modelo for "Un 72.5 kV".
  const ev0 = x?.evidencias && typeof x.evidencias === "object" ? x.evidencias : {};
  if (out.corrente_nominal && !evidenciaCorrente(ev0.corrente_nominal)) out.corrente_nominal = "";
  if (out.bil && !evidenciaBIL(ev0.bil)) out.bil = "";

  if (
    out.tensao_fase_terra &&
    out.tensao_max_sistema &&
    normal(out.tensao_fase_terra) === normal(out.tensao_max_sistema)
  ) {
    out.tensao_fase_terra = "";
  }

  const ev = ev0;
  for (const k of [
    "bil","tensao_fase_terra","tensao_max_sistema","corrente_nominal",
    "fd_c1","c1_pf","fd_c2","c2_pf","tipo_isolamento"
  ]) {
    out.evidencias[k] = out[k] ? limpar(ev[k]) : "";
  }

  return out;
}

function extrairValorUnidade(v,tipo) {
  const s = limpar(v);
  if (!s || sentinela(s)) return "";

  let re;
  if (tipo === "tensao") re = /-?\d+(?:[.,]\d+)?\s*(?:kV|V)\b/i;
  else if (tipo === "corrente") re = /-?\d+(?:[.,]\d+)?\s*(?:kA|A)\b/i;
  else if (tipo === "pf") re = /-?\d+(?:[.,]\d+)?\s*pF\b/i;
  else return "";

  const m = s.match(re);
  return m ? m[0].trim() : "";
}

function validarFD(v) {
  const s = limpar(v);
  if (!s || sentinela(s)) return "";
  const m1 = s.match(/\d+(?:[.,]\d+)?\s*%/);
  if (m1) return m1[0].replace(/\s+/g," ").trim();
  const m2 = s.match(/^0?[.,]\d+$/);
  if (m2) return m2[0] + " %";
  return "";
}

function limpar(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return "";
  return v.trim();
}

function normal(v) {
  return limpar(v).toLowerCase().replace(/\s+/g," ");
}

function sentinela(v) {
  return /^(?:n\/?a|na|não indicado|nao indicado|unknown|desconhecido|none|null|-+)$/i.test(limpar(v));
}


function evidenciaCorrente(v) {
  const s = limpar(v);
  if (!s) return false;
  return /\b(?:Ir|rated\s*current|current\s*rating|corrente\s*nominal)\b/i.test(s) &&
         /\d+(?:[.,]\d+)?\s*(?:kA|A)\b/i.test(s);
}

function evidenciaBIL(v) {
  const s = limpar(v);
  if (!s) return false;
  return /\b(?:BIL|LI|lightning\s*impulse)\b/i.test(s) &&
         /\d+(?:[.,]\d+)?\s*(?:kV|V)?\b/i.test(s);
}

function parseJSONSeguro(texto) {
  let s = String(texto || "").trim()
    .replace(/^```(?:json)?\s*/i,"")
    .replace(/\s*```$/i,"");

  try { return JSON.parse(s); } catch {}

  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a,b+1)); } catch {}
  }
  return null;
}

function resposta(dados,status=200) {
  return new Response(JSON.stringify(dados,null,2),{
    status,
    headers:{
      ...CORS,
      "Content-Type":"application/json; charset=UTF-8",
      "Cache-Control":"no-store"
    }
  });
}

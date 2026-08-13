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
    fabricante:{type:"string"},
    numero_serie:{type:"string"},
    bil:{type:"string"},
    tensao_fase_terra:{type:"string"},
    tensao_max_sistema:{type:"string"},
    corrente_nominal:{type:"string"},
    evidencias:{
      type:"object",
      additionalProperties:false,
      properties:{
        fabricante:{type:"string"},
        numero_serie:{type:"string"},
        bil:{type:"string"},
        tensao_fase_terra:{type:"string"},
        tensao_max_sistema:{type:"string"},
        corrente_nominal:{type:"string"}
      },
      required:["fabricante","numero_serie","bil","tensao_fase_terra","tensao_max_sistema","corrente_nominal"]
    }
  },
  required:["fabricante","numero_serie","bil","tensao_fase_terra","tensao_max_sistema","corrente_nominal","evidencias"]
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
            fabricante: eletrico?.fabricante || "",
            numero_serie: eletrico?.numero_serie || "",
            bil: eletrico?.bil || "",
            tensao_fase_terra: eletrico?.tensao_fase_terra || "",
            tensao_max_sistema: eletrico?.tensao_max_sistema || "",
            corrente_nominal: eletrico?.corrente_nominal || "",
            fd_c1: capacitivo?.fd_c1 || "",
            c1_pf: capacitivo?.c1_pf || "",
            fd_c2: capacitivo?.fd_c2 || "",
            c2_pf: capacitivo?.c2_pf || "",
            evidencias: {
              fabricante: eletrico?.evidencias?.fabricante || "",
              numero_serie: eletrico?.evidencias?.numero_serie || "",
              bil: eletrico?.evidencias?.bil || "",
              tensao_fase_terra: eletrico?.evidencias?.tensao_fase_terra || "",
              tensao_max_sistema: eletrico?.evidencias?.tensao_max_sistema || "",
              corrente_nominal: eletrico?.evidencias?.corrente_nominal || "",
              fd_c1: capacitivo?.evidencias?.fd_c1 || "",
              c1_pf: capacitivo?.evidencias?.c1_pf || "",
              fd_c2: capacitivo?.evidencias?.fd_c2 || "",
              c2_pf: capacitivo?.evidencias?.c2_pf || ""
            }
          };

          // FALLBACK: se algum campo importante ficou vazio, faz uma leitura
          // muito focada apenas nesse campo, sem voltar a interpretar a chapa toda.
          const faltam = [];
          for (const campo of ["fabricante","numero_serie","bil","tensao_fase_terra","tensao_max_sistema","corrente_nominal","c1_pf","c2_pf"]) {
            if (!limpar(combinado[campo])) faltam.push(campo);
          }

          // Mesma sequência, sem exceções, para A, B, C e N.
          // Nunca volta a mexer num campo que já foi lido.
          const ordemPTM = [
            "fabricante",
            "numero_serie",
            "bil",
            "tensao_fase_terra",
            "tensao_max_sistema",
            "corrente_nominal",
            "fd_c1",
            "c1_pf",
            "fd_c2",
            "c2_pf"
          ];

          for (const campo of ordemPTM) {
            if (limpar(combinado[campo])) continue;

            // Uma única recuperação focada para o campo em falta.
            // É exatamente a mesma rotina independentemente da fase.
            const extra = await lerCampoSequencial(env, image, fase, campo);
            const valor = validarCampoFallback(campo, extra?.valor, extra?.evidencia);

            if (valor) {
              combinado[campo] = valor;
              combinado.evidencias[campo] = extra?.evidencia || "";
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



async function lerCampoSequencial(env, image, fase, campo) {
  const instrucoes = {
    fabricante:
      `Travessia ${fase}. Lê SOMENTE o fabricante visível na chapa. Não devolvas modelo, país, norma ou série.`,
    numero_serie:
      `Travessia ${fase}. Lê SOMENTE o número de série / Serial No. / S.N. visível na chapa. Não confundas com modelo, ano ou valores elétricos.`,
    bil:
      `Travessia ${fase}. Lê SOMENTE o Nível de isolamento LL, identificado por BIL/LI/Lightning Impulse ou equivalente. Devolve valor em kV/V.`,
    tensao_fase_terra:
      `Travessia ${fase}. Lê SOMENTE a Tensão Fase-Terra usada no PTM. Nas chapas de referência 72,5 kV ocupa este campo, mas o número tem de ser lido da fotografia atual.`,
    tensao_max_sistema:
      `Travessia ${fase}. Lê SOMENTE a Tensão máxima do sistema usada no PTM. Nas chapas de referência 155 kV ocupa este campo, mas o número tem de ser lido da fotografia atual.`,
    corrente_nominal:
      `Travessia ${fase}. Lê SOMENTE a corrente nominal Ir/Rated current. O resultado tem de estar em A ou kA. Não uses Un, Um ou qualquer valor em kV.`,
    fd_c1:
      `Travessia ${fase}. Lê SOMENTE FD/P.F./tan delta associado a C1. Não devolvas a capacitância em pF.`,
    c1_pf:
      `Travessia ${fase}. Lê SOMENTE a capacitância C1. O resultado tem de ser o número em pF associado a C1. Não devolvas FD/P.F.`,
    fd_c2:
      `Travessia ${fase}. Lê SOMENTE FD/P.F./tan delta associado a C2. Não devolvas a capacitância em pF.`,
    c2_pf:
      `Travessia ${fase}. Lê SOMENTE a capacitância C2. O resultado tem de ser o número em pF associado a C2. Não devolvas FD/P.F.`
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
      {
        role:"system",
        content:"Extrai exatamente um campo de uma chapa técnica. Usa apenas o que está visível na fotografia. Não inventes, não calcules e não reutilizes valores de exemplos."
      },
      {
        role:"user",
        content:[
          {type:"text",text:instrucoes[campo] + "\\nSe não estiver legível, devolve valor vazio. Em evidencia copia o rótulo/trecho que sustenta a leitura."},
          {type:"image_url",image_url:{url:image}}
        ]
      }
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

async function lerCampoUnico(env, image, fase, campo, modo='normal') {
  const mapa = {
    fabricante: `Procura APENAS o nome do FABRICANTE da travessia ${fase}. Não devolvas modelo, país, norma ou número de série. Devolve exatamente o fabricante visível e uma evidência curta. Se não estiver legível, devolve vazio.`,
    numero_serie: `Procura APENAS o NÚMERO DE SÉRIE / Serial No. / S.N. da travessia ${fase}. Não confundas com modelo, tipo, ano ou valores elétricos. Devolve exatamente o número/código visível e uma evidência curta. Se não estiver legível, devolve vazio.`,
    bil: `Procura APENAS o BIL/LI/Lightning Impulse da travessia ${fase}. Devolve o valor com unidade kV/V e uma evidência curta. Se não estiver visível, devolve vazio.`,
    tensao_fase_terra: `Procura APENAS a tensão fase-terra/phase-to-ground/phase-earth da travessia ${fase}. Nas chapas de referência este é o valor 72,5 kV, mas NÃO copies esse número se não estiver visível. Devolve só valor+unidade e evidência curta.`,
    tensao_max_sistema: `Procura APENAS a tensão máxima do sistema/equipamento da travessia ${fase}. Nas chapas de referência este é o valor 155 kV, mas NÃO copies esse número se não estiver visível. Devolve só valor+unidade e evidência curta.`,
    corrente_nominal: `Procura APENAS a corrente nominal Ir/Rated current da travessia ${fase}. Localiza primeiro o rótulo "Ir", "Rated current" ou equivalente e lê o número em A/kA imediatamente associado. Nas chapas de referência é 800 A, mas NÃO copies esse número se não estiver visível. Não aceites Un, Um, kV, C1, C2 ou BIL. Devolve só valor+unidade e uma evidência que contenha o rótulo de corrente e o valor.`,
    c1_pf: `Procura APENAS a CAPACITÂNCIA C1 da travessia ${fase}. Localiza literalmente "C1" e depois o respetivo número cuja unidade é pF. NÃO devolvas o P.F./FD/tan delta que costuma aparecer perto de C1. O resultado só é válido se houver um número em pF associado a C1. Devolve valor+unidade e evidência incluindo "C1" e "pF".`,
    c2_pf: `Procura APENAS a CAPACITÂNCIA C2 da travessia ${fase}. Localiza literalmente "C2" e depois o respetivo número cuja unidade é pF. NÃO devolvas o P.F./FD/tan delta que costuma aparecer perto de C2. O resultado só é válido se houver um número em pF associado a C2. Devolve valor+unidade e evidência incluindo "C2" e "pF".`
  };

  const estrategia = {
    normal: "Lê o rótulo e o valor associado.",
    linha: "Segue visualmente a mesma linha/célula do rótulo até ao respetivo valor; não uses números da linha vizinha.",
    visual: "Ignora os restantes dados e faz uma inspeção visual minuciosa apenas da pequena zona onde este campo aparece."
  }[modo] || "";

  mapa[campo] += "\nESTRATÉGIA DESTA TENTATIVA: " + estrategia;

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

Nesta passagem procura APENAS:
- fabricante = nome do fabricante da própria travessia
- numero_serie = número de série / Serial No. / S.N. da própria travessia
- bil = Nível de isolam. LL (BIL)
- tensao_fase_terra = tensão fase-terra usada no PTM
- tensao_max_sistema = tensão máxima usada no PTM
- corrente_nominal = Ir / corrente nominal

MAPEAMENTO DOS CAMPOS DO PTM:
- Nas chapas de referência, 72,5 kV corresponde a Tensão Fase-Terra.
- Nas chapas de referência, 155 kV corresponde a Tensão máxima.
- Nas chapas de referência, 325 kV corresponde a BIL.
- Nas chapas de referência, 800 A corresponde a Corrente nominal.
- Estes valores são SÓ exemplos para compreender a posição/semântica dos campos. Nunca os copies se não estiverem visíveis na fotografia atual.

REGRAS:
- Cada fotografia é independente. Fabricante e número de série têm de vir desta fotografia.
- Não copies fabricante ou série de outra travessia.
- Não confundas número de série com modelo, tipo, ano, BIL, tensão, corrente, C1 ou C2.
- Não confundas 72,5 kV com 155 kV.
- Não confundas tensão com corrente.
- Se não estiver visível ou a associação não for segura, devolve "".
- Não inventes nem calcules.
- Em evidencias copia um rótulo/trecho curto que justifique cada campo.
- Valores elétricos devem conter apenas número e unidade.`;
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
    fabricante:"",
    numero_serie:"",
    bil:"",
    tensao_fase_terra:"",
    tensao_max_sistema:"",
    corrente_nominal:"",
    fd_c1:"",
    c1_pf:"",
    fd_c2:"",
    c2_pf:"",
    evidencias:{}
  };

  out.fabricante = validarTexto(x?.fabricante, 80);
  out.numero_serie = validarTexto(x?.numero_serie, 60);
  out.bil = extrairValorUnidade(x?.bil, "tensao");
  out.tensao_fase_terra = extrairValorUnidade(x?.tensao_fase_terra, "tensao");
  out.tensao_max_sistema = extrairValorUnidade(x?.tensao_max_sistema, "tensao");
  out.corrente_nominal = extrairValorUnidade(x?.corrente_nominal, "corrente");
  out.c1_pf = extrairValorUnidade(x?.c1_pf, "pf");
  out.c2_pf = extrairValorUnidade(x?.c2_pf, "pf");
  out.fd_c1 = validarFD(x?.fd_c1);
  out.fd_c2 = validarFD(x?.fd_c2);

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
    "fabricante","numero_serie","bil","tensao_fase_terra","tensao_max_sistema","corrente_nominal",
    "fd_c1","c1_pf","fd_c2","c2_pf"
  ]) {
    out.evidencias[k] = out[k] ? limpar(ev[k]) : "";
  }

  return out;
}

function validarCampoFallback(campo, valor, evidencia) {
  const v=limpar(valor), e=limpar(evidencia);
  if(!v || sentinela(v)) return "";

  if(campo==="corrente_nominal") {
    const vv=extrairValorUnidade(v,"corrente");
    if(!vv) return "";
    // Evidence must not be voltage-only. Prefer explicit current labels,
    // but also accept a clean A/kA evidence from a single-field read.
    if(/\b(?:Un|Um|kV|volt)\b/i.test(e) && !/\b(?:Ir|rated\\s*current|current|corrente)\b/i.test(e)) return "";
    return vv;
  }

  if(campo==="c1_pf" || campo==="c2_pf") {
    const vv=extrairValorUnidade(v,"pf");
    if(!vv) return "";
    const tag=campo==="c1_pf" ? /\\bC1\\b/i : /\\bC2\\b/i;
    // The evidence should point to the correct capacitor. If the model
    // returns only "299 pF", accept it because this pass asked for one field only.
    if(e && /\\bC[12]\\b/i.test(e) && !tag.test(e)) return "";
    return vv;
  }

  if(campo==="bil") return extrairValorUnidade(v,"tensao");
  if(campo==="tensao_fase_terra" || campo==="tensao_max_sistema") return extrairValorUnidade(v,"tensao");
  if(campo==="fabricante" || campo==="numero_serie") return validarTexto(v,80);
  return v;
}

function validarTexto(v,max) {
  const x=limpar(v);
  if(!x || sentinela(x) || x.length>max) return "";
  return x;
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

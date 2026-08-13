const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bil: { type: "string" },
    tensao_fase_terra: { type: "string" },
    tensao_max_sistema: { type: "string" },
    corrente_nominal: { type: "string" },
    fd_c1: { type: "string" },
    c1_pf: { type: "string" },
    fd_c2: { type: "string" },
    c2_pf: { type: "string" },
    tipo_isolamento: { type: "string" },
    evidencias: {
      type: "object",
      additionalProperties: false,
      properties: {
        bil: { type: "string" },
        tensao_fase_terra: { type: "string" },
        tensao_max_sistema: { type: "string" },
        corrente_nominal: { type: "string" },
        fd_c1: { type: "string" },
        c1_pf: { type: "string" },
        fd_c2: { type: "string" },
        c2_pf: { type: "string" },
        tipo_isolamento: { type: "string" }
      },
      required: [
        "bil","tensao_fase_terra","tensao_max_sistema","corrente_nominal",
        "fd_c1","c1_pf","fd_c2","c2_pf","tipo_isolamento"
      ]
    }
  },
  required: [
    "bil","tensao_fase_terra","tensao_max_sistema","corrente_nominal",
    "fd_c1","c1_pf","fd_c2","c2_pf","tipo_isolamento","evidencias"
  ]
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

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
        const nome = item.name || "Fotografia";
        const fase = String(item.fase || "").toUpperCase();
        const image = item.image || "";

        if (!["A","B","C","N"].includes(fase)) {
          resultados.push({ nome, fase, erro:"Fase inválida. Escolhe A, B, C ou N." });
          continue;
        }

        if (!image) {
          resultados.push({ nome, fase, erro:"Imagem não recebida." });
          continue;
        }

        try {
          const prompt = criarPergunta(fase);

          const raw = await env.AI.run(MODEL, {
            messages: [
              {
                role: "system",
                content: "És um leitor técnico de chapas de travessias elétricas. Extrai apenas dados explicitamente visíveis. Nunca inventes nem calcules valores em falta."
              },
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  { type: "image_url", image_url: { url: image } }
                ]
              }
            ],
            guided_json: SCHEMA,
            temperature: 0,
            max_tokens: 1200,
            stream: false
          });

          const obj = extrairObjeto(raw);

          if (!obj) {
            resultados.push({
              nome,
              fase,
              erro:"O modelo não devolveu dados estruturados utilizáveis."
            });
            continue;
          }

          resultados.push({
            nome,
            fase,
            resultado: validar(obj)
          });

        } catch (e) {
          resultados.push({
            nome,
            fase,
            erro: e?.message || String(e)
          });
        }
      }

      return resposta({ ok:true, resultados });

    } catch (e) {
      return resposta({ ok:false, erro:e?.message || String(e) }, 500);
    }
  }
};

function criarPergunta(fase) {
  return `Esta fotografia é da travessia ${fase}.

Preenche APENAS uma linha da secção "Travessias" do PTM com estes campos:

1. bil = Nível de isolam. LL (BIL)
2. tensao_fase_terra = Tensão Fase-Terra
3. tensao_max_sistema = Tensão máx. do sistema
4. corrente_nominal = Corrente nominal
5. fd_c1 = FD (C1)
6. c1_pf = Cap. (C1)
7. fd_c2 = FD (C2)
8. c2_pf = Cap. (C2)
9. tipo_isolamento = Tipo de isolamento

REGRAS:
- Usa somente informação que esteja realmente escrita/visível na chapa.
- Não calcules e não deduzas valores.
- Se um campo não existir, não estiver legível, ou não houver associação inequívoca, devolve string vazia "".
- Nunca uses "N/A", "não indicado", "unknown" ou equivalentes: usa "".
- Não dupliques um valor entre campos diferentes.
- BIL, LI ou Lightning Impulse -> bil.
- Um, Highest voltage for equipment, Maximum system voltage -> tensao_max_sistema.
- Ir, Rated current, Current rating -> corrente_nominal.
- C1 com unidade pF -> c1_pf.
- C2 com unidade pF -> c2_pf.
- FD C1, PF C1, power factor C1, tan delta C1 -> fd_c1.
- FD C2, PF C2, power factor C2, tan delta C2 -> fd_c2.
- tensao_fase_terra só pode ser preenchida se estiver explicitamente identificada como fase-terra, phase-to-ground, phase-earth ou equivalente inequívoco. NÃO uses Um nesse campo.
- tipo_isolamento só pode ser preenchido se estiver explicitamente identificado, por exemplo OIP, RIP, RBP ou descrição inequívoca.
- Não devolvas fabricante, modelo, número de série, ano ou qualquer outro dado.
- Em evidencias, copia apenas um rótulo curto da chapa que justifique cada valor preenchido.`;
}

function extrairObjeto(raw) {
  // guided_json pode vir já como objeto em response
  if (raw && typeof raw.response === "object" && raw.response !== null) {
    return raw.response;
  }
  if (raw?.result && typeof raw.result.response === "object" && raw.result.response !== null) {
    return raw.result.response;
  }

  const textos = [
    raw?.response,
    raw?.result?.response,
    raw?.answer,
    raw?.result?.answer,
    typeof raw === "string" ? raw : null
  ].filter(v => typeof v === "string");

  for (const texto of textos) {
    const obj = parseJSONSeguro(texto);
    if (obj) return obj;
  }

  return null;
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

  out.bil = aceita(x?.bil, /\b(?:kV|V)\b/i);
  out.tensao_fase_terra = aceita(x?.tensao_fase_terra, /\b(?:kV|V)\b/i);
  out.tensao_max_sistema = aceita(x?.tensao_max_sistema, /\b(?:kV|V)\b/i);
  out.corrente_nominal = aceita(x?.corrente_nominal, /\b(?:kA|A)\b/i);

  out.c1_pf = aceita(x?.c1_pf, /\bpF\b/i);
  out.c2_pf = aceita(x?.c2_pf, /\bpF\b/i);

  out.fd_c1 = validarFD(x?.fd_c1);
  out.fd_c2 = validarFD(x?.fd_c2);

  const ti = limpar(x?.tipo_isolamento);
  out.tipo_isolamento = ti.length <= 60 ? ti : "";

  // Não aceita valores sentinela como N/A
  for (const k of [
    "bil","tensao_fase_terra","tensao_max_sistema","corrente_nominal",
    "fd_c1","c1_pf","fd_c2","c2_pf","tipo_isolamento"
  ]) {
    if (sentinela(out[k])) out[k] = "";
  }

  // Um e Tensão Fase-Terra não podem ser o mesmo valor por simples duplicação.
  if (
    out.tensao_fase_terra &&
    out.tensao_max_sistema &&
    normal(out.tensao_fase_terra) === normal(out.tensao_max_sistema)
  ) {
    out.tensao_fase_terra = "";
  }

  const ev = x?.evidencias && typeof x.evidencias === "object" ? x.evidencias : {};
  for (const k of [
    "bil","tensao_fase_terra","tensao_max_sistema","corrente_nominal",
    "fd_c1","c1_pf","fd_c2","c2_pf","tipo_isolamento"
  ]) {
    out.evidencias[k] = out[k] ? limpar(ev[k]) : "";
  }

  return out;
}

function limpar(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return "";
  return v.trim();
}

function normal(v) {
  return limpar(v).toLowerCase().replace(/\s+/g, " ");
}

function sentinela(v) {
  return /^(?:n\/?a|na|não indicado|nao indicado|unknown|desconhecido|none|null|-+)$/i.test(limpar(v));
}

function aceita(v, re) {
  const s = limpar(v);
  if (!s || sentinela(s)) return "";
  return re.test(s) ? s : "";
}

function validarFD(v) {
  const s = limpar(v);
  if (!s || sentinela(s)) return "";
  if (/^\d+(?:[.,]\d+)?\s*%$/.test(s)) return s;
  if(/^0?[.,]\d+$/.test(s)) return s;
  return "";
}

function parseJSONSeguro(texto) {
  let s = String(texto || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try { return JSON.parse(s); } catch {}

  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch {}
  }
  return null;
}

function resposta(dados, status = 200) {
  return new Response(JSON.stringify(dados, null, 2), {
    status,
    headers: {
      ...CORS,
      "Content-Type":"application/json; charset=UTF-8",
      "Cache-Control":"no-store"
    }
  });
}

const VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    fabricante: { type: "string" },
    numero_serie: { type: "string" },
    bil: { type: "string" },
    tensao_fase_terra: { type: "string" },
    tensao_max_sistema: { type: "string" },
    corrente_nominal: { type: "string" },
    fd_c1: { type: "string" },
    c1_pf: { type: "string" },
    fd_c2: { type: "string" },
    c2_pf: { type: "string" },
    evidencias: {
      type: "object",
      additionalProperties: false,
      properties: {
        fabricante: { type: "string" },
        numero_serie: { type: "string" },
        bil: { type: "string" },
        tensao_fase_terra: { type: "string" },
        tensao_max_sistema: { type: "string" },
        corrente_nominal: { type: "string" },
        fd_c1: { type: "string" },
        c1_pf: { type: "string" },
        fd_c2: { type: "string" },
        c2_pf: { type: "string" }
      },
      required: [
        "fabricante","numero_serie","bil","tensao_fase_terra",
        "tensao_max_sistema","corrente_nominal","fd_c1","c1_pf",
        "fd_c2","c2_pf"
      ]
    }
  },
  required: [
    "fabricante","numero_serie","bil","tensao_fase_terra",
    "tensao_max_sistema","corrente_nominal","fd_c1","c1_pf",
    "fd_c2","c2_pf","evidencias"
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

      const processar = async (item) => {
        const nome = item.name || "Fotografia";
        const fase = String(item.fase || "").toUpperCase();
        const image = item.image || "";

        if (!["A","B","C","N"].includes(fase)) {
          return { nome, fase, erro:"Fase inválida. Escolhe A, B, C ou N." };
        }

        if (!image) {
          return { nome, fase, erro:"Imagem não recebida." };
        }

        try {
          // 1) Leitura visual principal.
          const direto = await lerVisual(env, image);
          const validadoDireto = validar(direto);

          // 2) Só chama o segundo motor se ainda houver campos importantes vazios.
          const faltam = camposEmFalta(validadoDireto);

          if (!faltam.length) {
            return {
              nome,
              fase,
              resultado: validadoDireto,
              transcricao: ""
            };
          }

          // 3) Transcrição independente apenas como fallback.
          const transcricao = await transcreverImagem(env, nome, image);

          if (!transcricao) {
            return {
              nome,
              fase,
              resultado: validadoDireto,
              transcricao: ""
            };
          }

          // 4) Organiza apenas os campos que faltam.
          const doTexto = await organizarTranscricao(env, transcricao, faltam);
          const combinado = combinarSemSobrescrever(direto, doTexto);

          return {
            nome,
            fase,
            resultado: validar(combinado),
            transcricao
          };

        } catch (e) {
          return {
            nome,
            fase,
            erro: e?.message || String(e)
          };
        }
      };

      // As quatro fotografias são tratadas em paralelo para não ficar
      // "a pensar" uma a uma durante muito tempo.
      const resultados = await Promise.all(images.map(processar));
      return resposta({ ok:true, resultados });

    } catch (e) {
      return resposta({ ok:false, erro:e?.message || String(e) }, 500);
    }
  }
};

async function lerVisual(env, image) {
  const raw = await env.AI.run(VISION_MODEL, {
    messages: [
      {
        role: "system",
        content:
          "Lê chapas técnicas de travessias elétricas com rigor. " +
          "Extrai apenas informação realmente visível. Não inventes, não calcules e não completes por semelhança."
      },
      {
        role: "user",
        content: [
          { type:"text", text: promptCampos("fotografia") },
          { type:"image_url", image_url:{ url:image } }
        ]
      }
    ],
    guided_json: SCHEMA,
    temperature: 0,
    max_tokens: 1200,
    stream: false
  });

  return extrairObjeto(raw) || vazio();
}

async function transcreverImagem(env, nome, dataUrl) {
  try {
    const { mime, bytes } = dataUrlParaBytes(dataUrl);
    const blob = new Blob([bytes], { type: mime || "image/jpeg" });

    const convertido = await env.AI.toMarkdown({
      name: nome || "travessia.jpg",
      blob
    });

    if (Array.isArray(convertido)) {
      const primeiro = convertido[0];
      return typeof primeiro?.data === "string" ? primeiro.data : "";
    }

    return typeof convertido?.data === "string" ? convertido.data : "";
  } catch (e) {
    // A transcrição é um segundo motor. Se falhar, a leitura visual continua válida.
    return "";
  }
}

async function organizarTranscricao(env, texto, faltam) {
  const raw = await env.AI.run(VISION_MODEL, {
    messages: [
      {
        role: "system",
        content:
          "Recebes uma transcrição textual de uma chapa técnica. " +
          "Não inventes valores que não estejam literalmente presentes no texto."
      },
      {
        role: "user",
        content:
          promptCampos("transcrição") +
          "\n\nPREENCHE APENAS ESTES CAMPOS QUE A LEITURA VISUAL NÃO CONSEGUIU: " +
          (Array.isArray(faltam) ? faltam.join(", ") : "") +
          "\nOs restantes devem ficar vazios." +
          "\n\nTRANSCRIÇÃO DA CHAPA:\n" + texto
      }
    ],
    guided_json: SCHEMA,
    temperature: 0,
    max_tokens: 1200,
    stream: false
  });

  return extrairObjeto(raw) || vazio();
}

function promptCampos(origem) {
  return `A ${origem} corresponde a UMA travessia elétrica.

Extrai exatamente estes campos:
- fabricante
- numero_serie
- bil = Nível de isolamento LL / BIL / LI / Lightning Impulse
- tensao_fase_terra = tensão Fase-Terra usada no PTM
- tensao_max_sistema = tensão máxima do sistema usada no PTM
- corrente_nominal = Ir / Rated current / corrente nominal
- fd_c1 = FD / P.F. / tan delta associado a C1
- c1_pf = capacitância C1 em pF
- fd_c2 = FD / P.F. / tan delta associado a C2
- c2_pf = capacitância C2 em pF

MAPEAMENTO DO PTM:
- Nas chapas de referência, o valor 72,5 kV corresponde a Tensão Fase-Terra.
- Nas chapas de referência, o valor 155 kV corresponde a Tensão máxima.
- Nas chapas de referência, o valor 325 kV corresponde a BIL.
- Nas chapas de referência, Ir 800 A corresponde à corrente nominal.
Estes números são apenas exemplos de POSIÇÃO/SEMÂNTICA. Nunca os copies se não estiverem na fonte atual.

REGRAS:
- Lê todos os valores da própria chapa.
- Não confundas 72,5 kV com 155 kV.
- Não confundas A/kA com V/kV.
- C1 e C2 têm de ser os valores em pF, não o FD/P.F.
- FD C1 e FD C2 são os fatores associados respetivamente a C1 e C2.
- Número de série não é modelo, ano nem valor elétrico.
- Se um campo não estiver presente ou não for legível, devolve "".
- Nunca devolvas N/A, unknown ou valores inventados.
- Em evidencias inclui um pequeno trecho/rótulo que sustente cada valor preenchido.
- Nos campos elétricos devolve apenas valor e unidade, sem o nome do campo.`;
}

function camposEmFalta(x) {
  const essenciais = [
    "fabricante","numero_serie","bil","tensao_fase_terra",
    "tensao_max_sistema","corrente_nominal","fd_c1","c1_pf",
    "fd_c2","c2_pf"
  ];
  return essenciais.filter(k => !limpar(x?.[k]));
}

function combinarSemSobrescrever(principal, auxiliar) {
  const campos = [
    "fabricante","numero_serie","bil","tensao_fase_terra",
    "tensao_max_sistema","corrente_nominal","fd_c1","c1_pf",
    "fd_c2","c2_pf"
  ];

  const out = vazio();

  for (const campo of campos) {
    const a = limpar(principal?.[campo]);
    const b = limpar(auxiliar?.[campo]);

    if (a) {
      out[campo] = a;
      out.evidencias[campo] = limpar(principal?.evidencias?.[campo]);
    } else if (b) {
      out[campo] = b;
      out.evidencias[campo] =
        "Transcrição: " + limpar(auxiliar?.evidencias?.[campo]);
    }
  }

  return out;
}

function validar(x) {
  const out = vazio();

  out.fabricante = validarTexto(x?.fabricante, 80);
  out.numero_serie = validarTexto(x?.numero_serie, 60);

  out.bil = extrairValorUnidade(x?.bil, "tensao");
  out.tensao_fase_terra = extrairValorUnidade(x?.tensao_fase_terra, "tensao");
  out.tensao_max_sistema = extrairValorUnidade(x?.tensao_max_sistema, "tensao");
  out.corrente_nominal = extrairValorUnidade(x?.corrente_nominal, "corrente");

  out.fd_c1 = validarFD(x?.fd_c1);
  out.c1_pf = extrairValorUnidade(x?.c1_pf, "pf");
  out.fd_c2 = validarFD(x?.fd_c2);
  out.c2_pf = extrairValorUnidade(x?.c2_pf, "pf");

  const ev = x?.evidencias && typeof x.evidencias === "object" ? x.evidencias : {};

  // Proteção adicional contra associação absurda de corrente/tensão.
  if (
    out.corrente_nominal &&
    /\b(?:kV|V)\b/i.test(limpar(ev.corrente_nominal)) &&
    !/\b(?:Ir|rated\s*current|current|corrente)\b/i.test(limpar(ev.corrente_nominal))
  ) {
    out.corrente_nominal = "";
  }

  // Proteção contra C1/C2 cruzados quando a evidência nomeia o condensador errado.
  if (out.c1_pf && /\bC2\b/i.test(limpar(ev.c1_pf)) && !/\bC1\b/i.test(limpar(ev.c1_pf))) {
    out.c1_pf = "";
  }
  if (out.c2_pf && /\bC1\b/i.test(limpar(ev.c2_pf)) && !/\bC2\b/i.test(limpar(ev.c2_pf))) {
    out.c2_pf = "";
  }

  for (const k of Object.keys(out.evidencias)) {
    out.evidencias[k] = out[k] ? limpar(ev[k]) : "";
  }

  return out;
}

function vazio() {
  return {
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
    evidencias:{
      fabricante:"",
      numero_serie:"",
      bil:"",
      tensao_fase_terra:"",
      tensao_max_sistema:"",
      corrente_nominal:"",
      fd_c1:"",
      c1_pf:"",
      fd_c2:"",
      c2_pf:""
    }
  };
}

function dataUrlParaBytes(dataUrl) {
  const s = String(dataUrl || "");
  const m = s.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i);

  if (!m) {
    throw new Error("Formato de imagem inválido.");
  }

  const mime = m[1] || "image/jpeg";
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);

  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }

  return { mime, bytes };
}

function extrairObjeto(raw) {
  if (raw && typeof raw.response === "object" && raw.response !== null) {
    return raw.response;
  }

  if (raw?.result && typeof raw.result.response === "object" && raw.result.response !== null) {
    return raw.result.response;
  }

  const candidatos = [
    raw?.response,
    raw?.result?.response,
    raw?.answer,
    raw?.result?.answer,
    typeof raw === "string" ? raw : null
  ].filter(v => typeof v === "string");

  for (const t of candidatos) {
    const obj = parseJSONSeguro(t);
    if (obj) return obj;
  }

  return null;
}

function validarTexto(v, max) {
  const s = limpar(v);
  if (!s || sentinela(s) || s.length > max) return "";
  return s;
}

function extrairValorUnidade(v, tipo) {
  const s = limpar(v);
  if (!s || sentinela(s)) return "";

  let re;

  if (tipo === "tensao") {
    re = /-?\d+(?:[.,]\d+)?\s*(?:kV|V)\b/i;
  } else if (tipo === "corrente") {
    re = /-?\d+(?:[.,]\d+)?\s*(?:kA|A)\b/i;
  } else if (tipo === "pf") {
    re = /-?\d+(?:[.,]\d+)?\s*pF\b/i;
  } else {
    return "";
  }

  const m = s.match(re);
  return m ? m[0].trim() : "";
}

function validarFD(v) {
  const s = limpar(v);
  if (!s || sentinela(s)) return "";

  const p = s.match(/\d+(?:[.,]\d+)?\s*%/);
  if (p) return p[0].replace(/\s+/g, " ").trim();

  const d = s.match(/^0?[.,]\d+$/);
  if (d) return d[0] + " %";

  return "";
}

function limpar(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return "";
  return v.trim();
}

function sentinela(v) {
  return /^(?:n\/?a|na|não indicado|nao indicado|unknown|desconhecido|none|null|-+)$/i.test(limpar(v));
}

function parseJSONSeguro(texto) {
  let s = String(texto || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(s);
  } catch {}

  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");

  if (a >= 0 && b > a) {
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch {}
  }

  return null;
}

function resposta(dados, status = 200) {
  return new Response(JSON.stringify(dados, null, 2), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

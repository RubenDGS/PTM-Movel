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
        const tipo = String(item.tipo || "AUTO").toUpperCase();
        const image = item.image || item.imagem || "";

        if (!image) {
          resultados.push({ nome, tipo, erro:"Imagem não recebida." });
          continue;
        }

        try {
          const raw = await env.AI.run(MODEL, {
            task: "query",
            image,
            question: criarPergunta(tipo),
            reasoning: false,
            temperature: 0,
            max_tokens: 7000,
            stream: false
          });

          const texto = extrairTexto(raw);

          if (!texto) {
            resultados.push({
              nome,
              tipo,
              erro:"Não foi possível transcrever a chapa."
            });
            continue;
          }

          resultados.push({
            nome,
            tipo,
            resultado: parseChapa(texto, tipo),
            texto_lido: texto
          });

        } catch (e) {
          resultados.push({
            nome,
            tipo,
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

function criarPergunta(tipo) {
  return `Faz OCR técnico desta chapa.

Contexto dado pelo utilizador: ${tipo}

NÃO interpretes os valores e NÃO os distribuas por campos.
NÃO devolvas JSON.
NÃO inventes.

Transcreve literalmente tudo o que conseguires ler:
- cabeçalhos
- rótulos
- números
- unidades
- colunas AT/BT ou HV/LV
- linhas de tabelas
- dados do regulador
- dados de travessias

Mantém cada linha da chapa numa linha separada.
Quando houver um cabeçalho de unidade, mantém a unidade junto do cabeçalho.
Se houver uma tabela, transcreve as colunas e depois cada linha.
Se algo estiver ilegível escreve [ILEGÍVEL].

Devolve APENAS a transcrição.`;
}

function parseChapa(texto, tipo) {
  const linhas = String(texto || "")
    .replace(/\r/g, "")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  const all = linhas.join("\n");

  const r = {
    tipo_chapa: inferirTipo(all, tipo),
    fabricante: extrairFabricante(linhas),
    modelo_tipo: extrairPorRotulo(linhas, [
      /\bmodelo\b/i, /\bmodel\b/i, /\btype\b/i, /\btipo\b/i
    ]),
    numero_serie: extrairPorRotulo(linhas, [
      /n[ºo°.\s]*de\s*s[eé]rie/i,
      /\bserial(?:\s*(?:number|no\.?|nº))?\b/i,
      /\bs\/n\b/i,
      /\bser\.\b/i,
      /factory\s*(?:number|no\.?)/i
    ]),
    ano: extrairAno(linhas),
    norma: extrairNorma(all),
    dados: {
      potencia_nominal: extrairPotencia(all),
      numero_fases: extrairFases(linhas),
      frequencia: extrairFrequencia(all),
      grupo_ligacoes: extrairGrupo(linhas),
      arrefecimento: extrairArrefecimento(all, linhas),
      tensao_AT: extrairATBT(linhas, "AT", "tensao"),
      tensao_BT: extrairATBT(linhas, "BT", "tensao"),
      corrente_AT: extrairATBT(linhas, "AT", "corrente"),
      corrente_BT: extrairATBT(linhas, "BT", "corrente"),
      nivel_isolamento_AT: extrairATBT(linhas, "AT", "isolamento"),
      nivel_isolamento_BT: extrairATBT(linhas, "BT", "isolamento"),
      tensao_curto_circuito_Ucc: extrairUcc(linhas, all),
      impedancia_curto_circuito: extrairImpedancia(linhas),
      massa_total: extrairMassa(linhas, ["total"]),
      massa_oleo: extrairMassa(linhas, ["óleo","oleo","oil"]),
      massa_transporte: extrairMassa(linhas, ["transporte","transport"]),
      temperatura_oleo: extrairTemperatura(linhas, ["óleo","oleo","oil"]),
      temperatura_enrolamento: extrairTemperatura(linhas, ["enrolamento","winding"]),
      numero_posicoes_regulador: "",
      posicoes_regulador: "",
      tensao_nominal_travessia: "",
      tensao_maxima_travessia: "",
      corrente_nominal_travessia: "",
      BIL: "",
      C1_pF: "",
      FD_C1: "",
      C2_pF: "",
      FD_C2: ""
    },
    outros_campos_visiveis: {}
  };

  const isReg = tipo === "REGULADOR" || r.tipo_chapa === "regulador";
  if (isReg) {
    r.dados.numero_posicoes_regulador = extrairNumeroPosicoes(linhas);
    r.dados.posicoes_regulador = extrairPosicoes(linhas);
  }

  const isTrav = ["A","B","C","N"].includes(tipo) || r.tipo_chapa === "travessia";
  if (isTrav) {
    r.dados.tensao_nominal_travessia = extrairValorComRotulo(linhas, [
      /tens[aã]o\s*nominal/i, /rated\s*voltage/i
    ], /\b\d+(?:[.,]\d+)?\s*(?:kV|V)\b/i);

    r.dados.tensao_maxima_travessia = extrairValorComRotulo(linhas, [
      /tens[aã]o\s*m[aá]xima/i, /maximum\s*voltage/i, /\bUm\b/i
    ], /\b\d+(?:[.,]\d+)?\s*(?:kV|V)\b/i);

    r.dados.corrente_nominal_travessia = extrairValorComRotulo(linhas, [
      /corrente\s*nominal/i, /rated\s*current/i
    ], /\b\d+(?:[.,]\d+)?\s*(?:kA|A)\b/i);

    r.dados.BIL = extrairValorComRotulo(linhas, [
      /\bBIL\b/i, /lightning\s*impulse/i, /\bLI\b/i
    ], /\b\d+(?:[.,]\d+)?\s*(?:kV|V)\b/i);

    r.dados.C1_pF = extrairValorComRotulo(linhas, [/\bC1\b/i], /\b\d+(?:[.,]\d+)?\s*pF\b/i);
    r.dados.C2_pF = extrairValorComRotulo(linhas, [/\bC2\b/i], /\b\d+(?:[.,]\d+)?\s*pF\b/i);

    r.dados.FD_C1 = extrairFD(linhas, "C1");
    r.dados.FD_C2 = extrairFD(linhas, "C2");
  }

  removerDuplicados(r.dados);

  return r;
}

function inferirTipo(all, tipo) {
  if (["A","B","C","N"].includes(tipo)) return "travessia";
  if (tipo === "TRANSFORMADOR") return "transformador";
  if (tipo === "REGULADOR") return "regulador";
  if (/\b(?:bushing|travessia)\b/i.test(all)) return "travessia";
  if (/\b(?:oltc|tap\s*changer|regulador|comutador)\b/i.test(all)) return "regulador";
  if (/\b(?:transformador|transformer|transformateur)\b/i.test(all)) return "transformador";
  return "";
}

function extrairFabricante(linhas) {
  let v = extrairPorRotulo(linhas, [
    /fabricante/i, /manufacturer/i, /hersteller/i, /fabricant/i, /\bmarca\b/i
  ]);
  if (v) return limparIdentificacao(v);

  // Marcas muito evidentes no topo, sem assumir uma lista fechada.
  for (const l of linhas.slice(0, 8)) {
    const s = l.replace(/[|:;]+/g," ").trim();
    if (/EFACEC/i.test(s)) return s.match(/EFACEC(?:[-\s]+PORTUGAL)?/i)?.[0] || "EFACEC";
    if (/SIEMENS/i.test(s)) return "SIEMENS";
    if (/ABB/i.test(s)) return "ABB";
    if (/TRENCH/i.test(s)) return "TRENCH";
    if (/MR\b|MASCHINENFABRIK REINHAUSEN/i.test(s)) return "MR";
  }
  return "";
}

function limparIdentificacao(v) {
  v = String(v || "").trim();
  if (!v || /^(AT|BT|HV|LV|EU)$/i.test(v)) return "";
  return v;
}

function extrairPorRotulo(linhas, regexes) {
  for (const l of linhas) {
    if (!regexes.some(re => re.test(l))) continue;

    const p = l.split(/[:=]/);
    if (p.length > 1) {
      const v = p.slice(1).join(":").trim();
      if (v && !/\[ILEG[ÍI]VEL\]/i.test(v)) return v;
    }

    for (const re of regexes) {
      if (!re.test(l)) continue;
      const v = l.replace(re, "").replace(/^[\s:;=\-–—]+/,"").trim();
      if (v && v !== l && !/\[ILEG[ÍI]VEL\]/i.test(v)) return v;
    }
  }
  return "";
}

function extrairAno(linhas) {
  const v = extrairPorRotulo(linhas, [
    /\bano\b/i, /\byear\b/i, /data\s*(?:de)?\s*fabr/i, /date\s*of\s*manufact/i
  ]);
  const m = String(v).match(/\b(?:19|20)\d{2}\b/);
  return m ? m[0] : "";
}

function extrairNorma(all) {
  const m = all.match(/\b(?:CEI|IEC|EN)\s*[-:]?\s*\d[\d\-/.]*/i);
  return m ? m[0].replace(/\s+/g," ").trim() : "";
}

function extrairPotencia(all) {
  const vals = [...all.matchAll(/\b\d+(?:[.,]\d+)?\s*(?:MVA|kVA|VA)\b/gi)].map(m=>m[0]);
  if (!vals.length) return "";
  // Se houver várias, devolve a primeira. As futuras versões podem criar vários regimes.
  return vals[0];
}

function extrairFrequencia(all) {
  const m = all.match(/\b(?:50|60)(?:[.,]0+)?\s*Hz\b/i);
  return m ? m[0] : "";
}

function extrairFases(linhas) {
  const v = extrairPorRotulo(linhas, [
    /n[úu]mero\s*de\s*fases/i, /\bphases?\b/i, /\bfases?\b/i
  ]);
  const m = String(v).match(/\b(?:1|3)\b/);
  return m ? m[0] : "";
}

function extrairGrupo(linhas) {
  const v = extrairPorRotulo(linhas, [
    /grupo\s*(?:de)?\s*liga/i, /vector\s*group/i, /coupling/i
  ]);
  if (!v || /^(AT|BT)$/i.test(v)) return "";
  return /(?=.*[A-Za-z])(?=.*\d)/.test(v) ? v : "";
}

function extrairArrefecimento(all, linhas) {
  const v = extrairPorRotulo(linhas, [/arrefecimento/i,/cooling/i,/refrig/i]);
  const cod = String(v || "").match(/\b(?:ONAN|ONAF|OFAF|ODAF|OFWF|ODWF|KNAN|KNAF)\b/i);
  if (cod) return cod[0];

  const m = all.match(/\b(?:ONAN|ONAF|OFAF|ODAF|OFWF|ODWF|KNAN|KNAF)\b/i);
  return m ? m[0] : "";
}

function extrairATBT(linhas, lado, tipo) {
  const label = lado === "AT"
    ? /(?:\bAT\b|\bHV\b|primary|prim[aá]rio)/i
    : /(?:\bBT\b|\bLV\b|secondary|secund[aá]rio)/i;

  const context = tipo === "tensao"
    ? /tens[aã]o|voltage|tension/i
    : tipo === "corrente"
      ? /corrente|current/i
      : /isolamento|insulation|withstand|BIL|LI|AC/i;

  const unit = tipo === "corrente"
    ? /\b\d+(?:[.,]\d+)?\s*(?:kA|A)\b/i
    : /\b\d+(?:[.,]\d+)?\s*(?:kV|V)\b/i;

  for (const l of linhas) {
    if (!label.test(l) || !context.test(l)) continue;
    const m = l.match(unit);
    if (m) return m[0];
  }
  return "";
}

function extrairUcc(linhas, all) {
  const v = extrairValorComRotulo(linhas, [
    /\bUcc\b/i, /\bUk\b/i, /\bZk\b/i, /tens[aã]o.*curto/i, /short.*circuit/i
  ], /\b\d+(?:[.,]\d+)?\s*%\b/);
  if (v) return v;

  const m = all.match(/\b(?:Ucc|Uk|Zk)\b[^\n%]{0,30}(\d+(?:[.,]\d+)?\s*%)/i);
  return m ? m[1] : "";
}

function extrairImpedancia(linhas) {
  return extrairValorComRotulo(linhas, [/imped[aâ]ncia/i,/impedance/i], /\b\d+(?:[.,]\d+)?\s*(?:%|Ω|ohm)\b/i);
}

function extrairMassa(linhas, palavras) {
  for (const l of linhas) {
    const low = l.toLowerCase();
    if (!palavras.some(p => low.includes(p))) continue;
    if (!/(massa|peso|weight|mass)/i.test(l)) continue;
    const m = l.match(/\b\d+(?:[.,]\d+)?\s*(?:kg|t)\b/i);
    if (m) return m[0];
  }
  return "";
}

function extrairTemperatura(linhas, palavras) {
  for (const l of linhas) {
    const low = l.toLowerCase();
    if (!palavras.some(p => low.includes(p))) continue;
    if (!/(temp|temperatura|temperature|rise|eleva[cç][aã]o)/i.test(l)) continue;
    const m = l.match(/-?\d+(?:[.,]\d+)?\s*°?\s*C\b/i);
    if (m) return m[0];
  }
  return "";
}

function extrairNumeroPosicoes(linhas) {
  const v = extrairPorRotulo(linhas, [
    /n[úu]mero.*posi/i, /number.*positions/i, /\bpositions?\b/i
  ]);
  const m = String(v).match(/\b\d{1,2}\b/);
  if (!m) return "";
  const n = Number(m[0]);
  return n >= 2 && n <= 50 ? String(n) : "";
}

function extrairPosicoes(linhas) {
  const rows = linhas.filter(l =>
    /\b(?:pos|posi[cç][aã]o|position)\b/i.test(l) &&
    /\d/.test(l)
  );
  return rows.length ? rows.join(" | ") : "";
}

function extrairValorComRotulo(linhas, rotulos, valorRe) {
  for (const l of linhas) {
    if (!rotulos.some(re => re.test(l))) continue;
    const m = l.match(valorRe);
    if (m) return m[0];
  }
  return "";
}

function extrairFD(linhas, c) {
  for (const l of linhas) {
    if (!new RegExp(`(?:FD|tan\\s*delta).*${c}`, "i").test(l)) continue;
    const m = l.match(/\b(?:0?[.,]\d+|\d+(?:[.,]\d+)?\s*%)\b/);
    if (m) return m[0];
  }
  return "";
}

function removerDuplicados(d) {
  const grupos = [
    ["tensao_AT","tensao_BT","corrente_AT","corrente_BT"],
    ["massa_total","massa_oleo","massa_transporte"],
    ["nivel_isolamento_AT","nivel_isolamento_BT"]
  ];
  for (const grupo of grupos) {
    const seen = {};
    for (const k of grupo) {
      const v = String(d[k] || "").toLowerCase().replace(/\s+/g," ").trim();
      if (!v) continue;
      (seen[v] ||= []).push(k);
    }
    for (const ks of Object.values(seen)) {
      if (ks.length > 1) ks.forEach(k => d[k] = "");
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

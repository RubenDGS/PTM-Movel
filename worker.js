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
          const question = criarPerguntaOCR(tipo);

          const raw = await env.AI.run(MODEL, {
            task: "query",
            image,
            question,
            reasoning: false,
            temperature: 0,
            max_tokens: 5000,
            stream: false
          });

          const texto = extrairTexto(raw);

          if (!texto) {
            resultados.push({
              nome,
              tipo,
              erro: "A IA não conseguiu transcrever a chapa."
            });
            continue;
          }

          const resultado = extrairCampos(texto, tipo);

          resultados.push({
            nome,
            tipo,
            resultado,
            texto_lido: texto
          });

        } catch (e) {
          resultados.push({
            nome,
            tipo,
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

function criarPerguntaOCR(tipo) {
  return `TRANSCRIÇÃO OCR TÉCNICA DE CHAPA.

Contexto dado pelo utilizador: ${tipo}

NÃO preenchas campos.
NÃO interpretes.
NÃO adivinhes.
NÃO transformes a resposta em JSON.

Faz apenas uma transcrição fiel daquilo que consegues ver.

REGRAS:
- Copia palavra por palavra e número por número.
- Mantém unidades: Hz, V, kV, A, kA, VA, kVA, MVA, %, kg, t, pF, °C.
- Mantém linhas separadas.
- Mantém cabeçalho e valor na mesma linha quando estiverem associados.
- Se houver uma tabela, escreve cada linha da tabela separadamente.
- Se uma palavra/número não estiver legível, escreve [ILEGÍVEL].
- Não repitas valores.
- Não acrescentes palavras como "fabricante", "modelo", "ano", etc. se essas palavras não estiverem visíveis.
- Se houver um logótipo/nome de marca claramente legível, transcreve-o exatamente.
- Devolve APENAS a transcrição, sem comentários.`;
}

function extrairCampos(texto, tipo) {
  const linhas = String(texto || "")
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean);

  const all = linhas.join("\n");
  const r = vazioResultado();

  // Tipo: usa o que o utilizador indicou quando explícito.
  if (["A","B","C","N"].includes(tipo)) {
    r.tipo_chapa = "travessia";
  } else if (tipo === "TRANSFORMADOR") {
    r.tipo_chapa = "transformador";
  } else if (tipo === "REGULADOR") {
    r.tipo_chapa = "regulador";
  } else {
    r.tipo_chapa = inferirTipo(all);
  }

  // Identificação: só quando existe rótulo claro ou uma marca isolada muito plausível.
  r.fabricante = valorPorRotulo(linhas, [
    /fabricante/i, /manufacturer/i, /fabricant/i, /hersteller/i, /marca/i, /make/i
  ]);

  if (!r.fabricante) {
    r.fabricante = marcaProvavel(linhas);
  }

  r.modelo_tipo = valorPorRotulo(linhas, [
    /\bmodelo\b/i, /\bmodel\b/i, /\btype\b/i, /\btipo\b/i
  ]);

  r.numero_serie = valorPorRotulo(linhas, [
    /n[ºo°.\s]*de\s*s[eé]rie/i, /serial/i, /\bser\.\b/i, /\bs\/n\b/i,
    /factory\s*(?:no|number)/i, /n[ºo°.\s]*fabr/i
  ]);

  r.ano = valorPorRotulo(linhas, [
    /\bano\b/i, /\byear\b/i, /data\s*de\s*fabr/i, /date\s*of\s*manufact/i
  ]);
  if (!/^(19|20)\d{2}$/.test(r.ano)) r.ano = "";

  r.norma = valorPorRotulo(linhas, [
    /\bnorma\b/i, /\bstandard\b/i, /\bcei\b/i, /\biec\b/i, /\ben\b/i
  ]);
  if (!r.norma) {
    const m = all.match(/\b(?:IEC|CEI|EN)\s*[-:]?\s*\d[\d\-/.]*/i);
    if (m) r.norma = m[0];
  }

  // Campos com unidades muito claras
  r.dados.frequencia = primeiro(all, /\b\d+(?:[.,]\d+)?\s*Hz\b/i);
  r.dados.potencia_nominal = primeiro(all, /\b\d+(?:[.,]\d+)?\s*(?:MVA|kVA|VA)\b/i);

  // Fases apenas com rótulo
  const nf = valorPorRotulo(linhas, [/n[úu]mero\s*de\s*fases/i, /\bphases?\b/i, /\bfases?\b/i]);
  if (/^(1|3)(?:\s*(?:fase|fases|phase|phases))?$/i.test(nf)) r.dados.numero_fases = nf;

  // Grupo e arrefecimento apenas com rótulo ou códigos reconhecíveis
  let grupo = valorPorRotulo(linhas, [/grupo\s*(?:de)?\s*liga/i, /vector\s*group/i, /coupling/i]);
  if (grupo && /^(AT|BT)$/i.test(grupo)) grupo = "";
  if (grupo && !/(?=.*[A-Za-z])(?=.*\d)/.test(grupo)) grupo = "";
  r.dados.grupo_ligacoes = grupo;

  let cool = valorPorRotulo(linhas, [/arrefecimento/i, /cooling/i, /refroidissement/i]);
  if (!cool) {
    const m = all.match(/\b(?:ONAN|ONAF|OFAF|ODAF|OFWF|ODWF|KNAN|KNAF)\b/i);
    if (m) cool = m[0];
  }
  r.dados.arrefecimento = cool;

  // AT / BT: só por rótulos explícitos. Nunca duplica o mesmo valor.
  r.dados.tensao_AT = valorEletricoPorRotulo(linhas, [
    /tens[aã]o.*\bAT\b/i, /\bHV\b.*(?:voltage|tension)/i, /primary.*voltage/i
  ], /\b\d+(?:[.,]\d+)?\s*(?:kV|V)\b/i);

  r.dados.tensao_BT = valorEletricoPorRotulo(linhas, [
    /tens[aã]o.*\bBT\b/i, /\bLV\b.*(?:voltage|tension)/i, /secondary.*voltage/i
  ], /\b\d+(?:[.,]\d+)?\s*(?:kV|V)\b/i);

  r.dados.corrente_AT = valorEletricoPorRotulo(linhas, [
    /corrente.*\bAT\b/i, /\bHV\b.*current/i, /primary.*current/i
  ], /\b\d+(?:[.,]\d+)?\s*(?:kA|A)\b/i);

  r.dados.corrente_BT = valorEletricoPorRotulo(linhas, [
    /corrente.*\bBT\b/i, /\bLV\b.*current/i, /secondary.*current/i
  ], /\b\d+(?:[.,]\d+)?\s*(?:kA|A)\b/i);

  // Isolamento: só por rótulos claros
  r.dados.nivel_isolamento_AT = valorPorRotulo(linhas, [
    /isolamento.*\bAT\b/i, /insulation.*\bHV\b/i, /nivel.*\bAT\b/i
  ]);
  r.dados.nivel_isolamento_BT = valorPorRotulo(linhas, [
    /isolamento.*\bBT\b/i, /insulation.*\bLV\b/i, /nivel.*\bBT\b/i
  ]);

  // Curto-circuito
  r.dados.tensao_curto_circuito_Ucc = valorEletricoPorRotulo(linhas, [
    /\bUcc\b/i, /\bUk\b/i, /\bZk\b/i, /curto[-\s]*circuito/i, /short[-\s]*circuit/i
  ], /\b\d+(?:[.,]\d+)?\s*%\b/);

  r.dados.impedancia_curto_circuito = valorEletricoPorRotulo(linhas, [
    /imped[aâ]ncia/i, /impedance/i
  ], /\b\d+(?:[.,]\d+)?\s*(?:%|Ω|ohm)\b/i);

  // Massas: só por rótulo + unidade.
  r.dados.massa_total = valorMassa(linhas, [/massa\s*total/i, /total\s*(?:mass|weight)/i]);
  r.dados.massa_oleo = valorMassa(linhas, [/massa.*[óo]leo/i, /oil\s*(?:mass|weight)/i]);
  r.dados.massa_transporte = valorMassa(linhas, [/massa.*transporte/i, /transport\s*(?:mass|weight)/i]);

  // Temperaturas: só por rótulo
  r.dados.temperatura_oleo = valorTemperatura(linhas, [/[óo]leo/i, /\boil\b/i]);
  r.dados.temperatura_enrolamento = valorTemperatura(linhas, [/enrolamento/i, /\bwinding\b/i]);

  // Regulador: só se fotografia for REGULADOR ou se houver rótulos claros na própria chapa.
  const contextoReg = tipo === "REGULADOR" || /\b(?:regulador|tap\s*changer|oltc|comutador)\b/i.test(all);
  if (contextoReg) {
    const npos = valorPorRotulo(linhas, [/n[úu]mero.*posi/i, /number.*positions/i, /\bpositions?\b/i]);
    if (/^\d{1,2}$/.test(npos) && Number(npos) >= 2) r.dados.numero_posicoes_regulador = npos;

    const posLinhas = linhas.filter(l => /\bpos(?:i[cç][aã]o|ition)?\b/i.test(l) && /\d/.test(l));
    if (posLinhas.length) r.dados.posicoes_regulador = posLinhas.join(" | ");
  }

  // Travessias: NUNCA preencher se não for travessia.
  const contextoTrav = ["A","B","C","N"].includes(tipo) || r.tipo_chapa === "travessia";
  if (contextoTrav) {
    r.dados.tensao_nominal_travessia = valorEletricoPorRotulo(linhas, [
      /tens[aã]o\s*nominal/i, /rated\s*voltage/i
    ], /\b\d+(?:[.,]\d+)?\s*(?:kV|V)\b/i);

    r.dados.tensao_maxima_travessia = valorEletricoPorRotulo(linhas, [
      /tens[aã]o\s*m[aá]xima/i, /maximum\s*voltage/i, /\bUm\b/i
    ], /\b\d+(?:[.,]\d+)?\s*(?:kV|V)\b/i);

    r.dados.corrente_nominal_travessia = valorEletricoPorRotulo(linhas, [
      /corrente\s*nominal/i, /rated\s*current/i
    ], /\b\d+(?:[.,]\d+)?\s*(?:kA|A)\b/i);

    r.dados.BIL = valorPorRotulo(linhas, [/\bBIL\b/i, /impulse/i]);
    r.dados.C1_pF = valorEletricoPorRotulo(linhas, [/\bC1\b/i], /\b\d+(?:[.,]\d+)?\s*pF\b/i);
    r.dados.C2_pF = valorEletricoPorRotulo(linhas, [/\bC2\b/i], /\b\d+(?:[.,]\d+)?\s*pF\b/i);
    r.dados.FD_C1 = valorPorRotulo(linhas, [/FD\s*C1/i, /tan\s*delta.*C1/i]);
    r.dados.FD_C2 = valorPorRotulo(linhas, [/FD\s*C2/i, /tan\s*delta.*C2/i]);
  }

  removerDuplicados(r.dados);

  return r;
}

function vazioResultado() {
  return {
    tipo_chapa:"",
    fabricante:"",
    modelo_tipo:"",
    numero_serie:"",
    ano:"",
    norma:"",
    dados:{
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
    outros_campos_visiveis:{}
  };
}

function inferirTipo(t) {
  if (/\b(?:bushing|travessia)\b/i.test(t)) return "travessia";
  if (/\b(?:oltc|tap\s*changer|regulador|comutador)\b/i.test(t)) return "regulador";
  if (/\b(?:transformer|transformador|transformateur)\b/i.test(t)) return "transformador";
  return "";
}

function primeiro(t, re) {
  const m = String(t).match(re);
  return m ? m[0].trim() : "";
}

function valorPorRotulo(linhas, rotulos) {
  for (const linha of linhas) {
    if (!rotulos.some(re => re.test(linha))) continue;

    const partes = linha.split(/[:=]/);
    if (partes.length >= 2) {
      const v = partes.slice(1).join(":").trim();
      if (v && !/\[ILEG[ÍI]VEL\]/i.test(v)) return v;
    }

    for (const re of rotulos) {
      if (!re.test(linha)) continue;
      const v = linha.replace(re, "").replace(/^[\s:;=\-–—]+/, "").trim();
      if (v && v !== linha && !/\[ILEG[ÍI]VEL\]/i.test(v)) return v;
    }
  }
  return "";
}

function valorEletricoPorRotulo(linhas, rotulos, unidadeRe) {
  for (const linha of linhas) {
    if (!rotulos.some(re => re.test(linha))) continue;
    const m = linha.match(unidadeRe);
    if (m) return m[0].trim();
  }
  return "";
}

function valorMassa(linhas, rotulos) {
  return valorEletricoPorRotulo(linhas, rotulos, /\b\d+(?:[.,]\d+)?\s*(?:kg|t)\b/i);
}

function valorTemperatura(linhas, contexto) {
  for (const linha of linhas) {
    if (!contexto.some(re => re.test(linha))) continue;
    const m = linha.match(/-?\d+(?:[.,]\d+)?\s*°?\s*C\b/i);
    if (m) return m[0].trim();
  }
  return "";
}

function marcaProvavel(linhas) {
  const proibidas = /^(AT|BT|HV|LV|Hz|MVA|kVA|VA|CEI|IEC|EN|EU)$/i;
  for (const linha of linhas.slice(0, 8)) {
    const s = linha.replace(/[^A-Za-zÀ-ÿ0-9 .&+\-]/g, "").trim();
    if (!s || proibidas.test(s)) continue;
    if (/^[A-ZÀ-Ý][A-ZÀ-Ý0-9 .&+\-]{3,30}$/.test(s) && !/\d{3,}/.test(s)) {
      return s;
    }
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
      const v = String(d[k] || "").trim().toLowerCase();
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

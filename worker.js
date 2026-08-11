const MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const contentType =
  request.headers.get("content-type") || "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
console.log("CONTENT-TYPE:", contentType);
console.log("URL:", request.url);
export default {} else if (contentType.includes("application/json")) {

  const body = await request.json();
  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }console.log("JSON RECEBIDO - CAMPOS:", Object.keys(body));

    if (request.method !== "POST") {
      return resposta({
        ok: false,
        erro: "Usa POST para analisar a chapa."
      }, 405);
    }

    if (!env.AI) {
      return resposta({
        ok: false,
        erro: 'Binding "AI" não encontrado.'
      }, 500);
    }

    try {

      const contentType =
        request.headers.get("content-type") || "";

      let image = "";

      if (contentType.includes("multipart/form-data")) {

        const form = await request.formData();

        const file =
          form.get("image") ||
          form.get("imagem") ||
          form.get("file") ||
          form.get("foto");

        if (!(file instanceof File)) {
          return resposta({
            ok: false,
            erro: "Não foi recebida nenhuma imagem."
          }, 400);
        }

        image = await ficheiroParaDataURI(file);

      } else if (contentType.includes("application/json")) {

        const body = await request.json();

        image =
          body.image ||
          body.imagem ||
          "";

        if (!image) {
          return resposta({
            ok: false,
            erro: "Não foi recebida nenhuma imagem."
          }, 400);
        }

      } else {

        return resposta({
          ok: false,
          erro: "Formato não suportado."
        }, 415);
      }

      const question = `
Analisa cuidadosamente a fotografia de uma chapa
de características de equipamento elétrico.

Pode ser:

- transformador
- regulador/comutador de tomadas
- travessia/bushing

A leitura tem de ser rigorosa.

REGRAS OBRIGATÓRIAS:

1. Usa APENAS informação realmente visível na fotografia.

2. NÃO inventes valores.

3. NÃO calcules valores que não estejam escritos.

4. NÃO deduzas um campo através de outro.

5. Se um campo não estiver claramente legível,
devolve uma string vazia "".

6. Não repitas o mesmo valor em vários campos
só porque não consegues identificar os restantes.

7. Mantém as unidades exatamente como aparecem.

8. "MVA" corresponde a potência.
Um valor em MVA nunca pode ser usado como:
- frequência
- tensão
- corrente
- ano
- número de fases
- arrefecimento
- massa

9. Frequência só pode ser preenchida quando estiver
explicitamente identificada em Hz.

10. Tensão deve corresponder a valores identificados
como V ou kV.

11. Corrente deve corresponder a valores identificados
como A ou kA.

12. Ano só deve ser preenchido quando existir
claramente um ano ou data de fabrico.

13. Número de série apenas quando estiver associado
a indicação como:
serial
serial number
ser.
nº
nr.
factory number
ou equivalente.

14. Não confundas AT com BT.

15. Não confundas:
- massa total
- massa de óleo
- massa de transporte

16. Não confundas temperaturas com outros valores.

17. Para reguladores:
lê todas as posições que estiverem visíveis.
Não inventes posições intermédias.

18. Para travessias/bushings:
procura especificamente:
- fabricante
- tipo/modelo
- número de série
- tensão nominal
- tensão máxima
- corrente nominal
- BIL
- C1
- C2
- fator de dissipação de C1
- fator de dissipação de C2

19. NÃO inventes a fase da travessia.
Só preenche fase_travessia se estiver claramente
indicada na própria imagem.

20. Se não conseguires identificar seguramente
o tipo de chapa, usa "desconhecido".

21. Faz uma segunda verificação mental antes
de devolver o resultado:
confirma que cada valor pertence realmente
ao campo onde foi colocado.

22. Responde SOMENTE com JSON válido.
Não escrevas explicações.
Não uses markdown.
Não uses blocos de código.

Devolve exatamente esta estrutura:

{
  "tipo_chapa": "",
  "fase_travessia": "",
  "fabricante": "",
  "modelo_tipo": "",
  "numero_serie": "",
  "ano": "",
  "norma": "",

  "dados": {

    "potencia_nominal": "",
    "numero_fases": "",
    "frequencia": "",
    "grupo_ligacoes": "",
    "arrefecimento": "",

    "tensao_AT": "",
    "tensao_BT": "",

    "corrente_AT": "",
    "corrente_BT": "",

    "nivel_isolamento_AT": "",
    "nivel_isolamento_BT": "",

    "tensao_curto_circuito_Ucc": "",
    "impedancia_curto_circuito": "",

    "massa_total": "",
    "massa_oleo": "",
    "massa_transporte": "",

    "temperatura_oleo": "",
    "temperatura_enrolamento": "",

    "numero_posicoes_regulador": "",
    "posicoes_regulador": "",

    "tensao_nominal_travessia": "",
    "tensao_maxima_travessia": "",
    "corrente_nominal_travessia": "",

    "BIL": "",

    "C1_pF": "",
    "FD_C1": "",

    "C2_pF": "",
    "FD_C2": ""
  },

  "outros_campos_visiveis": {},

  "duvidas_leitura": [],

  "confianca": ""
}
`;

      const result = await env.AI.run(
        MODEL,
        {
          task: "query",
          image: image,
          question: question,
          reasoning: false,
          temperature: 0,
          max_tokens: 5000,
          stream: false
        }
      );

      const texto =
        typeof result?.answer === "string"
          ? result.answer
          : typeof result === "string"
            ? result
            : "";

      if (!texto) {

        return resposta({
          ok: false,
          erro: "A IA não devolveu texto."
        }, 502);
      }

      const dados = limparJSON(texto);

      if (!dados) {

        return resposta({
          ok: false,
          erro: "A resposta da IA não era JSON válido.",
          texto_extraido: texto
        }, 502);
      }

      const verificados =
        verificarDados(dados);

      return resposta({
        ok: true,
        dados: verificados
      });

    } catch (erro) {

      return resposta({
        ok: false,
        erro:
          erro?.message ||
          String(erro)
      }, 500);
    }
  }
};


function limparJSON(texto) {

  let s =
    String(texto || "")
      .trim();

  s =
    s.replace(
      /^```(?:json)?\s*/i,
      ""
    );

  s =
    s.replace(
      /\s*```$/i,
      ""
    );

  try {
    return JSON.parse(s);
  } catch {}

  const inicio =
    s.indexOf("{");

  const fim =
    s.lastIndexOf("}");

  if (
    inicio >= 0 &&
    fim > inicio
  ) {

    try {

      return JSON.parse(
        s.slice(
          inicio,
          fim + 1
        )
      );

    } catch {}
  }

  return null;
}


function verificarDados(x) {

  const limpar = valor => {

    if (
      valor === null ||
      valor === undefined
    ) {
      return "";
    }

    if (
      typeof valor === "number" ||
      typeof valor === "boolean"
    ) {
      return String(valor);
    }

    if (
      typeof valor !== "string"
    ) {
      return "";
    }

    const s =
      valor.trim();

    if (
      /^(null|undefined|n\/a|na|ilegível|ilegivel)$/i
        .test(s)
    ) {
      return "";
    }

    return s;
  };


  const normalizar = valor =>
    limpar(valor)
      .toLowerCase()
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        ""
      );


  const tipos = [
    "transformador",
    "regulador",
    "travessia",
    "desconhecido"
  ];


  let tipo =
    normalizar(
      x.tipo_chapa
    );


  if (
    !tipos.includes(tipo)
  ) {
    tipo =
      "desconhecido";
  }


  const origemDados =
    x.dados &&
    typeof x.dados === "object"
      ? x.dados
      : {};


  const campos = [

    "potencia_nominal",

    "numero_fases",

    "frequencia",

    "grupo_ligacoes",

    "arrefecimento",

    "tensao_AT",

    "tensao_BT",

    "corrente_AT",

    "corrente_BT",

    "nivel_isolamento_AT",

    "nivel_isolamento_BT",

    "tensao_curto_circuito_Ucc",

    "impedancia_curto_circuito",

    "massa_total",

    "massa_oleo",

    "massa_transporte",

    "temperatura_oleo",

    "temperatura_enrolamento",

    "numero_posicoes_regulador",

    "posicoes_regulador",

    "tensao_nominal_travessia",

    "tensao_maxima_travessia",

    "corrente_nominal_travessia",

    "BIL",

    "C1_pF",

    "FD_C1",

    "C2_pF",

    "FD_C2"
  ];


  const dados = {};


  for (
    const campo of campos
  ) {

    dados[campo] =
      limpar(
        origemDados[campo]
      );
  }


  /*
   * Proteção contra o erro que vimos:
   * um valor em MVA nunca pode
   * aparecer nestes campos.
   */

  const naoPodeSerMVA = [

    "numero_fases",

    "frequencia",

    "arrefecimento",

    "tensao_AT",

    "tensao_BT",

    "corrente_AT",

    "corrente_BT",

    "massa_total",

    "massa_oleo",

    "massa_transporte"
  ];


  for (
    const campo of naoPodeSerMVA
  ) {

    if (
      /\bMVA\b/i.test(
        dados[campo]
      )
    ) {

      dados[campo] =
        "";
    }
  }


  /*
   * Frequência:
   * se vier preenchida,
   * tem de indicar Hz.
   */

  if (
    dados.frequencia &&
    !/\bHz\b/i.test(
      dados.frequencia
    )
  ) {

    dados.frequencia =
      "";
  }


  /*
   * Ano:
   * aceita apenas um ano plausível.
   */

  let ano =
    limpar(
      x.ano
    );


  if (
    ano &&
    !/\b(19|20)\d{2}\b/
      .test(ano)
  ) {

    ano =
      "";
  }


  /*
   * Fase:
   * só existe para travessia.
   */

  let fase =
    limpar(
      x.fase_travessia
    );


  if (
    tipo !== "travessia"
  ) {

    fase =
      "";
  }


  const confiancas = [
    "alta",
    "media",
    "baixa"
  ];


  let confianca =
    normalizar(
      x.confianca
    );


  if (
    !confiancas.includes(
      confianca
    )
  ) {

    confianca =
      "baixa";
  }


  return {

    tipo_chapa:
      tipo,

    fase_travessia:
      fase,

    fabricante:
      limpar(
        x.fabricante
      ),

    modelo_tipo:
      limpar(
        x.modelo_tipo
      ),

    numero_serie:
      limpar(
        x.numero_serie
      ),

    ano:
      ano,

    norma:
      limpar(
        x.norma
      ),

    dados:
      dados,

    outros_campos_visiveis:
      (
        x.outros_campos_visiveis &&
        typeof x.outros_campos_visiveis ===
          "object"
      )
        ? x.outros_campos_visiveis
        : {},

    duvidas_leitura:
      Array.isArray(
        x.duvidas_leitura
      )
        ? x.duvidas_leitura
        : [],

    confianca:
      confianca
  };
}


async function ficheiroParaDataURI(
  file
) {

  const bytes =
    new Uint8Array(
      await file.arrayBuffer()
    );

  let binary =
    "";

  const tamanho =
    32768;


  for (
    let i = 0;
    i < bytes.length;
    i += tamanho
  ) {

    binary +=
      String.fromCharCode(
        ...bytes.subarray(
          i,
          i + tamanho
        )
      );
  }


  const mime =
    file.type ||
    "image/jpeg";


  return (
    `data:${mime};base64,` +
    btoa(binary)
  );
}


function resposta(
  dados,
  status = 200
) {

  return new Response(
    JSON.stringify(
      dados,
      null,
      2
    ),
    {
      status: status,

      headers: {
        ...CORS,

        "Content-Type":
          "application/json; charset=UTF-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
        }

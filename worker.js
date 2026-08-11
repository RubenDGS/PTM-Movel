const MODEL = "@cf/moondream/moondream3.1-9B-A2B";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (request.method !== "POST") {
      return resposta({
        ok: false,
        erro: "Método não permitido."
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

      if (!contentType.includes("application/json")) {
        return resposta({
          ok: false,
          erro: "O pedido deve ser enviado em JSON."
        }, 400);
      }

      const body = await request.json();

      const images =
        Array.isArray(body.images)
          ? body.images
          : [];

      if (!images.length) {
        return resposta({
          ok: false,
          erro: "Não foram recebidas fotografias."
        }, 400);
      }

      const resultados = [];

      for (const item of images) {

        const nome =
          item.name ||
          item.nome ||
          "Fotografia";

        const tipoEscolhido =
          item.tipo ||
          "AUTO";

        const image =
          item.image ||
          item.imagem ||
          "";

        if (!image) {

          resultados.push({
            nome,
            tipo: tipoEscolhido,
            erro: "Imagem não recebida."
          });

          continue;
        }

        try {

          const question =
            criarPergunta(tipoEscolhido);

          const result =
            await env.AI.run(
              MODEL,
              {
                task: "query",
                image,
                question,
                reasoning: false,
                temperature: 0,
                max_tokens: 5000,
                stream: false
              }
            );

          console.log(
            "RESPOSTA IA COMPLETA:",
            JSON.stringify(result)
          );

          const texto =
            typeof result?.result?.answer === "string"
              ? result.result.answer
              : typeof result?.answer === "string"
                ? result.answer
                : typeof result === "string"
                  ? result
                  : "";

          if (!texto) {

            resultados.push({
              nome,
              tipo: tipoEscolhido,
              erro: "A IA não devolveu resultado."
            });

            continue;
          }

          const dados =
            limparJSON(texto);

          if (!dados) {

            resultados.push({
              nome,
              tipo: tipoEscolhido,
              erro: "A IA devolveu uma resposta inválida.",
              texto_extraido: texto
            });

            continue;
          }

          const verificados =
            verificarDados(dados);

          resultados.push({
            nome,
            tipo: tipoEscolhido,
            resultado: verificados
          });

        } catch (erroImagem) {

          console.log(
            "ERRO AO ANALISAR IMAGEM:",
            erroImagem?.message ||
            String(erroImagem)
          );

          resultados.push({
            nome,
            tipo: tipoEscolhido,
            erro:
              erroImagem?.message ||
              String(erroImagem)
          });
        }
      }

      return resposta({
        ok: true,
        resultados
      });

    } catch (erro) {

      console.log(
        "ERRO GERAL:",
        erro?.message ||
        String(erro)
      );

      return resposta({
        ok: false,
        erro:
          erro?.message ||
          String(erro)
      }, 500);
    }
  }
};


function criarPergunta(tipoEscolhido) {

  return `
Analisa cuidadosamente esta fotografia de uma chapa
de características de equipamento elétrico.

TIPO INDICADO PELO UTILIZADOR:
${tipoEscolhido}

Se estiver indicado AUTO, identifica o tipo pela imagem.

O equipamento pode ser:
- transformador
- regulador/comutador de tomadas
- travessia/bushing

REGRAS OBRIGATÓRIAS:

1. Usa APENAS informação realmente visível na imagem.

2. NÃO inventes valores.

3. NÃO calcules nem deduzas valores que não estejam escritos.

4. Se um campo não estiver suficientemente legível, devolve "".

5. Não uses palavras genéricas da própria estrutura da chapa
como se fossem valores.
Por exemplo:
"Fabricante" não é um fabricante.
"Modelo" não é um modelo.
"Travessia/bushing" não é um modelo.

6. Não repitas o mesmo valor em vários campos.

7. Mantém as unidades exatamente como aparecem.

8. MVA é potência.
Nunca uses MVA como:
frequência,
tensão,
corrente,
ano,
número de fases,
arrefecimento,
massa.

9. Frequência só pode ser preenchida quando estiver
explicitamente indicada em Hz.

10. Tensão deve corresponder a valores em V ou kV.

11. Corrente deve corresponder a valores em A ou kA.

12. Ano só deve ser preenchido quando existir claramente
um ano ou data de fabrico.

13. Número de série só deve ser preenchido quando estiver
associado a indicação como:
serial,
serial number,
ser.,
nº,
nr.,
factory number
ou equivalente.

14. Não confundas AT com BT.

15. Não confundas:
massa total,
massa de óleo,
massa de transporte.

16. Não confundas temperaturas com outros valores.

17. Para reguladores:
lê todas as posições que estiverem realmente visíveis.
Não inventes posições intermédias.

18. Para travessias procura especificamente:
fabricante,
tipo/modelo,
número de série,
tensão nominal,
tensão máxima,
corrente nominal,
BIL,
C1,
C2,
fator de dissipação C1,
fator de dissipação C2.

19. NÃO inventes a fase da travessia.
Só preenche fase_travessia se estiver claramente indicada.

20. Se não conseguires identificar seguramente o tipo,
usa "desconhecido".

21. Se o utilizador escolheu explicitamente:
TRANSFORMADOR,
REGULADOR,
TRAVESSIA A,
TRAVESSIA B,
TRAVESSIA C
ou TRAVESSIA N,
usa essa indicação como contexto,
mas continua sem inventar valores.

22. Faz uma segunda verificação mental antes de responder:
cada valor tem de pertencer realmente ao campo onde foi colocado.

23. Responde SOMENTE com JSON válido.
Sem explicações.
Sem markdown.
Sem blocos de código.

Estrutura:

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
}


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
    tipo.includes("transformador")
  ) {
    tipo = "transformador";
  }

  else if (
    tipo.includes("regulador")
  ) {
    tipo = "regulador";
  }

  else if (
    tipo.includes("travessia") ||
    tipo.includes("bushing")
  ) {
    tipo = "travessia";
  }

  else {
    tipo = "desconhecido";
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


  for (const campo of campos) {

    dados[campo] =
      limpar(
        origemDados[campo]
      );
  }


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


  for (const campo of naoPodeSerMVA) {

    if (
      /\bMVA\b/i.test(
        dados[campo]
      )
    ) {

      dados[campo] = "";
    }
  }


  if (
    dados.frequencia &&
    !/\bHz\b/i.test(
      dados.frequencia
    )
  ) {

    dados.frequencia = "";
  }


  let ano =
    limpar(
      x.ano
    );


  if (
    ano &&
    !/\b(19|20)\d{2}\b/
      .test(ano)
  ) {

    ano = "";
  }


  let fabricante =
    limpar(
      x.fabricante
    );


  if (
    /^fabricante$/i.test(fabricante)
  ) {
    fabricante = "";
  }


  let modelo =
    limpar(
      x.modelo_tipo
    );


  if (
    /^(modelo|tipo|travessia\/bushing|bushing)$/i
      .test(modelo)
  ) {
    modelo = "";
  }


  let fase =
    limpar(
      x.fase_travessia
    );


  if (
    tipo !== "travessia"
  ) {

    fase = "";
  }


  if (
    fase &&
    !/^(A|B|C|N)$/i.test(fase)
  ) {

    fase = "";
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

    confianca = "baixa";
  }


  return {

    tipo_chapa:
      tipo,

    fase_travessia:
      fase,

    fabricante:
      fabricante,

    modelo_tipo:
      modelo,

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
      status,

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

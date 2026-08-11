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

          const question = criarPergunta(
            tipoEscolhido
          );

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

          const texto =
            typeof result?.answer === "string"
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
              erro: "A IA devolveu uma resposta inválida."
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

1. Usa APENAS informação realmente visível.

2. NÃO inventes valores.

3. NÃO calcules nem deduzas valores que não estejam escritos.

4. Se um campo não estiver legível, devolve "".

5. Não repitas um valor em vários campos.

6. Mantém as unidades exatamente como aparecem.

7. MVA é potência.
Nunca uses MVA como:
frequência, tensão, corrente, ano,
número de fases, arrefecimento ou massa.

8. Frequência só pode ser preenchida
quando estiver explicitamente indicada em Hz.

9. Tensão deve corresponder a V ou kV.

10. Corrente deve corresponder a A ou kA.

11. Ano só deve ser preenchido
quando existir claramente um ano.

12. Número de série só quando estiver
explicitamente identificado.

13. Não confundas AT com BT.

14. Não confundas:
massa total,
massa de óleo,
massa de transporte.

15. Para reguladores:
lê todas as posições visíveis.
Não inventes posições intermédias.

16. Para travessias procura:
fabricante,
modelo/tipo,
número de série,
tensão nominal,
tensão máxima,
corrente nominal,
BIL,
C1,
C2,
FD C1,
FD C2.

17. NÃO inventes a fase da travessia.

18. Se não conseguires identificar o tipo,
usa "desconhecido".

19. Revê cada campo antes de responder.

20. Responde SOMENTE com JSON válido.
Sem explicações.
Sem markdown.

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


  if (!tipos.includes(tipo)) {
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


  let fase =
    limpar(
      x.fase_travessia
    );


  if (
    tipo !== "travessia"
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

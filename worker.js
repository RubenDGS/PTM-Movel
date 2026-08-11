export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "https://rubendgs.github.io",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === "GET") {
      return Response.json(
        { ok: true, service: "ptm-analise", message: "Worker PTM ativo" },
        { headers: cors }
      );
    }

    if (request.method !== "POST" || url.pathname !== "/analisar") {
      return Response.json(
        { ok: false, error: "Rota não encontrada" },
        { status: 404, headers: cors }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { ok: false, error: "Pedido inválido" },
        { status: 400, headers: cors }
      );
    }

    return Response.json(
      {
        ok: true,
        received: true,
        files: Array.isArray(body?.images) ? body.images.length : 0,
        message: "Pedido recebido. Análise automática ainda por ligar."
      },
      { headers: cors }
    );
  }
};

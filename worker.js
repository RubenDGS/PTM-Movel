const VISION_MODEL="@cf/moondream/moondream3.1-9B-A2B";
const TEXT_MODEL="@cf/openai/gpt-oss-20b";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"};

export default{async fetch(request,env){
  if(request.method==="OPTIONS")return new Response(null,{headers:CORS});
  if(request.method!=="POST")return resposta({ok:false,erro:"Método não permitido."},405);
  if(!env.AI)return resposta({ok:false,erro:'Binding "AI" não encontrado.'},500);
  try{
    const ct=request.headers.get("content-type")||"";
    if(!ct.includes("application/json"))return resposta({ok:false,erro:"O pedido deve ser enviado em JSON."},400);
    const body=await request.json();
    const images=Array.isArray(body.images)?body.images:[];
    if(!images.length)return resposta({ok:false,erro:"Não foram recebidas fotografias."},400);

    const leituras=[];
    for(const item of images){
      const nome=item.name||item.nome||"Fotografia";
      const tipo=item.tipo||"AUTO";
      const image=item.image||item.imagem||"";
      if(!image){leituras.push({nome,tipo,texto:"",erro:"Imagem não recebida."});continue}
      try{
        const q=`Lê esta chapa de características como OCR técnico.
Transcreve apenas texto, números, unidades, símbolos e tabelas realmente visíveis.
NÃO interpretes, NÃO atribuas valores a campos e NÃO inventes texto ausente.
Mantém unidades como V, kV, A, kA, MVA, Hz, %, kg, t, pF e °C.
Se houver tabela de posições do regulador, transcreve TODAS as linhas legíveis.
Se algo estiver ilegível escreve [ILEGÍVEL].
Contexto dado pelo utilizador para esta foto: ${tipo}.
Devolve apenas a transcrição da chapa.`;
        const vr=await env.AI.run(VISION_MODEL,{task:"query",image,question:q,reasoning:false,temperature:0,max_tokens:8000,stream:false});
        const texto=extrairVisao(vr);
        leituras.push({nome,tipo,texto:texto||"",erro:texto?"":"Não foi possível ler texto da fotografia."});
      }catch(e){leituras.push({nome,tipo,texto:"",erro:e?.message||String(e)})}
    }

    const legiveis=leituras.filter(x=>x.texto);
    if(!legiveis.length)return resposta({ok:false,erro:"Não foi possível ler nenhuma das fotografias.",leituras},422);

    const fonte=legiveis.map((x,i)=>`FOTO ${i+1}
NOME: ${x.nome}
TIPO INDICADO: ${x.tipo}
TRANSCRIÇÃO:
${x.texto}`).join("\n\n==============================\n\n");

    const messages=[
      {role:"system",content:`És um assistente técnico para preparação de dados de ativos no OMICRON PTM / TESTRANO 600.
Recebes transcrições literais de chapas e apenas colocas os valores lidos nos campos correspondentes.
Não inventes, não calcules e não completes valores em falta. Se não existir na transcrição usa "".
Não uses conhecimentos gerais do equipamento para preencher lacunas.
Um valor só entra num campo quando a transcrição o associa claramente a esse significado.
Preserva as unidades.
Se houver várias potências/regimes conserva todas.
O número de posições do regulador é variável e deve refletir exatamente o que estiver legível.
Se uma foto estiver marcada A, B, C ou N, usa essa marca apenas para a posição da travessia.
Uma chapa principal pode conter simultaneamente dados do transformador e do regulador.
Ucc, Uk, Zk ou tensão de curto-circuito em % entra em short_circuit_voltage_percent.
Corrente de curto-circuito e duração são campos distintos de Ucc.
BIL/LI/impulso e AC/TA ficam separados.
Devolve apenas JSON válido, sem markdown.`},
      {role:"user",content:`Organiza estas transcrições neste JSON, mantendo exatamente as chaves:
{
 "transformer":{
  "manufacturer":"","model_type":"","serial_number":"","manufacturing_year":"","standard":"",
  "number_of_phases":"","rated_frequency":"","service":"","vector_group":"","cooling":"","fluid_type":"",
  "oil_designation":"","total_weight":"","oil_weight":"","untanking_weight":"","transport_weight":"",
  "ambient_temperature_max":"","oil_temperature_rise":"","winding_temperature_rise":"","sound_level":"",
  "short_circuit_voltage_percent":"","short_circuit_current":"","short_circuit_duration":""
 },
 "power_ratings":[{"cooling":"","rated_power":"","primary_current":"","secondary_current":""}],
 "windings":[
  {"name":"AT / Primário","rated_voltage":"","connection":"","max_voltage_um":"","ac_withstand":"","bil_impulse":"","regulation_range":"","rated_current":"","notes":""},
  {"name":"BT / Secundário","rated_voltage":"","connection":"","max_voltage_um":"","ac_withstand":"","bil_impulse":"","regulation_range":"","rated_current":"","notes":""}
 ],
 "tap_changer":{
  "present":"","type":"","winding":"","manufacturer":"","model_type":"","serial_number":"","manufacturing_year":"",
  "rated_frequency":"","rated_current":"","max_voltage_um":"","number_of_positions":"","nominal_position":"",
  "turns_scale":"","entries":[{"position":"","voltage":"","current":"","selector":"","preselector":""}]
 },
 "bushings":{
  "A":{"manufacturer":"","model_type":"","serial_number":"","manufacturing_year":"","rated_frequency":"","max_voltage_um":"","rated_voltage_ac":"","rated_current":"","bil":"","mass":"","mounting_angle":"","fd_c1":"","c1_pf":"","fd_c2":"","c2_pf":"","insulation_type":""},
  "B":{},"C":{},"N":{}
 },
 "additional_visible_data":{},
 "warnings":[]
}
Remove linhas vazias de entries; se não houver regulador usa [].
Se não houver power ratings usa [].
Mantém A/B/C/N e preenche apenas os que tenham foto identificada ou associação inequívoca.
Em warnings coloca apenas conflitos ou leituras duvidosas realmente presentes.

TRANSCRIÇÕES:
${fonte}`}
    ];

    const tr=await env.AI.run(TEXT_MODEL,{messages,stream:false,temperature:0,max_tokens:9000});
    console.log("RESPOSTA ORGANIZADOR:",JSON.stringify(tr));
    const textoOrganizado=extrairTexto(tr);
    console.log("TEXTO ORGANIZADO:",textoOrganizado);
    const ativo=parseJSON(textoOrganizado);
    if(!ativo)return resposta({ok:false,erro:"As chapas foram lidas, mas não foi possível organizar os dados.",leituras,texto_organizacao:textoOrganizado},502);

    return resposta({ok:true,ativo:normalizarAtivo(ativo),leituras});
  }catch(e){return resposta({ok:false,erro:e?.message||String(e)},500)}
}};

function extrairVisao(r){
  if(typeof r?.result?.answer==="string")return r.result.answer;
  if(typeof r?.answer==="string")return r.answer;
  if(typeof r?.result?.response==="string")return r.result.response;
  if(typeof r?.response==="string")return r.response;
  if(typeof r==="string")return r;
  return "";
}
function extrairTexto(r){
  if(typeof r==="string")return r;
  if(typeof r?.response==="string")return r.response;
  if(typeof r?.result?.response==="string")return r.result.response;
  if(typeof r?.result?.answer==="string")return r.result.answer;
  if(typeof r?.answer==="string")return r.answer;
  const c=[r?.choices?.[0]?.message?.content,r?.result?.choices?.[0]?.message?.content,r?.choices?.[0]?.text,r?.result?.choices?.[0]?.text,r?.output_text,r?.result?.output_text];
  for(const x of c)if(typeof x==="string"&&x.trim())return x;
  const a=r?.result?.content||r?.content;
  if(Array.isArray(a)){
    const t=a.map(x=>typeof x==="string"?x:(typeof x?.text==="string"?x.text:(typeof x?.content==="string"?x.content:""))).filter(Boolean).join("\n");
    if(t.trim())return t;
  }
  return "";
}
function parseJSON(texto){
  if(!texto)return null;
  let s=String(texto).trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"").trim();
  try{return JSON.parse(s)}catch{}
  const a=s.indexOf("{"),b=s.lastIndexOf("}");
  if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1))}catch{}}
  return null;
}
function normalizarAtivo(x){
  const o=x&&typeof x==="object"?x:{};
  o.transformer=o.transformer&&typeof o.transformer==="object"?o.transformer:{};
  o.power_ratings=Array.isArray(o.power_ratings)?o.power_ratings.filter(Boolean):[];
  o.windings=Array.isArray(o.windings)?o.windings.filter(Boolean):[];
  o.tap_changer=o.tap_changer&&typeof o.tap_changer==="object"?o.tap_changer:{};
  o.tap_changer.entries=Array.isArray(o.tap_changer.entries)?o.tap_changer.entries.filter(e=>e&&Object.values(e).some(v=>String(v||"").trim())):[];
  o.bushings=o.bushings&&typeof o.bushings==="object"?o.bushings:{};
  for(const p of["A","B","C","N"])if(!o.bushings[p]||typeof o.bushings[p]!=="object")o.bushings[p]={};
  o.additional_visible_data=o.additional_visible_data&&typeof o.additional_visible_data==="object"?o.additional_visible_data:{};
  o.warnings=Array.isArray(o.warnings)?o.warnings:[];
  return o;
}
function resposta(dados,status=200){
  return new Response(JSON.stringify(dados,null,2),{status,headers:{...CORS,"Content-Type":"application/json; charset=UTF-8","Cache-Control":"no-store"}});
}

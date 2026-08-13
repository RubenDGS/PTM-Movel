const MODEL="@cf/moondream/moondream3.1-9B-A2B";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
export default{async fetch(request,env){
 if(request.method==="OPTIONS")return new Response(null,{headers:CORS});
 const url=new URL(request.url);
 if(request.method!=="POST"||(url.pathname!=="/"&&url.pathname!=="/analisar"))return resposta({ok:false,erro:"Método ou endereço não permitido."},405);
 if(!env.AI)return resposta({ok:false,erro:'Binding "AI" não encontrado.'},500);
 try{
  const body=await request.json();const images=Array.isArray(body.images)?body.images:[];
  if(!images.length)return resposta({ok:false,erro:"Não foram recebidas fotografias."},400);
  const resultados=[];
  for(const item of images){
   const nome=item.name||"Fotografia";const fase=String(item.fase||"").toUpperCase();const image=item.image||"";
   if(!["A","B","C","N"].includes(fase)){resultados.push({nome,fase,erro:"Fase inválida."});continue}
   if(!image){resultados.push({nome,fase,erro:"Imagem não recebida."});continue}
   try{
    const raw=await env.AI.run(MODEL,{task:"query",image,question:criarPergunta(fase),reasoning:false,temperature:0,max_tokens:3500,stream:false});
    const texto=extrairTexto(raw);const obj=parseJSONSeguro(texto);
    if(!obj){resultados.push({nome,fase,erro:"A leitura não veio num formato utilizável."});continue}
    resultados.push({nome,fase,resultado:validar(obj)});
   }catch(e){resultados.push({nome,fase,erro:e?.message||String(e)})}
  }
  return resposta({ok:true,resultados});
 }catch(e){return resposta({ok:false,erro:e?.message||String(e)},500)}
}};
function criarPergunta(fase){return `Analisa APENAS esta chapa de uma TRAVESSIA / BUSHING elétrica. A fotografia corresponde à travessia ${fase}.
Extrai SOMENTE os valores necessários para UMA linha da secção Travessias do PTM:
1 bil = Nível de isolam. LL (BIL)
2 tensao_fase_terra = Tensão Fase-Terra
3 tensao_max_sistema = Tensão máx. do sistema
4 corrente_nominal = Corrente nominal
5 fd_c1 = FD (C1)
6 c1_pf = Cap. (C1)
7 fd_c2 = FD (C2)
8 c2_pf = Cap. (C2)
9 tipo_isolamento = Tipo de isolamento

REGRAS:
- Usa APENAS informação realmente visível.
- NÃO inventes, NÃO calcules, NÃO deduzas.
- Se um campo não estiver indicado ou legível, devolve "".
- NÃO uses o mesmo valor em dois campos só para preencher.
- BIL / LI / Lightning Impulse -> bil.
- Um / Highest voltage for equipment / Maximum system voltage -> tensao_max_sistema.
- Ir / Rated current / Current rating -> corrente_nominal.
- C1 em pF -> c1_pf. C2 em pF -> c2_pf.
- FD C1 / PF C1 / Power factor C1 / tan delta C1 -> fd_c1.
- FD C2 / PF C2 / Power factor C2 / tan delta C2 -> fd_c2.
- tensao_fase_terra só se estiver explicitamente identificada como phase-to-ground / phase-earth / fase-terra / equivalente inequívoco.
- tipo_isolamento só se estiver explicitamente indicado (OIP, RIP, RBP ou descrição equivalente).
- Chapas antigas podem ter poucos dados; deixa o resto vazio.
- Não devolvas fabricante, modelo, série ou ano.
Para cada campo preenchido, em evidencias escreve o rótulo/texto que viste.
Responde SOMENTE com JSON válido:
{"bil":"","tensao_fase_terra":"","tensao_max_sistema":"","corrente_nominal":"","fd_c1":"","c1_pf":"","fd_c2":"","c2_pf":"","tipo_isolamento":"","evidencias":{"bil":"","tensao_fase_terra":"","tensao_max_sistema":"","corrente_nominal":"","fd_c1":"","c1_pf":"","fd_c2":"","c2_pf":"","tipo_isolamento":""}}`}
function validar(x){
 const out={bil:"",tensao_fase_terra:"",tensao_max_sistema:"",corrente_nominal:"",fd_c1:"",c1_pf:"",fd_c2:"",c2_pf:"",tipo_isolamento:"",evidencias:{}};
 out.bil=aceita(x?.bil,/\b(?:kV|V)\b/i);out.tensao_fase_terra=aceita(x?.tensao_fase_terra,/\b(?:kV|V)\b/i);out.tensao_max_sistema=aceita(x?.tensao_max_sistema,/\b(?:kV|V)\b/i);
 out.corrente_nominal=aceita(x?.corrente_nominal,/\b(?:kA|A)\b/i);out.c1_pf=aceita(x?.c1_pf,/\bpF\b/i);out.c2_pf=aceita(x?.c2_pf,/\bpF\b/i);
 out.fd_c1=validarFD(x?.fd_c1);out.fd_c2=validarFD(x?.fd_c2);
 const ti=limpar(x?.tipo_isolamento);out.tipo_isolamento=ti.length<=60?ti:"";
 if(out.tensao_fase_terra&&out.tensao_max_sistema&&normal(out.tensao_fase_terra)===normal(out.tensao_max_sistema))out.tensao_fase_terra="";
 const ev=x?.evidencias&&typeof x.evidencias==="object"?x.evidencias:{};for(const k of Object.keys(out)){if(k==="evidencias")continue;out.evidencias[k]=out[k]?limpar(ev[k]):""}
 return out;
}
function limpar(v){if(v===null||v===undefined)return "";if(typeof v==="number")return String(v);if(typeof v!=="string")return "";return v.trim()}
function normal(v){return limpar(v).toLowerCase().replace(/\s+/g," ")}
function aceita(v,re){const s=limpar(v);return s&&re.test(s)?s:""}
function validarFD(v){const s=limpar(v);if(!s)return "";if(/%/.test(s))return s;if(/^0?[.,]\d+$/.test(s))return s;return ""}
function extrairTexto(x){if(typeof x==="string")return x;if(typeof x?.answer==="string")return x.answer;if(typeof x?.result?.answer==="string")return x.result.answer;if(typeof x?.response==="string")return x.response;if(typeof x?.result==="string")return x.result;return ""}
function parseJSONSeguro(texto){let s=String(texto||"").trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"");try{return JSON.parse(s)}catch{}const a=s.indexOf("{"),b=s.lastIndexOf("}");if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1))}catch{}}return null}
function resposta(dados,status=200){return new Response(JSON.stringify(dados,null,2),{status,headers:{...CORS,"Content-Type":"application/json; charset=UTF-8","Cache-Control":"no-store"}})}

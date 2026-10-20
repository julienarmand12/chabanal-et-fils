/* Chabanal et fils — outil de diagnostic des conflits (lecture seule).
 * Aucun changement du stockage métier, de la file d'attente ou de Supabase.
 * Aucun numéro de série, adresse ou autre donnée client dans le rapport copiable.
 */
(function(){
"use strict";
if(window.__chabanalSyncReadOnlyDiagnostic)return;
window.__chabanalSyncReadOnlyDiagnostic=true;

const KEYS={
 "metier_clients_v1_2_corrigee":"Fiches clients",
 "metier_clients_data_version":"Version du fichier clients",
 "metier_clients_deleted_v1":"Suppressions clients",
 "metier_equipement_modeles_v1":"Catalogue équipements",
 "metier_equipement_attributions_v1":"Attributions équipements",
 "metier_notifications_pieces_v1":"Notifications SAV",
 "metier_equipement_numeros_serie_v1":"Numéros de série / installations PAC",
 "metier_diagnostics_marques_v1":"Diagnostics"
};
const SERIAL="metier_equipement_numeros_serie_v1",ASSIGN="metier_equipement_attributions_v1",CLIENTS="metier_clients_v1_2_corrigee";
const QUEUE="chabanal_v2_sync_queue",META="chabanal_v2_cloud_meta";
const el=id=>document.getElementById(id);
const normalize=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr").trim();
const clean=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function read(key,fallback){try{const raw=localStorage.getItem(key);return raw===null?fallback:JSON.parse(raw)}catch(_){return fallback}}
function stable(x){if(Array.isArray(x))return x.map(stable);if(x&&typeof x==="object"){const y={};Object.keys(x).sort().forEach(k=>y[k]=stable(x[k]));return y}return x}
const eq=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const own=(x,k)=>x&&Object.prototype.hasOwnProperty.call(x,k);
const val=(x,k)=>own(x,k)?x[k]:null;
function prettyModel(field,catalog){
 if(field.startsWith("__pac_installation_v1__")||field==="__pac_installations_v1")return "Installation PAC multisplit";
 if(field.startsWith("__year__"))return "Année de chaudière — "+prettyModel(field.slice(8),catalog);
 const m=catalog.find(x=>x.id===field);
 if(m)return [m.brand,m.model].filter(Boolean).join(" · ").slice(0,115);
 return "Équipement non identifié";
}
async function fetchCloud(key,sb){
 const result=await sb.from("app_sync_state").select("version,value_json").eq("key_name",key).maybeSingle();
 if(result.error)throw result.error;
 return result.data||null;
}
function compareField(local,remote,before,after){
 if(eq(remote,after))return "Déjà identique dans le cloud";
 if(eq(remote,before))return "Modification locale en attente (base cloud compatible)";
 if(eq(local,remote))return "Égal entre appareil et cloud";
 return "Conflit possible : valeur distante différente de la base et du changement local";
}
async function analyse(){
 const q=read(QUEUE,{}),meta=read(META,{});
 const clients=read(CLIENTS,[]);
 const models=read("metier_equipement_modeles_v1",[]);
 const serial=read(SERIAL,{});
 const assignments=read(ASSIGN,{});
 const matches=(Array.isArray(clients)?clients:[]).filter(c=>normalize(c.name).includes("bartonek"));
 const pending=Object.entries(q&&typeof q==="object"?q:{});
 const report=[];
 report.push("DIAGNOSTIC SYNCHRONISATION — LECTURE SEULE");
 report.push("Appareil : "+new Date().toLocaleString("fr-FR"));
 report.push("Catégories en attente : "+pending.length);
 pending.forEach(([k,v])=>report.push("• "+(KEYS[k]||"Autre catégorie")+" | "+(v?.reason||"sans raison")+" | "+(v?.queuedAt||"date inconnue")+" | patch "+(v?.patch?.kind||"absent")));
 report.push("Fiches Bartonek trouvées localement : "+matches.length);
 if(!matches.length)report.push("Bartonek non trouvé dans les fiches locales.");
 const sPending=q?.[SERIAL]||null,aPending=q?.[ASSIGN]||null,cPending=q?.[CLIENTS]||null;
 report.push("File numéros de série : "+(sPending?"en attente":"vide"));
 report.push("File attributions : "+(aPending?"en attente":"vide"));
 report.push("File fiches clients : "+(cPending?"en attente":"vide"));
 let cloudSerial=null,cloudAssign=null,cloudClients=null,cloudStatus="Non interrogé";
 if(typeof window.metierMediaSupabase==="function"){
  try{
   const sb=await window.metierMediaSupabase();
   if(sb){
    const [ss,aa,cc]=await Promise.all([
      fetchCloud(SERIAL,sb),fetchCloud(ASSIGN,sb),
      // Les autres données sont uniquement lues si une modification client est dans la file.
      cPending?fetchCloud(CLIENTS,sb):Promise.resolve(null)
    ]);
    cloudSerial=ss;cloudAssign=aa;cloudClients=cc;
    cloudStatus="Consultation en lecture seule réussie";
    report.push("Cloud : lecture possible");
    report.push("Version cloud numéros de série : "+(ss?.version??"absente")+" / version connue : "+(meta?.[SERIAL]??"inconnue"));
    report.push("Version cloud attributions : "+(aa?.version??"absente")+" / version connue : "+(meta?.[ASSIGN]??"inconnue"));
   }else{cloudStatus="Session cloud non disponible — diagnostic local uniquement";report.push("Cloud : non disponible")}
  }catch(err){cloudStatus="Lecture cloud impossible : "+String(err?.message||err).slice(0,160);report.push("Cloud : lecture impossible")}
 }else{cloudStatus="Connexion de diagnostic cloud indisponible";report.push("Cloud : non disponible")}
 const rows=[];
 for(const client of matches){
   const cid=String(client.id);
   const localBag=serial&&typeof serial==="object"?serial[cid]||{}:{};
   const cloudBag=cloudSerial?.value_json?.[cid]||{};
   const changed=sPending?.patch?.kind==="serial"?sPending.patch.changes?.[cid]||{}:{};
   const fields=new Set([...Object.keys(changed),...Object.keys(localBag),...(cloudSerial?Object.keys(cloudBag):[])]);
   const unequal=[];
   for(const field of fields){
     const a=val(localBag,field),b=val(cloudBag,field),change=changed[field];
     if(cloudSerial&&!eq(a,b)||change){
       const label=prettyModel(field,Array.isArray(models)?models:[]);
       let status;
       if(!cloudSerial)status=change?"Modification locale enregistrée en attente":"Non comparable sans cloud";
       else if(change)status=compareField(a,b,change.before,change.after);
       else status=eq(a,b)?"Égales":"Différence local / cloud (hors patch de la file)";
       unequal.push({label,status,inQueue:!!change});
     }
   }
   const atLocal=Array.isArray(assignments?.[cid])?assignments[cid]:[];
   const atCloud=Array.isArray(cloudAssign?.value_json?.[cid])?cloudAssign.value_json[cid]:[];
   if(cloudAssign&&!eq([...atLocal].sort(),[...atCloud].sort()))unequal.push({label:"Modèles attribués au client",status:"Différence entre appareil et cloud",inQueue:!!aPending?.patch});
   const clientChange=cPending?.patch?.kind==="clients"?cPending.patch.changes?.[cid]:null;
   if(clientChange)unequal.push({label:"Fiche client (hors équipements)",status:"Modification en attente dans la file des clients",inQueue:true});
   report.push("Bartonek : "+unequal.length+" point(s) à examiner"+(cloudSerial?" en comparant le cloud":" localement"));
   unequal.forEach(x=>report.push("• "+x.label+" : "+x.status+(x.inQueue?" [file]":"")));
   rows.push(...unequal);
 }
 const warning=rows.some(r=>r.status.startsWith("Conflit possible"));
 const noPatch=!!sPending&&!sPending.patch;
 if(warning)report.push("Conclusion : au moins un champ de Bartonek peut être en conflit avec le cloud. Aucune fusion automatique n’a été déclenchée.");
 else if(noPatch)report.push("Conclusion : file de numéros de série sans patch de fusion ; résolution automatique potentiellement bloquée.");
 else if(sPending&&!rows.some(x=>x.inQueue))report.push("Conclusion : file des numéros de série en attente, sans preuve qu'elle concerne Bartonek.");
 else if(!pending.length)report.push("Conclusion : aucune modification locale en attente sur cet appareil.");
 else report.push("Conclusion : d'autres modifications ou une synchronisation incomplète restent possibles.");
 const summary={pending,rows,cloudStatus,warning,noPatch,matches:matches.length,report:report.join("\n")};
 // Les entrées de la file et les données cloud sont conservées uniquement en mémoire pour l’analyse.
 return summary;
}
function renderResult(result){
 const box=el("sync-readonly-results");if(!box)return;
 const queueKeys=Object.keys(result.pending);
 let html='<p><strong>'+queueKeys.length+' catégorie(s) en attente</strong> · '+clean(result.cloudStatus)+'</p>';
 html+='<div class="sync-ro-keys">'+(queueKeys.length?queueKeys.map(k=>'<div>• '+clean(KEYS[k]||"Autre catégorie")+' — '+clean(result.pending[k]?.reason||"en attente")+'</div>').join(""):'<div>Aucune modification en attente détectée sur cet appareil.</div>')+'</div>';
 html+='<p><strong>Bartonek : '+result.matches+' fiche(s) trouvée(s)</strong></p>';
 if(result.rows.length)html+='<div class="sync-ro-rows">'+result.rows.slice(0,16).map(x=>'<div class="sync-ro-row"><strong>'+clean(x.label)+'</strong><div>'+clean(x.status)+'</div></div>').join("")+'</div>';
 else html+='<p class="muted small">Aucun écart spécifique à Bartonek identifié dans les éléments accessibles.</p>';
 if(result.warning)html+='<p>⚠️ Une modification locale de Bartonek peut être en conflit avec une version distante. Ne remplace pas les données avant comparaison.</p>';
 if(result.noPatch)html+='<p>⚠️ La file contient une modification sans détail de fusion exploitable. Aucune correction n’a été tentée.</p>';
 html+='<p class="muted small">Aucune donnée modifiée. Le rapport copiable ne contient pas les numéros de série, coordonnées ou identifiants de connexion.</p>';
 html+='<button type="button" class="secondary small" id="sync-readonly-copy">Copier le bilan sans données personnelles</button>';
 box.innerHTML=html;
 el("sync-readonly-copy")?.addEventListener("click",()=>{
  const data=result.report;
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(data).then(()=>{el("sync-readonly-copy").textContent="✓ Copié"}).catch(()=>{prompt("Copie ce bilan :",data)});
  else prompt("Copie ce bilan :",data);
 });
}
async function run(){
 const resultBox=el("sync-readonly-results"),button=el("sync-readonly-button");
 if(!resultBox||!button)return;
 button.disabled=true;resultBox.hidden=false;resultBox.textContent="Analyse en lecture seule des états local et distant…";
 try{renderResult(await analyse())}
 catch(err){resultBox.textContent="Diagnostic incomplet : "+String(err?.message||err).slice(0,200)}
 finally{button.disabled=false}
}
function init(){
 const panel=el("cloudSyncPanel");
 if(!panel||el("sync-readonly-button"))return;
 const holder=document.createElement("div");
 holder.className="sync-ro-holder";
 holder.innerHTML='<button type="button" class="secondary small" id="sync-readonly-button">🔎 Analyser les conflits (lecture seule)</button>'+
 '<div id="sync-readonly-results" class="sync-ro-results" hidden></div>';
 panel.appendChild(holder);
 el("sync-readonly-button")?.addEventListener("click",run);
 const st=document.createElement("style");
 st.textContent=".sync-ro-holder{margin-top:10px}.sync-ro-results{margin-top:9px;padding:12px;border:1px solid #345478;border-radius:10px;background:#06192f;color:#ddecff;line-height:1.4;font-size:.88rem;overflow-wrap:anywhere}.sync-ro-results[hidden]{display:none}.sync-ro-keys,.sync-ro-rows{margin:9px 0;display:grid;gap:5px}.sync-ro-row{border:1px solid #315478;border-radius:7px;padding:8px}.sync-ro-row strong{display:block;margin-bottom:4px}";
 document.head.appendChild(st);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
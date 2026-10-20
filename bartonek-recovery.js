/* Chabanal et fils : récupération manuelle et ciblée de Bartonek.
 * Jamais de correction automatique. Sauvegarde persistante + contrôle de version CAS.
 * Aucune écriture Supabase avant confirmation explicite.
 */
(function(){
"use strict";
if(window.__chabanalBartonekRecovery)return;
window.__chabanalBartonekRecovery=true;
const CLIENTS="metier_clients_v1_2_corrigee";
const MODELS="metier_equipement_modeles_v1";
const ASSIGNMENTS="metier_equipement_attributions_v1";
const SERIAL="metier_equipement_numeros_serie_v1";
const QUEUE="chabanal_v2_sync_queue";
const META="chabanal_v2_cloud_meta";
const BACKUP_PREFIX="chabanal_v2_recovery_bartonek_";
const $=id=>document.getElementById(id);
const clone=x=>JSON.parse(JSON.stringify(x));
const get=(key,fallback)=>{try{const s=localStorage.getItem(key);return s===null?fallback:JSON.parse(s)}catch(_){return fallback}};
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==="object"?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const owns=(o,k)=>!!o&&Object.prototype.hasOwnProperty.call(o,k);
const normalize=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr").trim();
const html=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const noSecrets=x=>String(x?.message||x||"Erreur inconnue").slice(0,140);
let prepared=null,busy=false;
function localState(){
 const clients=get(CLIENTS,[]),catalog=get(MODELS,[]),assigned=get(ASSIGNMENTS,{}),values=get(SERIAL,{}),queue=get(QUEUE,{});
 if(!Array.isArray(clients)||!Array.isArray(catalog))throw Error("Fichier clients ou catalogue indisponible.");
 const matches=clients.filter(c=>normalize(c.name)==="bartonek");
 if(matches.length!==1)throw Error("Il faut exactement une fiche « Bartonek » sur cet appareil.");
 const cid=String(matches[0].id);
 const ticket=queue?.[SERIAL];
 if(!ticket?.patch||ticket.patch.kind!=="serial")
  throw Error("Aucune modification de numéro de série réconciliable en attente sur cet appareil.");
 const all=ticket.patch.changes||{};
 if(Object.keys(all).length!==1||!all[cid])
  throw Error("La file contient aussi des changements d'autres clients. Récupération ciblée suspendue.");
 const keys=Object.keys(all[cid]);
 const targetIds=keys.filter(k=>!k.startsWith("__year__"));
 if(targetIds.length!==1)
  throw Error("Plusieurs équipements ou aucun numéro sont concernés. Récupération ciblée suspendue.");
 const modelId=targetIds[0],yearKey="__year__"+modelId;
 if(keys.some(k=>k!==modelId&&k!==yearKey))
  throw Error("La file comporte un autre champ d'équipement. Récupération ciblée suspendue.");
 const model=catalog.find(m=>m.id===modelId);
 if(!model||normalize(model.brand)!=="ariston"||normalize(model.model)!=="clas one 25 fr"||model.type!=="chaudiere")
  throw Error("Le modèle en attente n'est pas la chaudière Ariston Clas one 25 fr.");
 if(!Array.isArray(assigned?.[cid])||!assigned[cid].includes(modelId))
  throw Error("La chaudière concernée n'est plus attribuée à Bartonek.");
 const localBag=values?.[cid]||{};
 const serialChange=all[cid][modelId];
 if(typeof localBag[modelId]!=="string"||!localBag[modelId].trim())
  throw Error("Le numéro complet local est absent : aucune récupération possible.");
 if(!same(localBag[modelId],serialChange.after))
  throw Error("Le numéro local a changé depuis sa mise en attente : ne rien écraser.");
 const yearChange=all[cid][yearKey];
 if(yearChange&&!same(localBag[yearKey]??null,yearChange.after))
  throw Error("L'année locale a changé depuis la mise en attente : récupération suspendue.");
 return {cid,modelId,yearKey,model,ticket,serialChange,yearChange,values,localBag,queue};
}
async function cloud(){
 if(typeof window.metierMediaSupabase!=="function")throw Error("Connexion Supabase indisponible.");
 const sb=await window.metierMediaSupabase();
 if(!sb)throw Error("Session Supabase non disponible.");
 const {data,error}=await sb.from("app_sync_state").select("version,value_json").eq("key_name",SERIAL).maybeSingle();
 if(error)throw error;
 if(!data||!Number.isInteger(Number(data.version))||!data.value_json||typeof data.value_json!=="object"||Array.isArray(data.value_json))
  throw Error("Version cloud des numéros de série indisponible.");
 return {sb,version:Number(data.version),value:data.value_json};
}
function withoutTarget(values,cid,modelId,yearKey){
 const copy=clone(values);
 if(copy[cid]&&typeof copy[cid]==="object"){
  delete copy[cid][modelId];
  delete copy[cid][yearKey];
  if(!Object.keys(copy[cid]).length)delete copy[cid];
 }
 return copy;
}
function validateCloud(state,remote){
 const bag=remote.value[state.cid]||{};
 const current=bag[state.modelId]??null;
 if(same(current,state.serialChange.after))
  throw Error("Le cloud possède déjà le numéro complet : aucune correction forcée nécessaire.");
 if(!same(current,state.serialChange.before)&&!same(current,state.serialChange.after)){
  // Un conflit non réconciliable automatiquement est précisément le cas pris en charge,
  // mais sa résolution reste manuelle, après présentation côte à côte et confirmation.
  if(typeof current!=="string")throw Error("Valeur cloud non textuelle. Intervention manuelle requise.");
 }
 if(state.yearChange){
  const cloudYear=bag[state.yearKey]??null;
  if(!same(cloudYear,state.yearChange.before)&&!same(cloudYear,state.yearChange.after))
   throw Error("L'année distante présente aussi un conflit distinct. Récupération suspendue.");
 }
 if(!same(withoutTarget(state.values,state.cid,state.modelId,state.yearKey),
          withoutTarget(remote.value,state.cid,state.modelId,state.yearKey)))
  throw Error("D'autres différences entre données locales et cloud existent. Aucun écrasement global autorisé.");
 if(typeof state.ticket.nonce!=="string"||!state.ticket.nonce)
  throw Error("Identifiant de modification en attente manquant.");
 return bag;
}
function mergedValue(state,remote){
 const next=clone(remote.value);
 if(!next[state.cid]||typeof next[state.cid]!=="object"||Array.isArray(next[state.cid]))next[state.cid]={};
 next[state.cid][state.modelId]=state.serialChange.after;
 if(state.yearChange){
  if(state.yearChange.after===null)delete next[state.cid][state.yearKey];
  else next[state.cid][state.yearKey]=state.yearChange.after;
 }
 return next;
}
function message(x,isError){
 const node=$("bartonek-recovery-message");if(!node)return;
 node.textContent=x;
 node.className="bartonek-recovery-message "+(isError?"bartonek-recovery-error":"");
}
function hidePreview(){prepared=null;const panel=$("bartonek-recovery-preview");if(panel){panel.hidden=true;panel.innerHTML=""}}
function serialField(label,value){
 return '<div class="bartonek-recovery-field"><label>'+html(label)+'</label><code>'+html(value==null?"Non renseigné":String(value))+'</code></div>';
}
async function prepare(){
 if(busy)return;
 busy=true;hidePreview();message("Vérification en lecture seule…");
 const button=$("bartonek-recovery-prepare");if(button)button.disabled=true;
 try{
  const state=localState(),remote=await cloud(),bag=validateCloud(state,remote);
  const resolved=mergedValue(state,remote);
  prepared={state,remote,merged:resolved};
  const preview=$("bartonek-recovery-preview");
  preview.innerHTML='<h4>Comparer avant de récupérer — Bartonek</h4>'+
   '<p>Chaudière : <strong>'+html(state.model.brand+" · "+state.model.model)+'</strong> · Version cloud '+remote.version+'</p>'+
   serialField("Téléphone 2 : numéro local à conserver",state.localBag[state.modelId])+
   serialField("Supabase / téléphone 1 : numéro actuellement enregistré",bag[state.modelId])+
   (state.yearChange?'<p>Année : '+html(String(bag[state.yearKey]??"Non renseignée"))+' → '+html(String(state.yearChange.after??"Non renseignée"))+'</p>':"")+
   '<p><strong>Portée :</strong> uniquement le numéro de série et, si nécessaire, l’année de cette chaudière. Les autres fiches restent intactes.</p>'+
   '<p>Une sauvegarde locale des deux versions sera créée avant l’écriture. La version du cloud sera revérifiée. Si une autre modification intervient, l’opération sera annulée.</p>'+
   '<label class="bartonek-recovery-checkbox"><input id="bartonek-recovery-confirm" type="checkbox"> Je confirme que le numéro affiché sur le téléphone 2 est le bon et j’autorise cette correction ciblée.</label>'+
   '<div class="row" style="gap:9px;flex-wrap:wrap">'+
    '<button type="button" class="primary" id="bartonek-recovery-commit" disabled>Confirmer et récupérer ce numéro</button>'+
    '<button type="button" class="secondary" id="bartonek-recovery-cancel">Annuler</button>'+
   '</div>';
  preview.hidden=false;
  $("bartonek-recovery-confirm").addEventListener("change",event=>{$("bartonek-recovery-commit").disabled=!event.target.checked});
  $("bartonek-recovery-commit").addEventListener("click",apply);
  $("bartonek-recovery-cancel").addEventListener("click",()=>{hidePreview();message("Opération annulée. Aucune donnée modifiée.")});
  message("Comparaison effectuée sans modification. Vérifie les deux numéros avant de confirmer.");
 }catch(error){message("Aucune modification : "+noSecrets(error),true)}
 finally{busy=false;if(button)button.disabled=false}
}
async function apply(){
 if(busy||!prepared||!$("bartonek-recovery-confirm")?.checked)return;
 busy=true;
 const commit=$("bartonek-recovery-commit");if(commit)commit.disabled=true;
 message("Contrôle des versions et sauvegarde avant correction…");
 const snapshot=prepared;
 // Un échec après une écriture cloud ne doit jamais déclencher de nouvel envoi automatique.
 let serverCommitted=false;
 try{
  const fresh=localState();
  if(fresh.cid!==snapshot.state.cid||fresh.modelId!==snapshot.state.modelId||
     fresh.ticket.nonce!==snapshot.state.ticket.nonce||!same(fresh.values,snapshot.state.values))
    throw Error("Les données du téléphone 2 ont changé. Relance la préparation.");
  const remote=await cloud();
  if(remote.version!==snapshot.remote.version||!same(remote.value,snapshot.remote.value))
    throw Error("Le cloud a changé depuis la comparaison. Relance la préparation.");
  validateCloud(fresh,remote);
  const merged=mergedValue(fresh,remote);
  const backup={
   kind:"chabanal-bartonek-recovery-v1",createdAt:new Date().toISOString(),
   key:SERIAL,clientId:fresh.cid,modelId:fresh.modelId,versionCloudBefore:remote.version,
   clientLocalBefore:clone(fresh.localBag),clientCloudBefore:clone(remote.value[fresh.cid]||{}),
   changeBefore:clone(fresh.ticket.patch.changes[fresh.cid]),
   queueEntryBefore:clone(fresh.ticket),metaBefore:get(META,{})[SERIAL]??null
  };
  const backupKey=BACKUP_PREFIX+Date.now();
  const backupRaw=JSON.stringify(backup);
  // L'échec d'une sauvegarde locale bloque l'opération avant toute écriture Supabase.
  localStorage.setItem(backupKey,backupRaw);
  if(localStorage.getItem(backupKey)!==backupRaw)
    throw Error("La sauvegarde locale n'a pas pu être vérifiée. Aucun envoi effectué.");
  let uid=null;
  try{const response=await remote.sb.auth.getUser();uid=response?.data?.user?.id||null}catch(_){}
  const body={value_json:merged,version:remote.version+1,updated_at:new Date().toISOString(),
   updated_by:uid,change_reason:"bartonek-confirmed-serial-reconciliation"};
  const operation=await remote.sb.from("app_sync_state").update(body)
   .eq("key_name",SERIAL).eq("version",remote.version).select("version");
  if(operation.error)throw operation.error;
  if(!Array.isArray(operation.data)||operation.data.length!==1)
    throw Error("La version du cloud a évolué pendant l'écriture. Aucune modification confirmée.");
  serverCommitted=true;
  const verified=await cloud();
  if(verified.version!==body.version||!same(verified.value,merged))
    throw Error("Le cloud ne confirme pas la nouvelle version. Ne recommence pas l'opération.");
  // L'écriture cloud est désormais vérifiée ; ne pas faire évoluer silencieusement
  // une édition locale apparue pendant la requête.
  const currentQueue=get(QUEUE,{}),currentSerial=get(SERIAL,{});
  if(currentQueue?.[SERIAL]?.nonce!==fresh.ticket.nonce||!same(currentSerial,fresh.values))
    throw Error("Cloud corrigé, mais l'appareil a changé pendant l'opération. Conservation de la file pour examen.");
  // Remplacer uniquement la clé des numéros de série, jamais les autres catégories.
  // Le moteur natif détectera une éventuelle différence, puis convergera.
  if(!same(currentSerial,merged))localStorage.setItem(SERIAL,JSON.stringify(merged));
  const meta=get(META,{});
  meta[SERIAL]=body.version;
  localStorage.setItem(META,JSON.stringify(meta));
  // Retirer UNIQUEMENT le ticket confirmé, sans toucher à une nouvelle édition.
  const latestQueue=get(QUEUE,{});
  if(latestQueue?.[SERIAL]?.nonce===fresh.ticket.nonce&&same(get(SERIAL,{}),merged)){
    delete latestQueue[SERIAL];
    localStorage.setItem(QUEUE,JSON.stringify(latestQueue));
  }
  hidePreview();
  message("✅ Numéro complet sauvegardé et vérifié sur Supabase (version "+body.version+"). Copie de sécurité locale créée. Ouvre ensuite le téléphone 1 et laisse-le se synchroniser.");
 }catch(error){
  const after=serverCommitted?
   "Le cloud a peut-être été corrigé. Ne réessaie pas sans relancer le diagnostic. ":"Aucune correction cloud confirmée. ";
  message(after+noSecrets(error),true);
  hidePreview();
 }finally{busy=false;if(commit)commit.disabled=false}
}
function init(){
 const parent=$("cloudSyncPanel");
 if(!parent||$("bartonek-recovery-prepare"))return;
 const holder=document.createElement("div");
 holder.className="bartonek-recovery";
 holder.innerHTML='<button type="button" class="secondary small" id="bartonek-recovery-prepare">🛟 Préparer la récupération Bartonek (téléphone 2)</button>'+
 '<div id="bartonek-recovery-message" class="bartonek-recovery-message" aria-live="polite">Aucune correction ne sera faite sans confirmation.</div>'+
 '<div id="bartonek-recovery-preview" class="bartonek-recovery-preview" hidden></div>';
 parent.appendChild(holder);
 $("bartonek-recovery-prepare").addEventListener("click",prepare);
 const style=document.createElement("style");
 style.textContent=".bartonek-recovery{margin-top:12px;padding-top:10px;border-top:1px solid #294d70}.bartonek-recovery-message{font-size:.85rem;color:#b9dbfa;margin:7px 0}.bartonek-recovery-error{color:#fda4af}.bartonek-recovery-preview{border:1px solid #396994;border-radius:10px;padding:12px;margin:8px 0;color:#eaf5ff;overflow-wrap:anywhere}.bartonek-recovery-preview[hidden]{display:none}.bartonek-recovery-field{margin:10px 0}.bartonek-recovery-field label{display:block;margin-bottom:5px;font-size:.85rem}.bartonek-recovery-field code{display:block;white-space:pre-wrap;overflow-wrap:anywhere;padding:8px;background:#04162c;border-radius:8px;font:inherit;font-weight:700}.bartonek-recovery-checkbox{display:flex;gap:8px;align-items:flex-start;margin:12px 0}.bartonek-recovery-checkbox input{margin-top:4px}";
 document.head.appendChild(style);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
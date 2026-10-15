/* Chabanal et fils - stock par marque, code-barres et synchro multi-appareils. */
(function(){
"use strict";
const PREFIX="metier_stock_v1_", CACHE="chabanal_stock_cache_v1", PENDING="chabanal_stock_pending_v1";
const el=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr").trim();
const uid=()=>typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+"_"+Math.random().toString(36).slice(2);
const stamp=()=>new Date().toISOString();
function read(key){try{const o=JSON.parse(localStorage.getItem(key)||"{}");return o&&typeof o==="object"&&!Array.isArray(o)?o:{}}catch(e){return {}}}
function persist(key,obj){try{localStorage.setItem(key,JSON.stringify(obj));return true}catch(e){alert("Stockage local plein : changement non conservé.");return false}}
let cache=read(CACHE),pending=read(PENDING),selected="",busy=false,lastError="",lastSynced=false,sbChannel=null,initialized=false,resyncRequested=false;
let scanner=null,scannerStream=null,scannerActive=false,scannerTimer=null,scanCallback=null,scanToken=0,scanScript=null;
const keyFor=o=>PREFIX+o.kind+"_"+o.id;
const all=()=>{
 const m={};
 for(const [k,x] of Object.entries(cache))if(x&&x.value)m[k]=x.value;
 for(const [k,x] of Object.entries(pending))if(x&&x.value)m[k]=x.value;
 return Object.values(m).filter(x=>x&&typeof x==="object");
};
// Une seule rubrique visible, sans déplacement ni suppression des références existantes.
const COMBINED_NAME="Ariston / Chaffoteaux";
const combinedBrand=name=>{
 const n=norm(name).replace(/[^a-z0-9]+/g," ").trim();
 return n==="ariston"||n==="chaffoteaux"||n==="ariston chaffoteaux"||n==="chaffoteaux ariston";
};
const rawBrands=()=>all().filter(x=>x.kind==="brand"&&!x.deleted);
const combinedIds=()=>new Set(rawBrands().filter(b=>combinedBrand(b.name)).map(b=>b.id));
const brands=()=>{
 const raw=rawBrands(),group=raw.filter(b=>combinedBrand(b.name)),other=raw.filter(b=>!combinedBrand(b.name));
 if(group.length){
  const representative=group.find(b=>norm(b.name)===norm(COMBINED_NAME))||
   group.find(b=>norm(b.name)==="ariston")||
   group.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)))[0];
  other.push({...representative,name:COMBINED_NAME});
 }
 return other.sort((a,b)=>a.name.localeCompare(b.name,"fr",{sensitivity:"base"}));
};
const canonicalId=id=>{
 const group=combinedIds();
 return group.has(id)?(brands().find(b=>combinedBrand(b.name))?.id||id):id;
};
const sameStock=(id,chosen)=>id===chosen||(combinedIds().has(id)&&combinedIds().has(chosen));
const items=()=>all().filter(x=>x.kind==="item"&&!x.deleted);
const originalBrandName=id=>rawBrands().find(b=>b.id===id)?.name||"Marque inconnue";
const brandName=id=>combinedIds().has(id)?COMBINED_NAME:originalBrandName(id);
function saveChange(data){
 const obj={...data,updatedAt:stamp()},key=keyFor(obj),old=pending[key];
 const next={...pending,[key]:{value:obj,baseVersion:old?old.baseVersion:Number(cache[key]?.version||0),nonce:uid()}};
 if(!persist(PENDING,next))return false;
 pending=next;lastSynced=false;render();sync().catch(console.warn);return true;
}
function option(v,t){return '<option value="'+esc(v)+'">'+esc(t)+'</option>'}
function render(){
 if(!el("stock")||!initialized||el("stock").classList.contains("hidden"))return;
 const opts=brands(),select=el("stock-brand-filter");
 const before=canonicalId(selected||select.value);
 if(!opts.some(x=>x.id===before))selected=opts[0]?.id||"";else selected=before;
 select.innerHTML=option("","Choisir une marque…")+opts.map(b=>option(b.id,b.name)).join("");
 select.value=selected;
 el("stock-brand-selected").textContent=selected?"Stock : "+brandName(selected):"Crée une marque pour commencer à enregistrer des références.";
 const active=!!selected;
 el("stock-search").disabled=!active;
 el("stock-scan-search").disabled=!active;
 el("stock-add-item").disabled=!active;
 const q=norm(el("stock-search").value);
 const allItems=items().filter(x=>sameStock(x.brandId,selected));
 const repeatedReferences=new Map();
 for(const x of allItems)repeatedReferences.set(norm(x.reference),(repeatedReferences.get(norm(x.reference))||0)+1);
 const matching=allItems.filter(x=>!q||[x.reference,x.designation,x.barcode].some(t=>norm(t).includes(q))).sort((a,b)=>a.reference.localeCompare(b.reference,"fr",{numeric:true,sensitivity:"base"}));
 el("stock-summary").innerHTML=active?'<span class="stock-pill">'+allItems.length+' référence(s)</span><span class="stock-pill">'+allItems.reduce((v,x)=>v+Number(x.quantity||0),0)+' pièce(s)</span>':'';
 el("stock-list").innerHTML=!active?'<div class="stock-empty">Sélectionne ou crée une marque.</div>':!matching.length?'<div class="stock-empty">'+(q?"Aucun article correspondant dans cette marque.":"Aucune référence pour cette marque.")+'</div>':matching.map(x=>
  '<div class="stock-article-row" data-stock-id="'+esc(x.id)+'">'+
  '<div class="stock-ref-cell"><span class="stock-coltitle">Référence</span><div class="stock-reference">'+esc(x.reference)+'</div>'+(x.barcode&&x.barcode!==x.reference?'<div class="muted small">Code-barres : '+esc(x.barcode)+'</div>':'')+(repeatedReferences.get(norm(x.reference))>1?'<div class="muted small">Origine : '+esc(originalBrandName(x.brandId))+'</div>':'')+'</div>'+
  '<div class="stock-designation-cell"><span class="stock-coltitle">Désignation</span><div class="stock-designation">'+esc(x.designation)+'</div></div>'+
  '<div class="stock-qty-cell"><label class="stock-coltitle" for="stock-qty-'+esc(x.id)+'">Quantité</label><input id="stock-qty-'+esc(x.id)+'" data-stock-quantity="'+esc(x.id)+'" class="stock-qty" type="number" inputmode="numeric" min="0" step="1" value="'+Number(x.quantity||0)+'" aria-label="Quantité de '+esc(x.reference)+'"></div>'+
  '<div class="stock-article-actions"><button type="button" class="secondary small" data-stock-edit="'+esc(x.id)+'">Modifier</button><button type="button" class="secondary small" data-stock-delete="'+esc(x.id)+'">Supprimer</button></div></div>'
 ).join("");
 renderStatus();
}
function renderStatus(){
 const box=el("stock-status");if(!box)return;
 const queueCount=Object.keys(pending).length;
 const conflicts=Object.entries(pending).filter(([k,x])=>x.conflict);
 let txt=queueCount?'<span>⏳ '+queueCount+' changement(s) en attente de synchronisation.</span>':lastSynced?'<span>☁️ Stock synchronisé avec Supabase.</span>':'<span>Les changements seront envoyés à Supabase lorsque la connexion sera disponible.</span>';
 if(lastError)txt+='<div class="muted small">⚠️ '+esc(lastError)+'</div>';
 for(const [key,p] of conflicts)txt+='<div class="stock-conflict">Modification simultanée pour '+esc(p.value.kind==="brand"?p.value.name:p.value.reference)+'. Votre version locale est conservée. <button type="button" class="secondary small" data-stock-resolve="'+esc(key)+'">Appliquer ma version</button></div>';
 box.innerHTML=txt;
}
function knownBrandSuggestions(){
 const existing=brands().map(b=>b.name);
 const models=typeof equipmentModels!=="undefined"&&Array.isArray(equipmentModels)?equipmentModels.map(m=>m.brand):[];
 const vals=[...new Set([...existing,...models].map(s=>String(s||"").trim()).filter(Boolean).map(s=>combinedBrand(s)?COMBINED_NAME:s))].sort((a,b)=>a.localeCompare(b,"fr",{sensitivity:"base"}));
 return '<datalist id="stock-known-brands">'+vals.map(x=>option(x,x)).join("")+'</datalist>';
}
function showModal(inner,submit){
 closeModal();
 const node=document.createElement("div");node.id="stock-modal";node.className="modal-backdrop";
 node.innerHTML='<div class="modal" role="dialog" aria-modal="true">'+inner+'</div>';
 document.body.appendChild(node);
 const form=node.querySelector("form");if(form)form.addEventListener("submit",e=>{e.preventDefault();submit()});
 node.querySelector("[data-stock-close]")?.addEventListener("click",closeModal);
 node.addEventListener("click",e=>{if(e.target===node)closeModal()});
 node.querySelector("input:not([type=hidden])")?.focus();
}
function closeModal(){el("stock-modal")?.remove()}
function addBrand(){
 showModal('<form><div class="row" style="justify-content:space-between"><h2>Créer un stock par marque</h2><button type="button" class="secondary" data-stock-close>✕</button></div>'+
 '<label for="stock-new-brand">Marque de l’équipement</label><input id="stock-new-brand" list="stock-known-brands" maxlength="100" autocomplete="off" required placeholder="Ex. Frisquet">'+knownBrandSuggestions()+
 '<div class="form-actions"><button type="submit" class="primary">Créer la marque</button><button type="button" class="secondary" data-stock-close onclick="this.closest(\'.modal-backdrop\').remove()">Annuler</button></div></form>',()=>{
  const typed=el("stock-new-brand").value.trim().replace(/\s+/g," ");
  if(!typed)return;
  const name=combinedBrand(typed)?COMBINED_NAME:typed;
  const duplicate=brands().find(b=>norm(b.name)===norm(name));
  if(duplicate){selected=duplicate.id;closeModal();render();return;}
  const id=uid();
  if(saveChange({kind:"brand",id,name,deleted:false})){selected=id;closeModal();render();}
 });
}
function articleModal(id){
 if(!selected){alert("Sélectionne d’abord une marque.");return}
 const record=id?items().find(x=>x.id===id):null;
 if(id&&!record)return;
 showModal('<form><div class="row" style="justify-content:space-between"><h2>'+(record?"Modifier":"Ajouter")+' une référence — '+esc(brandName(selected))+'</h2><button class="secondary" type="button" data-stock-close>✕</button></div>'+
 '<div class="modal-grid"><div><label for="stock-article-reference">Référence *</label><div class="row" style="gap:5px"><input id="stock-article-reference" required maxlength="160" value="'+esc(record?.reference||"")+'" placeholder="Saisir la référence"><button type="button" class="secondary" id="stock-article-scan">📷 Scanner</button></div></div>'+
 '<div><label for="stock-article-barcode">Code-barres (facultatif)</label><input id="stock-article-barcode" maxlength="160" value="'+esc(record?.barcode||"")+'" placeholder="EAN / code-barres"></div>'+
 '<div class="full"><label for="stock-article-designation">Désignation *</label><input id="stock-article-designation" maxlength="260" required value="'+esc(record?.designation||"")+'" placeholder="Description de la pièce"></div>'+
 '<div><label for="stock-article-quantity">Quantité *</label><input id="stock-article-quantity" type="number" inputmode="numeric" min="0" max="99999999" step="1" required value="'+(record?Number(record.quantity):0)+'"></div></div>'+
 '<div class="form-actions"><button class="primary" type="submit">💾 Enregistrer</button><button type="button" class="secondary" data-stock-close onclick="this.closest(\'.modal-backdrop\').remove()">Annuler</button></div></form>',()=>{
 const ref=el("stock-article-reference").value.trim(),desc=el("stock-article-designation").value.trim(),barcode=el("stock-article-barcode").value.trim(),raw=el("stock-article-quantity").value,qty=Number(raw);
 if(!ref||!desc){alert("Référence et désignation obligatoires.");return}
 if(!Number.isSafeInteger(qty)||qty<0||qty>99999999||raw===""){alert("La quantité doit être un nombre entier positif ou nul.");return}
 if(items().some(x=>sameStock(x.brandId,selected)&&x.id!==id&&norm(x.reference)===norm(ref))){alert("Cette référence existe déjà dans le stock de cette marque.");return}
 if(saveChange({kind:"item",id:record?.id||uid(),brandId:record?.brandId||selected,reference:ref,designation:desc,quantity:qty,barcode,deleted:false})){closeModal();render();}
 });
 el("stock-article-scan").addEventListener("click",()=>openScanner(code=>{
  const bar=el("stock-article-barcode"),ref=el("stock-article-reference");
  if(!bar||!ref)return;
  bar.value=code;if(!ref.value.trim())ref.value=code;
  ref.focus();
 }));
}
function updateQuantity(id,value){
 const x=items().find(x=>x.id===id);if(!x)return;
 const q=Number(value);
 if(value===""||!Number.isSafeInteger(q)||q<0||q>99999999){alert("Saisis une quantité entière supérieure ou égale à zéro.");render();return}
 if(q!==Number(x.quantity))saveChange({...x,quantity:q});
}
function deleteArticle(id){
 const x=items().find(x=>x.id===id);if(!x)return;
 if(!confirm("Supprimer la référence « "+x.reference+" » du stock "+brandName(x.brandId)+" sur tous les appareils ?"))return;
 saveChange({...x,deleted:true});
}
function resolveConflict(key){
 const p=pending[key];if(!p||!p.conflict)return;
 if(!confirm("Remplacer la version du serveur par votre modification locale pour « "+(p.value.reference||p.value.name)+" » ?"))return;
 const next={...pending,[key]:{...p,baseVersion:Number(p.conflict.serverVersion),conflict:null,nonce:uid()}};
 if(!persist(PENDING,next))return;pending=next;sync().catch(console.warn);renderStatus();
}
function statusError(err){lastError=err?.message||String(err||"Erreur de connexion.");lastSynced=false;renderStatus()}
async function cloud(){
 if(typeof window.metierMediaSupabase!=="function")throw new Error("Le module Supabase n’est pas disponible.");
 const s=await window.metierMediaSupabase();
 if(!s)throw new Error("Connecte cet appareil à Supabase pour synchroniser les stocks.");
 return s;
}
async function sendPending(sb){
 for(const [key,original] of Object.entries(pending)){
  let p=pending[key];if(!p)continue;
  const r=await sb.from("app_sync_state").select("key_name,value_json,version").eq("key_name",key).maybeSingle();
  if(r.error)throw r.error;
  const current=r.data,version=Number(current?.version||0),base=Number(p.baseVersion||0);
  if(version!==base){
   if(current&&JSON.stringify(current.value_json)===JSON.stringify(p.value)){
    cache[key]={value:current.value_json,version};
    if(pending[key]?.nonce===p.nonce)delete pending[key];
    persist(PENDING,pending);persist(CACHE,cache);
    continue;
   }
   p.conflict={serverVersion:version};
   pending[key]=p;persist(PENDING,pending);continue;
  }
  const user=(await sb.auth.getUser()).data.user?.id||null;
  const payload={key_name:key,value_json:p.value,version:version+1,updated_at:stamp(),updated_by:user,change_reason:"stock-update"};
  const u=version?await sb.from("app_sync_state").update(payload).eq("key_name",key).eq("version",version).select("version"):
   await sb.from("app_sync_state").insert(payload).select("version");
  if(u.error)throw u.error;
  if(!u.data||u.data.length!==1){
   p.conflict={serverVersion:version+1};pending[key]=p;persist(PENDING,pending);continue;
  }
  const newVersion=Number(u.data[0].version);
  cache[key]={value:p.value,version:newVersion};
  if(pending[key]?.nonce===p.nonce)delete pending[key];
  else if(pending[key]){pending[key].baseVersion=newVersion;pending[key].conflict=null;}
  persist(CACHE,cache);persist(PENDING,pending);
 }
}
async function receiveAll(sb){
 const next={};
 for(let pos=0;pos<100000;pos+=500){
  const r=await sb.from("app_sync_state").select("key_name,value_json,version").like("key_name",PREFIX+"%").order("key_name").range(pos,pos+499);
  if(r.error)throw r.error;
  for(const row of r.data||[])if(row.key_name.startsWith(PREFIX)&&row.value_json)next[row.key_name]={value:row.value_json,version:Number(row.version||0)};
  if((r.data||[]).length<500)break;
 }
 cache=next;
 persist(CACHE,cache);
}
async function attachRealtime(sb){
 if(sbChannel)return;
 try{
  const ch=sb.channel("chabanal-stock-v1").on("postgres_changes",{event:"*",schema:"public",table:"app_sync_state"},p=>{
   if(!p?.new?.key_name?.startsWith(PREFIX))return;
   clearTimeout(window.__stockRemoteTick);
   window.__stockRemoteTick=setTimeout(()=>sync().catch(console.warn),450);
  });
  ch.subscribe();sbChannel=ch;
 }catch(e){console.warn("Réception instantanée indisponible, vérification périodique active.",e)}
}
async function sync(){
 if(busy){resyncRequested=true;return}
 busy=true;
 try{
  const sb=await cloud();
  await sendPending(sb);
  await receiveAll(sb);
  await attachRealtime(sb);
  lastError="";lastSynced=Object.keys(pending).length===0;
  if(!el("stock")?.classList.contains("hidden")){
   const focused=document.activeElement;
   if(focused&&focused.hasAttribute("data-stock-quantity")){renderStatus();focused.addEventListener("blur",render,{once:true})}
   else render();
  }
 }catch(e){statusError(e)}
 finally{busy=false;if(resyncRequested){resyncRequested=false;Promise.resolve().then(()=>sync().catch(console.warn));}}
}
function loadFallbackScanner(){
 if(window.Html5Qrcode)return Promise.resolve();
 if(scanScript)return scanScript;
 scanScript=new Promise((resolve,reject)=>{
  const s=document.createElement("script");
  s.src="https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js";
  s.async=true;
  s.onload=()=>window.Html5Qrcode?resolve():reject(new Error("Bibliothèque de lecture indisponible."));
  s.onerror=()=>reject(new Error("Impossible de charger le lecteur de codes-barres. Vérifie la connexion Internet."));
  document.head.appendChild(s);
 }).catch(e=>{scanScript=null;throw e});
 return scanScript;
}
async function stopScanner(){
 scanActive(false);
 const sc=scanner;scanner=null;
 if(sc){try{await sc.stop()}catch(e){}try{await sc.clear()}catch(e){}}
 if(scannerStream){scannerStream.getTracks().forEach(t=>t.stop());scannerStream=null}
 clearTimeout(scannerTimer);scannerTimer=null;
}
function scanActive(v){scannerActive=v;if(!v)scanToken++}
async function closeScanner(){el("stock-scan-modal")?.remove();scanCallback=null;await stopScanner()}
function deliverCode(code){
 if(!scannerActive||!String(code||"").trim())return;
 const cb=scanCallback,parsed=String(code).trim();
 closeScanner().then(()=>{if(cb)cb(parsed)});
}
async function tryNativeScan(video){
 if(typeof BarcodeDetector==="undefined"||!navigator.mediaDevices?.getUserMedia)return false;
 let formats=[];
 try{formats=await BarcodeDetector.getSupportedFormats()}catch(e){}
 formats=formats.filter(x=>["ean_13","ean_8","upc_a","upc_e","code_39","code_93","code_128","itf","codabar","qr_code","data_matrix"].includes(x));
 if(!formats.length)return false;
 const detector=new BarcodeDetector({formats});
 const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"}}});
 if(!scannerActive){stream.getTracks().forEach(t=>t.stop());return true}
 scannerStream=stream;video.srcObject=stream;video.hidden=false;await video.play();
 const token=scanToken;
 const tick=async()=>{
  if(!scannerActive||scanToken!==token)return;
  try{
   const found=await detector.detect(video);
   if(found?.length&&found[0].rawValue){deliverCode(found[0].rawValue);return}
  }catch(e){}
  scannerTimer=setTimeout(tick,180);
 };
 tick();
 return true;
}
async function startLibraryScan(){
 await loadFallbackScanner();
 if(!scannerActive)return;
 const node=el("stock-scan-reader");if(!node)return;
 node.hidden=false;
 const allowed=["EAN_13","EAN_8","UPC_A","UPC_E","CODE_39","CODE_93","CODE_128","ITF","CODABAR","QR_CODE","DATA_MATRIX"].map(k=>window.Html5QrcodeSupportedFormats?.[k]).filter(x=>x!==undefined);
 const instance=new Html5Qrcode("stock-scan-reader",{formatsToSupport:allowed,verbose:false});
 scanner=instance;
 const config={fps:12,qrbox:{width:Math.min(260,Math.max(160,window.innerWidth-80)),height:120}};
 try{await instance.start({facingMode:"environment"},config,code=>deliverCode(code),()=>{});}
 catch(firstError){
  if(!scannerActive)return;
  const cameras=await Html5Qrcode.getCameras();
  if(!cameras?.length)throw firstError;
  await instance.start(cameras[0].id,config,code=>deliverCode(code),()=>{});
 }
}
async function openScanner(onRead){
 if(el("stock-scan-modal"))return;
 scanCallback=onRead;scanActive(true);
 const node=document.createElement("div");node.id="stock-scan-modal";node.className="modal-backdrop";
 node.innerHTML='<div class="modal" role="dialog" aria-modal="true"><div class="row" style="justify-content:space-between"><h2>📷 Scanner un code-barres</h2><button class="secondary" type="button" id="stock-scan-close">✕</button></div>'+
 '<p class="muted small">Oriente la caméra vers le code-barres. Autorise l’accès à la caméra si demandé.</p>'+
 '<video id="stock-scan-video" playsinline muted autoplay hidden></video><div id="stock-scan-reader" hidden></div>'+
 '<p class="muted small" id="stock-scan-message">Ouverture de la caméra…</p>'+
 '<div class="form-actions"><button type="button" class="secondary" id="stock-scan-cancel">Annuler</button></div></div>';
 document.body.appendChild(node);
 el("stock-scan-close").onclick=closeScanner;el("stock-scan-cancel").onclick=closeScanner;
 try{
  let native=false;
  try{native=await tryNativeScan(el("stock-scan-video"))}catch(err){await stopScanner();scanActive(true);native=false}
  if(!scannerActive)return;
  if(!native)await startLibraryScan();
  if(el("stock-scan-message"))el("stock-scan-message").textContent="Lecture en cours…";
 }catch(e){
  if(el("stock-scan-message"))el("stock-scan-message").textContent="⚠️ "+(e?.message||e)+". Tu peux saisir le code manuellement.";
  await stopScanner();
 }
}
function init(){
 if(initialized)return;
 initialized=true;
 el("stock-brand-filter")?.addEventListener("change",e=>{selected=e.target.value;el("stock-search").value="";render()});
 el("stock-add-brand")?.addEventListener("click",addBrand);
 el("stock-add-item")?.addEventListener("click",()=>articleModal(null));
 el("stock-search")?.addEventListener("input",render);
 el("stock-scan-search")?.addEventListener("click",()=>openScanner(code=>{
  const search=el("stock-search");search.value=code;render();search.focus();
 }));
 el("stock-list")?.addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.stockEdit)articleModal(b.dataset.stockEdit);
  if(b.dataset.stockDelete)deleteArticle(b.dataset.stockDelete);
 });
 el("stock-list")?.addEventListener("change",e=>{
  if(e.target.dataset.stockQuantity)updateQuantity(e.target.dataset.stockQuantity,e.target.value);
 });
 el("stock-status")?.addEventListener("click",e=>{
  const b=e.target.closest("[data-stock-resolve]");if(b)resolveConflict(b.dataset.stockResolve);
 });
 window.addEventListener("online",()=>sync().catch(console.warn));
 document.addEventListener("visibilitychange",()=>{if(!document.hidden)sync().catch(console.warn)});
 window.addEventListener("keydown",e=>{if(e.key==="Escape"){if(el("stock-scan-modal"))closeScanner();else closeModal()}});
 setInterval(()=>{if(document.visibilityState==="visible"&&(!el("stock")?.classList.contains("hidden")||Object.keys(pending).length))sync().catch(console.warn)},25000);
 render();
 sync().catch(console.warn);
}
window.stockOpenView=function(){init();render();sync().catch(console.warn)};
window.stockCloseScanner=closeScanner;
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
else init();
})();
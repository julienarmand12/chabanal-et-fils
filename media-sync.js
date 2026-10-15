/* Chabanal et fils — pièces jointes synchronisées entre terminaux.
   Chaque fichier occupe sa propre ligne app_sync_state : évite d'écraser les photos
   lorsque plusieurs téléphones travaillent sur des fiches différentes. */
(function(){
"use strict";
const ROOT="metier_media_v1_", PENDING="chabanal_media_pending_v1";
const MAX_FILE=3*1024*1024;
const state=()=>typeof window.metierMediaState==='function'?window.metierMediaState():{};
const cache=new Map(),inflight=new Map(),migrations=new Set();
let running=false, refreshBusy=false, lastError="", refreshTimer=null;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const safeId=s=>String(s||"").replace(/[^a-zA-Z0-9_-]/g,"_");
const prefix=(scope,id)=>ROOT+scope+"_"+safeId(id)+"__";
const hash=data=>{let h=2166136261;const s=String(data||"");for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(36)+"_"+s.length};
const makeId=()=>String(Date.now())+"_"+Math.random().toString(36).slice(2,12);
const parse=()=>{try{const o=JSON.parse(localStorage.getItem(PENDING)||"{}");return o&&typeof o==="object"&&!Array.isArray(o)?o:{}}catch(_){return {}}};
function savePending(q){try{localStorage.setItem(PENDING,JSON.stringify(q));return true}catch(e){lastError="Stockage local plein : impossible de conserver le fichier.";alert(lastError);return false}}
const fileKey=(scope,owner,id)=>prefix(scope,owner)+id;
const group=(scope,id)=>scope+":"+id;
const dataOk=s=>typeof s==="string"&&/^data:(image\/(jpeg|png|webp|gif)|application\/pdf|text\/plain|application\/(msword|vnd\.openxmlformats-officedocument\.[a-z0-9.-]+|vnd\.ms-excel|vnd\.ms-powerpoint|octet-stream));base64,/i.test(s);
const isImage=x=>!!x&&/^image\/(jpeg|png|webp|gif)$/i.test(x.mime||"");
function visible(){
 const s=state();
 const modelId=s.currentEquipmentId;
 if(modelId&&document.getElementById("equipment")&&!document.getElementById("equipment").classList.contains("hidden"))return {scope:"equipment",id:modelId};
 const c=s.current;
 if(c&&document.getElementById("client")&&!document.getElementById("client").classList.contains("hidden")&&!document.getElementById("e_name"))return {scope:"client",id:c.id};
 const d=state().currentDiagnosticId;
 if(d&&document.getElementById("diagnostic")&&!document.getElementById("diagnostic").classList.contains("hidden"))return {scope:"diagnostic",id:d};
 return null;
}
async function cloud(){
 if(typeof window.metierMediaSupabase!=="function")return null;
 const client=await window.metierMediaSupabase();
 if(!client){
  lastError="Connexion Supabase requise sur cet appareil pour partager les pièces jointes.";
  return null;
 }
 return client;
}
function list(scope,id){
 const rem=cache.get(group(scope,id))||new Map(),out=new Map(rem),q=parse(),p=prefix(scope,id);
 for(const [key,item] of Object.entries(q))if(key.startsWith(p))out.set(key,item);
 return [...out.values()].filter(x=>x&&!x.deleted).sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||"")));
}
function cacheRow(scope,id,key,value){const k=group(scope,id);let m=cache.get(k);if(!m){m=new Map();cache.set(k,m)}m.set(key,value)}
function notify(scope,id){
 const v=visible();if(v&&v.scope===scope&&String(v.id)===String(id)){draw(scope,id);if(scope==="diagnostic")hideLegacyCopies(scope,id);}
}
async function remotePage(sb,scope,id){
 const p=prefix(scope,id),results=[];
 for(let start=0;start<10000;start+=500){
  const r=await sb.from("app_sync_state").select("key_name,value_json,version").like("key_name",p+"%").order("key_name").range(start,start+499);
  if(r.error)throw r.error;
  results.push(...(r.data||[]));
  if((r.data||[]).length<500)break;
 }
 return results;
}
async function refresh(scope,id){
 const key=group(scope,id);if(inflight.has(key))return inflight.get(key);
 const task=(async()=>{
  const sb=await cloud();if(!sb)return;
  try{
   const rows=await remotePage(sb,scope,id),m=new Map();
   for(const r of rows)if(r.key_name.startsWith(prefix(scope,id)))m.set(r.key_name,r.value_json);
   cache.set(key,m);lastError="";
   if(scope==="client")await migrateLocalClient(sb,id,m);
   if(scope==="diagnostic")await migrateLegacyDiagnostic(sb,id,m);
   notify(scope,id);
  }catch(e){lastError="Synchronisation des pièces jointes impossible : "+(e.message||e);console.warn(lastError);notify(scope,id)}
 })().finally(()=>inflight.delete(key));
 inflight.set(key,task);return task;
}
function showStatus(scope,id){
 const pend=Object.keys(parse()).filter(k=>k.startsWith(prefix(scope,id))).length;
 const configured=!!localStorage.getItem("chabanal_v2_cloud_config");
 return '<p class="muted small" style="margin-top:9px">'+(pend?'⏳ '+pend+' fichier(s) en attente d’envoi. ':"")+
 (lastError?'⚠️ '+esc(lastError):configured?'☁️ Photos et documents partagés entre les appareils connectés.':'⚠️ Synchronisation cloud non configurée : fichiers conservés sur cet appareil.')+'</p>';
}
function fileHtml(item){
 const key=item.key||fileKey(item.scope,item.ownerId,item.id);
 const thumb=isImage(item)&&dataOk(item.data)?'<img src="'+esc(item.data)+'" alt="'+esc(item.name||"Photo")+'">':'<div class="muted small">📄 '+esc(item.name||"Document")+'</div>';
 return '<div class="photo-item" style="min-height:135px">'+
  '<button type="button" title="Supprimer" data-media-delete="'+esc(key)+'" style="z-index:2">×</button>'+
  '<button type="button" data-media-open="'+esc(key)+'" class="secondary" style="display:block;width:100%;height:100%;padding:5px;background:transparent;border:0">'+thumb+
  '<span class="muted small" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(item.name||"Photo")+'</span></button></div>';
}
function draw(scope,id){
 const all=list(scope,id);
 if(scope==="client"){
  const root=document.getElementById("photoGallery");
  if(!root)return;
  root.innerHTML=all.filter(x=>x.kind==="photo").map(fileHtml).join("")||'<div class="empty-photo muted">Aucune photo sur cette fiche.</div>';
  let panel=document.getElementById("clientCloudDocuments");
  if(!panel){
   const container=root.closest(".panel");
   if(container){
    panel=document.createElement("div");panel.id="clientCloudDocuments";panel.className="panel section";
    container.insertAdjacentElement("afterend",panel);
   }
  }
  if(panel)panel.innerHTML='<div class="row" style="justify-content:space-between;gap:8px"><h3>📄 Documents du client</h3><button type="button" class="secondary" id="clientMediaDocButton">＋ Ajouter un document</button></div>'+
   '<div class="photo-grid">'+(all.filter(x=>x.kind==="document").map(fileHtml).join("")||'<span class="muted small">Aucun document.</span>')+'</div>'+showStatus(scope,id);
  const btn=document.getElementById("clientMediaDocButton");
  if(btn)btn.onclick=()=>pickFiles("client",id,"document",null,false);
 }else if(scope==="equipment"){
  const root=document.getElementById("equipmentPhotoGallery");
  if(!root)return;
  root.innerHTML=all.filter(x=>x.kind==="photo").map(fileHtml).join("")||'<span class="muted small">Aucune photo pour ce modèle.</span>';
  const status=document.getElementById("equipmentPhotoSyncStatus");
  if(status)status.innerHTML=showStatus(scope,id);
 }else{
  const body=document.getElementById("diagnosticBody");
  if(!body)return;
  const brandPanel=Array.from(body.querySelectorAll(".panel.section")).find(p=>p.querySelector("h3")?.textContent.includes("Documents de la marque"));
  if(brandPanel){
   let area=brandPanel.querySelector("#diagnosticCloudMedia");
   if(!area){area=document.createElement("div");area.id="diagnosticCloudMedia";brandPanel.appendChild(area);}
   area.innerHTML='<div class="photo-grid">'+(all.filter(x=>!x.codeId).map(fileHtml).join("")||"")+'</div>'+showStatus(scope,id);
  }
  const codeNodes=body.querySelectorAll(".diagnostic-code"),d=state().diagnosticBrands?.find(x=>String(x.id)===String(id));
  codeNodes.forEach((node,i)=>{
   const c=d?.codes?.[i],codeId=c&&(c.mediaId||"legacy_"+i);
   if(!codeId)return;
   let gallery=node.querySelector(".diagnostic-cloud-code-media");
   if(!gallery){gallery=document.createElement("div");gallery.className="diagnostic-cloud-code-media";node.appendChild(gallery);}
   gallery.innerHTML='<div class="photo-grid">'+all.filter(x=>x.codeId===codeId).map(fileHtml).join("")+'</div>';
  });
 }
}
function fileToData(file){
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onerror=()=>reject(new Error("Fichier illisible."));
  reader.onload=()=>resolve(reader.result);reader.readAsDataURL(file);
 });
}
async function encode(file,kind){
 if(kind==="photo"||file.type.startsWith("image/")){
  if(typeof window.compressPhoto==="function")return await window.compressPhoto(file);
 }
 if(file.size>MAX_FILE)throw new Error("Document trop volumineux (3 Mo maximum par fichier).");
 const data=await fileToData(file);
 if(!dataOk(data))throw new Error("Format de fichier non accepté : "+file.name);
 return data;
}
async function enqueue(scope,ownerId,kind,codeId,file,name,content,forcedId){
 const id=forcedId||makeId(), key=fileKey(scope,ownerId,id);
 const item={id,key,scope,ownerId:String(ownerId),codeId:codeId||null,kind,name:String(name||"Document"),mime:kind==="photo"?"image/jpeg":(file?.type||"application/octet-stream"),data:content,createdAt:new Date().toISOString()};
 if(!dataOk(content))throw new Error("Format de fichier non pris en charge.");
 const q=parse();if(q[key]&&!q[key].deleted)return true;
 q[key]=item;if(!savePending(q))return false;
 notify(scope,ownerId);
 flush().catch(console.warn);
 return true;
}
async function addFiles(scope,ownerId,kind,codeId,files){
 if(!files||!files.length)return true;
 let saved=0;
 for(const file of Array.from(files)){
  if(kind==="photo"&&!file.type.startsWith("image/"))continue;
  try{
   const data=await encode(file,kind);
   if(await enqueue(scope,ownerId,kind,codeId,file,file.name,data))saved++;
  }catch(e){alert("Impossible de joindre "+file.name+" : "+(e.message||e));}
 }
 await flush();
 await refresh(scope,ownerId);
 return saved===files.length;
}
function pickFiles(scope,owner,kind,codeId,multiple,capture){
 const inp=document.createElement("input");inp.type="file";
 if(kind==="photo"&&capture)inp.setAttribute("capture","environment");
 inp.accept=kind==="photo"?"image/*":"application/pdf,image/jpeg,image/png,image/webp,.doc,.docx,.xls,.xlsx,.txt";
 inp.multiple=!!multiple;
 inp.style.display="none";document.body.appendChild(inp);
 inp.onchange=async()=>{const files=[...(inp.files||[])];inp.remove();await addFiles(scope,owner,kind,codeId,files)};
 inp.addEventListener("cancel",()=>inp.remove(),{once:true});
 inp.click();
}
async function writeOne(sb,key,item){
 const get=await sb.from("app_sync_state").select("key_name,value_json,version").eq("key_name",key).maybeSingle();
 if(get.error)throw get.error;
 const prev=get.data;
 if(prev){
  if(!item.deleted||prev.value_json?.deleted)return true;
  const v=Number(prev.version||0),next={...prev.value_json,deleted:true,data:null,deletedAt:new Date().toISOString()};
  const res=await sb.from("app_sync_state").update({value_json:next,version:v+1,updated_at:new Date().toISOString(),change_reason:"delete-media"}).eq("key_name",key).eq("version",v).select("version");
  if(res.error)throw res.error;if(!res.data?.length)throw Error("Suppression en concurrence, nouvel essai nécessaire.");
  return true;
 }
 if(item.deleted)return true;
 const user=(await sb.auth.getUser()).data.user?.id||null;
 const res=await sb.from("app_sync_state").insert({key_name:key,value_json:item,version:1,updated_at:new Date().toISOString(),updated_by:user,change_reason:"media-upload"}).select("version");
 if(res.error){
  const again=await sb.from("app_sync_state").select("key_name").eq("key_name",key).maybeSingle();
  if(!again.data)throw res.error;
 }
 return true;
}
async function flush(){
 if(running)return;
 running=true;
 try{
  const sb=await cloud();if(!sb)return;
  for(const [key,item] of Object.entries(parse())){
   try{
    await writeOne(sb,key,item);
    const q=parse();if(q[key]&&q[key].id===item.id&&!!q[key].deleted===!!item.deleted){delete q[key];savePending(q);}
    const m=cache.get(group(item.scope,item.ownerId));if(m){
     if(item.deleted)m.set(key,{...item,deleted:true,data:null});
     else m.set(key,item);
    }
    notify(item.scope,item.ownerId);
    lastError="";
   }catch(e){lastError="Envoi non confirmé : "+(e.message||e);console.warn(lastError);break;}
  }
 }finally{running=false;}
}
function selectItem(key){
 const q=parse();if(q[key])return q[key];
 for(const map of cache.values())if(map.has(key))return map.get(key);
 return null;
}
async function removeFile(key){
 const item=selectItem(key);
 if(!item||!confirm("Supprimer ce document ou cette photo de tous les appareils ?"))return;
 const q=parse();q[key]={...item,deleted:true,data:null,deletedAt:new Date().toISOString()};
 if(!savePending(q))return;
 if(item.scope==="client"){
  const c=state().clients?.find(x=>String(x.id)===String(item.ownerId));
  if(c&&typeof window.getPhotos==="function"){
   const existing=window.getPhotos(c);
   const left=existing.filter(x=>fileKey("client",c.id,"legacy_"+hash(x))!==key);
   if(left.length!==existing.length&&typeof window.setPhotos==="function")window.setPhotos(c,left);
  }
 }
 notify(item.scope,item.ownerId);await flush();await refresh(item.scope,item.ownerId);
}
async function openFile(key){
 const item=selectItem(key);if(!item||!dataOk(item.data))return alert("Fichier pas encore téléchargé : vérifiez la connexion.");
 try{
  const blob=await (await fetch(item.data)).blob(),url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=item.name||"document";document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(e){alert("Ouverture du fichier impossible.")}
}
async function migrateLocalClient(sb,id,known){
 const c=state().clients?.find(x=>String(x.id)===String(id));
 if(!c||typeof window.getPhotos!=="function")return;
 const legacy=window.getPhotos(c);
 if(!legacy.length)return;
 let ok=true;
 for(const src of legacy){
  if(!dataOk(src)){ok=false;continue;}
  const uid="legacy_"+hash(src),key=fileKey("client",id,uid);
  if(known.get(key)&&!known.get(key).deleted)continue;
  if(known.get(key)?.deleted)continue;
  if(migrations.has(key))continue;
  migrations.add(key);
  const obj={id:uid,key,scope:"client",ownerId:String(id),codeId:null,kind:"photo",name:"Photo client importée.jpg",mime:"image/jpeg",data:src,createdAt:new Date().toISOString()};
  try{await writeOne(sb,key,obj);known.set(key,obj)}catch(e){ok=false;lastError="Import des anciennes photos reporté : "+(e.message||e);}
  finally{migrations.delete(key);}
 }
 if(ok&&legacy.every(x=>known.has(fileKey("client",id,"legacy_"+hash(x))))){
  // On retire seulement les copies déjà confirmées sur le serveur.
  window.setPhotos(c,[]);
 }
}
async function migrateLegacyDiagnostic(sb,id,known){
 const d=state().diagnosticBrands?.find(x=>String(x.id)===String(id));
 if(!d)return;
 const sources=[];
 (d.documents||[]).forEach((doc,i)=>{if(dataOk(doc.data))sources.push({data:doc.data,name:doc.name||"Document",kind:doc.type?.startsWith("image/")?"photo":"document",codeId:null,mime:doc.type||"application/pdf"})});
 (d.codes||[]).forEach((code,i)=>{
  const codeId=code.mediaId||"legacy_"+i;
  (code.photos||[]).forEach((data,j)=>{if(dataOk(data))sources.push({data,name:"Photo code défaut.jpg",kind:"photo",codeId,mime:"image/jpeg"})});
  (code.documents||[]).forEach(doc=>{if(dataOk(doc.data))sources.push({data:doc.data,name:doc.name||"Document",kind:"document",codeId,mime:doc.type||"application/pdf"})});
 });
 for(const src of sources){
  const uid="legacy_"+hash((src.codeId||"brand")+"|"+src.data),key=fileKey("diagnostic",id,uid);
  if(known.has(key)||migrations.has(key))continue;
  migrations.add(key);
  const item={id:uid,key,scope:"diagnostic",ownerId:String(id),kind:src.kind,codeId:src.codeId,name:src.name,mime:src.mime,data:src.data,createdAt:new Date().toISOString()};
  try{await writeOne(sb,key,item);known.set(key,item)}
  catch(e){lastError="Anciennes pièces jointes en attente de synchronisation : "+(e.message||e);break}
  finally{migrations.delete(key)}
 }
}
// Évite d'afficher deux fois un document encore présent dans les anciennes fiches.
function hideLegacyCopies(scope,id){
 if(scope!=="diagnostic")return;
 const d=state().diagnosticBrands?.find(x=>String(x.id)===String(id));if(!d)return;
 const inline=new Set([...(d.documents||[]).map(x=>x.data),...(d.codes||[]).flatMap(c=>[...(c.photos||[]),...(c.documents||[]).map(x=>x.data)])]);
 const parent=document.getElementById("diagnosticBody");if(!parent)return;
 for(const btn of parent.querySelectorAll("[data-media-open]")){
  const item=selectItem(btn.dataset.mediaOpen);
  if(item&&inline.has(item.data))btn.closest(".photo-item")?.remove();
 }
}
const oldClientPhotos=window.renderPhotos;
window.renderPhotos=function(){
 if(typeof oldClientPhotos==="function")oldClientPhotos();
 const c=state().current;if(!c)return;
 const id=c.id;
 // Ne jamais bloquer l'affichage pendant une récupération réseau.
 const legacy=window.getPhotos?.(c)||[];
 const m=cache.get(group("client",id));
 if(!m&&legacy.length){
  for(const src of legacy)if(dataOk(src))cacheRow("client",id,fileKey("client",id,"legacy_"+hash(src)),
   {id:"legacy_"+hash(src),key:fileKey("client",id,"legacy_"+hash(src)),scope:"client",ownerId:id,kind:"photo",name:"Photo client.jpg",mime:"image/jpeg",data:src});
 }
 draw("client",id);
 refresh("client",id).catch(console.warn);
};
window.addPhotos=async function(files){
 const c=state().current;if(!c)return;
 await addFiles("client",c.id,"photo",null,files);
};
window.addDiagnosticDocuments=function(id){
 if(!state().diagnosticBrands?.some(d=>String(d.id)===String(id)))return;
 pickFiles("diagnostic",id,"document",null,true);
};
const renderBrand=window.renderDiagnosticBrand;
window.renderDiagnosticBrand=function(){
 if(typeof renderBrand==="function")renderBrand();
 const id=state().currentDiagnosticId;if(!id)return;
 draw("diagnostic",id);
 hideLegacyCopies("diagnostic",id);
 refresh("diagnostic",id).catch(console.warn);
};
window.metierMediaAddFiles=async function(options){
 const {scope,ownerId,codeId=null,kind,files}=options||{};
 if(!["client","diagnostic","equipment"].includes(scope)||!ownerId||!["photo","document"].includes(kind))return false;
 return await addFiles(scope,ownerId,kind,codeId,files);
};
const originalRenderEquipment=window.renderEquipmentPage;
window.renderEquipmentPage=function(){
 if(typeof originalRenderEquipment==="function")originalRenderEquipment();
 const id=state().currentEquipmentId;
 const page=document.getElementById("equipment");
 if(!id||!page||page.classList.contains("hidden"))return;
 draw("equipment",id);
 refresh("equipment",id).catch(console.warn);
};
window.metierMediaPick=pickFiles;
document.addEventListener("click",e=>{
 const del=e.target.closest("[data-media-delete]");if(del){e.preventDefault();removeFile(del.dataset.mediaDelete);return}
 const open=e.target.closest("[data-media-open]");if(open){e.preventDefault();openFile(open.dataset.mediaOpen)}
});
window.metierMediaRefreshIfVisible=async function(){
 const v=visible();if(!v)return;
 await flush();await refresh(v.scope,v.id);
 if(v.scope==="diagnostic")hideLegacyCopies(v.scope,v.id);
};
window.addEventListener("online",()=>{flush().catch(console.warn);window.metierMediaRefreshIfVisible().catch(console.warn)});
window.addEventListener("load",()=>setTimeout(()=>flush().catch(console.warn),1500));
document.addEventListener("visibilitychange",()=>{if(!document.hidden)window.metierMediaRefreshIfVisible().catch(console.warn)});
refreshTimer=setInterval(()=>{if(document.visibilityState==="visible"){flush().catch(console.warn);window.metierMediaRefreshIfVisible().catch(console.warn)}},25000);
})();
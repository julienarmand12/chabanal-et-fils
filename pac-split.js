/* Chabanal et fils — PAC air/air multisplit : catalogue UE/UI et installations clients.
   Extension compatible avec les modèles, attributions et numéros de série existants.
   Les installations sont conservées dans la clé de numéros de série déjà synchronisée. */
(function(){
"use strict";
if(window.__pacSplitInstalled)return;
window.__pacSplitInstalled=true;

const GROUP_KEY="__pac_installations_v1"; // compatibilité si une ancienne sauvegarde contenait déjà des groupes
const GROUP_PREFIX="__pac_installation_v1__";
const SIZES={mono:1,bi:2,tri:3,quadri:4};
const LABELS={mono:"Mono split",bi:"Bi split",tri:"Tri split",quadri:"Quadri split"};
const ROLE_LABELS={outdoor:"Groupe extérieur",indoor:"Unité intérieure"};
let catalogTab="outdoor",draft=null;

const e=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const get=id=>document.getElementById(id);
const role=m=>m&&m.pacUnit==="indoor"?"indoor":m&&m.pacUnit==="outdoor"?"outdoor":"legacy";
const pacModels=(kind)=>equipmentModels.filter(m=>m.type==="pac_air_air"&&(role(m)===kind||role(m)==="legacy")).sort((a,b)=>modelName(a).localeCompare(modelName(b),"fr",{sensitivity:"base"}));
const modelById=id=>equipmentModels.find(m=>m.id===id);
const makeId=()=>typeof crypto!=="undefined"&&crypto.randomUUID?"pac_"+crypto.randomUUID():"pac_"+Date.now()+"_"+Math.random().toString(36).slice(2);
function installations(cid){
 const bag=equipmentSerialNumbers[cid];
 if(!bag||typeof bag!=="object"||Array.isArray(bag))return [];
 const entries=new Map();
 const legacy=bag[GROUP_KEY];
 if(Array.isArray(legacy))legacy.forEach(g=>{if(g&&typeof g.id==="string")entries.set(g.id,g)});
 for(const [key,value] of Object.entries(bag)){
   if(key.startsWith(GROUP_PREFIX)&&value&&typeof value==="object"&&typeof value.id==="string")entries.set(value.id,value);
 }
 return [...entries.values()];
}
function saveGroups(cid,value){
 if(!cid)return false;
 const oldBucket=equipmentSerialNumbers[cid];
 const original=oldBucket&&typeof oldBucket==="object"&&!Array.isArray(oldBucket)?{...oldBucket}:null;
 const next=original?{...original}:{};
 // Une clé distincte par installation permet à la synchronisation de fusionner
 // les modifications de deux installations différentes sur deux téléphones.
 for(const key of Object.keys(next))if(key===GROUP_KEY||key.startsWith(GROUP_PREFIX))delete next[key];
 for(const group of value)next[GROUP_PREFIX+group.id]=group;
 if(Object.keys(next).length)equipmentSerialNumbers[cid]=next;
 else delete equipmentSerialNumbers[cid];
 if(!saveEquipmentSerialNumbers()){
   if(original)equipmentSerialNumbers[cid]=original;
   else delete equipmentSerialNumbers[cid];
   return false;
 }
 return true;
}
function usedRole(modelId){
 const records=[];
 Object.keys(equipmentSerialNumbers).forEach(cid=>installations(cid).forEach(g=>{
   if(g.outdoor&&g.outdoor.modelId===modelId)records.push({clientId:cid,role:"outdoor"});
   if(Array.isArray(g.indoors)&&g.indoors.some(u=>u.modelId===modelId))records.push({clientId:cid,role:"indoor"});
 }));
 return records;
}
const orig={
 renderEquipmentMenu:window.renderEquipmentMenu,
 filterEquipmentModels:window.filterEquipmentModels,
 newEquipmentModel:window.newEquipmentModel,
 updateBoilerTypeField:window.updateBoilerTypeField,
 saveEquipmentModel:window.saveEquipmentModel,
 editEquipmentModel:window.editEquipmentModel,
 saveEditedModel:window.saveEditedModel,
 assignEquipment:window.assignEquipment,
 renderClientEquipments:window.renderClientEquipments,
 modelClientIds:window.modelClientIds,
 deleteEquipmentModel:window.deleteEquipmentModel
};

function renderPacRows(query){
 const box=get("equipmentMenu"),target=box&&box.querySelector("#equipmentModelResults");if(!target)return;
 const q=String(query||"").toLocaleLowerCase("fr").trim();
 const list=pacModels(catalogTab).filter(m=>modelName(m).toLocaleLowerCase("fr").includes(q));
 target.innerHTML=list.length?list.map(m=>
  '<button type="button" class="equipment-menu-row" onclick="openEquipmentFromSearch(\''+e(m.id)+'\',event)">'+
  '<div class="eq-main"><div class="eq-title">'+e(modelName(m))+'</div>'+
  '<div class="eq-meta">'+(role(m)==="legacy"?"Modèle existant à classer · ":"")+
  e(modelClientIds(m.id).length+" client(s) · "+modelDocs(m).length+" document(s)")+'</div></div><div>›</div></button>'
 ).join(""):'<div class="equipment-empty">Aucun modèle '+(catalogTab==="outdoor"?"de groupe extérieur":"d’unité intérieure")+' correspondant.</div>';
}
function pacCatalog(){
 const box=get("equipmentMenu");if(!box)return;
 const head=box.querySelector(".equipment-menu-header span");
 if(head)head.textContent="❄️ PAC air/air · "+ROLE_LABELS[catalogTab];
 const add=box.querySelector(".equipment-menu-header button");
 if(add)add.textContent="+ Ajouter un modèle "+(catalogTab==="outdoor"?"extérieur":"intérieur");
 const toolbar=box.querySelector(".equipment-search-row");
 if(toolbar)toolbar.insertAdjacentHTML("beforebegin",
 '<div class="pac-tabs" role="tablist" aria-label="Catalogue PAC air/air">'+
 '<button type="button" role="tab" data-pac-tab="outdoor" aria-selected="'+(catalogTab==="outdoor")+'" class="'+(catalogTab==="outdoor"?"pac-active":"")+'">Groupe extérieur</button>'+
 '<button type="button" role="tab" data-pac-tab="indoor" aria-selected="'+(catalogTab==="indoor")+'" class="'+(catalogTab==="indoor"?"pac-active":"")+'">Unité intérieure</button></div>');
 const search=box.querySelector(".equipment-model-search-input");
 if(search)search.placeholder=catalogTab==="outdoor"?"Rechercher un groupe extérieur…":"Rechercher une unité intérieure…";
 renderPacRows(search?search.value:"");
 if(!box.dataset.pacTabsBound){
   box.dataset.pacTabsBound="1";
   box.addEventListener("click",ev=>{
     const btn=ev.target.closest("[data-pac-tab]");if(!btn)return;
     catalogTab=btn.dataset.pacTab;
     renderEquipmentMenu("pac_air_air");
   });
 }
}
window.renderEquipmentMenu=function(type){
 orig.renderEquipmentMenu(type);
 if(type==="pac_air_air")pacCatalog();
};
window.filterEquipmentModels=function(type,q){
 if(type!=="pac_air_air")return orig.filterEquipmentModels(type,q);
 renderPacRows(q);
};

function selectorHtml(prefix,value){
 const selected=value||"";
 return '<div id="'+prefix+'_pac_unit_block"><label for="'+prefix+'_pac_unit">Catégorie PAC air/air *</label>'+
 '<select id="'+prefix+'_pac_unit" class="model-search">'+
 '<option value="outdoor" '+(selected==="outdoor"?"selected":"")+'>Groupe extérieur</option>'+
 '<option value="indoor" '+(selected==="indoor"?"selected":"")+'>Unité intérieure</option></select></div>';
}
function insertCategory(prefix,value){
 const typeSelect=get(prefix+"_type");if(!typeSelect||get(prefix+"_pac_unit_block"))return;
 typeSelect.parentElement.insertAdjacentHTML("afterend",selectorHtml(prefix,value));
 updateBoilerTypeField(prefix);
}
window.updateBoilerTypeField=function(prefix){
 orig.updateBoilerTypeField(prefix);
 const block=get(prefix+"_pac_unit_block");
 if(block)block.style.display=get(prefix+"_type")?.value==="pac_air_air"?"":"none";
};
window.newEquipmentModel=function(type){
 orig.newEquipmentModel(type);
 insertCategory("model",type==="pac_air_air"?catalogTab:"outdoor");
};
window.saveEquipmentModel=async function(){
 const type=get("model_type")?.value;
 if(type!=="pac_air_air")return orig.saveEquipmentModel();
 const brand=get("model_brand")?.value.trim()||"",model=get("model_model")?.value.trim()||"";
 const pacUnit=get("model_pac_unit")?.value||catalogTab;
 if(!brand||!model){alert("La marque et le modèle sont obligatoires.");return}
 if(!["outdoor","indoor"].includes(pacUnit)){alert("Choisis la catégorie PAC.");return}
 if(equipmentModels.some(m=>m.type===type&&role(m)===pacUnit&&String(m.brand).toLocaleLowerCase("fr")===brand.toLocaleLowerCase("fr")&&String(m.model).toLocaleLowerCase("fr")===model.toLocaleLowerCase("fr"))){
   alert("Ce modèle existe déjà dans cette catégorie.");return;
 }
 const files=Array.from(get("model_docs")?.files||[]);
 let docs;
 try{docs=await Promise.all(files.map(fileToDataURL))}catch(err){alert("Impossible de lire la documentation.");return}
 const obj={id:"model_"+Date.now()+"_"+Math.random().toString(36).slice(2,8),type,brand,model,pacUnit,
  notes:get("model_notes")?.value.trim()||"",documents:docs,createdAt:new Date().toISOString()};
 equipmentModels.push(obj);
 if(!saveEquipmentCatalog()){equipmentModels.pop();return}
 closeModelModal();
 catalogTab=pacUnit;
 const box=get("equipmentMenu");
 if(box){box.dataset.type="pac_air_air";box.classList.remove("hidden");renderEquipmentMenu("pac_air_air")}
};
window.editEquipmentModel=function(id){
 const m=modelById(id);
 orig.editEquipmentModel(id);
 if(m)insertCategory("edit_model",role(m)==="indoor"?"indoor":"outdoor");
};
window.saveEditedModel=function(id){
 const m=modelById(id);if(!m)return;
 const type=get("edit_model_type")?.value,chosen=get("edit_model_pac_unit")?.value||"outdoor";
 if(type==="pac_air_air"&&usedRole(id).some(u=>u.role!==chosen)){
   alert("Ce modèle est déjà utilisé dans une installation PAC comme "+(chosen==="indoor"?"groupe extérieur":"unité intérieure")+". Retire ou modifie cette installation avant de changer la catégorie.");return;
 }
 orig.saveEditedModel(id);
 if(get("editModelModal"))return; // La validation ou l'enregistrement a échoué.
 if(type==="pac_air_air")m.pacUnit=chosen;
 else delete m.pacUnit;
 saveEquipmentCatalog();
 if(currentEquipmentId===id)renderEquipmentPage();
 if(get("equipmentMenu")&&!get("equipmentMenu").classList.contains("hidden"))renderEquipmentMenu(type);
};
window.modelClientIds=function(id){
 const cids=new Set(orig.modelClientIds(id));
 Object.keys(equipmentSerialNumbers).forEach(cid=>{if(installations(cid).some(g=>
  g.outdoor?.modelId===id||(Array.isArray(g.indoors)&&g.indoors.some(u=>u.modelId===id))))cids.add(cid)});
 return [...cids];
};
window.deleteEquipmentModel=function(id){
 const used=usedRole(id);
 if(used.length){alert("Ce modèle est utilisé dans "+used.length+" installation(s) PAC. Retire d’abord ces installations des fiches clients pour ne pas perdre leurs références et numéros de série.");return}
 return orig.deleteEquipmentModel(id);
};

function validYear(v){return !String(v||"").trim()||/^\d{4}$/.test(String(v).trim())}
function yearLabel(v){return v?String(v):"Non renseignée"}
function serialLabel(v){return v?String(v):"Non renseigné"}
function dataSummary(serial,year){
 return '<span class="pac-compact-info">N° de série : '+e(serialLabel(serial))+'</span>'+
  '<span class="pac-compact-info">Année : '+e(yearLabel(year))+'</span>';
}
function pickModels(kind,chosen){
 const list=pacModels(kind);
 return '<option value="">Choisir un modèle…</option>'+list.map(m=>
 '<option value="'+e(m.id)+'" '+(m.id===chosen?"selected":"")+'>'+e(modelName(m))+(role(m)==="legacy"?" (à classer)":"")+'</option>').join("");
}
function introData(){
 if(!draft)return;
 draft.split=get("pac-split-size")?.value||draft.split;
 draft.outdoor={modelId:get("pac-outdoor-model")?.value||"",serial:get("pac-outdoor-serial")?.value.trim()||"",year:get("pac-outdoor-year")?.value.trim()||""};
}
function indoorData(){
 if(!draft)return;
 const arr=[];
 const count=SIZES[draft.split]||1;
 for(let i=0;i<count;i++)arr.push({modelId:get("pac-indoor-model-"+i)?.value||"",serial:get("pac-indoor-serial-"+i)?.value.trim()||"",year:get("pac-indoor-year-"+i)?.value.trim()||""});
 draft.indoors=arr;
}
function wizardMarkup(){
 const n=SIZES[draft.split]||1;
 const step=draft.step;
 const title=draft.id?"Modifier une installation PAC":"Ajouter une installation PAC air/air";
 let inner='<div class="row" style="justify-content:space-between;gap:8px"><h2>'+title+'</h2><button type="button" class="secondary" data-pac-action="close" aria-label="Fermer">✕</button></div>'+
 '<p class="muted small">Étape '+step+'/2 : '+(step===1?"configuration et groupe extérieur":"unités intérieures associées")+'</p>';
 if(step===1){
   inner+='<div class="pac-wizard-fields">'+
   '<div><label for="pac-split-size">Configuration *</label><select id="pac-split-size" class="model-search">'+
   Object.keys(SIZES).map(v=>'<option value="'+v+'" '+(draft.split===v?"selected":"")+'>'+LABELS[v]+' ('+SIZES[v]+' unité'+(SIZES[v]===1?"":"s")+' intérieure'+(SIZES[v]===1?"":"s")+')</option>').join("")+'</select></div>'+
   '<h3>Groupe extérieur</h3>'+
   '<div><label for="pac-outdoor-model">Modèle du groupe extérieur *</label><select id="pac-outdoor-model" class="model-search">'+pickModels("outdoor",draft.outdoor.modelId)+'</select></div>'+
   '<div><label for="pac-outdoor-serial">Numéro de série du groupe extérieur</label><input id="pac-outdoor-serial" maxlength="180" value="'+e(draft.outdoor.serial)+'" placeholder="Numéro de série extérieur"></div>'+
   '<div><label for="pac-outdoor-year">Année du groupe extérieur</label><input id="pac-outdoor-year" type="text" inputmode="numeric" maxlength="4" value="'+e(draft.outdoor.year||"")+'" placeholder="Ex. 2020"></div>'+
   '</div><div class="form-actions"><button type="button" class="primary" data-pac-action="next">Suivant : unités intérieures →</button><button type="button" class="secondary" data-pac-action="close">Annuler</button></div>';
 } else {
   inner+='<p>'+LABELS[draft.split]+' — <strong>'+n+' unité'+(n===1?"":"s")+' intérieure'+(n===1?"":"s")+' à renseigner.</strong> Un même modèle peut être choisi plusieurs fois.</p>';
   inner+='<div class="pac-unit-fields">'+Array.from({length:n},(_,i)=>{
     const u=draft.indoors[i]||{modelId:"",serial:""};
     return '<fieldset class="pac-indoor-row"><legend>Unité intérieure '+(i+1)+' / '+n+'</legend>'+
     '<label for="pac-indoor-model-'+i+'">Modèle *</label><select id="pac-indoor-model-'+i+'" class="model-search">'+pickModels("indoor",u.modelId)+'</select>'+
     '<label for="pac-indoor-serial-'+i+'">Numéro de série</label><input id="pac-indoor-serial-'+i+'" maxlength="180" value="'+e(u.serial)+'" placeholder="Numéro de série unité '+(i+1)+'">'+
     '<label for="pac-indoor-year-'+i+'">Année</label><input id="pac-indoor-year-'+i+'" type="text" inputmode="numeric" maxlength="4" value="'+e(u.year||"")+'" placeholder="Ex. 2020"></fieldset>';
   }).join("")+'</div>'+
   '<div class="form-actions"><button type="button" class="secondary" data-pac-action="back">← Retour</button>'+
   '<button type="button" class="primary" data-pac-action="save">💾 Enregistrer l’installation</button></div>';
 }
 return inner;
}
function renderWizard(){
 const modal=get("pac-install-modal");if(!modal||!draft)return;
 modal.querySelector(".modal").innerHTML=wizardMarkup();
 modal.querySelector("input,select")?.focus();
}
function closeWizard(){get("pac-install-modal")?.remove();draft=null}
function newWizard(editId){
 if(!current)return;
 const outdoor=pacModels("outdoor"),indoor=pacModels("indoor");
 if(!outdoor.length||!indoor.length){
   alert("Crée d’abord au moins un modèle dans chacun des onglets PAC : « Groupe extérieur » et « Unité intérieure ».");return;
 }
 const existing=editId?installations(current.id).find(x=>x.id===editId):null;
 if(editId&&!existing)return;
 draft={
  id:existing?.id||null,clientId:current.id,step:1,split:existing?.split in SIZES?existing.split:"mono",
  outdoor:{modelId:existing?.outdoor?.modelId||"",serial:existing?.outdoor?.serial||"",year:existing?.outdoor?.year||""},
  indoors:Array.isArray(existing?.indoors)?existing.indoors.map(u=>({modelId:u.modelId||"",serial:u.serial||"",year:u.year||""})):[]
 };
 closeAssignModal();
 const backdrop=document.createElement("div");backdrop.id="pac-install-modal";backdrop.className="modal-backdrop";
 backdrop.innerHTML='<div class="modal pac-install-dialog" role="dialog" aria-modal="true"></div>';
 document.body.appendChild(backdrop);
 backdrop.addEventListener("click",ev=>{
   if(ev.target===backdrop){closeWizard();return}
   const btn=ev.target.closest("[data-pac-action]");if(!btn)return;
   const action=btn.dataset.pacAction;
   if(action==="close"){closeWizard();return}
   if(action==="next"){
     introData();
     if(!draft.outdoor.modelId){alert("Sélectionne le modèle du groupe extérieur.");return}
     if(!validYear(draft.outdoor.year)){alert("L'année du groupe extérieur doit comporter 4 chiffres.");return}
     draft.step=2;renderWizard();return;
   }
   if(action==="back"){indoorData();draft.step=1;renderWizard();return}
   if(action==="save"){
     indoorData();
     if(!draft.indoors.every(x=>x.modelId)){alert("Sélectionne le modèle de chaque unité intérieure.");return}
     if(!draft.indoors.every(x=>validYear(x.year))){alert("Les années des unités intérieures doivent comporter 4 chiffres.");return}
     const saved={
      id:draft.id||makeId(),split:draft.split,outdoor:{...draft.outdoor},
      indoors:draft.indoors.map(u=>({...u})),updatedAt:new Date().toISOString()
     };
     // Toutes les occurrences gardent leur propre modèle ET leur propre numéro de série.
     const cid=draft.clientId,groupList=installations(cid).slice();
     const at=groupList.findIndex(g=>g.id===saved.id);
     if(at>=0)groupList[at]=saved;else groupList.push(saved);
     if(saveGroups(cid,groupList)){closeWizard();if(current?.id===cid)renderClientEquipments()}
   }
 });
 renderWizard();
}
window.assignEquipment=function(type){
 if(type==="pac_air_air")return newWizard(null);
 return orig.assignEquipment(type);
};
window.pacEditInstallation=newWizard;
window.pacRemoveInstallation=function(id){
 if(!current)return;
 const groups=installations(current.id),record=groups.find(g=>g.id===id);
 if(!record)return;
 if(!confirm("Retirer cette installation "+(LABELS[record.split]||"PAC")+" et tous ses numéros de série de la fiche client ?"))return;
 if(saveGroups(current.id,groups.filter(g=>g.id!==id)))renderClientEquipments();
};
/* Présentation compacte : l'équipement s'ouvre localement au clic sur marque/modèle.
   Cela ne déclenche pas l'ouverture de la fiche technique et conserve les modifications. */
function compactTitle(kind,name,extra){
 return '<summary class="pac-compact-summary">'+
   '<span class="pac-compact-identity"><span class="pac-compact-type">'+e(kind)+'</span>'+
   '<span class="pac-compact-name">'+e(name)+'</span>'+
   (extra?'<span class="pac-compact-extra">'+e(extra)+'</span>':'')+
   '</span><span class="pac-compact-chevron" aria-hidden="true">⌄</span></summary>';
}
function clientModelCard(m,expanded){
 const key="model:"+m.id,cid=current.id;
 const serial=getEquipmentSerial(cid,m.id),year=getEquipmentYear(cid,m.id);
 const details='<div class="pac-compact-details">'+
  '<div class="pac-compact-info">📚 '+e(modelDocs(m).length)+' documentation(s) disponibles</div>'+
  '<div class="pac-meta-overview">'+dataSummary(serial,year)+'</div>'+
  (m.type==="chaudiere"&&getModelBoilerType(m)?'<div class="pac-compact-info">Type : '+e(getModelBoilerTypeLabel(m))+'</div>':"")+
  '<div class="pac-compact-actions">'+
  '<button type="button" class="secondary small" data-equipment-edit-info="'+e(m.id)+'">✏️ '+(serial||year?"Modifier":"Ajouter")+' n° de série et année</button>'+
  '<button type="button" class="secondary small" data-equipment-open-model="'+e(m.id)+'">Voir la fiche du modèle ›</button>'+
  '<button type="button" class="secondary small" data-equipment-remove="'+e(m.id)+'">Retirer du client</button></div></div>';
 return '<details class="card pac-compact-card" data-equipment-card="'+e(key)+'" '+(expanded.has(key)?"open":"")+'>'+
  compactTitle(eqTypeShort(m.type),modelName(m),"")+
  details+'</details>';
}
function groupedCard(g,expanded){
 const key="group:"+g.id,outer=modelById(g.outdoor?.modelId);
 const inner=Array.isArray(g.indoors)?g.indoors:[];
 const count=SIZES[g.split]||inner.length;
 const title=outer?modelName(outer):"Groupe extérieur — modèle introuvable";
 let details='<div class="pac-compact-details">'+
  '<div class="pac-compact-info"><strong>Groupe extérieur</strong></div>'+
  '<div class="pac-unit-entry">'+
  (outer?'<button type="button" class="pac-model-link" data-pac-model="'+e(outer.id)+'">'+e(modelName(outer))+' ›</button>':'<strong>Modèle introuvable</strong>')+
  '<div class="pac-meta-overview">'+dataSummary(g.outdoor?.serial,g.outdoor?.year)+'</div>'+
  '<button type="button" class="secondary small pac-meta-unit-button" data-pac-edit-unit="'+e(g.id)+'" data-pac-unit-index="outdoor">✏️ '+(g.outdoor?.serial||g.outdoor?.year?"Modifier":"Ajouter")+' n° de série et année</button>'+
  '</div><h4 class="pac-compact-inner-heading">Unités intérieures ('+inner.length+'/'+count+')</h4>';
 details+=inner.map((u,i)=>{
  const m=modelById(u.modelId);
  return '<div class="pac-unit-entry"><div class="muted small">Unité intérieure '+(i+1)+'</div>'+
   (m?'<button type="button" class="pac-model-link" data-pac-model="'+e(m.id)+'">'+e(modelName(m))+' ›</button>':'<strong>Modèle introuvable</strong>')+
   '<div class="pac-meta-overview">'+dataSummary(u.serial,u.year)+'</div>'+
   '<button type="button" class="secondary small pac-meta-unit-button" data-pac-edit-unit="'+e(g.id)+'" data-pac-unit-index="'+i+'">✏️ '+(u.serial||u.year?"Modifier":"Ajouter")+' n° de série et année</button></div>';
 }).join("");
 details+='<div class="pac-compact-actions">'+
  '<button type="button" class="secondary small" data-pac-edit="'+e(g.id)+'">Modifier l’installation</button>'+
  '<button type="button" class="secondary small" data-pac-remove="'+e(g.id)+'">Retirer du client</button></div></div>';
 return '<details class="card pac-compact-card" data-equipment-card="'+e(key)+'" '+(expanded.has(key)?"open":"")+'>'+
  compactTitle("PAC air/air",title,(LABELS[g.split]||"Multisplit")+" · "+inner.length+" unité(s) intérieure(s)")+
  details+'</details>';
}

/* Les valeurs affichées sur la fiche sont en lecture seule. L'édition passe
   par une fenêtre dédiée, sans sauvegarde ni synchronisation avant Enregistrer. */
function openMetaEditor(modelId,groupId,index){
 if(!current)return;
 if(get("pac-meta-editor"))return;
 const cid=current.id,groupMode=Boolean(groupId);
 let label="",beforeSerial="",beforeYear="",beforeGroup=null,targetModelId=modelId;
 if(groupMode){
  const group=installations(cid).find(x=>x.id===groupId);
  if(!group)return;
  const u=index==="outdoor"?group.outdoor:group.indoors?.[Number(index)];
  if(!u)return;
  const m=modelById(u.modelId);
  beforeGroup=JSON.stringify(group);
  beforeSerial=u.serial||"";beforeYear=u.year||"";
  label=(index==="outdoor"?"Groupe extérieur":"Unité intérieure "+(Number(index)+1))+
   " — "+(m?modelName(m):"Modèle introuvable");
  targetModelId=u.modelId;
 }else{
  const exists=Array.isArray(equipmentAssignments[cid])&&equipmentAssignments[cid].includes(modelId);
  const m=modelById(modelId);
  if(!exists||!m)return;
  beforeSerial=getEquipmentSerial(cid,modelId);
  beforeYear=getEquipmentYear(cid,modelId);
  label=eqTypeShort(m.type)+" — "+modelName(m);
 }
 const backdrop=document.createElement("div");
 backdrop.id="pac-meta-editor";backdrop.className="modal-backdrop";
 backdrop.innerHTML='<div class="modal pac-meta-dialog" role="dialog" aria-modal="true" aria-labelledby="pac-meta-title">'+
 '<div class="row" style="justify-content:space-between;gap:8px"><h2 id="pac-meta-title">Numéro de série et année</h2>'+
 '<button type="button" class="secondary" data-meta-close aria-label="Fermer">✕</button></div>'+
 '<p class="pac-meta-device-title">'+e(label)+'</p>'+
 '<label for="pac-meta-serial">Numéro de série</label>'+
 '<input id="pac-meta-serial" type="text" maxlength="200" autocomplete="off" value="'+e(beforeSerial)+'" placeholder="Numéro de série">'+
 '<label for="pac-meta-year">Année de l’équipement</label>'+
 '<input id="pac-meta-year" type="text" maxlength="4" inputmode="numeric" pattern="[0-9]{4}" autocomplete="off" value="'+e(beforeYear)+'" placeholder="Ex. 2020">'+
 '<p class="muted small">Aucune modification n’est enregistrée ou synchronisée pendant la saisie. Seul le bouton Enregistrer valide les deux champs.</p>'+
 '<div class="pac-meta-feedback" role="alert" aria-live="polite"></div>'+
 '<div class="form-actions"><button type="button" class="primary" data-meta-save>💾 Enregistrer</button>'+
 '<button type="button" class="secondary" data-meta-close>Annuler</button></div>'+
 '</div>';
 document.body.appendChild(backdrop);
 const warn=text=>{const f=backdrop.querySelector(".pac-meta-feedback");if(f)f.textContent=text};
 const close=()=>backdrop.remove();
 backdrop.addEventListener("click",ev=>{
  if(ev.target===backdrop||ev.target.closest("[data-meta-close]")){close();return}
  const btn=ev.target.closest("[data-meta-save]");
  if(!btn)return;
  const serial=get("pac-meta-serial")?.value.trim()||"",year=get("pac-meta-year")?.value.trim()||"";
  if(!validYear(year)){warn("Indique une année à 4 chiffres (ex. 2020), ou laisse le champ vide.");return}
  if(!current||current.id!==cid){warn("Tu as changé de fiche client : aucune donnée enregistrée.");return}
  const unchanged=serial===beforeSerial&&year===beforeYear;
  if(unchanged){close();return}
  btn.disabled=true;
  try{
   let saved=false;
   if(groupMode){
    const groups=installations(cid),at=groups.findIndex(g=>g.id===groupId);
    if(at<0||JSON.stringify(groups[at])!==beforeGroup){warn("Cette installation a changé depuis l’ouverture : aucune donnée écrasée.");return}
    const copy=JSON.parse(beforeGroup);
    const unit=index==="outdoor"?copy.outdoor:copy.indoors?.[Number(index)];
    if(!unit||unit.modelId!==targetModelId){warn("L'équipement a changé. Rouvre la fenêtre.");return}
    unit.serial=serial;unit.year=year;
    groups[at]=copy;
    saved=saveGroups(cid,groups);
   }else{
    const assigned=Array.isArray(equipmentAssignments[cid])&&equipmentAssignments[cid].includes(modelId);
    if(!assigned||getEquipmentSerial(cid,modelId)!==beforeSerial||getEquipmentYear(cid,modelId)!==beforeYear){
     warn("Les informations de cet équipement ont changé. Rouvre la fenêtre pour éviter un écrasement.");return;
    }
    const previous=equipmentSerialNumbers[cid],next=previous&&typeof previous==="object"&&!Array.isArray(previous)?{...previous}:{};
    if(serial)next[modelId]=serial;else delete next[modelId];
    if(year)next["__year__"+modelId]=year;else delete next["__year__"+modelId];
    if(Object.keys(next).length)equipmentSerialNumbers[cid]=next;else delete equipmentSerialNumbers[cid];
    saved=saveEquipmentSerialNumbers();
    if(!saved){
      if(previous)equipmentSerialNumbers[cid]=previous;else delete equipmentSerialNumbers[cid];
    }
   }
   if(saved){
    close();
    if(current?.id===cid)renderClientEquipments();
   }else warn("Enregistrement impossible. Les anciennes informations sont conservées.");
  }catch(error){
   warn("Enregistrement impossible. Les anciennes informations sont conservées.");
  }finally{btn.disabled=false}
 });
 backdrop.querySelector("#pac-meta-serial")?.focus();
}
window.renderClientEquipments=function(){
 const box=get("clientEquipmentList");if(!box||!current)return;
 // Restaurer les éléments déjà dépliés après une synchronisation ou la modification d'un champ.
 const sameClient=box.dataset.equipmentClientId===String(current.id);
 const expanded=new Set(sameClient?Array.from(box.querySelectorAll("details.pac-compact-card[open]"))
   .map(x=>x.dataset.equipmentCard).filter(Boolean):[]);
 const ids=Array.isArray(equipmentAssignments[current.id])?equipmentAssignments[current.id]:[];
 const models=ids.map(id=>modelById(id)).filter(Boolean);
 const groups=installations(current.id);
 const cards=models.map(m=>clientModelCard(m,expanded)).concat(groups.map(g=>groupedCard(g,expanded)));
 box.innerHTML=cards.length?'<div class="pac-compact-list">'+cards.join("")+'</div>':
  '<div class="equipment-empty">Aucun équipement attribué à ce client.</div>';
 box.dataset.equipmentClientId=String(current.id);
 if(!box.dataset.pacAccordionBound){
   box.dataset.pacAccordionBound="1";
   box.addEventListener("click",ev=>{
     const btn=ev.target.closest("button[data-pac-edit],button[data-pac-remove],button[data-pac-model],button[data-equipment-open-model],button[data-equipment-remove],button[data-equipment-edit-info],button[data-pac-edit-unit]");
     if(!btn||!box.contains(btn))return;
     ev.stopPropagation();
     if(btn.dataset.equipmentEditInfo)return openMetaEditor(btn.dataset.equipmentEditInfo,null,null);
     if(btn.dataset.pacEditUnit)return openMetaEditor(null,btn.dataset.pacEditUnit,btn.dataset.pacUnitIndex);
     if(btn.dataset.pacEdit)return newWizard(btn.dataset.pacEdit);
     if(btn.dataset.pacRemove)return window.pacRemoveInstallation(btn.dataset.pacRemove);
     if(btn.dataset.pacModel)return openEquipment(btn.dataset.pacModel);
     if(btn.dataset.equipmentOpenModel)return openEquipment(btn.dataset.equipmentOpenModel);
     if(btn.dataset.equipmentRemove)return removeEquipmentFromClient(btn.dataset.equipmentRemove);
   });
 }
};
const css=document.createElement("style");css.id="pac-split-styles";
css.textContent=
'.pac-tabs{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:10px 0}'+
'.pac-tabs button{padding:12px 8px;border:1px solid #326493;border-radius:10px;background:#092643;color:#e5f2ff;font-weight:600;cursor:pointer}'+
'.pac-tabs button.pac-active{background:#15518b;border:2px solid #80b8fc;color:#fff}'+
'.pac-install-dialog{max-width:680px;max-height:90dvh;overflow-y:auto}'+
'.pac-wizard-fields,.pac-unit-fields{display:grid;gap:12px;margin:14px 0}'+
'.pac-wizard-fields label,.pac-indoor-row label{display:block;margin:5px 0 6px;font-size:.9rem}'+
'.pac-wizard-fields input,.pac-wizard-fields select,.pac-indoor-row input,.pac-indoor-row select{width:100%;max-width:100%;box-sizing:border-box}'+
'.pac-indoor-row{min-width:0;padding:12px;border:1px solid #31577b;border-radius:10px}'+
'.pac-indoor-row legend{padding:0 5px;font-weight:700}'+
'.pac-install-card{grid-column:1/-1;min-width:0}'+
'.pac-unit-entry{padding:10px 12px;margin-top:7px;border:1px solid #294e72;border-radius:9px;overflow-wrap:anywhere}'+
'.pac-model-link{padding:3px 0;text-align:left;color:#8fc9ff;background:transparent;border:0;text-decoration:underline;font:inherit;cursor:pointer}'+
'.pac-compact-list{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}'+
'.pac-compact-card{padding:0!important;margin:0;min-width:0;overflow:hidden}'+
'.pac-compact-summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 13px;cursor:pointer;min-height:46px}'+
'.pac-compact-summary::-webkit-details-marker{display:none}'+
'.pac-compact-identity{display:flex;flex-direction:column;gap:3px;min-width:0;overflow-wrap:anywhere}'+
'.pac-compact-type{font-size:.73rem;color:#9ec9ee;font-weight:600}'+
'.pac-compact-name{font-size:1rem;font-weight:700;color:#edf6ff;line-height:1.3}'+
'.pac-compact-extra{font-size:.78rem;color:#b3c9dc}'+
'.pac-compact-chevron{font-size:1.15rem;color:#a9d8ff;flex-shrink:0;transition:transform .15s ease}'+
'.pac-compact-card[open] .pac-compact-chevron{transform:rotate(180deg)}'+
'.pac-compact-summary:focus-visible{outline:2px solid #75baff;outline-offset:-2px}'+
'.pac-compact-details{border-top:1px solid #2a4e75;padding:12px 13px 14px}'+
'.pac-compact-info{font-size:.86rem;color:#b8cde0;margin-bottom:9px}'+
'.pac-compact-field{margin:8px 0}'+
'.pac-compact-field label{display:block;font-size:.85rem;color:#c5d9ed}'+
'.pac-compact-field input{display:block;box-sizing:border-box;width:100%;max-width:420px;margin-top:5px}'+
'.pac-compact-field input.pac-year-input{max-width:130px}'+
'.pac-compact-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:13px}'+
'.pac-compact-inner-heading{font-size:.95rem;margin:12px 0 7px}'+
'.pac-meta-overview{display:grid;gap:5px;margin:10px 0}.pac-meta-overview .pac-compact-info{display:block;margin:0;overflow-wrap:anywhere}'+
'.pac-meta-unit-button{margin-top:5px}.pac-meta-dialog{max-width:520px;max-height:90dvh;overflow-y:auto}'+
'.pac-meta-dialog label{display:block;margin:11px 0 6px;font-size:.9rem;font-weight:650}'+
'.pac-meta-dialog input{display:block;width:100%;max-width:100%;box-sizing:border-box}'+
'.pac-meta-device-title{color:#a9d9ff;overflow-wrap:anywhere}'+
'.pac-meta-feedback{font-size:.9rem;color:#ffbd94;margin:9px 0}';
document.head.appendChild(css);
})();
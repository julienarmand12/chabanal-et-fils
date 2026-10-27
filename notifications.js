/* Chabanal et fils v1.1 — commandes et centre de notifications à trois étapes. */
(function(){
"use strict";
const KEY="metier_notifications_pieces_v1";
const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const normalize=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr").trim();
const getAll=()=>{
  try{
    const value=JSON.parse(localStorage.getItem(KEY)||"{}");
    return value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  }catch(e){return {};}
};
const saveAll=data=>{
  try{localStorage.setItem(KEY,JSON.stringify(data));return true;}
  catch(e){alert("Enregistrement des notifications impossible : espace de stockage insuffisant.");return false;}
};
const normalizedStatus=n=>n.status==="sav_done"?"sav_done":n.status==="treated"?"treated":"pending";
const openOrders=clientId=>Object.values(getAll()).filter(n=>n&&!n.deleted&&String(n.clientId)===String(clientId)&&normalizedStatus(n)!=="sav_done");
let tab="pending";
const tabSearch={pending:"",treated:"",sav_done:""};
let clientFilter=null;
let focusNotification=null;
let focusClient=null;
function notificationTotals(){
  // Inclure les commandes en attente et commandees, jamais les SAV termines ni supprimes.
  let toOrder=0,ordered=0;
  for(const n of availableNotifications()){
    const status=normalizedStatus(n);
    if(status==="pending")toOrder++;
    else if(status==="treated")ordered++;
  }
  return {toOrder,ordered,total:toOrder+ordered};
}
function updateCount(){
  const {toOrder,ordered,total}=notificationTotals();
  const badge=document.getElementById("notificationCount");
  const button=document.getElementById("notificationsButton");
  const state=toOrder>0?"has-pending":ordered>0?"has-ordered":"empty";
  const palette={
    "has-pending":{background:"#991b1b",border:"#f87171",badge:"#b91c1c"},
    "has-ordered":{background:"#a65309",border:"#fbbf24",badge:"#c16a10"},
    "empty":{background:"#166534",border:"#4ade80",badge:"#15803d"}
  }[state];
  const msg=toOrder>0?
    total+" notification"+(total===1?"":"s")+" : "+toOrder+" à commander et "+ordered+" commandée"+(ordered===1?"":"s"):
    ordered>0?ordered+" notification"+(ordered===1?"":"s")+" commandée"+(ordered===1?"":"s"):
    "Aucune notification à commander ou commandée";
  if(badge){
    badge.textContent=String(total);
    badge.style.setProperty("background-color",palette.badge,"important");
    badge.style.setProperty("color","#ffffff","important");
    badge.setAttribute("data-pending-state",state);
  }
  if(button){
    button.setAttribute("data-pending-state",state);
    button.style.setProperty("background-color",palette.background,"important");
    button.style.setProperty("border-color",palette.border,"important");
    button.style.setProperty("color","#ffffff","important");
    button.setAttribute("aria-label",msg+". Ouvrir les notifications");
    button.title=msg+". Ouvrir les notifications";
  }
}
function updateClientBadge(){
  const slot=document.getElementById("clientOrderAlertSlot");
  if(!slot)return;
  const id=slot.dataset.clientId;
  const count=openOrders(id).length;
  const badge=slot.querySelector("#clientOrderBadge");
  if(!count){if(badge)badge.remove();return;}
  if(!badge){slot.innerHTML=window.clientOrderBadgeHTML(id);return;}
  const amount=badge.querySelector("[data-count]");
  if(amount)amount.textContent=String(count);
}
window.clientOrderBadgeHTML=function(clientId){
  const count=openOrders(clientId).length;
  if(!count)return "";
  return '<div class="client-order-alert"><button type="button" id="clientOrderBadge" data-client-id="'+safe(clientId)+'" class="client-order-button" onclick="openClientOrders(this.dataset.clientId)">'+
    '🔔 Commande en cours <span data-count class="notifications-count">'+count+'</span></button></div>';
};
function availableNotifications(){
  return Object.values(getAll()).filter(n=>n&&n.id&&!n.deleted).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
}
function filterForTab(){
  const search=normalize(tabSearch[tab]);
  return availableNotifications().filter(n=>{
    if(normalizedStatus(n)!==tab)return false;
    if(clientFilter!==null&&String(n.clientId)!==String(clientFilter))return false;
    if(!search)return true;
    return normalize([n.clientName,n.description,n.interventionDate,n.id].join(" ")).includes(search);
  });
}
function renderList(){
  const pane=document.getElementById("notificationsList");
  if(!pane)return;
  const list=filterForTab();
  if(!list.length){
    pane.innerHTML='<p class="muted" style="padding:14px 0">'+(tabSearch[tab]?"Aucune notification pour cette recherche.":tab==="pending"?"Aucune demande à commander.":tab==="treated"?"Aucune commande en attente de SAV.":"Aucun SAV terminé.")+'</p>';
    return;
  }
  pane.innerHTML=list.map(n=>{
    const date=n.interventionDate||"",created=n.createdAt?new Date(n.createdAt).toLocaleString("fr-FR"):"";
    let action='';
    if(tab==="pending")action='<button type="button" class="primary small" data-next-status="treated" data-notification-id="'+safe(n.id)+'">✓ Commandé</button>';
    else if(tab==="treated")action='<button type="button" class="primary small" data-next-status="sav_done" data-notification-id="'+safe(n.id)+'">✓ SAV ok</button>';
    else action='<span class="badge">✓ SAV terminé</span>';
    const dateInfo=tab==="sav_done"&&n.savCompletedAt?"SAV terminé le "+new Date(n.savCompletedAt).toLocaleString("fr-FR"):
      tab==="treated"&&n.treatedAt?"Commandée le "+new Date(n.treatedAt).toLocaleString("fr-FR"):"Créée le "+created;
    return '<article class="piece-notification" id="piece-row-'+safe(n.id)+'" data-order-id="'+safe(n.id)+'">'+
      '<div class="row" style="justify-content:space-between;align-items:flex-start"><strong>'+safe(n.clientName||"Client")+'</strong>'+
      '<div class="piece-notification-actions">'+action+
      '<button type="button" class="piece-notification-delete" data-delete-notification-id="'+safe(n.id)+'" aria-label="Supprimer la notification de '+safe(n.clientName||"Client")+'">🗑 Supprimer</button></div></div>'+
      '<div class="muted small">Commande de pièce'+(date?' · Intervention du '+safe(date):"")+'</div>'+
      '<div class="piece-notification-description">'+safe(n.description||"").replace(/\n/g,"<br>")+'</div>'+
      '<div class="muted small">'+safe(dateInfo)+'</div></article>';
  }).join("");
  if(focusNotification){
    const id=focusNotification;focusNotification=null;
    const item=Array.from(pane.querySelectorAll("[data-order-id]")).find(el=>el.dataset.orderId===id);
    if(item){item.classList.add("piece-notification-highlight");item.scrollIntoView({block:"nearest",behavior:"smooth"});}
  }
}
function renderNavigation(){
  const box=document.getElementById("notificationsModal");
  if(!box)return;
  const list=availableNotifications();
  for(const status of ["pending","treated","sav_done"]){
    const el=document.getElementById("notificationTab_"+status);
    if(!el)continue;
    const count=list.filter(n=>normalizedStatus(n)===status&&(clientFilter===null||String(n.clientId)===String(clientFilter))).length;
    const label=status==="pending"?"À commander":status==="treated"?"Commandé":"SAV terminé";
    el.textContent=label+" ("+count+")";
    el.classList.toggle("active",tab===status);
    el.setAttribute("aria-selected",String(tab===status));
  }
  const search=document.getElementById("notificationsSearch");
  if(search&&document.activeElement!==search)search.value=tabSearch[tab];
  if(search)search.placeholder="Rechercher un client ou une référence…";
  const filterBox=document.getElementById("notificationsClientFilter");
  if(filterBox){
    const related=clientFilter===null?null:list.find(n=>String(n.clientId)===String(clientFilter));
    filterBox.hidden=clientFilter===null;
    if(related)filterBox.querySelector("[data-client-name]").textContent=related.clientName||"Client";
    else if(clientFilter!==null)filterBox.querySelector("[data-client-name]").textContent="Client sélectionné";
  }
}
function renderAll(){renderNavigation();renderList();}
window.refreshNotificationsCenter=function(){updateCount();updateClientBadge();renderAll();};
window.openNotificationsCenter=function(options={}){
  if(typeof options!=="object"||!options)options={};
  if(document.getElementById("notificationsModal")){renderAll();return;}
  clientFilter=options.clientId==null?null:String(options.clientId);
  focusClient=clientFilter;
  focusNotification=options.notificationId||null;
  tab=options.tab&&["pending","treated","sav_done"].includes(options.tab)?options.tab:"pending";
  const overlay=document.createElement("div");
  overlay.id="notificationsModal";
  overlay.className="piece-modal-overlay";
  overlay.innerHTML='<div class="piece-modal panel" role="dialog" aria-modal="true" aria-labelledby="notificationsTitle">'+
    '<div class="row" style="justify-content:space-between"><h2 id="notificationsTitle" style="margin:0">🔔 Centre des notifications</h2>'+
    '<button class="secondary small" type="button" onclick="closeNotificationsCenter()" aria-label="Fermer">✕</button></div>'+
    '<div class="piece-notification-tabs" role="tablist" aria-label="Statut des notifications">'+
    '<button type="button" class="piece-tab" role="tab" id="notificationTab_pending" onclick="setNotificationsTab(\'pending\')"></button>'+
    '<button type="button" class="piece-tab" role="tab" id="notificationTab_treated" onclick="setNotificationsTab(\'treated\')"></button>'+
    '<button type="button" class="piece-tab" role="tab" id="notificationTab_sav_done" onclick="setNotificationsTab(\'sav_done\')"></button></div>'+
    '<div id="notificationsClientFilter" class="piece-filter-active" hidden>Commandes : <strong data-client-name></strong>'+
    '<button class="secondary small" type="button" id="clearClientNotificationFilter">Afficher tout</button></div>'+
    '<label for="notificationsSearch">Rechercher dans cet onglet</label>'+
    '<input id="notificationsSearch" class="piece-notification-search" type="search" autocomplete="off" placeholder="Rechercher un client ou une référence…" aria-label="Rechercher dans les notifications de cet onglet">'+
    '<div id="notificationsList" class="piece-notification-list"></div></div>';
  overlay.addEventListener("click",function(e){
    if(e.target===overlay){window.closeNotificationsCenter();return;}
    const action=e.target.closest("[data-next-status]");
    if(action){window.advancePieceNotification(action.dataset.notificationId,action.dataset.nextStatus);return;}
    const del=e.target.closest("[data-delete-notification-id]");
    if(del){window.deletePieceNotification(del.dataset.deleteNotificationId);return;}
    if(e.target.closest("#clearClientNotificationFilter")){clientFilter=null;focusClient=null;renderAll();}
  });
  document.body.appendChild(overlay);
  const input=overlay.querySelector("#notificationsSearch");
  input.addEventListener("input",()=>{tabSearch[tab]=input.value;renderList();});
  renderAll();
};
window.closeNotificationsCenter=function(){
  document.getElementById("notificationsModal")?.remove();
  clientFilter=null;focusClient=null;focusNotification=null;
  if(window.refreshMetierFromCloud)window.refreshMetierFromCloud();
};
window.setNotificationsTab=function(value){
  if(!["pending","treated","sav_done"].includes(value))return;
  tab=value;
  focusNotification=null;
  const search=document.getElementById("notificationsSearch");
  if(search)search.value=tabSearch[tab];
  renderAll();
};
window.openClientOrders=function(clientId){
  const orders=openOrders(clientId).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  if(!orders.length){window.refreshNotificationsCenter();return;}
  const pending=orders.find(n=>normalizedStatus(n)==="pending");
  const target=pending||orders[0];
  window.openNotificationsCenter({clientId,tab:normalizedStatus(target),notificationId:target.id});
};
window.advancePieceNotification=function(id,next){
  const data=getAll(),n=data[id];if(!n||n.deleted)return;
  const status=normalizedStatus(n);
  if(status==="pending"&&next==="treated"){
    data[id]={...n,status:"treated",treatedAt:n.treatedAt||new Date().toISOString()};
  }else if(status==="treated"&&next==="sav_done"){
    data[id]={...n,status:"sav_done",treatedAt:n.treatedAt||new Date().toISOString(),savCompletedAt:new Date().toISOString()};
  }else return;
  if(saveAll(data)){updateCount();updateClientBadge();renderAll();}
};
window.deletePieceNotification=function(id){
  const data=getAll(),n=data[id];
  if(!n||n.deleted)return false;
  const customer=n.clientName||"ce client";
  if(!window.confirm("Supprimer définitivement cette notification de « "+customer+" » ?\n\nCette action la retirera des trois onglets et sera synchronisée sur les autres appareils."))return false;
  // Un marqueur sans données client empêche le retour d'une copie ancienne au cloud.
  data[id]={id,deleted:true,deletedAt:new Date().toISOString()};
  if(!saveAll(data))return false;
  window.refreshNotificationsCenter();
  return true;
};
// Ancien nom conservé pour les appels éventuels de l'application.
window.markPieceNotification=function(id){window.advancePieceNotification(id,"treated");};
window.createPieceNotification=function({clientId,clientName,description,interventionDate}){
  const id="piece_"+Date.now()+"_"+Math.random().toString(36).slice(2,11);
  const data=getAll();
  data[id]={id,clientId:String(clientId),clientName:String(clientName||""),description:String(description||"").trim(),interventionDate:String(interventionDate||""),createdAt:new Date().toISOString(),status:"pending",treatedAt:null,savCompletedAt:null};
  if(!saveAll(data))return null;
  window.refreshNotificationsCenter();return id;
};

window.startInterventionWizard=function(client,onSave){
  if(!client||typeof onSave!=="function"||document.getElementById("interventionWizard"))return;
  const overlay=document.createElement("div");
  overlay.id="interventionWizard";
  overlay.className="piece-modal-overlay";
  overlay.innerHTML='<div class="piece-modal panel" role="dialog" aria-modal="true" aria-labelledby="interventionWizardTitle">'+
    '<div class="row" style="justify-content:space-between"><h2 id="interventionWizardTitle" style="margin:0">Nouvelle intervention</h2>'+
    '<button type="button" class="secondary small" id="wizardClose">✕</button></div>'+
    '<div id="wizardStage"></div></div>';
  document.body.appendChild(overlay);
  const stage=overlay.querySelector("#wizardStage");
  let iso="",wantOrder=false,orderId=null,orderDescription="",step="date";
  const close=()=>overlay.remove();
  const normalDate=d=>{const [y,m,day]=d.split("-");return day+"/"+m+"/"+y;};
  const t=new Date();const defaultDate=[t.getFullYear(),String(t.getMonth()+1).padStart(2,"0"),String(t.getDate()).padStart(2,"0")].join("-");
  function draw(){
    if(step==="date"){
      stage.innerHTML='<p class="muted">1. Date de l’intervention</p>'+
        '<label for="wizardDate">Date</label><input id="wizardDate" type="date" required value="'+safe(iso||defaultDate)+'">'+
        '<div class="form-actions"><button type="button" class="primary" id="wizardDateNext">Continuer →</button></div>';
      stage.querySelector("#wizardDateNext").onclick=()=>{
        const input=stage.querySelector("#wizardDate");
        if(!input.value||!input.checkValidity()){input.reportValidity();return;}
        iso=input.value;step="order";draw();
      };
    }else if(step==="order"){
      stage.innerHTML='<p class="muted">2. Commande de pièce</p><h3>Commande de pièce ?</h3>'+
        '<div class="form-actions"><button type="button" class="primary" id="wizardOrderYes">Oui</button>'+
        '<button type="button" class="secondary" id="wizardOrderNo">Non</button>'+
        '<button type="button" class="secondary" id="wizardOrderBack">← Date</button></div>';
      stage.querySelector("#wizardOrderYes").onclick=()=>{wantOrder=true;step="details";draw();};
      stage.querySelector("#wizardOrderNo").onclick=()=>{wantOrder=false;step="intervention";draw();};
      stage.querySelector("#wizardOrderBack").onclick=()=>{step="date";draw();};
    }else if(step==="details"){
      stage.innerHTML='<p class="muted">3. Pièce(s) à commander</p>'+
        '<label for="wizardClientReference">Référence client</label>'+
        '<input id="wizardClientReference" readonly value="'+safe(client.name||"")+'">'+
        '<label for="wizardOrderDescription">Description — références à commander</label>'+
        '<textarea id="wizardOrderDescription" rows="5" placeholder="Saisir la ou les références des pièces à commander" required></textarea>'+
        '<div class="form-actions"><button type="button" class="primary" id="wizardSendOrder">Valider et envoyer aux notifications →</button>'+
        '<button type="button" class="secondary" id="wizardDetailsBack">← Retour</button></div>';
      stage.querySelector("#wizardSendOrder").onclick=()=>{
        const input=stage.querySelector("#wizardOrderDescription");
        const description=input.value.trim();if(!description){input.setCustomValidity("Indiquez la pièce à commander.");input.reportValidity();input.setCustomValidity("");return;}
        orderId=window.createPieceNotification({clientId:client.id,clientName:client.name,description,interventionDate:normalDate(iso)});
        if(!orderId)return;
        orderDescription=description;
        step="intervention";draw();
      };
      stage.querySelector("#wizardDetailsBack").onclick=()=>{step="order";draw();};
    }else if(step==="intervention"){
      // Le texte validé pour les pièces sert de saisie initiale de l'intervention.
      const prefill=orderId?(orderDescription||getAll()[orderId]?.description||""):"";
      stage.innerHTML='<p class="muted">'+(wantOrder?"4.":"3.")+' Description de l’intervention</p>'+
        (orderId?'<p class="piece-saved-note">✓ Commande enregistrée dans les notifications.</p>':"")+
        '<label for="wizardInterventionDescription">Description de l’intervention</label>'+
        '<textarea id="wizardInterventionDescription" rows="5" placeholder="Décrire l’intervention réalisée">'+safe(prefill)+'</textarea>'+
        '<div class="form-actions"><button type="button" class="primary" id="wizardSaveIntervention">💾 Enregistrer l’intervention</button>'+
        (!orderId?'<button type="button" class="secondary" id="wizardInterventionBack">← Retour</button>':"")+'</div>';
      // Le texte de commande validé est recopié dans la description, éditable par le technicien.
      if(orderId)stage.querySelector("#wizardInterventionDescription").value=prefill;
      stage.querySelector("#wizardSaveIntervention").onclick=()=>{
        const description=stage.querySelector("#wizardInterventionDescription").value;
        const success=onSave({date:normalDate(iso),iso,description});
        if(success!==false)close();
      };
      const back=stage.querySelector("#wizardInterventionBack");
      if(back)back.onclick=()=>{step="order";draw();};
    }
  }
  overlay.querySelector("#wizardClose").onclick=close;
  overlay.addEventListener("click",e=>{if(e.target===overlay)close();});
  step="date";draw();
};
window.addEventListener("storage",e=>{if(e.key===KEY)window.refreshNotificationsCenter();});
updateCount();
})();
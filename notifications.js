/* Chabanal v1.1 — commandes de pièces et centre de notifications. */
(function(){
"use strict";
const KEY="metier_notifications_pieces_v1";
const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const getAll=()=>{
  try{
    const v=JSON.parse(localStorage.getItem(KEY)||"{}");
    return v&&typeof v==="object"&&!Array.isArray(v)?v:{};
  }catch(e){return {};}
};
const saveAll=data=>{
  try{localStorage.setItem(KEY,JSON.stringify(data));return true;}
  catch(e){alert("Enregistrement des notifications impossible : espace de stockage insuffisant.");return false;}
};
let tab="pending";
function countOpen(){
  return Object.values(getAll()).filter(n=>n&&n.status!=="treated").length;
}
function updateCount(){
  const count=countOpen(),badge=document.getElementById("notificationCount"),button=document.getElementById("notificationsButton");
  if(badge)badge.textContent=String(count);
  if(button){
    button.setAttribute("aria-label",count+" notification"+(count===1?"":"s")+" non traitée"+(count===1?"":"s")+". Ouvrir les notifications");
    button.title=count+" notification"+(count===1?"":"s")+" non traitée"+(count===1?"":"s");
  }
}
function notifList(){
  const pane=document.getElementById("notificationsList");
  if(!pane)return;
  const values=Object.values(getAll()).filter(Boolean).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  const list=values.filter(n=>(n.status==="treated"?"treated":"pending")===tab);
  const counts={pending:values.filter(n=>n.status!=="treated").length,treated:values.filter(n=>n.status==="treated").length};
  const t1=document.getElementById("notificationsPendingTab"),t2=document.getElementById("notificationsTreatedTab");
  if(t1){t1.classList.toggle("active",tab==="pending");t1.setAttribute("aria-selected",String(tab==="pending"));t1.textContent="Non traitées ("+counts.pending+")";}
  if(t2){t2.classList.toggle("active",tab==="treated");t2.setAttribute("aria-selected",String(tab==="treated"));t2.textContent="Traitées ("+counts.treated+")";}
  if(!list.length){pane.innerHTML='<p class="muted" style="padding:14px 0">Aucune notification '+(tab==="pending"?"non traitée.":"traitée.")+'</p>';return;}
  pane.innerHTML=list.map(n=>{
    const date=n.interventionDate||"",stamp=n.createdAt?new Date(n.createdAt).toLocaleString("fr-FR"):"";
    return '<article class="piece-notification">'+
    '<div class="row" style="justify-content:space-between;align-items:flex-start"><strong>'+safe(n.clientName||"Client")+'</strong>'+
    (tab==="pending"?'<button type="button" class="primary small" data-notification-id="'+safe(n.id)+'">✓ Traité</button>':'<span class="badge">✓ Traitée</span>')+'</div>'+
    '<div class="muted small">Commande de pièce'+(date?' · Intervention du '+safe(date):"")+'</div>'+
    '<div class="piece-notification-description">'+safe(n.description||"").replace(/\n/g,"<br>")+'</div>'+
    '<div class="muted small">'+(tab==="treated"&&n.treatedAt?'Traitée le '+safe(new Date(n.treatedAt).toLocaleString("fr-FR")):'Créée le '+safe(stamp))+'</div>'+
    '</article>';
  }).join("");
}
window.refreshNotificationsCenter=function(){updateCount();notifList();};
window.openNotificationsCenter=function(){
  if(document.getElementById("notificationsModal"))return;
  tab="pending";
  const overlay=document.createElement("div");
  overlay.id="notificationsModal";
  overlay.className="piece-modal-overlay";
  overlay.innerHTML='<div class="piece-modal panel" role="dialog" aria-modal="true" aria-labelledby="notificationsTitle">'+
    '<div class="row" style="justify-content:space-between"><h2 id="notificationsTitle" style="margin:0">🔔 Centre des notifications</h2>'+
    '<button class="secondary small" type="button" onclick="closeNotificationsCenter()">✕</button></div>'+
    '<div class="piece-notification-tabs" role="tablist" aria-label="Statut des notifications">'+
    '<button type="button" class="piece-tab" role="tab" id="notificationsPendingTab" onclick="setNotificationsTab(\'pending\')"></button>'+
    '<button type="button" class="piece-tab" role="tab" id="notificationsTreatedTab" onclick="setNotificationsTab(\'treated\')"></button></div>'+
    '<div id="notificationsList" class="piece-notification-list"></div></div>';
  overlay.addEventListener("click",function(e){
    if(e.target===overlay)window.closeNotificationsCenter();
    const button=e.target.closest("[data-notification-id]");
    if(button)window.markPieceNotification(button.dataset.notificationId);
  });
  document.body.appendChild(overlay);
  notifList();
};
window.closeNotificationsCenter=function(){
  document.getElementById("notificationsModal")?.remove();
  if(window.refreshMetierFromCloud)window.refreshMetierFromCloud();
};
window.setNotificationsTab=function(value){
  if(value!=="pending"&&value!=="treated")return;
  tab=value;notifList();
};
window.markPieceNotification=function(id){
  const data=getAll(),n=data[id];if(!n||n.status==="treated")return;
  data[id]={...n,status:"treated",treatedAt:new Date().toISOString()};
  if(saveAll(data)){updateCount();notifList();}
};
window.createPieceNotification=function({clientId,clientName,description,interventionDate}){
  const id="piece_"+Date.now()+"_"+Math.random().toString(36).slice(2,11);
  const data=getAll();
  data[id]={id,clientId:String(clientId),clientName:String(clientName||""),description:String(description||"").trim(),interventionDate:String(interventionDate||""),createdAt:new Date().toISOString(),status:"pending",treatedAt:null};
  if(!saveAll(data))return null;
  updateCount();notifList();return id;
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
  let iso="",wantOrder=false,orderId=null,step="date";
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
        step="intervention";draw();
      };
      stage.querySelector("#wizardDetailsBack").onclick=()=>{step="order";draw();};
    }else if(step==="intervention"){
      stage.innerHTML='<p class="muted">'+(wantOrder?"4.":"3.")+' Description de l’intervention</p>'+
        (orderId?'<p class="piece-saved-note">✓ Commande enregistrée dans les notifications.</p>':"")+
        '<label for="wizardInterventionDescription">Description de l’intervention</label>'+
        '<textarea id="wizardInterventionDescription" rows="5" placeholder="Décrire l’intervention réalisée"></textarea>'+
        '<div class="form-actions"><button type="button" class="primary" id="wizardSaveIntervention">💾 Enregistrer l’intervention</button>'+
        (!orderId?'<button type="button" class="secondary" id="wizardInterventionBack">← Retour</button>':"")+'</div>';
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
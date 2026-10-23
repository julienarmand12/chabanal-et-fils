/* Compteur personnel de recuperation - Chabanal et fils.
   Calcul continu de 5 % des 35 h hebdomadaires, depuis le 05/10/2026.
   Les entrees sont sauvegardees dans la cle prise en charge par le cloud existant. */
(function(){
"use strict";
const KEY="metier_heures_recuperation_v1";
const PIN="19910426";
const START_DATE="2026-10-05";
const START=Date.parse("2026-10-04T22:00:00Z"); // 05/10/2026 00:00 Europe/Paris
const WORK_HOURS_PER_WEEK=35;
const RECOVERY_PERCENT=5;
const WEEK_MS=7*24*60*60*1000;
const WEEK_MIN=WORK_HOURS_PER_WEEK*60*RECOVERY_PERCENT/100; // 105 min = 1 h 45
const DEFAULT_DAY_MIN=420;
const byId=id=>document.getElementById(id);
let unlocked=false;
const defaults=()=>({dayMinutes:DEFAULT_DAY_MIN,entries:[]});
function read(){
  try{
    const value=JSON.parse(localStorage.getItem(KEY)||"null");
    if(!value||typeof value!=="object"||Array.isArray(value))return defaults();
    return {
      dayMinutes:Number.isFinite(Number(value.dayMinutes))&&Number(value.dayMinutes)>=60&&Number(value.dayMinutes)<=720?Math.round(Number(value.dayMinutes)):DEFAULT_DAY_MIN,
      entries:Array.isArray(value.entries)?value.entries.filter(e=>e&&typeof e==="object"&&typeof e.id==="string"):[]
    };
  }catch(_){return defaults()}
}
function write(value){
  try{localStorage.setItem(KEY,JSON.stringify(value));return true}
  catch(e){alert("Impossible de sauvegarder le compteur sur cet appareil. Aucune modification effectuée.");return false}
}
const fmtNum=(n,decimals=2)=>Number(n).toLocaleString("fr-FR",{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
function fmtMinutes(m){
  const neg=m<0?"−":"",min=Math.abs(Math.round(m));
  return neg+Math.floor(min/60)+" h "+String(min%60).padStart(2,"0")+" min";
}
function accruedMinutes(now){
  return Math.max(0,Math.floor((Math.max(0,now-START)/WEEK_MS)*WEEK_MIN));
}
function parisToday(){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const pick=t=>parts.find(p=>p.type===t)?.value||"";
  return pick("year")+"-"+pick("month")+"-"+pick("day");
}
function frenchDate(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(iso||"")))return String(iso||"");
  return iso.slice(8,10)+"/"+iso.slice(5,7)+"/"+iso.slice(0,4);
}
function show(element){if(element)element.hidden=false}
function hide(element){if(element)element.hidden=true}
function releaseIfClosed(){
  if(byId("recupPinOverlay").hidden&&byId("recupHoursOverlay").hidden){
    document.documentElement.classList.remove("recup-modal-open");
  }
}
function closePin(){
  hide(byId("recupPinOverlay"));
  byId("recupPinInput").value="";
  byId("recupPinError").textContent="";
  releaseIfClosed();
}
function closeHours(){
  unlocked=false;
  hide(byId("recupHoursOverlay"));
  releaseIfClosed();
}
window.openRecoveryHoursLock=function(){
  if(!byId("recupPinOverlay")||!byId("recupHoursOverlay"))return;
  closeHours();
  byId("recupPinInput").value="";
  byId("recupPinError").textContent="";
  document.documentElement.classList.add("recup-modal-open");
  show(byId("recupPinOverlay"));
  setTimeout(()=>byId("recupPinInput")?.focus(),0);
};
window.closeRecoveryHoursLock=closePin;
window.closeRecoveryHours=closeHours;
function unlock(event){
  if(event)event.preventDefault();
  const input=byId("recupPinInput");
  if(input.value.replace(/\D/g,"")!==PIN){
    byId("recupPinError").textContent="Code incorrect.";
    input.value="";input.focus();return;
  }
  unlocked=true;
  closePin();
  document.documentElement.classList.add("recup-modal-open");
  show(byId("recupHoursOverlay"));
  byId("recupLeaveDate").value=parisToday();
  render();
  byId("recupHoursClose").focus();
}
function render(){
  if(!unlocked||byId("recupHoursOverlay").hidden)return;
  const data=read(),now=Date.now(),today=parisToday();
  const earned=accruedMinutes(now);
  const entries=data.entries.filter(e=>!e.cancelledAt&&e.date<=today&&e.date>=START_DATE&&Number(e.days)>0);
  const spentDays=entries.reduce((sum,e)=>sum+Number(e.days),0);
  const spentMins=Math.round(spentDays*data.dayMinutes);
  const balance=earned-spentMins;
  const balanceDays=balance/data.dayMinutes;
  const lead=byId("recupBalanceHeader");
  lead.dataset.tone=balance>=0?"positive":"negative";
  byId("recupBalanceDays").textContent=fmtNum(balanceDays)+" jour"+(Math.abs(balanceDays)===1?"":"s");
  byId("recupBalanceHours").textContent=fmtMinutes(balance)+" disponibles";
  byId("recupEarnedHours").textContent=fmtMinutes(earned);
  byId("recupEarnedDays").textContent=fmtNum(earned/data.dayMinutes)+" jours accumulés";
  byId("recupSpentDays").textContent=fmtNum(spentDays)+" jours";
  byId("recupSpentHours").textContent=fmtMinutes(spentMins)+" déduites";
  byId("recupDailyHours").value=String(data.dayMinutes/60);
  byId("recupLeaveDate").max=today;
  if(!byId("recupLeaveDate").value||byId("recupLeaveDate").value>today)byId("recupLeaveDate").value=today;
  const list=byId("recupHistory");
  list.replaceChildren();
  if(data.entries.length===0){
    const empty=document.createElement("p");
    empty.className="recup-muted";
    empty.textContent="Aucun congé consommé enregistré pour le moment.";
    list.appendChild(empty);
  }else{
    const ordered=[...data.entries].sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.createdAt).localeCompare(String(a.createdAt)));
    for(const entry of ordered){
      const cancelled=!!entry.cancelledAt;
      const item=document.createElement("div");
      item.className="recup-history-row"+(cancelled?" recup-cancelled":"");
      const info=document.createElement("div");
      const title=document.createElement("strong");
      title.textContent=frenchDate(entry.date)+" · "+fmtNum(Number(entry.days)||0)+" j"+(cancelled?" · Annulé":entry.date<START_DATE?" · Hors période (non déduit)":"");
      const note=document.createElement("div");
      note.className="recup-muted";
      note.textContent=entry.note||"Congé consommé";
      info.append(title,note);item.appendChild(info);
      if(!cancelled){
        const cancel=document.createElement("button");
        cancel.className="recup-small-button";
        cancel.type="button";
        cancel.textContent="Annuler";
        cancel.setAttribute("aria-label","Annuler le congé du "+frenchDate(entry.date));
        cancel.addEventListener("click",()=>{
          if(!unlocked)return;
          if(!confirm("Annuler cette déduction de "+fmtNum(Number(entry.days))+" jour(s) du "+frenchDate(entry.date)+" ? Elle restera visible dans l’historique."))return;
          const fresh=read();
          const found=fresh.entries.find(e=>e.id===entry.id);
          if(!found||found.cancelledAt)return;
          found.cancelledAt=new Date().toISOString();
          if(write(fresh))render();
        });
        item.appendChild(cancel);
      }
      list.appendChild(item);
    }
  }
}
function saveLeave(event){
  event.preventDefault();
  if(!unlocked)return;
  const date=byId("recupLeaveDate").value;
  const days=Number(byId("recupLeaveDays").value);
  const note=byId("recupLeaveNote").value.trim().slice(0,180);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<START_DATE||date>parisToday()){
    alert("Choisissez une date comprise entre le 05/10/2026 et aujourd’hui.");return;
  }
  if(!Number.isFinite(days)||days<=0||days>60||Math.round(days*100)/100!==days){
    alert("Saisissez un nombre de jours positif (maximum 60, précision de 0,01 jour).");return;
  }
  const data=read();
  data.entries.push({
    id:(typeof crypto!=="undefined"&&crypto.randomUUID)?crypto.randomUUID():"r-"+Date.now()+"-"+Math.random().toString(36).slice(2),
    date,days,note,createdAt:new Date().toISOString()
  });
  if(write(data)){
    byId("recupLeaveDays").value="";
    byId("recupLeaveNote").value="";
    render();
  }
}
function saveDayHours(){
  if(!unlocked)return;
  const hours=Number(byId("recupDailyHours").value);
  if(!Number.isFinite(hours)||hours<1||hours>12||Math.round(hours*4)!==hours*4){
    alert("Indiquez une durée de 1 à 12 heures par jour (par pas de 15 minutes).");return;
  }
  const data=read();
  data.dayMinutes=Math.round(hours*60);
  if(write(data))render();
}
byId("recupPinForm")?.addEventListener("submit",unlock);
byId("recupLeaveForm")?.addEventListener("submit",saveLeave);
byId("recupSaveDayHours")?.addEventListener("click",saveDayHours);
byId("recupPinInput")?.addEventListener("input",e=>{e.target.value=e.target.value.replace(/\D/g,"").slice(0,8);byId("recupPinError").textContent=""});
for(const id of ["recupPinOverlay","recupHoursOverlay"]){
  byId(id)?.addEventListener("click",e=>{
    if(e.target!==e.currentTarget)return;
    if(id==="recupPinOverlay")closePin();else closeHours();
  });
}
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape")return;
  if(!byId("recupPinOverlay")?.hidden)closePin();
  else if(!byId("recupHoursOverlay")?.hidden)closeHours();
});
window.recoveryHoursRemoteUpdate=render;
window.addEventListener("storage",e=>{if(e.key===KEY)render()});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)render()});
window.addEventListener("focus",render);
setInterval(render,30000);
})();
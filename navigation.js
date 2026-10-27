/* Chabanal et fils v1.1 — historique de navigation local.
   Compatible avec le bouton Retour Android et les flèches du navigateur.
   Ne modifie ni les fiches clients ni le moteur de synchronisation. */
(function(){
  "use strict";
  const KEY="__chabanal_navigation_v11";
  let restoring=false;
  const routeNow=()=>history.state && history.state[KEY];
  const route=(view,id)=>({view,id:id==null?null:String(id),scrollY:0});

  function replaceRoute(view,id){
    history.replaceState(Object.assign({},history.state||{}, {[KEY]:route(view,id)}),"",location.href);
  }
  function rememberScroll(){
    const old=routeNow();
    if(old)history.replaceState(Object.assign({},history.state||{}, {[KEY]:Object.assign({},old,{scrollY:window.scrollY})}),"",location.href);
  }
  function pushRoute(view,id){
    if(restoring)return;
    const next=route(view,id),old=routeNow();
    if(old&&old.view===next.view&&old.id===next.id)return;
    rememberScroll();
    history.pushState(Object.assign({},history.state||{}, {[KEY]:next}),"",location.href);
  }
  function restoreRoute(r){
    restoring=true;
    try{
      document.querySelectorAll(".modal-backdrop").forEach(x=>x.remove());
      window.__deleteConfirmCallback=null;
      if(r?.view!=="stock"&&typeof window.stockCloseScanner==="function")window.stockCloseScanner();
      for(const id of ["home","client","equipment","diagnostic","stock"])
        document.getElementById(id).classList.add("hidden");
      const show=id=>document.getElementById(id).classList.remove("hidden");

      if(r && (r.view==="client"||r.view==="clientEdit")){
        const item=clients.find(c=>c.id===r.id);
        if(item){
          current=item;
          show("client");
          if(r.view==="clientEdit")editClient();
          else renderClient();
        }else{show("home");search();replaceRoute("home");}
      }else if(r && r.view==="equipment"){
        const model=equipmentModels.find(m=>m.id===r.id);
        if(model){
          currentEquipmentId=model.id;
          show("equipment");
          renderEquipmentPage();
        }else{show("home");search();replaceRoute("home");}
      }else if(r && r.view==="stock"){
        show("stock");
        if(typeof window.stockOpenView==="function")window.stockOpenView();
      }else if(r && r.view==="diagnostic"){
        currentDiagnosticId=null;
        show("diagnostic");
        renderDiagnosticHome();
      }else if(r && r.view==="diagnosticBrand"){
        const item=diagnosticBrands.find(d=>d.id===r.id);
        if(item){
          currentDiagnosticId=item.id;
          show("diagnostic");
          renderDiagnosticBrand();
        }else{
          currentDiagnosticId=null;
          show("diagnostic");
          renderDiagnosticHome();
          replaceRoute("diagnostic");
        }
      }else{show("home");search();}
      requestAnimationFrame(()=>window.scrollTo(0,Number(r&&r.scrollY)||0));
    }finally{restoring=false;}
  }

  function wrap(name,before,after){
    const original=window[name];
    if(typeof original!=="function")throw Error("Navigation manquante : "+name);
    window[name]=function(){
      const extra=(!restoring&&before)?before.apply(this,arguments):undefined;
      const result=original.apply(this,arguments);
      if(!restoring&&after)after.call(this,extra,...arguments);
      return result;
    };
  }
  const leaveStock=()=>document.getElementById("stock")?.classList.add("hidden");
  wrap("openStock",function(){pushRoute("stock");});
  wrap("newClient",function(){leaveStock();});
  wrap("openClient",function(id){
    leaveStock();
    if(clients.some(c=>c.id===id))pushRoute("client",id);
  });
  wrap("openEquipment",function(id){
    leaveStock();
    if(equipmentModels.some(m=>m.id===id))pushRoute("equipment",id);
  });
  wrap("openDiagnosticHome",function(){leaveStock();pushRoute("diagnostic");});
  wrap("openDiagnosticBrand",function(id){
    leaveStock();
    if(diagnosticBrands.some(d=>d.id===id))pushRoute("diagnosticBrand",id);
  });
  wrap("editClient",function(){if(current)pushRoute("clientEdit",current.id);});
  wrap("saveClient",function(){return !!(current&&current.isNew);},function(wasNew){
    if(document.getElementById("e_name")||!current)return; // Formulaire encore présent : validation refusée
    const state=routeNow();
    if(state&&state.view==="clientEdit"){
      if(wasNew)replaceRoute("client",current.id);
      else window.appGoBack();
    }
  });
  wrap("saveDiagnosticBrand",null,function(){
    if(currentDiagnosticId&&!document.getElementById("diagnosticBrandModal"))
      pushRoute("diagnosticBrand",currentDiagnosticId);
  });
  wrap("deleteDiagnosticBrand",null,function(){
    if(routeNow()?.view==="diagnosticBrand"&&!currentDiagnosticId)replaceRoute("diagnostic");
  });
  wrap("goHome",null,function(){replaceRoute("home");});

  window.appGoBack=function(){
    if(restoring)return;
    history.back();
  };
  window.addEventListener("popstate",function(e){
    restoreRoute(e.state&&e.state[KEY]||route("home"));
  });
  if(routeNow())restoreRoute(routeNow());
  else replaceRoute("home");
})();

/* Chabanal et fils — retour accueil par le logo et appareil photo dans chaque marque. */
(function(){
  'use strict';

  // Le logo est un raccourci de navigation, y compris au clavier.
  function initHomeLogo(){
    const logo=document.querySelector('.brand-logo');
    if(!logo||logo.dataset.homeLinkReady==='1')return;
    logo.dataset.homeLinkReady='1';
    logo.setAttribute('role','button');
    logo.setAttribute('tabindex','0');
    logo.setAttribute('aria-label','Revenir à l’accueil');
    logo.setAttribute('title','Retour à l’accueil');
    const home=()=>{
      if(typeof window.goHome==='function')window.goHome();
      window.scrollTo({top:0,behavior:'auto'});
    };
    logo.addEventListener('click',home);
    logo.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){e.preventDefault();home();}
    });
    const css=document.createElement('style');
    css.textContent='.brand-logo{cursor:pointer;touch-action:manipulation}.brand-logo:focus-visible{outline:2px solid #69b2ff;outline-offset:4px;border-radius:8px}.diagnostic-camera-action{white-space:nowrap}';
    document.head.appendChild(css);
  }

  // Réduction avant sauvegarde : les photos de téléphone seraient trop lourdes
  // pour le stockage local et la synchronisation des diagnostics.
  function compressDiagnosticPhoto(file){
    return new Promise((resolve,reject)=>{
      if(!file||!file.type.startsWith('image/')){
        reject(new Error('Le fichier sélectionné n’est pas une image.'));return;
      }
      const url=URL.createObjectURL(file);
      const img=new Image();
      img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Image illisible ou format non pris en charge.'));};
      img.onload=()=>{
        URL.revokeObjectURL(url);
        try{
          const maxSide=1600;
          const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
          const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
          canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
          const ctx=canvas.getContext('2d');
          if(!ctx)throw new Error('Compression non disponible.');
          ctx.drawImage(img,0,0,canvas.width,canvas.height);
          let data=canvas.toDataURL('image/jpeg',0.75);
          if(data.length>1050000){
            canvas.width=Math.max(1,Math.round(img.naturalWidth*Math.min(1,1100/Math.max(img.naturalWidth,img.naturalHeight))));
            canvas.height=Math.max(1,Math.round(img.naturalHeight*Math.min(1,1100/Math.max(img.naturalWidth,img.naturalHeight))));
            canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
            data=canvas.toDataURL('image/jpeg',0.68);
          }
          if(!data.startsWith('data:image/jpeg;base64,'))throw new Error('Conversion de la photo impossible.');
          resolve(data);
        }catch(err){reject(err);}
      };
      img.src=url;
    });
  }

  function takeBrandPhoto(brandId,button){
    const input=document.createElement('input');
    input.type='file';
    input.accept='image/*';
    input.setAttribute('capture','environment');
    input.setAttribute('aria-label','Prendre une photo pour cette marque');
    input.style.cssText='position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(input);
    input.addEventListener('cancel',()=>input.remove(),{once:true});
    input.addEventListener('change',async()=>{
      const file=input.files&&input.files[0];
      input.remove();
      if(!file)return;
      if(button){button.disabled=true;button.textContent='⌛ Enregistrement…';}
      try{
        if(typeof window.metierMediaAddFiles==="function"){
          const ok=await window.metierMediaAddFiles({
            scope:"diagnostic",ownerId:brandId,kind:"photo",codeId:null,files:[file]
          });
          if(!ok)console.warn("Photo diagnostic conservée localement en attente de synchronisation.");
          return;
        }
        // Ancienne installation sans module : conserver la photo localement.
        const data=await compressDiagnosticPhoto(file);
        const brand=diagnosticBrands.find(d=>String(d.id)===String(brandId));
        if(!brand)throw new Error('Cette marque n’existe plus.');
        const date=new Date();
        const photo={name:'Photo diagnostic '+date.toLocaleString('fr-FR').replace(/[,/:]/g,'-')+'.jpg',type:'image/jpeg',size:Math.round((data.length-data.indexOf(',')-1)*.75),data};
        if(!Array.isArray(brand.documents))brand.documents=[];
        brand.documents.push(photo);
        if(!saveDiagnostics()){
          brand.documents.pop();
          return;
        }
        if(currentDiagnosticId===brandId&&typeof renderDiagnosticBrand==='function')renderDiagnosticBrand();
      }catch(e){alert('Impossible d’enregistrer la photo : '+(e&&e.message?e.message:'erreur inconnue'));}
      finally{if(button&&button.isConnected){button.disabled=false;button.textContent='📷 Prendre une photo';}}
    },{once:true});
    input.click();
  }

  // La page Diagnostic est reconstruite après chaque modification ou synchro :
  // rattacher le bouton à chaque nouveau rendu sans modifier le moteur métier.
  function addCameraAction(){
    const body=document.getElementById('diagnosticBody');
    if(!body||!currentDiagnosticId||!document.getElementById('diagnostic')||document.getElementById('diagnostic').classList.contains('hidden'))return;
    const title=Array.from(body.querySelectorAll('h3')).find(h=>h.textContent.includes('Documents de la marque'));
    if(!title)return;
    const toolbar=title.parentElement;
    if(!toolbar||toolbar.querySelector('.diagnostic-camera-action'))return;
    const id=currentDiagnosticId;
    const button=document.createElement('button');
    button.type='button';
    button.className='secondary diagnostic-camera-action';
    button.textContent='📷 Prendre une photo';
    button.title='Ouvrir l’appareil photo du téléphone et enregistrer dans cette marque';
    button.addEventListener('click',()=>takeBrandPhoto(id,button));
    toolbar.appendChild(button);
  }

  function init(){
    initHomeLogo();
    const body=document.getElementById('diagnosticBody');
    if(body){
      new MutationObserver(addCameraAction).observe(body,{childList:true});
      addCameraAction();
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();

/* Charge l'extension PAC multisplit après l'initialisation de l'application. */
(function(){
  function loadPacModule(){
    if(document.querySelector('script[data-chabanal-pac-split]'))return;
    const script=document.createElement('script');
    script.src='./pac-split.js?v=marques-20261027';
    script.dataset.chabanalPacSplit='1';
    script.async=false;
    document.body.appendChild(script);
    // Module de diagnostic entièrement en lecture seule (aucun changement métier).
    if(!document.querySelector('script[data-chabanal-sync-diagnostic]')){
      const diagnostic=document.createElement('script');
      diagnostic.src='./sync-diagnostic.js';
      diagnostic.dataset.chabanalSyncDiagnostic='1';
      diagnostic.async=false;
      document.body.appendChild(diagnostic);
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadPacModule,{once:true});
  else loadPacModule();
})();

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
      for(const id of ["home","client","equipment","diagnostic"])
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
  wrap("openClient",function(id){
    if(clients.some(c=>c.id===id))pushRoute("client",id);
  });
  wrap("openEquipment",function(id){
    if(equipmentModels.some(m=>m.id===id))pushRoute("equipment",id);
  });
  wrap("openDiagnosticHome",function(){pushRoute("diagnostic");});
  wrap("openDiagnosticBrand",function(id){
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
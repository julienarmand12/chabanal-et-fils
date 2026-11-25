/* Chabanal et fils — préparation de fusion V2 -> V1
 * Plans réversibles par clé métier, strictement sans écriture.
 */
(function (global) {
  "use strict";
  const K = {
    clients:"metier_clients_v1_2_corrigee", deleted:"metier_clients_deleted_v1",
    models:"metier_equipement_modeles_v1", assignments:"metier_equipement_attributions_v1",
    serials:"metier_equipement_numeros_serie_v1", notifications:"metier_notifications_pieces_v1",
    diagnostics:"metier_diagnostics_marques_v1", recovery:"metier_heures_recuperation_v1",
    stockCache:"chabanal_stock_cache_v1", stockPending:"chabanal_stock_pending_v1"
  };
  function parse(storage,key,fallback) {
    const raw=storage.getItem(key); if(raw==null)return fallback;
    try{return JSON.parse(raw)}catch(_){throw new Error("Donnée locale illisible : "+key)}
  }
  function stable(v) {
    if(Array.isArray(v))return v.map(stable);
    if(v&&typeof v==="object"){const o={};Object.keys(v).sort().forEach(k=>o[k]=stable(v[k]));return o}
    return v;
  }
  const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  function mapPlan(events,storage) {
    if(!Array.isArray(events)||!storage||typeof storage.getItem!=="function")throw new Error("Événements ou stockage local invalides.");
    const local={
      clients:parse(storage,K.clients,[]),deleted:parse(storage,K.deleted,[]),
      models:parse(storage,K.models,[]),assignments:parse(storage,K.assignments,{}),
      serials:parse(storage,K.serials,{}),notifications:parse(storage,K.notifications,{}),
      diagnostics:parse(storage,K.diagnostics,[]),recovery:parse(storage,K.recovery,{dayMinutes:420,entries:[]}),
      stockCache:parse(storage,K.stockCache,{}),stockPending:parse(storage,K.stockPending,{})
    };
    if(!Array.isArray(local.clients)||!Array.isArray(local.models)||!Array.isArray(local.diagnostics)||
       !Array.isArray(local.deleted)||!local.recovery||!Array.isArray(local.recovery.entries))
      throw new Error("Une ou plusieurs structures V1 ne correspondent pas au format attendu.");
    const actions=[],unsupported=[];
    const working={models:clone(local.models),assignments:clone(local.assignments),serials:clone(local.serials),notifications:clone(local.notifications),diagnostics:clone(local.diagnostics),recovery:clone(local.recovery),stockCache:clone(local.stockCache)};
    const add=(key,type,id,proposed,reason)=>{
      const current=parse(storage,key,null);
      actions.push({type,id,key,status:same(current,proposed)?"already-identical":"manual-review",reason,local:current,proposed});
    };
    const byClient=new Map(local.clients.filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
    const incomingClients=new Map(), incomingInterventions=new Map();
    const latest=new Map();
    for(const e of events) {
      if(!e||!e.entity_type||!e.record_id){unsupported.push({seq:e?.seq||null,reason:"Événement incomplet"});continue}
      const key=e.entity_type+"::"+e.record_id, old=latest.get(key);
      if(!old||Number(e.revision||0)>=Number(old.revision||0))latest.set(key,e);
    }
    for(const e of latest.values()) {
      const p=e.payload||{};
      if(e.deleted||e.operation==="delete"||p.__deleted||p.deleted) {
        actions.push({type:e.entity_type,id:e.record_id,status:"manual-delete-review",reason:"Suppression à arbitrer manuellement ; aucune suppression V1 proposée."});
        continue;
      }
      switch(e.entity_type) {
        case "client": {
          if(String(p.id)!==String(e.record_id)){unsupported.push({seq:e.seq,reason:"Identifiant client incohérent"});break}
          incomingClients.set(String(e.record_id),clone(p)); break;
        }
        case "intervention": {
          const cid=String(p.client_id||"");
          if(!cid){unsupported.push({seq:e.seq,reason:"Intervention sans client_id"});break}
          if(!incomingInterventions.has(cid))incomingInterventions.set(cid,[]);
          const item=clone(p);delete item.client_id;delete item.legacy_index;
          incomingInterventions.get(cid).push({seq:e.seq,index:p.legacy_index,item});break;
        }
        case "equipment_model": {
          const arr=working.models.slice(),i=arr.findIndex(x=>String(x.id)===String(e.record_id));
          if(i>=0) arr[i]={...arr[i],...clone(p),documents:arr[i].documents||[]};
          else arr.push({...clone(p),documents:[]});
          working.models=arr;
          add(K.models,"equipment_model",e.record_id,arr,"Catalogue V1 proposé ; documents locaux conservés lors d'une mise à jour.");
          break;
        }
        case "equipment_installation": {
          const cid=String(p.client_id||""),mid=String(p.model_id||"");
          if(!cid||!mid){unsupported.push({seq:e.seq,reason:"Attribution équipement sans client_id ou model_id"});break}
          const obj=clone(working.assignments),list=Array.isArray(obj[cid])?obj[cid].slice():[];
          const install={...clone(p)};delete install.client_id;delete install.model_id;delete install.legacy_index;
          if(!list.some(x=>String(typeof x==="string"?x:(x.modelId||x.model_id||x.id))===mid))
            list.push(Object.keys(install).length?{...install,modelId:mid}:mid);
          obj[cid]=list;working.assignments=obj;
          add(K.assignments,"equipment_installation",e.record_id,obj,"Attributions V1 proposées sans retirer les installations existantes.");
          break;
        }
        case "equipment_serial": {
          const cid=String(p.client_id||""),mid=String(p.model_id||"");
          if(!cid||!mid){unsupported.push({seq:e.seq,reason:"Numéro de série sans client_id ou model_id"});break}
          const obj=clone(working.serials);obj[cid]={...(obj[cid]||{})};
          if(p.serial)obj[cid][mid]=String(p.serial);else delete obj[cid][mid];
          if(p.year)obj[cid]["__year__"+mid]=String(p.year);else delete obj[cid]["__year__"+mid];
          working.serials=obj;
          add(K.serials,"equipment_serial",e.record_id,obj,"Numéros de série et années proposés par client et modèle.");
          break;
        }
        case "notification": {
          const obj=clone(working.notifications);obj[String(e.record_id)]=clone(p);
          working.notifications=obj;
          add(K.notifications,"notification",e.record_id,obj,"Notification V1 proposée sans écraser les autres notifications.");
          break;
        }
        case "diagnostic_brand": {
          const arr=working.diagnostics.slice(),i=arr.findIndex(x=>String(x.id)===String(e.record_id));
          if(i>=0) arr[i]={...arr[i],...clone(p),documents:arr[i].documents||[],codes:arr[i].codes||[]};
          else arr.push({...clone(p),documents:Array.isArray(p.documents)?p.documents:[],codes:Array.isArray(p.codes)?p.codes:[]});
          working.diagnostics=arr;
          add(K.diagnostics,"diagnostic_brand",e.record_id,arr,"Marque de diagnostic proposée ; codes et documents V1 existants préservés.");
          break;
        }
        case "recovery_time": {
          if(typeof p.id!=="string"||!p.id){unsupported.push({seq:e.seq,reason:"Entrée de récupération sans identifiant"});break}
          const obj=clone(working.recovery),entries=Array.isArray(obj.entries)?obj.entries.slice():[];
          const i=entries.findIndex(x=>String(x.id)===String(p.id));
          const entry=clone(p);delete entry.dayMinutes;
          if(i>=0)entries[i]={...entries[i],...entry};else entries.push(entry);
          obj.entries=entries;
          if(Number(p.dayMinutes)>0)obj.dayMinutes=Number(p.dayMinutes);
          working.recovery=obj;
          add(K.recovery,"recovery_time",e.record_id,obj,"Historique de récupération proposé ; les entrées locales non présentes dans V2 sont conservées.");
          break;
        }
        case "stock_item": {
          if(!p.id||!p.kind){unsupported.push({seq:e.seq,reason:"Article de stock sans id ou kind"});break}
          const key="metier_stock_v1_"+String(p.kind)+"_"+String(p.id);
          const pending=clone(local.stockPending),cache=clone(working.stockCache);
          const current=pending[key]?.value||cache[key]?.value||null;
          const proposed={...(current||{}),...clone(p)};
          const cacheProposed={...cache,[key]:{value:proposed,version:Number(cache[key]?.version||0)}};
          working.stockCache=cacheProposed;
          add(K.stockCache,"stock_item",e.record_id,cacheProposed,"Article proposé dans le cache stock V1 ; la file d'attente locale n'est pas écrasée.");
          if(pending[key]) actions.push({type:"stock_item",id:e.record_id,key:K.stockPending,status:"conflict",reason:"Une modification locale de cet article est déjà en attente : arbitrage obligatoire.",local:pending[key],proposed});
          break;
        }
        case "media":
          unsupported.push({seq:e.seq,type:e.entity_type,id:e.record_id,reason:"Média non réversible automatiquement : le Storage privé V2 doit être téléchargé et contrôlé avant conversion vers les fichiers V1."});
          break;
        case "deletion_marker":
          actions.push({type:e.entity_type,id:e.record_id,status:"manual-delete-review",reason:"Marqueur de suppression à contrôler ; aucune suppression automatique."});
          break;
        default: unsupported.push({seq:e.seq,type:e.entity_type,id:e.record_id,reason:"Type V2 non reconnu."});
      }
    }
    for(const [id,remote] of incomingClients) {
      const current=byClient.get(id), proposedInterventions=[];
      const existing=current&&Array.isArray(current.interventions)?current.interventions:[];
      const incoming=(incomingInterventions.get(id)||[]).sort((a,b)=>Number(a.index??a.seq)-Number(b.index??b.seq));
      for(const row of incoming) {
        const it=row.item,dup=existing.some(x=>x&&String(x.iso||x.date||"")===String(it.iso||it.date||"")&&String(x.description||"")===String(it.description||""));
        if(!dup)proposedInterventions.push(it);
      }
      if(!current) actions.push({type:"client",id,status:local.deleted.map(String).includes(id)?"conflict":"new-client-candidate",reason:local.deleted.map(String).includes(id)?"Identifiant supprimé dans V1.":"Création à valider manuellement.",client:remote,interventions:proposedInterventions});
      else {
        const core=x=>{const o={...x};delete o.interventions;return o};
        actions.push({type:"client",id,status:same(core(current),core(remote))?"review-append-only":"conflict",reason:"Comparer les champs du client et valider séparément les interventions.",local:core(current),remote:core(remote),interventions:proposedInterventions});
      }
    }
    for(const [id,rows] of incomingInterventions) if(!incomingClients.has(id))
      actions.push({type:"intervention",id,status:"orphan-review",reason:"Interventions reçues sans événement client correspondant.",count:rows.length});
    const counts=actions.reduce((o,a)=>(o[a.status]=(o[a.status]||0)+1,o),{});
    return {generated_at:new Date().toISOString(),mode:"preview-only",writes_performed:false,
      safety:"Lecture seule : aucune écriture localStorage, aucun appel réseau, aucune fusion ou suppression automatique.",
      counts,actions,unsupported};
  }
  global.ChabanalV2MergePreview=Object.freeze({mapPlan});
})(window);

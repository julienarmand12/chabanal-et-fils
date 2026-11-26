/* Connexion V2 isolée — Supabase Test 2.
 * Ne réutilise ni la session ni la configuration Supabase historique.
 * La clé publishable est publique ; aucun secret service_role n'est embarqué.
 */
(function(global){
 "use strict";
 const URL="https://ilwqadpxlooxjptgpbgg.supabase.co";
 const KEY="sb_publishable_9tHsm8gMyTcjrVEHHhmEfA_m7bnG-FJ";
 const WORKSPACE="2d32b34b-66d8-416b-a369-37f564eb7c99";
 const STORAGE_KEY="chabanal_test2_auth_v1";
 let client=null;
 function getClient(){
  if(!global.supabase||typeof global.supabase.createClient!=="function") throw new Error("Bibliothèque Supabase indisponible.");
  if(!client) client=global.supabase.createClient(URL,KEY,{auth:{
   persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,
   storage:global.localStorage,storageKey:STORAGE_KEY
  }});
  return client;
 }
 async function session(){
  const c=getClient(),r=await c.auth.getSession();
  if(r.error) throw r.error;
  return r.data.session||null;
 }
 async function getAuthenticatedClient(){
  const s=await session();
  return s?getClient():null;
 }
 async function login(email,password){
  const c=getClient();
  const r=await c.auth.signInWithPassword({email,password});
  if(r.error) throw r.error;
  return r.data.session;
 }
 async function logout(){
  if(!client)return;
  const r=await client.auth.signOut();
  if(r.error)throw r.error;
 }
 function mount(){
  if(document.getElementById("v2Test2Connection"))return;
  const host=document.getElementById("cloudSyncPanel")||document.body;
  const box=document.createElement("section");
  box.id="v2Test2Connection";
  box.style.cssText="margin:14px 0;padding:14px;border:1px solid #3475a5;border-radius:12px;background:rgba(20,50,75,.22)";
  const title=document.createElement("strong");title.textContent="🧪 Connexion indépendante — V2 Test 2";
  const note=document.createElement("p");note.className="small muted";
  note.textContent="Cette connexion utilise un espace de session séparé. Elle ne modifie pas la connexion V1.";
  const email=document.createElement("input");email.type="email";email.autocomplete="username";email.placeholder="Adresse e-mail du compte Test 2";email.style.cssText="display:block;width:100%;margin:8px 0;padding:10px";
  const pass=document.createElement("input");pass.type="password";pass.autocomplete="current-password";pass.placeholder="Mot de passe Supabase Test 2";pass.style.cssText="display:block;width:100%;margin:8px 0;padding:10px";
  const row=document.createElement("div");row.style.cssText="display:flex;gap:8px;flex-wrap:wrap";
  const sign=document.createElement("button");sign.type="button";sign.className="secondary small";sign.textContent="Se connecter à V2 Test 2";
  const out=document.createElement("button");out.type="button";out.className="secondary small";out.textContent="Déconnecter V2 Test 2";
  const status=document.createElement("p");status.className="small muted";status.style.marginBottom="0";
  async function refresh(){
   try{const s=await session();status.textContent=s?"V2 Test 2 connecté · compte "+(s.user.email||s.user.id)+" · workspace isolé.":"V2 Test 2 déconnecté. La connexion V1 reste inchangée.";}
   catch(e){status.textContent="Connexion V2 indisponible : "+e.message;}
  }
  sign.addEventListener("click",async()=>{
   sign.disabled=true;status.textContent="Connexion en cours…";
   try{await login(email.value.trim(),pass.value);pass.value="";await refresh();}
   catch(e){status.textContent="Connexion refusée : "+e.message;}
   finally{sign.disabled=false;}
  });
  out.addEventListener("click",async()=>{try{await logout();await refresh();}catch(e){status.textContent="Déconnexion impossible : "+e.message;}});
  row.append(sign,out);box.append(title,note,email,pass,row,status);
  if(host===document.body)host.prepend(box);else host.appendChild(box);

  const tests=document.createElement("div");
  tests.style.cssText="margin-top:12px;padding-top:12px;border-top:1px solid rgba(120,160,190,.35)";
  const testTitle=document.createElement("strong");testTitle.textContent="Diagnostic du moteur V2 — espace de test uniquement";
  const testNote=document.createElement("p");testNote.className="small muted";testNote.textContent="Utilise une fiche technique fictive dédiée. Aucun client ni intervention réelle n'est modifié.";
  const testRow=document.createElement("div");testRow.style.cssText="display:flex;gap:8px;flex-wrap:wrap";
  const writeBtn=document.createElement("button");writeBtn.type="button";writeBtn.className="secondary small";writeBtn.textContent="1. Tester l'écriture";
  const readBtn=document.createElement("button");readBtn.type="button";readBtn.className="secondary small";readBtn.textContent="2. Tester la lecture";
  const deltaBtn=document.createElement("button");deltaBtn.type="button";deltaBtn.className="secondary small";deltaBtn.textContent="3. Vérifier le journal";
  const result=document.createElement("p");result.className="small muted";result.style.cssText="margin:8px 0 0;white-space:pre-wrap";
  const testId="__diagnostic_v2_test2_shared__";
  async function runTest(button,action){
   button.disabled=true;result.textContent="Test en cours…";
   try{
    const c=await getAuthenticatedClient();if(!c)throw new Error("Connectez-vous d'abord à V2 Test 2.");
    const deviceResult=await c.from("app_v2_devices").upsert({id:(global.crypto&&global.crypto.randomUUID?global.crypto.randomUUID():"00000000-0000-4000-8000-"+String(Date.now()).slice(-12).padStart(12,"0")),workspace_id:WORKSPACE,device_label:"Diagnostic V2 Test 2",last_seen_at:new Date().toISOString()},{onConflict:"id"});if(deviceResult.error)throw deviceResult.error;
    await action(c);
   }catch(e){result.textContent="ÉCHEC : "+(e.message||String(e));}
   finally{button.disabled=false;}
  }
  writeBtn.addEventListener("click",()=>runTest(writeBtn,async c=>{
   const payload={id:testId,diagnostic:true,source:"Chabanal V2 Test 2",message:"Enregistrement fictif de diagnostic",written_at:new Date().toISOString()};
   const q=await c.from("app_v2_records").upsert({workspace_id:WORKSPACE,entity_type:"notification",record_id:testId,payload,deleted_at:null},{onConflict:"workspace_id,entity_type,record_id"}).select("record_id,revision").single();
   if(q.error)throw q.error;result.textContent="ÉCRITURE RÉUSSIE\nIdentifiant : "+q.data.record_id+"\nRévision : "+q.data.revision+"\nEnregistrement fictif uniquement.";
  }));
  readBtn.addEventListener("click",()=>runTest(readBtn,async c=>{
   const q=await c.from("app_v2_records").select("record_id,revision,payload,deleted_at").eq("workspace_id",WORKSPACE).eq("entity_type","notification").eq("record_id",testId).maybeSingle();
   if(q.error)throw q.error;if(!q.data)throw new Error("Aucun enregistrement de diagnostic trouvé. Lancez d'abord le test d'écriture.");
   result.textContent="LECTURE RÉUSSIE\nIdentifiant : "+q.data.record_id+"\nRévision : "+q.data.revision+"\nContenu : "+(q.data.payload?.message||"inconnu")+"\nSupprimé : "+(q.data.deleted_at?"oui":"non");
  }));
  deltaBtn.addEventListener("click",()=>runTest(deltaBtn,async c=>{
   const q=await c.from("app_v2_change_log").select("seq,operation,revision,changed_at").eq("workspace_id",WORKSPACE).eq("entity_type","notification").eq("record_id",testId).order("seq",{ascending:false}).limit(5);
   if(q.error)throw q.error;if(!q.data?.length)throw new Error("Aucun événement trouvé. Lancez d'abord le test d'écriture.");
   result.textContent="JOURNAL V2 ACCESSIBLE\n"+q.data.map(e=>"Séquence "+e.seq+" · "+e.operation+" · révision "+e.revision).join("\n");
  }));
  const changeBtn=document.createElement("button");changeBtn.type="button";changeBtn.className="secondary small";changeBtn.textContent="4. Créer une modification test";
  const cursorLabel=document.createElement("label");cursorLabel.className="small muted";cursorLabel.textContent="Lire les changements après la séquence : ";
  const cursorInput=document.createElement("input");cursorInput.type="number";cursorInput.min="0";cursorInput.value="10";cursorInput.style.cssText="width:82px;padding:7px;margin-left:6px";
  const pullBtn=document.createElement("button");pullBtn.type="button";pullBtn.className="secondary small";pullBtn.textContent="5. Lire les deltas";
  changeBtn.addEventListener("click",()=>runTest(changeBtn,async c=>{
   const current=await c.from("app_v2_records").select("payload,revision").eq("workspace_id",WORKSPACE).eq("entity_type","notification").eq("record_id",testId).maybeSingle();
   if(current.error)throw current.error;if(!current.data)throw new Error("Enregistrement de diagnostic absent. Lancez d'abord le test d'écriture.");
   const payload={...(current.data.payload||{}),message:"Modification de test depuis cet appareil",last_modified_by_device:true,modified_at:new Date().toISOString()};
   const q=await c.from("app_v2_records").update({payload,deleted_at:null}).eq("workspace_id",WORKSPACE).eq("entity_type","notification").eq("record_id",testId).select("record_id,revision").single();
   if(q.error)throw q.error;result.textContent="MODIFICATION TEST RÉUSSIE\\nIdentifiant : "+q.data.record_id+"\\nNouvelle révision : "+q.data.revision+"\\nUne modification a été envoyée au journal V2.";
  }));
  pullBtn.addEventListener("click",()=>runTest(pullBtn,async c=>{
   const cursor=Number(cursorInput.value);if(!Number.isSafeInteger(cursor)||cursor<0)throw new Error("Saisissez une séquence de départ valide.");
   const q=await c.from("app_v2_change_log").select("seq,operation,revision,entity_type,record_id,changed_at").eq("workspace_id",WORKSPACE).gt("seq",cursor).order("seq",{ascending:true}).limit(50);
   if(q.error)throw q.error;
   const events=(q.data||[]).filter(e=>e.record_id===testId);
   if(!events.length)throw new Error("Aucun changement trouvé pour la fiche test après la séquence "+cursor+". Vérifiez qu'un autre téléphone a d'abord créé une modification.");
   result.textContent="LECTURE DELTA RÉUSSIE\\nDepuis la séquence : "+cursor+"\\n"+events.map(e=>"Séquence "+e.seq+" · "+e.operation+" · révision "+e.revision).join("\\n")+"\\n\\nLe téléphone a récupéré les événements du journal après le curseur indiqué.";
  }));
  cursorLabel.appendChild(cursorInput);
  testRow.append(writeBtn,readBtn,deltaBtn,changeBtn,pullBtn,cursorLabel);tests.append(testTitle,testNote,testRow,result);box.appendChild(tests);
  refresh();
 }
 global.ChabanalV2Test2=Object.freeze({url:URL,workspaceId:WORKSPACE,storageKey:STORAGE_KEY,getClient,getAuthenticatedClient,login,logout,session,mount});
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});else mount();
})(window);

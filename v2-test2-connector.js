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
  refresh();
 }
 global.ChabanalV2Test2=Object.freeze({url:URL,workspaceId:WORKSPACE,storageKey:STORAGE_KEY,getClient,getAuthenticatedClient,login,logout,session,mount});
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});else mount();
})(window);

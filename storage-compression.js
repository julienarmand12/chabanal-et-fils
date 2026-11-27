(function(){
  "use strict";
  var KEY="metier_clients_v1_2_corrigee";
  var PREFIX="~CHABANAL-LZW1~";
  var proto=Storage.prototype;
  if(proto.__chabanalCompressedClientsV1)return;
  var nativeGet=proto.getItem,nativeSet=proto.setItem;
  function encode(input){
    var bytes=new TextEncoder().encode(input),dict=new Map(),next=258,out=[];
    if(!bytes.length){out.push(257);return String.fromCharCode(257);}
    var w=bytes[0];
    for(var i=1;i<bytes.length;i++){
      var k=bytes[i],wk=w+","+k;
      if(dict.has(wk)){w=dict.get(wk);continue;}
      out.push(w);
      if(next<=65535)dict.set(wk,next++);
      else {out.push(256);dict.clear();next=258;}
      w=k;
    }
    out.push(w,257);
    var chars="";
    for(var j=0;j<out.length;j++)chars+=String.fromCharCode(out[j]);
    return chars;
  }
  function decode(data){
    var codes=new Array(data.length);
    for(var i=0;i<data.length;i++)codes[i]=data.charCodeAt(i);
    var dict=[],next=258,prev=null,bytes=[];
    function reset(){dict=new Array(256);for(var x=0;x<256;x++)dict[x]=[x];next=258;prev=null;}
    reset();
    for(var p=0;p<codes.length;p++){
      var code=codes[p];
      if(code===257)break;
      if(code===256){reset();continue;}
      var entry=dict[code];
      if(!entry&&code===next&&prev)entry=prev.concat(prev[0]);
      if(!entry)throw new Error("Flux LZW invalide");
      for(var q=0;q<entry.length;q++)bytes.push(entry[q]);
      if(prev&&next<=65535)dict[next++]=prev.concat(entry[0]);
      prev=entry;
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
  Object.defineProperty(proto,"__chabanalCompressedClientsV1",{value:true});
  proto.getItem=function(key){
    var raw=nativeGet.call(this,key);
    if(key!==KEY||raw===null||raw.indexOf(PREFIX)!==0)return raw;
    try{return decode(raw.slice(PREFIX.length));}
    catch(e){console.error("Lecture des clients compressés impossible; valeur brute préservée",e);return raw;}
  };
  proto.setItem=function(key,value){
    var str=String(value);
    if(key!==KEY)return nativeSet.call(this,key,value);
    var stored=PREFIX+encode(str);
    if(stored.length>=str.length)stored=str;
    return nativeSet.call(this,key,stored);
  };
})();
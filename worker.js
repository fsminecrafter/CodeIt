let pyodide=null;

async function load(){
  const v=new URL(self.location).searchParams.get("v") || "0.27.2";

  importScripts(`https://cdn.jsdelivr.net/pyodide/v${v}/full/pyodide.js`);
  pyodide=await loadPyodide();

  self.postMessage({type:"output", text:"Pyodide "+v+" ready"});
}
load();

self.onmessage=async e=>{
  const {type,code,package:pkg}=e.data;

  if(type==="run"){
    try{
      const r=await pyodide.runPythonAsync(code);
      if(r!==undefined) self.postMessage({type:"output",text:String(r)});
    }catch(err){
      self.postMessage({type:"output",text:String(err)});
    }
  }

  if(type==="install"){
    try{
      await pyodide.loadPackage("micropip");
      const micropip=pyodide.pyimport("micropip");
      await micropip.install(pkg);
      self.postMessage({type:"output",text:"Installed "+pkg});
    }catch(err){
      self.postMessage({type:"output",text:String(err)});
    }
  }
};

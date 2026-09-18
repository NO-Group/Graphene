/* Simulated-pointer interaction tests — run: node test/interaction.test.js */
const fs=require("fs"), path=require("path");
let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) { try { JSDOM = require("/tmp/node_modules/jsdom").JSDOM; }
  catch (e2) { console.log("SKIP: jsdom not installed (npm i -D jsdom)"); process.exit(0); } }
const ROOT=path.join(__dirname,"..");
const dom=new JSDOM(fs.readFileSync(path.join(ROOT,"index.html"),"utf8"),{
  url:"http://localhost:8000/", runScripts:"dangerously", pretendToBeVisual:true,
  beforeParse(win){
    win.SVGElement.prototype.getBBox=()=>({x:0,y:0,width:100,height:20});
    win.HTMLCanvasElement.prototype.getContext=function(){return {canvas:this,fillStyle:"#000",strokeStyle:"#000",lineWidth:1,font:"",
      clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},save(){},restore(){},scale(){},translate(){},
      setTransform(){},fillText(){},measureText:()=>({width:10}),drawImage(){}};};
    win.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),0);
  }});
const win=dom.window;
const errs=[]; win.addEventListener("error",e=>errs.push(String(e.error||e.message)));
for(const s of ["js/core.js","js/render.js","js/boolean.js","js/tools.js","js/ui.js","js/extras.js","js/pro.js"]){
  const el=win.document.createElement("script"); el.textContent=fs.readFileSync(path.join(ROOT,s),"utf8");
  win.document.body.appendChild(el);
}
const b=win.document.createElement("script");
b.textContent=`["App","setTool","screenToWorld","render","updateUI","selectedObjs","makeRect","zoomFit","hitObject"].forEach(n=>{try{window[n]=eval(n)}catch(e){}});`;
win.document.body.appendChild(b);
const A=win.App, stage=win.document.getElementById("stage");
// jsdom has no layout: fake the stage rect
stage.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:700,right:1000,bottom:700,x:0,y:0});
A.zoom=1; A.panX=0; A.panY=0;

let pass=0,fail=0; const t=(n,c,x)=>{c?pass++:fail++;console.log((c?"  ok  ":" FAIL ")+n+(!c&&x!==undefined?"  → "+x:""))};
function pd(target,x,y,opts={}){const e=new win.PointerEvent("pointerdown",{clientX:x,clientY:y,button:0,bubbles:true,...opts});
  if(!target.setPointerCapture)target.setPointerCapture=()=>{}; target.dispatchEvent(e);}
function pm(x,y,opts={}){win.dispatchEvent(new win.PointerEvent("pointermove",{clientX:x,clientY:y,bubbles:true,...opts}));}
function pu(x,y,opts={}){win.dispatchEvent(new win.PointerEvent("pointerup",{clientX:x,clientY:y,button:0,bubbles:true,...opts}));}

console.log("— draw a rectangle by dragging —");
A.objects=[]; A.selection=[];
win.setTool("rect");
pd(stage,100,100); pm(300,250); pu(300,250);
t("rect created",A.objects.length===1&&A.objects[0].type==="rect",A.objects.length);
const r=A.objects[0];
t("rect geometry 200x150",Math.round(r.w)===200&&Math.round(r.h)===150,`${r.w}x${r.h}`);
t("auto-switched to select tool",A.tool==="select",A.tool);
t("new rect is selected",A.selection[0]===r.id);

console.log("\n— draw an ellipse with Shift (circle) —");
win.setTool("ellipse");
pd(stage,400,100); pm(600,180,{shiftKey:true}); pu(600,180,{shiftKey:true});
const el2=A.objects[1];
t("shift = perfect circle",Math.round(el2.w)===Math.round(el2.h),`${el2.w}x${el2.h}`);

console.log("\n— move an object by dragging —");
win.setTool("select");
A.selection=[r.id];
win.render();
const x0=r.x,y0=r.y;
const rectEl=win.document.querySelector(`#objects [data-id="${r.id}"]`);
pd(rectEl,150,150); pm(250,220); pu(250,220);
t("object moved by drag",Math.round(r.x-x0)===100&&Math.round(r.y-y0)===70,`dx=${r.x-x0} dy=${r.y-y0}`);

console.log("\n— marquee select —");
A.selection=[];
pd(stage,50,50); pm(900,600); pu(900,600);
t("marquee selected both",A.selection.length===2,A.selection.length);

console.log("\n— keyboard: duplicate + delete —");
A.selection=[r.id];
const n0=A.objects.length;
win.dispatchEvent(new win.KeyboardEvent("keydown",{key:"d",ctrlKey:true,bubbles:true}));
t("ctrl+D duplicated",A.objects.length===n0+1,A.objects.length);
win.dispatchEvent(new win.KeyboardEvent("keydown",{key:"Delete",bubbles:true}));
t("Delete removed it",A.objects.length===n0,A.objects.length);
win.dispatchEvent(new win.KeyboardEvent("keydown",{key:"z",ctrlKey:true,bubbles:true}));
t("ctrl+Z undid delete",A.objects.length===n0+1,A.objects.length);

console.log("\n— shaping via menu command —");
A.objects=[win.makeRect(0,0,100,100),win.makeRect(50,0,100,100)];
A.selection=A.objects.map(o=>o.id);
win.document.querySelector('[data-cmd="shape-weld"]').dispatchEvent(new win.MouseEvent("click",{bubbles:true}));
t("Weld menu button welded",A.objects.length===1&&A.objects[0].type==="path",A.objects.length);

console.log("\n— palette click sets fill —");
A.objects=[win.makeRect(0,0,50,50)]; A.selection=[A.objects[0].id];
const sw=win.document.querySelectorAll("#palette .swatch")[6];
sw.dispatchEvent(new win.MouseEvent("click",{bubbles:true}));
t("swatch applied fill",A.objects[0].fill.color.toLowerCase()==="#7c5cff",A.objects[0].fill.color);

console.log("\n— page tabs —");
const addBtn=win.document.querySelector("#pagebar .page-add");
addBtn.dispatchEvent(new win.MouseEvent("click",{bubbles:true}));
t("page added via + button",A.pages.length===2,A.pages.length);
t("page tabs rendered",win.document.querySelectorAll("#pagebar .page-tab").length===2);

console.log("\n— errors —");
t("no runtime errors",errs.length===0,errs.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);

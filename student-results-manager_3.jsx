import { useState, useMemo, useRef, useEffect } from "react";
import * as d3 from "d3";
import * as XLSX from "sheetjs";

const POINT_SCALE = [
  {min:9.0,label:"Outstanding",color:"#4ADE80",bg:"rgba(22,163,74,0.2)"},
  {min:8.0,label:"Excellent",color:"#60A5FA",bg:"rgba(37,99,235,0.2)"},
  {min:7.0,label:"Very Good",color:"#A78BFA",bg:"rgba(124,58,237,0.2)"},
  {min:6.0,label:"Good",color:"#FBBF24",bg:"rgba(217,119,6,0.2)"},
  {min:5.0,label:"Average",color:"#FB923C",bg:"rgba(234,88,12,0.2)"},
  {min:4.0,label:"Below Avg",color:"#F87171",bg:"rgba(220,38,38,0.2)"},
  {min:0,label:"Poor / Fail",color:"#F43F5E",bg:"rgba(225,29,72,0.2)"},
];
function getPointInfo(c){for(const p of POINT_SCALE)if(c>=p.min)return p;return POINT_SCALE[POINT_SCALE.length-1];}
function detectDelimiter(t){const f=t.split("\n")[0];if(f.split("\t").length>2)return"\t";if(f.split(";").length>2)return";";return",";}

function normalizeRows(rows,meta){
  if(!rows||rows.length<2)return null;
  const rawH=rows[0].map(h=>String(h||"").trim().toLowerCase().replace(/['"]/g,"").replace(/\s+/g," "));
  const find=kw=>rawH.findIndex(h=>kw.some(k=>h.includes(k)));
  let nameIdx=find(["name","student"]),rollIdx=find(["roll","id","reg","enroll","htno","hallticket","usn","prn"]),cgpaIdx=find(["cgpa","gpa","cpi","cumulative"]),sgpaIdx=find(["sgpa","spi","semester gpa"]),backlogIdx=find(["backlog","arrear","kt","atkt","fail","supply"]),activeBacklogIdx=find(["active backlog","active arrear","current backlog","pending"]),branchIdx=find(["branch","dept","department","stream","specialization","discipline","program"]),semIdx=find(["sem","semester","year"]),percentIdx=find(["percent","%","marks","aggregate"]),sectionIdx=find(["section","sec","div","division"]),creditsIdx=find(["credit"]);
  if(sgpaIdx!==-1&&cgpaIdx===-1)cgpaIdx=sgpaIdx;
  if(rollIdx===-1&&rawH[0]&&(rawH[0].includes("s.no")||rawH[0]==="sno")){if(rows.length>1){const sv=String(rows[1][1]||"").trim();if(/\d/.test(sv)&&sv.length>=5)rollIdx=1;}}
  if(rollIdx===-1){const ri=find(["roll no"]);if(ri!==-1)rollIdx=ri;}
  let gradeColStart=-1,gradeColEnd=-1;
  const subCodePat=/^[a-z]{2}\d{2}[a-z]\d{3,4}$/;
  if(rawH.some(h=>subCodePat.test(h.replace(/\s/g,"")))||sgpaIdx!==-1){gradeColStart=Math.max(rollIdx,0)+1;gradeColEnd=cgpaIdx!==-1?cgpaIdx:(creditsIdx!==-1?creditsIdx:rawH.length);}
  if(cgpaIdx===-1&&percentIdx===-1){
    for(let r=0;r<Math.min(rows.length,5);r++){const row=rows[r].map(c=>String(c||"").trim());if(row.length>=2){for(let c=row.length-1;c>=1;c--){const v=parseFloat(row[c]);if(!isNaN(v)&&v>0&&v<=10&&row[c].includes(".")){cgpaIdx=c;if(rollIdx===-1&&/\d/.test(row[1])&&row[1].length>=5)rollIdx=1;break;}}if(cgpaIdx!==-1){gradeColStart=(rollIdx!==-1?rollIdx:0)+1;gradeColEnd=cgpaIdx;break;}}}
  }
  if(cgpaIdx===-1&&percentIdx===-1)return null;
  const students=[];
  for(let i=1;i<rows.length;i++){
    const cols=rows[i].map(c=>String(c||"").trim().replace(/['"]/g,""));
    if(cols.every(c=>!c))continue;
    const rawC=cgpaIdx!==-1?parseFloat(cols[cgpaIdx]):percentIdx!==-1?parseFloat(cols[percentIdx])/10:0;
    const cgpa=isNaN(rawC)?0:Math.round(rawC*100)/100;
    if(cgpa===0&&cols.filter(c=>c).length<2)continue;
    let backlogs=0;
    if(gradeColStart!==-1&&gradeColEnd!==-1){for(let g=gradeColStart;g<gradeColEnd&&g<cols.length;g++){const gr=parseInt(cols[g]);if(cols[g]!==""&&!isNaN(gr)&&gr===0)backlogs++;}}
    if(backlogIdx!==-1){const rb=parseInt(cols[backlogIdx]);if(!isNaN(rb))backlogs=rb;}
    const roll=rollIdx!==-1&&cols[rollIdx]?cols[rollIdx]:"-";
    if(roll!=="-"&&roll.length<3&&!/\d/.test(roll))continue;
    const rawA=activeBacklogIdx!==-1?parseInt(cols[activeBacklogIdx]):backlogs;
    students.push({id:i,name:nameIdx!==-1&&cols[nameIdx]?cols[nameIdx]:"Student "+(students.length+1),roll,cgpa,backlogs,activeBacklogs:isNaN(rawA)?backlogs:Math.min(rawA,backlogs),branch:branchIdx!==-1&&cols[branchIdx]?cols[branchIdx]:(meta?.branch||"General"),semester:semIdx!==-1&&cols[semIdx]?cols[semIdx]:(meta?.semester||"-"),section:sectionIdx!==-1&&cols[sectionIdx]?cols[sectionIdx]:(meta?.section||"-")});
  }
  return students.length>0?students:null;
}

function parseCSVText(t){const d=detectDelimiter(t);return normalizeRows(t.trim().split("\n").filter(Boolean).map(r=>r.split(d).map(c=>c.trim())),null);}
function parseXLSX(buf){try{const wb=XLSX.read(buf,{type:"array"});return normalizeRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1}),null);}catch{return null;}}

// ═══ SMART PDF PARSER - per-row pattern detection ═══
async function parsePDFSpatial(buf){
  const pdfjsLib=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
  const pdf=await pdfjsLib.getDocument({data:new Uint8Array(buf)}).promise;
  let meta={branch:"General",semester:"-",section:"-"};
  let headerRow=null;
  const students=[];

  // We use X-position based column snapping from the header
  let headerXPositions=null; // [{x, label}]

  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p);
    const tc=await page.getTextContent();
    const vp=page.getViewport({scale:1});
    const yB={};
    tc.items.forEach(item=>{
      if(!item.str.trim())return;
      const y=Math.round(vp.height-item.transform[5]);
      const x=Math.round(item.transform[4]);
      let bY=y;
      for(const ey of Object.keys(yB).map(Number)){if(Math.abs(ey-y)<=4){bY=ey;break;}}
      if(!yB[bY])yB[bY]=[];
      yB[bY].push({x,text:item.str.trim()});
    });

    const sortedYs=Object.keys(yB).map(Number).sort((a,b)=>a-b);
    for(const y of sortedYs){
      const items=yB[y].sort((a,b)=>a.x-b.x);
      const rowText=items.map(i=>i.text).join(" ");
      const low=rowText.toLowerCase();

      // Extract metadata
      if(low.includes("dept:")){const m=rowText.match(/dept\s*:\s*(\w+)/i);if(m)meta.branch=m[1].toUpperCase();}
      if(low.includes("year:")){const m=rowText.match(/year\s*:\s*([\w\s-]+)/i);if(m)meta.semester=m[1].trim();}

      // Detect header row
      if(!headerRow&&(low.includes("roll")||low.includes("s.no"))&&(low.includes("sgpa")||low.includes("cgpa"))){
        headerRow=items.map(i=>i.text);
        headerXPositions=items.map(i=>({x:i.x,label:i.text.toLowerCase()}));
        continue;
      }

      // Skip non-data
      if(low.includes("institute")||low.includes("autonomous")||low.includes("results")||low.includes("academic year")||low.includes("**")||low.includes("constitution")||low.includes("software eng")||low.includes("web prog")||low.includes("cyber")||low.includes("internet of")||low.includes("artificial")||low.includes("data science")||low.includes("lab using")||low.includes("through moocs")||items.length<3)continue;

      // === PER-ROW SMART PARSING ===
      // Find roll number: alphanumeric 8+ chars matching college pattern
      let rollNo=null, rollItemIdx=-1;
      for(let idx=0;idx<items.length;idx++){
        const t=items[idx].text;
        if(/^\d{5,}[A-Z0-9]*$/i.test(t)||/^[A-Z0-9]{8,}$/i.test(t)){
          rollNo=t;rollItemIdx=idx;break;
        }
      }
      if(!rollNo)continue;

      // Find SGPA: rightmost DECIMAL number (has ".") that is <= 10
      // Find Credits: rightmost INTEGER >= 10
      let sgpa=null,sgpaIdx=-1,credits=null,creditsIdx=-1;
      for(let idx=items.length-1;idx>rollItemIdx;idx--){
        const t=items[idx].text;
        const v=parseFloat(t);
        if(isNaN(v))continue;
        if(creditsIdx===-1&&!t.includes(".")&&v>=10&&v<=30){creditsIdx=idx;credits=v;continue;}
        if(sgpaIdx===-1&&t.includes(".")&&v>0&&v<=10){sgpaIdx=idx;sgpa=v;break;}
      }
      if(sgpa===null)continue;

      // Count backlogs: all "0" values between roll and SGPA
      let backlogs=0;
      for(let idx=rollItemIdx+1;idx<sgpaIdx;idx++){
        const t=items[idx].text;
        if(t==="0")backlogs++;
      }

      students.push({
        id:students.length+1,
        name:"Student "+(students.length+1),
        roll:rollNo,
        cgpa:Math.round(sgpa*100)/100,
        backlogs,
        activeBacklogs:backlogs,
        branch:meta.branch,
        semester:meta.semester,
        section:meta.section,
      });
    }
  }
  return students.length>0?students:null;
}

const SAMPLE=[
  {id:1,name:"Aarav Sharma",roll:"21CS101",cgpa:9.72,backlogs:0,activeBacklogs:0,branch:"CSE",semester:"6",section:"A"},
  {id:2,name:"Priya Reddy",roll:"21CS102",cgpa:9.41,backlogs:0,activeBacklogs:0,branch:"CSE",semester:"6",section:"A"},
  {id:3,name:"Rohit Kumar",roll:"21EC201",cgpa:9.15,backlogs:0,activeBacklogs:0,branch:"ECE",semester:"6",section:"B"},
  {id:4,name:"Sneha Patel",roll:"21ME301",cgpa:8.83,backlogs:0,activeBacklogs:0,branch:"ME",semester:"6",section:"A"},
  {id:5,name:"Vikram Singh",roll:"21CS103",cgpa:8.56,backlogs:1,activeBacklogs:0,branch:"CSE",semester:"6",section:"B"},
  {id:6,name:"Ananya Iyer",roll:"21EC202",cgpa:8.22,backlogs:0,activeBacklogs:0,branch:"ECE",semester:"6",section:"A"},
  {id:7,name:"Karthik Nair",roll:"21CS104",cgpa:7.89,backlogs:1,activeBacklogs:1,branch:"CSE",semester:"6",section:"A"},
  {id:8,name:"Divya Joshi",roll:"21ME302",cgpa:7.45,backlogs:2,activeBacklogs:1,branch:"ME",semester:"6",section:"B"},
  {id:9,name:"Arjun Menon",roll:"21EC203",cgpa:6.91,backlogs:3,activeBacklogs:2,branch:"ECE",semester:"6",section:"B"},
  {id:10,name:"Meera Gupta",roll:"21CS105",cgpa:6.34,backlogs:2,activeBacklogs:2,branch:"CSE",semester:"6",section:"B"},
  {id:11,name:"Suresh Yadav",roll:"21ME303",cgpa:5.78,backlogs:4,activeBacklogs:3,branch:"ME",semester:"6",section:"A"},
  {id:12,name:"Lakshmi Rao",roll:"21EC204",cgpa:5.12,backlogs:5,activeBacklogs:4,branch:"ECE",semester:"6",section:"A"},
  {id:13,name:"Naveen Prasad",roll:"21CS106",cgpa:4.56,backlogs:6,activeBacklogs:5,branch:"CSE",semester:"6",section:"A"},
  {id:14,name:"Pooja Kumari",roll:"21ME304",cgpa:3.89,backlogs:8,activeBacklogs:6,branch:"ME",semester:"6",section:"B"},
  {id:15,name:"Ravi Teja",roll:"21EC205",cgpa:3.21,backlogs:10,activeBacklogs:8,branch:"ECE",semester:"6",section:"B"},
];

function CgpaChart({students}){const ref=useRef();useEffect(()=>{if(!ref.current||!students.length)return;const el=ref.current;el.innerHTML="";const W=el.clientWidth,H=210;const bins=[0,0,0,0,0,0,0,0,0,0];students.forEach(s=>{bins[Math.min(Math.floor(s.cgpa),9)]++});const mx=Math.max(...bins,1);const svg=d3.select(el).append("svg").attr("width",W).attr("height",H);const bW=(W-60)/10;const cl=["#F43F5E","#EF4444","#F97316","#FB923C","#FBBF24","#84CC16","#22C55E","#14B8A6","#3B82F6","#8B5CF6"];bins.forEach((v,i)=>{const bH=(v/mx)*148;svg.append("rect").attr("x",40+i*bW+4).attr("y",H-38-bH).attr("width",bW-8).attr("height",bH).attr("rx",4).attr("fill",cl[i]).attr("opacity",0.85);if(v>0)svg.append("text").attr("x",40+i*bW+bW/2).attr("y",H-42-bH).attr("text-anchor","middle").attr("font-size",11).attr("font-weight",600).attr("fill","#E2E8F0").text(v);svg.append("text").attr("x",40+i*bW+bW/2).attr("y",H-16).attr("text-anchor","middle").attr("font-size",10).attr("fill","#64748B").text(i+"-"+(i+1))});svg.append("text").attr("x",W/2).attr("y",H-2).attr("text-anchor","middle").attr("font-size",10).attr("fill","#64748B").text("SGPA Range")},[students]);return<div ref={ref} style={{width:"100%",minHeight:210}}/>;}
function BacklogChart({students}){const ref=useRef();useEffect(()=>{if(!ref.current||!students.length)return;const el=ref.current;el.innerHTML="";const W=el.clientWidth,H=210;const g={};students.forEach(s=>{const k=s.backlogs>=5?"5+":String(s.backlogs);g[k]=(g[k]||0)+1});const keys=["0","1","2","3","4","5+"].filter(k=>g[k]);const mx=Math.max(...Object.values(g),1);const svg=d3.select(el).append("svg").attr("width",W).attr("height",H);const bW=Math.min((W-60)/keys.length,65);const sx=(W-keys.length*bW)/2;const cl={"0":"#22C55E","1":"#FBBF24","2":"#F97316","3":"#EF4444","4":"#DC2626","5+":"#F43F5E"};keys.forEach((k,i)=>{const v=g[k],bH=(v/mx)*148;svg.append("rect").attr("x",sx+i*bW+5).attr("y",H-38-bH).attr("width",bW-10).attr("height",bH).attr("rx",4).attr("fill",cl[k]||"#64748B").attr("opacity",0.85);if(v>0)svg.append("text").attr("x",sx+i*bW+bW/2).attr("y",H-42-bH).attr("text-anchor","middle").attr("font-size",11).attr("font-weight",600).attr("fill","#E2E8F0").text(v);svg.append("text").attr("x",sx+i*bW+bW/2).attr("y",H-16).attr("text-anchor","middle").attr("font-size",10).attr("fill","#64748B").text(k==="0"?"None":k)});svg.append("text").attr("x",W/2).attr("y",H-2).attr("text-anchor","middle").attr("font-size",10).attr("fill","#64748B").text("Backlogs Count")},[students]);return<div ref={ref} style={{width:"100%",minHeight:210}}/>;}

const T={bg:"radial-gradient(ellipse at 50% 0%,#1e1b4b 0%,#0f172a 60%,#020617 100%)",surface:"rgba(30,41,59,0.45)",surfaceSolid:"#1E293B",headerBg:"rgba(15,23,42,0.7)",headerText:"#F8FAFC",border:"rgba(255,255,255,0.1)",text:"#F1F5F9",muted:"#94A3B8",accent:"#8B5CF6",accentLight:"rgba(139,92,246,0.15)",green:"#10B981",red:"#EF4444",warm:"#F59E0B",row1:"transparent",row2:"rgba(255,255,255,0.02)"};
const thS={padding:"13px 14px",textAlign:"left",fontSize:10,fontWeight:700,color:"#94A3B8",letterSpacing:"0.5px",textTransform:"uppercase",whiteSpace:"nowrap"};
const tdS={padding:"13px 14px",fontSize:13,whiteSpace:"nowrap"};
const GLASS={background:T.surface,backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",border:"1px solid "+T.border};

function Logo({size=44}){return(<svg width={size} height={size} viewBox="0 0 44 44" fill="none"><rect width="44" height="44" rx="10" fill="url(#lg1)"/><path d="M11 14L11 30L14 30L14 24L18 24C21.5 24 24 22 24 19C24 16 21.5 14 18 14ZM14 17L17.5 17C19.5 17 21 18 21 19C21 20 19.5 21 17.5 21L14 21Z" fill="#fff" opacity="0.95"/><rect x="26" y="14" width="3" height="16" rx="1.5" fill="#fff" opacity="0.7"/><rect x="31" y="18" width="3" height="12" rx="1.5" fill="#fff" opacity="0.55"/><rect x="20" y="26" width="3" height="4" rx="1" fill="#fff" opacity="0.5"/><defs><linearGradient id="lg1" x1="0" y1="0" x2="44" y2="44"><stop stopColor="#8B5CF6"/><stop offset="1" stopColor="#C084FC"/></linearGradient></defs></svg>);}
function UploadIcon(){return(<svg width="68" height="68" viewBox="0 0 68 68" fill="none" style={{margin:"0 auto 16px",display:"block"}}><rect x="10" y="14" width="48" height="40" rx="6" stroke="rgba(255,255,255,0.35)" strokeWidth="1.8" fill="none"/><path d="M34 24L34 42" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round"/><path d="M27 31L34 24L41 31" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><rect x="16" y="10" width="14" height="3" rx="1.5" fill="rgba(255,255,255,0.5)"/><rect x="38" y="10" width="14" height="3" rx="1.5" fill="rgba(255,255,255,0.5)"/><path d="M18 48L50 48" stroke="rgba(255,255,255,0.3)" strokeWidth="1.2" strokeLinecap="round"/></svg>);}

export default function App(){
  const [page,setPage]=useState("landing");
  const [students,setStudents]=useState([]);
  const [fileName,setFileName]=useState("");
  const [fileReady,setFileReady]=useState(false);
  const [uploadError,setUploadError]=useState("");
  const [isDrag,setIsDrag]=useState(false);
  const [isProcessing,setIsProcessing]=useState(false);
  const [processingMsg,setProcessingMsg]=useState("");
  const fileRef=useRef();
  const [search,setSearch]=useState("");
  const [sortField,setSortField]=useState("cgpa");
  const [sortDir,setSortDir]=useState("desc");
  const [branchFilter,setBranchFilter]=useState("All");
  const [sectionFilter,setSectionFilter]=useState("All");
  const [backlogFilter,setBacklogFilter]=useState("All");
  const [tab,setTab]=useState("table");
  const [selectedId,setSelectedId]=useState(null);
  const [groupBySection,setGroupBySection]=useState(false);
  const detailRef=useRef(null);

  const isUnfiltered=search===""&&branchFilter==="All"&&sectionFilter==="All"&&backlogFilter==="All";
  const showRanks=isUnfiltered&&sortField==="cgpa"&&sortDir==="desc";
  const branches=useMemo(()=>["All",...Array.from(new Set(students.map(s=>s.branch))).sort()],[students]);
  const sections=useMemo(()=>["All",...Array.from(new Set(students.map(s=>s.section))).sort()],[students]);

  const filtered=useMemo(()=>{
    let list=[...students];
    if(search){const q=search.toLowerCase();list=list.filter(s=>s.name.toLowerCase().includes(q)||s.roll.toLowerCase().includes(q)||s.branch.toLowerCase().includes(q)||s.section.toLowerCase().includes(q)||String(s.cgpa).includes(q));}
    if(branchFilter!=="All")list=list.filter(s=>s.branch===branchFilter);
    if(sectionFilter!=="All")list=list.filter(s=>s.section===sectionFilter);
    if(backlogFilter==="None")list=list.filter(s=>s.backlogs===0);
    else if(backlogFilter==="Has")list=list.filter(s=>s.backlogs>0);
    else if(backlogFilter==="Active")list=list.filter(s=>s.activeBacklogs>0);
    list.sort((a,b)=>{let c=0;if(sortField==="cgpa")c=a.cgpa-b.cgpa;else if(sortField==="name")c=a.name.localeCompare(b.name);else if(sortField==="roll")c=a.roll.localeCompare(b.roll);else if(sortField==="backlogs")c=a.backlogs-b.backlogs;else if(sortField==="branch")c=a.branch.localeCompare(b.branch);else if(sortField==="section")c=a.section.localeCompare(b.section);return sortDir==="desc"?-c:c;});
    return list;
  },[students,search,sortField,sortDir,branchFilter,sectionFilter,backlogFilter]);

  const groupedBySection=useMemo(()=>{if(!groupBySection)return null;const g={};filtered.forEach(s=>{const k=s.branch+" \u2014 Section "+s.section;if(!g[k])g[k]=[];g[k].push(s)});return g;},[filtered,groupBySection]);

  const stats=useMemo(()=>{if(!students.length)return null;const cg=students.map(s=>s.cgpa);const sm=cg.reduce((a,b)=>a+b,0);return{total:students.length,avg:(sm/cg.length).toFixed(2),highest:Math.max(...cg).toFixed(2),lowest:Math.min(...cg).toFixed(2),above8:students.filter(s=>s.cgpa>=8).length,above9:students.filter(s=>s.cgpa>=9).length,below5:students.filter(s=>s.cgpa<5).length,zeroBacklog:students.filter(s=>s.backlogs===0).length,hasBacklog:students.filter(s=>s.backlogs>0).length,totalBacklogs:students.reduce((a,s)=>a+s.backlogs,0),totalActive:students.reduce((a,s)=>a+s.activeBacklogs,0),passRate:((students.filter(s=>s.cgpa>=5).length/students.length)*100).toFixed(1)};},[students]);

  useEffect(()=>{if(selectedId&&detailRef.current){setTimeout(()=>detailRef.current?.scrollIntoView({behavior:"smooth",block:"center"}),50);}},[selectedId]);

  const processFile=async(file)=>{
    if(!file)return;setUploadError("");setFileReady(false);setIsProcessing(true);setFileName(file.name);setProcessingMsg("Reading file...");
    const ext=file.name.split(".").pop().toLowerCase();
    try{
      if(ext==="csv"||ext==="tsv"||ext==="txt"){const text=await file.text();const data=parseCSVText(text);if(!data){setUploadError("Could not parse. Ensure it has Roll No and SGPA/CGPA columns.");setIsProcessing(false);return;}setStudents(data);setFileReady(true);}
      else if(ext==="xlsx"||ext==="xls"||ext==="xlsm"){setProcessingMsg("Parsing spreadsheet...");const buf=await file.arrayBuffer();const data=parseXLSX(buf);if(!data){setUploadError("Could not parse spreadsheet.");setIsProcessing(false);return;}setStudents(data);setFileReady(true);}
      else if(ext==="pdf"){setProcessingMsg("Extracting data from PDF...");const buf=await file.arrayBuffer();const data=await parsePDFSpatial(buf);if(!data){setUploadError("Could not extract data from PDF.");setIsProcessing(false);return;}setStudents(data);setFileReady(true);}
      else setUploadError("Unsupported format. Upload CSV, XLS, XLSX, or PDF.");
    }catch(err){console.error(err);setUploadError("Failed: "+(err.message||"Unknown error"));}
    setIsProcessing(false);setProcessingMsg("");
  };

  const handleDrop=e=>{e.preventDefault();setIsDrag(false);processFile(e.dataTransfer.files[0]);};
  const showResults=()=>{setPage("dashboard");setSearch("");setBranchFilter("All");setSectionFilter("All");setBacklogFilter("All");setSortField("cgpa");setSortDir("desc");setTab("table");setSelectedId(null);setGroupBySection(false);};
  const goHome=()=>{setPage("landing");setStudents([]);setFileReady(false);setFileName("");setUploadError("");};
  const loadDemo=()=>{setStudents(SAMPLE);setFileReady(true);setFileName("sample_demo_data.csv");};
  const toggleSort=f=>{if(sortField===f)setSortDir(d=>d==="desc"?"asc":"desc");else{setSortField(f);setSortDir(f==="cgpa"||f==="backlogs"?"desc":"asc");}};
  const Arrow=({field})=>sortField!==field?<span style={{opacity:0.3,fontSize:10,marginLeft:4}}>{"\u21C5"}</span>:<span style={{fontSize:10,marginLeft:4,color:T.accent}}>{sortDir==="desc"?"\u25BC":"\u25B2"}</span>;
  const exportCSV=()=>{const h="Rank,Name,Roll No,Branch,Section,SGPA,Backlogs,Active Backlogs,Performance\n";const sorted=[...students].sort((a,b)=>b.cgpa-a.cgpa);const rows=sorted.map((s,i)=>(i+1)+',"'+s.name+'","'+s.roll+'","'+s.branch+'","'+s.section+'",'+s.cgpa+','+s.backlogs+','+s.activeBacklogs+',"'+getPointInfo(s.cgpa).label+'"').join("\n");const blob=new Blob([h+rows],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="student_results_ranked.csv";a.click();};

  const renderTable=data=>{
    const canRank=showRanks&&!groupBySection;
    const tableRows=[];
    data.forEach((s,i)=>{
      const pi=getPointInfo(s.cgpa);const num=i+1;const isTop3=canRank&&num<=3;
      const rc3={1:{bg:"rgba(251,191,36,0.15)",text:"#FBBF24",border:"rgba(251,191,36,0.4)"},2:{bg:"rgba(148,163,184,0.12)",text:"#CBD5E1",border:"rgba(148,163,184,0.3)"},3:{bg:"rgba(251,146,60,0.12)",text:"#FB923C",border:"rgba(251,146,60,0.3)"}};
      const rc=isTop3?rc3[num]:null;const isSel=selectedId===s.id;
      tableRows.push(
        <tr key={s.id} onClick={()=>setSelectedId(isSel?null:s.id)} style={{background:isSel?T.accentLight:i%2===0?T.row1:T.row2,borderBottom:"1px solid "+T.border,cursor:"pointer",transition:"background 0.15s"}} onMouseEnter={e=>{if(!isSel)e.currentTarget.style.background="rgba(139,92,246,0.08)"}} onMouseLeave={e=>{if(!isSel)e.currentTarget.style.background=i%2===0?T.row1:T.row2}}>
          <td style={{...tdS,textAlign:"center"}}>{rc?<span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:30,height:30,borderRadius:6,fontWeight:800,fontSize:13,background:rc.bg,color:rc.text,border:"1.5px solid "+rc.border}}>{num}</span>:<span style={{color:T.muted,fontWeight:600,fontSize:13}}>{num}</span>}</td>
          <td style={{...tdS,fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:T.text,fontWeight:600}}>{s.roll}</td>
          <td style={{...tdS,fontWeight:600,color:T.text}}>{s.name}</td>
          <td style={tdS}><span style={{padding:"4px 10px",borderRadius:4,fontSize:11,fontWeight:600,background:"rgba(139,92,246,0.12)",color:"#C4B5FD",border:"1px solid rgba(139,92,246,0.2)"}}>{s.branch}</span></td>
          <td style={{...tdS,textAlign:"center"}}><span style={{padding:"4px 10px",borderRadius:4,fontSize:11,fontWeight:600,background:"rgba(96,165,250,0.12)",color:"#93C5FD"}}>{s.section}</span></td>
          <td style={tdS}><span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:15,color:pi.color}}>{s.cgpa.toFixed(2)}</span></td>
          <td style={tdS}>{s.backlogs===0?<span style={{color:T.green,fontWeight:600,fontSize:12}}>Clear</span>:<span><span style={{color:T.red,fontWeight:700}}>{s.backlogs}</span>{s.activeBacklogs>0&&<span style={{fontSize:11,color:T.warm,fontWeight:600,marginLeft:5}}>({s.activeBacklogs} active)</span>}</span>}</td>
          <td style={tdS}><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:64,height:5,background:"rgba(255,255,255,0.08)",borderRadius:3,overflow:"hidden",flexShrink:0}}><div style={{width:Math.min(s.cgpa*10,100)+"%",height:"100%",borderRadius:3,background:pi.color,opacity:0.7,transition:"width 0.4s"}}/></div><span style={{fontSize:10,fontWeight:600,color:pi.color,whiteSpace:"nowrap"}}>{pi.label}</span></div></td>
        </tr>
      );
      if(isSel)tableRows.push(<tr key={"d-"+s.id}><td colSpan={9} style={{padding:0,border:"none"}}><div ref={detailRef} style={{padding:20,background:"rgba(139,92,246,0.08)",borderTop:"2px solid rgba(139,92,246,0.3)",borderBottom:"2px solid rgba(139,92,246,0.15)",backdropFilter:"blur(12px)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
          <div><span style={{fontSize:16,fontWeight:800,color:T.text}}>{s.name}</span><span style={{fontSize:13,color:T.muted,marginLeft:12}}>{s.roll} | {s.branch} | Section {s.section} | Semester {s.semester}</span></div>
          <button onClick={e=>{e.stopPropagation();setSelectedId(null)}} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:6,padding:"5px 14px",color:T.muted,cursor:"pointer",fontSize:12,fontFamily:"inherit",fontWeight:600}}>Dismiss</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:10}}>
          {[{l:"SGPA",v:s.cgpa.toFixed(2),c:T.accent},{l:"Performance",v:pi.label,c:pi.color},{l:"Total Backlogs",v:String(s.backlogs),c:s.backlogs>0?T.red:T.green},{l:"Active Backlogs",v:String(s.activeBacklogs),c:s.activeBacklogs>0?T.red:T.green}].map(d=>(
            <div key={d.l} style={{padding:"12px 14px",borderRadius:8,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderLeft:"4px solid "+d.c}}><div style={{fontSize:18,fontWeight:800,color:d.c,fontFamily:"'JetBrains Mono',monospace"}}>{d.v}</div><div style={{fontSize:11,color:T.text,marginTop:3,fontWeight:600}}>{d.l}</div></div>
          ))}
        </div>
      </div></td></tr>);
    });
    return(<table style={{width:"100%",borderCollapse:"collapse",minWidth:780}}><thead><tr style={{background:"rgba(15,23,42,0.5)",borderBottom:"2px solid "+T.border}}>
      <th style={{...thS,width:56}}>{canRank?"Rank":"S.No"}</th>
      {[{f:"roll",l:"Roll No"},{f:"name",l:"Student Name"},{f:"branch",l:"Branch"},{f:"section",l:"Section"},{f:"cgpa",l:"SGPA/CGPA"},{f:"backlogs",l:"Backlogs"}].map(({f,l})=>(<th key={f} onClick={()=>toggleSort(f)} style={{...thS,cursor:"pointer",userSelect:"none"}}>{l}<Arrow field={f}/></th>))}
      <th style={thS}>Performance</th>
    </tr></thead><tbody>{data.length===0?<tr><td colSpan={9} style={{padding:56,textAlign:"center",color:T.muted}}>No students match filters.</td></tr>:tableRows}</tbody></table>);
  };

  if(page==="landing"){return(
    <div style={{fontFamily:"'Outfit','Segoe UI',sans-serif",minHeight:"100vh",background:T.bg,color:T.text}}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet"/>
      <style>{`*,*::before,*::after{box-sizing:border-box}body{margin:0}@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}.fu{animation:fadeUp 0.45s ease both}.fu1{animation:fadeUp 0.45s ease 0.08s both}.fu2{animation:fadeUp 0.45s ease 0.16s both}.fu3{animation:fadeUp 0.45s ease 0.24s both}.fu4{animation:fadeUp 0.45s ease 0.32s both}`}</style>
      <div style={{maxWidth:700,margin:"0 auto",padding:"64px 24px 48px",textAlign:"center"}}>
        <div className="fu" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:14,marginBottom:10}}><Logo size={52}/><h1 style={{fontSize:28,fontWeight:800,margin:0,color:T.headerText}}>Student Results Manager</h1></div>
        <p className="fu1" style={{fontSize:13,color:T.accent,fontWeight:600,margin:"0 0 28px"}}>Simplifying result analysis for educators</p>
        <p className="fu2" style={{fontSize:15,color:T.muted,lineHeight:1.7,maxWidth:560,margin:"0 auto 40px"}}>Upload your class results in any format and instantly get students ranked by SGPA/CGPA in descending order. Track backlogs, filter by branch and section, view analytics, and export clean ranked data. Designed to save time for faculty members.</p>
        <div className="fu3" onDragOver={e=>{e.preventDefault();setIsDrag(true)}} onDragLeave={()=>setIsDrag(false)} onDrop={handleDrop} onClick={()=>fileRef.current?.click()}
          style={{...GLASS,border:"2px dashed "+(isDrag?"rgba(139,92,246,0.6)":"rgba(255,255,255,0.15)"),borderRadius:16,padding:"44px 24px",cursor:"pointer",background:isDrag?"rgba(139,92,246,0.1)":T.surface,transition:"all 0.25s",maxWidth:520,margin:"0 auto 20px",boxShadow:"0 8px 32px rgba(0,0,0,0.3)"}}>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.pdf" style={{display:"none"}} onChange={e=>processFile(e.target.files[0])}/>
          <UploadIcon/><p style={{fontSize:15,fontWeight:700,margin:"0 0 6px",color:T.text}}>{isDrag?"Drop the file here":"Drag and drop your file here, or click to browse"}</p>
          <p style={{fontSize:12,color:T.muted,margin:0}}>Supports CSV, XLS, XLSX, and PDF formats</p>
        </div>
        {isProcessing&&<p className="fu" style={{color:T.accent,fontWeight:600,fontSize:14,margin:"16px 0"}}>{processingMsg}</p>}
        {uploadError&&<div className="fu" style={{...GLASS,background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:10,padding:"12px 16px",margin:"16px auto",maxWidth:520}}><p style={{color:T.red,fontWeight:600,fontSize:13,margin:0}}>{uploadError}</p></div>}
        {fileReady&&!uploadError&&(<div className="fu" style={{margin:"20px auto",maxWidth:520}}>
          <div style={{...GLASS,background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:10,padding:"12px 16px",marginBottom:16}}><p style={{color:T.green,fontWeight:600,fontSize:13,margin:0}}>{fileName} — {students.length} students loaded</p></div>
          <button onClick={showResults} style={{background:"linear-gradient(135deg,#8B5CF6,#7C3AED)",color:"#fff",border:"none",padding:"14px 44px",borderRadius:10,fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 20px rgba(139,92,246,0.4)",transition:"transform 0.2s"}} onMouseEnter={e=>e.target.style.transform="scale(1.03)"} onMouseLeave={e=>e.target.style.transform="scale(1)"}>Show Results</button>
        </div>)}
        <p className="fu4" style={{fontSize:13,color:T.muted,marginTop:24}}>No file yet? <span onClick={loadDemo} style={{color:T.accent,fontWeight:600,cursor:"pointer",textDecoration:"underline"}}>Load sample data</span></p>
        <div className="fu4" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12,marginTop:48,textAlign:"left"}}>
          {[{t:"Auto-Ranked Results",d:"Students sorted by SGPA/CGPA highest to lowest with ranks."},{t:"Backlog Detection",d:"Detects 0-grade subjects as backlogs from PDF grade sheets."},{t:"Branch and Section Filters",d:"Filter and group results by branch, section, backlog status."},{t:"Analytics Dashboard",d:"SGPA distribution, backlog charts, section-wise summaries."},{t:"Multi-Format Support",d:"Upload CSV, Excel, or university PDF with auto-detection."},{t:"Export Ranked Data",d:"Download complete ranked results as CSV."}].map(f=>(<div key={f.t} style={{...GLASS,borderRadius:12,padding:"16px 18px",boxShadow:"0 4px 16px rgba(0,0,0,0.2)"}}><h4 style={{margin:"0 0 6px",fontSize:13,fontWeight:700,color:T.text}}>{f.t}</h4><p style={{margin:0,fontSize:12,color:T.muted,lineHeight:1.6}}>{f.d}</p></div>))}
        </div>
      </div>
    </div>
  );}

  return(
    <div style={{fontFamily:"'Outfit','Segoe UI',sans-serif",minHeight:"100vh",background:T.bg,color:T.text}}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet"/>
      <style>{`*,*::before,*::after{box-sizing:border-box}body{margin:0}::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:3px}::-webkit-scrollbar-track{background:transparent}@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.fu{animation:fadeUp 0.3s ease both}input::placeholder{color:#64748B}select{color:${T.text}}select option{background:${T.surfaceSolid};color:${T.text}}`}</style>
      <div style={{...GLASS,background:T.headerBg,borderBottom:"1px solid rgba(139,92,246,0.3)",padding:"16px 28px",borderRadius:0}}>
        <div style={{maxWidth:1280,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:12,cursor:"pointer"}} onClick={goHome}><Logo size={36}/><h1 style={{fontSize:18,fontWeight:800,margin:0,color:T.headerText}}>Student Results Manager</h1></div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontSize:12,color:T.muted}}>{fileName} ({students.length})</span>
            <button onClick={exportCSV} style={{background:"rgba(139,92,246,0.15)",color:"#C4B5FD",border:"1px solid rgba(139,92,246,0.3)",padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>Export</button>
            <button onClick={goHome} style={{background:"rgba(255,255,255,0.05)",color:T.muted,border:"1px solid "+T.border,padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>Upload New</button>
          </div>
        </div>
      </div>
      <div style={{maxWidth:1280,margin:"0 auto",padding:"20px 20px 48px"}}>
        {stats&&(<div className="fu" style={{marginBottom:20}}><div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.6px",marginBottom:8}}>Overview</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(152px,1fr))",gap:10}}>
            {[{l:"Total Students",v:stats.total,c:T.accent},{l:"Average SGPA",v:stats.avg,c:"#06B6D4"},{l:"Highest SGPA",v:stats.highest,c:T.green},{l:"Lowest SGPA",v:stats.lowest,c:T.red},{l:"SGPA 9.0+",v:stats.above9,c:"#A78BFA"},{l:"SGPA 8.0+",v:stats.above8,c:"#60A5FA"},{l:"Zero Backlogs",v:stats.zeroBacklog,c:T.green},{l:"With Backlogs",v:stats.hasBacklog,c:T.red},{l:"Total Backlogs",v:stats.totalBacklogs,c:T.warm},{l:"Active Backlogs",v:stats.totalActive,c:"#EF4444"},{l:"Pass Rate",v:stats.passRate+"%",c:"#10B981"},{l:"At Risk (<5.0)",v:stats.below5,c:"#F43F5E"}].map(s=>(
              <div key={s.l} style={{...GLASS,borderRadius:10,padding:"14px",borderLeft:"3px solid "+s.c,boxShadow:"0 4px 12px rgba(0,0,0,0.15)"}}><div style={{fontSize:22,fontWeight:800,color:s.c,fontFamily:"'JetBrains Mono',monospace",lineHeight:1}}>{s.v}</div><div style={{fontSize:11,color:T.muted,fontWeight:500,marginTop:5}}>{s.l}</div></div>
            ))}
          </div></div>)}
        <div style={{display:"flex",gap:0,marginBottom:16,borderBottom:"1px solid "+T.border}}>
          {[{key:"table",label:"Rankings"},{key:"analytics",label:"Analytics"}].map(t=>(<button key={t.key} onClick={()=>setTab(t.key)} style={{padding:"10px 28px",border:"none",borderBottom:tab===t.key?"2px solid "+T.accent:"2px solid transparent",background:"transparent",color:tab===t.key?T.accent:T.muted,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",marginBottom:-1}}>{t.label}</button>))}
        </div>

        {tab==="analytics"&&(<div className="fu" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(340px,1fr))",gap:14}}>
          <div style={{...GLASS,borderRadius:12,padding:20,boxShadow:"0 4px 16px rgba(0,0,0,0.2)"}}><h3 style={{margin:"0 0 10px",fontSize:13,fontWeight:700,color:T.text,textTransform:"uppercase",letterSpacing:"0.4px"}}>SGPA Distribution</h3><CgpaChart students={students}/></div>
          <div style={{...GLASS,borderRadius:12,padding:20,boxShadow:"0 4px 16px rgba(0,0,0,0.2)"}}><h3 style={{margin:"0 0 10px",fontSize:13,fontWeight:700,color:T.text,textTransform:"uppercase",letterSpacing:"0.4px"}}>Backlog Distribution</h3><BacklogChart students={students}/></div>
          <div style={{...GLASS,borderRadius:12,padding:20,gridColumn:"1/-1",boxShadow:"0 4px 16px rgba(0,0,0,0.2)"}}>
            <h3 style={{margin:"0 0 12px",fontSize:13,fontWeight:700,color:T.text,textTransform:"uppercase",letterSpacing:"0.4px"}}>Section-wise Summary</h3>
            <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}><thead><tr style={{borderBottom:"1px solid "+T.border}}>
              {["Branch","Section","Students","Avg SGPA","Highest","Lowest","Clear","With Backlogs","Total Backlogs","Pass Rate"].map(h=>(<th key={h} style={{padding:"10px 12px",textAlign:"left",fontWeight:700,color:T.muted,fontSize:10,textTransform:"uppercase"}}>{h}</th>))}
            </tr></thead><tbody>{(()=>{const c={};students.forEach(s=>{const k=s.branch+"||"+s.section;if(!c[k])c[k]={branch:s.branch,section:s.section,list:[]};c[k].list.push(s)});return Object.values(c).sort((a,b)=>a.branch.localeCompare(b.branch)||a.section.localeCompare(b.section)).map(g=>(
              <tr key={g.branch+g.section} style={{borderBottom:"1px solid "+T.border}}>
                <td style={{padding:"10px 12px",fontWeight:600}}>{g.branch}</td><td style={{padding:"10px 12px"}}><span style={{padding:"2px 8px",borderRadius:4,background:"rgba(96,165,250,0.12)",color:"#93C5FD",fontWeight:600,fontSize:12}}>{g.section}</span></td>
                <td style={{padding:"10px 12px"}}>{g.list.length}</td><td style={{padding:"10px 12px",fontFamily:"'JetBrains Mono',monospace",fontWeight:600,color:T.accent}}>{(g.list.reduce((a,s)=>a+s.cgpa,0)/g.list.length).toFixed(2)}</td>
                <td style={{padding:"10px 12px",color:T.green,fontWeight:600}}>{Math.max(...g.list.map(s=>s.cgpa)).toFixed(2)}</td><td style={{padding:"10px 12px",color:T.red,fontWeight:600}}>{Math.min(...g.list.map(s=>s.cgpa)).toFixed(2)}</td>
                <td style={{padding:"10px 12px",color:T.green}}>{g.list.filter(s=>s.backlogs===0).length}</td><td style={{padding:"10px 12px",color:T.red}}>{g.list.filter(s=>s.backlogs>0).length}</td>
                <td style={{padding:"10px 12px"}}>{g.list.reduce((a,s)=>a+s.backlogs,0)}</td><td style={{padding:"10px 12px",fontWeight:600}}>{((g.list.filter(s=>s.cgpa>=5).length/g.list.length)*100).toFixed(0)}%</td>
              </tr>))})()}</tbody></table></div>
          </div>
          <div style={{...GLASS,borderRadius:12,padding:20,gridColumn:"1/-1",boxShadow:"0 4px 16px rgba(0,0,0,0.2)"}}>
            <h3 style={{margin:"0 0 12px",fontSize:13,fontWeight:700,color:T.text,textTransform:"uppercase",letterSpacing:"0.4px"}}>Branch-wise Summary</h3>
            <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}><thead><tr style={{borderBottom:"1px solid "+T.border}}>
              {["Branch","Students","Sections","Avg SGPA","Highest","Lowest","Clear","With Backlogs","Total Backlogs"].map(h=>(<th key={h} style={{padding:"10px 12px",textAlign:"left",fontWeight:700,color:T.muted,fontSize:10,textTransform:"uppercase"}}>{h}</th>))}
            </tr></thead><tbody>{branches.filter(b=>b!=="All").map(br=>{const bs=students.filter(s=>s.branch===br);return(
              <tr key={br} style={{borderBottom:"1px solid "+T.border}}><td style={{padding:"10px 12px",fontWeight:600}}>{br}</td><td style={{padding:"10px 12px"}}>{bs.length}</td><td style={{padding:"10px 12px",color:"#A78BFA"}}>{Array.from(new Set(bs.map(s=>s.section))).sort().join(", ")}</td><td style={{padding:"10px 12px",fontFamily:"'JetBrains Mono',monospace",fontWeight:600,color:T.accent}}>{(bs.reduce((a,s)=>a+s.cgpa,0)/bs.length).toFixed(2)}</td><td style={{padding:"10px 12px",color:T.green,fontWeight:600}}>{Math.max(...bs.map(s=>s.cgpa)).toFixed(2)}</td><td style={{padding:"10px 12px",color:T.red,fontWeight:600}}>{Math.min(...bs.map(s=>s.cgpa)).toFixed(2)}</td><td style={{padding:"10px 12px",color:T.green}}>{bs.filter(s=>s.backlogs===0).length}</td><td style={{padding:"10px 12px",color:T.red}}>{bs.filter(s=>s.backlogs>0).length}</td><td style={{padding:"10px 12px"}}>{bs.reduce((a,s)=>a+s.backlogs,0)}</td></tr>)})}</tbody></table></div>
          </div>
          <div style={{...GLASS,borderRadius:12,padding:20,gridColumn:"1/-1"}}><h3 style={{margin:"0 0 12px",fontSize:13,fontWeight:700,color:T.text,textTransform:"uppercase"}}>10-Point Grading Scale</h3><div style={{display:"flex",flexWrap:"wrap",gap:8}}>{POINT_SCALE.map(p=>(<div key={p.label} style={{padding:"8px 14px",borderRadius:8,background:p.bg,border:"1px solid "+p.color+"30",display:"flex",alignItems:"center",gap:8}}><span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:p.color,fontSize:13}}>{p.min===0?"<4.0":p.min+"+"}</span><span style={{fontSize:12,color:T.text,fontWeight:500}}>{p.label}</span></div>))}</div></div>
        </div>)}

        {tab==="table"&&(<>
          <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.6px",marginBottom:8}}>Filters{!isUnfiltered&&<span style={{fontWeight:500,textTransform:"none",marginLeft:8,color:T.warm,letterSpacing:0}}>(Ranks hidden — clear filters to show ranks)</span>}</div>
          <div className="fu" style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16,alignItems:"center"}}>
            <div style={{flex:"1 1 260px"}}><input type="text" placeholder="Search name, roll, branch, section, SGPA..." value={search} onChange={e=>setSearch(e.target.value)} style={{width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid "+T.border,background:"rgba(0,0,0,0.2)",color:T.text,fontSize:13,outline:"none",fontFamily:"inherit"}} onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/></div>
            {[{val:branchFilter,set:setBranchFilter,opts:branches,labels:branches.map(b=>b==="All"?"All Branches":b)},{val:sectionFilter,set:setSectionFilter,opts:sections,labels:sections.map(s=>s==="All"?"All Sections":"Section "+s)}].map((f,fi)=>(<select key={fi} value={f.val} onChange={e=>f.set(e.target.value)} style={{padding:"10px 12px",borderRadius:8,border:"1px solid "+T.border,background:"rgba(0,0,0,0.2)",color:T.text,fontSize:13,cursor:"pointer",outline:"none",fontWeight:600,fontFamily:"inherit"}}>{f.opts.map((o,oi)=><option key={o} value={o} style={{background:T.surfaceSolid}}>{f.labels[oi]}</option>)}</select>))}
            <select value={backlogFilter} onChange={e=>setBacklogFilter(e.target.value)} style={{padding:"10px 12px",borderRadius:8,border:"1px solid "+T.border,background:"rgba(0,0,0,0.2)",color:T.text,fontSize:13,cursor:"pointer",outline:"none",fontWeight:600,fontFamily:"inherit"}}><option value="All" style={{background:T.surfaceSolid}}>All Students</option><option value="None" style={{background:T.surfaceSolid}}>Zero Backlogs</option><option value="Has" style={{background:T.surfaceSolid}}>Has Backlogs</option><option value="Active" style={{background:T.surfaceSolid}}>Active Backlogs</option></select>
            <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:600,color:T.text,cursor:"pointer",padding:"0 6px"}}><input type="checkbox" checked={groupBySection} onChange={e=>setGroupBySection(e.target.checked)} style={{accentColor:T.accent,width:15,height:15,cursor:"pointer"}}/>Group by Section</label>
            {!isUnfiltered&&<button onClick={()=>{setSearch("");setBranchFilter("All");setSectionFilter("All");setBacklogFilter("All");setSortField("cgpa");setSortDir("desc");setGroupBySection(false)}} style={{padding:"10px 14px",borderRadius:8,border:"1px solid "+T.accent,background:T.accentLight,cursor:"pointer",fontSize:12,fontWeight:700,color:T.accent,fontFamily:"inherit"}}>Clear Filters</button>}
          </div>
          {groupBySection&&groupedBySection?Object.entries(groupedBySection).map(([key,data])=>(
            <div key={key} className="fu" style={{marginBottom:18}}>
              <div style={{background:"rgba(15,23,42,0.5)",backdropFilter:"blur(12px)",color:T.headerText,padding:"12px 18px",borderRadius:"12px 12px 0 0",fontSize:13,fontWeight:700,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span>{key}</span><span style={{fontSize:12,fontWeight:500,color:T.muted}}>{data.length} students | Avg: {(data.reduce((a,s)=>a+s.cgpa,0)/data.length).toFixed(2)}</span></div>
              <div style={{...GLASS,borderRadius:"0 0 12px 12px",overflow:"hidden",borderTop:"none",boxShadow:"0 8px 32px rgba(0,0,0,0.2)"}}><div style={{overflowX:"auto"}}>{renderTable(data)}</div></div>
            </div>
          )):(
            <div className="fu" style={{...GLASS,borderRadius:12,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.25)"}}><div style={{overflowX:"auto"}}>{renderTable(filtered)}</div></div>
          )}
          <div style={{marginTop:10,padding:"10px 4px",fontSize:12,color:T.muted,display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:6}}>
            <span>Showing {filtered.length} of {students.length}{!isUnfiltered?" (filtered)":""}</span>
            <span>Sorted by {sortField} ({sortDir==="desc"?"highest first":"lowest first"})</span>
          </div>
        </>)}
      </div>
    </div>
  );
}
